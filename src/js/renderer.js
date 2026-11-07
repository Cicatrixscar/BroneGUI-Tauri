// Renderer SVG berbasis DOM & anime.js sesuai F-01, F-04, F-09, dan F-15 (800x480).

export class Renderer {
  constructor(svgElement, state, blinkController, config) {
    this.svg = svgElement;
    this.state = state;
    this.blinkController = blinkController;
    this.config = config;

    this.baseWidth = config.canvas?.baseWidth ?? 800;
    this.baseHeight = config.canvas?.baseHeight ?? 480;

    // Elemen DOM SVG
    this.backsideGroup = this.svg.querySelector('#layer-backside');
    this.blushL = this.svg.querySelector('#blush-l');
    this.blushR = this.svg.querySelector('#blush-r');
    this.mouthEl = this.svg.querySelector('#mouth');
    this.mouthLayer = this.svg.querySelector('#layer-mouth');
    this.eyeLWrap = this.svg.querySelector('#eye-l-wrap');
    this.eyeRWrap = this.svg.querySelector('#eye-r-wrap');
    this.eyeL = this.svg.querySelector('#eye-l');
    this.eyeR = this.svg.querySelector('#eye-r');
    this.tearLWrap = this.svg.querySelector('#tear-l-wrap');
    this.tearRWrap = this.svg.querySelector('#tear-r-wrap');
    this.tearLImages = [
      this.svg.querySelector('#tear-l-1'),
      this.svg.querySelector('#tear-l-2'),
    ];
    this.tearRImages = [
      this.svg.querySelector('#tear-r-1'),
      this.svg.querySelector('#tear-r-2'),
    ];
    this.effectSym = this.svg.querySelector('#effect-sym');

    // State render internal
    this.currentEmotion = null;
    this.targetEmotion = null;
    this.isTransitioning = false;
    this.transitionTimers = [];
    this.currentViseme = null;
    this.isBlinking = false;
    this.tearAnimation = null;
    this.effectAnimation = null;

    // Pastikan transform center SVG diinisialisasi
    if (this.mouthLayer) {
      this.mouthLayer.style.transformBox = 'fill-box';
      this.mouthLayer.style.transformOrigin = 'center';
    }
    if (this.eyeLWrap) {
      this.eyeLWrap.style.transformBox = 'fill-box';
      this.eyeLWrap.style.transformOrigin = 'center';
    }
    if (this.eyeRWrap) {
      this.eyeRWrap.style.transformBox = 'fill-box';
      this.eyeRWrap.style.transformOrigin = 'center';
    }

    this.initBackside();
    this.initAnimeAnimations();

    // Dengarkan perubahan state wajah
    if (this.state) {
      if (typeof this.state.addListener === 'function') {
        this.state.addListener(() => this.applyState());
      } else {
        this.state.onStateChange = () => this.applyState();
      }
    }

    this.render = this.render.bind(this);
  }

  initBackside() {
    if (!this.backsideGroup) return;
    const b = this.config.backside;
    if (b && b.asset) {
      this.backsideGroup.innerHTML = `
        <image href="${b.asset}" x="${b.x ?? 0}" y="${b.y ?? 0}" width="${b.w ?? 800}" height="${b.h ?? 480}" />
      `;
    }
  }

  initAnimeAnimations() {
    // Animasi efek melayang (tanda seru / tanya)
    if (window.anime && this.effectSym) {
      this.effectAnimation = window.anime({
        targets: '#layer-effects',
        translateY: [-6, 6],
        duration: 900,
        direction: 'alternate',
        loop: true,
        easing: 'easeInOutSine',
        autoplay: false
      });
    }

    // Animasi aliran air mata (menangis): mengalir terus ke bawah (F-09)
    if (window.anime && this.tearLWrap && this.tearRWrap) {
      this.tearAnimation = window.anime({
        targets: [this.tearLWrap, this.tearRWrap],
        translateY: [0, 75],
        duration: 700,
        easing: 'linear',
        loop: true,
        autoplay: false
      });
    }
  }

