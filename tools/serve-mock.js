// Serves the mock Whatnot show page at http://localhost:5179/mock/
// The extension's manifest matches http://localhost/mock/* so the probe runs there.
// No dependencies: `npm run mock`.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 5179;
const ROOT = path.join(__dirname, 'mock-show');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/mock') {
    res.writeHead(302, { Location: '/mock/' });
    return res.end();
  }
  if (url.pathname === '/mock/' || url.pathname === '/mock/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock Whatnot show: http://localhost:${PORT}/mock/`);
});
