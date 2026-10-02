// Show memory. Event-sourced: every change is appended to a JSONL file and
// state is rebuilt from that file on startup, so restarting the server
// mid-show loses nothing. The rehearsal store has no file (memory only).

const fs = require('node:fs');
const W = require('../../extension/src/parse.js');

const round2 = (n) => Math.round(n * 100) / 100;

// Summary of a list of sales. Leaderboard = items desc, then whoever reached
// that count first. Spend is included for the producer only.
function summarize(sales, hiddenSet) {
  const buyers = new Map();
  let revenue = 0;
  let highest = null;
  for (const s of sales) {
    if (s.price != null) {
      revenue += s.price;
      if (!highest || s.price > highest.price) highest = s;
    }
    const key = W.normUser(s.winner);
    if (!key) continue;
    const b = buyers.get(key) || { key, display: s.winner, items: 0, spend: 0, reachedAt: 0, hidden: hiddenSet.has(key) };
    b.items += 1;
    b.spend = round2(b.spend + (s.price || 0));
    b.reachedAt = s.ts;
    b.display = s.winner;
    buyers.set(key, b);
  }
  const leaderboard = [...buyers.values()].sort((a, b) => b.items - a.items || a.reachedAt - b.reachedAt);
  const publicBoard = leaderboard.filter((b) => !b.hidden);
  return {
    itemsSold: sales.length,
    revenue: round2(revenue),
    highestSale: highest,
    lastSale: sales.length ? sales[sales.length - 1] : null,
    buyerCount: buyers.size,
    leaderboard,
    publicBoard,
    topBuyer: publicBoard[0] || null,
    buyers,
  };
}

class ShowStore {
  constructor({ file, rehearsal } = {}) {
    this.file = file || null;
    this.rehearsal = !!rehearsal;
    this.reset();
    if (this.file && fs.existsSync(this.file)) this._load();
  }

  reset() {
    this.show = { id: null, name: '', startedAt: null, endedAt: null, segment: null };
    this.sales = [];
    this.giveaways = [];
    this.saleCounter = 0;
  }

  _load() {
    const lines = fs.readFileSync(this.file, 'utf8').split('\n');
    let bad = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this._apply(JSON.parse(line));
      } catch (e) {
        bad += 1;
      }
    }
    if (bad) console.warn(`[store] skipped ${bad} unreadable line(s) in ${this.file}`);
  }

  _append(evt) {
    if (this.file) fs.appendFileSync(this.file, JSON.stringify(evt) + '\n');
  }

  // State-changing event.
  record(type, data, ts) {
    const evt = { ts: ts || Date.now(), type, data };
    this._apply(evt);
    this._append(evt);
    return evt;
  }

  // Troubleshooting-only entry (not used to rebuild state).
  log(type, data) {
    this._append({ ts: Date.now(), type: 'log', data: Object.assign({ kind: type }, data) });
  }

  _apply({ ts, type, data }) {
    switch (type) {
      case 'show_start':
        this.show = { id: data.id, name: data.name || '', startedAt: ts, endedAt: null, segment: null };
        break;
      case 'sale': {
        this.saleCounter += 1;
        this.sales.push(Object.assign({ deleted: false, aired: false, review: false }, data, { ts: data.ts || ts }));
        break;
      }
      case 'sale_update': {
        const s = this.getSale(data.saleId);
        if (s) for (const k of ['winner', 'price', 'item', 'aired', 'review']) if (k in data) s[k] = data[k];
        break;
      }
      case 'sale_delete': {
        const s = this.getSale(data.saleId);
        if (s) s.deleted = true;
        break;
      }
      case 'giveaway':
        this.giveaways.push(Object.assign({}, data, { ts: data.ts || ts }));
        break;
      case 'segment':
        this.show.segment = data.id || null;
        break;
      case 'show_end':
        this.show.endedAt = ts;
        break;
      case 'show_resume':
        this.show.endedAt = null;
        break;
      default:
        break;
    }
  }

  newSaleId() {
    return `s${Date.now().toString(36)}${(this.saleCounter + 1).toString(36)}`;
  }

  getSale(id) {
    return this.sales.find((s) => s.saleId === id) || null;
  }

  activeSales() {
    return this.sales.filter((s) => !s.deleted);
  }

  summary(hiddenSet) {
    return summarize(this.activeSales(), hiddenSet || new Set());
  }

  // Summaries just before and just after a given sale (used for records and
  // milestones, so airing an older sale later still says the right thing).
  aroundSale(saleId, hiddenSet) {
    const active = this.activeSales();
    const idx = active.findIndex((s) => s.saleId === saleId);
    if (idx < 0) return null;
    return {
      before: summarize(active.slice(0, idx), hiddenSet || new Set()),
      after: summarize(active.slice(0, idx + 1), hiddenSet || new Set()),
    };
  }
}

module.exports = { ShowStore, summarize };
