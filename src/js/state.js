// State wajah: emosi aktif, intensitas, viseme, dan parameter render saat ini (F-05, F-08, F-16).

export class FaceState {
  constructor(config = {}) {
    this.config = config;
    this.emosi = 'netral';
    this.intensitas = 1.0;
    this.viseme = 'DIAM';
    this.onStateChange = null;
    this.listeners = [];

    // Parameter dinamis yang diinterpolasi / dirender
    this.params = {
      eyeOpenness: 1.0,      // Faktor kedip (0 = tutup rapat, 1 = terbuka penuh)
      eyeSquint: 0.0,        // Sipit bawah (0.0 sampai 1.0)
      mouthOpenness: 1.0,    // Keterbukaan mulut netral (0 = tutup, 1 = netral)
      mouthCurvature: 0.0,   // Kelengkungan senyum (+1 senang, -1 sedih)
    };
  }

  addListener(fn) {
    if (typeof fn === 'function' && !this.listeners.includes(fn)) {
      this.listeners.push(fn);
    }
  }

  removeListener(fn) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }

  notifyChange() {
    if (typeof this.onStateChange === 'function') {
      try {
        this.onStateChange();
      } catch (err) {
        console.error('[FaceState] onStateChange error:', err);
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (err) {
        console.error('[FaceState] Listener error:', err);
      }
    }
  }

  setBlinkFactor(factor) {
    this.params.eyeOpenness = factor;
  }

  setEmotion(emosi, intensitas = 1.0) {
    this.emosi = emosi;
    this.intensitas = intensitas;
    this.notifyChange();
  }

  setViseme(viseme) {
    this.viseme = viseme;
    this.notifyChange();
  }

  resetToIdle() {
    this.emosi = 'netral';
    this.intensitas = 1.0;
    this.viseme = 'DIAM';
    this.params.eyeOpenness = 1.0;
    this.params.eyeSquint = 0.0;
    this.params.mouthOpenness = 1.0;
    this.params.mouthCurvature = 0.0;
    this.notifyChange();
  }
}
