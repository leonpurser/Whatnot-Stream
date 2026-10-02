// Runs the real module code against a real Show Control server. Only
// Companion itself is faked (the InstanceBase host calls are recorded).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---- fake @companion-module/base (keeps the real combineRgb etc.)
const realBase = require('@companion-module/base');
const basePath = require.resolve('@companion-module/base');
class FakeInstanceBase {
  constructor() {
    this.label = 'whatnot';
    this.calls = { variables: {}, statuses: [], logs: [], checks: 0 };
  }
  setActionDefinitions(d) { this.actionDefs = d; }
  setFeedbackDefinitions(d) { this.feedbackDefs = d; }
  setVariableDefinitions(d) { this.variableDefs = d; }
  setPresetDefinitions(d) { this.presetDefs = d; }
  setVariableValues(v) { Object.assign(this.calls.variables, v); }
  checkFeedbacks() { this.calls.checks += 1; }
  updateStatus(s, m) { this.calls.statuses.push([s, m]); }
  log(level, msg) { this.calls.logs.push([level, msg]); }
}
require.cache[basePath] = {
  id: basePath,
  filename: basePath,
  loaded: true,
  exports: Object.assign({}, realBase, { InstanceBase: FakeInstanceBase, runEntrypoint: () => {} }),
};

const { WhatnotShowControl } = require('../src/main');
const { createServer } = require('../../server/index');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  throw new Error('timed out');
}
const ctx = { parseVariablesInString: async (s) => s };

let srv;
let inst;
let cues = [];

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnsc-cm-'));
  srv = createServer({ dataDir: dir });
  const orig = srv.app.broadcast.bind(srv.app);
  srv.app.broadcast = (role, event, data) => {
    if (event === 'cue') cues.push(data);
    orig(role, event, data);
  };
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  inst = new WhatnotShowControl({});
  await inst.init({ host: '127.0.0.1', port: srv.server.address().port });
  await until(() => inst.connected);
});

test.after(async () => {
  await inst.destroy();
  srv.app.close();
  await new Promise((r) => srv.server.close(r));
});

const run = (id, options) => inst.actionDefs[id].callback({ id: 'x', controlId: 'c', actionId: id, options: options || {}, surfaceId: undefined }, ctx);
const fb = (id, options) => inst.feedbackDefs[id].callback({ type: 'boolean', id: 'f', controlId: 'c', feedbackId: id, options: options || {} }, ctx);

test('connects, reports OK and publishes variables', () => {
  assert.equal(inst.calls.statuses.at(-1)[0], 'ok');
  assert.equal(inst.calls.variables.server_connected, 'Yes');
  assert.equal(inst.calls.variables.mode, 'LIVE');
  assert.equal(inst.calls.variables.items_sold, 0);
  for (const d of inst.variableDefs) assert.ok(d.variableId in inst.calls.variables, d.variableId);
});

test('every preset references real actions/feedbacks with valid options', () => {
  const ids = Object.keys(inst.presetDefs);
  assert.ok(ids.length > 40, `${ids.length} presets`);
  for (const [id, p] of Object.entries(inst.presetDefs)) {
    assert.equal(p.type, 'button');
    assert.ok(typeof p.style.text === 'string' && p.style.text.length, id);
    for (const a of p.steps[0].down) {
      const def = inst.actionDefs[a.actionId];
      assert.ok(def, `${id}: action ${a.actionId}`);
      for (const k of Object.keys(a.options)) assert.ok(def.options.some((o) => o.id === k), `${id}: option ${k}`);
    }
    for (const f of p.feedbacks) {
      const def = inst.feedbackDefs[f.feedbackId];
      assert.ok(def, `${id}: feedback ${f.feedbackId}`);
      for (const k of Object.keys(f.options)) assert.ok(def.options.some((o) => o.id === k), `${id}: fb option ${k}`);
    }
    // Variables in text must exist.
    for (const m of p.style.text.matchAll(/\$\(whatnot:([a-z0-9_]+)\)/g)) {
      assert.ok(inst.variableDefs.some((d) => d.variableId === m[1]), `${id}: variable ${m[1]}`);
    }
  }
});

