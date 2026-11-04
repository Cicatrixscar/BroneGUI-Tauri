// Mendengarkan event dari BE (Tauri) dan memperbarui state (F-05, F-07).
// Nama event dan bentuk payload mengikuti docs/CONTRACT.md.

export function initConnector(state, modeManager) {
  // Timer untuk auto-reset ekspresi setelah durasi_ms habis
  let _ekspresiTimer = null;
  // Timer untuk viseme scheduler
  let _visemeTimers = [];

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
  const handlePayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;

    // Filter pesan saat mode statis (AC-17.4)
    if (modeManager && !modeManager.handleIncomingMessage(payload)) {
      return;
    }

    const { tipe } = payload;

    if (tipe === 'ekspresi') {
      const { emosi, intensitas = 1.0, durasi_ms } = payload;

      // Batalkan timer ekspresi sebelumnya jika ada
      if (_ekspresiTimer !== null) {
        clearTimeout(_ekspresiTimer);
        _ekspresiTimer = null;
      }

      state.setEmotion(emosi, intensitas);

      // Auto-reset ke netral setelah durasi_ms jika diset
      if (typeof durasi_ms === 'number' && durasi_ms > 0) {
        _ekspresiTimer = setTimeout(() => {
          _ekspresiTimer = null;
          state.setEmotion('netral', 1.0);
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
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen('brone://ekspresi', (event) => handlePayload(event.payload));
    window.__TAURI__.event.listen('brone://viseme', (event) => handlePayload(event.payload));
    window.__TAURI__.event.listen('brone://bicara', (event) => handlePayload(event.payload));
    window.__TAURI__.event.listen('brone-message', (event) => handlePayload(event.payload));
  }

  // 2. Helper test untuk pengujian mandiri di browser (Window CustomEvent / helper global)
  window.addEventListener('brone:message', (event) => handlePayload(event.detail));
  window.sendBroneMessage = (payload) => handlePayload(payload);
}
