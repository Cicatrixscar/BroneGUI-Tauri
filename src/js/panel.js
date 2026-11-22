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
  constructor(state, modeManager, keymap = {}, visemeController = null) {
    this.visemeController = visemeController;
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
        <label for="viseme-mode">Sumber gerakan mulut saat mode dinamis (${this.keymap.toggleVisemeMode ?? 'F4'})</label>
        <select id="viseme-mode">
          <option value="bawaan">Bawaan (jadwal viseme)</option>
          <option value="streaming">Streaming kalimat</option>
          <option value="fallback">Fallback mulut</option>
        </select>
      </div>

      <div class="panel-section">
        <div class="section-title">Offset Waktu Mulut (${this.keymap.visemeOffsetDown ?? '['} / ${this.keymap.visemeOffsetUp ?? ']'})</div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; color: #8b949e;">Lead Time:</span>
          <span id="viseme-offset-val" style="font-weight: 600; color: #58a6ff;">${this.visemeController?.leadOffset ?? 50} ms</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
          <button id="btn-offset-down" class="panel-btn" type="button"><kbd>${this.keymap.visemeOffsetDown ?? '['}</kbd> -10ms</button>
          <button id="btn-offset-reset" class="panel-btn" type="button"><kbd>${this.keymap.visemeOffsetReset ?? '\\'}</kbd> Reset</button>
          <button id="btn-offset-up" class="panel-btn" type="button"><kbd>${this.keymap.visemeOffsetUp ?? ']'}</kbd> +10ms</button>
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

    this.visemeNotice = document.createElement('div');
    this.visemeNotice.id = 'viseme-mode-notice';
    this.visemeNotice.setAttribute('role', 'status');
    this.visemeNotice.setAttribute('aria-live', 'polite');
    this.visemeNotice.hidden = true;
    document.body.appendChild(this.visemeNotice);

    const visemeSelect = this.panelEl.querySelector('#viseme-mode');
    if (visemeSelect && this.visemeController) {
      visemeSelect.value = this.visemeController.mode;
      visemeSelect.addEventListener('change', () => this.visemeController.setMode(visemeSelect.value));
    }

    // Isi daftar tombol ekspresi
    const exprContainer = this.panelEl.querySelector('#expr-buttons');
    const exprMap = this.keymap.expressions ?? {
      '1': 'idle',
      '2': 'confused',
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

    const btnOffsetDown = this.panelEl.querySelector('#btn-offset-down');
    if (btnOffsetDown && this.visemeController) {
      btnOffsetDown.addEventListener('click', () => {
        const val = this.visemeController.adjustLeadOffset(-10);
        this.showVisemeOffset(val);
      });
    }

    const btnOffsetReset = this.panelEl.querySelector('#btn-offset-reset');
    if (btnOffsetReset && this.visemeController) {
      btnOffsetReset.addEventListener('click', () => {
        const val = this.visemeController.resetLeadOffset();
        this.showVisemeOffset(val);
      });
    }

    const btnOffsetUp = this.panelEl.querySelector('#btn-offset-up');
    if (btnOffsetUp && this.visemeController) {
      btnOffsetUp.addEventListener('click', () => {
        const val = this.visemeController.adjustLeadOffset(10);
        this.showVisemeOffset(val);
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

  showVisemeMode(mode) {
    const labels = { bawaan: 'Bawaan (jadwal)', streaming: 'Streaming kalimat', fallback: 'Fallback mulut' };
    this.visemeNotice.textContent = `${this.keymap.toggleVisemeMode ?? 'F4'} | Viseme: ${labels[mode] ?? mode}`;
    this.visemeNotice.hidden = false;
    clearTimeout(this.visemeNoticeTimer);
    this.visemeNoticeTimer = setTimeout(() => { this.visemeNotice.hidden = true; }, 2000);
  }

  showVisemeOffset(offset) {
    if (!this.visemeNotice) return;
    const desc = offset === 0
      ? '0 ms (tanpa offset)'
      : `+${offset} ms (lebih cepat)`;
    this.visemeNotice.textContent = `⚡ Offset Mulut: ${desc}  [${this.keymap.visemeOffsetDown ?? '['}: -10 | ${this.keymap.visemeOffsetUp ?? ']'}: +10 | ${this.keymap.visemeOffsetReset ?? '\\'}: reset]`;
    this.visemeNotice.hidden = false;
    clearTimeout(this.visemeNoticeTimer);
    this.visemeNoticeTimer = setTimeout(() => { this.visemeNotice.hidden = true; }, 2200);
    this.updateActiveIndicators();
  }

  updateActiveIndicators() {
    if (!this.panelEl || !this.state) return;

    const select = this.panelEl.querySelector('#viseme-mode');
    if (select && this.visemeController) select.value = this.visemeController.mode;

    const offsetEl = this.panelEl.querySelector('#viseme-offset-val');
    if (offsetEl && this.visemeController) {
      const offset = this.visemeController.leadOffset ?? 0;
      offsetEl.textContent = `${offset} ms${offset > 0 ? ' (lead)' : ''}`;
    }

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

