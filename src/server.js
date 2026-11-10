// Tiny local web server for the app. The display runs as a web page so it can
// be opened by Electron (the normal way) or by Chrome in kiosk mode on a
// mini PC. Cross-origin isolation headers let the speech model use several
// CPU threads (WebAssembly threads need SharedArrayBuffer).
//
// Usage: node src/server.js [port]   then open http://localhost:<port>/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Only these folders are served (no source maps of the whole disk, no .git).
const ALLOWED = ['src/renderer', 'src/engine', 'data', 'models', 'docs', 'node_modules/onnxruntime-web/dist', 'node_modules/@fontsource/amiri-quran'];

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

export function startServer(port = 0, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path === '/') path = '/src/renderer/index.html';
      const rel = normalize(path).replace(/^[/\\]+/, '');
      if (rel.includes('..') || !ALLOWED.some((a) => rel === a || rel.startsWith(a + '/') || rel.startsWith(a + sep))) {
        res.writeHead(404).end('not found');
        return;
      }
      const file = join(ROOT, rel);
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
