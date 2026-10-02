// On-page debug panel for the Phase 1 probe. Lives in a closed shadow root so
// Whatnot's CSS can't affect it and it can't affect Whatnot.
// Toggle visibility with Alt+Shift+W.
//
// All page-derived text is inserted with textContent, never innerHTML.

(function (root) {
  const WNSC = (root.WNSC = root.WNSC || {});

  const LABELS = {
    page: 'Show page',
    item: 'Item',
    image: 'Image',
    timer: 'Timer',
    bids: 'Bid count',
    leader: 'Leader',
    winner: 'Winner',
    nextBid: 'Next bid (button)',
    price: 'Current price',
    chatPanel: 'Chat panel',
    chat: 'Chat messages',
  };

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: 340px;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #e8e8e8;
      background: rgba(16,16,20,.94); border: 1px solid #333; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0,0,0,.5); max-height: calc(100vh - 24px); overflow: auto; }
    .wrap.hidden { display: none; }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #333;
      position: sticky; top: 0; background: #101014; }
    header b { flex: 1; letter-spacing: .05em; }
    .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    section { padding: 8px 10px; border-bottom: 1px solid #2a2a2a; }
    h4 { margin: 0 0 6px; font-size: 10px; color: #999; letter-spacing: .1em; text-transform: uppercase; }
    .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
    .row span:first-child { color: #aaa; white-space: nowrap; }
    .row span:last-child { text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ok { color: #3ddc84; } .warn { color: #ffb020; } .bad { color: #ff5c5c; } .grey { color: #888; }
    .bg-ok { background: #3ddc84; } .bg-warn { background: #ffb020; } .bg-bad { background: #ff5c5c; }
    .ev { padding: 2px 0; border-bottom: 1px dotted #2a2a2a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev.sale { color: #3ddc84; font-weight: bold; } .ev.sale_suppressed { color: #ffb020; }
    .ev.auction_extended { color: #6cb6ff; } .ev.giveaway_result { color: #d68cff; }
    .btns { display: flex; flex-wrap: wrap; gap: 6px; }
    button { font: inherit; color: #eee; background: #2a2a33; border: 1px solid #444; border-radius: 4px;
      padding: 3px 8px; cursor: pointer; }
    button:hover { background: #3a3a45; }
    .body.collapsed { display: none; }
    .muted { color: #888; }
  `;

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'onclick') el.addEventListener('click', v);
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  function row(label, value, cls) {
    return h('div', { class: 'row' }, [h('span', {}, label), h('span', { class: cls || '' }, value == null || value === '' ? '—' : String(value))]);
  }

  function healthText(hs, now) {
    if (hs.state === 'ok') return ['DETECTED', 'ok'];
    if (hs.state === 'not_configured') return ['NOT CONFIGURED', 'grey'];
    if (hs.state === 'guessed') return ['GUESSED FROM TEXT', 'warn'];
    if (hs.state === 'ambiguous') return ['AMBIGUOUS (2+ amounts)', 'bad'];
    if (hs.state === 'unparsed') return ['FOUND, CAN’T PARSE', 'bad'];
    if (hs.lastOkAt) return [`NOT NOW (seen ${Math.round((now - hs.lastOkAt) / 1000)}s ago)`, 'warn'];
    return ['NOT DETECTED', 'bad'];
  }

  function fmtMoney(m) {
    if (!m) return null;
    const sym = { GBP: '£', USD: '$', EUR: '€' }[m.currency] || '';
    return sym + (Number.isInteger(m.amount) ? m.amount : m.amount.toFixed(2));
  }

  function summarize(evt) {
    const d = evt.data || {};
    const t = new Date(evt.ts).toLocaleTimeString();
    switch (evt.type) {
      case 'sale':
        return `${t} SALE @${d.winner || '?'} ${d.price != null ? fmtMoney({ amount: d.price, currency: d.currency }) : '£?'} ${d.item || '?'} [${d.confidence}${d.warnings.length ? ': ' + d.warnings.join(',') : ''}]`;
      case 'sale_suppressed':
        return `${t} DUPLICATE SUPPRESSED @${d.winner || '?'} (${d.reason})`;
      case 'giveaway_result':
        return `${t} GIVEAWAY → @${d.winner || '?'}`;
      case 'auction_start':
        return `${t} START ${d.item || '(no title yet)'}`;
      case 'auction_extended':
        return `${t} EXTENDED ${d.fromSec}s → ${d.toSec}s`;
      case 'auction_no_sale':
        return `${t} NO SALE ${d.item || ''}`;
      case 'bid':
        return `${t} bid ${d.bids != null ? '#' + d.bids : ''} @${d.leader || '?'}`;
      case 'leader_changed':
        return `${t} leader @${d.previousLeader} → @${d.leader}`;
      case 'chat_message':
        return `${t} chat${d.backlog ? ' (backlog)' : ''} @${d.user || '?'}: ${d.text}`;
      case 'probe_status':
        return `${t} health changed`;
      default:
        return `${t} ${evt.type}`;
    }
  }

  WNSC.createPanel = function createPanel({ getState, actions }) {
    const events = [];
    let renderQueued = false;
    let collapsed = false;
    let showBids = false;

    const host = document.createElement('wnsc-probe');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.appendChild(h('style', {}, CSS));
    const wrap = h('div', { class: 'wrap' });
    shadow.appendChild(wrap);

    function mount() {
      if (!host.isConnected) document.documentElement.appendChild(host);
    }

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.altKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) wrap.classList.toggle('hidden');
      },
      true
    );

    function render() {
      renderQueued = false;
      mount();
      const s = getState();
      const now = Date.now();
      const a = s.auction;
      const snap = s.snapshot;
      const pageOk = s.health.page.state === 'ok';
      const anyBad = s.fields.some((f) => ['item', 'timer', 'leader'].includes(f) && s.health[f].state === 'unparsed');

      wrap.textContent = '';
      const header = h('header', {}, [
        h('span', { class: `dot ${pageOk ? (anyBad ? 'bg-warn' : 'bg-ok') : 'bg-bad'}` }),
        h('b', {}, `WHATNOT PROBE${s.mock ? ' (MOCK)' : ''}`),
        h('button', { onclick: () => { collapsed = !collapsed; render(); } }, collapsed ? '+' : '–'),
      ]);
      wrap.appendChild(header);
      const body = h('div', { class: `body${collapsed ? ' collapsed' : ''}` });
      wrap.appendChild(body);

      // Health
      const hs = h('section', {}, [h('h4', {}, `Detection — selectors ${s.selectorsVersion}`)]);
      for (const f of s.fields) {
        const [txt, cls] = healthText(s.health[f], now);
        hs.appendChild(row(LABELS[f] || f, txt, cls));
      }
      if (s.invalidSelectors.length) hs.appendChild(row('Invalid selectors', s.invalidSelectors.join(', '), 'bad'));
      body.appendChild(hs);

      // Current auction
      const cur = h('section', {}, [h('h4', {}, 'Current auction')]);
      if (a) {
        cur.appendChild(row('Item', a.title));
        cur.appendChild(row('Lot #', a.lotNumber));
        cur.appendChild(row('Condition', a.condition));
        cur.appendChild(row('Phase', a.phase + (a.isGiveaway ? ' (giveaway)' : ''), a.phase === 'sold' ? 'ok' : ''));
        cur.appendChild(row('Timer', snap && snap.timerText ? `${snap.timerText} (${a.timerSec}s)` : null));
        cur.appendChild(row('Bids', a.bidCount));
        cur.appendChild(row('Leader', a.leader ? '@' + a.leader : null));
        cur.appendChild(row('Price (selector)', fmtMoney(a.currentPrice) || 'not set up', a.currentPrice ? '' : 'warn'));
        cur.appendChild(row('Price (text guess)', fmtMoney(a.priceGuess), 'warn'));
        cur.appendChild(row('Next bid (button)', fmtMoney(a.nextBid)));
        cur.appendChild(row('Extensions', a.extensions));
        cur.appendChild(row('Status text', snap && snap.status.text, 'muted'));
      } else {
        cur.appendChild(h('div', { class: 'muted' }, 'No auction detected yet.'));
      }
      body.appendChild(cur);

      // Session counters
      body.appendChild(
        h('section', {}, [
          h('h4', {}, 'This session (probe memory only)'),
          row('Auctions seen', s.stats.auctions),
          row('Sales detected', s.stats.sales, 'ok'),
          row('Duplicates suppressed', s.stats.suppressed, s.stats.suppressed ? 'warn' : ''),
          row('Giveaways', s.stats.giveaways),
        ])
      );

      // Events
      const evs = h('section', {}, [
        h('h4', {}, 'Events'),
        h('label', { class: 'muted' }, [
          (() => {
            const cb = h('input', { type: 'checkbox' });
            cb.checked = showBids;
            cb.addEventListener('change', () => { showBids = cb.checked; render(); });
            return cb;
          })(),
          ' show every update, bid & chat',
        ]),
      ]);
      const NOISY = ['auction_update', 'bid', 'leader_changed', 'chat_message', 'probe_status'];
      const filtered = events.filter((e) => showBids || !NOISY.includes(e.type)).slice(0, 14);
      for (const e of filtered) evs.appendChild(h('div', { class: `ev ${e.type}`, title: JSON.stringify(e.data) }, summarize(e)));
      if (!filtered.length) evs.appendChild(h('div', { class: 'muted' }, 'None yet.'));
      body.appendChild(evs);

      // Chat
      const chat = h('section', {}, [h('h4', {}, 'Recent chat (not sent anywhere)')]);
      for (const m of s.chat.slice(0, 5)) chat.appendChild(h('div', { class: 'ev' }, `@${m.user || '?'}: ${m.text}`));
      if (!s.chat.length) chat.appendChild(h('div', { class: 'muted' }, 'None yet.'));
      body.appendChild(chat);

      // Tools
      body.appendChild(
        h('section', {}, [
          h('h4', {}, 'Tools'),
          h('div', { class: 'btns' }, [
            h('button', { onclick: () => { actions.cardText(); } }, 'Card text'),
            h('button', { onclick: () => { actions.testIds(); } }, 'Test IDs'),
            h('button', { onclick: () => actions.exportLog() }, 'Download log'),
            h('button', { onclick: () => { actions.clearLog(); render(); } }, 'Clear'),
          ]),
          h('div', { class: 'muted', style: 'margin-top:6px' }, 'Alt+Shift+W hides this panel. Card text / Test IDs output goes to the log and the DevTools console.'),
        ])
      );
    }

    return {
      onEvent(evt) {
        events.unshift(evt);
        if (events.length > 200) events.pop();
        this.requestRender();
      },
      clearEvents() {
        events.length = 0;
      },
      requestRender() {
        if (renderQueued) return;
        renderQueued = true;
        setTimeout(render, 200);
      },
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
