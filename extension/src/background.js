// Extension service worker: forwards probe events to the local show server.
//
// The content script can't reliably call http://127.0.0.1 from the https
// Whatnot page (CORS / private network rules), so it hands events here and
// we POST them. Events are queued while the server is down and replayed in
// order when it comes back. Only the probe's own events are ever sent.

const SERVER = 'http://127.0.0.1:3000';
const MAX_QUEUE = 2000;
const BATCH = 100;

const queue = [];
let flushing = false;
let retryTimer = null;
let backoff = 1000;
let status = { server: 'unknown', lastOkAt: 0, lastError: null, queued: 0 };

function enqueue(evt) {
  queue.push(evt);
  if (queue.length > MAX_QUEUE) {
    // Drop the least important events first.
    const i = queue.findIndex((e) => e.type === 'auction_update' || e.type === 'probe_heartbeat' || e.type === 'chat_message');
    queue.splice(i >= 0 ? i : 0, 1);
  }
  flush();
}

async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  clearTimeout(retryTimer);
  try {
    while (queue.length) {
      const batch = queue.slice(0, BATCH);
      const r = await fetch(`${SERVER}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
      if (!r.ok) throw new Error(`server replied ${r.status}`);
      queue.splice(0, batch.length);
      status = { server: 'connected', lastOkAt: Date.now(), lastError: null, queued: queue.length };
      backoff = 1000;
    }
  } catch (e) {
    status = { server: 'offline', lastOkAt: status.lastOkAt, lastError: String(e.message || e), queued: queue.length };
    retryTimer = setTimeout(flush, backoff);
    backoff = Math.min(backoff * 2, 10000);
  } finally {
    flushing = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'wnsc-event' && msg.event && typeof msg.event.type === 'string') {
    // Debug dumps stay local; everything else goes to the server.
    if (!/^debug_/.test(msg.event.type)) enqueue(msg.event);
  }
  if (msg.kind === 'wnsc-event' || msg.kind === 'wnsc-status') {
    status.queued = queue.length;
    sendResponse(status);
  }
});
