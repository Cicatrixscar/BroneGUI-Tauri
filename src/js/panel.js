// Panel kontrol manual untuk mode statis (F-17) dan dialog password (F-16).

export class ControlPanel {
  constructor(state, modeManager, keymap = {}) {
    this.state = state;
    this.modeManager = modeManager;
    this.keymap = keymap;

    this.isPanelVisible = true;
    this.panelEl = null;
    this.modalEl = null;

    this.initDOM();

    // Dengarkan perubahan state untuk update badge aktif
    if (this.state) {
      if (typeof this.state.addListener === 'function') {
        this.state.addListener(() => this.updateActiveIndicators());
      } else {
        this.state.onStateChange = () => this.updateActiveIndicators();
      }
    }
  }

  initDOM() {
    // 1. Container Panel Mode Statis
    this.panelEl = document.createElement('div');
    this.panelEl.id = 'control-panel';
    this.panelEl.className = 'control-panel-hidden';

    this.panelEl.innerHTML = `
      <div class="panel-header">
        <span class="panel-badge">MODE STATIS</span>
        <div class="panel-shortcuts">
          <span><kbd>F2</kbd> Ganti Mode</span>
          <span><kbd>F3</kbd> Sembunyikan Panel</span>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-title">Ekspresi (1–8)</div>
        <div class="button-grid" id="expr-buttons"></div>
      </div>

      <div class="panel-section">
        <div class="section-title">Viseme Mulut (Q–G)</div>
        <div class="button-grid viseme-grid" id="viseme-buttons"></div>
      </div>
    `;

    document.body.appendChild(this.panelEl);

    // Isi daftar tombol ekspresi
    const exprContainer = this.panelEl.querySelector('#expr-buttons');
    const exprMap = this.keymap.expressions ?? {
      '1': 'netral',
      '2': 'berpikir',
      '3': 'sedih',
      '4': 'menangis',
      '5': 'terkejut',
      '6': 'senang',
      '7': 'sangat_senang',
      '8': 'timeout'
    };

    for (const [key, emosi] of Object.entries(exprMap)) {
      const btn = document.createElement('button');
      btn.className = 'panel-btn';
      btn.dataset.emotion = emosi;
      btn.innerHTML = `<kbd>${key}</kbd> ${emosi}`;
      btn.addEventListener('click', () => {
        if (this.state) {
          this.state.setEmotion(emosi);
          this.state.setViseme('DIAM');
        }
      });
      exprContainer.appendChild(btn);
    }

    // Isi daftar tombol viseme
    const visemeContainer = this.panelEl.querySelector('#viseme-buttons');
    const visemeMap = this.keymap.visemes ?? {
      'q': 'P_B_M',
      'w': 'TH',
      'e': 'N_L',
      'r': 'T_D',
      't': 'F_V',
      'y': 'K',
      'u': 'C_J_SY',
      'i': 'S_Z',
      'o': 'R',
      'p': 'A',
      'a': 'E',
      's': 'I_G',
      'd': 'O',
      'f': 'U',
      'g': 'DIAM'
    };

    for (const [key, viseme] of Object.entries(visemeMap)) {
      const btn = document.createElement('button');
      btn.className = 'panel-btn';
      btn.dataset.viseme = viseme;
      btn.innerHTML = `<kbd>${key.toUpperCase()}</kbd> ${viseme}`;
      btn.addEventListener('click', () => {
        if (this.state) this.state.setViseme(viseme);
      });
      visemeContainer.appendChild(btn);
    }

    // 2. Modal Dialog Password (F-16)
    this.modalEl = document.createElement('div');
    this.modalEl.id = 'password-modal';
    this.modalEl.className = 'modal-hidden';
    this.modalEl.innerHTML = `
      <div class="modal-box">
        <h3>Verifikasi Pergantian Mode</h3>
        <p id="modal-desc">Masukkan password operator untuk beralih mode:</p>
        <div class="input-group">
          <input type="password" id="modal-pwd-input" autocomplete="off" placeholder="Password..." />
        </div>
        <div id="modal-error" class="error-msg"></div>
        <div class="modal-actions">
          <button id="modal-cancel-btn" class="btn-secondary">Batal (Esc)</button>
          <button id="modal-submit-btn" class="btn-primary">Konfirmasi (Enter)</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modalEl);

    // Event listener modal
    const pwdInput = this.modalEl.querySelector('#modal-pwd-input');
    const submitBtn = this.modalEl.querySelector('#modal-submit-btn');
    const cancelBtn = this.modalEl.querySelector('#modal-cancel-btn');

    const submitAction = async () => {
      const pwd = pwdInput.value;
      const res = await this.modeManager.verifyPassword(pwd);
      if (res.success) {
        this.hidePasswordDialog();
        await this.modeManager.switchMode();
      } else {
        const errorEl = this.modalEl.querySelector('#modal-error');
        errorEl.textContent = res.error || 'Password salah';
        pwdInput.value = '';
        pwdInput.focus();
      }
    };

    submitBtn.addEventListener('click', submitAction);
    cancelBtn.addEventListener('click', () => this.hidePasswordDialog());

    pwdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitAction();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hidePasswordDialog();
      }
    });

    this.updateActiveIndicators();
  }

  setMode(mode) {
    if (mode === 'statis') {
      this.isPanelVisible = true;
      this.panelEl.classList.remove('control-panel-hidden');
    } else {
      this.panelEl.classList.add('control-panel-hidden');
    }
    this.updateActiveIndicators();
  }

  togglePanelVisibility() {
    if (!this.modeManager.isStatic()) return;
    this.isPanelVisible = !this.isPanelVisible;
    if (this.isPanelVisible) {
      this.panelEl.classList.remove('control-panel-hidden');
    } else {
      this.panelEl.classList.add('control-panel-hidden');
    }
  }

  showPasswordDialog() {
    const errorEl = this.modalEl.querySelector('#modal-error');
    errorEl.textContent = '';
    const pwdInput = this.modalEl.querySelector('#modal-pwd-input');
    pwdInput.value = '';

    const targetMode = this.modeManager.isDynamic() ? 'Mode Statis' : 'Mode Dinamis';
    const descEl = this.modalEl.querySelector('#modal-desc');
    descEl.textContent = `Beralih ke ${targetMode}. Masukkan password:`;

    if (this.modeManager.isLockedOut()) {
      errorEl.textContent = `Terkunci karena 3 kali salah. Tunggu ${this.modeManager.getLockoutRemainingSeconds()} detik.`;
      pwdInput.disabled = true;
    } else {
      pwdInput.disabled = false;
    }

    this.modalEl.classList.remove('modal-hidden');
    setTimeout(() => pwdInput.focus(), 50);
  }

  hidePasswordDialog() {
    this.modalEl.classList.add('modal-hidden');
    const pwdInput = this.modalEl.querySelector('#modal-pwd-input');
    pwdInput.value = '';
    pwdInput.disabled = false; // Reset disabled state agar tidak terkunci saat dibuka lagi
    const errorEl = this.modalEl.querySelector('#modal-error');
    errorEl.textContent = '';
  }

  updateActiveIndicators() {
    if (!this.panelEl || !this.state) return;

    // Update ekspresi aktif
    const currentEmotion = this.state.emosi;
    const exprButtons = this.panelEl.querySelectorAll('#expr-buttons .panel-btn');
    exprButtons.forEach((btn) => {
      if (btn.dataset.emotion === currentEmotion) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update viseme aktif
    const currentViseme = this.state.viseme;
    const visemeButtons = this.panelEl.querySelectorAll('#viseme-buttons .panel-btn');
    visemeButtons.forEach((btn) => {
      if (btn.dataset.viseme === currentViseme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}

