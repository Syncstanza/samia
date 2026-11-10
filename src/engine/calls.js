// What the imam says aloud besides the Quran, and how to recognise each one
// from the letters the speech model heard for one separate utterance.

import { normalize } from './normalize.js';
import { align } from './align.js';

export const CALLS = [
  { type: 'takbir', text: 'الله اكبر' },
  { type: 'tasmi', text: 'سمع الله لمن حمده' },
  { type: 'tahmid', text: 'ربنا ولك الحمد' },
  { type: 'ameen', text: 'امين' },
  { type: 'salam', text: 'السلام عليكم ورحمة الله' },
].map((c) => ({ ...c, norm: normalize(c.text) }));

/**
 * Which call is this utterance, if any? `letters` must be ONE utterance
 * (speech between two pauses), already normalised. Returns {type, score} or null.
 * A call has to make up nearly the whole utterance: "الله أكبر" inside a
 * longer stretch of recitation is not a call.
 */
export function classifyUtterance(letters, { minScore = 0.65 } = {}) {
  if (!letters || letters.length < 3) return null;
  let best = null;
  for (const c of CALLS) {
    if (letters.length > c.norm.length * 1.6 + 3) continue; // much longer than the call: recitation
    const fwd = align(c.norm, letters, 0, letters.length).norm;   // the call is in what was heard
    const back = align(letters, c.norm, 0, c.norm.length).norm;  // what was heard is the call
    const score = Math.min(fwd, back + 0.15);
    if (score >= minScore && (!best || score > best.score)) best = { type: c.type, score: +score.toFixed(2) };
  }
  return best;
}
