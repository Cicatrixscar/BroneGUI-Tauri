import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWordToVisemes, parseSentenceToVisemes } from '../../src/js/wordViseme.js';

test('sentences preserve word order and punctuation, and reject invalid text', () => {
  assert.deepEqual(parseSentenceToVisemes('Halo, apa kabar?'),
    ['Halo,', 'apa', 'kabar?'].flatMap(word => parseWordToVisemes(word)));
  assert.deepEqual(parseSentenceToVisemes('a 123 i'), [...parseWordToVisemes('a'), ...parseWordToVisemes('i')]);
  for (const value of [null, 42, '', '   ', '123', 'a'.repeat(4097), 'a\ni']) {
    assert.deepEqual(parseSentenceToVisemes(value), []);
  }
});

test('PBM shares each syllable budget, including onset plus coda', () => {
  assert.deepEqual(parseWordToVisemes('belum'), [
    { v: 'REST', durasi: 45 }, { v: 'E', durasi: 105 },
    { v: 'U', durasi: 105 }, { v: 'REST', durasi: 45 },
  ]);
  assert.deepEqual(parseWordToVisemes('be-lum'), parseWordToVisemes('belum'));
  assert.deepEqual(parseWordToVisemes('bom'), [
    { v: 'REST', durasi: 45 }, { v: 'O', durasi: 60 }, { v: 'REST', durasi: 45 },
  ]);
});

test('repeated vowels extend without false closures and punctuation adds REST', () => {
  assert.deepEqual(parseWordToVisemes('saat'), [{ v: 'A', durasi: 250 }]);
  assert.deepEqual(parseWordToVisemes('maaf'), [{ v: 'REST', durasi: 45 }, { v: 'A', durasi: 205 }]);
  assert.deepEqual(parseWordToVisemes('Haloo!'), [
    { v: 'A', durasi: 150 }, { v: 'O', durasi: 250 }, { v: 'REST', durasi: 180 },
  ]);
  assert.deepEqual(parseWordToVisemes('Iyaaa'), [{ v: 'I', durasi: 150 }, { v: 'A', durasi: 350 }]);
});

test('only 2-5 full capitals use Indonesian letter names', () => {
  assert.deepEqual(parseWordToVisemes('BCA'), [
    { v: 'REST', durasi: 45 }, { v: 'E', durasi: 255 }, { v: 'A', durasi: 150 },
  ]);
  assert.deepEqual(parseWordToVisemes('ATM'), [
    { v: 'A', durasi: 150 }, { v: 'E', durasi: 255 }, { v: 'REST', durasi: 45 },
  ]);
  assert.deepEqual(parseWordToVisemes('bca'), [{ v: 'REST', durasi: 45 }, { v: 'A', durasi: 105 }]);
  assert.equal(parseWordToVisemes('FIA').reduce((sum, s) => sum + s.durasi, 0), 450);
});

test('invalid tokens do not animate and calibration remains configurable', () => {
  for (const word of [null, 42, '', '.', '123', 'dua kata', 'x'.repeat(257)]) {
    assert.deepEqual(parseWordToVisemes(word), []);
  }
  assert.deepEqual(parseWordToVisemes('bom', { syllableMs: 180, bilabialMs: 50 }), [
    { v: 'REST', durasi: 50 }, { v: 'O', durasi: 80 }, { v: 'REST', durasi: 50 },
  ]);
});
