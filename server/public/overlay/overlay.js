// Overlay graphics engine. It only plays cues the server sends; it never
// decides anything about the show. All text goes in via textContent.

(function () {
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const MUTE = params.has('mute');
  const stage = document.getElementById('stage');
  const main = document.getElementById('main');
  const chatLayer = document.getElementById('chat');
  const statusEl = document.getElementById('status');
  const fxCanvas = document.getElementById('fx');

  let config = { brand: { accent: '#ffd400' }, layout: { centerY: 640, chatY: 1020 }, audio: { enabled: true, volume: 0.5, files: {} } };

  if (params.has('bg') || DEMO) document.body.classList.add('bg');
  if (params.has('bg') || DEMO || params.has('safe')) document.body.classList.add('preview');

  // Fit 1080x1920 into whatever window we're in (OBS = exact fit, browser = scaled).
  function fit() {
    const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    stage.style.transform = `scale(${s})`;
    stage.style.left = `${(window.innerWidth - 1080 * s) / 2}px`;
  }
  window.addEventListener('resize', fit);
  fit();

  function applyConfig(c) {
    config = Object.assign(config, c || {});
    const root = document.documentElement.style;
    if (config.brand && config.brand.accent) root.setProperty('--accent', config.brand.accent);
    if (config.layout) {
      if (config.layout.centerY) root.setProperty('--centerY', config.layout.centerY + 'px');
      if (config.layout.chatY) root.setProperty('--chatY', config.layout.chatY + 'px');
    }
  }

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, text, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  }
  function slab(text, size) {
    const s = el('div', `slab display ${size || 'xl'}`);
    s.appendChild(el('span', null, text));
    return s;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function crownSvg() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 240 160');
    svg.setAttribute('class', 'crown');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M20 140 L10 40 L70 90 L120 15 L170 90 L230 40 L220 140 Z');
    path.setAttribute('fill', '#ffc300');
    path.setAttribute('stroke', '#0b0b0d');
    path.setAttribute('stroke-width', '10');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    for (const [cx, cy] of [[10, 40], [120, 15], [230, 40]]) {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', cx);
      c.setAttribute('cy', cy);
      c.setAttribute('r', '14');
      c.setAttribute('fill', '#fff2a8');
      c.setAttribute('stroke', '#0b0b0d');
      c.setAttribute('stroke-width', '8');
      svg.appendChild(c);
    }
    return svg;
  }

  // ---------------------------------------------------------------- templates
  // Each returns { el, fx?, onStart?(el, token) }.
  const T = {
    sold(p) {
      const g = el('div', 'g sold');
      g.appendChild(slab('SOLD', 'xl'));
      if (p.price) g.appendChild(el('div', 'price', p.price));
      if (p.winner) g.appendChild(el('div', 'pill', p.winner));
      if (p.item) g.appendChild(el('div', 'caption', p.item));
      return { el: g };
    },
    big_sale(p) {
      const g = el('div', 'g big');
      g.appendChild(el('div', 'rays red'));
      const st = el('div', 'stack');
      st.appendChild(slab('BIG SALE', 'l'));
      if (p.price) st.appendChild(el('div', 'price huge', p.price));
      if (p.winner) st.appendChild(el('div', 'pill', p.winner));
      if (p.item) st.appendChild(el('div', 'caption', p.item));
      g.appendChild(st);
      return { el: g, fx: 'burst' };
    },
    new_record(p) {
      const g = el('div', 'g record');
      g.appendChild(el('div', 'rays'));
      g.appendChild(el('div', 'kick', 'NEW SHOW'));
      g.appendChild(slab('RECORD', 'xl'));
      if (p.price) g.appendChild(el('div', 'price huge', p.price));
      if (p.winner) g.appendChild(el('div', 'pill', p.winner));
      if (p.previous) g.appendChild(el('div', 'caption', `PREVIOUS BEST ${p.previous}`));
      return { el: g, fx: 'confetti' };
    },
    buyer_milestone(p) {
      const g = el('div', 'g milestone');
      const b = el('div', 'badge');
      b.appendChild(el('div', 'num', p.count));
      g.appendChild(b);
      g.appendChild(slab(p.label || 'MILESTONE', 'm'));
      if (p.user) g.appendChild(el('div', 'pill', p.user));
      g.appendChild(el('div', 'caption', `${p.count} ITEMS TONIGHT`));
      return { el: g, fx: 'sparkle' };
    },
    new_leader(p) {
      const g = el('div', 'g leader');
      g.appendChild(el('div', 'rays'));
      g.appendChild(crownSvg());
      g.appendChild(slab('NEW LEADER', 'l'));
      if (p.user) g.appendChild(el('div', 'pill', p.user));
      if (p.count != null) g.appendChild(el('div', 'caption', `${p.count} ITEMS TONIGHT`));
      return { el: g, fx: 'sparkle' };
    },
    show_milestone(p) {
      const g = el('div', 'g showms');
      const b = el('div', 'badge gold');
      b.appendChild(el('div', 'num', p.count));
      g.appendChild(b);
      g.appendChild(slab('ITEMS SOLD', 'm'));
      g.appendChild(el('div', 'caption', 'THANK YOU ALL!'));
      return { el: g, fx: 'confetti' };
    },
    bidding_war() {
      const g = el('div', 'g war');
      g.appendChild(el('div', 'bars top'));
      g.appendChild(el('div', 'txt', 'BIDDING'));
      g.appendChild(el('div', 'txt', 'WAR!'));
      g.appendChild(el('div', 'bars bot'));
      return { el: g };
    },
    overtime() {
      const g = el('div', 'g overtime');
      g.appendChild(slab('OVERTIME!', 'l'));
      return { el: g };
    },
    item_intro(p) {
      const g = el('div', 'g intro');
      g.appendChild(slab('NEXT UP', 's'));
      if (p.imageUrl) {
        const img = el('img', 'img', null, { alt: '', referrerpolicy: 'no-referrer' });
        img.onerror = () => img.remove();
        img.src = p.imageUrl;
        g.appendChild(img);
      }
      g.appendChild(el('div', 'title', p.item || ''));
      if (p.condition) g.appendChild(el('div', 'pill', p.condition));
      return { el: g };
    },
    giveaway() {
      const g = el('div', 'g giveaway');
      g.appendChild(el('div', 'rays'));
      g.appendChild(el('div', 'rainbow', 'GIVEAWAY'));
      g.appendChild(el('div', 'rainbow', 'TIME!'));
      g.appendChild(el('div', 'caption', 'ENTER NOW ON WHATNOT'));
      return { el: g, fx: 'confetti' };
    },
    giveaway_winner(p) {
      const g = el('div', 'g giveaway');
      g.appendChild(el('div', 'rainbow', 'WINNER!'));
      if (p.user) g.appendChild(el('div', 'pill', p.user));
      if (p.item) g.appendChild(el('div', 'caption', p.item));
      return { el: g, fx: 'confetti' };
    },
    segment(p) {
      const g = el('div', 'g segment');
      if (p.color) g.style.setProperty('--seg', p.color);
      g.appendChild(slab(p.title || 'SEGMENT', 'l'));
      if (p.subtitle) g.appendChild(el('div', 'sub', p.subtitle));
      return { el: g, fx: 'burst' };
    },
    stats(p) {
      const g = el('div', 'g');
      const panel = el('div', 'panel');
      panel.appendChild(el('h1', null, 'TONIGHT SO FAR'));
      const rows = [
        ['ITEMS SOLD', String(p.itemsSold ?? 0), null],
        ['BIGGEST SALE', p.biggestSale || '—', p.biggestSaleUser],
        ['TOP BUYER', p.topBuyer || '—', p.topBuyerItems != null ? `${p.topBuyerItems} ITEMS` : null],
      ];
      rows.forEach(([lbl, val, sub], i) => {
        const r = el('div', 'prow');
        r.style.animationDelay = `${0.35 + i * 0.18}s`;
        r.appendChild(el('div', 'lbl', lbl));
        const big = el('div', 'big', val);
        if (sub) big.appendChild(el('small', null, sub));
        r.appendChild(big);
        panel.appendChild(r);
      });
      g.appendChild(panel);
      return { el: g };
    },
    top_buyers(p) {
      const g = el('div', 'g');
      const panel = el('div', 'panel');
      panel.appendChild(el('h1', null, 'TOP BUYERS'));
      (p.rows || []).forEach((row, i) => {
        const r = el('div', 'prow');
        r.style.animationDelay = `${0.35 + i * 0.15}s`;
        r.appendChild(el('div', 'rank', row.rank));
        r.appendChild(el('div', 'name', row.user));
        r.appendChild(el('div', 'val', row.items));
        panel.appendChild(r);
      });
      g.appendChild(panel);
      return { el: g };
    },
    end_show(p, cue) {
      const g = el('div', 'g end');
      const slides = [];
      const s1 = el('div', 'slide');
      s1.appendChild(slab('TONIGHT', 'm'));
      s1.appendChild(el('div', 'bigNum', p.itemsSold ?? 0));
      s1.appendChild(slab('ITEMS SOLD', 's'));
      slides.push(s1);
      if (p.topBuyer) {
        const s = el('div', 'slide');
        s.appendChild(crownSvg());
        s.appendChild(slab('TOP BUYER', 'm'));
        s.appendChild(el('div', 'pill', p.topBuyer));
        s.appendChild(el('div', 'caption', `${p.topBuyerItems} ITEMS`));
        slides.push(s);
      }
      if (p.biggestSale) {
        const s = el('div', 'slide');
        s.appendChild(slab('BIGGEST SALE', 'm'));
        s.appendChild(el('div', 'price huge', p.biggestSale));
        if (p.biggestSaleUser) s.appendChild(el('div', 'pill', p.biggestSaleUser));
        slides.push(s);
      }
      const s4 = el('div', 'slide');
      s4.appendChild(el('div', 'thanks', 'THANKS FOR'));
      s4.appendChild(el('div', 'thanks', 'WATCHING'));
      if (p.showName) s4.appendChild(el('div', 'name', p.showName));
      slides.push(s4);
      slides.forEach((s) => g.appendChild(s));
      const per = Math.max(2500, (cue.durationMs || 24000) / slides.length);
      return {
        el: g,
        async onStart(token) {
          for (let i = 0; i < slides.length; i++) {
            if (token.cancelled) return;
            slides.forEach((s) => s.classList.remove('on'));
            // Re-trigger child animations.
            const s = slides[i];
            s.replaceWith(s.cloneNode(true));
            slides[i] = g.children[i];
            slides[i].classList.add('on');
            if (i === slides.length - 1) {
              fx('confetti');
              sound('end_show');
            }
            await sleep(per);
          }
        },
      };
    },
  };

  // ---------------------------------------------------------------- particles
  const ctx = fxCanvas.getContext('2d');
  let particles = [];
  let fxRunning = false;
  const COLORS = ['#ffd400', '#ff2d55', '#34c759', '#0a84ff', '#bf5af2', '#ffffff', '#ff9500'];

  function fx(kind) {
    const cy = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--centerY'), 10) || 640;
    const n = kind === 'confetti' ? 220 : kind === 'burst' ? 120 : 70;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (kind === 'sparkle' ? 6 : 12) + Math.random() * (kind === 'confetti' ? 22 : 14);
      particles.push({
        x: 540 + (Math.random() - 0.5) * 120,
        y: cy + (Math.random() - 0.5) * 80,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (kind === 'confetti' ? 10 : 4),
        r: kind === 'sparkle' ? 4 + Math.random() * 5 : 8 + Math.random() * 10,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        life: 1,
        decay: 0.006 + Math.random() * 0.008,
        shape: kind === 'sparkle' ? 'dot' : Math.random() < 0.5 ? 'rect' : 'dot',
      });
    }
    if (!fxRunning) {
      fxRunning = true;
      requestAnimationFrame(stepFx);
    }
  }

  function stepFx() {
    ctx.clearRect(0, 0, 1080, 1920);
    particles = particles.filter((p) => p.life > 0 && p.y < 2000);
    for (const p of particles) {
      p.vy += 0.45;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
      ctx.fillStyle = p.c;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.shape === 'rect') ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, p.r / 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (particles.length) requestAnimationFrame(stepFx);
    else {
      fxRunning = false;
      ctx.clearRect(0, 0, 1080, 1920);
    }
  }

  function clearFx() {
    particles = [];
  }

  // ---------------------------------------------------------------- audio
  // Built-in synth stings so there's sound out of the box. Replace any of them
  // with a file via config.audio.files.<cue> = "file.mp3" (in /assets/audio/),
  // or silence one with false. Kept short and restrained on purpose.
  let actx = null;
  function ac() {
    if (!actx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      actx = new C();
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function tone(freq, start, dur, type, gain) {
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime + start;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime((gain || 0.3) * vol(), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  function sweep(f1, f2, start, dur, gain) {
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime + start;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f1, t0);
    o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime((gain || 0.08) * vol(), t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const vol = () => (config.audio && typeof config.audio.volume === 'number' ? config.audio.volume : 0.5);
  const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G4: 392, C4: 261.63, E4: 329.63 };
  const SYNTH = {
    sold: () => { tone(N.G5, 0, 0.25); tone(N.C6, 0.09, 0.5); },
    big_sale: () => { sweep(200, 1200, 0, 0.35); tone(N.C5, 0.3, 0.5); tone(N.E5, 0.3, 0.5); tone(N.G5, 0.3, 0.7); tone(N.C6, 0.42, 0.8); },
    new_record: () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.12, 0.5, 'square', 0.12)); tone(N.C6, 0.5, 1.2); tone(N.E6, 0.5, 1.2, 'triangle', 0.15); tone(N.G5, 0.5, 1.2); },
    buyer_milestone: () => { tone(N.E5, 0, 0.2); tone(N.E5, 0.15, 0.2); tone(N.A5, 0.3, 0.6); },
    new_leader: () => { sweep(300, 900, 0, 0.3); tone(N.G5, 0.28, 0.6); tone(N.C6, 0.28, 0.8); },
    show_milestone: () => { tone(N.C6, 0, 0.6); tone(N.G5, 0, 0.6); },
    bidding_war: () => { for (let i = 0; i < 4; i++) tone(110 + i * 20, i * 0.12, 0.1, 'sawtooth', 0.12); },
    overtime: () => { tone(1200, 0, 0.06, 'square', 0.08); tone(900, 0.25, 0.06, 'square', 0.08); },
    item_intro: () => sweep(400, 1600, 0, 0.35, 0.05),
    giveaway: () => { [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, i * 0.07, 0.4, 'sine', 0.2)); },
    giveaway_winner: () => { [N.G5, N.C6, N.E6].forEach((f, i) => tone(f, i * 0.08, 0.5, 'sine', 0.2)); },
    segment: () => { sweep(150, 1000, 0, 0.4, 0.07); tone(N.C4, 0.38, 0.6, 'square', 0.12); tone(N.G4, 0.38, 0.6, 'square', 0.1); },
    stats: () => tone(N.E5, 0, 0.3, 'sine', 0.15),
    top_buyers: () => tone(N.G5, 0, 0.3, 'sine', 0.15),
    chat: () => tone(N.A5, 0, 0.15, 'sine', 0.12),
    end_show: () => { tone(N.C5, 0, 1.5, 'sine', 0.2); tone(N.E5, 0.1, 1.5, 'sine', 0.2); tone(N.G5, 0.2, 1.8, 'sine', 0.2); },
  };
  function sound(name) {
    if (MUTE || !config.audio || config.audio.enabled === false) return;
    const file = config.audio.files && config.audio.files[name];
    if (file === false) return;
    try {
      if (typeof file === 'string' && file) {
        const a = new Audio('/assets/audio/' + encodeURIComponent(file));
        a.volume = Math.max(0, Math.min(1, vol()));
        a.play().catch(() => {});
      } else if (SYNTH[name]) SYNTH[name]();
    } catch (e) {
      /* never let audio break graphics */
    }
  }

  // ---------------------------------------------------------------- queue
  const queue = [];
  let current = null;
  const STALE_MS = { bidding_war: 6000, overtime: 5000, item_intro: 10000 };

  function enqueue(cue) {
    queue.push(cue);
    if (!current) playNext();
  }

  async function playNext() {
    const cue = queue.shift();
    if (!cue) {
      current = null;
      return;
    }
    if (STALE_MS[cue.name] && cue.ts && Date.now() - cue.ts > STALE_MS[cue.name]) return playNext();
    const tpl = T[cue.name];
    if (!tpl) return playNext();
    const token = { cancelled: false };
    current = { cue, token };
    let built;
    try {
      built = tpl(cue.payload || {}, cue);
    } catch (e) {
      console.error('template failed', cue.name, e);
      current = null;
      return playNext();
    }
    main.textContent = '';
    main.appendChild(built.el);
    ack(cue, 'started');
    sound(cue.name);
    if (built.fx) setTimeout(() => !token.cancelled && fx(built.fx), 350);
    if (built.onStart) built.onStart(token);
    await sleep(cue.durationMs || 3000);
    if (token.cancelled) return;
    built.el.classList.add('out');
    await sleep(380);
    if (token.cancelled) return;
    built.el.remove();
    ack(cue, 'done');
    current = null;
    playNext();
  }

  function clearAll() {
    queue.length = 0;
    if (current) current.token.cancelled = true;
    current = null;
    for (const c of [...main.children]) {
      c.classList.add('kill');
      setTimeout(() => c.remove(), 160);
    }
    hideChat(true);
    clearFx();
  }

  // Chat lower third: independent layer, one at a time.
  let chatTimer = null;
  function showChat(cue) {
    hideChat(true);
    const p = cue.payload || {};
    const b = el('div', 'bubble');
    const name = (p.user || '').replace(/^@/, '');
    b.appendChild(el('div', 'av', name ? name[0] : '?'));
    const body = el('div', 'body');
    body.appendChild(el('div', 'u', p.user || ''));
    body.appendChild(el('div', 't', p.text || ''));
    b.appendChild(body);
    chatLayer.appendChild(b);
    sound('chat');
    ack(cue, 'started');
    chatTimer = setTimeout(() => hideChat(false), cue.durationMs || 15000);
  }
  function hideChat(instant) {
    clearTimeout(chatTimer);
    for (const b of [...chatLayer.children]) {
      if (instant) b.remove();
      else {
        b.classList.add('out');
        setTimeout(() => b.remove(), 360);
      }
    }
  }

  function handleCue(cue) {
    if (!cue || !cue.name) return;
    if (cue.name === 'clear') {
      clearAll();
      ack(cue, 'cleared');
      return;
    }
    if (cue.name === 'chat') return showChat(cue);
    if (cue.name === 'chat_clear') return hideChat(false);
    enqueue(cue);
  }

  // ---------------------------------------------------------------- server link
  function ack(cue, status) {
    if (DEMO || !cue.id) return;
    fetch('/api/overlay/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cueId: cue.id, name: cue.name, status }),
    }).catch(() => {});
  }

  function setStatus(t) {
    statusEl.textContent = t;
  }

  function connect() {
    if (!window.EventSource || location.protocol === 'file:') return setStatus('no server (file preview)');
    const es = new EventSource('/events?role=overlay');
    es.addEventListener('hello', (e) => {
      applyConfig(JSON.parse(e.data));
      setStatus('connected');
    });
    es.addEventListener('cue', (e) => handleCue(JSON.parse(e.data)));
    es.onerror = () => setStatus('reconnecting…');
  }

  // ---------------------------------------------------------------- safe areas
  // APPROXIMATE positions of Whatnot's own UI on a phone. Calibrate against
  // real screenshots of your show and adjust here.
  function drawSafe() {
    const s = document.getElementById('safe');
    s.hidden = false;
    const zones = [
      ['red', 0, 0, 1080, 250, 'HOST / VIEWERS / GIVEAWAY BAR'],
      ['amber', 0, 250, 1080, 130, 'SOMETIMES: BANNERS / STREAKS'],
      ['green', 90, 380, 900, 640, 'SAFE FOR GRAPHICS'],
      ['amber', 0, 1100, 720, 400, 'CHAT'],
      ['red', 900, 1000, 180, 560, 'BUTTONS'],
      ['red', 0, 1500, 1080, 420, 'PRODUCT CARD + BID BUTTON'],
    ];
    for (const [cls, x, y, w, h, label] of zones) {
      const z = el('div', `z ${cls}`, label);
      Object.assign(z.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      s.appendChild(z);
    }
    s.appendChild(el('div', 'note', 'Approximate. Check against phone screenshots of your own show, and keep text inside x 90–990 because phones taller than 9:16 crop the sides.'));
  }

  // ---------------------------------------------------------------- demo
  const DEMO_CUES = [
    ['item_intro', { item: 'Vintage Lacoste Polo #374', condition: 'New With Tags' }, 3500],
    ['bidding_war', {}, 2200],
    ['overtime', {}, 1600],
    ['sold', { price: '£17', winner: '@dave.thrifts', item: 'Vintage Nike Sweatshirt #374' }, 2400],
    ['big_sale', { price: '£35', winner: '@sarah_k', item: 'Carhartt Detroit Jacket #375' }, 3200],
    ['new_record', { price: '£46', winner: '@lucy88', previous: '£35' }, 4800],
    ['buyer_milestone', { label: 'HAT TRICK', user: '@dave.thrifts', count: 3 }, 3000],
    ['new_leader', { user: '@sarah_k', count: 8 }, 3200],
    ['show_milestone', { count: 25 }, 3000],
    ['top_buyers', { rows: [{ rank: 1, user: '@sarah_k', items: 8 }, { rank: 2, user: '@dave.thrifts', items: 7 }, { rank: 3, user: '@ben_vintage', items: 5 }, { rank: 4, user: '@lucy88', items: 4 }] }, 6000],
    ['stats', { itemsSold: 37, biggestSale: '£46', biggestSaleUser: '@lucy88', topBuyer: '@sarah_k', topBuyerItems: 8 }, 6000],
    ['giveaway', {}, 4000],
    ['segment', { title: '£1 MADNESS', subtitle: '10 ITEMS • £1 STARTS', color: '#ff2d55' }, 4000],
    ['end_show', { itemsSold: 82, topBuyer: '@sarah_k', topBuyerItems: 11, biggestSale: '£51', biggestSaleUser: '@lucy88', showName: '' }, 14000],
  ];
  async function runDemo() {
    // Browsers block sound until you click; OBS doesn't.
    document.addEventListener('click', () => ac(), { once: true });
    let i = 0;
    for (;;) {
      const [name, payload, durationMs] = DEMO_CUES[i % DEMO_CUES.length];
      setStatus(`DEMO: ${name}  (click once to enable sound)`);
      handleCue({ id: `demo-${i}`, name, payload, durationMs, ts: Date.now() });
      if (i % 5 === 2) handleCue({ id: `demo-chat-${i}`, name: 'chat', payload: { user: '@sarah_k', text: 'Can you show the back of it? 😍' }, durationMs: 5000 });
      await sleep(durationMs + 900);
      i += 1;
    }
  }

  if (params.has('safe')) drawSafe();
  if (DEMO) runDemo();
  else connect();

  window.overlay = { handleCue, clearAll, fx };
})();
