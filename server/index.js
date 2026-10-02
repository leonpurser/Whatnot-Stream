// Whatnot Show Control — local server. No dependencies: `node server/index.js`
//
//   Dashboard:  http://127.0.0.1:3000/dashboard/
//   Overlay:    http://127.0.0.1:3000/overlay/   (OBS Browser Source, 1080x1920)
//   API:        see docs/API.md

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Config, ROOT } = require('./lib/config');
const { App } = require('./lib/app');

const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.WNSC_DATA || path.join(ROOT, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
};

function createServer({ dataDir = DATA } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const config = new Config(dataDir);
  const app = new App({ dataDir, config });
  const port = config.get('port');

  // Block other websites in your browser from poking the API. Requests from
  // Companion / curl have no Origin; our own pages and the extension do.
  function originAllowed(req) {
    const o = req.headers.origin;
    if (!o) return true;
    if (o.startsWith('chrome-extension://')) return true;
    try {
      const u = new URL(o);
      return ['127.0.0.1', 'localhost'].includes(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function json(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 2e6) {
          reject(new Error('body too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  }

  // POST routes. Body is JSON (may be empty). `q` = query params.
  const routes = {
    'POST /api/ingest': (b) => ({ accepted: app.ingest(b.events) }),
    'POST /api/test/events': (b) => ({ accepted: app.ingest(b.events, { test: true }) }),
    'POST /api/mode': (b) => (app.setMode(b.mode === 'rehearsal' ? 'rehearsal' : 'live'), { mode: app.mode }),
    'POST /api/settings': (b) => (app.config.set(String(b.path), b.value), app.scheduleState(), { ok: true }),
    'POST /api/show/new': (b) => (app.newShow(b.name), { ok: true }),
    'POST /api/show/end': () => app.manualCue('end_show'),
    'POST /api/sale/air': (b) => (app.airSale(b.saleId), { ok: true }),
    'POST /api/sale/dismiss': (b) => (app.dismissSale(b.saleId), { ok: true }),
    'POST /api/sale/update': (b) => (app.updateSale(b.saleId, b), { ok: true }),
    'POST /api/sale/delete': (b) => (app.deleteSale(b.saleId), { ok: true }),
    'POST /api/sale/manual': (b) => ({ sale: app.manualSale(b) }),
    'POST /api/chat/air': (b) => app.airChat(b.id),
    'POST /api/chat/clear': () => app.manualCue('chat_clear'),
    'POST /api/chat/air-slot': (b, q) => app.airChatSlot(b.slot || q.get('slot')),
    'POST /api/clear': () => app.manualCue('clear'),
    'POST /api/overlay/ack': (b) => (app.overlayAck(b), { ok: true }),
    'GET /api/state': () => app.buildState(),
    'GET /api/companion': () => app.companionState(),
    'GET /api/health': () => ({ ok: true }),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (!originAllowed(req)) return json(res, 403, { error: 'origin not allowed' });

      if (req.method === 'GET' && p === '/events') {
        const role = ['overlay', 'dashboard', 'companion'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'dashboard';
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 1000\n\n');
        const c = app.addClient(res, role);
        const ka = setInterval(() => res.write(': ka\n\n'), 15000);
        res.on('close', () => clearInterval(ka));
        return c;
      }

      const testMatch = p.match(/^\/api\/test\/([a-z]+)$/);
      if (req.method === 'POST' && testMatch && testMatch[1] !== 'events') {
        await readBody(req).catch(() => ({}));
        return json(res, 200, app.testEvent(testMatch[1]));
      }

      // Companion-friendly: POST /api/cue/<name>?id=<segment>
      const cueMatch = p.match(/^\/api\/cue\/([a-z_]+)$/);
      if (req.method === 'POST' && cueMatch) {
        const body = await readBody(req).catch(() => ({}));
        const params = Object.assign({}, Object.fromEntries(url.searchParams), body);
        return json(res, 200, { ok: true, result: app.manualCue(cueMatch[1], params) });
      }

      const handler = routes[`${req.method} ${p}`];
      if (handler) {
        const body = req.method === 'POST' ? await readBody(req) : {};
        return json(res, 200, handler(body, url.searchParams) || { ok: true });
      }

      if (req.method === 'GET') {
        if (p === '/') {
          res.writeHead(302, { Location: '/dashboard/' });
          return res.end();
        }
        if (p === '/overlay' || p === '/dashboard') {
          res.writeHead(302, { Location: p + '/' + url.search });
          return res.end();
        }
        return serveStatic(req, res, p);
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  return { server, app, config, port, host: config.get('host') };
}

if (require.main === module) {
  const { server, port, host } = createServer();
  server.listen(port, host, () => {
    console.log('');
    console.log('  Whatnot Show Control running');
    console.log(`  Dashboard : http://${host}:${port}/dashboard/`);
    console.log(`  Overlay   : http://${host}:${port}/overlay/   (OBS Browser Source 1080x1920)`);
    console.log(`  Safe areas: http://${host}:${port}/overlay/?safe=1&demo=1`);
    console.log('');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Is the server already running? Change "port" in config/local.json if needed.`);
    else console.error(e);
    process.exit(1);
  });
}

module.exports = { createServer };
