const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../extension/src/selectors.js');
require('../extension/src/parse.js');
require('../extension/src/tracker.js');

const gbp = (n) => (n == null ? null : { amount: n, currency: 'GBP', raw: '£' + n });

// Build a snapshot the way content.js does.
function snap(ts, o) {
  return {
    ts,
    title: o.title ?? null,
    lotNumber: o.title ? W.parseLotNumber(o.title) : null,
    condition: o.condition ?? null,
    imageUrl: null,
    timerSec: o.timer ?? null,
    timerText: o.timer != null ? `00:${String(o.timer).padStart(2, '0')}` : '',
    bidCount: o.bids ?? null,
    status: W.parseStatus(o.status || '', W.PATTERNS),
    nextBid: gbp(o.next),
    currentPrice: gbp(o.price),
    priceGuess: gbp(o.guess),
    isGiveaway: !!o.giveaway,
  };
}

function run(tracker, frames) {
  const out = [];
  for (const [ts, o] of frames) out.push(...tracker.ingest(snap(ts, o)));
  return out;
}

const types = (evs, t) => evs.filter((e) => e.type === t);

// A normal auction: counts down, bids, ends, "won" stays on screen while
// MutationObserver keeps firing.
function normalAuction(t0, title, winner, price) {
  return [
    [t0, { title, timer: 10, bids: 0, status: '', next: 1 }],
    [t0 + 1000, { title, timer: 9, bids: 1, status: 'alice is Winning!', next: 2, price: 1 }],
    [t0 + 2000, { title, timer: 8, bids: 2, status: `${winner} is Winning!`, next: price + 1, price }],
    [t0 + 9000, { title, timer: 0, bids: 2, status: `${winner} is Winning!`, next: price + 1, price }],
    [t0 + 9100, { title, timer: 0, bids: 2, status: `${winner} won!`, price }],
    [t0 + 9150, { title, timer: 0, bids: 2, status: `${winner} won!`, price }],
    [t0 + 9500, { title, timer: 0, bids: 2, status: `${winner} won!`, price }],
    [t0 + 9600, { title, timer: 0, bids: 2, status: `${winner} won!`, price }],
    [t0 + 12000, { title, timer: 0, bids: 2, status: `${winner} won!`, price }],
  ];
}

test('one sale per auction despite repeated won snapshots', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const evs = run(tr, normalAuction(1_000_000, 'Vintage Nike Sweatshirt #374', 'dave', 17));
  const sales = types(evs, 'sale');
  assert.equal(sales.length, 1);
  assert.equal(sales[0].data.winner, 'dave');
  assert.equal(sales[0].data.price, 17);
  assert.equal(sales[0].data.item, 'Vintage Nike Sweatshirt #374');
  assert.equal(sales[0].data.lotNumber, '374');
  assert.equal(sales[0].data.confidence, 'ok');
  assert.equal(types(evs, 'auction_start').length, 1);
  assert.equal(types(evs, 'auction_start')[0].data.item, 'Vintage Nike Sweatshirt #374');
});

test('won must be stable for saleConfirmMs; a flicker does not sell', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 2_000_000;
  const evs = run(tr, [
    [t, { title: 'Hat #1', timer: 3, bids: 2, status: 'bob is Winning!', price: 5 }],
    [t + 50, { title: 'Hat #1', timer: 3, bids: 2, status: 'bob won!', price: 5 }],
    [t + 100, { title: 'Hat #1', timer: 3, bids: 2, status: 'bob is Winning!', price: 5 }],
  ]);
  assert.equal(types(evs, 'sale').length, 0);
});

test('tracker requests a re-check while a win is pending', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  tr.ingest(snap(5000, { title: 'X', timer: 0, bids: 1, status: 'bob is Winning!', price: 3 }));
  tr.ingest(snap(5100, { title: 'X', timer: 0, bids: 1, status: 'bob won!', price: 3 }));
  assert.equal(tr.nextCheckAt, 5100 + W.TUNING.saleConfirmMs + 20);
  const evs = tr.ingest(snap(tr.nextCheckAt, { title: 'X', timer: 0, bids: 1, status: 'bob won!', price: 3 }));
  assert.equal(types(evs, 'sale').length, 1);
});

