import test from 'node:test';
import assert from 'node:assert/strict';
import { everyAyahUrl, everyAyahChapter, audioUrl, parseReciters, parseChapterAudio, timingsFromSegments, timingsFromLetters, wordAt, letterForWord } from '../src/renderer/listen-core.js';

test('listen: audio URLs resolve against verses.quran.com unless already absolute', () => {
  assert.equal(audioUrl('Alafasy/mp3/001001.mp3'), 'https://verses.quran.com/Alafasy/mp3/001001.mp3');
  assert.equal(audioUrl('/Alafasy/mp3/001001.mp3'), 'https://verses.quran.com/Alafasy/mp3/001001.mp3');
  assert.equal(audioUrl('https://x.test/a.mp3'), 'https://x.test/a.mp3');
  assert.equal(audioUrl('//x.test/a.mp3'), 'https://x.test/a.mp3');
});

test('listen: reciter list and chapter audio are read from the API shapes', () => {
  const r = parseReciters({ recitations: [{ id: 7, reciter_name: 'Mishari Alafasy', style: null, translated_name: { name: 'Mishari Alafasy' } }, { id: 'x' }] });
  assert.deepEqual(r, [{ id: 7, name: 'Mishari Alafasy', style: '' }]);
  const m = parseChapterAudio({ audio_files: [{ verse_key: '1:1', url: 'A/001001.mp3', segments: [[1, 0, 600]] }, { url: 'no key' }] });
  assert.equal(m.size, 1);
  assert.equal(m.get('1:1').url, 'https://verses.quran.com/A/001001.mp3');
});

test('listen: word timings from segments, with gaps filled and bad data refused', () => {
  const t = timingsFromSegments([[1, 0, 630], [2, 650, 1570], [4, 2000, 2500]], 4);
  assert.equal(t.length, 4);
  assert.deepEqual(t[2], { from: 1570, to: 2000 }); // word 3 had no timing
  assert.equal(wordAt(t, -5), -1);
  assert.equal(wordAt(t, 0), 0);
  assert.equal(wordAt(t, 1000), 1);
  assert.equal(wordAt(t, 1800), 2);
  assert.equal(wordAt(t, 99999), 3);
  assert.equal(timingsFromSegments([[1, 0, 600]], 4), null);          // too few words covered
  assert.equal(timingsFromSegments([[1, 500, 600], [2, 100, 200]], 2), null); // out of order
  assert.equal(timingsFromSegments(null, 4), null);
});

test('listen: with no timings the words are spread over the ayah by letters', () => {
  const t = timingsFromLetters([2, 6, 10], 10000);
  assert.deepEqual(t.map((x) => Math.round(x.from)), [0, 2000, 6000]);
  assert.equal(Math.round(t[2].to), 10000);
});

test('listen: the letter handed to the highlighter lights exactly the wanted word', () => {
  // Same rule as light() in app.js: the lit word is the last k with letter > start_k + min(2, len_k - 1).
  const ends = [3, 4, 9, 12];
  const lit = (letter) => { let now = -1; for (let k = 0; k < ends.length; k++) { const s = k ? ends[k - 1] : 0; if (letter > s + Math.min(2, ends[k] - s - 1)) now = k; } return now; };
  for (let k = 0; k < ends.length; k++) assert.equal(lit(letterForWord(ends, k)), k);
  assert.equal(lit(letterForWord(ends, -1)), -1);
});

test('listen: the backup source builds everyayah.com file names', () => {
  assert.equal(everyAyahUrl('Alafasy_128kbps', 2, 255), 'https://everyayah.com/data/Alafasy_128kbps/002255.mp3');
  const m = everyAyahChapter('Alafasy_128kbps', 1, 7);
  assert.equal(m.size, 7);
  assert.equal(m.get('1:7').url, 'https://everyayah.com/data/Alafasy_128kbps/001007.mp3');
});
