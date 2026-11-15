import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTajweedData, ruleMap, ruleName, baseCount } from '../src/renderer/tajweed.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/quran/${f}`, import.meta.url), 'utf8'));
const quran = read('quran.json');
const madani = read('madani.json');
setTajweedData(read('tajweed.json'));

const baseLetters = (s) => [...s].filter((c) => baseCount(c) === 1);
const QALQALAH = new Set('قطبجد');

test('tajweed: qalqalah always sits on one of the five letters, and lam shamsiyyah on a lam', () => {
  let q = 0;
  for (let i = 0; i < quran.ayat.length; i++) {
    const ar = quran.ayat[i][2];
    const rules = ruleMap(i, ar, ar, 'T');
    const letters = baseLetters(ar);
    assert.equal(rules.length, letters.length);
    for (let k = 0; k < rules.length; k++) {
      const r = ruleName(rules[k]);
      if (r === 'qalqalah') { q++; assert.ok(QALQALAH.has(letters[k]), `${i}:${k} ${letters[k]}`); }
      if (r === 'lam_shamsiyyah') assert.equal(letters[k], 'ل');
    }
  }
  assert.ok(q > 3000);
});

test('tajweed: the mushaf page spelling gets the same rules, even where the hamza is spelled differently', () => {
  // 2:4 is spelled with one letter fewer on the page than in the Tanzil text.
  const i = quran.ayat.findIndex((x) => x[0] === 2 && x[1] === 4);
  const f = madani.ayahStart[i], t = madani.ayahStart[i + 1];
  const page = madani.words.slice(f, t).join(' ');
  const rules = ruleMap(i, page, quran.ayat[i][2], 'M');
  assert.equal(rules.length, baseLetters(page).length);
  const own = ruleMap(i, quran.ayat[i][2], quran.ayat[i][2], 'T');
  const count = (r) => r.filter(Boolean).length;
  assert.ok(Math.abs(count(rules) - count(own)) <= 2, `${count(rules)} vs ${count(own)}`);
});
