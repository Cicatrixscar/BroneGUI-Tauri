import test from 'node:test';
import assert from 'node:assert/strict';
import { lerp, EASING, Interpolator } from '../../src/js/interpolator.js';

test('lerp correctly calculates linear interpolation', () => {
  assert.equal(lerp(0, 100, 0), 0);
  assert.equal(lerp(0, 100, 0.5), 50);
  assert.equal(lerp(0, 100, 1), 100);
});

test('Interpolator transitions smoothly between states', () => {
  const interpolator = new Interpolator(400, 'linear');
  interpolator.start({ mouthOpenness: 0 }, { mouthOpenness: 1 });
  interpolator.startTime = 1000;

  // Midpoint t = 1200 (200ms out of 400ms)
  const mid = interpolator.update(1200);
  assert.equal(mid.mouthOpenness, 0.5);
  assert.equal(interpolator.isTransitioning, true);

  // Endpoint t = 1400 (400ms)
  const end = interpolator.update(1400);
  assert.equal(end.mouthOpenness, 1);
  assert.equal(interpolator.isTransitioning, false);
});

