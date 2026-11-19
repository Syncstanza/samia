// Listen mode, the parts that need no screen: reading the Quran.com audio service's answers and turning
// them into "which word is being recited now" for a point in the audio.
//
// Audio comes ayah by ayah from the Quran.com content API (api.quran.com/api/v4), the same recordings and
// word timings Quran.com uses. A recording's word timings ("segments") are [word number from 1, start ms,
// end ms]. When a recording has none (or they do not match the words we show) the words are spread over the
// ayah's length by their letters, which is close for a steady recitation.

export const API = 'https://api.quran.com/api/v4';
export const AUDIO_BASE = 'https://verses.quran.com/';

/** Full URL of an ayah recording as the API gives it (relative to verses.quran.com, or already absolute). */
export function audioUrl(path) {
  if (!path) return '';
  return /^https?:\/\//.test(path) ? path : path.startsWith('//') ? 'https:' + path : AUDIO_BASE + path.replace(/^\/+/, '');
}

/** The API's recitation list → [{id, name, style}] (names as shown to people). */
export function parseReciters(json) {
  const list = (json && json.recitations) || [];
  return list
    .filter((r) => r && Number.isInteger(r.id))
    .map((r) => ({
      id: r.id,
      name: (r.translated_name && r.translated_name.name) || r.reciter_name || `Reciter ${r.id}`,
      style: r.style || '',
    }));
}

/** A chapter's recitation files → Map(verse_key → {url, segments}). */
export function parseChapterAudio(json) {
  const out = new Map();
  for (const f of (json && json.audio_files) || []) {
    if (!f || !f.verse_key || !f.url) continue;
    out.set(f.verse_key, { url: audioUrl(f.url), segments: f.segments || null });
  }
  return out;
}

/**
 * Word timings for an ayah of `words` words: [{from, to}] in ms, or null when the recording's segments do
 * not describe these words well enough to trust.
 */
export function timingsFromSegments(segments, words) {
  if (!Array.isArray(segments) || !words) return null;
  const t = new Array(words).fill(null);
  let covered = 0;
  for (const s of segments) {
    if (!Array.isArray(s) || s.length < 3) continue;
    const [i, from, to] = s;
    if (!Number.isInteger(i) || i < 1 || i > words || !(to >= from) || !(from >= 0)) continue;
    if (!t[i - 1]) covered++;
    t[i - 1] = { from, to };
  }
  if (covered < Math.ceil(words * 0.75)) return null;
  // Fill any word without timing from its neighbours so there are no holes.
  for (let k = 0; k < words; k++) {
    if (t[k]) continue;
    const prev = k ? t[k - 1].to : 0;
    let next = k + 1;
    while (next < words && !t[next]) next++;
    t[k] = { from: prev, to: next < words ? t[next].from : prev };
  }
  for (let k = 1; k < words; k++) if (t[k].from < t[k - 1].from) return null; // out of order: not trustworthy
  return t;
}

/** Spread an ayah's words over `durationMs` by their letters (`ends` = cumulative letters per word). */
export function timingsFromLetters(ends, durationMs) {
  const total = ends[ends.length - 1] || 1;
  return ends.map((e, k) => ({ from: ((k ? ends[k - 1] : 0) / total) * durationMs, to: (e / total) * durationMs }));
}

/** The word being recited at `ms` (-1 before the first word starts). */
export function wordAt(timings, ms) {
  let lo = 0, hi = timings.length - 1, k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid].from <= ms) { k = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return k;
}

/** The letter count to give the highlighter so that word `k` is the one lit (see light() in app.js). */
export function letterForWord(ends, k) {
  if (k < 0) return 0;
  const start = k ? ends[k - 1] : 0;
  return start + Math.min(2, ends[k] - start - 1) + 1;
}

// A second source in case the Quran.com service is not reachable: everyayah.com's ayah-by-ayah recordings
// (no word timings, so the words are spread over each ayah by their letters).
export const EVERYAYAH = [
  { id: 'ea:Alafasy_128kbps', name: 'Mishari Alafasy' },
  { id: 'ea:Husary_128kbps', name: 'Mahmoud Khalil Al-Husary' },
  { id: 'ea:Abdul_Basit_Murattal_192kbps', name: 'AbdulBaset AbdulSamad (Murattal)' },
  { id: 'ea:Abdurrahmaan_As-Sudais_192kbps', name: 'Abdur-Rahman as-Sudais' },
  { id: 'ea:Saood_ash-Shuraym_128kbps', name: "Sa'ud ash-Shuraym" },
  { id: 'ea:Minshawy_Murattal_128kbps', name: 'Mohamed Siddiq al-Minshawi (Murattal)' },
  { id: 'ea:Hudhaify_128kbps', name: 'Ali al-Hudhaify' },
];
const pad3 = (n) => String(n).padStart(3, '0');
export const everyAyahUrl = (folder, surah, ayah) => `https://everyayah.com/data/${folder}/${pad3(surah)}${pad3(ayah)}.mp3`;
/** Map(verse_key → {url, segments:null}) for a whole surah from everyayah.com. */
export function everyAyahChapter(folder, surah, ayat) {
  const m = new Map();
  for (let a = 1; a <= ayat; a++) m.set(`${surah}:${a}`, { url: everyAyahUrl(folder, surah, a), segments: null });
  return m;
}

/** The everyayah.com folder that carries the same reciter as a Quran.com recitation id, when there is one. */
export const EVERYAYAH_FOR = {
  7: 'Alafasy_128kbps', 6: 'Husary_128kbps', 3: 'Abdurrahmaan_As-Sudais_192kbps',
  10: 'Saood_ash-Shuraym_128kbps', 2: 'Abdul_Basit_Murattal_192kbps', 9: 'Minshawy_Murattal_128kbps',
};
