const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Config } = require('../server/lib/config');
const { App } = require('../server/lib/app');
const { createServer } = require('../server/index');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wnsc-'));
}

function makeApp(dir) {
  dir = dir || tmpDir();
  const app = new App({ dataDir: dir, config: new Config(dir) });
  const cues = [];
  app.broadcast = (role, event, data) => {
    if (event === 'cue') cues.push(data);
  };
  return { app, cues, dir };
}

let n = 0;
function sale(winner, price, extra) {
  n += 1;
  return Object.assign(
    {
      v: 1,
      type: 'sale',
      ts: Date.now() + n * 20000,
      auctionId: `a${n}`,
      data: { item: `Item #${n}`, winner, price, currency: 'GBP', warnings: [], confidence: 'ok', observedLive: true },
    },
    extra || {}
  );
}

test('a confident sale is stored and airs one SOLD cue', () => {
  const { app, cues } = makeApp();
  app.ingest([sale('dave', 12)]);
  assert.equal(app.live.activeSales().length, 1);
  assert.deepEqual(cues.map((c) => c.name), ['sold']);
  assert.equal(cues[0].payload.price, '£12');
  assert.equal(cues[0].payload.winner, '@dave');
});

test('duplicate sales are dropped: same auction, same sale seconds later, page reload', () => {
  const { app, cues } = makeApp();
  const s = sale('dave', 12);
  app.ingest([s]);
  app.ingest([s]); // same auctionId
  app.ingest([Object.assign({}, s, { auctionId: 'other', ts: s.ts + 2000 })]); // identical within window
  const reload = Object.assign({}, s, { auctionId: 'after-reload', ts: s.ts + 60000 });
  reload.data = Object.assign({}, s.data, { observedLive: false, warnings: ['not_observed_live'] });
  app.ingest([reload]);
  assert.equal(app.live.activeSales().length, 1);
  assert.equal(cues.length, 1);
});

test('same buyer, same item, same price later is a NEW sale (e.g. £1 madness)', () => {
  const { app } = makeApp();
  const a = sale('dave', 1);
  const b = Object.assign({}, a, { auctionId: 'a-second', ts: a.ts + 30000 });
  app.ingest([a, b]);
  assert.equal(app.live.activeSales().length, 2);
});

test('big sale, new record, hat trick, new leader and show milestones', () => {
  const { app, cues } = makeApp();
  app.ingest([sale('amy', 5), sale('ben', 6), sale('ben', 30)]);
  assert.equal(cues.find((c) => c.name === 'big_sale') ? 'big' : 'none', 'none'); // 3rd sale is a record instead
  assert.ok(cues.find((c) => c.name === 'new_record' && c.payload.price === '£30'));
  // ben reached 2 items and took the lead from amy
  assert.ok(cues.find((c) => c.name === 'new_leader' && c.payload.user === '@ben'));
  cues.length = 0;
  app.ingest([sale('ben', 4)]);
  assert.deepEqual(cues.map((c) => c.name), ['sold', 'buyer_milestone']);
  assert.equal(cues[1].payload.label, 'HAT TRICK');
  cues.length = 0;
  app.ingest([sale('zed', 26)]);
  assert.equal(cues[0].name, 'big_sale');
  for (let i = 0; i < 5; i++) app.ingest([sale('x' + i, 2)]);
  assert.ok(cues.find((c) => c.name === 'show_milestone' && c.payload.count === 10));
});

test('unsure sales wait for review; AIR IT airs them', () => {
  const { app, cues } = makeApp();
  app.ingest([sale('dave', 9, { data: { item: 'Tee', winner: 'dave', price: 9, warnings: ['winner_differs_from_last_leader'], observedLive: true } })]);
  const s = app.live.activeSales()[0];
  assert.equal(s.review, true);
  assert.equal(cues.length, 0);
  app.airSale(s.saleId);
  assert.equal(cues[0].name, 'sold');
  assert.equal(app.live.getSale(s.saleId).review, false);
});

test('price guess blocks auto-air until trusted; unknown price airs without price', () => {
  const { app, cues } = makeApp();
  app.ingest([sale('amy', 3, { data: { item: 'A', winner: 'amy', price: 3, warnings: ['price_is_guess'], observedLive: true } })]);
  assert.equal(cues.length, 0);
  app.config.set('trustPriceGuess', true);
  app.ingest([sale('bob', 4, { data: { item: 'B', winner: 'bob', price: 4, warnings: ['price_is_guess'], observedLive: true } })]);
  assert.equal(cues.length, 1);
  app.ingest([sale('cat', null, { data: { item: 'C', winner: 'cat', price: null, warnings: ['price_unknown'], observedLive: true } })]);
  assert.equal(cues.length, 2);
  assert.equal(cues[1].payload.price, null);
});

test('state survives a server restart', () => {
  const dir = tmpDir();
  const a = makeApp(dir);
  a.app.ingest([sale('dave', 12), sale('sarah', 20)]);
  a.app.updateSale(a.app.live.activeSales()[0].saleId, { price: 15 });
  a.app.close();
  const b = makeApp(dir);
  const sum = b.app.live.summary();
  assert.equal(sum.itemsSold, 2);
  assert.equal(sum.revenue, 35);
  b.app.close();
});

test('rehearsal mode keeps test data separate from the live show', () => {
  const { app } = makeApp();
  assert.throws(() => app.ingest([sale('t', 1)], { test: true }));
  app.setMode('rehearsal');
  app.ingest([sale('t', 1)], { test: true });
  app.ingest([Object.assign(sale('mockuser', 2), { source: 'mock' })]);
  assert.equal(app.rehearsal.activeSales().length, 2);
  assert.equal(app.live.activeSales().length, 0);
  app.setMode('live');
  app.ingest([Object.assign(sale('mockuser', 2), { source: 'mock' })]);
  assert.equal(app.live.activeSales().length, 0);
});

test('hidden buyers are never named on air', () => {
  const { app, cues } = makeApp();
  app.config.value.privacy.hiddenBuyers = ['Shy_Buyer'];
  app.ingest([sale('shy_buyer', 8)]);
  assert.equal(cues[0].payload.winner, 'A LUCKY BUYER');
});

test('bidding war fires once per auction', () => {
  const { app, cues } = makeApp();
  const t = Date.now();
  const bids = [0, 1, 2, 3, 4, 5].map((i) => ({ type: 'bid', ts: t + i * 500, auctionId: 'w1', data: { leader: 'u' + i } }));
  app.ingest(bids);
  assert.deepEqual(cues.map((c) => c.name), ['bidding_war']);
});

test('HTTP: other websites are blocked, Companion-style calls work', async () => {
  const dir = tmpDir();
  const { server, app } = createServer({ dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let r = await fetch(`${base}/api/cue/clear`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  r = await fetch(`${base}/api/cue/clear`, { method: 'POST' });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/companion`);
  const j = await r.json();
  assert.equal(j.itemsSold, 0);
  r = await fetch(`${base}/overlay/`);
  assert.equal(r.status, 200);
  r = await fetch(`${base}/..%2fconfig/default.json`);
  assert.notEqual(r.status, 200);
  app.close();
  await new Promise((r2) => server.close(r2));
});
