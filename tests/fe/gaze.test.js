import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGaze } from '../../src/js/gaze.js';
import { FaceState } from '../../src/js/state.js';
import { Renderer } from '../../src/js/renderer.js';
import { ModeManager } from '../../src/js/mode.js';
import { initConnector } from '../../src/js/connector.js';

test('CV gaze accepts only two fields and preserves every finite coordinate', () => {
  for (const x of [-Number.MAX_VALUE, -5, -1, -0.5, 0, 0.5, 1, 8, Number.MAX_VALUE]) {
    assert.deepEqual(parseGaze({ type: 'gaze', x }), { tipe: 'gaze', x });
  }
  for (const payload of [null, [], {}, { x: 0 }, { type: 'gaze' },
    { type: 'other', x: 0 }, { type: 'gaze', x: 0, y: 0 },
    ...[NaN, Infinity, -Infinity, '0.5', true, null]
      .map(x => ({ type: 'gaze', x }))]) {
    assert.throws(() => parseGaze(payload));
  }
});

function setupRenderer(config = {}) {
  globalThis.window = { addEventListener() {} };
  const elements = new Map();
  const svg = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      style: {}, attributes: {},
      classList: { add() {}, remove() {} },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      hasAttribute(k) { return Object.hasOwn(this.attributes, k); },
    });
    return elements.get(selector);
  } };
  const state = new FaceState(config);
  const renderer = new Renderer(svg, state, null, config);
  renderer.applyState(true);
  const offset = () => Number(svg.querySelector('#layer-eyes').getAttribute('transform')
    .match(/translate\(([^ ]+)/)[1]);
  return { state, renderer, svg, offset };
}

test('gaze eases and retargets continuously without accumulating or restarting duplicates', () => {
  const { state, renderer, offset } = setupRenderer();
  state.setGaze(1);
  renderer.updateGaze(0);
  assert.equal(offset(), 0);
  renderer.updateGaze(75);
  assert.equal(offset(), 15);
  state.setGaze(1);
  renderer.updateGaze(150);
  assert.equal(offset(), 20);
  state.setGaze(-1);
  renderer.updateGaze(150);
  assert.equal(offset(), 20);
  renderer.updateGaze(225);
  assert.equal(offset(), -10);
  state.setGaze(0.5);
  renderer.updateGaze(225);
  assert.equal(offset(), -10);
  renderer.updateGaze(375);
  assert.equal(offset(), 10);
  renderer.updateGaze(10000);
  assert.equal(offset(), 10);
  for (const x of [NaN, Infinity, '1']) state.setGaze(x);
  assert.equal(state.gazeX, 0.5);
});

test('GUI clamps extreme gaze and does not restart movement for the same effective target', () => {
  const { state, renderer, offset } = setupRenderer();
  state.setGaze(8);
  renderer.updateGaze(0);
  renderer.updateGaze(75);
  assert.equal(state.gazeX, 1);
  assert.equal(offset(), 15);
  state.setGaze(Number.MAX_VALUE);
  renderer.updateGaze(150);
  assert.equal(offset(), 20);
  state.setGaze(-5);
  renderer.updateGaze(150);
  renderer.updateGaze(225);
  assert.equal(offset(), -10);
  state.setGaze(-Number.MAX_VALUE);
  renderer.updateGaze(300);
  assert.equal(state.gazeX, -1);
  assert.equal(offset(), -20);
  state.setGaze(0.5);
  renderer.updateGaze(300);
  renderer.updateGaze(450);
  assert.equal(offset(), 10);
});

