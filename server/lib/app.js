// The show controller: receives reader events, keeps show memory, decides
// which graphics to cue, and pushes state to dashboards / cues to overlays.

const fs = require('node:fs');
const path = require('node:path');
const W = require('../../extension/src/parse.js');
const { ShowStore } = require('./store');
const R = require('./rules');
const { TestEvents } = require('./testEvents');

const READER_TIMEOUT_MS = 12000;
const MAX_CHAT = 150;
const MAX_NOTICES = 40;

function showId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `show-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fingerprint(winner, item, price) {
  return [W.normUser(winner), W.normTitle(item), price == null ? '' : price].join('|');
}

class App {
  constructor({ dataDir, config }) {
    this.dataDir = dataDir;
    this.config = config;
    this.showsDir = path.join(dataDir, 'shows');
    this.pointerFile = path.join(dataDir, 'current-show.txt');
    fs.mkdirSync(this.showsDir, { recursive: true });

    this.live = this._openLiveShow();
    this.rehearsal = null;
    this.mode = 'live';

    this.currentAuction = null;
    this.auctions = new Map();
    this.reader = { lastSeenTs: 0, health: null, selectorsVersion: null, showId: null };
    this.chat = [];
    this.notices = [];
    this.cueHistory = [];
    this.onAir = null;
    this.clients = new Set();
    this.testEvents = new TestEvents();
    this._stateTimer = null;
    this._tick = setInterval(() => this.pushState(), 2000);
    if (this._tick.unref) this._tick.unref();
  }

  get cfg() {
    return this.config.get();
  }

  // ------------------------------------------------------------- shows
  _openLiveShow() {
    try {
      const id = fs.readFileSync(this.pointerFile, 'utf8').trim();
      const file = path.join(this.showsDir, `${id}.jsonl`);
      if (id && fs.existsSync(file)) {
        const store = new ShowStore({ file });
        console.log(`[show] resumed ${id}: ${store.activeSales().length} sale(s)`);
        return store;
      }
    } catch (e) {
      /* no current show */
    }
    return this._createShow('');
  }

  _createShow(name) {
    const id = showId();
    const store = new ShowStore({ file: path.join(this.showsDir, `${id}.jsonl`) });
    store.record('show_start', { id, name: name || '' });
    fs.writeFileSync(this.pointerFile, id);
    console.log(`[show] started ${id}`);
    return store;
  }

  store() {
    return this.mode === 'rehearsal' && this.rehearsal ? this.rehearsal : this.live;
  }

  newShow(name) {
    this.live = this._createShow(name);
    this.notice('info', `New show started: ${this.live.show.id}`);
    this.pushState();
  }

  setMode(mode) {
    if (mode === 'rehearsal') {
      this.rehearsal = new ShowStore({ rehearsal: true });
      this.rehearsal.record('show_start', { id: 'rehearsal', name: 'Rehearsal' });
      this.mode = 'rehearsal';
      this.notice('warn', 'REHEARSAL mode: test buttons enabled, rehearsal sales are not saved. Real Whatnot sales still go to the live show.');
    } else {
      this.mode = 'live';
      this.rehearsal = null;
      this.notice('info', 'Back to LIVE mode. Rehearsal data discarded.');
    }
    this.pushState();
  }

  // ------------------------------------------------------------- ingest
  ingest(events, { test } = {}) {
    if (!Array.isArray(events)) throw new Error('events must be an array');
    if (test && this.mode !== 'rehearsal') throw new Error('Switch to REHEARSAL mode to use test events');
    // Events from the offline mock show page count as test events.
    if (!test && events.some((e) => e && e.source === 'mock')) {
      const real = events.filter((e) => !e || e.source !== 'mock');
      const mock = events.filter((e) => e && e.source === 'mock');
      if (this.mode === 'rehearsal') {
        this.reader.lastSeenTs = Date.now();
        this.reader.mock = true;
        this.ingest(mock, { test: true });
      }
      else if (!this._mockWarned || Date.now() - this._mockWarned > 60000) {
        this._mockWarned = Date.now();
        this.notice('warn', 'Ignoring events from the mock show page. Switch to REHEARSAL mode to use it.');
      }
      return real.length ? this.ingest(real) : 0;
    }
    const store = test ? this.rehearsal : this.live;
    let accepted = 0;
    for (const evt of events) {
      if (!evt || typeof evt.type !== 'string' || typeof evt.data !== 'object' || evt.data === null) continue;
      if (!test) {
        this.reader.lastSeenTs = Date.now();
        this.reader.mock = false;
      }
      try {
        this._handle(evt, store, !!test);
        accepted += 1;
      } catch (e) {
        console.error('[ingest]', evt.type, e);
        this.notice('error', `Error handling ${evt.type}: ${e.message}`);
      }
    }
    this.scheduleState();
    return accepted;
  }

  // REHEARSAL-only fake events (dashboard + Stream Deck test buttons).
  testEvent(kind) {
    if (this.mode !== 'rehearsal') throw new Error('Switch to REHEARSAL mode to use test events');
    const sum = this.store().summary();
    const events = this.testEvents.build(kind, {
      highest: sum.highestSale ? sum.highestSale.price || 0 : 0,
      bigSale: this.cfg.thresholds.bigSale,
      currency: this.cfg.currency,
    });
    return { accepted: this.ingest(events, { test: true }) };
  }

  // Air a chat message by position (1 = newest), for Stream Deck chat buttons.
  airChatSlot(slot) {
    const list = this.chat.slice().reverse();
    const m = list[Math.max(0, (parseInt(slot, 10) || 1) - 1)];
    if (!m) throw new Error('no chat message in that slot');
    return this.airChat(m.id);
  }

  _auctionEntry(id) {
    if (!id) return { bids: [], war: false, overtime: false };
    let e = this.auctions.get(id);
    if (!e) {
      e = { bids: [], war: false, overtime: false };
      this.auctions.set(id, e);
      if (this.auctions.size > 100) this.auctions.delete(this.auctions.keys().next().value);
    }
    return e;
  }

  _handle(evt, store, test) {
    const d = evt.data;
    const cfg = this.cfg;
    switch (evt.type) {
      case 'probe_started':
        this.reader.showId = d.showId || null;
        this.reader.selectorsVersion = d.selectorsVersion || null;
        this.notice('info', `Whatnot probe connected${d.showId ? ` (show ${d.showId.slice(0, 8)}…)` : ''}`);
        break;
      case 'probe_status':
      case 'probe_heartbeat':
        if (d.visible === false && !this.reader.hiddenWarned) {
          this.reader.hiddenWarned = true;
          this.notice('warn', 'The Whatnot tab is hidden or minimised. Chrome slows hidden tabs: keep it visible.');
        } else if (d.visible) this.reader.hiddenWarned = false;
        if (d.health) this.reader.health = d.health;
        if (d.selectorsVersion) this.reader.selectorsVersion = d.selectorsVersion;
        break;
      case 'auction_start':
        this.currentAuction = Object.assign({ auctionId: evt.auctionId, ts: evt.ts }, d);
        this._auctionEntry(evt.auctionId);
        if (cfg.autoAir.itemIntro && d.item && !d.isGiveaway) this.manualCue('item_intro');
        break;
      case 'auction_update':
        this.currentAuction = Object.assign({ auctionId: evt.auctionId, ts: evt.ts }, d);
        break;
      case 'auction_no_sale':
      case 'auction_hidden':
        if (this.currentAuction && this.currentAuction.auctionId === evt.auctionId) {
          this.currentAuction.phase = evt.type === 'auction_no_sale' ? 'no_sale' : 'hidden';
        }
        break;
      case 'bid': {
        const e = this._auctionEntry(evt.auctionId);
        const t = cfg.thresholds;
        e.bids.push(evt.ts || Date.now());
        e.bids = e.bids.filter((x) => (evt.ts || Date.now()) - x <= t.biddingWarWindowMs);
        if (!e.war && e.bids.length >= t.biddingWarBids) {
          e.war = true;
          if (cfg.autoAir.biddingWar) this.sendCue(R.makeCue('bidding_war', { item: d.item || (this.currentAuction && this.currentAuction.item) }, cfg));
        }
        break;
      }
      case 'auction_extended': {
        const e = this._auctionEntry(evt.auctionId);
        if (!e.overtime) {
          e.overtime = true;
          if (cfg.autoAir.overtime) this.sendCue(R.makeCue('overtime', {}, cfg));
        }
        break;
      }
      case 'sale':
        this._onSale(evt, store, test);
        break;
      case 'sale_suppressed':
        this.notice('warn', `Probe suppressed a possible duplicate: @${d.winner || '?'} ${d.item || ''}. If it was a real second sale, add it manually.`);
        store.log('sale_suppressed', { winner: d.winner, item: d.item, price: d.price });
        break;
      case 'giveaway_result':
        store.record('giveaway', { auctionId: evt.auctionId, winner: d.winner || null, item: d.item || null });
        if (cfg.autoAir.giveawayWinner && d.winner) {
          this.sendCue(R.makeCue('giveaway_winner', { user: R.displayUser(d.winner, cfg), item: d.item }, cfg));
        }
        break;
      case 'chat_message':
        if (!d.text && !d.user) break;
        this.chat.push({ id: d.id || `c${Date.now().toString(36)}${this.chat.length}`, user: d.user || null, text: String(d.text || '').slice(0, 500), ts: evt.ts || Date.now(), backlog: !!d.backlog, test });
        if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
        break;
      default:
        break;
    }
  }

  _onSale(evt, store, test) {
    const d = evt.data;
    if (this.currentAuction && evt.auctionId && this.currentAuction.auctionId === evt.auctionId) {
      this.currentAuction.phase = this.currentAuction.isGiveaway ? 'giveaway_done' : 'sold';
    }
    const cfg = this.cfg;
    const t = cfg.thresholds;
    const now = evt.ts || Date.now();
    const fp = fingerprint(d.winner, d.item, d.price);
    const active = store.activeSales();

    let dupReason = null;
    if (evt.auctionId && active.some((s) => s.auctionId === evt.auctionId)) dupReason = 'same auction';
    else if (active.some((s) => fingerprint(s.winner, s.item, s.price) === fp && Math.abs(now - s.ts) < t.duplicateWindowMs)) dupReason = 'identical sale seconds ago';
    else if (d.observedLive === false && active.some((s) => fingerprint(s.winner, s.item, s.price) === fp && Math.abs(now - s.ts) < t.reloadDuplicateWindowMs)) {
      dupReason = 'already recorded before page reload';
    }
    if (dupReason) {
      store.log('sale_duplicate_dropped', { reason: dupReason, winner: d.winner, item: d.item, price: d.price });
      this.notice('info', `Duplicate sale ignored (${dupReason}): @${d.winner || '?'} ${d.item || ''}`);
      return;
    }

    const sale = {
      saleId: store.newSaleId(),
      auctionId: evt.auctionId || null,
      ts: now,
      item: d.item || null,
      lotNumber: d.lotNumber || null,
      imageUrl: R.safeImage(d.imageUrl),
      winner: d.winner ? W.cleanUser(d.winner) : null,
      price: typeof d.price === 'number' ? d.price : null,
      currency: d.currency || cfg.currency,
      priceSource: d.priceSource || null,
      warnings: Array.isArray(d.warnings) ? d.warnings.slice(0, 10) : [],
      source: test ? 'test' : d.source || 'whatnot',
      segment: store.show.segment,
    };
    if (!sale.winner && !sale.warnings.includes('winner_unknown')) sale.warnings.push('winner_unknown');
    const blocking = R.blockingWarnings(sale, cfg);
    sale.review = blocking.length > 0;
    store.record('sale', sale);

    if (sale.review) {
      this.notice('warn', `Sale needs review (${blocking.join(', ')}): @${sale.winner || '?'} ${sale.item || ''}`);
    } else if (cfg.autoAir.sales) {
      this.airSale(sale.saleId, store);
    }
  }

  // ------------------------------------------------------------- sales
  airSale(saleId, store) {
    store = store || this.store();
    const sale = store.getSale(saleId);
    if (!sale || sale.deleted) throw new Error('sale not found');
    const around = store.aroundSale(saleId, R.hiddenSet(this.cfg));
    for (const cue of R.saleCues(sale, around, this.cfg)) this.sendCue(cue);
    store.record('sale_update', { saleId, aired: true, review: false });
    this.scheduleState();
  }

  dismissSale(saleId) {
    this.store().record('sale_update', { saleId, review: false });
    this.scheduleState();
  }

  updateSale(saleId, changes) {
    const store = this.store();
    const s = store.getSale(saleId);
    if (!s) throw new Error('sale not found');
    const upd = { saleId };
    if ('winner' in changes) upd.winner = changes.winner ? W.cleanUser(String(changes.winner)) : null;
    if ('item' in changes) upd.item = changes.item ? String(changes.item).slice(0, 200) : null;
    if ('price' in changes) {
      const p = changes.price === null || changes.price === '' ? null : Number(changes.price);
      if (p !== null && (!Number.isFinite(p) || p < 0)) throw new Error('price must be a number');
      upd.price = p === null ? null : Math.round(p * 100) / 100;
    }
    store.record('sale_update', upd);
    this.scheduleState();
  }

  deleteSale(saleId) {
    this.store().record('sale_delete', { saleId });
    this.scheduleState();
  }

  manualSale({ winner, price, item, air }) {
    const store = this.store();
    const p = price === '' || price == null ? null : Number(price);
    if (p !== null && (!Number.isFinite(p) || p < 0)) throw new Error('price must be a number');
    const sale = {
      saleId: store.newSaleId(),
      auctionId: null,
      ts: Date.now(),
      item: item ? String(item).slice(0, 200) : (this.currentAuction && this.currentAuction.item) || null,
      lotNumber: null,
      imageUrl: null,
      winner: winner ? W.cleanUser(String(winner)) : null,
      price: p === null ? null : Math.round(p * 100) / 100,
      currency: this.cfg.currency,
      priceSource: 'manual',
      warnings: [],
      source: 'manual',
      segment: store.show.segment,
      review: false,
    };
    store.record('sale', sale);
    if (air) this.airSale(sale.saleId, store);
    this.scheduleState();
    return sale;
  }

  // ------------------------------------------------------------- cues
  sendCue(cue) {
    cue.ts = Date.now();
    this.cueHistory.push({ id: cue.id, name: cue.name, ts: cue.ts, summary: cueSummary(cue) });
    if (this.cueHistory.length > 30) this.cueHistory.shift();
    this.broadcast('overlay', 'cue', cue);
    this.scheduleState();
    return cue;
  }

  manualCue(name, params) {
    params = params || {};
    const cfg = this.cfg;
    const store = this.store();
    const sum = store.summary(R.hiddenSet(cfg));
    switch (name) {
      case 'sold_last': {
        const last = sum.lastSale;
        if (!last) throw new Error('no sales yet');
        this.airSale(last.saleId, store);
        return { ok: true };
      }
      case 'air_review':
      case 'dismiss_review': {
        // Stream Deck friendly: act on the most recent sale waiting for review.
        const waiting = store.activeSales().filter((s) => s.review);
        const s = waiting[waiting.length - 1];
        if (!s) throw new Error('no sale waiting for review');
        if (name === 'air_review') this.airSale(s.saleId, store);
        else this.dismissSale(s.saleId);
        return { ok: true, saleId: s.saleId };
      }
      case 'stats':
        return this.sendCue(R.makeCue('stats', R.statsPayload(sum, cfg), cfg));
      case 'top_buyers': {
        const rows = R.boardRows(sum, cfg);
        if (!rows.length) throw new Error('no buyers yet');
        return this.sendCue(R.makeCue('top_buyers', { rows }, cfg));
      }
      case 'new_leader': {
        if (!sum.topBuyer) throw new Error('no buyers yet');
        return this.sendCue(R.makeCue('new_leader', { user: '@' + W.cleanUser(sum.topBuyer.display), count: sum.topBuyer.items }, cfg));
      }
      case 'item_intro': {
        const a = this.currentAuction;
        if (!a || !a.item) throw new Error('no current item');
        return this.sendCue(R.makeCue('item_intro', { item: a.item, condition: a.condition, lotNumber: a.lotNumber, imageUrl: R.safeImage(a.imageUrl) }, cfg));
      }
      case 'giveaway':
        return this.sendCue(R.makeCue('giveaway', {}, cfg));
      case 'segment': {
        const seg = cfg.segments.find((s) => s.id === (params.id || store.show.segment));
        if (!seg) throw new Error('unknown segment');
        if (store.show.segment !== seg.id) store.record('segment', { id: seg.id });
        return this.sendCue(R.makeCue('segment', { title: seg.title, subtitle: seg.subtitle, color: seg.color }, cfg));
      }
      case 'segment_end':
        store.record('segment', { id: null });
        this.scheduleState();
        return { ok: true };
      case 'bidding_war':
      case 'overtime':
        return this.sendCue(R.makeCue(name, {}, cfg));
      case 'end_show':
        if (!store.show.endedAt) store.record('show_end', {});
        return this.sendCue(R.makeCue('end_show', R.endShowPayload(sum, cfg), cfg));
      case 'clear':
        return this.sendCue(R.makeCue('clear', {}, cfg, { durationMs: 0 }));
      case 'chat_clear':
        return this.sendCue(R.makeCue('chat_clear', {}, cfg, { durationMs: 0 }));
      default:
        throw new Error(`unknown cue ${name}`);
    }
  }

  airChat(id) {
    const m = this.chat.find((c) => c.id === id);
    if (!m) throw new Error('chat message not found');
    m.aired = true;
    return this.sendCue(R.makeCue('chat', { user: m.user ? '@' + m.user : '', text: m.text }, this.cfg));
  }

  overlayAck({ cueId, name, status }) {
    if (status === 'started') this.onAir = { cueId, name, since: Date.now() };
    else if (status === 'done' && this.onAir && this.onAir.cueId === cueId) this.onAir = null;
    else if (status === 'cleared') this.onAir = null;
    this.scheduleState();
  }

  // ------------------------------------------------------------- clients
  addClient(res, role) {
    const c = { res, role };
    this.clients.add(c);
    res.on('close', () => {
      this.clients.delete(c);
      this.scheduleState();
    });
    if (role === 'overlay') this._send(c, 'hello', this.overlayConfig());
    // dashboards and Companion both receive full state
    else this._send(c, 'state', this.buildState());
    this.scheduleState();
    return c;
  }

  overlayConfig() {
    const cfg = this.cfg;
    return { brand: cfg.brand, layout: cfg.layout, audio: cfg.audio, currency: cfg.currency };
  }

  _send(c, event, data) {
    try {
      c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      this.clients.delete(c);
    }
  }

  broadcast(role, event, data) {
    for (const c of this.clients) if (!role || c.role === role) this._send(c, event, data);
  }

  count(role) {
    let n = 0;
    for (const c of this.clients) if (c.role === role) n += 1;
    return n;
  }

  scheduleState() {
    if (this._stateTimer) return;
    this._stateTimer = setTimeout(() => {
      this._stateTimer = null;
      this.pushState();
    }, 120);
  }

  pushState() {
    if (!this.count('dashboard') && !this.count('companion')) return;
    const st = this.buildState();
    this.broadcast('dashboard', 'state', st);
    this.broadcast('companion', 'state', st);
  }

  notice(level, text) {
    this.notices.push({ ts: Date.now(), level, text });
    if (this.notices.length > MAX_NOTICES) this.notices.shift();
    if (level !== 'info') console.log(`[${level}] ${text}`);
    this.scheduleState();
  }

  buildState() {
    const cfg = this.cfg;
    const store = this.store();
    const sum = store.summary(R.hiddenSet(cfg));
    const pick = (s) =>
      s && {
        saleId: s.saleId,
        ts: s.ts,
        item: s.item,
        lotNumber: s.lotNumber,
        winner: s.winner,
        price: s.price,
        priceText: R.money(s.price, s.currency, cfg),
        priceSource: s.priceSource,
        warnings: s.warnings,
        review: s.review,
        aired: s.aired,
        source: s.source,
      };
    const active = store.activeSales();
    return {
      serverTime: Date.now(),
      mode: this.mode,
      show: store.show,
      summary: {
        itemsSold: sum.itemsSold,
        revenue: sum.revenue,
        revenueText: R.money(sum.revenue, cfg.currency, cfg),
        buyerCount: sum.buyerCount,
        highestSale: pick(sum.highestSale),
        lastSale: pick(sum.lastSale),
        topBuyer: sum.topBuyer && { user: sum.topBuyer.display, items: sum.topBuyer.items },
        giveaways: store.giveaways.length,
      },
      leaderboard: sum.leaderboard.slice(0, 12).map((b) => ({ user: b.display, items: b.items, spend: b.spend, hidden: b.hidden })),
      sales: active.slice(-80).reverse().map(pick),
      review: active.filter((s) => s.review).map(pick),
      currentAuction: this.currentAuction,
      connections: {
        reader: {
          connected: Date.now() - this.reader.lastSeenTs < READER_TIMEOUT_MS,
          lastSeenTs: this.reader.lastSeenTs,
          health: this.reader.health,
          selectorsVersion: this.reader.selectorsVersion,
          mock: !!this.reader.mock,
        },
        overlays: this.count('overlay'),
        dashboards: this.count('dashboard'),
        companion: this.count('companion'),
      },
      onAir: this.onAir,
      cues: this.cueHistory.slice(-12).reverse(),
      chat: this.chat.slice(-60).reverse(),
      notices: this.notices.slice(-15).reverse(),
      settings: {
        autoAir: cfg.autoAir,
        trustPriceGuess: cfg.trustPriceGuess,
        airSalesWithoutPrice: cfg.airSalesWithoutPrice,
        bigSale: cfg.thresholds.bigSale,
      },
      segments: cfg.segments.map((s) => ({ id: s.id, title: s.title })),
      currency: cfg.currency,
    };
  }

  companionState() {
    const s = this.buildState();
    return {
      mode: s.mode,
      readerConnected: s.connections.reader.connected,
      overlayConnected: s.connections.overlays > 0,
      itemsSold: s.summary.itemsSold,
      topBuyer: s.summary.topBuyer ? '@' + s.summary.topBuyer.user : '',
      topBuyerItems: s.summary.topBuyer ? s.summary.topBuyer.items : 0,
      biggestSale: s.summary.highestSale ? s.summary.highestSale.priceText : '',
      lastSale: s.summary.lastSale ? `@${s.summary.lastSale.winner || '?'} ${s.summary.lastSale.priceText || ''}`.trim() : '',
      needsReview: s.review.length,
      onAir: s.onAir ? s.onAir.name : '',
      segment: s.show.segment || '',
      currentItem: s.currentAuction ? s.currentAuction.item || '' : '',
    };
  }

  close() {
    clearInterval(this._tick);
    clearTimeout(this._stateTimer);
    for (const c of this.clients) c.res.end();
  }
}

function cueSummary(cue) {
  const p = cue.payload || {};
  return [p.winner || p.user, p.price, p.label, p.count != null ? String(p.count) : null, p.title, p.item].filter(Boolean).join(' · ');
}

module.exports = { App, fingerprint };
