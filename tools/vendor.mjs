// Copies the few runtime files the display needs out of node_modules into
// vendor/ (not committed), so the packaged app ships ~15 MB instead of the
// whole 140 MB onnxruntime package. Runs automatically after `npm install`.
import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');
const copies = [
  ['onnxruntime-web/dist/ort.wasm.min.mjs', 'ort/ort.wasm.min.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
  ['@fontsource/amiri-quran/index.css', 'fonts/amiri-quran.css'],
];
for (const f of readdirSync(join(NM, '@fontsource/amiri-quran/files'))) {
  if (f.endsWith('.woff2')) copies.push([`@fontsource/amiri-quran/files/${f}`, `fonts/files/${f}`]);
}
for (const [from, to] of copies) {
  mkdirSync(dirname(join(ROOT, 'vendor', to)), { recursive: true });
  copyFileSync(join(NM, from), join(ROOT, 'vendor', to));
}
// Only .woff2 is shipped, so drop the .woff fallbacks from the font CSS.
const css = join(ROOT, 'vendor/fonts/amiri-quran.css');
writeFileSync(css, readFileSync(css, 'utf8').replace(/, url\([^)]*\.woff\) format\('woff'\)/g, ''));
console.log(`vendor: ${copies.length} files`);
