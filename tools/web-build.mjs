// Builds web-dist: the hosted (browser) version of Sami'a.
// Usage: node tools/web-build.mjs [--base /samia/]     (default base: /)
// The base is the path the site lives under (GitHub Pages serves this repo at /samia/).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web-dist');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const i = process.argv.indexOf('--base');
let base = i > 0 ? process.argv[i + 1] : '/';
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const dir of ['src/renderer', 'src/engine', 'data', 'vendor']) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
rmSync(join(OUT, 'src/renderer/android-bridge.js'), { force: true });
const model = 'models/quran-asr-tiny';
if (!existsSync(join(ROOT, model, 'model.int8.onnx'))) throw new Error('Speech model missing: run "npm run model" first.');
mkdirSync(join(OUT, model), { recursive: true });
for (const f of ['model.int8.onnx', 'tokens.txt', 'LICENSE']) cpSync(join(ROOT, model, f), join(OUT, model, f));
mkdirSync(join(OUT, 'docs'), { recursive: true });
cpSync(join(ROOT, 'docs/logo.png'), join(OUT, 'docs/logo.png'));
for (const f of ['web-bridge.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) cpSync(join(ROOT, 'web', f), join(OUT, f));

// Point every absolute reference (/src/..., /data/..., ) at the base path. Only our own code, never vendor/model/data.
const RE = /(['"`(])\/(src|data|vendor|models|docs)\//g;
const rewrite = (file) => {
  const t = readFileSync(file, 'utf8');
  const r = t.replace(RE, `$1${base}$2/`);
  if (r !== t) writeFileSync(file, r);
};
const walk = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (['.js', '.mjs', '.css', '.html'].includes(extname(p))) rewrite(p);
  }
};
walk(join(OUT, 'src'));

let html = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8');
const tag = '<script type="module" src="/src/renderer/app.js"></script>';
if (!html.includes(tag)) throw new Error('index.html changed: app script tag not found');
html = html.replace(RE, `$1${base}$2/`);
const tag2 = `<script type="module" src="${base}src/renderer/app.js"></script>`;
html = html.replace(tag2, `<script>window.__SAMIA_WEB__ = ${JSON.stringify({ version: pkg.version })};</script>\n  <script src="${base}web-bridge.js"></script>\n  ${tag2}`);
html = html.replace('<link rel="icon"', `<link rel="manifest" href="${base}manifest.webmanifest">\n  <meta name="theme-color" content="#0b1215">\n  <link rel="icon"`);
writeFileSync(join(OUT, 'index.html'), html);
const list = (dir, rel = '') => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n), r = rel + n;
  return statSync(p).isDirectory() ? list(p, r + '/') : [r];
});
const files = list(OUT).filter((f) => !['sw.js', '404.html', '.nojekyll'].includes(f));
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(ROOT, 'web/sw.js'), 'utf8')
  .replace('__VERSION__', pkg.version).replace('__FILES__', JSON.stringify(files)));
writeFileSync(join(OUT, '404.html'), html);
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`web-dist ready (version ${pkg.version}, base ${base})`);
