import { WordVisemeController } from './visemeController.js';

// Mendengarkan event dari BE (Tauri) dan memperbarui state (F-05, F-07).
// Nama event dan bentuk payload mengikuti docs/CONTRACT.md.

const EMOTION_ALIASES = {
  netral: 'idle',
  neutral: 'idle',
  excited: 'happier',
  senang: 'happy',
  sangat_senang: 'happier',
  sedih: 'sad',
  menangis: 'cry',
  terkejut: 'shock',
  berpikir: 'confused',
  thinking: 'confused',
  sangat_senang_transisi: 'happier_transisi'
};

export function initConnector(state, modeManager) {
  // Timer untuk auto-reset ekspresi setelah durasi_ms habis
  let _ekspresiTimer = null;
  // Timer untuk viseme scheduler
  let _visemeTimers = [];
  // Buffer deduplikasi pesan identik yang tiba beruntun (< 30ms)
  let _lastMsgStr = '';
  let _lastMsgTime = 0;

  // Fallback mulut saat bicara. Nonaktif default; hanya untuk worst case bila
  // jadwal viseme dinamis dari LLM tidak pernah datang. Aktifkan lewat config.
  let _fallbackTimer = null;
  let _fallbackInitialTimer = null;
  let _fallbackWatchdog = null;
  const fallbackConfig = state?.config?.bicara ?? {};
  const streaming = new WordVisemeController(state);
  const validModes = ['bawaan', 'streaming', 'fallback'];
  // Legacy boolean still enables fallback when no explicit mode is configured.
  let legacyFallback = fallbackConfig.fallbackMulutAktif === true &&
    !['streaming', 'fallback'].includes(fallbackConfig.visemeMode);
  let visemeMode = legacyFallback ? 'fallback' : validModes.includes(fallbackConfig.visemeMode)
    ? fallbackConfig.visemeMode : 'bawaan';
  state.visemeMode = visemeMode;
  const fallbackIntervalMs = fallbackConfig.fallbackIntervalMs ?? 140;
  const fallbackWatchdogMs = fallbackConfig.fallbackWatchdogMs ?? 10000;

  // Lead Offset Viseme (Live Calibration: 0 - 200 ms)
  const configLeadOffset = typeof fallbackConfig.leadOffsetMs === 'number'
    ? fallbackConfig.leadOffsetMs
    : 0;

  function readSavedLeadOffset() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('brone_viseme_lead_offset_ms');
        if (saved !== null) {
          const parsed = parseInt(saved, 10);
          if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 200) {
            return parsed;
          }
        }
      } catch {}
    }
    return null;
  }

  let leadOffsetMs = readSavedLeadOffset() ?? configLeadOffset;
  if (state) state.leadOffsetMs = leadOffsetMs;

  function setLeadOffset(val) {
    const clamped = Math.max(0, Math.min(200, Math.round(Number(val) || 0)));
    leadOffsetMs = clamped;
    if (state) state.leadOffsetMs = clamped;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('brone_viseme_lead_offset_ms', String(clamped));
      } catch {}
    }
    state?.notifyChange?.();
    return clamped;
  }

  function adjustLeadOffset(delta) {
    return setLeadOffset(leadOffsetMs + delta);
  }

  function resetLeadOffset() {
    const defaultVal = typeof fallbackConfig.leadOffsetMs === 'number'
      ? fallbackConfig.leadOffsetMs
      : 50;
    return setLeadOffset(defaultVal);
  }

  // Timer untuk menahan ekspresi setelah bicara sebelum kembali ke idle (Post-Speech Emotion Hold)
  let _postSpeechHoldTimer = null;
  const holdAfterSpeechMs = fallbackConfig.holdAfterSpeechMs ?? 5000;

  function batalkanHoldTimer() {
    if (_postSpeechHoldTimer !== null) {
      clearTimeout(_postSpeechHoldTimer);
      _postSpeechHoldTimer = null;
    }
  }

  function mulaiPostSpeechHold() {
    batalkanHoldTimer();
    const emosiSaatIni = state?.emosi || state?.emotion;
    if (emosiSaatIni && emosiSaatIni !== 'idle' && emosiSaatIni !== 'netral') {
      _postSpeechHoldTimer = setTimeout(() => {
        _postSpeechHoldTimer = null;
        state.setEmotion('idle', 1.0);
      }, holdAfterSpeechMs);
    }
  }

  function hentikanFallbackMulut(reset = true, triggerHold = false) {
    if (_fallbackInitialTimer !== null) {
      clearTimeout(_fallbackInitialTimer);
      _fallbackInitialTimer = null;
    }
    if (_fallbackTimer !== null) {
      clearInterval(_fallbackTimer);
      _fallbackTimer = null;
    }
    if (_fallbackWatchdog !== null) {
      clearTimeout(_fallbackWatchdog);
      _fallbackWatchdog = null;
    }
    if (reset) state.setViseme('DIAM');
    if (triggerHold) mulaiPostSpeechHold();
  }

  function mulaiFallbackMulut(durasiS) {
    if (visemeMode !== 'fallback') return;
    hentikanFallbackMulut(false);

    // Mulai dari bentuk mulut ekspresi aktif, bukan langsung lompat ke viseme fallback.
    state.setViseme('DIAM');

    const fallbackVisemes = ['O', 'REST'];
    let index = 1;
    const initialDelayMs = Math.max(0, fallbackIntervalMs - leadOffsetMs);

    _fallbackInitialTimer = setTimeout(() => {
      _fallbackInitialTimer = null;
      index = 0;
      state.setViseme(fallbackVisemes[index]);

      _fallbackTimer = setInterval(() => {
        index = index === 0 ? 1 : 0;
        state.setViseme(fallbackVisemes[index]);
      }, fallbackIntervalMs);
    }, initialDelayMs);

    const batasWaktuMs = (typeof durasiS === 'number' && durasiS > 0)
      ? durasiS * 1000
      : fallbackWatchdogMs;

    _fallbackWatchdog = setTimeout(() => {
      hentikanFallbackMulut(true, true);
    }, batasWaktuMs);
  }

  /**
   * Membatalkan semua timer viseme yang sedang aktif.
   */
  function batalkanVisemeTimers() {
    _visemeTimers.forEach((id) => clearTimeout(id));
    _visemeTimers = [];
  }

  /**
   * Memainkan jadwal viseme berdasarkan timestamp relatif.
   * Setiap item jadwal { t, v } dimana t adalah detik sejak awal bicara.
   * @param {Array<{t: number, v: string}>} jadwal
   */
  function jalankanJadwalViseme(jadwal) {
    batalkanVisemeTimers();

    if (!Array.isArray(jadwal) || jadwal.length === 0) return;

    // Urutkan jadwal berdasarkan t ascending (antisipasi unordered payload)
    const terurut = [...jadwal].sort((a, b) => a.t - b.t);
    const waktuMulai = performance.now();

    terurut.forEach((item) => {
      const tundaMs = Math.max(0, Math.round(item.t * 1000 - leadOffsetMs));
      const timerId = setTimeout(() => {
        // Hanya set jika state masih "hidup" (bicara belum selesai)
        state.setViseme(item.v);
      }, tundaMs);
      _visemeTimers.push(timerId);
    });

    // Pasang watchdog: jika tidak ada pesan 'bicara/selesai', reset setelah viseme terakhir + 500ms buffer
    const tAkhir = terurut[terurut.length - 1].t;
    const watchdogDelay = Math.max(0, Math.round((tAkhir * 1000) - leadOffsetMs) + 500);
    const watchdogId = setTimeout(() => {
      state.setViseme('DIAM');
      mulaiPostSpeechHold();
    }, watchdogDelay);
    _visemeTimers.push(watchdogId);
  }

  /**
   * Handler utama untuk semua payload yang masuk dari MQTT via Tauri.
   */
  const handlePayload = (rawPayload) => {
    let payload = rawPayload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        console.warn('[Connector] Gagal parse string payload JSON:', err);
        return;
      }
    }
    if (!payload || typeof payload !== 'object') return;
    // Gaze tidak menyentuh deduplikasi LLM, timer emosi, atau lifecycle mulut.
    if (payload.tipe === 'gaze') {
      if (!modeManager || modeManager.handleIncomingMessage(payload)) {
        state.setGaze(payload.x);
      }
      return;
    }
    // Accept the same combined JSON through the browser test bridge.
    if ((!payload.tipe || payload.tipe === 'ekspresi') && Object.hasOwn(payload, 'sentence')) {
      payload = { ...payload, tipe: 'sentence' };
    }

    // Deduplikasi jika pesan identik tiba ganda dalam kurun < 30ms (mencegah trigger ganda)
    const payloadStr = JSON.stringify(payload);
    const now = performance.now();
    if (!['word', 'sentence'].includes(payload.tipe) && payloadStr === _lastMsgStr && (now - _lastMsgTime) < 30) {
      return;
    }
    _lastMsgStr = payloadStr;
    _lastMsgTime = now;

    // Filter pesan saat mode statis (AC-17.4)
    if (modeManager && !modeManager.handleIncomingMessage(payload)) {
      return;
    }

    const { tipe } = payload;
    if (tipe === 'sentence') {
      if (visemeMode === 'streaming') streaming.sentence({ ...payload,
        expression: EMOTION_ALIASES[payload.expression] || payload.expression });
      return;
    }
    if (tipe === 'word') {
      if (visemeMode === 'streaming') streaming.word(payload.word);
      return;
    }
    if (visemeMode === 'streaming') {
      if (tipe === 'ekspresi') {
        const emotion = EMOTION_ALIASES[payload.emosi] || payload.emosi;
        if (typeof emotion !== 'string' || !emotion) return;
        stop(false);
        streaming.closed = false;
        state.setEmotion(emotion, payload.intensitas ?? 1.0);
        const seconds = payload.durasi_s ?? payload.duration ?? payload.durasi_ms / 1000;
        if (Number.isFinite(seconds) && seconds > 0) streaming.start(seconds, true);
      } else if (tipe === 'bicara') {
        if (payload.status === 'mulai') streaming.start(payload.durasi_s ?? payload.duration);
        else if (payload.status === 'selesai') streaming.finish();
      }
      return;
    }
    if (tipe === 'viseme' && visemeMode === 'fallback' && !legacyFallback) return;
    if (tipe === 'ekspresi' || tipe === 'viseme' || (tipe === 'bicara' && payload.status === 'mulai')) {
      batalkanHoldTimer();
    }

    if (tipe === 'ekspresi') {
      const { emosi: rawEmosi, intensitas = 1.0, durasi_ms, jadwal, viseme: visemeJadwal, durasi_s, duration } = payload;
      const emosi = EMOTION_ALIASES[rawEmosi] || rawEmosi;

      // Batalkan timer ekspresi sebelumnya jika ada
      if (_ekspresiTimer !== null) {
        clearTimeout(_ekspresiTimer);
        _ekspresiTimer = null;
      }

      state.setEmotion(emosi, intensitas);

      // Jika payload membawa jadwal viseme (paket gabungan)
      const listJadwal = jadwal || visemeJadwal;
      if ((visemeMode === 'bawaan' || legacyFallback) && Array.isArray(listJadwal) && listJadwal.length > 0) {
        hentikanFallbackMulut(false);
        jalankanJadwalViseme(listJadwal);
      } else if (durasi_s || duration) {
        // Jika membawa durasi suara tanpa jadwal viseme eksplisit
        mulaiFallbackMulut(durasi_s || duration);
      }

      // Auto-reset ke idle setelah durasi_ms jika diset
      if (typeof durasi_ms === 'number' && durasi_ms > 0) {
        _ekspresiTimer = setTimeout(() => {
          _ekspresiTimer = null;
          state.setEmotion('idle', 1.0);
        }, durasi_ms);
      }
    } else if (tipe === 'viseme') {
      const { jadwal } = payload;
      // Jadwal viseme asli selalu menang atas fallback.
      hentikanFallbackMulut(false);
      jalankanJadwalViseme(jadwal);
    } else if (tipe === 'bicara') {
      const { status } = payload;
      if (status === 'selesai') {
        // Hentikan jadwal viseme dan reset ke diam, lalu tahan ekspresi sebelum kembali ke idle
        hentikanFallbackMulut(false);
        batalkanVisemeTimers();
        state.setViseme('DIAM');
        mulaiPostSpeechHold();
      } else if (status === 'mulai') {
        const durasiS = payload.durasi_s || payload.duration;
        mulaiFallbackMulut(durasiS);
      }
    }
  };

  function stop(resetDedupe = true) {
    if (_ekspresiTimer !== null) clearTimeout(_ekspresiTimer);
    _ekspresiTimer = null;
    batalkanHoldTimer();
    batalkanVisemeTimers();
    hentikanFallbackMulut(false);
    streaming.cancel();
    if (resetDedupe) _lastMsgStr = '';
  }

  const controller = {
    get mode() { return visemeMode; },
    get leadOffset() { return leadOffsetMs; },
    setMode(mode) {
      if (!validModes.includes(mode) || mode === visemeMode) return;
      stop();
      legacyFallback = false;
      visemeMode = mode;
      state.visemeMode = mode;
      state.notifyChange?.();
    },
    setLeadOffset,
    adjustLeadOffset,
    resetLeadOffset,
    stop,
  };

  // 1. Integrasi Tauri Event API jika berjalan di desktop Tauri
  const tauriListen = window.__TAURI__?.event?.listen || window.__TAURI_INTERNALS__?.listen;
  if (typeof tauriListen === 'function') {
    const events = [
      'brone://ekspresi', 'brone/ekspresi', 'brone:ekspresi',
      'brone://viseme', 'brone/viseme', 'brone:viseme',
      'brone://bicara', 'brone/bicara', 'brone:bicara',
      'brone://word',
      'brone://sentence',
      'brone://gaze',
      'brone-message'
    ];
    events.forEach((evtName) => {
      try {
        tauriListen(evtName, (event) => handlePayload(event.payload));
      } catch {}
    });
  }

  // 2. Helper test untuk pengujian mandiri di browser (Window CustomEvent / helper global)
  window.addEventListener('brone:message', (event) => handlePayload(event.detail));
  window.sendBroneMessage = (payload) => handlePayload(payload);

  // 3. Jembatan SSE saat berjalan di mode Web browser (Dev Server)
  if (!window.__TAURI__ && typeof EventSource !== 'undefined') {
    try {
      const sse = new EventSource('/events');
      sse.onmessage = (event) => {
        if (!event.data) return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed && !parsed.connected) {
            handlePayload(parsed);
          }
        } catch {}
      };
    } catch {}
  }
  return controller;
}