test('back-to-back auctions each produce one sale', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const evs = run(tr, [
    ...normalAuction(1_000_000, 'Lacoste Polo #1', 'sarah', 12),
    ...normalAuction(1_020_000, 'Ralph Lauren Shirt #2', 'sarah', 20),
    ...normalAuction(1_040_000, 'Levis 501 #3', 'ben', 30),
  ]);
  const sales = types(evs, 'sale');
  assert.deepEqual(
    sales.map((s) => [s.data.winner, s.data.price]),
    [['sarah', 12], ['sarah', 20], ['ben', 30]]
  );
  assert.equal(types(evs, 'auction_start').length, 3);
});

test('same title re-run after a sale is a new auction', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const evs = run(tr, [
    ...normalAuction(1_000_000, 'Mystery Item', 'dave', 1),
    ...normalAuction(1_020_000, 'Mystery Item', 'dave', 1),
  ]);
  assert.equal(types(evs, 'sale').length, 2);
});

test('identical sale inside the dedup window is suppressed, not emitted', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 1_000_000;
  const M = 'Mystery Item';
  const evs = run(tr, [
    [t, { title: M, timer: 2, bids: 1, status: 'dave is Winning!', price: 1 }],
    [t + 2000, { title: M, timer: 0, bids: 1, status: 'dave won!', price: 1 }],
    [t + 2400, { title: M, timer: 0, bids: 1, status: 'dave won!', price: 1 }],
    // Same title, same winner, same price, within saleDedupWindowMs.
    [t + 2600, { title: M, timer: 3, bids: 1, status: 'dave is Winning!', price: 1 }],
    [t + 5000, { title: M, timer: 0, bids: 1, status: 'dave won!', price: 1 }],
    [t + 5400, { title: M, timer: 0, bids: 1, status: 'dave won!', price: 1 }],
  ]);
  assert.equal(types(evs, 'auction_start').length, 2);
  assert.equal(types(evs, 'sale').length, 1);
  assert.equal(types(evs, 'sale_suppressed').length, 1);
});

test('timer jumping up is an extension, not a new auction', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 3_000_000;
  const evs = run(tr, [
    [t, { title: 'Jacket', timer: 3, bids: 4, status: 'amy is Winning!' }],
    [t + 1000, { title: 'Jacket', timer: 2, bids: 4, status: 'amy is Winning!' }],
    [t + 1300, { title: 'Jacket', timer: 10, bids: 5, status: 'tom is Winning!' }],
    [t + 2300, { title: 'Jacket', timer: 9, bids: 5, status: 'tom is Winning!' }],
  ]);
  assert.equal(types(evs, 'auction_extended').length, 1);
  assert.equal(types(evs, 'auction_start').length, 1);
  assert.equal(types(evs, 'bid').length, 1);
  assert.equal(types(evs, 'leader_changed').length, 1);
});

test('giveaway win is not a sale', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 4_000_000;
  const evs = run(tr, [
    [t, { title: 'GIVEAWAY - Beanie', timer: 5, status: '', giveaway: true }],
    [t + 5000, { title: 'GIVEAWAY - Beanie', timer: 0, status: 'lucy won!', giveaway: true }],
    [t + 5400, { title: 'GIVEAWAY - Beanie', timer: 0, status: 'lucy won!', giveaway: true }],
  ]);
  assert.equal(types(evs, 'sale').length, 0);
  assert.equal(types(evs, 'giveaway_result').length, 1);
  assert.equal(types(evs, 'giveaway_result')[0].data.winner, 'lucy');
});

test('joining after the auction ended flags not_observed_live', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 5_000_000;
  const evs = run(tr, [
    [t, { title: 'Cap', timer: 0, bids: 3, status: 'zed won!', price: 9 }],
    [t + 400, { title: 'Cap', timer: 0, bids: 3, status: 'zed won!', price: 9 }],
  ]);
  const sale = types(evs, 'sale')[0];
  assert.ok(sale);
  assert.equal(sale.data.confidence, 'low');
  assert.ok(sale.data.warnings.includes('not_observed_live'));
});

