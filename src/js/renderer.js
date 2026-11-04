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
    this.eyeLWrap = this.svg.querySelector('#eye-l-wrap');
    this.eyeRWrap = this.svg.querySelector('#eye-r-wrap');
    this.eyeL = this.svg.querySelector('#eye-l');
    this.eyeR = this.svg.querySelector('#eye-r');
    this.tearLWrap = this.svg.querySelector('#tear-l-wrap');
    this.tearRWrap = this.svg.querySelector('#tear-r-wrap');
    this.tearLImages = [
      this.svg.querySelector('#tear-l-1'),
      this.svg.querySelector('#tear-l-2'),
      this.svg.querySelector('#tear-l-3'),
    ];
    this.tearRImages = [
      this.svg.querySelector('#tear-r-1'),
      this.svg.querySelector('#tear-r-2'),
      this.svg.querySelector('#tear-r-3'),
    ];
    this.effectSym = this.svg.querySelector('#effect-sym');

    // State render internal
    this.currentEmotion = null;
    this.currentViseme = null;
    this.isBlinking = false;
    this.tearAnimation = null;
    this.effectAnimation = null;

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
        targets: ['#tear-l-wrap', '#tear-r-wrap'],
        translateY: [0, 250],
        duration: 1200,
        easing: 'linear',
        loop: true,
        autoplay: false
      });
    }
  }

  start() {
    this.applyState(true);
    requestAnimationFrame(this.render);
  }

  render(timestamp = performance.now()) {
    // Sinkronisasi state wajah jika ada perubahan
    this.applyState();

    // Update controller kedip
    if (this.blinkController) {
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

    requestAnimationFrame(this.render);
  }

  triggerBlinkAnimation() {
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

    if (emotionChanged) {
      this.updateEmotion(emosi);
      this.currentEmotion = emosi;
    }

    if (visemeChanged || emotionChanged) {
      this.updateMouth(emosi, viseme);
      this.currentViseme = viseme;
    }
  }

  updateEmotion(emosi) {
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

    // 3. Update Blush Pipi (sangat_senang)
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

    // 4. Update Air Mata (menangis) — Mengalir ke bawah dari balik mata
    if (this.tearLImages && this.tearRImages) {
      if (exprData.tearL && exprData.tearR) {
        const step = 250;

        // Tampilkan 3 gambar tersusun vertikal per sisi untuk aliran kontinu ke bawah
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

        if (this.tearAnimation) {
          this.tearAnimation.restart();
          this.tearAnimation.play();
        }
      } else {
        this.tearLImages.forEach(img => img && (img.style.display = 'none'));
        this.tearRImages.forEach(img => img && (img.style.display = 'none'));
        if (this.tearAnimation) {
          this.tearAnimation.pause();
          if (window.anime) {
            window.anime.set(['#tear-l-wrap', '#tear-r-wrap'], { translateY: 0 });
          }
        }
      }
    }

    // 5. Update Efek Overlay (tanda seru / tanda tanya)
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

      // Transisi transisi halus menggunakan anime.js
      if (window.anime) {
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