  start() {
    this.applyState(true);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(this.render);
    }
  }

  render(timestamp = performance.now()) {
    // Sinkronisasi state wajah jika ada perubahan
    this.applyState();

    // Update controller kedip
    if (this.blinkController) {
      if (this.isTransitioning || this.currentEmotion === 'timeout') {
        // Jangan jalankan kedip acak saat sedang transisi ekspresi atau dalam ekspresi timeout
        this.blinkController.isBlinking = false;
        this.blinkController.nextBlinkTime = timestamp + this.blinkController.randomDelay();
      } else {
        const factor = this.blinkController.update(timestamp);
        this.state?.setBlinkFactor(factor);

        // Jika menggunakan anime.js untuk kedip
        if (this.blinkController.isBlinking && !this.isBlinking) {
          this.triggerBlinkAnimation();
        } else if (!this.blinkController.isBlinking && this.isBlinking) {
          this.isBlinking = false;
        }

        // Fallback jika anime.js tidak tersedia di runtime
        if (!window.anime && this.eyeLWrap && this.eyeRWrap) {
          const scaleY = Math.max(0.02, factor);
          this.eyeLWrap.style.transform = `scaleY(${scaleY})`;
          this.eyeRWrap.style.transform = `scaleY(${scaleY})`;
        }
      }
    }

    // Update putaran mata spiral khusus ekspresi timeout (berputar tanpa kedip acak)
    if (this.currentEmotion === 'timeout' && !this.isTransitioning) {
      const speed = 0.22; // ~79 deg/detik (~4.5 detik per rotasi 360)
      const angle = (timestamp * speed) % 360;
      const exprData = this.config.expressions?.timeout;
      const cxL = exprData?.eyeL?.cx ?? 177.76;
      const cyL = exprData?.eyeL?.cy ?? 214.88;
      const cxR = exprData?.eyeR?.cx ?? 622.24;
      const cyR = exprData?.eyeR?.cy ?? 208.04;

      if (this.eyeL) {
        this.eyeL.setAttribute('transform', `rotate(${angle.toFixed(2)} ${cxL} ${cyL})`);
      }
      if (this.eyeR) {
        this.eyeR.setAttribute('transform', `rotate(${(-angle).toFixed(2)} ${cxR} ${cyR})`);
      }
    } else if (this.currentEmotion !== 'timeout') {
      if (this.eyeL && this.eyeL.hasAttribute('transform')) {
        this.eyeL.removeAttribute('transform');
      }
      if (this.eyeR && this.eyeR.hasAttribute('transform')) {
        this.eyeR.removeAttribute('transform');
      }
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(this.render);
    }
  }

  triggerBlinkAnimation() {
    if (this.isTransitioning || this.currentEmotion === 'timeout') return;
    this.isBlinking = true;
    if (window.anime && this.eyeLWrap && this.eyeRWrap) {
      const duration = this.config.blink?.durationMs ?? 350;
      const half = duration / 2;

      window.anime({
        targets: ['#eye-l-wrap', '#eye-r-wrap'],
        scaleY: [
          { value: 0.04, duration: half, easing: 'easeInOutSine' },
          { value: 1.0, duration: half, easing: 'easeInOutSine' }
        ],
        complete: () => {
          this.isBlinking = false;
        }
      });
    }
  }

  applyState(force = false) {
    const emosi = this.state?.emosi || 'netral';
    const viseme = this.state?.viseme || 'DIAM';

    const emotionChanged = force || this.currentEmotion !== emosi;
    const visemeChanged = force || this.currentViseme !== viseme;

    if (force) {
      this.currentEmotion = emosi;
      this.targetEmotion = emosi;
      this.isTransitioning = false;
      this.updateEmotion(emosi);
      this.updateMouth(emosi, viseme);
      this.currentViseme = viseme;
      return;
    }

    if (emotionChanged) {
      if (this.targetEmotion !== emosi) {
        this.targetEmotion = emosi;
        this.transitionToEmotion(emosi);
      }
    } else if (!this.isTransitioning && visemeChanged) {
      this.updateMouth(emosi, viseme);
      this.currentViseme = viseme;
    }
  }

  setMouthToFlat() {
    const flatMouthAsset = this.config.visemes?.P_B_M || 'assets/viseme/P,B,M.svg';
    const flatMouthPos = this.config.visemePositions?.P_B_M || { x: 258.5, y: 366, w: 283, h: 20 };
    if (this.mouthEl) {
      this.mouthEl.setAttribute('href', flatMouthAsset);
      this.mouthEl.setAttribute('x', flatMouthPos.x);
      this.mouthEl.setAttribute('y', flatMouthPos.y);
      this.mouthEl.setAttribute('width', flatMouthPos.w);
      this.mouthEl.setAttribute('height', flatMouthPos.h);
      this.mouthEl.style.display = '';
    }
  }

  /**
   * Transisi pergantian ekspresi wajah:
   * 1. Mata berkedip menutup (scaleY -> 0.04) dan mulut merapat ke bentuk garis datar (P,B,M.svg).
   * 2. Pada titik tengah (mata tertutup & mulut datar), asset mata & mulut diganti ke ekspresi target.
   * 3. Ketika mata terbuka kembali, ekspresi baru sudah aktif sepenuhnya.
   */
  transitionToEmotion(targetEmotion) {
    if (!window.anime) {
      this.updateEmotion(targetEmotion);
      this.updateMouth(targetEmotion, this.state?.viseme || 'DIAM');
      this.currentEmotion = targetEmotion;
      this.isTransitioning = false;
      return;
    }

    this.isTransitioning = true;
    if (this.blinkController) {
      this.blinkController.isBlinking = false;
      this.blinkController.nextBlinkTime = performance.now() + 4000;
    }

    // Bersihkan timer dan animasi sebelumnya jika ada pergantian cepat
    if (this.transitionTimers) {
      this.transitionTimers.forEach(id => clearTimeout(id));
    }
    this.transitionTimers = [];

    window.anime.remove(['#eye-l-wrap', '#eye-r-wrap', '#layer-mouth']);

    const duration = this.config.blink?.durationMs ?? 350;
    const half = Math.round(duration / 2); // ~175ms

    // 1. Mata berkedip: menutup (0 -> half), lalu membuka kembali (half -> duration)
    window.anime({
      targets: ['#eye-l-wrap', '#eye-r-wrap'],
      scaleY: [
        { value: 0.04, duration: half, easing: 'easeInOutSine' },
        { value: 1.0, duration: half, easing: 'easeInOutSine' }
      ]
    });

    // 2. Mulut merapat ke garis datar saat mata menutup
    const tFlatten = Math.round(half * 0.6); // ~105ms
    window.anime({
      targets: '#layer-mouth',
      scaleY: [
        { value: 0.08, duration: tFlatten, easing: 'easeInQuad' },
        { value: 1.0, duration: half - tFlatten, easing: 'easeOutQuad' }
      ],
      opacity: [
        { value: 0.7, duration: tFlatten, easing: 'easeInQuad' },
        { value: 1.0, duration: half - tFlatten, easing: 'easeOutQuad' }
      ]
    });

    // Pada t = tFlatten: Pasang asset mulut paling datar (P,B,M.svg)
    const timer1 = setTimeout(() => {
      this.setMouthToFlat();
    }, tFlatten);
    this.transitionTimers.push(timer1);

    // 3. TITIK TENGAH (t = half, ~175ms): Mata tertutup rapat, mulut datar
    // Saat mata terpejam di dalam kedipan: Ganti mata & mulut ke ekspresi target!
    const timer2 = setTimeout(() => {
      // Ganti asset mata ke ekspresi target saat mata sedang tertutup rapat
      this.updateEyes(targetEmotion);

      // Bersihkan overlay emosi lama (air mata, blush, simbol)
      this.clearEmotionOverlays();

      // Ganti mulut ke ekspresi target
      this.updateMouth(targetEmotion, 'DIAM');

      // Aktifkan overlay emosi baru (air mata, blush, simbol)
      this.updateEmotionOverlays(targetEmotion);

      // Mulut membuka bersamaan dengan mata membuka kembali (half -> duration)
      window.anime({
        targets: '#layer-mouth',
        scaleY: [0.15, 1.0],
        opacity: [0.85, 1.0],
        duration: half,
        easing: 'easeOutQuad'
      });
    }, half);
    this.transitionTimers.push(timer2);

    // 4. SELESAI (t = duration, ~350ms): Mata terbuka penuh, ekspresi baru sudah aktif
    const timer3 = setTimeout(() => {
      this.currentEmotion = targetEmotion;
      this.isTransitioning = false;
      this.transitionTimers = [];

      if (this.eyeLWrap && this.eyeRWrap) {
        this.eyeLWrap.style.transform = '';
        this.eyeRWrap.style.transform = '';
      }
      if (this.mouthLayer) {
        this.mouthLayer.style.transform = '';
        this.mouthLayer.style.opacity = '';
      }
    }, duration);
    this.transitionTimers.push(timer3);
  }

  updateEyes(emosi) {
    const exprData = this.config.expressions?.[emosi] || this.config.expressions?.netral;
    if (!exprData) return;

    // 1. Update Mata Kiri
    if (this.eyeL && exprData.eyeL) {
      this.eyeL.setAttribute('href', exprData.eyeL.asset);
      this.eyeL.setAttribute('x', exprData.eyeL.x);
      this.eyeL.setAttribute('y', exprData.eyeL.y);
      this.eyeL.setAttribute('width', exprData.eyeL.w);
      this.eyeL.setAttribute('height', exprData.eyeL.h);
    }

    // 2. Update Mata Kanan
    if (this.eyeR && exprData.eyeR) {
      this.eyeR.setAttribute('href', exprData.eyeR.asset);
      this.eyeR.setAttribute('x', exprData.eyeR.x);
      this.eyeR.setAttribute('y', exprData.eyeR.y);
      this.eyeR.setAttribute('width', exprData.eyeR.w);
      this.eyeR.setAttribute('height', exprData.eyeR.h);
    }
  }

  clearEmotionOverlays() {
    if (this.eyeL?.hasAttribute('transform')) this.eyeL.removeAttribute('transform');
    if (this.eyeR?.hasAttribute('transform')) this.eyeR.removeAttribute('transform');

    if (this.blushL) this.blushL.style.display = 'none';
    if (this.blushR) this.blushR.style.display = 'none';

    if (this.tearLImages && this.tearRImages) {
      this.tearLImages.forEach(img => img && (img.style.display = 'none'));
      this.tearRImages.forEach(img => img && (img.style.display = 'none'));
      this.tearLWrap?.classList?.remove('anim-tear-flowing');
      this.tearRWrap?.classList?.remove('anim-tear-flowing');
      if (this.tearAnimation) {
        this.tearAnimation.pause();
        if (window.anime) {
          window.anime.set([this.tearLWrap, this.tearRWrap], { translateY: 0 });
        }
      }
    }

    if (this.effectSym) {
      this.effectSym.style.display = 'none';
      if (this.effectAnimation) {
        this.effectAnimation.pause();
      }
    }
  }

  updateEmotionOverlays(emosi) {
    const exprData = this.config.expressions?.[emosi] || this.config.expressions?.netral;
    if (!exprData) return;

    // 1. Update Blush Pipi (sangat_senang)
    if (this.blushL && this.blushR) {
      if (exprData.blushL && exprData.blushR) {
        this.blushL.setAttribute('href', exprData.blushL.asset);
        this.blushL.setAttribute('x', exprData.blushL.x);
        this.blushL.setAttribute('y', exprData.blushL.y);
        this.blushL.setAttribute('width', exprData.blushL.w);
        this.blushL.setAttribute('height', exprData.blushL.h);
        this.blushL.style.display = '';

        this.blushR.setAttribute('href', exprData.blushR.asset);
        this.blushR.setAttribute('x', exprData.blushR.x);
        this.blushR.setAttribute('y', exprData.blushR.y);
        this.blushR.setAttribute('width', exprData.blushR.w);
        this.blushR.setAttribute('height', exprData.blushR.h);
        this.blushR.style.display = '';

        if (window.anime) {
          window.anime({
            targets: '#layer-blush',
            opacity: [0, 1],
            duration: 350,
            easing: 'easeOutQuad'
          });
        }
      } else {
        this.blushL.style.display = 'none';
        this.blushR.style.display = 'none';
      }
    }

    // 2. Update Air Mata (menangis) — Mengalir ke bawah dari balik mata
    if (this.tearLImages && this.tearRImages) {
      if (exprData.tearL && exprData.tearR) {
        const step = 75;

        // Tampilkan 2 gambar tersusun vertikal per sisi (offset 75px sesuai ritme highlight bulir air)
        this.tearLImages.forEach((img, i) => {
          if (!img) return;
          img.setAttribute('href', exprData.tearL.asset);
          img.setAttribute('x', exprData.tearL.x);
          img.setAttribute('y', exprData.tearL.y - i * step);
          img.setAttribute('width', exprData.tearL.w);
          img.setAttribute('height', exprData.tearL.h);
          img.style.display = '';
        });

        this.tearRImages.forEach((img, i) => {
          if (!img) return;
          img.setAttribute('href', exprData.tearR.asset);
          img.setAttribute('x', exprData.tearR.x);
          img.setAttribute('y', exprData.tearR.y - i * step);
          img.setAttribute('width', exprData.tearR.w);
          img.setAttribute('height', exprData.tearR.h);
          img.style.display = '';
        });

        // Aktifkan animasi aliran CSS
        this.tearLWrap?.classList?.add('anim-tear-flowing');
        this.tearRWrap?.classList?.add('anim-tear-flowing');

        if (this.tearAnimation) {
          this.tearAnimation.restart();
          this.tearAnimation.play();
        }
      } else {
        this.tearLImages.forEach(img => img && (img.style.display = 'none'));
        this.tearRImages.forEach(img => img && (img.style.display = 'none'));
        this.tearLWrap?.classList?.remove('anim-tear-flowing');
        this.tearRWrap?.classList?.remove('anim-tear-flowing');
        if (this.tearAnimation) {
          this.tearAnimation.pause();
          if (window.anime) {
            window.anime.set([this.tearLWrap, this.tearRWrap], { translateY: 0 });
          }
        }
      }
    }

    // 3. Update Efek Overlay (tanda seru / tanda tanya)
    if (this.effectSym) {
      if (exprData.effect) {
        this.effectSym.setAttribute('href', exprData.effect.asset);
        this.effectSym.setAttribute('x', exprData.effect.x);
        this.effectSym.setAttribute('y', exprData.effect.y);
        this.effectSym.setAttribute('width', exprData.effect.w);
        this.effectSym.setAttribute('height', exprData.effect.h);
        this.effectSym.style.display = '';

        if (this.effectAnimation) {
          this.effectAnimation.restart();
          this.effectAnimation.play();
        }
      } else {
        this.effectSym.style.display = 'none';
        if (this.effectAnimation) {
          this.effectAnimation.pause();
        }
      }
    }
  }

  updateEmotion(emosi) {
    this.updateEyes(emosi);
    this.updateEmotionOverlays(emosi);
  }

  updateMouth(emosi, viseme) {
    if (!this.mouthEl) return;

    let asset = null;
    let x = 259;
    let y = 325;
    let w = 282;
    let h = 96;

    // 1. Jika viseme aktif selain DIAM, pakai mulut viseme
    if (viseme !== 'DIAM' && this.config.visemes?.[viseme]) {
      asset = this.config.visemes[viseme];
      const pos = this.config.visemePositions?.[viseme];
      if (pos) {
        x = pos.x;
        y = pos.y;
        w = pos.w;
        h = pos.h;
      }
    } else {
      // 2. Jika DIAM, gunakan mulut dari ekspresi aktif
      const exprData = this.config.expressions?.[emosi] || this.config.expressions?.netral;
      if (exprData?.mouth) {
        asset = exprData.mouth.asset;
        x = exprData.mouth.x;
        y = exprData.mouth.y;
        w = exprData.mouth.w;
        h = exprData.mouth.h;
      }
    }

    if (asset) {
      this.mouthEl.setAttribute('href', asset);
      this.mouthEl.setAttribute('x', x);
      this.mouthEl.setAttribute('y', y);
      this.mouthEl.setAttribute('width', w);
      this.mouthEl.setAttribute('height', h);
      this.mouthEl.style.display = '';

      // Transisi transisi halus menggunakan anime.js jika tidak sedang dalam transisi ekspresi
      if (window.anime && !this.isTransitioning) {
        window.anime({
          targets: '#layer-mouth',
          scale: [0.94, 1.0],
          opacity: [0.8, 1.0],
          duration: 180,
          easing: 'easeOutQuad'
        });
      }
    } else {
      this.mouthEl.style.display = 'none';
    }
  }
}
