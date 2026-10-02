// Link to the Show Control server: a Server-Sent Events stream for live
// state, and plain POSTs for actions. Reconnects forever.

const http = require('node:http');
const { EventEmitter } = require('node:events');

const STALE_MS = 7000; // server pushes state at least every 2s

class ServerLink extends EventEmitter {
  constructor({ host, port }) {
    super();
    this.host = host || '127.0.0.1';
    this.port = Number(port) || 3000;
    this.req = null;
    this.retryTimer = null;
    this.watchdog = null;
    this.stopped = false;
    this.up = false;
  }

  get base() {
    return `http://${this.host}:${this.port}`;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.watchdog);
    if (this.req) this.req.destroy();
    this.req = null;
  }

  _setDown(reason) {
    if (this.up || reason) this.emit('down', reason || 'disconnected');
    this.up = false;
  }

  _kick() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.req) this.req.destroy(new Error('no data from server'));
    }, STALE_MS);
  }

  _retry() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this._connect(), 2000);
  }

  _connect() {
    if (this.stopped) return;
    if (this.req) this.req.destroy();
    const req = http.get(
      { host: this.host, port: this.port, path: '/events?role=companion', headers: { Accept: 'text/event-stream' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          this._setDown(`server replied ${res.statusCode}`);
          return this._retry();
        }
        res.setEncoding('utf8');
        let buf = '';
        this._kick();
        res.on('data', (chunk) => {
          this._kick();
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            this._handleBlock(block);
          }
        });
        // 'close' fires for a clean end and for a dropped connection alike.
        res.on('close', () => {
          if (this.req !== req) return; // superseded by a newer connection
          this._setDown('server closed the connection');
          this._retry();
        });
        res.on('error', () => {});
      }
    );
    req.on('error', (e) => {
      this._setDown(e.code === 'ECONNREFUSED' ? 'server not running' : e.message);
      this._retry();
    });
    this.req = req;
  }

  _handleBlock(block) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event !== 'state' || !data) return;
    try {
      const state = JSON.parse(data);
      this.up = true;
      this.emit('state', state);
    } catch (e) {
      /* ignore partial / bad data */
    }
  }

  async post(path, body) {
    const r = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(5000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
}

module.exports = { ServerLink };
