// Tajweed colours. Rule ranges per ayah come from data/quran/tajweed.json (cpfair/quran-tajweed, CC BY 4.0),
// as offsets in the Tanzil text. Other spellings of the same ayah (the Madinah mushaf page text) are
// matched letter by letter, so the colours land on the right letters there too.

const MARK = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/;
const isBase = (c) => c !== ' ' && !MARK.test(c);

const cache = new Map();
let T = null, loading = null;
export const tajweedReady = () => !!T;
export const setTajweedData = (j) => { T = j; cache.clear(); }; // for tests
export const ruleName = (code) => (code ? T.rules[code - 1] : null);
export function loadTajweed() {
  if (!loading) loading = fetch('/data/quran/tajweed.json').then((r) => r.json()).then((j) => { T = j; return j; }).catch((e) => { loading = null; console.warn('tajweed: ' + e.message); });
  return loading;
}

// When two rules cover the same letter the stronger one wins (silent letters are the weakest).
const WEAK = new Set(['hamzat_wasl', 'lam_shamsiyyah', 'silent']);
const MADD = new Set(['madd_2', 'madd_246', 'madd_muttasil', 'madd_munfasil', 'madd_6']);
const strength = (r) => (WEAK.has(r) ? 1 : MADD.has(r) ? 2 : 3);


// Needleman-Wunsch over base letters: where each letter of `a` sits in `b` (or -1).
function alignBase(a, b) {
  const n = a.length, m = b.length, W = m + 1;
  const sc = new Int16Array((n + 1) * W);
  const tb = new Uint8Array((n + 1) * W); // 1 diag, 2 up (skip a), 3 left (skip b)
  for (let i = 1; i <= n; i++) { sc[i * W] = -i; tb[i * W] = 2; }
  for (let j = 1; j <= m; j++) { sc[j] = -j; tb[j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = sc[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 2 : -1);
      const u = sc[(i - 1) * W + j] - 1, l = sc[i * W + j - 1] - 1;
      let best = d, t = 1;
      if (u > best) { best = u; t = 2; }
      if (l > best) { best = l; t = 3; }
      sc[i * W + j] = best; tb[i * W + j] = t;
    }
  }
  const map = new Int32Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const t = tb[i * W + j];
    if (t === 1) { map[i - 1] = j - 1; i--; j--; } else if (t === 2) i--; else j--;
  }
  return map;
}

/**
 * Rule index (+1; 0 = none) for every base letter of `text`, the ayah `index` in some spelling.
 * `tanzil` is the Tanzil text of that ayah (what the data's offsets refer to).
 */
export function ruleMap(index, text, tanzil, key) {
  if (!T) return null;
  const ck = key + index;
  let out = cache.get(ck);
  if (out) return out;
  const tBase = [];
  const tPos = []; // base-letter number of each codepoint of the Tanzil text
  for (const c of tanzil) { tPos.push(tBase.length); if (isBase(c)) tBase.push(c); }
  tPos.push(tBase.length);
  const rulesOfT = new Uint8Array(tBase.length);
  const flat = T.ayat[index];
  for (let k = 0; k < flat.length; k += 3) {
    const r = T.rules[flat[k + 2]];
    const from = tPos[flat[k]], to = tPos[Math.min(flat[k + 1], tPos.length - 1)];
    for (let b = from; b < to; b++) {
      const cur = rulesOfT[b] ? T.rules[rulesOfT[b] - 1] : null;
      if (!cur || strength(r) >= strength(cur)) rulesOfT[b] = flat[k + 2] + 1;
    }
  }
  const bBase = [...text].filter(isBase);
  if (bBase.length === tBase.length) out = rulesOfT;
  else {
    out = new Uint8Array(bBase.length);
    const toB = alignBase(tBase, bBase);
    for (let i = 0; i < tBase.length; i++) if (toB[i] >= 0 && rulesOfT[i]) out[toB[i]] = rulesOfT[i];
  }
  cache.set(ck, out);
  return out;
}

/** Number of base letters in a string. */
export const baseCount = (s) => { let n = 0; for (const c of s) if (isBase(c)) n++; return n; };

/**
 * Fill `el` with `word`, its letters coloured by rule. `rules` is a ruleMap result and `baseStart` the number
 * of base letters before this word in the ayah. Without rules, plain text.
 */
export function paintWord(el, word, rules, baseStart) {
  if (!rules || !T) { el.textContent = word; return; }
  let b = baseStart - 1, cur = null, buf = '';
  const flush = () => {
    if (!buf) return;
    if (cur) { const i = document.createElement('i'); i.className = `tj tj-${cur}`; i.textContent = buf; el.append(i); } else el.append(buf);
    buf = '';
  };
  el.replaceChildren();
  for (const c of word) {
    if (isBase(c)) b++;
    const r = b >= baseStart && rules[b] ? T.rules[rules[b] - 1] : null; // marks follow the letter they sit on
    if (r !== cur) { flush(); cur = r; }
    buf += c;
  }
  flush();
}
