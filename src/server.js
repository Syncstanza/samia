// Tiny local web server for the app. The display runs as a web page so it can
// be opened by Electron (the normal way) or by Chrome in kiosk mode on a
// mini PC. Cross-origin isolation headers let the speech model use several
// CPU threads (WebAssembly threads need SharedArrayBuffer).
//
// Usage: node src/server.js [port]   then open http://localhost:<port>/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Only these folders are served (no source maps of the whole disk, no .git).
const ALLOWED = ['src/renderer', 'src/engine', 'data', 'models', 'docs', 'vendor'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * URL path -> file on disk, or null if it isn't one of the served folders.
 * URL paths always use "/", so they're checked with posix rules on every OS
 * (Windows' own path rules turn "/" into "\\", which broke the check).
 */
export function resolveRequest(urlPath) {
  let path;
  try { path = decodeURIComponent(urlPath); } catch { return null; }
  if (path === '/' || path === '') path = '/src/renderer/index.html';
  if (path.includes('\\') || path.includes('\0')) return null;
  const rel = posix.normalize(path).replace(/^\/+/, '');
  if (rel.startsWith('..') || rel.split('/').includes('..')) return null;
  if (!ALLOWED.some((a) => rel.startsWith(a + '/'))) return null;
  return join(ROOT, ...rel.split('/'));
}

export function startServer(port = 0, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    try {
      const file = resolveRequest(new URL(req.url, 'http://x').pathname);
      if (!file) {
        res.writeHead(404).end('not found');
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cache-Control': 'no-cache',
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] || 4173);
  startServer(port, '0.0.0.0').then(() => console.log(`Sami'a: http://localhost:${port}/`));
}
