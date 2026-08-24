#!/usr/bin/env node
// Minimal static server for the Life OS Playwright smoke suite.
// Node built-ins only (http, fs, path, url). Binds 127.0.0.1:4173,
// serves from the repo root, strips query strings, rejects any
// resolved path outside the root, and closes each connection to keep
// the fixture deterministic under Chromium cold-context load bursts.

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = 4173;

const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript; charset=utf-8',
  '.mjs':         'application/javascript; charset=utf-8',
  '.css':         'text/css; charset=utf-8',
  '.json':        'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg':         'image/svg+xml',
  '.png':         'image/png',
  '.jpg':         'image/jpeg',
  '.jpeg':        'image/jpeg',
  '.gif':         'image/gif',
  '.ico':         'image/x-icon',
  '.txt':         'text/plain; charset=utf-8',
  '.map':         'application/json; charset=utf-8',
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign(
    { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' },
    headers || {},
  ));
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
  } catch (_) {
    return send(res, 400, 'Bad Request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const resolved = path.resolve(ROOT, '.' + pathname);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not Found');

    const type = MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type':   type,
      'Content-Length': stat.size,
      'Cache-Control':  'no-store',
      'Connection':     'close',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(resolved)
      .on('error', () => { try { res.destroy(); } catch (_) {} })
      .pipe(res);
  });
});

server.on('clientError', (_err, socket) => {
  try { socket.destroy(); } catch (_) {}
});

server.listen(PORT, HOST, () => {
  console.log(`test-server ready at http://${HOST}:${PORT} (root: ${ROOT})`);
});
