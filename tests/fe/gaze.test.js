import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGaze, measureGazeGeometry } from '../../src/js/gaze.js';
import { readFileSync } from 'node:fs';
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
  config = { canvas: { baseWidth: 400, baseHeight: 200 }, expressions: {
    idle: { eyeL: {x:40,y:40,w:80,h:80}, eyeR: {x:240,y:40,w:80,h:80} },
    timeout: { eyeL: {x:20,y:40,w:120,h:80}, eyeR: {x:220,y:40,w:120,h:80} }
  }, ...config, gaze: { invertX: false, faceCornerRadius: 0, amplitudeRatio: 0.25, ...config.gaze } };
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

test('GUI clamps finite CV input to [-1, 1] without sensitivity amplification', () => {
  const { state, renderer, offset } = setupRenderer({ gaze: { sensitivity: 4, durationMs: 0 } });
  for (const [input, target, displacement] of [
    [0.2, 0.2, 4], [0.4, 0.4, 8], [-0.2, -0.2, -4], [-0.4, -0.4, -8],
    [0.5, 0.5, 10], [-0.5, -0.5, -10], [1, 1, 20], [-1, -1, -20],
    [8, 1, 20], [-5, -1, -20],
    [Number.MAX_VALUE, 1, 20], [-Number.MAX_VALUE, -1, -20],
    [0, 0, 0],
  ]) {
    state.setGaze(input);
    renderer.updateGaze(0);
    assert.equal(state.gazeX, target);
    assert.equal(offset(), displacement);
  }
  // Config lama tidak boleh memperkuat input atau mengubah kontrak baru.
  for (const sensitivity of [undefined, 4, 6, 0, -1, NaN, Infinity, '4']) {
    const fallback = new FaceState({ gaze: { sensitivity } });
    fallback.setGaze(0.2);
    assert.equal(fallback.gazeX, -0.2);
  }
});

test('camera mirroring flips both gaze directions once and can be disabled', () => {
  const { state, renderer, offset } = setupRenderer({ gaze: { invertX: true, durationMs: 0 } });
  for (const [input, displacement] of [[0.2, -4], [-0.2, 4], [0.4, -8], [-0.4, 8],
    [8, -20], [-5, 20], [0, 0]]) {
    state.setGaze(input);
    renderer.updateGaze(0);
    assert.equal(offset(), displacement);
  }
  state.config.gaze.invertX = false;
  state.setGaze(0.2);
  renderer.updateGaze(0);
  assert.equal(offset(), 4);
  const defaults = new FaceState();
  defaults.setGaze(0.2);
  assert.equal(defaults.gazeX, -0.2);
});

