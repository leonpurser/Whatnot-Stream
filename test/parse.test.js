const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../extension/src/selectors.js');
require('../extension/src/parse.js');

test('parseMoney', () => {
  assert.deepEqual(W.parseMoney('Bid: £24'), { amount: 24, currency: 'GBP', raw: '£24' });
  assert.equal(W.parseMoney('£1,250.5').amount, 1250.5);
  assert.equal(W.parseMoney('$3.99').currency, 'USD');
  assert.equal(W.parseMoney('12 Bids'), null);
});

test('parseTimer', () => {
  assert.equal(W.parseTimer('00:07'), 7);
  assert.equal(W.parseTimer('1:05'), 65);
  assert.equal(W.parseTimer('1:00:00'), 3600);
  assert.equal(W.parseTimer('7s'), 7);
  assert.equal(W.parseTimer(''), null);
});

test('parseBidCount / lot / condition', () => {
  assert.equal(W.parseBidCount('New With Tags | 12 Bids | 00:07', W.PATTERNS.bidCount), 12);
  assert.equal(W.parseBidCount('1 Bid', W.PATTERNS.bidCount), 1);
  assert.equal(W.parseBidCount('Bid: £24', W.PATTERNS.bidCount), null);
  assert.equal(W.parseLotNumber('ITEM ON SCREEN •No Cancellations• #348'), '348');
  assert.equal(W.detectCondition('Nike Hoodie | New With Tags | 12 Bids', W.PATTERNS.conditions), 'New With Tags');
  assert.equal(W.detectCondition('Pre-owned - Good', W.PATTERNS.conditions), 'Pre-owned - Good');
});

test('parseStatus', () => {
  const s1 = W.parseStatus('dommy31 is Winning!', W.PATTERNS);
  assert.equal(s1.kind, 'leading');
  assert.equal(s1.user, 'dommy31');
  const s2 = W.parseStatus('dommy31 won!', W.PATTERNS);
  assert.equal(s2.kind, 'won');
  assert.equal(s2.user, 'dommy31');
  const s3 = W.parseStatus("You're winning!", W.PATTERNS);
  assert.equal(s3.kind, 'leading');
  assert.equal(s3.user, null);
  assert.equal(s3.you, true);
  assert.equal(W.parseStatus('You won!', W.PATTERNS).kind, 'won');
  assert.equal(W.parseStatus('No bids', W.PATTERNS).kind, 'no_sale');
  assert.equal(W.parseStatus('', W.PATTERNS).kind, 'none');
  assert.equal(W.parseStatus('Something new', W.PATTERNS).kind, 'unknown');
});

test('detectCondition only matches whole segments', () => {
  const C = W.PATTERNS.conditions;
  // From a real show: title contains "vintage", condition segment is "Vintage".
  assert.equal(W.detectCondition(['Premium vintage clothing #23', 'Vintage', '3 Bids'], C), 'Vintage');
  assert.equal(W.detectCondition(['Premium vintage clothing #23', '3 Bids'], C), null);
  assert.equal(W.detectCondition('Hat | New With Tags | 1 Bid', C), 'New With Tags');
});

test('findPriceSegments picks pure amounts only', () => {
  const P = W.PATTERNS.priceSegment;
  // Segments as seen on a real show after a sale.
  const segs = ['Premium vintage clothing #23', 'Vintage', '3 Bids', 'Shipping is £3.27 + Taxes', '£3', 'Sold'];
  const found = W.findPriceSegments(segs, P);
  assert.equal(found.length, 1);
  assert.equal(found[0].money.amount, 3);
  assert.equal(found[0].soldLabel, true);
  assert.equal(W.findPriceSegments(['Bid: £4', 'Shipping is £3.27 + Taxes'], P).length, 0);
  assert.equal(W.findPriceSegments(['£3', '£5'], P).length, 2);
  assert.equal(W.findPriceSegments(['£3', '£3'], P).length, 1);
});
