// The opening of every turn: a'udhu billah, then Bismillah. Hearing either one proves the
// microphone works and the reciter has begun. Matching is forgiving (the speech model
// was trained on the Quran, so the a'udhu line in particular can come out a little off).
import { normalize } from './normalize.js';

export const TAAWWUDH = 'أعوذ بالله من الشيطان الرجيم';
export const BASMALA = 'بسم الله الرحمن الرحيم';
const T = normalize(TAAWWUDH);
const B = normalize(BASMALA);

/** How much of `target` (0..1) is found somewhere inside `heard` (letters only), allowing small errors. */
export function similarity(heard, target) {
  const m = target.length, n = heard.length;
  if (!m || !n) return 0;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = m; // the heard text may start anywhere and end anywhere
  for (let j = 1; j <= n; j++) {
    cur[0] = 0;
    for (let i = 1; i <= m; i++) {
      const sub = prev[i - 1] + (target.charCodeAt(i - 1) === heard.charCodeAt(j - 1) ? 0 : 1);
      cur[i] = Math.min(sub, prev[i] + 1, cur[i - 1] + 1);
    }
    if (cur[m] < best) best = cur[m];
    [prev, cur] = [cur, prev];
  }
  return 1 - best / m;
}

const NEED = 0.6;

/** What has been heard of the opening so far. */
export function heardOpening(text) {
  const heard = normalize(text);
  return { taawwudh: similarity(heard, T) >= NEED, basmala: similarity(heard, B) >= NEED };
}