test('unknown price and leader mismatch lower confidence', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 6_000_000;
  const evs = run(tr, [
    [t, { title: 'Tee', timer: 2, bids: 1, status: 'amy is Winning!', next: 6 }],
    [t + 2000, { title: 'Tee', timer: 0, bids: 1, status: 'bob won!', next: 6 }],
    [t + 2400, { title: 'Tee', timer: 0, bids: 1, status: 'bob won!', next: 6 }],
  ]);
  const sale = types(evs, 'sale')[0];
  assert.equal(sale.data.price, null);
  assert.ok(sale.data.warnings.includes('price_unknown'));
  assert.ok(sale.data.warnings.includes('winner_differs_from_last_leader'));
  // The bid button amount must never be used as the sale price.
  assert.notEqual(sale.data.price, 6);
});

test('an empty title during re-render does not split the auction', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 7_000_000;
  const evs = run(tr, [
    [t, { title: 'Fleece', timer: 5, bids: 1, status: 'amy is Winning!', price: 4 }],
    [t + 100, { title: null, timer: 5, bids: 1, status: 'amy is Winning!', price: 4 }],
    [t + 200, { title: 'Fleece', timer: 4, bids: 1, status: 'amy is Winning!', price: 4 }],
  ]);
  assert.equal(types(evs, 'auction_start').length, 1);
});

test('no-sale status is reported once and never becomes a sale', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 8_000_000;
  const evs = run(tr, [
    [t, { title: 'Scarf', timer: 1, bids: 0, status: '' }],
    [t + 1000, { title: 'Scarf', timer: 0, bids: 0, status: 'No bids' }],
    [t + 1500, { title: 'Scarf', timer: 0, bids: 0, status: 'No bids' }],
  ]);
  assert.equal(types(evs, 'auction_no_sale').length, 1);
  assert.equal(types(evs, 'sale').length, 0);
});

test('chat deduper drops re-mounted duplicates inside the window only', () => {
  const d = new W.ChatDeduper(3000);
  assert.equal(d.accept('Sarah', 'show the back?', 0), true);
  assert.equal(d.accept('sarah', 'show the back?', 500), false);
  assert.equal(d.accept('sarah', 'show the back?', 4000), true);
  assert.equal(d.accept('dave', 'show the back?', 4000), true);
});

test('price from text guess is used but flagged until trusted', () => {
  const frames = (t) => [
    [t, { title: 'Premium vintage clothing #23', timer: 2, bids: 3, status: 'altin12345 is Winning!', next: 4, guess: 3 }],
    [t + 2000, { title: 'Premium vintage clothing #23', bids: 3, status: 'altin12345 won!', guess: 3 }],
    [t + 2400, { title: 'Premium vintage clothing #23', bids: 3, status: 'altin12345 won!', guess: 3 }],
  ];
  let sale = types(run(new W.AuctionTracker(W.TUNING), frames(9_000_000)), 'sale')[0];
  assert.equal(sale.data.price, 3);
  assert.equal(sale.data.priceSource, 'text-guess');
  assert.deepEqual(sale.data.warnings, ['price_is_guess']);
  assert.equal(sale.data.confidence, 'low');

  sale = types(run(new W.AuctionTracker({ ...W.TUNING, trustPriceGuess: true }), frames(9_000_000)), 'sale')[0];
  assert.equal(sale.data.price, 3);
  assert.equal(sale.data.confidence, 'ok');
});

test('a real selector price beats the text guess', () => {
  const tr = new W.AuctionTracker(W.TUNING);
  const t = 10_000_000;
  const evs = run(tr, [
    [t, { title: 'Polo', timer: 1, bids: 2, status: 'amy is Winning!', price: 7, guess: 99 }],
    [t + 1000, { title: 'Polo', bids: 2, status: 'amy won!', price: 7, guess: 99 }],
    [t + 1400, { title: 'Polo', bids: 2, status: 'amy won!', price: 7, guess: 99 }],
  ]);
  const sale = types(evs, 'sale')[0];
  assert.equal(sale.data.price, 7);
  assert.equal(sale.data.priceSource, 'price-selector');
});
