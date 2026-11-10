// Follows the imam through the Quran.
//
// Feed it the letters the speech model recognised every ~0.5-1 s with push().
// It answers with the ayah to show. Rules:
//   - LOCKED: match the newest letters just around where the imam was. Moving
//     forward, staying, or stepping back a little (a repeated ayah) are all cheap.
//   - SEARCHING: if that keeps failing, look across the whole Quran. Only jump
//     when two checks in a row agree, and prefer places near the current khatm
//     position and al-Fatiha.
//   - Never guess: while unsure, keep showing the last ayah.
//   - al-Fatiha is tracked separately: after it ends, carry on from the saved
//     khatm position.

import { normalize } from './normalize.js';
import { align } from './align.js';
import { GRAM } from './quran-index.js';

// Things the imam says aloud that aren't Quran. When heard, the screen holds
// and the buffer is cleared so they can't push the position forward.
const CALLS = ['الله اكبر', 'سمع الله لمن حمده', 'ربنا ولك الحمد', 'امين', 'السلام عليكم ورحمة الله'].map(normalize);

const DEFAULTS = {
  maxQuery: 40,        // letters of recent speech to match
  minQuery: 12,        // don't decide on less than this
  lockAccept: 0.55,    // LOCKED: alignment quality to accept a step
  backAccept: 0.62,
  skipAccept: 0.68,    // LOCKED: quality needed to skip past the next ayah
  skipMinQuery: 24,    // ...and at least this many letters heard    // LOCKED: quality needed to step backwards (repeats)
  searchAccept: 0.65,  // SEARCHING: quality needed for a candidate
  fatihaSwitch: 0.7,   // LOCKED elsewhere -> jump into al-Fatiha
  fatihaProbe: 24,     // newest letters used for that check
  fatihaTail: 6,       // letters from the end of al-Fatiha that count as "finished"
  failsToSearch: 4,    // consecutive bad pushes before searching
  silenceClear: 3,     // empty pushes before forgetting the buffer
  back: 220,           // letters allowed backwards (repeats)
  fwd: 450,            // letters allowed forwards
  ambiguityGap: 0.06,  // top-2 candidates closer than this = ambiguous
  maxGramHits: 1500,   // ignore very common 4-grams when voting
  callMatch: 0.7,
  coldMinQuery: 30,    // letters needed before a cold-start search may lock      // how closely a takbir / "Ameen" must match to count
};

export class Tracker {
  constructor(index, options = {}) {
    this.ix = index;
    this.o = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.state = 'SEARCHING';
    this.buf = '';
    this.pos = -1;        // letter offset just after the last matched letter
    this.khatmPos = -1;   // saved position outside al-Fatiha
    this.shown = -1;      // global ayah index on screen (-1 = none)
    this.fails = 0;
    this.silence = 0;
    this.pending = null;  // search candidate waiting for confirmation
    this.confidence = 0;
    this.lastAdd = 0;
    this.cleared = false;
  }

  /** Tell it where tonight starts (e.g. first ayah of the juz). */
  setStart(surah, ayah) {
    const i = this.ix.indexOf(surah, ayah);
    if (i < 0) throw new Error(`no such ayah ${surah}:${ayah}`);
    this.khatmPos = this.ix.ayahStart[i];
    this.pos = this.khatmPos;
    this.state = 'LOCKED';
    this.fails = 0;
    this._clear();
  }

  /** Manual override: show this global ayah index and continue from it. */
  jumpTo(index) {
    const i = Math.max(0, Math.min(this.ix.count - 1, index));
    this.pos = this.ix.ayahStart[i];
    if (this.pos >= this.ix.fatihaEnd) this.khatmPos = this.pos;
    this.shown = i;
    this.state = 'LOCKED';
    this.fails = 0;
    this._clear();
    this.pending = null;
    return this._result(true);
  }
  next() { return this.jumpTo(this.shown + 1); }
  prev() { return this.jumpTo(this.shown - 1); }

  /** Feed newly recognised text (only the new part). Returns what to display. */
  push(text) {
    const add = normalize(text);
    if (!add) return this._silent();
    this.lastAdd = add.length;
    return this._step((this.buf + add).slice(-this.o.maxQuery));
  }

  /**
   * Live mode: feed the transcript of the last few seconds of audio (a sliding
   * window), every hop. newFraction = share of the window that is new audio.
   * When the result says clearAudio, drop the audio heard so far, so stale
   * words (a takbir, the end of al-Fatiha) aren't heard again.
   */
  observe(windowText, newFraction = 0.2) {
    const all = normalize(windowText);
    if (!all) return this._silent();
    this.lastAdd = Math.max(1, Math.round(all.length * newFraction));
    return this._step(all.slice(-this.o.maxQuery));
  }

  /** Nothing recognised (silence) for one hop. */
  _silent() {
    if (++this.silence >= this.o.silenceClear && this.buf) this._clear();
    return this._result(false);
  }

  _clear() {
    this.buf = '';
    this.cleared = true;
  }

  _step(buf) {
    this.silence = 0;
    this.buf = buf;
    if (this._heardCall()) {
      this._clear();
      return this._result(false);
    }
    if (this.buf.length < this.o.minQuery) return this._result(false);

    const before = this.shown;
    if (this.state === 'LOCKED') this._locked();
    else this._search();
    return this._result(this.shown !== before);
  }

