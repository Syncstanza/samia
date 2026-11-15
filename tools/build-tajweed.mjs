// One-off: builds data/quran/tajweed.json from cpfair/quran-tajweed (CC BY 4.0) so the app ships a small file.
// Usage: node tools/build-tajweed.mjs <path to tajweed.hafs.uthmani-pause-sajdah.json>
import { readFileSync, writeFileSync } from 'node:fs';
const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rules = [];
const code = (r) => { let i = rules.indexOf(r); if (i < 0) { i = rules.length; rules.push(r); } return i; };
const ayat = src.map((e) => {
  const flat = [];
  for (const a of e.annotations.sort((x, y) => x.start - y.start)) flat.push(a.start, a.end, code(a.rule));
  return flat;
});
writeFileSync('data/quran/tajweed.json', JSON.stringify({
  note: 'Tajweed rule ranges per ayah (codepoint offsets in the Tanzil Uthmani text). Source: cpfair/quran-tajweed, CC BY 4.0.',
  rules, ayat,
}));
console.log(rules.join(','), src.length);
