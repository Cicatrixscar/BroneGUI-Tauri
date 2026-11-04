// Tests untuk connector.js — viseme scheduler, ekspresi timer, dan bicara handler (F-05, F-07).
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill browser APIs yang dibutuhkan connector.js
globalThis.window = {
  __TAURI__: undefined,
  addEventListener: () => {},
};
globalThis.performance = { now: () => Date.now() };

// Import connector setelah polyfill
const { initConnector } = await import('../../src/js/connector.js');

// --- Minimal state mock ---
function buatStateMock() {
  return {
    emosi: 'netral',
    viseme: 'DIAM',
    setEmotion(emosi) { this.emosi = emosi; },
    setViseme(v) { this.viseme = v; },
  };
}

// ModeManager yang selalu mengizinkan pesan
const modeManagerLolos = { handleIncomingMessage: () => true };
// ModeManager yang selalu memblokir pesan
const modeManagerBlokir = { handleIncomingMessage: () => false };

describe('Connector — ekspresi', () => {
  it('setEmotion dipanggil saat payload ekspresi valid', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'senang', intensitas: 1.0 });
    assert.equal(state.emosi, 'senang');
    done();
  });

  it('auto-reset ke netral setelah durasi_ms', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'sedih', intensitas: 0.8, durasi_ms: 50 });
    assert.equal(state.emosi, 'sedih');
    setTimeout(() => {
      assert.equal(state.emosi, 'netral');
      done();
    }, 100);
  });

  it('pesan dibuang jika modeManager memblokir', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerBlokir);
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'menangis', intensitas: 1.0 });
    assert.equal(state.emosi, 'netral'); // tidak berubah
    done();
  });
});

describe('Connector — viseme scheduler', () => {
  it('viseme pertama langsung di-set saat t=0', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({
      tipe: 'viseme',
      id: 'v1',
      jadwal: [{ t: 0, v: 'A' }, { t: 0.2, v: 'O' }],
    });
    setTimeout(() => {
      assert.equal(state.viseme, 'A');
      done();
    }, 20);
  });

  it('viseme kedua di-set setelah delay t=0.1s', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({
      tipe: 'viseme',
      id: 'v2',
      jadwal: [{ t: 0, v: 'P_B_M' }, { t: 0.1, v: 'U' }],
    });
    setTimeout(() => {
      assert.equal(state.viseme, 'U');
      done();
    }, 150);
  });

  it('watchdog reset ke DIAM setelah viseme terakhir + 500ms', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({
      tipe: 'viseme',
      id: 'v3',
      jadwal: [{ t: 0, v: 'E' }],
    });
    setTimeout(() => {
      assert.equal(state.viseme, 'DIAM');
      done();
    }, 600);
  });
});

describe('Connector — bicara', () => {
  it('status selesai mereset viseme ke DIAM', (_, done) => {
    const state = buatStateMock();
    state.viseme = 'A'; // simulasi viseme aktif
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({ tipe: 'bicara', status: 'selesai' });
    assert.equal(state.viseme, 'DIAM');
    done();
  });

  it('status mulai tidak mengubah state', (_, done) => {
    const state = buatStateMock();
    state.viseme = 'O';
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({ tipe: 'bicara', status: 'mulai' });
    assert.equal(state.viseme, 'O'); // tidak berubah
    done();
  });
});

