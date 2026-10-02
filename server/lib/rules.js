// Show controller rules: turn show memory into graphics cues.
// Pure functions: (state, config) -> cues. The overlay never decides anything.

const W = require('../../extension/src/parse.js');

let cueCounter = 0;
function makeCue(name, payload, cfg, extra) {
  cueCounter += 1;
  return Object.assign(
    {
      id: `cue-${Date.now().toString(36)}-${cueCounter}`,
      name,
      payload: payload || {},
      durationMs: (cfg.durations && cfg.durations[name]) || 3000,
    },
    extra || {}
  );
}

function hiddenSet(cfg) {
  return new Set(((cfg.privacy && cfg.privacy.hiddenBuyers) || []).map((u) => W.normUser(u)));
}

function displayUser(user, cfg) {
  if (!user) return null;
  if (hiddenSet(cfg).has(W.normUser(user))) return (cfg.privacy && cfg.privacy.hiddenLabel) || 'A LUCKY BUYER';
  return '@' + W.cleanUser(user);
}

const SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };
function money(amount, currency, cfg) {
  if (amount == null) return null;
  const sym = SYMBOLS[currency || cfg.currency] || '';
  return sym + (Number.isInteger(amount) ? amount : amount.toFixed(2));
}

// Warnings that still allow automatic airing, depending on settings.
function blockingWarnings(sale, cfg) {
  return (sale.warnings || []).filter((w) => {
    if (w === 'price_is_guess') return !cfg.trustPriceGuess;
    if (w === 'price_unknown') return !cfg.airSalesWithoutPrice;
    return true;
  });
}

// Main cue + follow-ups for one sale. `around` = summaries before/after it.
function saleCues(sale, around, cfg) {
  const { before, after } = around;
  const t = cfg.thresholds;
  const hidden = hiddenSet(cfg).has(W.normUser(sale.winner));
  const payload = {
    saleId: sale.saleId,
    price: money(sale.price, sale.currency, cfg),
    winner: displayUser(sale.winner, cfg),
    item: sale.item,
    lotNumber: sale.lotNumber,
    imageUrl: safeImage(sale.imageUrl),
  };

  let main = 'sold';
  const prevHigh = before.highestSale;
  if (
    sale.price != null &&
    prevHigh &&
    sale.price > prevHigh.price &&
    after.itemsSold >= t.recordMinSales &&
    sale.price >= t.recordMinPrice
  ) {
    main = 'new_record';
    payload.previous = money(prevHigh.price, prevHigh.currency, cfg);
  } else if (sale.price != null && sale.price >= t.bigSale) {
    main = 'big_sale';
  }

  const cues = [makeCue(main, payload, cfg, { saleId: sale.saleId })];
  const key = W.normUser(sale.winner);
  const buyer = key ? after.buyers.get(key) : null;

  if (cfg.autoAir.buyerMilestones && buyer && !hidden) {
    const label = t.buyerMilestones[String(buyer.items)];
    if (label) cues.push(makeCue('buyer_milestone', { label, user: displayUser(sale.winner, cfg), count: buyer.items }, cfg));
  }

  if (cfg.autoAir.newLeader && buyer && !hidden) {
    const wasTop = before.topBuyer && before.topBuyer.key;
    const isTop = after.topBuyer && after.topBuyer.key;
    if (isTop === key && wasTop !== key && buyer.items >= t.newLeaderMinItems) {
      cues.push(makeCue('new_leader', { user: displayUser(sale.winner, cfg), count: buyer.items }, cfg));
    }
  }

  if (cfg.autoAir.showMilestones && t.showMilestones.includes(after.itemsSold)) {
    cues.push(makeCue('show_milestone', { count: after.itemsSold }, cfg));
  }
  return cues;
}

function safeImage(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
}

function boardRows(summary, cfg, n) {
  return summary.publicBoard.slice(0, n || cfg.thresholds.leaderboardSize).map((b, i) => ({
    rank: i + 1,
    user: '@' + W.cleanUser(b.display),
    items: b.items,
  }));
}

function statsPayload(summary, cfg) {
  const h = summary.highestSale;
  return {
    itemsSold: summary.itemsSold,
    biggestSale: h ? money(h.price, h.currency, cfg) : null,
    biggestSaleUser: h ? displayUser(h.winner, cfg) : null,
    topBuyer: summary.topBuyer ? '@' + W.cleanUser(summary.topBuyer.display) : null,
    topBuyerItems: summary.topBuyer ? summary.topBuyer.items : null,
  };
}

function endShowPayload(summary, cfg) {
  return Object.assign(statsPayload(summary, cfg), {
    board: boardRows(summary, cfg, 3),
    showName: cfg.brand.showName || '',
  });
}

module.exports = { makeCue, saleCues, blockingWarnings, statsPayload, endShowPayload, boardRows, displayUser, money, hiddenSet, safeImage };
