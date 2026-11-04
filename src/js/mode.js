// Pemilihan dan perpindahan mode (F-16, F-18).

export class ModeManager {
  constructor(config = {}, keymap = {}, state = null, panel = null) {
    this.config = config.mode ?? {};
    this.keymap = keymap ?? {};
    this.state = state;
    this.panel = panel;

    this.currentMode = this.config.default_mode ?? 'dinamis'; // 'dinamis' | 'statis'
    this.staticModeAllowed = this.config.mode_statis_aktif !== false;

    // Keamanan password (F-16)
    this.maxAttempts = this.config.max_password_attempts ?? 3;
    this.lockoutDurationMs = (this.config.lockout_duration_s ?? 60) * 1000;
    this.failedAttempts = 0;
    this.lockoutUntil = 0;

    this.fallbackPassword = this.config.dev_fallback_password ?? 'brone';

    this.onModeChange = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
  }

  isStatic() {
    return this.currentMode === 'statis';
  }

  isDynamic() {
    return this.currentMode === 'dinamis';
  }

  isLockedOut() {
    return Date.now() < this.lockoutUntil;
  }

  getLockoutRemainingSeconds() {
    return Math.max(0, Math.ceil((this.lockoutUntil - Date.now()) / 1000));
  }

  async verifyPassword(inputPassword) {
    if (this.isLockedOut()) {
      return {
        success: false,
        error: `Terkunci karena 3 kali salah. Tunggu ${this.getLockoutRemainingSeconds()} detik.`
      };
    }

    // Jika berjalan di dalam Tauri, kirim ke backend Rust (AC-16.9)
    if (window.__TAURI__?.core?.invoke) {
      try {
        const verified = await window.__TAURI__.core.invoke('verify_mode_password', {
          password: inputPassword
        });
        if (verified) {
          this.failedAttempts = 0;
          return { success: true };
        }
        // Tauri berhasil dipanggil tapi password salah — lanjutkan ke penghitungan gagal
      } catch (err) {
        // Error teknis Tauri (bukan salah password) — jangan naikkan failedAttempts
        console.warn('[Mode] Error teknis saat verifikasi di Tauri, fallback ke browser check:', err);
        // Tetap lanjutkan ke fallback browser di bawah
      }
    }

    // Fallback dev browser (juga dipakai jika Tauri error teknis)
    if (inputPassword === this.fallbackPassword) {
      this.failedAttempts = 0;
      return { success: true };
    }

    // Password salah (AC-16.7)
    this.failedAttempts += 1;
    console.warn(`[Mode] Percobaan password salah (${this.failedAttempts}/${this.maxAttempts})`);

    if (this.failedAttempts >= this.maxAttempts) {
      this.lockoutUntil = Date.now() + this.lockoutDurationMs;
      console.warn(`[Mode] F2 dikunci selama ${this.lockoutDurationMs / 1000} detik.`);
      return {
        success: false,
        error: `3 kali salah berturut-turut. F2 dikunci selama ${this.config.lockout_duration_s ?? 60} detik.`
      };
    }

    return {
      success: false,
      error: `Password salah. Sisa percobaan: ${this.maxAttempts - this.failedAttempts}`
    };
  }

  async switchMode() {
    if (!this.staticModeAllowed && this.currentMode === 'dinamis') {
      console.warn('[Mode] Mode statis dinonaktifkan di konfigurasi (mode_statis_aktif: false).');
      return false;
    }

    const previousMode = this.currentMode;
    const targetMode = previousMode === 'dinamis' ? 'statis' : 'dinamis';

    this.currentMode = targetMode;
    const timestamp = new Date().toISOString();
    console.info(`[${timestamp}] [Mode] Mode berganti dari ${previousMode} ke ${targetMode}`);

    // Jika kembali ke dinamis, reset wajah ke idle (AC-16.8, AC-18.3)
    if (targetMode === 'dinamis' && this.state) {
      this.state.resetToIdle();
    }

    if (this.onModeChange) {
      this.onModeChange(this.currentMode);
    }

    return true;
  }

  // Menangani input pesan dari connector (AC-17.4)
  handleIncomingMessage(message) {
    if (this.isStatic()) {
      console.info(`[Mode] Pesan ${message.tipe ?? 'unknown'} dibuang karena aplikasi dalam mode statis (AC-17.4).`);
      return false;
    }
    return true;
  }

  handleKeyDown(event) {
    const key = event.key;

    // Jika modal password sedang terbuka, jangan ganggu input apapun (kecuali F2 itu sendiri tidak relevan)
    // Biarkan browser menangani semua keydown di dalam modal
    if (this.panel && !this.panel.modalEl?.classList.contains('modal-hidden')) {
      return;
    }

    // F2: Buka dialog password untuk ganti mode (F-16)
    const toggleModeKey = this.keymap.toggleMode ?? 'F2';
    if (key === toggleModeKey) {
      event.preventDefault();
      if (!this.staticModeAllowed && this.isDynamic()) {
        alert('Mode statis dinonaktifkan dalam konfigurasi (mode_statis_aktif: false).');
        return;
      }
      if (this.panel) {
        this.panel.showPasswordDialog();
      }
      return;
    }

    // Jika sedang dalam mode dinamis, abaikan semua tombol lain (AC-17.9)
    if (this.isDynamic()) {
      return;
    }

    // Tombol-tombol di mode statis (F-17):
    // F3: Toggle tampilan panel
    const togglePanelKey = this.keymap.togglePanel ?? 'F3';
    if (key === togglePanelKey) {
      event.preventDefault();
      if (this.panel) {
        this.panel.togglePanelVisibility();
      }
      return;
    }

    // Pilihan ekspresi: 1 sampai 7
    const exprMap = this.keymap.expressions ?? {};
    if (exprMap[key]) {
      event.preventDefault();
      const emotion = exprMap[key];
      if (this.state) {
        this.state.setEmotion(emotion);
        this.state.setViseme('DIAM');
      }
      return;
    }

    // Pilihan viseme: Q, W, E, ... (huruf kecil atau besar)
    const visemeMap = this.keymap.visemes ?? {};
    const lowerKey = key.toLowerCase();
    if (visemeMap[lowerKey]) {
      event.preventDefault();
      const viseme = visemeMap[lowerKey];
      if (this.state) {
        this.state.setViseme(viseme);
      }
      return;
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}

