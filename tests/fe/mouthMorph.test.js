import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignContour, interpolateMouth, MouthMorph } from '../../src/js/mouthMorph.js';

test('contours match winding and start instead of twisting between shapes', () => {
  const points = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.deepEqual(alignContour(points, [[2, 2], [2, 0], [0, 0], [0, 2]]), points);
});

test('mouth morph keeps intermediate geometry when interrupted and restores image at completion', () => {
  const element = () => ({
    style: {}, attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    appendChild(child) { this.children.push(child); },
    remove() {}
  });
  const previousDocument = globalThis.document;
  globalThis.document = { createElementNS: element };
  try {
    const image = element();
    image.setAttribute('href', 'A');
    const morph = new MouthMorph(element(), image);
    const shape = x => Array.from({ length: 4 }, () => ({
      points: [[x, 0], [x + 2, 0], [x + 2, 2], [x, 2]], opacity: 1, width: 4
    }));
    const shapes = { A: shape(0), O: shape(10), U: shape(20) };
    morph.shape = asset => shapes[asset];
    assert.equal(morph.start('O', {}, true, 0), true);
    assert.deepEqual(morph.current, shapes.A);
    assert.equal(image.style.display, 'none');
    morph.update(50);
    assert.deepEqual(morph.current, interpolateMouth(shapes.A, shapes.O, 0.5));
    const midpoint = structuredClone(morph.current);
    morph.start('U', {}, true, 50);
    assert.deepEqual(morph.transition.from, midpoint);
    morph.update(150);
    assert.deepEqual(morph.current, shapes.U);
    assert.equal(morph.transition, null);
    assert.equal(image.style.display, '');
    assert.equal(morph.start('O', {}, false, 160), false);
    assert.equal(morph.current, null);
    assert.equal(morph.group, null);
  } finally {
    globalThis.document = previousDocument;
  }
});
