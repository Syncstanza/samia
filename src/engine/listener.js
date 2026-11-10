// The listening loop: audio in, ayah + prayer position out.
// Used by the app's worker and by tools/live-check.mjs (real recordings), so
// what is measured is exactly what runs in the masjid.
//
// Every HOP of audio: decide whether there is voice (relative to the room's
// own background), run the speech model on the last WINDOW of audio, and
// move the verse tracker and the prayer position (followHop).

import { followHop } from './follow.js';
import { Utterances } from './utterances.js';
import { classifyUtterance } from './calls.js';
import { normalize } from './normalize.js';

export const SR = 16000;

const DEFAULTS = {
  window: 3.5,        // seconds of audio the model looks at
  hop: 0.4,           // how often it looks
  minLevel: 0.0008,   // absolute floor: quieter than this is silence
  minVoiced: 0.12,    // share of a hop that must be voice to count as speech
  targetLevel: 0.08,  // the VOICE (not the room) is brought up to about this level
  maxGain: 12,
  history: 10,        // seconds of audio kept to re-hear single utterances
  callMin: 0.3,       // an utterance this long ... (seconds)
  callMax: 4.5,       // ... up to this long may be a call
  callGapAfter: 0.25, // silence after it before it is checked
};

export class Listener {
  /**
   * @param asr      QuranAsr (transcribe(Float32Array) -> Promise<string>)
   * @param tracker  Tracker
   * @param salah    Salah
   */
  constructor(asr, tracker, salah, options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.asr = asr;
    this.tracker = tracker;
    this.salah = salah;
    this.utterances = new Utterances(SR);
    this.ring = new Float32Array(0);
    this.hist = new Float32Array(Math.round(this.o.history * SR)); // last few seconds, for single utterances
    this.histFill = 0;
    this.checked = new Set();   // utterance ids already checked
    this.lastCallAt = -10;      // when the last call was taken (utterance clock, seconds)
    this.sinceHop = 0;
    this.busy = false;
    this.lastHeard = '';
  }

  clearAudio() { this.ring = new Float32Array(0); }

  /**
   * Add audio. Calls onUpdate(result) after each hop. In the app hops run as
   * audio arrives (skipped while the previous one is still busy); tests can
   * await the returned promise to run every hop.
   */
  async add(samples, onUpdate) {
    this.utterances.add(samples);
    // keep the last few seconds
    const h = this.hist, n = samples.length;
    if (n >= h.length) h.set(samples.subarray(n - h.length));
    else { h.copyWithin(0, n); h.set(samples, h.length - n); }
    this.histFill = Math.min(h.length, this.histFill + n);
    const max = Math.round(this.o.window * SR);
    const next = new Float32Array(Math.min(max, this.ring.length + samples.length));
    const keep = next.length - samples.length;
    if (keep > 0) next.set(this.ring.subarray(this.ring.length - keep));
    next.set(samples.subarray(Math.max(0, samples.length - next.length)), Math.max(0, keep));
    this.ring = next;
    this.sinceHop += samples.length;
    if (this.sinceHop >= this.o.hop * SR && !this.busy) {
      this.sinceHop = 0;
      const out = await this.hop();
      onUpdate(out);
    }
  }

  async hop() {
    this.busy = true;
    try {
      const hopLen = Math.round(this.o.hop * SR);
      const recent = this.ring.subarray(Math.max(0, this.ring.length - hopLen));
      let sum = 0;
      for (let i = 0; i < recent.length; i++) sum += recent[i] * recent[i];
      const level = Math.sqrt(sum / Math.max(1, recent.length));

      // Speech = voice clearly above the room's own background (measured in
      // 20 ms frames between words). Room hiss is never sent to the model:
      // boosted hiss came out as stray letters, which hid the silence after a
      // takbir and looked like takbirs in sujood.
      const voice = this.utterances.voiced(this.o.hop);
      // A call said as its own utterance (pause before and after) is heard on
      // its own, so it is clear whatever came before or after it.
      const call = await this._callUtterance();
      let out;
      if (level <= this.o.minLevel || voice.share < this.o.minVoiced) {
        this.lastHeard = '';
        out = followHop(this.tracker, this.salah, { text: '', dt: this.o.hop, call });
      } else {
        const started = performance.now();
        this.lastHeard = await this.asr.transcribe(this._gain(this.ring, voice.level));
        // How the latest stretch of speech was said (pause before it, length).
        const utter = this.utterances.latest();
        out = followHop(this.tracker, this.salah, {
          text: this.lastHeard, newFraction: Math.min(1, hopLen / this.ring.length), dt: this.o.hop, utter, call,
        });
        out.ms = Math.round(performance.now() - started);
      }
      if (out.call) this.lastCallAt = this.utterances.t;
      if (out.clearAudio) this.clearAudio();
      return { ...out, heard: this.lastHeard, level, utteranceCall: call };
    } finally {
      this.busy = false;
    }
  }

  /** Check utterances that just ended: is one of them a call? */
  async _callUtterance() {
    const u = this.utterances;
    for (const x of u.finished(this.o.callGapAfter)) {
      if (this.checked.has(x.id)) continue;
      this.checked.add(x.id);
      const dur = x.end - x.start;
      if (dur < this.o.callMin || dur > this.o.callMax) continue;
      // Already taken from the running transcript? Don't count it twice.
      if (this.lastCallAt >= x.start - 0.2 && this.lastCallAt <= x.end + 0.8) continue;
      const from = Math.round((u.t - x.start + 0.1) * SR), to = Math.round((u.t - x.end - 0.1) * SR);
      if (from > this.histFill || to < 0) continue;
      const h = this.hist;
      const audio = h.subarray(h.length - from, h.length - Math.max(0, to));
      const letters = normalize(await this.asr.transcribe(this._gain(audio, this._voiceLevel(audio))));
      const found = classifyUtterance(letters);
      if (!found) continue;
      // "الله أكبر" / "أمين" that the ayah itself is about to say is recitation.
      if (this.tracker._inAyahType && this.tracker._inAyahType(found.type)) continue;
      return { type: found.type, utter: { dur, gapBefore: x.gapBefore, gapAfter: u.t - x.end, standalone: true }, letters };
    }
    return null;
  }

  _voiceLevel(audio) {
    let sum = 0;
    for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
    return Math.sqrt(sum / Math.max(1, audio.length)) * 1.4; // whole utterance, voice-heavy
  }

  // Quiet mics are scaled up so the model hears a normal level. The gain comes
  // from the level of the voice itself, so the room is never amplified alone.
  _gain(wave, voiceLevel) {
    if (!voiceLevel) return wave;
    const gain = Math.min(this.o.maxGain, this.o.targetLevel / Math.max(voiceLevel, 1e-6));
    if (gain <= 1.2) return wave;
    const out = new Float32Array(wave.length);
    for (let i = 0; i < wave.length; i++) out[i] = Math.max(-1, Math.min(1, wave[i] * gain));
    return out;
  }
}
