// Downloads the Quran speech model into models/quran-asr-tiny/ (not committed).
// Model: Abdou/quran-asr-tiny on Hugging Face (MIT license), int8, ~18 MB.
//
// Usage: node tools/download-model.mjs

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'Abdou/quran-asr-tiny';
const REV = 'main';
const DEST = join(ROOT, 'models', 'quran-asr-tiny');
const FILES = [
  { name: 'model.int8.onnx', sha256: '58de6db034bb4f6516b3bc1c68e7a0ac4e77abffe603a550ee87b39dcd0c7ac6' },
  { name: 'tokens.txt' },
  { name: 'LICENSE' },
];

mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  const out = join(DEST, f.name);
  if (existsSync(out) && statSync(out).size > 0 && !f.sha256) { console.log(`ok   ${f.name}`); continue; }
  const url = `https://huggingface.co/${REPO}/resolve/${REV}/${f.name}`;
  process.stdout.write(`get  ${f.name} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (f.sha256) {
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== f.sha256) throw new Error(`${f.name}: checksum mismatch (${got})`);
  }
  writeFileSync(out, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
console.log(`Model ready in ${DEST}`);
