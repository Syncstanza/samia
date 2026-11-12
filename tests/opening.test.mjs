import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heardOpening } from '../src/engine/opening.js';

test('opening: a\'udhu billah is recognised, also a little off', () => {
  assert.equal(heardOpening('أعوذ بالله من الشيطان الرجيم').taawwudh, true);
  assert.equal(heardOpening('عوذ باله من شيطان رجيم').taawwudh, true);
});
test('opening: Bismillah is recognised', () => {
  assert.equal(heardOpening('بسم الله الرحمن الرحيم').basmala, true);
  assert.equal(heardOpening('سم الله الرحمن رحيم').basmala, true);
});
test('opening: chatter, silence and the passage itself do not count', () => {
  for (const t of ['', 'الحمد لله رب العالمين', 'توبوا إلى الله توبة نصوحا', 'قل هو الله أحد']) {
    const o = heardOpening(t);
    assert.equal(o.taawwudh || o.basmala, false, t);
  }
});
