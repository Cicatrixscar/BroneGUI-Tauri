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
function buatStateMock(config = undefined) {
  return {
    config,
    emosi: 'idle',
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
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'happy', intensitas: 1.0 });
    assert.equal(state.emosi, 'happy');
    done();
  });

  it('auto-reset ke idle setelah durasi_ms', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerLolos);
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'sad', intensitas: 0.8, durasi_ms: 50 });
    assert.equal(state.emosi, 'sad');
    setTimeout(() => {
      assert.equal(state.emosi, 'idle');
      done();
    }, 100);
  });

  it('pesan dibuang jika modeManager memblokir', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerBlokir);
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'cry', intensitas: 1.0 });
    assert.equal(state.emosi, 'idle'); // tidak berubah
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

describe('Connector — fallback mulut bicara (nonaktif default)', () => {
  it('aktif: mulai dari mulut ekspresi, lalu ganti vokal, selesai reset', (_, done) => {
    const state = buatStateMock({
      bicara: {
        fallbackMulutAktif: true,
        fallbackIntervalMs: 20,
        fallbackWatchdogMs: 500,
      },
    });
    initConnector(state, modeManagerLolos);

    window.sendBroneMessage({ tipe: 'bicara', status: 'mulai' });
    assert.equal(state.viseme, 'DIAM'); // ikut ekspresi aktif dulu

    setTimeout(() => {
      assert.notEqual(state.viseme, 'DIAM'); // sudah ada vokal fallback
      window.sendBroneMessage({ tipe: 'bicara', status: 'selesai' });
      assert.equal(state.viseme, 'DIAM');
      done();
    }, 60);
  });

  it('viseme asli menghentikan fallback', (_, done) => {
    const state = buatStateMock({
      bicara: {
        fallbackMulutAktif: true,
        fallbackIntervalMs: 20,
        fallbackWatchdogMs: 500,
      },
    });
    initConnector(state, modeManagerLolos);

    window.sendBroneMessage({ tipe: 'bicara', status: 'mulai' });
    window.sendBroneMessage({ tipe: 'viseme', jadwal: [{ t: 0, v: 'REST' }] });

    setTimeout(() => {
      assert.equal(state.viseme, 'REST');
      window.sendBroneMessage({ tipe: 'bicara', status: 'selesai' });
      done();
    }, 40);
  });
});

describe('Connector — post-speech emotion hold & interupsi', () => {
  it('menahan ekspresi setelah bicara selesai selama holdAfterSpeechMs lalu kembali ke idle', (_, done) => {
    const state = buatStateMock({
      bicara: {
        holdAfterSpeechMs: 60,
      },
    });
    initConnector(state, modeManagerLolos);

    // Mulai dengan emosi happy
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'happy' });
    assert.equal(state.emosi, 'happy');

    // Bicara selesai
    window.sendBroneMessage({ tipe: 'bicara', status: 'selesai' });
    // Pada 20ms pertama, ekspresi masih bertahan 'happy' (belum reset ke idle)
    setTimeout(() => {
      assert.equal(state.emosi, 'happy');
    }, 20);

    // Setelah 100ms (> 60ms), ekspresi otomatis kembali ke 'idle'
    setTimeout(() => {
      assert.equal(state.emosi, 'idle');
      done();
    }, 100);
  });

  it('interupsi baru membatalkan hold timer dan langsung beralih ke emosi baru', (_, done) => {
    const state = buatStateMock({
      bicara: {
        holdAfterSpeechMs: 150,
      },
    });
    initConnector(state, modeManagerLolos);

    // Mulai dengan emosi happy lalu bicara selesai
    window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'happy' });
    window.sendBroneMessage({ tipe: 'bicara', status: 'selesai' });

    // Pada 30ms (saat masih masa hold), datang pesan baru 'confused' (robot berpikir)
    setTimeout(() => {
      window.sendBroneMessage({ tipe: 'ekspresi', emosi: 'confused' });
      assert.equal(state.emosi, 'confused');
    }, 30);

    // Pada 200ms (> 150ms hold awal), pastikan tidak ter-reset ke 'idle' oleh timer lama
    setTimeout(() => {
      assert.equal(state.emosi, 'confused');
      done();
    }, 200);
  });

  it('paket gabungan ekspresi + viseme mengaktifkan emosi dan jadwal viseme bersamaan', (_, done) => {
    const state = buatStateMock();
    initConnector(state, modeManagerLolos);

    window.sendBroneMessage({
      tipe: 'ekspresi',
      emosi: 'happy',
      viseme: [{ t: 0, v: 'REST' }, { t: 0.05, v: 'A' }]
    });

    assert.equal(state.emosi, 'happy');
    setTimeout(() => {
      assert.equal(state.viseme, 'A');
      done();
    }, 70);
  });
});

