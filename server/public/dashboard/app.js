// Producer dashboard. Live state arrives over Server-Sent Events; actions are
// plain POSTs. Everything from Whatnot (usernames, chat, titles) is escaped.

(function () {
  const $ = (s) => document.querySelector(s);
  let S = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const time = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
  const ago = (ts) => (ts ? `${Math.max(0, Math.round((Date.now() - ts) / 1000))}s ago` : 'never');

  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), err ? 4000 : 1800);
  }

  async function post(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    } catch (e) {
      toast(e.message, true);
      throw e;
    }
  }

  // ------------------------------------------------------------------ render
  const HEALTH_LABELS = { item: 'Item', price: 'Price', winner: 'Winner', leader: 'Leader', timer: 'Timer', chat: 'Chat' };

  function renderLights() {
    const c = S.connections;
    const r = c.reader;
    const items = [];
    items.push([r.connected ? 'ok' : 'bad', 'WHATNOT', r.connected ? 'connected' : `offline (${ago(r.lastSeenTs)})`]);
    items.push([c.overlays > 0 ? 'ok' : 'bad', 'OBS GRAPHICS', c.overlays > 0 ? `${c.overlays} connected` : 'not connected']);
    const h = (r.connected && r.health) || {};
    for (const [k, label] of Object.entries(HEALTH_LABELS)) {
      const st = h[k];
      let cls = 'grey';
      let txt = 'unknown';
      if (st === 'ok') [cls, txt] = ['ok', 'detected'];
      else if (st === 'guessed') [cls, txt] = ['warn', 'guessed'];
      else if (st === 'missing') [cls, txt] = ['warn', 'not now'];
      else if (st === 'unparsed' || st === 'ambiguous') [cls, txt] = ['bad', st === 'ambiguous' ? 'ambiguous' : "can't read"];
      else if (st === 'not_configured') [cls, txt] = ['grey', 'not set up'];
      items.push([cls, label.toUpperCase(), txt]);
    }
    $('#lights').innerHTML = items.map(([cls, l, t]) => `<div class="light ${cls}"><i></i>${esc(l)} <span>${esc(t)}</span></div>`).join('');
  }

  function renderHeader() {
    const m = $('#mode');
    m.textContent = S.mode === 'rehearsal' ? 'REHEARSAL' : 'LIVE';
    m.className = 'mode ' + S.mode;
    $('#showname').textContent = S.show.id + (S.show.segment ? ` · segment: ${S.show.segment}` : '') + (S.show.endedAt ? ' · ENDED' : '');
    const oa = $('#onair');
    oa.textContent = S.onAir ? `ON AIR: ${S.onAir.name.replace(/_/g, ' ').toUpperCase()}` : 'OFF AIR';
    oa.className = 'onair' + (S.onAir ? ' on' : '');
    $('#testcard').hidden = S.mode !== 'rehearsal';
    const b = $('#banner');
    if (S.mode === 'rehearsal') {
      b.hidden = false;
      b.textContent = 'REHEARSAL MODE: stats below are rehearsal-only and are thrown away when you switch back. Graphics still go to OBS.';
    } else if (!S.connections.reader.connected) {
      b.hidden = false;
      b.textContent = 'Whatnot probe is not connected. Open the show in Chrome (with the extension) and keep that window visible. Graphics can still be triggered manually.';
    } else b.hidden = true;
  }

  function renderAuction() {
    const a = S.currentAuction;
    if (!a) return ($('#auction').innerHTML = '<div class="empty">No auction seen yet.</div>');
    const cur = S.currency === 'GBP' ? '£' : S.currency === 'EUR' ? '€' : '$';
    const price = a.price != null ? cur + a.price : a.priceGuess != null ? `${cur}${a.priceGuess} <span class="tag warn">guess</span>` : '—';
    $('#auction').innerHTML = `
      <div class="big-item">${esc(a.item || '(no title)')}</div>
      <div class="kv">
        <div>Phase</div><div class="v">${esc(a.phase || '')}</div>
        <div>Price</div><div class="v">${price}</div>
        <div>Leader</div><div class="v">${a.leader ? '@' + esc(a.leader) : '—'}</div>
        <div>Time</div><div class="v">${a.timerSec != null ? esc(a.timerSec + 's') : '—'}</div>
        <div>Bids</div><div class="v">${a.bids != null ? esc(a.bids) : '—'}</div>
        <div>Condition</div><div class="v">${esc(a.condition || '—')}</div>
      </div>`;
  }

  function saleRow(s, review) {
    const tags = [];
    if (s.source === 'manual') tags.push('<span class="tag blue">manual</span>');
    if (s.source === 'test') tags.push('<span class="tag blue">test</span>');
    if (s.aired) tags.push('<span class="tag ok">aired</span>');
    for (const w of s.warnings || []) tags.push(`<span class="tag warn">${esc(w.replace(/_/g, ' '))}</span>`);
    const acts = review
      ? `<button class="sm primary" data-sale="air" data-id="${esc(s.saleId)}">AIR IT</button>
         <button class="sm" data-sale="dismiss" data-id="${esc(s.saleId)}">OK, DON'T AIR</button>`
      : `<button class="sm" data-sale="air" data-id="${esc(s.saleId)}">AIR</button>`;
    return `<div class="sale">
      <div class="t">${esc(time(s.ts))}</div>
      <div><span class="who">${s.winner ? '@' + esc(s.winner) : '<span class="tag warn">no winner</span>'}</span>${tags.join('')}
        <div class="item">${esc(s.item || '')}</div></div>
      <div class="price">${esc(s.priceText || '£?')}</div>
      <div class="acts">${acts}
        <button class="sm" data-sale="edit" data-id="${esc(s.saleId)}">EDIT</button>
        <button class="sm" data-sale="delete" data-id="${esc(s.saleId)}">DELETE</button></div>
    </div>`;
  }

  function renderSales() {
    $('#reviewcard').hidden = !S.review.length;
    $('#review').innerHTML = S.review.map((s) => saleRow(s, true)).join('');
    $('#sales').innerHTML = S.sales.length ? S.sales.map((s) => saleRow(s, false)).join('') : '<div class="empty">No sales yet.</div>';
    const sm = S.summary;
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    $('#stats').innerHTML = [
      stat(esc(sm.itemsSold), 'Items sold'),
      stat(sm.highestSale ? esc(sm.highestSale.priceText) : '—', 'Biggest sale' + (sm.highestSale && sm.highestSale.winner ? ` · @${esc(sm.highestSale.winner)}` : '')),
      stat(sm.topBuyer ? '@' + esc(sm.topBuyer.user) : '—', 'Top buyer' + (sm.topBuyer ? ` · ${esc(sm.topBuyer.items)} items` : '')),
      stat(sm.lastSale ? esc(sm.lastSale.priceText || '£?') : '—', 'Last sale' + (sm.lastSale && sm.lastSale.winner ? ` · @${esc(sm.lastSale.winner)}` : '')),
      stat(esc(sm.revenueText || '—'), 'Revenue (private)'),
      stat(esc(sm.buyerCount), 'Buyers'),
    ].join('');
  }

  function renderBoard() {
    const cur = S.currency === 'GBP' ? '£' : '$';
    $('#board').innerHTML = S.leaderboard.length
      ? S.leaderboard
          .map(
            (b, i) => `<div class="brow"><div class="r">${i + 1}</div><div class="n">@${esc(b.user)}${b.hidden ? ' <span class="tag">hidden</span>' : ''}</div>
              <div class="c">${esc(b.items)}</div><div class="s">${cur}${esc(b.spend)}</div></div>`
          )
          .join('')
      : '<div class="empty">No buyers yet.</div>';
  }

  let chatKey = '';
  function renderChat() {
    const key = S.chat.map((m) => m.id + (m.aired ? 'a' : '')).join(',');
    if (key === chatKey) return; // don't rebuild while you're about to click
    chatKey = key;
    $('#chat').innerHTML = S.chat.length
      ? S.chat
          .map(
            (m) => `<div class="msg${m.backlog ? ' backlog' : ''}${m.aired ? ' aired' : ''}">
              <div><span class="u">@${esc(m.user || '?')}</span> ${esc(m.text)}</div>
              <button class="sm" data-chat="${esc(m.id)}">ON AIR</button></div>`
          )
          .join('')
      : '<div class="empty">No chat yet.</div>';
  }

  function renderNotices() {
    const cues = S.cues.map((c) => `<div class="note"><span class="t">${esc(time(c.ts))}</span>▶ ${esc(c.name.replace(/_/g, ' '))} ${esc(c.summary || '')}</div>`);
    const notes = S.notices.map((n) => `<div class="note ${esc(n.level)}"><span class="t">${esc(time(n.ts))}</span>${esc(n.text)}</div>`);
    $('#notices').innerHTML = (notes.concat(cues).join('') || '<div class="empty">Quiet.</div>');
  }

  let segKey = '';
  function renderSegments() {
    const key = JSON.stringify(S.segments) + S.show.segment;
    if (key === segKey) return;
    segKey = key;
    $('#segments').innerHTML =
      S.segments.map((s) => `<button data-segment="${esc(s.id)}" class="${S.show.segment === s.id ? 'primary' : ''}">${esc(s.title)}</button>`).join('') +
      `<button data-cue="segment_end" ${S.show.segment ? '' : 'disabled'}>END SEGMENT</button>`;
  }

  const TOGGLES = [
    ['autoAir.sales', 'SOLD graphic on every confident sale'],
    ['autoAir.buyerMilestones', 'Buyer milestones (hat trick…)'],
    ['autoAir.newLeader', 'NEW LEADER when #1 changes'],
    ['autoAir.showMilestones', 'Show milestones (10, 25, 50… sold)'],
    ['autoAir.biddingWar', 'BIDDING WAR on rapid bids'],
    ['autoAir.overtime', 'OVERTIME on first extension (arrives late on stream)'],
    ['autoAir.itemIntro', 'NEXT UP on every new item'],
    ['autoAir.giveawayWinner', 'Giveaway winner graphic'],
    ['trustPriceGuess', 'Trust the probe’s price guess (only after checking it!)'],
    ['airSalesWithoutPrice', 'Air SOLD even when the price is unknown (no price shown)'],
  ];
  let togKey = '';
  function renderToggles() {
    const st = S.settings;
    const get = (p) => p.split('.').reduce((o, k) => o && o[k], st);
    const key = JSON.stringify(st);
    if (key === togKey) return;
    togKey = key;
    $('#toggles').innerHTML =
      TOGGLES.map(([p, label]) => `<label class="tog"><input type="checkbox" data-setting="${p}" ${get(p) ? 'checked' : ''}> ${esc(label)}</label>`).join('') +
      `<label class="tog">BIG SALE from <input type="number" min="1" step="1" data-setting-num="thresholds.bigSale" value="${esc(st.bigSale)}"></label>`;
  }

  function render() {
    if (!S) return;
    renderHeader();
    renderLights();
    renderAuction();
    renderSales();
    renderBoard();
    renderChat();
    renderNotices();
    renderSegments();
    renderToggles();
  }

  // ------------------------------------------------------------------ actions
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.cue) {
        await post(`/api/cue/${b.dataset.cue}`);
        toast(b.textContent.trim());
      } else if (b.dataset.segment) {
        await post('/api/cue/segment', { id: b.dataset.segment });
      } else if (b.dataset.chat) {
        await post('/api/chat/air', { id: b.dataset.chat });
        toast('Chat on air');
      } else if (b.dataset.sale) {
        await saleAction(b.dataset.sale, b.dataset.id);
      } else if (b.dataset.action) {
        await action(b.dataset.action);
      } else if (b.dataset.test) {
        await testEvent(b.dataset.test);
      }
    } catch (err) {
      /* toast already shown */
    }
  });

  async function saleAction(kind, id) {
    const s = S.sales.find((x) => x.saleId === id) || S.review.find((x) => x.saleId === id);
    if (kind === 'air') return post('/api/sale/air', { saleId: id });
    if (kind === 'dismiss') return post('/api/sale/dismiss', { saleId: id });
    if (kind === 'delete') {
      if (confirm(`Delete sale ${s && s.winner ? '@' + s.winner : ''} ${s && s.priceText ? s.priceText : ''}? It will no longer count.`)) return post('/api/sale/delete', { saleId: id });
      return;
    }
    if (kind === 'edit') {
      const winner = prompt('Winner username', s && s.winner ? s.winner : '');
      if (winner === null) return;
      const price = prompt('Price (number, blank = unknown)', s && s.price != null ? s.price : '');
      if (price === null) return;
      return post('/api/sale/update', { saleId: id, winner, price: price.trim() === '' ? null : price });
    }
  }

  async function action(a) {
    if (a === 'end-show') {
      if (confirm('Play the END SHOW recap now?')) await post('/api/show/end');
    } else if (a === 'new-show') {
      const name = prompt('Start a NEW show? Counters and leaderboard reset. Optional name:', '');
      if (name !== null) await post('/api/show/new', { name });
    } else if (a === 'rehearsal') {
      await post('/api/mode', { mode: S.mode === 'rehearsal' ? 'live' : 'rehearsal' });
    }
  }

  document.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.setting) await post('/api/settings', { path: t.dataset.setting, value: t.checked });
      if (t.dataset.settingNum) await post('/api/settings', { path: t.dataset.settingNum, value: Number(t.value) });
      togKey = '';
    } catch (err) {
      togKey = '';
      render();
    }
  });

  $('#manual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await post('/api/sale/manual', { winner: f.winner.value, price: f.price.value, item: f.item.value, air: f.air.checked });
      f.reset();
      f.air.checked = true;
      toast('Sale added');
    } catch (err) {
      /* shown */
    }
  });

  // ------------------------------------------------------------------ rehearsal events
  const USERS = ['sarah_k', 'dave.thrifts', 'ben_vintage', 'lucy88', 'tomtom', 'amy_resells', 'dommy31', 'altin12345'];
  const ITEMS = ['Vintage Nike Sweatshirt', 'Lacoste Polo Size M', 'Levis 501 W32', 'Ralph Lauren Oxford', 'Carhartt Detroit Jacket', 'Stone Island Overshirt', 'Patagonia Fleece'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let lot = 300;
  let ta = null;
  const ev = (type, data, extra) => Object.assign({ v: 1, type, ts: Date.now(), source: 'test', auctionId: ta ? ta.id : null, data }, extra || {});
  function newAuction() {
    lot += 1;
    ta = { id: `t${Date.now().toString(36)}${lot}`, item: `${pick(ITEMS)} #${lot}`, bids: 0, leader: null, price: 1 };
    return ev('auction_start', { item: ta.item, lotNumber: String(lot), condition: 'Vintage', phase: 'live', timerSec: 15, bids: 0 });
  }
  function bidEv(dt) {
    ta.bids += 1;
    ta.price += 1;
    ta.leader = pick(USERS.filter((u) => u !== ta.leader));
    return [
      ev('bid', { bids: ta.bids, delta: 1, leader: ta.leader, nextBid: ta.price + 1 }, { ts: Date.now() + (dt || 0) }),
      ev('auction_update', { item: ta.item, phase: 'live', timerSec: 8, bids: ta.bids, leader: ta.leader, priceGuess: ta.price, nextBid: ta.price + 1 }),
    ];
  }
  function saleEv(winner, price, warnings) {
    const start = newAuction();
    return [start, ev('sale', { item: ta.item, lotNumber: String(lot), winner, price, currency: S.currency, priceSource: 'test', warnings: warnings || [], confidence: warnings && warnings.length ? 'low' : 'ok', observedLive: true })];
  }

  async function testEvent(kind) {
    const highest = S.summary.highestSale ? S.summary.highestSale.price || 0 : 0;
    let events = [];
    if (!ta && ['bid', 'war', 'extend'].includes(kind)) events.push(newAuction());
    switch (kind) {
      case 'start': events.push(newAuction()); break;
      case 'bid': events.push(...bidEv()); break;
      case 'war': for (let i = 0; i < 5; i++) events.push(...bidEv(i * 300)); break;
      case 'extend': events.push(ev('auction_extended', { fromSec: 3, toSec: 10, extensions: 1 })); break;
      case 'sale': events.push(...saleEv(pick(USERS), 3 + Math.floor(Math.random() * 15))); break;
      case 'big': events.push(...saleEv(pick(USERS), Math.max(S.settings.bigSale, 25) + Math.floor(Math.random() * 10))); break;
      case 'record': events.push(...saleEv(pick(USERS), Math.max(highest + 5, 12))); break;
      case 'hattrick': {
        const u = pick(USERS);
        for (let i = 0; i < 3; i++) events.push(...saleEv(u, 4 + i));
        break;
      }
      case 'lowconf': events.push(...saleEv(pick(USERS), 9, ['winner_differs_from_last_leader'])); break;
      case 'giveaway': events.push(newAuction(), ev('giveaway_result', { item: 'GIVEAWAY - Beanie', winner: pick(USERS) })); break;
      case 'chat': events.push(ev('chat_message', { id: `tc${Date.now()}`, user: pick(USERS), text: pick(['Can you show the back?', 'What size is it?', 'Pit to pit?', 'lets gooo', 'bundle?']) })); break;
    }
    await post('/api/test/events', { events });
  }

  // ------------------------------------------------------------------ connection
  function connect() {
    const es = new EventSource('/events?role=dashboard');
    es.addEventListener('state', (e) => {
      S = JSON.parse(e.data);
      render();
    });
    es.onerror = () => {
      $('#lights').innerHTML = '<div class="light bad"><i></i>SERVER <span>not reachable, retrying…</span></div>';
    };
  }
  connect();
})();
