// Runs the Quran speech model (CTC) on a chunk of audio and returns the letters.
// Works with onnxruntime-web (in the app) and onnxruntime-node (in tests);
// pass the `ort` module in.

import { fbank, NUM_BINS } from './fbank.js';

export class QuranAsr {
  /**
   * @param ort       onnxruntime module
   * @param modelData ArrayBuffer/Uint8Array of the .onnx file, or a path/URL
   * @param tokensTxt contents of tokens.txt ("<symbol> <id>" per line)
   */
  static async load(ort, modelData, tokensTxt, sessionOptions = {}) {
    const session = await ort.InferenceSession.create(modelData, { graphOptimizationLevel: 'all', ...sessionOptions });
    const tokens = [];
    for (const line of tokensTxt.split(/\r?\n/)) {
      const m = line.match(/^(\S+)\s+(\d+)$/);
      if (m) tokens[Number(m[2])] = m[1];
    }
    return new QuranAsr(ort, session, tokens);
  }

  constructor(ort, session, tokens) {
    this.ort = ort;
    this.session = session;
    this.tokens = tokens;
    this.blank = tokens.indexOf('<blk>') >= 0 ? tokens.indexOf('<blk>') : 0;
    [this.inName, this.lenName] = session.inputNames;
    [this.outName, this.outLenName] = session.outputNames;
  }

  /** @param {Float32Array} wave 16 kHz mono. @returns {Promise<string>} */
  async transcribe(wave) {
    const { data, frames } = fbank(wave);
    if (frames < 10) return '';
    const { Tensor } = this.ort;
    const feeds = { [this.inName]: new Tensor('float32', data, [1, frames, NUM_BINS]) };
    if (this.lenName) feeds[this.lenName] = new Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]);
    const out = await this.session.run(feeds);
    const lp = out[this.outName];
    const [, T, V] = lp.dims;
    let len = T;
    if (this.outLenName && out[this.outLenName]) len = Number(out[this.outLenName].data[0]);

    // Greedy CTC: best token per frame, merge repeats, drop blanks.
    let text = '';
    let prev = -1;
    const d = lp.data;
    for (let t = 0; t < len; t++) {
      let best = 0, bestV = -Infinity;
      const o = t * V;
      for (let v = 0; v < V; v++) if (d[o + v] > bestV) { bestV = d[o + v]; best = v; }
      if (best !== prev && best !== this.blank) text += this.tokens[best] ?? '';
      prev = best;
    }
    return text.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