test('graphics actions reach the overlay', async () => {
  cues = [];
  await run('cue', { cue: 'giveaway' });
  await run('cue', { cue: 'bidding_war' });
  await run('clear_all');
  assert.deepEqual(cues.map((c) => c.name), ['giveaway', 'bidding_war', 'clear']);
});

test('rehearsal from the Stream Deck: mode, fake sales, review, fix, delete', async () => {
  await run('mode', { mode: 'toggle' });
  await until(() => inst.state && inst.state.mode === 'rehearsal');
  assert.equal(fb('rehearsal_mode'), true);

  cues = [];
  await run('test_event', { kind: 'sale' });
  await until(() => inst.state.summary.itemsSold === 1);
  assert.equal(cues[0].name, 'sold');

  await run('test_event', { kind: 'lowconf' });
  await until(() => inst.state.review.length === 1);
  assert.equal(fb('review_waiting'), true);
  await until(() => inst.calls.variables.review_count === 1);
  assert.match(inst.calls.variables.review_price, /9/);

  await run('fix_last_sale', { price: '£12', winner: '@fixed_user' });
  await until(() => inst.state.review[0] && inst.state.review[0].price === 12);
  assert.equal(inst.state.review[0].winner, 'fixed_user');

  cues = [];
  await run('air_review');
  await until(() => inst.state.review.length === 0);
  assert.equal(cues[0].name, 'sold');
  assert.equal(cues[0].payload.winner, '@fixed_user');

  await run('delete_last_sale');
  await until(() => inst.state.summary.itemsSold === 1);

  await run('test_event', { kind: 'chat' });
  await until(() => inst.state.chat.length >= 1);
  assert.equal(fb('chat_slot', { slot: 1 }), true);
  cues = [];
  await run('chat_air', { slot: 1 });
  assert.equal(cues[0].name, 'chat');

  await run('mode', { mode: 'live' });
  await until(() => inst.state.mode === 'live');
});

test('manual sale, segments, settings and status feedbacks', async () => {
  cues = [];
  await run('manual_sale', { winner: '@sarah_k', price: '£15', item: '', air: true });
  await until(() => inst.state.summary.itemsSold === 1);
  assert.equal(cues[0].name, 'sold');
  await until(() => inst.calls.variables.top_buyer === '@sarah_k');

  await run('segment_start', { segment: 'pound_madness' });
  await until(() => inst.state.show.segment === 'pound_madness');
  assert.equal(fb('segment_active', { segment: 'pound_madness' }), true);
  assert.equal(fb('segment_active', { segment: '' }), true);
  await run('segment_end');
  await until(() => !inst.state.show.segment);

  const before = fb('setting_on', { key: 'autoAir.overtime' });
  await run('setting', { key: 'autoAir.overtime', mode: 'toggle' });
  await until(() => fb('setting_on', { key: 'autoAir.overtime' }) !== before);
  await run('big_sale_threshold', { value: 40 });
  await until(() => inst.state.settings.bigSale === 40);

  assert.equal(fb('server_connected'), true);
  assert.equal(fb('whatnot_connected'), false);
  assert.equal(fb('on_air', { name: 'any' }), false);
  assert.equal(fb('auction_live'), false);
});

test('a failed action logs a warning instead of crashing', async () => {
  await run('cue', { cue: 'top_buyers' }); // fine now (there is a buyer)
  await run('test_event', { kind: 'sale' }); // live mode: refused by server
  assert.ok(inst.calls.logs.some(([lvl, msg]) => lvl === 'warn' && /REHEARSAL/.test(msg)));
});

test('server going away flips status and feedbacks, and it reconnects', async () => {
  const port = srv.server.address().port;
  for (const c of srv.app.clients) c.res.destroy();
  srv.server.close();
  await until(() => !inst.connected);
  assert.equal(fb('server_connected'), false);
  assert.equal(inst.calls.statuses.at(-1)[0], 'connection_failure');
  await new Promise((r) => srv.server.listen(port, '127.0.0.1', r));
  await until(() => inst.connected, 8000);
  assert.equal(inst.calls.statuses.at(-1)[0], 'ok');
});
