// Builds the in-memory matching index from data/quran/quran.json.
//
//   letters     one string of every normalised letter in the Quran, in order
//   ayahOf      Int16Array: letter offset -> global ayah index (0..6235)
//   ayahStart   Int32Array: global ayah index -> first letter offset (length 6237)
//   grams       Map: 4-letter gram -> Int32Array of offsets (for searching)

import { normalize } from './normalize.js';

export const GRAM = 4;

export function buildIndex(data) {
  const { ayat, bismillah, surahs } = data;
  const parts = [];
  const ayahStart = new Int32Array(ayat.length + 1);
  let pos = 0;

  const bismillahNorm = normalize(bismillah);

  for (let i = 0; i < ayat.length; i++) {
    const [s, a, ar] = ayat[i];
    let norm = normalize(ar);
    // The bismillah heading each surah (except 1 and 9) isn't part of ayah 1 for
    // matching: imams often say it silently, and 113 copies would confuse search.
    if (a === 1 && surahs[s - 1].bismillahPrefix) {
      const rest = ar.split(' ').slice(4).join(' ');
      if (normalize(ar.split(' ').slice(0, 4).join(' ')) === bismillahNorm) norm = normalize(rest);
    }
    ayahStart[i] = pos;
    parts.push(norm);
    pos += norm.length;
  }
  ayahStart[ayat.length] = pos;

  const letters = parts.join('');
  const ayahOf = new Int16Array(letters.length);
  for (let i = 0; i < ayat.length; i++) ayahOf.fill(i, ayahStart[i], ayahStart[i + 1]);

  // 4-gram -> offsets
  const tmp = new Map();
  for (let p = 0; p + GRAM <= letters.length; p++) {
    const g = letters.substr(p, GRAM);
    let arr = tmp.get(g);
    if (!arr) tmp.set(g, (arr = []));
    arr.push(p);
  }
  const grams = new Map();
  for (const [g, arr] of tmp) grams.set(g, Int32Array.from(arr));

  // ayah ref helpers
  const ref = (i) => ({ index: i, surah: ayat[i][0], ayah: ayat[i][1] });
  const indexOf = (surah, ayah) => {
    let lo = 0, hi = ayat.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [s, a] = ayat[mid];
      if (s === surah && a === ayah) return mid;
      if (s < surah || (s === surah && a < ayah)) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };

  // Letter range of each surah, for keeping to the surah being recited.
  const surahRange = (i) => {
    const s = ayat[i][0];
    let a = i, z = i;
    while (a > 0 && ayat[a - 1][0] === s) a--;
    while (z + 1 < ayat.length && ayat[z + 1][0] === s) z++;
    return { lo: ayahStart[a], hi: ayahStart[z + 1] ?? letters.length, first: a, last: z };
  };
  return { letters, ayahOf, ayahStart, grams, count: ayat.length, ref, indexOf, surahRange, fatihaEnd: ayahStart[7] };
}
