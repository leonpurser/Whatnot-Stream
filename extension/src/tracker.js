// Auction lifecycle state machine. Pure logic: takes DOM snapshots in,
// returns normalized events out. No DOM access, unit-tested in Node.
//
// Duplicate protection, in order of importance:
//   1. Lifecycle: each auction instance can produce at most ONE sale.
//      MutationObserver firing 50 times while "dave won!" is on screen
//      changes nothing, because the instance is already marked sold.
//   2. Confirmation: "won" must be stable for TUNING.saleConfirmMs.
//   3. Fingerprint window: identical winner+item+price within
//      TUNING.saleDedupWindowMs is suppressed (and logged as suppressed),
//      in case the lifecycle logic ever wrongly splits one auction in two.

(function (root) {
  const WNSC = (root.WNSC = root.WNSC || {});
  const P = typeof module !== 'undefined' && module.exports ? require('./parse.js') : WNSC;

  const SCHEMA_VERSION = 1;

  const DEFAULT_TUNING = {
    saleConfirmMs: 300,
    saleDedupWindowMs: 8000,
    extensionJumpSec: 2,
    trustPriceGuess: false,
  };

  function makeEvent(type, ts, auctionId, data) {
    return { v: SCHEMA_VERSION, type, ts, source: 'whatnot-dom', auctionId: auctionId || null, data: data || {} };
  }

  class AuctionTracker {
    constructor(tuning) {
      this.t = Object.assign({}, DEFAULT_TUNING, tuning || {});
      this.auction = null;
      this.counter = 0;
      this.recentSales = []; // { fp, ts }
      this.nextCheckAt = null; // content script re-reads at this time if set
      this.stats = { auctions: 0, sales: 0, suppressed: 0, giveaways: 0 };
    }

    ingest(s) {
      const ev = [];
      this.nextCheckAt = null;
      const hasCard = !!(s.title || s.timerSec != null || (s.status && s.status.kind !== 'none'));

      if (!hasCard) {
        if (this.auction && !this.auction.hidden) {
          this.auction.hidden = true;
          ev.push(makeEvent('auction_hidden', s.ts, this.auction.id, {}));
        }
        return ev;
      }

      let a = this.auction;
      if (this._isNewAuction(a, s)) {
        a = this._start(s);
        ev.push(makeEvent('auction_start', s.ts, a.id, this._public(a)));
      } else if (a.hidden) {
        a.hidden = false;
      }

      this._update(a, s, ev);
      this._handleStatus(a, s, ev);
      return ev;
    }

    _isNewAuction(a, s) {
      if (!a) return true;
      // Different (non-empty) title = different item. Empty titles are
      // ignored so a momentary re-render can't split an auction.
      if (s.title && a.title && P.normTitle(s.title) !== P.normTitle(a.title)) return true;
      // Same title run again after it sold: status no longer "won" and a
      // running timer or a new leader appears.
      if (a.sold && s.status.kind !== 'won' && ((s.timerSec != null && s.timerSec > 0) || s.status.kind === 'leading')) {
        return true;
      }
      // Bid count went down = item was re-run.
      if (!a.sold && a.bidCount != null && s.bidCount != null && s.bidCount < a.bidCount) return true;
      return false;
    }

    _start(s) {
      this.counter += 1;
      this.stats.auctions += 1;
      const a = {
        id: `a${s.ts.toString(36)}-${this.counter}`,
        firstSeenTs: s.ts,
        // If the first thing we ever see is a finished auction (page reload
        // after the sale), we did not witness it live.
        observedLive: s.status.kind !== 'won',
        // Identity fields are filled immediately so auction_start carries them.
        title: s.title || null,
        lotNumber: s.lotNumber || null,
        condition: s.condition || null,
        imageUrl: s.imageUrl || null,
        timerSec: null,
        bidCount: null,
        leader: null,
        nextBid: null,
        currentPrice: null,
        priceGuess: null,
        isGiveaway: !!s.isGiveaway,
        phase: 'pending',
        sold: false,
        hidden: false,
        pendingWin: null,
        extensions: 0,
      };
      this.auction = a;
      return a;
    }

    _public(a) {
      return {
        item: a.title,
        lotNumber: a.lotNumber,
        condition: a.condition,
        imageUrl: a.imageUrl,
        phase: a.phase,
        timerSec: a.timerSec,
        bids: a.bidCount,
        leader: a.leader,
        price: a.currentPrice ? a.currentPrice.amount : null,
        priceGuess: a.priceGuess ? a.priceGuess.amount : null,
        nextBid: a.nextBid ? a.nextBid.amount : null,
        currency: (a.currentPrice || a.nextBid || {}).currency || null,
        isGiveaway: a.isGiveaway,
        extensions: a.extensions,
      };
    }

    _update(a, s, ev) {
      const before = JSON.stringify(this._public(a));
      const prevTimer = a.timerSec;
      const prevBids = a.bidCount;
      const prevLeader = a.leader;
      const prevNext = a.nextBid;

      if (s.title) a.title = s.title;
      if (s.lotNumber) a.lotNumber = s.lotNumber;
      if (s.condition) a.condition = s.condition;
      if (s.imageUrl) a.imageUrl = s.imageUrl;
      if (s.isGiveaway) a.isGiveaway = true;
      if (s.bidCount != null) a.bidCount = s.bidCount;
      if (s.nextBid) a.nextBid = s.nextBid;
      if (s.currentPrice) a.currentPrice = s.currentPrice;
      if (s.priceGuess) a.priceGuess = s.priceGuess;
      if (s.status.kind === 'leading' && s.status.user) a.leader = s.status.user;

      if (s.timerSec != null) {
        if (!a.sold && prevTimer != null && s.timerSec - prevTimer >= this.t.extensionJumpSec) {
          a.extensions += 1;
          ev.push(makeEvent('auction_extended', s.ts, a.id, { fromSec: prevTimer, toSec: s.timerSec, extensions: a.extensions }));
        }
        a.timerSec = s.timerSec;
        if (!a.sold) {
          if (s.timerSec > 0) a.phase = 'live';
          else if (a.phase !== 'no_sale') a.phase = 'ended';
        }
      }

      // Bid detection. Prefer bid count; fall back to leader / next-bid changes.
      const bidCountUp = prevBids != null && a.bidCount != null && a.bidCount > prevBids;
      const fallback =
        a.bidCount == null &&
        ((a.leader && prevLeader && P.normUser(a.leader) !== P.normUser(prevLeader)) ||
          (a.nextBid && prevNext && a.nextBid.amount > prevNext.amount));
      if (!a.sold && (bidCountUp || fallback)) {
        ev.push(
          makeEvent('bid', s.ts, a.id, {
            bids: a.bidCount,
            delta: bidCountUp ? a.bidCount - prevBids : null,
            leader: a.leader,
            previousLeader: prevLeader,
            nextBid: a.nextBid ? a.nextBid.amount : null,
            timerSec: a.timerSec,
          })
        );
      }

      if (a.leader && prevLeader && P.normUser(a.leader) !== P.normUser(prevLeader)) {
        ev.push(makeEvent('leader_changed', s.ts, a.id, { leader: a.leader, previousLeader: prevLeader }));
      }

      if (JSON.stringify(this._public(a)) !== before) {
        ev.push(makeEvent('auction_update', s.ts, a.id, this._public(a)));
      }
    }

    _handleStatus(a, s, ev) {
      if (a.sold) return;

      if (s.status.kind === 'no_sale') {
        if (a.phase !== 'no_sale') {
          a.phase = 'no_sale';
          ev.push(makeEvent('auction_no_sale', s.ts, a.id, { item: a.title, statusText: s.status.text }));
        }
        return;
      }

      if (s.status.kind !== 'won') {
        a.pendingWin = null;
        return;
      }

      const key = P.normUser(s.status.user) || (s.status.you ? '__you__' : '__unknown__');
      if (!a.pendingWin || a.pendingWin.key !== key) {
        a.pendingWin = { key, since: s.ts };
      }
      if (s.ts - a.pendingWin.since < this.t.saleConfirmMs) {
        this.nextCheckAt = a.pendingWin.since + this.t.saleConfirmMs + 20;
        return;
      }
      this._finalize(a, s, ev);
    }

    _finalize(a, s, ev) {
      a.sold = true;
      a.pendingWin = null;
      a.phase = a.isGiveaway ? 'giveaway_done' : 'sold';

      const winner = s.status.user || null;
      let price = null;
      let priceSource = null;
      if (s.currentPrice || a.currentPrice) {
        price = s.currentPrice || a.currentPrice;
        priceSource = 'price-selector';
      } else if (s.status.price) {
        price = s.status.price;
        priceSource = 'status-text';
      } else if (s.priceGuess || a.priceGuess) {
        // Prefer the value on screen at the moment of the win.
        price = s.priceGuess || a.priceGuess;
        priceSource = 'text-guess';
      }

      const warnings = [];
      if (!winner) warnings.push(s.status.you ? 'winner_is_logged_in_user' : 'winner_unknown');
      if (!price && !a.isGiveaway) warnings.push('price_unknown');
      if (priceSource === 'text-guess' && !this.t.trustPriceGuess) warnings.push('price_is_guess');
      if (winner && a.leader && P.normUser(winner) !== P.normUser(a.leader)) warnings.push('winner_differs_from_last_leader');
      if (price && a.nextBid && price.amount >= a.nextBid.amount) warnings.push('price_not_below_next_bid');
      if (!a.observedLive) warnings.push('not_observed_live');
      if (!a.title) warnings.push('item_unknown');

      const data = {
        item: a.title,
        lotNumber: a.lotNumber,
        condition: a.condition,
        imageUrl: a.imageUrl,
        winner,
        price: price ? price.amount : null,
        currency: price ? price.currency : null,
        priceSource,
        bids: a.bidCount,
        extensions: a.extensions,
        observedLive: a.observedLive,
        warnings,
        confidence: warnings.length ? 'low' : 'ok',
        statusText: s.status.text,
      };

      const fp = [P.normUser(winner), P.normTitle(a.title), price ? price.amount : ''].join('|');
      this.recentSales = this.recentSales.filter((r) => s.ts - r.ts < this.t.saleDedupWindowMs);
      if (this.recentSales.some((r) => r.fp === fp)) {
        this.stats.suppressed += 1;
        ev.push(makeEvent('sale_suppressed', s.ts, a.id, Object.assign({ reason: 'duplicate_fingerprint', fingerprint: fp }, data)));
        return;
      }
      this.recentSales.push({ fp, ts: s.ts });

      if (a.isGiveaway) {
        this.stats.giveaways += 1;
        ev.push(makeEvent('giveaway_result', s.ts, a.id, data));
      } else {
        this.stats.sales += 1;
        ev.push(makeEvent('sale', s.ts, a.id, data));
      }
    }
  }

  // Chat de-duplication for re-rendered nodes. The content script's
  // WeakSet of seen DOM nodes is the primary guard; this catches the same
  // message being re-mounted as a new node shortly afterwards.
  class ChatDeduper {
    constructor(windowMs) {
      this.windowMs = windowMs || 3000;
      this.recent = new Map();
    }
    accept(user, text, ts) {
      for (const [k, t] of this.recent) if (ts - t >= this.windowMs) this.recent.delete(k);
      const key = P.normUser(user) + '\u0000' + P.normText(text);
      if (this.recent.has(key)) return false;
      this.recent.set(key, ts);
      return true;
    }
  }

  Object.assign(WNSC, { SCHEMA_VERSION, AuctionTracker, ChatDeduper, makeEvent });

  if (typeof module !== 'undefined' && module.exports) module.exports = WNSC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