describe('Connector — live calibration lead offset viseme', () => {
  it('controller menyediakan leadOffset dan fungsi kalibrasi clamped 0-200ms', () => {
    const state = buatStateMock({ bicara: { leadOffsetMs: 50 } });
    const controller = initConnector(state, modeManagerLolos);

    assert.equal(controller.leadOffset, 50);
    assert.equal(state.leadOffsetMs, 50);

    // Tambah 10ms
    assert.equal(controller.adjustLeadOffset(10), 60);
    assert.equal(controller.leadOffset, 60);
    assert.equal(state.leadOffsetMs, 60);

    // Kurang sampai mentok di 0
    assert.equal(controller.adjustLeadOffset(-100), 0);
    assert.equal(controller.leadOffset, 0);

    // Tambah sampai mentok di 200
    assert.equal(controller.adjustLeadOffset(300), 200);
    assert.equal(controller.leadOffset, 200);

    // Reset ke default config (50)
    assert.equal(controller.resetLeadOffset(), 50);
    assert.equal(controller.leadOffset, 50);
  });

  it('leadOffset memajukan eksekusi jadwal viseme sesuai offsetMs', (_, done) => {
    const state = buatStateMock({ bicara: { leadOffsetMs: 50 } });
    const controller = initConnector(state, modeManagerLolos);

    // Jadwal: t=0.1s (100ms). Dengan leadOffset 50ms, viseme 'U' harus aktif di tundaMs = 50ms.
    window.sendBroneMessage({
      tipe: 'viseme',
      jadwal: [{ t: 0, v: 'REST' }, { t: 0.1, v: 'U' }]
    });

    // Pada 20ms, masih REST
    setTimeout(() => {
      assert.equal(state.viseme, 'REST');
    }, 20);

    // Pada 65ms (> 50ms, tapi < 100ms tanpa offset), viseme 'U' sudah aktif
    setTimeout(() => {
      assert.equal(state.viseme, 'U');
      done();
    }, 65);
  });

  it('leadOffset mempercepat initial opening mulut di mode fallback', (_, done) => {
    const state = buatStateMock({
      bicara: {
        fallbackMulutAktif: true,
        fallbackIntervalMs: 80,
        fallbackWatchdogMs: 500,
        leadOffsetMs: 30, // delay awal = 80 - 30 = 50ms
      },
    });
    initConnector(state, modeManagerLolos);

    window.sendBroneMessage({ tipe: 'bicara', status: 'mulai' });
    assert.equal(state.viseme, 'DIAM');

    // Pada 25ms (< 50ms), masih DIAM
    setTimeout(() => {
      assert.equal(state.viseme, 'DIAM');
    }, 25);

    // Pada 60ms (> 50ms, tapi < 80ms), mulut sudah membuka ke 'O'
    setTimeout(() => {
      assert.equal(state.viseme, 'O');
      window.sendBroneMessage({ tipe: 'bicara', status: 'selesai' });
      done();
    }, 60);
  });
});

