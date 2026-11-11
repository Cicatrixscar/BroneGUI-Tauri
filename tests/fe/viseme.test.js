import test from 'node:test';
import assert from 'node:assert/strict';
import { visemeAt } from '../../src/js/viseme.js';

test('visemeAt returns DIAM when schedule is empty', () => {
  assert.equal(visemeAt([], 0.5), 'DIAM');
});

test('visemeAt picks the active viseme based on timestamp', () => {
  const jadwal = [
    { t: 0.00, v: 'A' },
    { t: 0.12, v: 'P_B_M' },
    { t: 0.30, v: 'O' }
  ];

  assert.equal(visemeAt(jadwal, 0.05), 'A');
  assert.equal(visemeAt(jadwal, 0.12), 'P_B_M');
  assert.equal(visemeAt(jadwal, 0.20), 'P_B_M');
  assert.equal(visemeAt(jadwal, 0.35), 'O');
});

test('visemeAt handles new dynamic visemes (REST, I, U, E)', () => {
  const jadwal = [
    { t: 0.00, v: 'REST' },
    { t: 0.10, v: 'E' },
    { t: 0.25, v: 'I' },
    { t: 0.40, v: 'U' },
    { t: 0.55, v: 'REST' }
  ];

  assert.equal(visemeAt(jadwal, 0.02), 'REST');
  assert.equal(visemeAt(jadwal, 0.15), 'E');
  assert.equal(visemeAt(jadwal, 0.30), 'I');
  assert.equal(visemeAt(jadwal, 0.45), 'U');
  assert.equal(visemeAt(jadwal, 0.60), 'REST');
});