test('gaze preserves eye coordinates and blink transforms; cry/timeout store the latest target', () => {
  const { state, renderer, svg, offset } = setupRenderer({ gaze: { durationMs: 0 } });
  svg.querySelector('#eye-l').setAttribute('x', 115);
  svg.querySelector('#eye-r').setAttribute('x', 556);
  svg.querySelector('#eye-l-wrap').style.transform = 'scaleY(0.04)';
  svg.querySelector('#eye-r').setAttribute('transform', 'rotate(45 620 208)');
  state.setGaze(-1);
  renderer.updateGaze(0);
  assert.equal(offset(), -20);
  assert.equal(svg.querySelector('#eye-l').getAttribute('x'), '115');
  assert.equal(svg.querySelector('#eye-r').getAttribute('x'), '556');
  assert.equal(svg.querySelector('#eye-l-wrap').style.transform, 'scaleY(0.04)');
  assert.equal(svg.querySelector('#eye-r').getAttribute('transform'), 'rotate(45 620 208)');
  for (const emotion of ['cry', 'menangis', 'timeout']) {
    state.setEmotion(emotion);
    state.setGaze(0.5);
    renderer.updateGaze(1);
    assert.equal(offset(), 0);
    assert.equal(state.gazeX, 0.5);
    state.setEmotion('idle');
    renderer.updateGaze(2);
    assert.equal(offset(), 10);
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

const productionConfig = JSON.parse(readFileSync(new URL('../../src/config/config.json', import.meta.url)));

test('per-expression EOR contains every enabled pose throughout a dense horizontal sweep and blink', () => {
  const g = measureGazeGeometry(productionConfig);
  assert.equal(g.valid, true);
  // Independent inequality proof: every rectangle remains in the authored envelope.
  for (const [name, pose] of Object.entries(productionConfig.expressions)) {
    if (!g.poses[name]) continue;
    for (let n = -100; n <= 100; n++) {
      const dx = n / 100 * g.poses[name].maxOffsetX;
      for (const side of ['eyeL','eyeR']) {
        const e = pose[side];
        const region = g.poses[name].regions[side];
        assert.ok(e.x + dx >= region.left - 1e-9, `${name} ${side} left`);
        assert.ok(e.x + e.w + dx <= region.right + 1e-9, `${name} ${side} right`);
        for (const blink of [0.04, 0.5, 1]) {
          const top = e.y + e.h * (1 - blink) / 2;
          assert.ok(top >= 0 && top + e.h * blink <= productionConfig.canvas.baseHeight);
        }
      }
    }
  }
  assert.ok(Math.abs(g.poses.idle.maxOffsetX - 19.995) < 1e-9);
  assert.ok(g.poses.happier_transisi.maxOffsetX > g.poses.idle.maxOffsetX);
  for (const p of Object.values(g.poses)) assert.ok(Math.abs(p.maxEyeFraction * p.width - p.maxOffsetX) < 1e-9);
});

test('geometry scales with the face and cannot be bypassed by legacy maxOffsetX', () => {
  const original = measureGazeGeometry(productionConfig);
  const scaled = structuredClone(productionConfig);
  scaled.canvas.baseWidth *= 2;
  scaled.canvas.baseHeight *= 2;
  scaled.gaze.faceCornerRadius *= 2;
  scaled.gaze.maxOffsetX = 1e9;
  for (const pose of Object.values(scaled.expressions)) for (const side of ['eyeL','eyeR']) {
    for (const key of ['x','y','w','h']) pose[side][key] *= 2;
  }
  const result = measureGazeGeometry(scaled);
  assert.ok(Math.abs(result.maxOffsetX - original.maxOffsetX * 2) < 1e-9);
  for (const name of Object.keys(original.poses)) assert.equal(result.poses[name].maxEyeFraction, original.poses[name].maxEyeFraction);
});

test('invalid geometry fails closed and rounded face corners restrict motion', () => {
  for (const mutate of [c => {c.expressions.idle.eyeL.w = NaN;},
    c => {c.expressions.idle.eyeL.x = -10;}, c => {c.gaze.faceCornerRadius = NaN;},
    c => {c.expressions = {};}]) {
    const config = structuredClone(productionConfig);
    mutate(config);
    assert.equal(measureGazeGeometry(config).valid, false);
    const {state, renderer, offset} = setupRenderer(config);
    state.setGaze(1);
    renderer.updateGaze(0);
    renderer.updateGaze(1000);
    assert.equal(offset(), 0);
  }
  const corner = {canvas:{baseWidth:100,baseHeight:100}, gaze:{faceCornerRadius:20,amplitudeRatio:0.25},
    expressions:{idle:{eyeL:{x:20,y:0,w:10,h:10},eyeR:{x:70,y:0,w:10,h:10}},
      timeout:{eyeL:{x:0,y:0,w:40,h:10},eyeR:{x:60,y:0,w:40,h:10}}}};
  assert.equal(measureGazeGeometry(corner).maxOffsetX, 0);
});

for (const emotion of ['cry', 'menangis', 'timeout']) test(`${emotion} entry centers during closing before overlays, then resumes the latest target`, t => {
  t.mock.timers.enable({apis:['setTimeout','Date'], now:0});
  t.mock.method(performance, 'now', () => Date.now());
  const {state, renderer, offset} = setupRenderer();
  // Minimal anime stub: timers still execute the real expression lifecycle.
  window.anime = Object.assign(() => ({}), {remove(){}});
  state.setGaze(1);
  renderer.updateGaze(0);
  renderer.updateGaze(150);
  t.mock.timers.tick(150);
  state.setEmotion(emotion);
  renderer.updateGaze(150);
  assert.equal(offset(), 20, 'entry must not jump to center');
  t.mock.timers.tick(80);
  renderer.updateGaze(230);
  assert.ok(offset() > 0 && offset() < 20);
  state.setGaze(-1);
  t.mock.timers.tick(95);
  renderer.updateGaze(325);
  assert.equal(offset(), 0, 'centered at asset/overlay swap');
  t.mock.timers.tick(175);
  state.setEmotion('idle');
  t.mock.timers.tick(350);
  renderer.updateGaze(850);
  renderer.updateGaze(1000);
  assert.equal(offset(), -20);
});

test('timeout rotated rectangles remain within the rounded face at every sampled angle', () => {
  const {baseWidth:w,baseHeight:h} = productionConfig.canvas;
  const r = productionConfig.gaze.faceCornerRadius;
  for (const side of ['eyeL','eyeR']) {
    const e = productionConfig.expressions.timeout[side];
    for (let degrees = 0; degrees < 360; degrees++) {
      const a = degrees * Math.PI / 180;
      for (const x of [e.x,e.x+e.w]) for (const y of [e.y,e.y+e.h]) {
        const px = e.cx+(x-e.cx)*Math.cos(a)-(y-e.cy)*Math.sin(a);
        const py = e.cy+(x-e.cx)*Math.sin(a)+(y-e.cy)*Math.cos(a);
        const dy = Math.max(0,r-py,py-(h-r));
        const inset = r-Math.sqrt(Math.max(0,r*r-dy*dy));
        assert.ok(py >= 0 && py <= h && px >= inset && px <= w-inset);
      }
    }
  }
});

test('calibration ratio increases visibility but cannot bypass geometric or anchor bounds', () => {
  const config = structuredClone(productionConfig);
  config.gaze.amplitudeRatio = 100;
  const capped = measureGazeGeometry(config);
  for (const [name, p] of Object.entries(capped.poses)) {
    assert.equal(p.maxOffsetX, p.geometricMax);
    assert.ok(p.maxOffsetX <= p.width / 2);
    assert.ok(p.maxOffsetX <= -p.lower && p.maxOffsetX <= p.upper);
  }
  config.gaze.amplitudeRatio = 0;
  assert.equal(measureGazeGeometry(config).maxOffsetX, 0);
  for (const ratio of [-1, NaN, Infinity, '0.155', undefined]) {
    config.gaze.amplitudeRatio = ratio;
    assert.equal(measureGazeGeometry(config).valid, false);
  }
  const baseline = measureGazeGeometry(productionConfig);
  for (const p of Object.values(baseline.poses)) assert.ok(p.maxOffsetX >= 10 * 1.6);
});

test('ordinary expression change centers at swap then uses the new pose range without rescaling jumps', t => {
  t.mock.timers.enable({apis:['setTimeout','Date'], now:0});
  t.mock.method(performance, 'now', () => Date.now());
  const {state, renderer, offset} = setupRenderer({...productionConfig,
    gaze:{...productionConfig.gaze,invertX:false}});
  window.anime = Object.assign(() => ({}), {remove(){}});
  const oldLimit = renderer.gazeGeometry.poses.idle.maxOffsetX;
  const newLimit = renderer.gazeGeometry.poses.happier.maxOffsetX;
  state.setGaze(1);
  renderer.updateGaze(0);
  renderer.updateGaze(150);
  t.mock.timers.tick(150);
  state.setEmotion('happier');
  renderer.updateGaze(150);
  assert.equal(offset(), oldLimit);
  t.mock.timers.tick(80);
  renderer.updateGaze(230);
  assert.ok(offset() > 0 && offset() < oldLimit);
  t.mock.timers.tick(95);
  assert.equal(offset(), 0);
  assert.equal(renderer.renderedEyeEmotion, 'happier');
  renderer.updateGaze(325);
  assert.equal(offset(), 0);
  renderer.updateGaze(400);
  assert.ok(offset() > 0 && offset() < newLimit);
  t.mock.timers.tick(175);
  renderer.updateGaze(500);
  assert.equal(offset(), newLimit);
  assert.equal(state.gazeX, 1);
});
