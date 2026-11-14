// One-off: builds data/quran/madani.json (15-line Madinah mushaf layout) from the @quran.ws/text Hafs dataset
// (CC BY 4.0; text and font from the King Fahd Complex). Usage: node tools/build-madani.mjs <path to node_modules/@quran.ws/text/data>
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const src = process.argv[2];
const h = JSON.parse(readFileSync(join(src, 'hafs.json'), 'utf8'));
const before = new Map(), after = new Map();
for (const [pos, t] of h.marks) {
  const mt = h.mark_types[t];
  const m = mt.side === 'before' ? before : after;
  m.set(pos, (m.get(pos) || '') + mt.sign);
}
const words = h.words.map((w, i) => (before.get(i) || '') + w + (after.get(i) || ''));
const out = {
  note: 'Madinah mushaf layout: words (with waqf signs), line starts, page starts, ayah starts, surah starts (word indexes). Source: quran.ws/text (CC BY 4.0), text and font KFGQPC.',
  words, lines: h.line_starts, pages: h.page_starts, ayahStart: h.ayah_starts, surahStart: h.surah_starts,
  bsm: h.surahs.map((s) => s.has_basmalah),
};
writeFileSync('data/quran/madani.json', JSON.stringify(out));
copyFileSync(join(src, 'UthmanicHafs-v-3.0.ttf'), 'data/quran/UthmanicHafs-v-3.0.ttf');
console.log(words.length, 'words,', h.line_starts.length, 'lines');
