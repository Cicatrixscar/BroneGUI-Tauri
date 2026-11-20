import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceState } from '../../src/js/state.js';
import { initConnector } from '../../src/js/connector.js';

function setup(t, bicara = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  t.mock.method(globalThis.performance, 'now', () => Date.now());
  globalThis.window = { addEventListener() {} };
  const state = new FaceState({ bicara: { visemeMode: 'streaming', holdAfterSpeechMs: 5000, ...bicara } });
  const mode = { handleIncomingMessage: () => true };
  const controller = initConnector(state, mode);
  t.after(() => controller.stop());
  return { state, controller, mode, send: payload => window.sendBroneMessage(payload), tick: ms => t.mock.timers.tick(ms) };
}

test('combined packets queue face state and scale visemes to each audio duration', t => {
  const { state, send, tick } = setup(t);
  send({ expression: 'happy', duration: 0.6, sentence: 'a i' });
  assert.equal(state.emosi, 'happy');
  assert.equal(state.viseme, 'A');
  tick(100);
  send({ expression: 'sad', duration: 0.3, sentence: 'u e' });
  assert.equal(state.emosi, 'happy');
  assert.equal(state.viseme, 'A');
  tick(200);
  assert.equal(state.viseme, 'I');
  tick(300);
  assert.equal(state.emosi, 'sad');
  assert.equal(state.viseme, 'U');
  tick(150);
  assert.equal(state.viseme, 'E');
  tick(150);
  assert.equal(state.viseme, 'DIAM');
  assert.equal(state.emosi, 'sad');
  tick(4999);
  assert.equal(state.emosi, 'sad');
  tick(1);
  assert.equal(state.emosi, 'idle');
  // A self-contained packet starts a new session after the idle hold.
  send({ expression: 'neutral', duration: 0.1, sentence: 'o' });
  assert.equal(state.emosi, 'idle');
  assert.equal(state.viseme, 'O');
});

test('long combined sentences outlast watchdog and explicit end cancels their queue', t => {
  const { state, send, tick } = setup(t, { streaming: { watchdogMs: 200, silenceTimeoutMs: 100 } });
  send({ tipe: 'sentence', expression: 'happy', duration: 0.75, sentence: 'a i u e o' });
  tick(600);
  assert.equal(state.viseme, 'O');
  tick(150);
  assert.equal(state.viseme, 'DIAM');
  send({ expression: 'sad', duration: 0.5, sentence: 'a i' });
  send({ expression: 'cry', duration: 0.5, sentence: 'o a' });
  tick(100);
  send({ tipe: 'bicara', status: 'selesai' });
  tick(1000);
  assert.equal(state.viseme, 'DIAM');
  assert.equal(state.emosi, 'sad');
});

test('invalid combined packets cannot change face state or interrupt queued audio', t => {
  const { state, send, tick } = setup(t);
  send({ expression: 'happy', duration: 0.3, sentence: 'a i' });
  for (const invalid of [
    { expression: 'unknown' }, { expression: 'speaking' }, { duration: 0 },
    { duration: -1 }, { duration: '1' }, { duration: Infinity }, { duration: 3601 },
    { sentence: '' }, { sentence: 'a\nb' }, { sentence: null },
  ]) send({ expression: 'sad', duration: 1, sentence: 'u', ...invalid });
  send({ tipe: 'sentence', sentence: 'u' });
  assert.equal(state.emosi, 'happy');
  tick(150);
  assert.equal(state.viseme, 'I');
  tick(150);
  assert.equal(state.viseme, 'DIAM');
  tick(5000);
  assert.equal(state.emosi, 'idle');
});

test('unsupported sentence text keeps the face state for its duration and mode switches cancel it', t => {
  const { state, controller, send, tick } = setup(t);
  send({ expression: 'excited', duration: 0.2, sentence: '123' });
  assert.equal(state.emosi, 'happier');
  assert.equal(state.viseme, 'REST');
  send({ expression: 'sad', duration: 0.1, sentence: 'o' });
  tick(200);
  assert.equal(state.emosi, 'sad');
  assert.equal(state.viseme, 'O');
  controller.setMode('bawaan');
  tick(6000);
  assert.equal(state.viseme, 'DIAM');
  assert.equal(state.emosi, 'sad');
  send({ expression: 'happy', duration: 1, sentence: 'a' });
  assert.equal(state.emosi, 'sad');
  assert.equal(state.viseme, 'DIAM');
});

