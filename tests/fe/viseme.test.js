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

