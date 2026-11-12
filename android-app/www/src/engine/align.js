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
 * @param {number} mark  count ref letters in [mark, markEnd) that the path
 *   doesn't match exactly (skipped, or paired with a different letter);
 *   -1 = don't count
 * @param {number} markEnd
 * @param {number} tailFree  the last this-many query letters may be left out
 *   for free (the speech model running ahead of the reciter)
 * @returns {{score:number, norm:number, start:number, end:number, missed:number, lastMatch:number}}
 *   lastMatch: offset just after the last ref letter the path matched exactly
 *   start/end are absolute offsets into ref; norm is score / best possible.
 */
export function align(query, ref, from, to, prefer = -1, penalty = 0, slack = 0, mark = -1, markEnd = Infinity, tailFree = 0) {
  const q = query.length;
  from = Math.max(0, from);
  to = Math.min(ref.length, to);
  const n = to - from;
  if (q === 0 || n <= 0) return { score: -Infinity, norm: -Infinity, start: -1, end: -1, missed: 0, lastMatch: -1 };

  // prev/cur rows over reference positions 0..n; track start of each path.
  let prev = new Int32Array(n + 1);      // row 0: free start anywhere -> 0
  let prevStart = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  let curStart = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prevStart[j] = j;
  let prevSkip = new Int32Array(n + 1), curSkip = new Int32Array(n + 1);
  let prevLast = new Int32Array(n + 1).fill(-1), curLast = new Int32Array(n + 1).fill(-1);
  const markJ = mark < 0 ? Infinity : mark - from; // ref columns [markJ, markZ) are counted
  const markZ = markEnd - from;
  const counted = (j) => j - 1 >= markJ && j - 1 < markZ;

  // Best end: any ref position in the last row, or (tailFree) in the last few
  // rows, leaving the rest of the query out.
  let best = -Infinity, bestJ = 0, bestRaw = -Infinity, bestStart = 0, bestSkip = 0, bestLast = -1;
  const consider = (row, rowStart, rowSkip, rowLast) => {
    for (let j = 0; j <= n; j++) {
      const dist = prefer >= 0 ? Math.abs(from + j - prefer) : 0;
      const v = row[j] - (penalty ? penalty * Math.max(0, dist - slack) : 0);
      if (v > best || (v === best && prefer >= 0 && dist < Math.abs(from + bestJ - prefer))) {
        best = v; bestJ = j; bestRaw = row[j]; bestStart = rowStart[j]; bestSkip = rowSkip[j]; bestLast = rowLast[j];
      }
    }
  };

  for (let i = 1; i <= q; i++) {
    const qc = query.charCodeAt(i - 1);
    cur[0] = prev[0] + GAP; // query letter with nothing in ref
    curStart[0] = prevStart[0]; curSkip[0] = prevSkip[0]; curLast[0] = prevLast[0];
    for (let j = 1; j <= n; j++) {
      const diag = prev[j - 1] + (ref.charCodeAt(from + j - 1) === qc ? MATCH : MISMATCH);
      const up = prev[j] + GAP;      // extra letter in query (insertion)
      const left = cur[j - 1] + GAP; // letter skipped in ref (deletion)
      if (diag >= up && diag >= left) {
        const same = ref.charCodeAt(from + j - 1) === qc;
        cur[j] = diag; curStart[j] = prevStart[j - 1];
        curSkip[j] = prevSkip[j - 1] + (counted(j) && !same ? 1 : 0);
        curLast[j] = same ? j : prevLast[j - 1];
      }
      else if (up >= left) { cur[j] = up; curStart[j] = prevStart[j]; curSkip[j] = prevSkip[j]; curLast[j] = prevLast[j]; }
      else { cur[j] = left; curStart[j] = curStart[j - 1]; curSkip[j] = curSkip[j - 1] + (counted(j) ? 1 : 0); curLast[j] = curLast[j - 1]; }
    }
    if (tailFree && i >= q - tailFree && i < q) consider(cur, curStart, curSkip, curLast);
    [prev, cur] = [cur, prev];
    [prevStart, curStart] = [curStart, prevStart];
    [prevSkip, curSkip] = [curSkip, prevSkip];
    [prevLast, curLast] = [curLast, prevLast];
  }

  consider(prev, prevStart, prevSkip, prevLast); // the full query
  return { score: bestRaw, norm: bestRaw / (MATCH * q), start: from + bestStart, end: from + bestJ, missed: bestSkip, lastMatch: bestLast < 0 ? -1 : from + bestLast };
}
