// The listening loop: audio in, ayah + word position out.
// Used by the app's worker and by tools/live-check.mjs (real recordings), so
// what is measured is exactly what runs.
//
// Every HOP of audio: decide whether there is voice (relative to the room's
// own background), run the speech model on the last WINDOW of audio, and move
// the tracker. It can also record a turn (competition / hifz test) so the
// whole recitation can be scored at the end.

import { Utterances } from './utterances.js';

export const SR = 16000;

const DEFAULTS = {
  historyAge: 8,      // seconds earlier phrases are kept while searching
  window: 3.5,        // seconds of audio the model looks at
  hop: 0.4,           // how often it looks
  minLevel: 0.0008,   // absolute floor: quieter than this is silence
  minVoiced: 0.12,    // share of a hop that must be voice to count as speech
  targetLevel: 0.08,  // the VOICE (not the room) is brought up to about this level
  maxGain: 12,
  maxRecord: 15 * 60, // seconds: longest turn kept for scoring
};

export class Listener {
  constructor(asr, tracker, options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.asr = asr;
    this.tracker = tracker;
    this.utterances = new Utterances(SR);
    this.ring = new Float32Array(0);
    this.sinceHop = 0;
    this.busy = false;
    this.lastHeard = '';
    // While still finding the place: what was heard in earlier phrases. Short
    // ayat ("عم يتساءلون") are too short to place on their own; a few
    // together are not. Phrases expire after historyAge seconds, so old words
    // (the end of al-Fatiha, mumbling) don't spoil the search for what's
    // being recited now.
    this.history = []; // [{text, t}]
    this.clock = 0;    // seconds of audio heard
    this.phrase = '';
    this.recording = null; // array of Float32Array chunks while a turn is recorded
    this.recorded = 0;
  }

  clearAudio() { this.ring = new Float32Array(0); this.history = []; this.phrase = ''; }

  _recent() {
    this.history = this.history.filter((h) => h.t >= this.clock - this.o.historyAge);
    return this.history.map((h) => h.text).join(' ');
  }

  startRecording() { this.recording = []; this.recorded = 0; }

  /** Stop recording and return the turn's audio (16 kHz mono). */
  stopRecording() {
    const parts = this.recording || [];
    this.recording = null;
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let k = 0;
    for (const p of parts) { out.set(p, k); k += p.length; }
    return out;
  }

  /**
   * Add audio. Calls onUpdate(result) after each hop. In the app hops run as
   * audio arrives (skipped while the previous one is still busy); tests can
   * await the returned promise to run every hop.
   */
  async add(samples, onUpdate) {
    this.utterances.add(samples);
    if (this.recording && this.recorded < this.o.maxRecord * SR) {
      this.recording.push(samples.slice());
      this.recorded += samples.length;
    }
    const max = Math.round(this.o.window * SR);
    const next = new Float32Array(Math.min(max, this.ring.length + samples.length));
    const keep = next.length - samples.length;
    if (keep > 0) next.set(this.ring.subarray(this.ring.length - keep));
    next.set(samples.subarray(Math.max(0, samples.length - next.length)), Math.max(0, keep));
    this.ring = next;
    this.sinceHop += samples.length;
    this.clock += samples.length / SR;
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
      // boosted hiss comes out as stray letters.
      const voice = this.utterances.voiced(this.o.hop);
      let out;
      if (level <= this.o.minLevel || voice.share < this.o.minVoiced) {
        this.lastHeard = '';
        if (this.phrase && this.tracker.state !== 'LOCKED') {
          // A phrase ended while searching: keep its words, start the next
          // phrase on fresh audio.
          this.history.push({ text: this.phrase, t: this.clock });
          this.ring = new Float32Array(0);
        }
        this.phrase = '';
        out = this.tracker.observe('');
      } else {
        const started = performance.now();
        this.lastHeard = await this.asr.transcribe(gain(this.ring, voice.level, this.o));
        this.phrase = this.lastHeard;
        const before = this.tracker.state !== 'LOCKED' ? this._recent() : '';
        out = this.tracker.observe(before ? before + ' ' + this.lastHeard : this.lastHeard, Math.min(1, hopLen / this.ring.length));
        if (this.tracker.state === 'LOCKED') this.history = [];
        out.ms = Math.round(performance.now() - started);
      }
      if (out.clearAudio) this.clearAudio();
      return { ...out, heard: this.lastHeard, level };
    } finally {
      this.busy = false;
    }
  }
}

/**
 * Quiet mics are scaled up so the model hears a normal level; loud ones that
 * clip are left alone. The gain comes from the voice level, so the room's
 * background is never amplified on its own.
 */
export function gain(wave, voiceLevel, { targetLevel = 0.08, maxGain = 12 } = {}) {
  if (!voiceLevel) return wave;
  const g = Math.min(maxGain, targetLevel / Math.max(voiceLevel, 1e-6));
  if (g <= 1.2) return wave;
  const out = new Float32Array(wave.length);
  for (let i = 0; i < wave.length; i++) out[i] = Math.max(-1, Math.min(1, wave[i] * g));
  return out;
}
