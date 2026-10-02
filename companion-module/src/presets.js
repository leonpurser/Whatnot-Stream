// Ready-made Stream Deck buttons. Drag them from Companion's Presets tab.

const { combineRgb } = require('@companion-module/base');
const { SETTINGS, TEST_KINDS } = require('./constants');
const { C } = require('./feedbacks');

const BG = {
  dark: combineRgb(25, 25, 32),
  graphic: combineRgb(40, 30, 0),
  yellow: combineRgb(255, 212, 0),
  red: combineRgb(170, 0, 0),
  danger: combineRgb(90, 0, 0),
  off: combineRgb(60, 20, 20),
  test: combineRgb(0, 40, 90),
};

function definitions(self) {
  const L = self.label || 'whatnot';
  const v = (name) => `$(${L}:${name})`;
  const presets = {};

  function add(id, category, name, text, opts) {
    const o = opts || {};
    presets[id] = {
      type: 'button',
      category,
      name,
      style: { text, size: o.size || 'auto', color: o.color != null ? o.color : C.white, bgcolor: o.bg != null ? o.bg : BG.dark },
      steps: [{ down: (o.actions || []).map(([actionId, options]) => ({ actionId, options: options || {} })), up: [] }],
      feedbacks: (o.feedbacks || []).map(([feedbackId, options, style, isInverted]) => {
        const f = { feedbackId, options: options || {} };
        if (style) f.style = style;
        if (isInverted) f.isInverted = true;
        return f;
      }),
    };
  }

  // ---------------------------------------------------------------- sales
  const SALES = '1. Sales';
  add('air_review', SALES, 'AIR the waiting sale (shows buyer + price)', `AIR\n${v('review_user')}\n${v('review_price')}`, {
    size: '14',
    actions: [['air_review']],
    feedbacks: [['review_waiting', {}, { bgcolor: C.amber, color: C.black }]],
  });
  add('dismiss_review', SALES, "DON'T AIR the waiting sale", "DON'T\nAIR", {
    actions: [['dismiss_review']],
    feedbacks: [['review_waiting', {}, { bgcolor: C.amber, color: C.black }]],
  });
  add('review_count', SALES, 'Number of sales waiting', `WAITING\n${v('review_count')}`, {
    size: '18',
    feedbacks: [['review_waiting', {}, { bgcolor: C.amber, color: C.black }]],
  });
  add('sold_again', SALES, 'SOLD graphic for the last sale again', `SOLD\nAGAIN\n${v('last_sale_user')}`, {
    size: '14',
    bg: BG.graphic,
    actions: [['cue', { cue: 'sold_last' }]],
    feedbacks: [['on_air', { name: 'sold' }, { bgcolor: C.red }]],
  });
  add('last_sale', SALES, 'Last sale (display only)', `LAST\n${v('last_sale_user')}\n${v('last_sale_price')}`, { size: '14' });
  add('delete_sale', SALES, 'DELETE the waiting (or last) sale', 'DELETE\nSALE', { bg: BG.danger, actions: [['delete_last_sale']] });

  // ---------------------------------------------------------------- graphics
  const GFX = '2. Graphics';
  const gfx = [
    ['top_buyers', 'TOP\nBUYERS', 'top_buyers'],
    ['stats', 'SHOW\nSTATS', 'stats'],
    ['new_leader', 'LEADER', 'new_leader'],
    ['item_intro', 'NEXT\nUP', 'item_intro'],
    ['bidding_war', 'BIDDING\nWAR', 'bidding_war'],
    ['overtime', 'OVER\nTIME', 'overtime'],
    ['giveaway', 'GIVE\nAWAY', 'giveaway'],
  ];
  for (const [cue, text, onAirName] of gfx) {
    add(`gfx_${cue}`, GFX, text.replace('\n', ' '), text, {
      bg: BG.graphic,
      color: BG.yellow,
      actions: [['cue', { cue }]],
      feedbacks: [['on_air', { name: onAirName }, { bgcolor: C.red, color: C.white }]],
    });
  }
  add('gfx_chat_clear', GFX, 'Clear chat bubble', 'CLEAR\nCHAT', { actions: [['chat_clear']], feedbacks: [['on_air', { name: 'chat' }, { bgcolor: C.red }]] });
  add('gfx_clear_all', GFX, 'CLEAR ALL graphics (emergency)', 'CLEAR\nALL', { bg: BG.red, size: '18', actions: [['clear_all']] });
  add('gfx_end_show', GFX, 'END SHOW recap', 'END\nSHOW', {
    bg: BG.danger,
    actions: [['end_show']],
    feedbacks: [['on_air', { name: 'end_show' }, { bgcolor: C.red }]],
  });

  // ---------------------------------------------------------------- segments
  const SEG = '3. Segments';
  const segs = (self.state && self.state.segments) || [{ id: 'pound_madness', title: '£1 MADNESS' }];
  for (const sg of segs) {
    add(`seg_${sg.id}`, SEG, `Start ${sg.title}`, sg.title, {
      bg: BG.graphic,
      actions: [['segment_start', { segment: sg.id }]],
      feedbacks: [['segment_active', { segment: sg.id }, { bgcolor: C.red, color: C.white }]],
    });
  }
  add('seg_end', SEG, 'End segment', 'END\nSEGMENT', { actions: [['segment_end']], feedbacks: [['segment_active', { segment: '' }, { bgcolor: C.amber, color: C.black }]] });

  // ---------------------------------------------------------------- chat
  const CHAT = '4. Chat';
  for (let i = 1; i <= 4; i++) {
    add(`chat_${i}`, CHAT, `Chat message ${i} (1 = newest): press to put on air`, `${v(`chat_${i}_user`)}\n${v(`chat_${i}_text`)}`, {
      size: '7',
      actions: [['chat_air', { slot: i }]],
      feedbacks: [['chat_slot', { slot: i }, { bgcolor: combineRgb(40, 40, 70) }]],
    });
  }
  add('chat_clear', CHAT, 'Clear chat bubble', 'CLEAR\nCHAT', { actions: [['chat_clear']], feedbacks: [['on_air', { name: 'chat' }, { bgcolor: C.red }]] });

  // ---------------------------------------------------------------- status
  const ST = '5. Status';
  add('st_server', ST, 'Server connection', 'SERVER', { size: '14', bg: BG.red, feedbacks: [['server_connected', {}, { bgcolor: C.green }]] });
  add('st_whatnot', ST, 'Whatnot probe connection', 'WHATNOT', { size: '14', bg: BG.red, feedbacks: [['whatnot_connected', {}, { bgcolor: C.green }]] });
  add('st_obs', ST, 'OBS overlay connection', 'OBS', { size: '14', bg: BG.red, feedbacks: [['obs_connected', {}, { bgcolor: C.green }]] });
  add('st_onair', ST, 'What is on air', `ON AIR\n${v('on_air')}`, { size: '14', feedbacks: [['on_air', { name: 'any' }, { bgcolor: C.red }]] });
  add('st_sold', ST, 'Items sold', `SOLD\n${v('items_sold')}`, { size: '18' });
  add('st_top', ST, 'Top buyer', `TOP\n${v('top_buyer')}\n${v('top_buyer_items')}`, { size: '14' });
  add('st_biggest', ST, 'Biggest sale', `BEST\n${v('biggest_sale')}\n${v('biggest_sale_user')}`, { size: '14' });
  add('st_item', ST, 'Current item and price', `${v('current_item')}\n${v('current_price')}`, { size: '7', feedbacks: [['auction_live', {}, { bgcolor: combineRgb(0, 70, 30) }]] });
  add('st_leader', ST, 'Current leader', `LEADING\n${v('current_leader')}\n${v('current_bids')} bids`, { size: '14' });
  for (let i = 1; i <= 3; i++) add(`st_lb${i}`, ST, `Leaderboard #${i}`, `#${i}\n${v(`leader_${i}_user`)}\n${v(`leader_${i}_items`)}`, { size: '14' });

  // ---------------------------------------------------------------- settings
  const SET = '6. Settings';
  for (const st of SETTINGS) {
    add(`set_${st.id.replace(/\./g, '_')}`, SET, `Toggle: ${st.label}`, st.short, {
      size: '14',
      bg: BG.off,
      actions: [['setting', { key: st.id, mode: 'toggle' }]],
      feedbacks: [['setting_on', { key: st.id }, { bgcolor: C.green }]],
    });
  }

  // ---------------------------------------------------------------- rehearsal
  const RH = '7. Rehearsal';
  add('rh_mode', RH, 'Toggle REHEARSAL mode', `MODE\n${v('mode')}`, {
    size: '14',
    bg: BG.red,
    actions: [['mode', { mode: 'toggle' }]],
    feedbacks: [['rehearsal_mode', {}, { bgcolor: C.blue }]],
  });
  for (const k of TEST_KINDS) {
    add(`rh_${k.id}`, RH, `Test: ${k.label}`, `TEST\n${k.label.toUpperCase()}`, { size: '7', bg: BG.test, actions: [['test_event', { kind: k.id }]] });
  }

  // ---------------------------------------------------------------- danger
  add('new_show', '8. Show', 'Start a NEW show (resets counters)', 'NEW\nSHOW', { bg: BG.danger, actions: [['new_show', { name: '' }]] });

  return presets;
}

module.exports = { definitions };
