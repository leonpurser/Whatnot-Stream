// Whatnot DOM probe — content script.
//
// Read-only: this script never clicks, types, or changes anything on the
// Whatnot page except adding its own debug panel (inside a shadow root).
// It does not read cookies, storage, network traffic or tokens.

(function () {
  const W = globalThis.WNSC;
  if (!W || W.__probeStarted) return;
  W.__probeStarted = true;

  const isMock = document.documentElement.hasAttribute('data-wnsc-mock');
  const SEL = Object.assign({}, W.SELECTORS, isMock ? W.DEV_OVERRIDES : {});
  const PAT = W.PATTERNS;
  const TUN = W.TUNING;
  const reBidCount = W.compile(PAT.bidCount);
  const reGiveaway = W.compile(PAT.giveawayTitle);
  const reChatUser = W.compile(PAT.chatUserHref);
  const reShowId = W.compile(PAT.showIdHref);

  const tracker = new W.AuctionTracker(TUN);
  const chatDedup = new W.ChatDeduper(TUN.chatRepeatWindowMs);
  const seenChatNodes = new WeakSet();

  const log = []; // ring buffer of emitted events
  const chatRecent = [];
  let seq = 0;
  let lastReadAt = 0;
  let trailingTimer = null;
  let recheckTimer = null;
  let chatDirty = true;
  let chatPrimed = false;
  let lastSnapshot = null;
  let lastHealthKey = '';
  const invalidSelectors = new Set();

  // ---------------------------------------------------------------- health
  // state: ok | missing | unparsed | not_configured
  const FIELDS = ['page', 'item', 'image', 'timer', 'bids', 'leader', 'winner', 'nextBid', 'price', 'chatPanel', 'chat'];
  const health = {};
  for (const f of FIELDS) health[f] = { state: 'missing', lastOkAt: 0 };

  function setHealth(field, state, now) {
    const h = health[field];
    h.state = state;
    if (state === 'ok') h.lastOkAt = now;
  }

  // ---------------------------------------------------------------- dom helpers
  function q(list, rootEl) {
    for (const sel of list || []) {
      try {
        const el = (rootEl || document).querySelector(sel);
        if (el) return el;
      } catch (e) {
        invalidSelectors.add(sel);
      }
    }
    return null;
  }

  function qa(list, rootEl) {
    for (const sel of list || []) {
      try {
        const els = (rootEl || document).querySelectorAll(sel);
        if (els.length) return els;
      } catch (e) {
        invalidSelectors.add(sel);
      }
    }
    return [];
  }

  function txt(el) {
    return el ? W.normText(el.textContent) : '';
  }

  // Text of every text node under el, joined with a separator, so that
  // "12 Bids" and "00:07" in sibling elements don't merge into "12 Bids00:07".
  function segmentedText(el, maxLen) {
    if (!el) return '';
    const out = [];
    let len = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = W.normText(n.nodeValue);
      if (!t) continue;
      out.push(t);
      len += t.length + 3;
      if (maxLen && len > maxLen) break;
    }
    return out.join(' | ');
  }

  // Smallest ancestor of the title that also contains the timer/status, i.e.
  // the product card. Used to scan for bid count / condition text.
  function findCardRoot(anchor, others) {
    if (!anchor) return null;
    let el = anchor;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      if (others.every((o) => !o || el.contains(o))) return el;
      el = el.parentElement;
    }
    return anchor.parentElement;
  }

  // ---------------------------------------------------------------- snapshot
  function readSnapshot(now) {
    const titleEl = q(SEL.productTitle);
    const imageEl = q(SEL.productImage);
    const timerEl = q(SEL.timer);
    const statusEl = q(SEL.winningStatus);
    const bidBtnEl = q(SEL.bidButton);
    const priceEl = q(SEL.currentPrice);
    const bidCountEl = q(SEL.bidCount);
    const giveawayEl = q(SEL.giveawayIndicator);

    const card = findCardRoot(titleEl || timerEl, [titleEl, timerEl, statusEl]);
    const cardText = card ? segmentedText(card, 2000) : '';

    const title = txt(titleEl) || null;
    const timerText = txt(timerEl);
    const timerSec = timerEl ? W.parseTimer(timerText) : null;
    const status = W.parseStatus(txt(statusEl), PAT);
    const bidBtnText = txt(bidBtnEl);
    const nextBid = bidBtnEl ? W.parseMoney(bidBtnText) : null;
    const priceText = txt(priceEl);
    const currentPrice = priceEl ? W.parseMoney(priceText) : null;

    let bidCount = null;
    if (bidCountEl) bidCount = W.parseBidCount(txt(bidCountEl), reBidCount);
    else if (cardText) bidCount = W.parseBidCount(cardText, reBidCount);
    // A product card with a running timer and no "N Bids" text most likely means 0 bids,
    // but we don't guess: null = unknown.

    let imageUrl = null;
    if (imageEl) {
      const img = imageEl.tagName === 'IMG' ? imageEl : imageEl.querySelector('img');
      imageUrl = (img && (img.currentSrc || img.src)) || null;
    }

    const isGiveaway = !!giveawayEl || (title ? reGiveaway.test(title) : false);

    const snap = {
      ts: now,
      title,
      lotNumber: title ? W.parseLotNumber(title, PAT.lotNumber) : null,
      condition: W.detectCondition(cardText, PAT.conditions),
      imageUrl,
      timerSec,
      timerText,
      bidCount,
      status,
      nextBid,
      currentPrice,
      isGiveaway,
    };

    // Health. 'unparsed' = element has text we can't understand (selector or
    // format changed). An empty / absent element is just 'missing'.
    const onShow = reShowId.test(location.pathname) || isMock;
    setHealth('page', onShow ? 'ok' : 'missing', now);
    setHealth('item', title ? 'ok' : 'missing', now);
    setHealth('image', imageUrl ? 'ok' : imageEl ? 'unparsed' : 'missing', now);
    setHealth('timer', timerSec != null ? 'ok' : timerText ? 'unparsed' : 'missing', now);
    setHealth('bids', bidCount != null ? 'ok' : 'missing', now);
    setHealth(
      'leader',
      status.kind === 'leading' ? (status.user ? 'ok' : 'unparsed') : statusEl && status.kind === 'unknown' ? 'unparsed' : 'missing',
      now
    );
    setHealth('winner', status.kind === 'won' ? (status.user ? 'ok' : 'unparsed') : 'missing', now);
    setHealth('nextBid', nextBid ? 'ok' : bidBtnText ? 'unparsed' : 'missing', now);
    setHealth('price', !SEL.currentPrice.length ? 'not_configured' : currentPrice ? 'ok' : priceText ? 'unparsed' : 'missing', now);

    snap.raw = { title, timer: timerText, status: status.text, bidButton: bidBtnText, price: priceText };
    return snap;
  }

  // ---------------------------------------------------------------- chat
  function extractChat(el) {
    const a = q(SEL.chatAvatarLink, el);
    let user = null;
    if (a) {
      const m = (a.getAttribute('href') || '').match(reChatUser);
      if (m) {
        try {
          user = decodeURIComponent(m[1]);
        } catch (e) {
          user = m[1];
        }
      }
      if (!user) user = W.normText(a.getAttribute('aria-label')) || txt(a) || null;
    }
    let text = segmentedText(el, TUN.maxChatTextLength * 2).replace(/ \| /g, ' ');
    if (user && text.toLowerCase().startsWith(user.toLowerCase())) text = text.slice(user.length).trim();
    return { user: W.cleanUser(user), text: text.slice(0, TUN.maxChatTextLength) };
  }

  function readChat(now) {
    const panel = q(SEL.chatPanel);
    setHealth('chatPanel', panel ? 'ok' : 'missing', now);
    const nodes = qa(SEL.chatMessage, panel || document);
    if (!nodes.length) {
      setHealth('chat', 'missing', now);
      return;
    }
    let parsedAny = false;
    for (const el of nodes) {
      if (seenChatNodes.has(el)) continue;
      seenChatNodes.add(el);
      const msg = extractChat(el);
      if (!msg.text && !msg.user) continue;
      parsedAny = parsedAny || !!msg.user;
      if (!chatDedup.accept(msg.user, msg.text, now)) continue;
      const evt = W.makeEvent('chat_message', now, null, {
        id: `c${now.toString(36)}-${seq + 1}`,
        user: msg.user,
        text: msg.text,
        // Messages already on screen when the probe attached are "backlog":
        // shown in the dashboard but never treated as live activity.
        backlog: !chatPrimed,
      });
      emit(evt);
      chatRecent.unshift(evt.data);
      if (chatRecent.length > 8) chatRecent.pop();
    }
    chatPrimed = true;
    // Messages present: ok once at least one username has ever been parsed.
    setHealth('chat', parsedAny || health.chat.lastOkAt ? 'ok' : 'unparsed', now);
  }

  // ---------------------------------------------------------------- events
  function emit(evt) {
    evt.seq = ++seq;
    log.push(evt);
    if (log.length > TUN.maxLogEntries) log.splice(0, log.length - TUN.maxLogEntries);
    if (evt.type !== 'auction_update' && evt.type !== 'chat_message') {
      console.info('[WNSC]', evt.type, evt.data);
    }
    panel.onEvent(evt);
    // PHASE 2: chrome.runtime.sendMessage({ kind: 'wnsc-event', event: evt });
  }

  function healthSummary() {
    const out = {};
    for (const f of FIELDS) out[f] = health[f].state;
    return out;
  }

  function read() {
    const now = Date.now();
    lastReadAt = now;
    const snap = readSnapshot(now);
    lastSnapshot = snap;
    for (const e of tracker.ingest(snap)) {
      // Raw text is attached to transition events for Phase 1 verification only.
      if (e.type === 'sale' || e.type === 'sale_suppressed' || e.type === 'giveaway_result' || e.type === 'auction_start') {
        e.data.raw = snap.raw;
      }
      emit(e);
    }
    if (chatDirty) {
      chatDirty = false;
      readChat(now);
    }
    if (tracker.nextCheckAt) {
      clearTimeout(recheckTimer);
      recheckTimer = setTimeout(scheduleRead, Math.max(0, tracker.nextCheckAt - now));
    }
    const hk = JSON.stringify(healthSummary());
    if (hk !== lastHealthKey) {
      lastHealthKey = hk;
      emit(W.makeEvent('probe_status', now, null, { health: healthSummary(), selectorsVersion: SEL.version, invalidSelectors: [...invalidSelectors] }));
    }
    panel.requestRender();
  }

  // Leading + trailing throttle: read now if we haven't recently, and always
  // do one more read after a burst so the final state is captured.
  function scheduleRead() {
    const since = Date.now() - lastReadAt;
    if (since >= TUN.minReadIntervalMs) {
      read();
    } else if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        read();
      }, TUN.minReadIntervalMs - since);
    }
  }

  const observer = new MutationObserver((records) => {
    if (!chatDirty) {
      const chatPanel = q(SEL.chatPanel);
      for (const r of records) {
        if (!chatPanel || chatPanel.contains(r.target)) {
          chatDirty = true;
          break;
        }
      }
    }
    scheduleRead();
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(() => {
      chatDirty = true;
      scheduleRead();
    }, TUN.heartbeatMs);
    emit(
      W.makeEvent('probe_started', Date.now(), null, {
        selectorsVersion: SEL.version,
        mock: isMock,
        showId: (location.pathname.match(reShowId) || [])[1] || null,
      })
    );
    read();
  }

  // ---------------------------------------------------------------- debug tools
  function exportLog() {
    const payload = {
      exportedAt: new Date().toISOString(),
      // Path only. No query string, cookies or storage are ever included.
      page: location.origin + location.pathname,
      selectorsVersion: SEL.version,
      tuning: TUN,
      trackerStats: tracker.stats,
      health: health,
      events: log,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wnsc-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Text of the product card, segment by segment. Use this during a live
  // auction / right after a win to find where the current price lives.
  function cardTextDump() {
    const titleEl = q(SEL.productTitle);
    const timerEl = q(SEL.timer);
    const statusEl = q(SEL.winningStatus);
    const card = findCardRoot(titleEl || timerEl || statusEl, [titleEl, timerEl, statusEl]);
    const segments = card ? segmentedText(card, 4000) : '(product card not found)';
    const testids = card ? [...card.querySelectorAll('[data-testid]')].map((e) => `${e.getAttribute('data-testid')} = "${txt(e).slice(0, 80)}"`) : [];
    const evt = W.makeEvent('debug_card_text', Date.now(), tracker.auction && tracker.auction.id, { segments, testids });
    emit(evt);
    console.info('[WNSC] card text:\n' + segments + '\n\n' + testids.join('\n'));
    return evt;
  }

  // Names (not contents) of every data-testid on the page. Safe to share.
  function testIdInventory() {
    const counts = {};
    for (const el of document.querySelectorAll('[data-testid]')) {
      const k = el.getAttribute('data-testid');
      counts[k] = (counts[k] || 0) + 1;
    }
    const evt = W.makeEvent('debug_testids', Date.now(), null, { counts });
    emit(evt);
    console.info('[WNSC] data-testid inventory', counts);
    return evt;
  }

  // ---------------------------------------------------------------- panel
  const panel = W.createPanel({
    getState: () => ({
      health,
      fields: FIELDS,
      auction: tracker.auction,
      stats: tracker.stats,
      snapshot: lastSnapshot,
      chat: chatRecent,
      mock: isMock,
      selectorsVersion: SEL.version,
      invalidSelectors: [...invalidSelectors],
    }),
    actions: {
      exportLog,
      cardText: cardTextDump,
      testIds: testIdInventory,
      clearLog: () => {
        log.length = 0;
        panel.clearEvents();
      },
    },
  });

  // Exposed for poking at from DevTools (select the extension's context in the
  // console's context dropdown).
  W.probe = { read, exportLog, cardTextDump, testIdInventory, tracker, health, log };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