  _heardCall() {
    for (const c of CALLS) {
      const tail = this.buf.slice(-(c.length + 4));
      if (tail.length < c.length - 1) continue;
      if (align(c, tail, 0, tail.length).norm >= this.o.callMatch) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- LOCKED
  _locked() {
    const { letters, ayahStart, ayahOf, fatihaEnd } = this.ix;
    const q = this.buf;
    const inFatiha = this.pos < fatihaEnd;

    // Window behind and ahead of the current position.
    const curAyah = Math.max(0, ayahOf[Math.max(0, this.pos - 1)]);
    const back = Math.max(this.o.back, this.pos - ayahStart[Math.max(0, curAyah - 1)]);
    let lo = this.pos - back - q.length;
    let hi = this.pos + this.o.fwd;
    if (inFatiha) { lo = 0; hi = fatihaEnd; }
    const r = align(q, letters, lo, hi, this.pos + this.lastAdd);

    // Going backwards (a repeated ayah) needs a clearer match than going on,
    // and so does skipping ahead past the next ayah: a common phrase
    // ("الذين آمنوا") appears every few ayat.
    const skip = ayahOf[Math.max(0, r.end - 1)] - curAyah;
    let need = this.o.lockAccept;
    if (r.end < this.pos - 10) need = this.o.backAccept;
    else if (skip >= 2) need = q.length >= this.o.skipMinQuery ? this.o.skipAccept : Infinity;
    if (r.norm >= need) {
      this._accept(r);
      return;
    }

    // Not matching here. A new rak'ah starting with al-Fatiha is the usual reason.
    // Check only the newest letters: older ones are still from before the takbir.
    if (!inFatiha) {
      const recent = q.slice(-this.o.fatihaProbe);
      const f = align(recent, letters, 0, fatihaEnd);
      if (f.norm >= this.o.fatihaSwitch) {
        this.buf = recent;
        this._accept(f);
        return;
      }
    }

    this.confidence = Math.max(0, r.norm);
    if (++this.fails >= this.o.failsToSearch) {
      this.state = 'SEARCHING';
      this.pending = null;
    }
  }

  _accept(r) {
    const { ayahOf, fatihaEnd } = this.ix;
    this.pos = r.end;
    this.fails = 0;
    this.confidence = r.norm;
    this.state = 'LOCKED';
    // Show the ayah containing the most recent matched letter.
    this.shown = ayahOf[Math.max(0, r.end - 1)];
    if (this.pos > fatihaEnd) {
      this.khatmPos = this.pos;
    } else if (this.pos >= fatihaEnd - this.o.fatihaTail) {
      // al-Fatiha finished: keep 1:7 on screen and carry on from the khatm
      // position with a clean buffer (so "Ameen" and Fatiha letters don't
      // confuse it). If we don't know the khatm position yet, search for it.
      this._clear();
      if (this.khatmPos >= 0) {
        this.pos = this.khatmPos;
      } else {
        this.state = 'SEARCHING';
        this.pending = null;
      }
    }
  }

  // ------------------------------------------------------------- SEARCHING
  _search() {
    const { letters, grams, fatihaEnd } = this.ix;
    const q = this.buf;
    const BUCKET = 32;

    // Vote: each 4-gram of the query points at where the query could start.
    const votes = new Map();
    for (let k = 0; k + GRAM <= q.length; k++) {
      const hits = grams.get(q.substr(k, GRAM));
      if (!hits || hits.length > this.o.maxGramHits) continue;
      for (let h = 0; h < hits.length; h++) {
        const b = Math.floor((hits[h] - k) / BUCKET);
        votes.set(b, (votes.get(b) || 0) + 1);
      }
    }
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    // Also always consider al-Fatiha and the khatm position.
    const windows = top.map(([b]) => [b * BUCKET - 40, b * BUCKET + q.length + 40]);
    windows.push([0, fatihaEnd]);
    if (this.khatmPos >= 0) windows.push([this.khatmPos - this.o.back, this.khatmPos + this.o.fwd]);

    const cands = [];
    for (const [lo, hi] of windows) {
      const r = align(q, letters, lo, hi);
      if (r.end < 0) continue;
      let bonus = 0;
      if (r.end <= fatihaEnd + 5) bonus += 0.05;
      if (this.khatmPos >= 0 && r.end >= this.khatmPos - this.o.back && r.end <= this.khatmPos + 3000) bonus += 0.08;
      cands.push({ ...r, rank: r.norm + bonus });
    }
    // merge duplicates (same place found twice)
    cands.sort((a, b) => b.rank - a.rank);
    const uniq = [];
    for (const c of cands) if (!uniq.some((u) => Math.abs(u.end - c.end) < 20)) uniq.push(c);

    const best = uniq[0];
    if (!best || best.norm < this.o.searchAccept) { this.pending = null; return; }
    const second = uniq[1];
    if (second && best.rank - second.rank < this.o.ambiguityGap) {
      // Two places fit equally well (mutashabihat). Wait for more words.
      this.pending = null;
      return;
    }

    // Confirm: earlier checks must have pointed at the same place. With no
    // khatm position yet (cold start) we're stricter: short ayat repeat across
    // surahs, so wait for three agreeing checks and a fuller buffer.
    const cold = this.khatmPos < 0;
    if (cold && q.length < this.o.coldMinQuery) return;
    const needed = cold ? 3 : 2;
    if (this.pending && Math.abs(best.end - this.pending.end) <= q.length + 40) {
      this.pending = { ...best, hits: this.pending.hits + 1 };
    } else {
      this.pending = { ...best, hits: 1 };
    }
    this.confidence = best.norm;
    if (this.pending.hits >= needed) {
      this.pending = null;
      this._accept(best);
    }
  }

  _result(changed) {
    const ref = this.shown >= 0 ? this.ix.ref(this.shown) : null;
    const clearAudio = this.cleared;
    this.cleared = false;
    return { state: this.state, ayah: ref, changed, clearAudio, confidence: Number(this.confidence.toFixed(2)) };
  }
}
