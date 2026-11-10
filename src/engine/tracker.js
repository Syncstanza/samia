// Follows a reciter through the Quran.
//
// Feed it the letters the speech model recognised (push() for new letters,
// observe() for a sliding window). It answers with the ayah to show and how
// far into it the reciter is (for word highlighting). Rules:
//   - LOCKED: match the newest letters just after where the reciter was, so the
//     highlight moves word by word. Repeats and skips are allowed but need a
//     clearer match.
//   - SEARCHING: if that keeps failing, look across the whole Quran. Only jump
//     when checks agree, and prefer places near the last position and al-Fatiha.
//   - Never guess: while unsure, keep showing the last ayah.
//   - al-Fatiha (often recited before a surah) is tracked separately: after it
//     ends, carry on from the saved position.

import { normalize } from './normalize.js';
import { align } from './align.js';
import { GRAM } from './quran-index.js';

const DEFAULTS = {
  maxQuery: 40,        // letters of recent speech to match
  minQuery: 12,        // letters needed before searching the whole Quran
  minLockedQuery: 8,   // letters needed to follow from a known position
  lockAccept: 0.55,    // LOCKED: alignment quality to accept a normal step forward
  jumpAccept: 0.6,     // LOCKED: quality to accept a jump within the window
  stepPenalty: 0.35,   // score lost per letter away from where the reciter should be
  stepSlack: 8,        // letters of free movement around that point
  catchUp: 1,          // share of what was heard that may be new when behind
  minIntoAyah: 3,      // letters of the next ayah heard before it is shown
  backSlack: 12,       // small backward wobbles of the highlight are ignored
  backAccept: 0.62,    // LOCKED: quality needed to step backwards (repeats)
  skipAccept: 0.68,    // LOCKED: quality needed to skip past the next ayah
  skipMinQuery: 24,    // ...and at least this many letters heard
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
  coldMinQuery: 30,    // letters needed before a cold-start search may lock
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
    this.offset = 0;
  }

  /** Tell it where the recitation starts (a surah and ayah). */
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
    this.offset = 0;
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
   * words (the end of al-Fatiha) aren't heard again.
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
    // Following needs only a few letters (the expected position makes short
    // queries safe: "عم يتساءلون" is 9 letters); a search needs more.
    const need = this.state === 'LOCKED' ? this.o.minLockedQuery : this.o.minQuery;
    if (this.buf.length < need) return this._result(false);

    const before = this.shown;
    if (this.state === 'LOCKED') this._locked();
    else this._search();
    return this._result(this.shown !== before);
  }

  // ---------------------------------------------------------------- LOCKED
  _locked() {
    const { letters, ayahStart, ayahOf, fatihaEnd } = this.ix;
    const q = this.buf;
    const inFatiha = this.pos < fatihaEnd;

    // The ayah the reciter is in, from his position (not from the screen: after
    // al-Fatiha the screen still shows 1:7 while he is back at the khatm).
    // pos is just after the last letter heard, so at the start of an ayah it
    // already points into that ayah.
    const curAyah = ayahOf[Math.min(this.pos, letters.length - 1)];
    // Window behind and ahead of the current position.
    const back = Math.max(this.o.back, this.pos - ayahStart[Math.max(0, curAyah - 1)]);
    let lo = this.pos - back - q.length;
    let hi = this.pos + this.o.fwd;
    if (inFatiha) { lo = 0; hi = fatihaEnd; }
    // 1. Normal case: the reciter carries on from where he was. Prefer the end
    //    just after the last position (what was newly heard), so the
    //    highlight moves word by word and never hops to the same phrase
    //    elsewhere in the window.
    const expect = this.pos + this.lastAdd;
    const near = align(q, letters, lo, hi, expect, this.o.stepPenalty, this.o.stepSlack);
    // If we were behind, everything heard may be new: allow catching up by
    // up to the whole query length.
    const reach = Math.max(expect + this.o.stepSlack * 2, this.pos + Math.round(q.length * this.o.catchUp) + this.o.stepSlack);
    if (near.norm >= this.o.lockAccept && near.end >= this.pos - 2 && near.end <= reach) {
      this._accept(near);
      return;
    }

    // 2. Otherwise he repeated or skipped: allow a jump, but going backwards
    //    (a repeat) or past the next ayah needs a clearer match, since common
    //    phrases ("الذين آمنوا") appear every few ayat.
    const r = align(q, letters, lo, hi, expect);
    const skip = ayahOf[Math.max(0, r.end - 1)] - curAyah;
    let need = this.o.jumpAccept;
    if (r.end < this.pos - 10) need = this.o.backAccept;
    else if (skip >= 2) need = q.length >= this.o.skipMinQuery ? this.o.skipAccept : Infinity;
    if (r.norm >= need) {
      this._accept(r);
      return;
    }

    // Not matching here. A new rak'ah starting with al-Fatiha is the usual reason.
    // Check only the newest letters: older ones are still from before al-Fatiha.
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
    // Show the ayah containing the most recent matched letter, once its first
    // word is really heard (a couple of letters could still be the end of the
    // previous ayah matching by chance).
    let ayah = ayahOf[Math.max(0, r.end - 1)];
    const into = r.end - this.ix.ayahStart[ayah];
    if (this.shown >= 0 && ayah > this.shown && into < this.o.minIntoAyah && r.end - r.start > into) {
      ayah = ayahOf[Math.max(0, this.ix.ayahStart[ayah] - 1)]; // stay on the ayah before it
    }
    const offset = r.end - this.ix.ayahStart[ayah];
    // Within the same ayah the highlight only moves forward, unless the reciter
    // clearly went back (a repeat).
    if (ayah === this.shown && offset < this.offset && this.offset - offset < this.o.backSlack) {
      // keep the current highlight
    } else {
      this.offset = Math.min(offset, this.ix.ayahStart[ayah + 1] - this.ix.ayahStart[ayah]);
    }
    this.shown = ayah;
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
    // letter: how many letters of the shown ayah have been recited so far.
    return { state: this.state, ayah: ref, letter: this.offset, changed, clearAudio, confidence: Number(this.confidence.toFixed(2)) };
  }
}
