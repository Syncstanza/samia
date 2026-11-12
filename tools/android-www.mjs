// Builds android-app/www: the same web app the desktop version shows, laid out the
// way the Android shell (Capacitor) serves it from https://localhost/.
// Usage: node tools/android-www.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'android-app', 'www');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const dir of ['src/renderer', 'src/engine', 'data', 'vendor']) {
  cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
}
const model = 'models/quran-asr-tiny';
if (!existsSync(join(ROOT, model, 'model.int8.onnx'))) throw new Error('Speech model missing: run "npm run model" first.');
mkdirSync(join(OUT, model), { recursive: true });
for (const f of ['model.int8.onnx', 'tokens.txt', 'LICENSE']) cpSync(join(ROOT, model, f), join(OUT, model, f));
mkdirSync(join(OUT, 'docs'), { recursive: true });
cpSync(join(ROOT, 'docs/logo.png'), join(OUT, 'docs/logo.png'));

// The page itself: same index.html, plus the small Android bridge before the app starts.
let html = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8');
const tag = '<script type="module" src="/src/renderer/app.js"></script>';
if (!html.includes(tag)) throw new Error('index.html changed: app script tag not found');
html = html.replace(
  tag,
  `<script>window.__SAMIA_ANDROID__ = ${JSON.stringify({ version: pkg.version })};</script>\n  <script src="/src/renderer/android-bridge.js"></script>\n  ${tag}`,
);
writeFileSync(join(OUT, 'index.html'), html);
console.log(`android-app/www ready (version ${pkg.version})`);
