import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.env.SITE_ROOT || path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const BLOCKED_PREFIXES = ['.git', '.github', 'tests', 'tools', 'docs'];
const BLOCKED_FILES = new Set(['server.mjs', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.gitignore']);

function cacheControlFor(rel) {
  if (rel === 'index.html' || rel === 'sw.js' || rel === 'manifest.webmanifest') {
    return 'no-cache';
  }
  if (rel.startsWith('icons/') || rel.startsWith('vendor/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=300, stale-while-revalidate=86400';
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? '' : 'ok');
    return;
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const top = rel.split('/')[0];
  if (BLOCKED_PREFIXES.includes(top) || BLOCKED_FILES.has(rel)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? '' : 'Not Found');
    return;
  }

  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? '' : 'Not Found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControlFor(rel),
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    };
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*')) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(full);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`lyric-card-generator listening on http://localhost:${PORT}`);
});
