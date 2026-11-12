// 80-bin log-mel filterbank, matching the Kaldi recipe the Quran model was
// trained with (kaldi-native-fbank defaults, as computed by sherpa-onnx):
// 25 ms povey window, 10 ms shift, DC removal, pre-emphasis 0.97, 512-point FFT
// power spectrum, mel bins 20-7600 Hz, log floored at float epsilon, no dither,
// snip_edges = false (edges reflected), samples in [-1, 1] at 16 kHz.
//
// Checked against kaldi-native-fbank by tools/check-fbank.py.

export const SAMPLE_RATE = 16000;
export const NUM_BINS = 80;
const SHIFT = 160;
const LENGTH = 400;
const FFT = 512;
const HALF = FFT / 2;
const EPS = 1.1920928955078125e-7; // float32 epsilon

const mel = (f) => 1127.0 * Math.log(1.0 + f / 700.0);

// Mel filter banks [NUM_BINS][HALF]
const BANKS = (() => {
  const width = SAMPLE_RATE / FFT;
  const lo = mel(20), hi = mel(SAMPLE_RATE / 2 - 400);
  const delta = (hi - lo) / (NUM_BINS + 1);
  const banks = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const left = lo + b * delta, center = lo + (b + 1) * delta, right = lo + (b + 2) * delta;
    const row = new Float32Array(HALF);
    let first = -1, last = -1;
    for (let i = 0; i < HALF; i++) {
      const m = mel(width * i);
      if (m > left && m < right) {
        row[i] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
        if (first < 0) first = i;
        last = i;
      }
    }
    banks.push({ row, first, last });
  }
  return banks;
})();

const WINDOW = (() => {
  const w = new Float64Array(LENGTH);
  for (let i = 0; i < LENGTH; i++) w[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (LENGTH - 1)), 0.85);
  return w;
})();

// Radix-2 FFT tables
const BITREV = (() => {
  const r = new Uint16Array(FFT);
  const bits = Math.log2(FFT);
  for (let i = 0; i < FFT; i++) {
    let x = i, y = 0;
    for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
    r[i] = y;
  }
  return r;
})();
const COS = new Float64Array(HALF), SIN = new Float64Array(HALF);
for (let i = 0; i < HALF; i++) { COS[i] = Math.cos((2 * Math.PI * i) / FFT); SIN[i] = -Math.sin((2 * Math.PI * i) / FFT); }

function fftPower(re, im, out) {
  for (let i = 0; i < FFT; i++) {
    const j = BITREV[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1, step = FFT / size;
    for (let start = 0; start < FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step], wi = SIN[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let i = 0; i < HALF; i++) out[i] = re[i] * re[i] + im[i] * im[i];
}

export const numFrames = (n) => Math.floor((n + SHIFT / 2) / SHIFT);

/**
 * @param {Float32Array} wave 16 kHz mono samples in [-1, 1]
 * @returns {{data: Float32Array, frames: number}} row-major [frames, 80]
 */
export function fbank(wave) {
  const n = wave.length;
  const t = numFrames(n);
  const data = new Float32Array(t * NUM_BINS);
  if (n === 0) return { data, frames: 0 };
  const frame = new Float64Array(LENGTH);
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  const power = new Float64Array(HALF);

  for (let f = 0; f < t; f++) {
    const base = f * SHIFT + SHIFT / 2 - LENGTH / 2;
    let sum = 0;
    for (let i = 0; i < LENGTH; i++) {
      let idx = base + i;
      if (idx < 0) idx = -idx - 1;
      if (idx >= n) idx = 2 * n - 1 - idx;
      idx = Math.min(Math.max(idx, 0), n - 1);
      frame[i] = wave[idx];
      sum += frame[i];
    }
    const mean = sum / LENGTH;
    for (let i = 0; i < LENGTH; i++) frame[i] -= mean;
    for (let i = LENGTH - 1; i > 0; i--) frame[i] -= 0.97 * frame[i - 1];
    frame[0] -= 0.97 * frame[0];
    re.fill(0); im.fill(0);
    for (let i = 0; i < LENGTH; i++) re[i] = frame[i] * WINDOW[i];
    fftPower(re, im, power);
    const o = f * NUM_BINS;
    for (let b = 0; b < NUM_BINS; b++) {
      const { row, first, last } = BANKS[b];
      let e = 0;
      for (let i = first; i <= last; i++) e += power[i] * row[i];
      data[o + b] = Math.log(Math.max(e, EPS));
    }
  }
  return { data, frames: t };
}
