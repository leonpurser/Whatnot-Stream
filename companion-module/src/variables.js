// Companion variables, e.g. $(whatnot:items_sold). Pure: state -> values.

const LEADERS = 5;
const CHATS = 4;

function definitions() {
  const defs = [
    ['server_connected', 'Server connected (Yes/No)'],
    ['whatnot_connected', 'Whatnot probe connected (Yes/No)'],
    ['obs_connected', 'OBS overlay connected (Yes/No)'],
    ['mode', 'Mode (LIVE / REHEARSAL)'],
    ['show_id', 'Show id'],
    ['segment', 'Active segment'],
    ['on_air', 'Graphic currently on air'],
    ['items_sold', 'Items sold'],
    ['revenue', 'Revenue (private)'],
    ['buyers', 'Number of buyers'],
    ['giveaways', 'Giveaways'],
    ['top_buyer', 'Top buyer'],
    ['top_buyer_items', 'Top buyer item count'],
    ['biggest_sale', 'Biggest sale price'],
    ['biggest_sale_user', 'Biggest sale buyer'],
    ['last_sale_user', 'Last sale buyer'],
    ['last_sale_price', 'Last sale price'],
    ['last_sale_item', 'Last sale item'],
    ['review_count', 'Sales waiting for review'],
    ['review_user', 'Newest waiting sale: buyer'],
    ['review_price', 'Newest waiting sale: price'],
    ['review_item', 'Newest waiting sale: item'],
    ['current_item', 'Current item'],
    ['current_price', 'Current price (or guess)'],
    ['current_leader', 'Current leader'],
    ['current_bids', 'Current bid count'],
    ['current_timer', 'Current timer (seconds)'],
    ['current_phase', 'Current auction phase'],
    ['last_notice', 'Latest warning from the server'],
  ];
  for (let i = 1; i <= LEADERS; i++) {
    defs.push([`leader_${i}_user`, `Leaderboard #${i} buyer`], [`leader_${i}_items`, `Leaderboard #${i} items`]);
  }
  for (let i = 1; i <= CHATS; i++) {
    defs.push([`chat_${i}_user`, `Chat #${i} (1 = newest) user`], [`chat_${i}_text`, `Chat #${i} (1 = newest) text`]);
  }
  return defs.map(([variableId, name]) => ({ variableId, name }));
}

const SYM = { GBP: '£', USD: '$', EUR: '€' };
const at = (u) => (u ? '@' + u : '');
const yn = (b) => (b ? 'Yes' : 'No');

function values(s, connected) {
  const v = {};
  for (const d of definitions()) v[d.variableId] = '';
  v.server_connected = yn(connected);
  if (!s) {
    v.whatnot_connected = 'No';
    v.obs_connected = 'No';
    return v;
  }
  const sym = SYM[s.currency] || '';
  const money = (n) => (n == null ? '' : sym + (Number.isInteger(n) ? n : Number(n).toFixed(2)));
  const sm = s.summary || {};
  const c = s.connections || {};
  v.whatnot_connected = yn(c.reader && c.reader.connected);
  v.obs_connected = yn(c.overlays > 0);
  v.mode = s.mode === 'rehearsal' ? 'REHEARSAL' : 'LIVE';
  v.show_id = (s.show && s.show.id) || '';
  v.segment = (s.show && s.show.segment) || '';
  v.on_air = s.onAir ? s.onAir.name.replace(/_/g, ' ').toUpperCase() : '';
  v.items_sold = sm.itemsSold ?? 0;
  v.revenue = sm.revenueText || '';
  v.buyers = sm.buyerCount ?? 0;
  v.giveaways = sm.giveaways ?? 0;
  v.top_buyer = sm.topBuyer ? at(sm.topBuyer.user) : '';
  v.top_buyer_items = sm.topBuyer ? sm.topBuyer.items : 0;
  v.biggest_sale = sm.highestSale ? sm.highestSale.priceText || '' : '';
  v.biggest_sale_user = sm.highestSale ? at(sm.highestSale.winner) : '';
  v.last_sale_user = sm.lastSale ? at(sm.lastSale.winner) : '';
  v.last_sale_price = sm.lastSale ? sm.lastSale.priceText || '?' : '';
  v.last_sale_item = sm.lastSale ? sm.lastSale.item || '' : '';
  const review = s.review || [];
  const newest = review[review.length - 1];
  v.review_count = review.length;
  v.review_user = newest ? at(newest.winner) || '?' : '';
  v.review_price = newest ? newest.priceText || '?' : '';
  v.review_item = newest ? newest.item || '' : '';
  const a = s.currentAuction;
  if (a) {
    v.current_item = a.item || '';
    v.current_price = a.price != null ? money(a.price) : a.priceGuess != null ? money(a.priceGuess) + '?' : '';
    v.current_leader = at(a.leader);
    v.current_bids = a.bids ?? '';
    v.current_timer = a.timerSec ?? '';
    v.current_phase = a.phase || '';
  }
  const lb = (s.leaderboard || []).filter((b) => !b.hidden);
  for (let i = 1; i <= LEADERS; i++) {
    v[`leader_${i}_user`] = lb[i - 1] ? at(lb[i - 1].user) : '';
    v[`leader_${i}_items`] = lb[i - 1] ? lb[i - 1].items : '';
  }
  const chat = s.chat || []; // newest first
  for (let i = 1; i <= CHATS; i++) {
    v[`chat_${i}_user`] = chat[i - 1] ? at(chat[i - 1].user) : '';
    v[`chat_${i}_text`] = chat[i - 1] ? chat[i - 1].text : '';
  }
  const warn = (s.notices || []).find((n) => n.level !== 'info');
  v.last_notice = warn ? warn.text : '';
  return v;
}

module.exports = { definitions, values, LEADERS, CHATS };
