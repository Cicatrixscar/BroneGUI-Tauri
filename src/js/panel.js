// Panel kontrol manual untuk mode statis (F-17).

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
          <span id="btn-toggle-mode" style="cursor: pointer;"><kbd>F2</kbd> Ganti Mode</span>
          <span id="btn-toggle-panel" style="cursor: pointer;"><kbd>F3</kbd> Sembunyikan Panel</span>
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
      '1': 'idle',
      '2': 'thinking',
      '3': 'sad',
      '4': 'cry',
      '5': 'shock',
      '6': 'happy',
      '7': 'happier',
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

    // Shortcut klik langsung ganti mode & sembunyikan panel
    const toggleModeBtn = this.panelEl.querySelector('#btn-toggle-mode');
    if (toggleModeBtn) {
      toggleModeBtn.addEventListener('click', () => {
        if (this.modeManager) this.modeManager.switchMode();
      });
    }
    const togglePanelBtn = this.panelEl.querySelector('#btn-toggle-panel');
    if (togglePanelBtn) {
      togglePanelBtn.addEventListener('click', () => {
        this.togglePanelVisibility();
      });
    }

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

