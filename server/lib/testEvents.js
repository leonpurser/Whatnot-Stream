// Fake reader events for REHEARSAL mode, shared by the dashboard and the
// Stream Deck. They go through exactly the same pipeline as real events.

const USERS = ['sarah_k', 'dave.thrifts', 'ben_vintage', 'lucy88', 'tomtom', 'amy_resells', 'dommy31', 'altin12345'];
const ITEMS = ['Vintage Nike Sweatshirt', 'Lacoste Polo Size M', 'Levis 501 W32', 'Ralph Lauren Oxford', 'Carhartt Detroit Jacket', 'Stone Island Overshirt', 'Patagonia Fleece'];
const CHAT = ['Can you show the back?', 'What size is it?', 'Pit to pit?', 'lets gooo', 'bundle?', 'is it real?'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const KINDS = ['start', 'bid', 'war', 'extend', 'sale', 'big', 'record', 'hattrick', 'lowconf', 'giveaway', 'chat'];

class TestEvents {
  constructor() {
    this.lot = 300;
    this.a = null;
  }

  _ev(type, data, extra) {
    return Object.assign({ v: 1, type, ts: Date.now(), source: 'test', auctionId: this.a ? this.a.id : null, data }, extra || {});
  }

  _start() {
    this.lot += 1;
    this.a = { id: `t${Date.now().toString(36)}${this.lot}`, item: `${pick(ITEMS)} #${this.lot}`, bids: 0, leader: null, price: 1 };
    return this._ev('auction_start', { item: this.a.item, lotNumber: String(this.lot), condition: 'Vintage', phase: 'live', timerSec: 15, bids: 0 });
  }

  _bid(dt) {
    const a = this.a;
    a.bids += 1;
    a.price += 1;
    a.leader = pick(USERS.filter((u) => u !== a.leader));
    return [
      this._ev('bid', { bids: a.bids, delta: 1, leader: a.leader, nextBid: a.price + 1 }, { ts: Date.now() + (dt || 0) }),
      this._ev('auction_update', { item: a.item, phase: 'live', timerSec: 8, bids: a.bids, leader: a.leader, priceGuess: a.price, nextBid: a.price + 1 }),
    ];
  }

  _sale(winner, price, currency, warnings) {
    const start = this._start();
    return [
      start,
      this._ev('sale', {
        item: this.a.item,
        lotNumber: String(this.lot),
        winner,
        price,
        currency,
        priceSource: 'test',
        warnings: warnings || [],
        confidence: warnings && warnings.length ? 'low' : 'ok',
        observedLive: true,
      }),
    ];
  }

  // ctx: { highest, bigSale, currency }
  build(kind, ctx) {
    if (!KINDS.includes(kind)) throw new Error(`unknown test event ${kind}`);
    const out = [];
    if (!this.a && ['bid', 'war', 'extend'].includes(kind)) out.push(this._start());
    switch (kind) {
      case 'start': out.push(this._start()); break;
      case 'bid': out.push(...this._bid()); break;
      case 'war': for (let i = 0; i < 5; i++) out.push(...this._bid(i * 300)); break;
      case 'extend': out.push(this._ev('auction_extended', { fromSec: 3, toSec: 10, extensions: 1 })); break;
      case 'sale': out.push(...this._sale(pick(USERS), 3 + Math.floor(Math.random() * 15), ctx.currency)); break;
      case 'big': out.push(...this._sale(pick(USERS), Math.max(ctx.bigSale, 25) + Math.floor(Math.random() * 10), ctx.currency)); break;
      case 'record': out.push(...this._sale(pick(USERS), Math.max((ctx.highest || 0) + 5, 12), ctx.currency)); break;
      case 'hattrick': {
        const u = pick(USERS);
        for (let i = 0; i < 3; i++) out.push(...this._sale(u, 4 + i, ctx.currency));
        break;
      }
      case 'lowconf': out.push(...this._sale(pick(USERS), 9, ctx.currency, ['winner_differs_from_last_leader'])); break;
      case 'giveaway': out.push(this._start(), this._ev('giveaway_result', { item: 'GIVEAWAY - Beanie', winner: pick(USERS) })); break;
      case 'chat': out.push(this._ev('chat_message', { id: `tc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, user: pick(USERS), text: pick(CHAT) })); break;
    }
    return out;
  }
}

module.exports = { TestEvents, KINDS };
