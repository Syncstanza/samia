import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Listener, SR } from '../src/engine/listener.js';

// A slow device: while following, the model should be shown less audio so each look is quicker.
test('listener: a slow device looks at a shorter window while following', async () => {
  const seen = [];
  const asr = { transcribe: async (wave) => { seen.push(wave.length / SR); await new Promise((r) => setTimeout(r, wave.length / SR * 400)); return 'ن'; } };
  const tracker = { state: 'LOCKED', observe: () => ({ state: 'LOCKED', ayah: null, letter: 0, changed: false, clearAudio: false }) };
  const l = new Listener(asr, tracker);
  // Loud speech-like audio in 0.1 s pieces: silence-then-voice so it counts as voiced.
  let n = 0;
  for (let i = 0; i < 70; i++) {
    const piece = new Float32Array(SR / 10).map((_, k) => (i % 10 < 8 ? 0.3 : 0.0005) * Math.sin((n++ + k) / 5) * Math.sin(k / 3));
    await l.add(piece, () => {});
  }
  assert.ok(seen.length >= 3, `looks: ${seen.length}`);
  const late = seen.slice(-3);
  assert.ok(late.every((w) => w <= 2.6 && w >= 2.4), `later looks use the shorter window: ${late}`);
});
