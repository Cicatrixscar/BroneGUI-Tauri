// Pemilihan dan perpindahan mode (F-16, F-18).

export class ModeManager {
  constructor(config = {}, keymap = {}, state = null, panel = null) {
    this.config = config.mode ?? {};
    this.keymap = keymap ?? {};
    this.state = state;
    this.panel = panel;

    this.currentMode = this.config.default_mode ?? 'dinamis'; // 'dinamis' | 'statis'
    this.staticModeAllowed = this.config.mode_statis_aktif !== false;

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
    return false;
  }

  getLockoutRemainingSeconds() {
    return 0;
  }

  async verifyPassword(_inputPassword) {
    return { success: true };
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

    // F2: Langsung ganti mode (dinamis <-> statis) tanpa password
    const toggleModeKey = this.keymap.toggleMode ?? 'F2';
    if (key === toggleModeKey) {
      event.preventDefault();
      if (!this.staticModeAllowed && this.isDynamic()) {
        alert('Mode statis dinonaktifkan dalam konfigurasi (mode_statis_aktif: false).');
        return;
      }
      this.switchMode();
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

