import test from 'node:test';
import assert from 'node:assert/strict';

// Mock window globals for node environment testing
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {}
};

const { ModeManager } = await import('../../src/js/mode.js');

test('F4 cycles viseme sources in dynamic mode without switching to static', () => {
  const manager = new ModeManager({});
  const selected = [];
  manager.visemeController = {
    mode: 'bawaan',
    setMode(mode) { this.mode = mode; selected.push(mode); }
  };
  const notices = [];
  manager.onVisemeModeChange = mode => notices.push(mode);
  let prevented = 0;
  const press = (extra = {}) => manager.handleKeyDown({
    key: 'F4', preventDefault() { prevented++; }, ...extra
  });
  press();
  press();
  press();
  assert.deepEqual(selected, ['streaming', 'fallback', 'bawaan']);
  assert.deepEqual(notices, selected);
  assert.equal(prevented, 3);
  assert.equal(manager.isDynamic(), true);
  press({ repeat: true });
  press({ altKey: true });
  press({ ctrlKey: true });
  press({ metaKey: true });
  press({ shiftKey: true });
  manager.currentMode = 'statis';
  press();
  assert.equal(selected.length, 3);
});

test('viseme shortcut follows keymap and ignores manual expression keys in dynamic mode', () => {
  const manager = new ModeManager({}, { toggleVisemeMode: 'F6', expressions: { '1': 'happy' } }, {
    setEmotion() { assert.fail('dynamic mode must not apply manual expressions'); }
  });
  manager.visemeController = { mode: 'bawaan', setMode(mode) { this.mode = mode; } };
  const press = key => manager.handleKeyDown({ key, preventDefault() {} });
  press('F4');
  assert.equal(manager.visemeController.mode, 'bawaan');
  press('1');
  press('F6');
  assert.equal(manager.visemeController.mode, 'streaming');
});

test('ModeManager defaults to dynamic mode', () => {
  const manager = new ModeManager({
    mode: { default_mode: 'dinamis', mode_statis_aktif: true }
  });

  assert.equal(manager.isDynamic(), true);
  assert.equal(manager.isStatic(), false);
});

test('ModeManager switches modes correctly and resets state on dynamic return', async () => {
  let resetCalled = false;
  const mockState = {
    resetToIdle: () => {
      resetCalled = true;
    }
  };

  const manager = new ModeManager(
    { mode: { default_mode: 'dinamis', mode_statis_aktif: true } },
    {},
    mockState
  );

  // Switch to static
  const switchedToStatic = await manager.switchMode();
  assert.equal(switchedToStatic, true);
  assert.equal(manager.isStatic(), true);
  assert.equal(resetCalled, false);

  // Switch back to dynamic
  const switchedToDynamic = await manager.switchMode();
  assert.equal(switchedToDynamic, true);
  assert.equal(manager.isDynamic(), true);
  assert.equal(resetCalled, true);
});

test('ModeManager prevents switching to static if mode_statis_aktif is false (AC-16.5)', async () => {
  const manager = new ModeManager({
    mode: { default_mode: 'dinamis', mode_statis_aktif: false }
  });

  const switched = await manager.switchMode();
  assert.equal(switched, false);
  assert.equal(manager.isDynamic(), true);
});

test('ModeManager F2 keydown triggers immediate mode switch without password', async () => {
  const manager = new ModeManager({
    mode: { default_mode: 'dinamis', mode_statis_aktif: true }
  });

  let defaultPrevented = false;
  manager.handleKeyDown({
    key: 'F2',
    preventDefault: () => {
      defaultPrevented = true;
    }
  });

  assert.equal(defaultPrevented, true);
  assert.equal(manager.isStatic(), true);

  // Press F2 again to switch back
  manager.handleKeyDown({
    key: 'F2',
    preventDefault: () => {}
  });
  assert.equal(manager.isDynamic(), true);
});

test('ModeManager verifyPassword always returns success (password disabled)', async () => {
  const manager = new ModeManager({});
  const res = await manager.verifyPassword('anything');
  assert.equal(res.success, true);
  assert.equal(manager.isLockedOut(), false);
});

test('ModeManager discards incoming messages during static mode (AC-17.4)', () => {
  const manager = new ModeManager({
    mode: { default_mode: 'dinamis', mode_statis_aktif: true }
  });

  // Dynamic mode: messages are allowed
  assert.equal(manager.handleIncomingMessage({ tipe: 'ekspresi' }), true);

  // Switch to static: messages are discarded
  manager.currentMode = 'statis';
  assert.equal(manager.handleIncomingMessage({ tipe: 'ekspresi' }), false);
});

test('ModeManager triggers visemes in static mode (A, I, U, E, O, REST, DIAM)', () => {
  let activeViseme = null;
  const mockState = {
    setEmotion: () => {},
    setViseme: (v) => { activeViseme = v; }
  };

  const manager = new ModeManager(
    { mode: { default_mode: 'statis', mode_statis_aktif: true } },
    { visemes: { a: 'A', i: 'I', u: 'U', e: 'E', o: 'O', r: 'REST', d: 'DIAM' } },
    mockState
  );

  const press = (key) => manager.handleKeyDown({ key, preventDefault: () => {} });

  press('a');
  assert.equal(activeViseme, 'A');

  press('i');
  assert.equal(activeViseme, 'I');

  press('u');
  assert.equal(activeViseme, 'U');

  press('e');
  assert.equal(activeViseme, 'E');

  press('o');
  assert.equal(activeViseme, 'O');

  press('r');
  assert.equal(activeViseme, 'REST');

  press('d');
  assert.equal(activeViseme, 'DIAM');

  // Alias P/B/M -> REST
  press('p');
  assert.equal(activeViseme, 'REST');
});

