import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/engine/quran-index.js';
import { buildPassage, scoreHeard, alignHeard, splitAtPauses } from '../src/engine/score.js';

const data = JSON.parse(readFileSync(new URL('../data/quran/quran.json', import.meta.url), 'utf8'));
const ix = buildIndex(data);
const passage = buildPassage(data, ix.indexOf(112, 1), ix.indexOf(112, 4)); // al-Ikhlas
const lettersOf = (from, to) => passage.words.slice(from, to).map((w) => w.norm).join('');

test('passage: words split like the display, bismillah left out', () => {
  assert.equal(passage.words[0].text, 'قُلْ');
  assert.equal(passage.words.length, 15);
});

test('perfect recitation scores 100', () => {
  const r = scoreHeard(passage, passage.letters);
  assert.equal(r.score, 100);
  assert.ok(r.marks.every((m) => m === 'correct'));
});

test('one letter misheard in a long word is still correct', () => {
  const heard = passage.letters.replace('الصمد', 'الصمت');
  assert.equal(scoreHeard(passage, heard).score, 100);
});

test('a skipped word is marked skipped, the rest correct', () => {
  const skip = passage.words.findIndex((w) => w.norm === 'الصمد');
  const heard = lettersOf(0, skip) + lettersOf(skip + 1);
  const r = scoreHeard(passage, heard);
  assert.equal(r.marks[skip], 'skipped');
  assert.equal(r.marks.filter((m) => m === 'correct').length, passage.words.length - 1);
});

test('a wrong word is marked a mistake', () => {
  const k = passage.words.findIndex((w) => w.norm === 'كفوا');
  const heard = lettersOf(0, k) + 'كبيرا' + lettersOf(k + 1);
  assert.equal(scoreHeard(passage, heard).marks[k], 'mistake');
});

test('stopping early leaves the rest unread', () => {
  const r = scoreHeard(passage, lettersOf(0, 7));
  assert.equal(r.marks.slice(0, 7).every((m) => m === 'correct'), true);
  assert.equal(r.marks.slice(8).every((m) => m === 'unread'), true);
  assert.equal(r.accuracy, 100);
  assert.ok(r.score < 60);
});

test('alignment: extra heard letters do not break the rest', () => {
  const { reached } = alignHeard('ززز' + passage.letters, passage.letters);
  assert.equal(reached, passage.letters.length);
});

test('splitting a recording at pauses', () => {
  const sr = 16000, tone = (sec) => Float32Array.from({ length: sec * sr }, (_, i) => 0.3 * Math.sin(i / 5));
  const audio = new Float32Array(sr * 4);
  audio.set(tone(1), 0); audio.set(tone(1), sr * 2); // speech 0-1 s and 2-3 s
  const pieces = splitAtPauses(audio);
  assert.equal(pieces.length, 2);
});

test('recitation before and after the passage is ignored', () => {
  const before = 'اعوذباللهمنالشيطنالرجيمبسماللهالرحمنالرحيم';
  const after = 'قلاعوذبربالفلقمنشرماخلق';
  const r = scoreHeard(passage, before + passage.letters + after);
  assert.equal(r.score, 100);
});
