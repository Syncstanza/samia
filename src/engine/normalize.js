// Arabic normalisation used ONLY for speech matching, in memory.
// The displayed text is always the verbatim Tanzil text.
//
// Both the Quran text and the speech-recognition output go through this, so
// differences in spelling (Uthmani vs. standard), diacritics, hamza forms and
// word spacing don't matter. The result is a string of bare letters, no spaces.

// Diacritics, Quranic annotation marks (small letters, pause marks, madda),
// tatweel, and invisible direction / joiner characters.
const DROP = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ​-‏؜﻿]/g;

const MAP = {
  'آ': 'ا', // آ -> ا
  'أ': 'ا', // أ -> ا
  'إ': 'ا', // إ -> ا
  'ٱ': 'ا', // ٱ (alef wasla) -> ا
  'ٲ': 'ا',
  'ٳ': 'ا',
  'ى': 'ي', // ى -> ي
  'ی': 'ي', // Farsi yeh -> ي
  'ة': 'ه', // ة -> ه
  'ؤ': 'و', // ؤ -> و
  'ئ': 'ي', // ئ -> ي
  'ء': '',       // ء dropped (spelled inconsistently)
  'ک': 'ك', // Farsi kaf -> ك
};

const KEEP = /[ا-ي]/; // ا .. ي (after mapping)

export function normalize(text) {
  if (!text) return '';
  const stripped = text.normalize('NFC').replace(DROP, '');
  let out = '';
  for (const ch of stripped) {
    const m = MAP[ch];
    const c = m === undefined ? ch : m;
    if (c && KEEP.test(c) && c !== 'ـ') out += c;
  }
  return out;
}
