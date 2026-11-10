// Mendengarkan event dari BE (Tauri) dan memperbarui state (F-05, F-07).
// Nama event dan bentuk payload mengikuti docs/CONTRACT.md.

const EMOTION_ALIASES = {
  netral: 'idle',
  senang: 'happy',
  sangat_senang: 'happier',
  sedih: 'sad',
  menangis: 'cry',
  terkejut: 'shock',
  berpikir: 'thinking',
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
      const tundaMs = Math.max(0, item.t * 1000);
      const timerId = setTimeout(() => {
        // Hanya set jika state masih "hidup" (bicara belum selesai)
        state.setViseme(item.v);
      }, tundaMs);
      _visemeTimers.push(timerId);
    });

    // Pasang watchdog: jika tidak ada pesan 'bicara/selesai', reset setelah viseme terakhir + 500ms buffer
    const tAkhir = terurut[terurut.length - 1].t;
    const watchdogId = setTimeout(() => {
      state.setViseme('DIAM');
    }, tAkhir * 1000 + 500);
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

    // Deduplikasi jika pesan identik tiba ganda dalam kurun < 30ms (mencegah trigger ganda)
    const payloadStr = JSON.stringify(payload);
    const now = performance.now();
    if (payloadStr === _lastMsgStr && (now - _lastMsgTime) < 30) {
      return;
    }
    _lastMsgStr = payloadStr;
    _lastMsgTime = now;

    // Filter pesan saat mode statis (AC-17.4)
    if (modeManager && !modeManager.handleIncomingMessage(payload)) {
      return;
    }

    const { tipe } = payload;

    if (tipe === 'ekspresi') {
      const { emosi: rawEmosi, intensitas = 1.0, durasi_ms } = payload;
      const emosi = EMOTION_ALIASES[rawEmosi] || rawEmosi;

      // Batalkan timer ekspresi sebelumnya jika ada
      if (_ekspresiTimer !== null) {
        clearTimeout(_ekspresiTimer);
        _ekspresiTimer = null;
      }

      state.setEmotion(emosi, intensitas);

      // Auto-reset ke idle setelah durasi_ms jika diset
      if (typeof durasi_ms === 'number' && durasi_ms > 0) {
        _ekspresiTimer = setTimeout(() => {
          _ekspresiTimer = null;
          state.setEmotion('idle', 1.0);
        }, durasi_ms);
      }
    } else if (tipe === 'viseme') {
      const { jadwal } = payload;
      jalankanJadwalViseme(jadwal);
    } else if (tipe === 'bicara') {
      const { status } = payload;
      if (status === 'selesai') {
        // Hentikan jadwal viseme dan reset ke diam
        batalkanVisemeTimers();
        state.setViseme('DIAM');
      }
      // status 'mulai': tidak perlu aksi khusus di FE
    }
  };

  // 1. Integrasi Tauri Event API jika berjalan di desktop Tauri
  const tauriListen = window.__TAURI__?.event?.listen || window.__TAURI_INTERNALS__?.listen;
  if (typeof tauriListen === 'function') {
    const events = [
      'brone://ekspresi', 'brone/ekspresi', 'brone:ekspresi',
      'brone://viseme', 'brone/viseme', 'brone:viseme',
      'brone://bicara', 'brone/bicara', 'brone:bicara',
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
}
