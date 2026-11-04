import test from 'node:test';
import assert from 'node:assert/strict';

// Mock window globals for node environment testing
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {}
};

const { ModeManager } = await import('../../src/js/mode.js');

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

test('ModeManager locks out after 3 consecutive wrong passwords (AC-16.7)', async () => {
  const manager = new ModeManager({
    mode: {
      max_password_attempts: 3,
      lockout_duration_s: 60,
      dev_fallback_password: 'valid_secret'
    }
  });

  // Attempt 1: wrong
  let res = await manager.verifyPassword('wrong1');
  assert.equal(res.success, false);
  assert.equal(manager.isLockedOut(), false);

  // Attempt 2: wrong
  res = await manager.verifyPassword('wrong2');
  assert.equal(res.success, false);
  assert.equal(manager.isLockedOut(), false);

  // Attempt 3: wrong -> should trigger lockout
  res = await manager.verifyPassword('wrong3');
  assert.equal(res.success, false);
  assert.equal(manager.isLockedOut(), true);
  assert.ok(manager.getLockoutRemainingSeconds() > 50);

  // Next attempt blocked by lockout even if password is correct
  res = await manager.verifyPassword('valid_secret');
  assert.equal(res.success, false);
  assert.match(res.error, /Terkunci/);
});

test('ModeManager resets failed count after successful password', async () => {
  const manager = new ModeManager({
    mode: {
      max_password_attempts: 3,
      dev_fallback_password: 'valid_secret'
    }
  });

  await manager.verifyPassword('wrong');
  assert.equal(manager.failedAttempts, 1);

  const res = await manager.verifyPassword('valid_secret');
  assert.equal(res.success, true);
  assert.equal(manager.failedAttempts, 0);
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

