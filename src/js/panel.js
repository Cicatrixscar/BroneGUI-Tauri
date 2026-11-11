// Panel kontrol manual untuk mode statis (F-17).

export function closeApplication() {
  if (window.__TAURI__?.core?.invoke) {
    window.__TAURI__.core.invoke('exit_app');
  } else if (window.__TAURI__?.invoke) {
    window.__TAURI__.invoke('exit_app');
  } else if (window.__TAURI_INTERNALS__?.invoke) {
    window.__TAURI_INTERNALS__.invoke('exit_app');
  } else {
    window.close();
  }
}

export async function toggleFullscreen() {
  const enterIcon = document.getElementById('icon-fs-enter');
  const exitIcon = document.getElementById('icon-fs-exit');

  const updateIcon = (isFs) => {
    if (enterIcon && exitIcon) {
      enterIcon.style.display = isFs ? 'none' : '';
      exitIcon.style.display = isFs ? '' : 'none';
    }
  };

  const invokeTauri = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || window.__TAURI_INTERNALS__?.invoke;
  if (typeof invokeTauri === 'function') {
    try {
      const isFs = await invokeTauri('toggle_fullscreen');
      updateIcon(isFs);
      return;
    } catch (e) {
      console.warn('[Fullscreen] Gagal panggil invoke Tauri:', e);
    }
  }

  // Fallback Web Browser Fullscreen API
  try {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      updateIcon(true);
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
      updateIcon(false);
    }
  } catch (err) {
    console.warn('[Fullscreen] Gagal toggle browser fullscreen:', err);
  }
}

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
          <span id="btn-toggle-fs" style="cursor: pointer;"><kbd>F11</kbd> Layar Penuh</span>
          <span id="btn-exit-app" style="cursor: pointer; color: #ff8b8b;"><kbd>Esc</kbd> Keluar</span>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-title">Ekspresi (1–9)</div>
        <div class="button-grid" id="expr-buttons"></div>
      </div>

      <div class="panel-section">
        <div class="section-title">Viseme Mulut (A, I, U, E, O, REST, DIAM)</div>
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
      '8': 'timeout',
      '9': 'happier_transisi'
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
      'a': 'A',
      'i': 'I',
      'u': 'U',
      'e': 'E',
      'o': 'O',
      'r': 'REST',
      'd': 'DIAM'
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

    const toggleFsBtn = this.panelEl.querySelector('#btn-toggle-fs');
    if (toggleFsBtn) {
      toggleFsBtn.addEventListener('click', () => {
        toggleFullscreen();
      });
    }

    const exitBtn = this.panelEl.querySelector('#btn-exit-app');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        closeApplication();
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

