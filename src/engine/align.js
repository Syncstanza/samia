// Semi-global alignment: the whole query (recent recognised letters) must be
// used, but it can start and end anywhere inside the reference window.
// Small inputs (query <= ~48, window <= ~1000), so plain DP is fast enough
// (tens of thousands of cells per call).

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

/**
 * @param {string} query
 * @param {string} ref
 * @param {number} from  start offset into ref (inclusive)
 * @param {number} to    end offset into ref (exclusive)
 * @param {number} [prefer] absolute offset: on equal scores, pick the end closest to it
 *   (the Quran repeats lines, e.g. the refrain of ar-Rahman, so ties are real)
 * @param {number} [penalty] score lost per letter the end is away from `prefer`
 *   (beyond `slack` letters). Keeps the position moving smoothly forward
 *   instead of hopping to a matching phrase elsewhere in the window.
 * @param {number} [slack]
 * @returns {{score:number, norm:number, start:number, end:number}}
 *   start/end are absolute offsets into ref; norm is score / best possible.
 */
export function align(query, ref, from, to, prefer = -1, penalty = 0, slack = 0) {
  const q = query.length;
  from = Math.max(0, from);
  to = Math.min(ref.length, to);
  const n = to - from;
  if (q === 0 || n <= 0) return { score: -Infinity, norm: -Infinity, start: -1, end: -1 };

  // prev/cur rows over reference positions 0..n; track start of each path.
  let prev = new Int32Array(n + 1);      // row 0: free start anywhere -> 0
  let prevStart = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  let curStart = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prevStart[j] = j;

  for (let i = 1; i <= q; i++) {
    const qc = query.charCodeAt(i - 1);
    cur[0] = prev[0] + GAP; // query letter with nothing in ref
    curStart[0] = prevStart[0];
    for (let j = 1; j <= n; j++) {
      const diag = prev[j - 1] + (ref.charCodeAt(from + j - 1) === qc ? MATCH : MISMATCH);
      const up = prev[j] + GAP;      // extra letter in query (insertion)
      const left = cur[j - 1] + GAP; // letter skipped in ref (deletion)
      if (diag >= up && diag >= left) { cur[j] = diag; curStart[j] = prevStart[j - 1]; }
      else if (up >= left) { cur[j] = up; curStart[j] = prevStart[j]; }
      else { cur[j] = left; curStart[j] = curStart[j - 1]; }
    }
    [prev, cur] = [cur, prev];
    [prevStart, curStart] = [curStart, prevStart];
  }

  // free end: best cell in last row
  let best = -Infinity, bestJ = 0, bestRaw = -Infinity;
  for (let j = 0; j <= n; j++) {
    const dist = prefer >= 0 ? Math.abs(from + j - prefer) : 0;
    const v = prev[j] - (penalty ? penalty * Math.max(0, dist - slack) : 0);
    if (v > best) { best = v; bestJ = j; bestRaw = prev[j]; }
    else if (v === best && prefer >= 0 && dist < Math.abs(from + bestJ - prefer)) { bestJ = j; bestRaw = prev[j]; }
  }
  return { score: bestRaw, norm: bestRaw / (MATCH * q), start: from + prevStart[bestJ], end: from + bestJ };
}