test('gaze preserves eye coordinates and blink transforms; cry/timeout store the latest target', () => {
  const { state, renderer, svg, offset } = setupRenderer({ gaze: { durationMs: 0, maxOffsetX: 30 } });
  svg.querySelector('#eye-l').setAttribute('x', 115);
  svg.querySelector('#eye-r').setAttribute('x', 556);
  svg.querySelector('#eye-l-wrap').style.transform = 'scaleY(0.04)';
  svg.querySelector('#eye-r').setAttribute('transform', 'rotate(45 620 208)');
  state.setGaze(-1);
  renderer.updateGaze(0);
  assert.equal(offset(), -30);
  assert.equal(svg.querySelector('#eye-l').getAttribute('x'), '115');
  assert.equal(svg.querySelector('#eye-r').getAttribute('x'), '556');
  assert.equal(svg.querySelector('#eye-l-wrap').style.transform, 'scaleY(0.04)');
  assert.equal(svg.querySelector('#eye-r').getAttribute('transform'), 'rotate(45 620 208)');
  for (const emotion of ['cry', 'timeout']) {
    state.setEmotion(emotion);
    state.setGaze(0.5);
    renderer.updateGaze(1);
    assert.equal(offset(), 0);
    assert.equal(state.gazeX, 0.5);
    state.setEmotion('idle');
    renderer.updateGaze(2);
    assert.equal(offset(), 15);
  }
  state.resetToIdle();
  assert.equal(state.gazeX, 0.5);
});

test('mode switches reset gaze immediately and static messages are never queued', async () => {
  const { state, renderer, offset } = setupRenderer();
  const mode = new ModeManager({}, {}, state);
  const controller = initConnector(state, mode);
  const send = window.sendBroneMessage;
  send({ tipe: 'gaze', x: 1 });
  renderer.updateGaze(0);
  renderer.updateGaze(75);
  assert.equal(offset(), 15);
  await mode.switchMode();
  renderer.updateGaze(76);
  assert.equal(offset(), 0);
  send({ tipe: 'gaze', x: -1 });
  assert.equal(state.gazeX, 0);
  await mode.switchMode();
  renderer.updateGaze(1000);
  assert.equal(offset(), 0);
  controller.stop();
});

for (const mode of ['bawaan', 'streaming', 'fallback']) {
  test(`gaze cannot alter expression/viseme timing or speech queues in ${mode}`, t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
    t.mock.method(globalThis.performance, 'now', () => Date.now());
    globalThis.window = { addEventListener() {} };
    const setup = () => {
      const state = new FaceState({ bicara: { visemeMode: mode, holdAfterSpeechMs: 100,
        fallbackIntervalMs: 40 } });
      const controller = initConnector(state, { handleIncomingMessage: () => true });
      t.after(() => controller.stop());
      return { state, send: window.sendBroneMessage };
    };
    const reference = setup();
    const withGaze = setup();
    for (const { send } of [reference, withGaze]) {
      if (mode === 'streaming') {
        send({ expression: 'happy', duration: 0.2, sentence: 'a i' });
        send({ expression: 'sad', duration: 0.2, sentence: 'u e' });
      } else {
        send({ tipe: 'ekspresi', emosi: 'happy', durasi_ms: 300 });
        send({ tipe: 'bicara', status: 'mulai', durasi_s: 0.4 });
        if (mode === 'bawaan') send({ tipe: 'viseme', jadwal: [{ t: 0, v: 'A' }, { t: 0.2, v: 'O' }] });
      }
    }
    for (const elapsed of [10, 20, 70, 100, 100, 100, 200, 5000]) {
      t.mock.timers.tick(elapsed);
      withGaze.send({ tipe: 'gaze', x: elapsed % 3 - 1 });
      withGaze.send({ tipe: 'gaze', x: 'invalid' });
      assert.equal(withGaze.state.emosi, reference.state.emosi);
      assert.equal(withGaze.state.viseme, reference.state.viseme);
    }
    for (const { send } of [reference, withGaze]) send({ tipe: 'bicara', status: 'selesai' });
    t.mock.timers.tick(100);
    assert.equal(withGaze.state.emosi, reference.state.emosi);
    assert.equal(withGaze.state.viseme, reference.state.viseme);
    assert.notEqual(withGaze.state.gazeX, 0);
  });
}
