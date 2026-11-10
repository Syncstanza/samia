// Builds data/quran/quran.json from the Tanzil text and translation.
//
// Source: the `quran-json@1.0.1` npm package, which carries the Tanzil
// Uthmani text and the Saheeh International translation (both from tanzil.net).
// Juz boundaries come from `quran-meta` (MIT).
//
// The Arabic text is copied VERBATIM. Tanzil's terms do not allow changing it,
// so any normalising for speech matching happens in memory at runtime
// (src/engine/normalize.js) and is never written to disk or shown.
//
// Usage: node tools/build-quran-data.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quran } from 'quran-meta';
import { normalize } from '../src/engine/normalize.js';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = dirname(require.resolve('quran-json/package.json'));

const verses = JSON.parse(readFileSync(join(pkgDir, 'json/quran/en.json'), 'utf8'));
const surahsSrc = JSON.parse(readFileSync(join(pkgDir, 'json/surahs.json'), 'utf8'));

const TANZIL_NOTICE = [
  'Tanzil Quran Text (Uthmani). Copyright (C) Tanzil Project. License: Creative Commons Attribution 3.0.',
  'This copy of the Quran text is carefully produced, highly verified and continuously monitored by a group of specialists in Tanzil Project.',
  'TERMS OF USE:',
  '- Permission is granted to copy and distribute verbatim copies of this text, but CHANGING IT IS NOT ALLOWED.',
  '- This Quran text can be used in any website or application, provided that its source (Tanzil Project) is clearly indicated, and a link is made to tanzil.net to enable users to keep track of changes.',
  '- This copyright notice shall be included in all verbatim copies of the text, and shall be reproduced appropriately in all files derived from or containing substantial portion of this text.',
  'Please check updates at: http://tanzil.net/updates/',
];

const TRANSLATION_NOTICE = [
  'Translation: Saheeh International (English), via tanzil.net/trans/en.sahih.',
  'Tanzil translations are provided for non-commercial purposes only. Sami\'a is free and non-commercial.',
];

// --- checks -----------------------------------------------------------------
if (verses.length !== 6236) throw new Error(`expected 6236 ayat, got ${verses.length}`);
if (surahsSrc.length !== 114) throw new Error(`expected 114 surahs, got ${surahsSrc.length}`);

const BISMILLAH = verses[0].text; // 1:1
const surahs = surahsSrc.map((s) => {
  const meta = quran.getSurahMeta(s.number);
  if (meta.ayahCount !== s.total_verses) throw new Error(`ayah count mismatch in surah ${s.number}`);
  return {
    n: s.number,
    name: s.name,
    translit: s.transliteration_en,
    en: s.translation_en,
    ayahs: s.total_verses,
    makki: s.revelation_type === 'Meccan',
    // Tanzil puts the bismillah at the start of ayah 1 of every surah except 1 and 9.
    // The display shows it as a header line instead (dropping the first 4 words of
    // ayah 1 on screen); the stored text itself is unchanged.
    bismillahPrefix: s.number !== 1 && s.number !== 9,
  };
});

let prev = 0;
const ayat = verses.map((v, i) => {
  const s = v.surah_number;
  const a = v.verse_number;
  if (s < prev) throw new Error('verses out of order');
  prev = s;
  // Check by words, not exact characters: Tanzil writes 95:1 and 97:1 with an
  // extra shadda on the first letter. The display drops the first 4 words.
  const first4 = v.text.split(' ').slice(0, 4).join(' ');
  if (surahs[s - 1].bismillahPrefix && a === 1 && normalize(first4) !== normalize(BISMILLAH)) {
    throw new Error(`expected bismillah prefix on ${s}:1`);
  }
  return [s, a, v.text, v.translation];
});

const juz = [];
for (let j = 1; j <= 30; j++) {
  const m = quran.getJuzMeta(j);
  juz.push({ juz: j, start: m.first, end: m.last });
}

const out = {
  _notice: TANZIL_NOTICE,
  _translationNotice: TRANSLATION_NOTICE,
  format: 1,
  text: { source: 'Tanzil', url: 'https://tanzil.net', script: 'uthmani' },
  translation: { id: 'en.sahih', name: 'Saheeh International', lang: 'en', url: 'https://tanzil.net/trans/en.sahih' },
  bismillah: BISMILLAH,
  surahs,
  juz,
  // [surah, ayah, arabic (verbatim Tanzil), translation]
  ayat,
};

const dest = join(root, 'data/quran/quran.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest}: ${ayat.length} ayat, ${surahs.length} surahs, ${juz.length} juz`);
