// Splits the audio into stretches of speech ("utterances") in 20 ms frames,
// so we know how something was said:
//   dur        how long the latest stretch of speech lasted (seconds)
//   gapBefore  the silence just before it (seconds)
//   gapAfter   silence since it ended (0 while still speaking)
//
// A takbir for ruku' or sujood usually comes after a pause and is drawn out
// ("اللّٰهُ أكبـــر"); "الله أكبر" inside an ayah runs on with the words
// around it. Short gaps between words (< 0.2 s) don't split an utterance.

const FRAME = 0.02;     // seconds
const JOIN_GAP = 0.2;   // silences shorter than this stay inside one utterance
const HISTORY = 12;     // seconds of frame levels kept for the noise estimate

export class Utterances {
  constructor(sampleRate = 16000) {
    this.sr = sampleRate;
    this.frameLen = Math.round(sampleRate * FRAME);
    this.carry = new Float32Array(0);
    this.levels = [];        // recent frame levels
    this.t = 0;              // seconds of audio seen
    this.cur = null;         // {start, lastVoice}
    this.prevEnd = -10;      // end of the previous utterance
    this.done = [];          // finished utterances {start, end, gapBefore}
  }

  add(samples) {
    let buf = samples;
    if (this.carry.length) {
      buf = new Float32Array(this.carry.length + samples.length);
      buf.set(this.carry); buf.set(samples, this.carry.length);
    }
    let i = 0;
    for (; i + this.frameLen <= buf.length; i += this.frameLen) this._frame(buf.subarray(i, i + this.frameLen));
    this.carry = buf.slice(i);
  }

  _frame(f) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const level = Math.sqrt(sum / f.length);
    this.levels.push(level);
    if (this.levels.length > HISTORY / FRAME) this.levels.shift();
    const voice = level > this._threshold();
    const now = this.t;
    this.t += FRAME;

    if (voice) {
      if (!this.cur) this.cur = { start: now, lastVoice: now };
      else this.cur.lastVoice = now;
    } else if (this.cur && now - this.cur.lastVoice > JOIN_GAP) {
      const end = this.cur.lastVoice + FRAME;
      this.done.push({ start: this.cur.start, end, gapBefore: this.cur.start - this.prevEnd });
      if (this.done.length > 20) this.done.shift();
      this.prevEnd = end;
      this.cur = null;
    }
  }

  // Speech = clearly above the room's background (the quiet moments between
  // words: 10th percentile of recent frames), and above an absolute floor.
  _threshold() {
    if (this.levels.length < 25) return 0.002;
    if (!this._sorted || this.levels.length % 25 === 0) {
      const s = [...this.levels].sort((a, b) => a - b);
      this._floor = s[Math.floor(s.length * 0.1)];
      this._sorted = true;
    }
    return Math.max(0.0015, this._floor * 3);
  }

  /** The utterance being spoken now, or the one that just ended. */
  latest() {
    if (this.cur) {
      return { dur: this.t - this.cur.start, gapBefore: this.cur.start - this.prevEnd, gapAfter: 0 };
    }
    const u = this.done[this.done.length - 1];
    if (!u) return null;
    return { dur: u.end - u.start, gapBefore: u.gapBefore, gapAfter: this.t - u.end };
  }
}
