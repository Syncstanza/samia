// The listening loop: audio in, ayah + prayer position out.
// Used by the app's worker and by tools/live-check.mjs (real recordings), so
// what is measured is exactly what runs in the masjid.
//
// Every HOP of audio: decide whether there is voice (relative to the room's
// own background), run the speech model on the last WINDOW of audio, and
// move the verse tracker and the prayer position (followHop).

import { followHop } from './follow.js';
import { Utterances } from './utterances.js';

export const SR = 16000;

const DEFAULTS = {
  window: 3.5,        // seconds of audio the model looks at
  hop: 0.4,           // how often it looks
  minLevel: 0.0008,   // absolute floor: quieter than this is silence
  minVoiced: 0.12,    // share of a hop that must be voice to count as speech
  targetLevel: 0.08,  // the VOICE (not the room) is brought up to about this level
  maxGain: 12,
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
      let out;
      if (level <= this.o.minLevel || voice.share < this.o.minVoiced) {
        this.lastHeard = '';
        out = followHop(this.tracker, this.salah, { text: '', dt: this.o.hop });
      } else {
        const started = performance.now();
        this.lastHeard = await this.asr.transcribe(this._gain(this.ring, voice.level));
        // How the latest stretch of speech was said (pause before it, length).
        const utter = this.utterances.latest();
        out = followHop(this.tracker, this.salah, {
          text: this.lastHeard, newFraction: Math.min(1, hopLen / this.ring.length), dt: this.o.hop, utter,
        });
        out.ms = Math.round(performance.now() - started);
      }
      if (out.clearAudio) this.clearAudio();
      return { ...out, heard: this.lastHeard, level };
    } finally {
      this.busy = false;
    }
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