test('streaming preempts word timers, rests in gaps, and obeys the original master deadline', t => {
  const { state, send, tick } = setup(t);
  send({ tipe: 'ekspresi', emosi: 'happy', durasi_ms: 1000 });
  send({ tipe: 'bicara', status: 'mulai', durasi_s: 1 });
  send({ tipe: 'word', word: 'belum' });
  assert.equal(state.viseme, 'REST');
  assert.equal(state.visemeMorphMs, 25);
  tick(45);
  assert.equal(state.viseme, 'E');
  send({ tipe: 'word', word: 'ini' });
  assert.equal(state.viseme, 'I');
  tick(105); // the old U timer must have been removed
  assert.equal(state.viseme, 'I');
  tick(195);
  assert.equal(state.viseme, 'REST');
  tick(455);
  send({ tipe: 'bicara', status: 'mulai', durasi_s: 20 }); // cannot extend the deadline
  send({ tipe: 'word', word: 'haloooo' });
  tick(200);
  assert.equal(state.viseme, 'DIAM');
  assert.equal(state.emosi, 'happy');
  tick(100);
  send({ tipe: 'bicara', status: 'selesai' }); // end is idempotent
  send({ tipe: 'word', word: 'terlambat' });
  assert.equal(state.viseme, 'DIAM');
  tick(4900);
  assert.equal(state.emosi, 'idle');
});

test('silence timeout works without duration, can resume during hold, and hard watchdog ends speech', t => {
  const { state, send, tick } = setup(t, { streaming: { silenceTimeoutMs: 200, watchdogMs: 1000 } });
  send({ tipe: 'ekspresi', emosi: 'sad' });
  send({ tipe: 'word', word: 'a' });
  tick(150);
  assert.equal(state.viseme, 'REST');
  tick(200);
  assert.equal(state.viseme, 'DIAM');
  send({ tipe: 'word', word: 'i' });
  assert.equal(state.viseme, 'I');
  // Keep words flowing: the hard watchdog must still stop the session.
  for (let i = 0; i < 5; i++) {
    tick(190);
    send({ tipe: 'word', word: 'u' });
  }
  tick(50);
  assert.equal(state.viseme, 'DIAM');
  send({ tipe: 'word', word: 'a' });
  assert.equal(state.viseme, 'DIAM');
});

test('explicit modes are exclusive; switching and static mode cancel speech timers', t => {
  const { state, controller, mode, send, tick } = setup(t, { fallbackIntervalMs: 20 });
  send({ tipe: 'ekspresi', emosi: 'happy', durasi_ms: 1000 });
  send({ tipe: 'word', word: 'belum' });
  send({ tipe: 'viseme', jadwal: [{ t: 0, v: 'O' }] });
  tick(45);
  assert.equal(state.viseme, 'E');
  controller.setMode('bawaan');
  send({ tipe: 'word', word: 'aaa' });
  tick(300);
  assert.equal(state.viseme, 'DIAM');
  send({ tipe: 'viseme', jadwal: [{ t: 0, v: 'O' }] });
  tick(0);
  assert.equal(state.viseme, 'O');
  controller.setMode('fallback');
  send({ tipe: 'bicara', status: 'mulai', durasi_s: 1 });
  send({ tipe: 'viseme', jadwal: [{ t: 0, v: 'REST' }] });
  tick(20);
  assert.ok(['O', 'REST'].includes(state.viseme));
  controller.stop(); // main's mode-change callback, before entering static mode
  mode.handleIncomingMessage = () => false;
  send({ tipe: 'word', word: 'belum' });
  tick(6000);
  assert.equal(state.viseme, 'DIAM');
  assert.equal(state.emosi, 'happy');
});

test('inactive-source and invalid messages cannot cancel emotion hold', t => {
  const { state, send, tick } = setup(t);
  send({ tipe: 'ekspresi', emosi: 'happy', duration: 0.1 });
  tick(100);
  send({ tipe: 'viseme', jadwal: [{ t: 0, v: 'A' }] });
  send({ tipe: 'word', word: '' });
  send({ tipe: 'unknown' });
  tick(5000);
  assert.equal(state.emosi, 'idle');
});


test('duplicate expression delivery cannot restart the master deadline', t => {
  const { state, send, tick } = setup(t);
  const expression = { tipe: 'ekspresi', emosi: 'happy', durasi_ms: 100 };
  send(expression);
  tick(20);
  send(expression);
  tick(80);
  assert.equal(state.viseme, 'DIAM');
  tick(5000);
  assert.equal(state.emosi, 'idle');
});
