import test from 'node:test';
import assert from 'node:assert/strict';
import { BlinkController } from '../../src/js/blink.js';

test('BlinkController initial state is open (1.0)', () => {
  const blink = new BlinkController({
    minIntervalMs: 3000,
    maxIntervalMs: 6000,
    durationMs: 150
  });

  const factor = blink.update(100);
  assert.equal(factor, 1.0);
  assert.equal(blink.isBlinking, false);
});

test('BlinkController triggers blink after interval passes', () => {
  const blink = new BlinkController({
    minIntervalMs: 1000,
    maxIntervalMs: 1000,
    durationMs: 100
  });

  blink.nextBlinkTime = 500;

  // At t=500, blink starts
  const factorStart = blink.update(500);
  assert.equal(blink.isBlinking, true);
  assert.equal(factorStart, 1.0);

  // At midpoint t=550 (50ms into 100ms duration), factor should be 0.0 (closed)
  const factorMid = blink.update(550);
  assert.ok(factorMid < 0.05, `Expected eye to be closed at midpoint, got ${factorMid}`);

  // At t=600, blink ends and re-opens
  const factorEnd = blink.update(600);
  assert.equal(blink.isBlinking, false);
  assert.equal(factorEnd, 1.0);
});

