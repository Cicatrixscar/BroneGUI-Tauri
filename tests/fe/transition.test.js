import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../../src/js/renderer.js';
import { FaceState } from '../../src/js/state.js';
import { BlinkController } from '../../src/js/blink.js';

function createMockSvg() {
  const elements = {};
  const createElement = (tag, id) => ({
    tagName: tag,
    id,
    style: {},
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); }
  });

  const ids = [
    'layer-backside', 'blush-l', 'blush-r', 'mouth', 'layer-mouth',
    'eye-l-wrap', 'eye-r-wrap', 'eye-l', 'eye-r',
    'tear-l-wrap', 'tear-r-wrap', 'tear-l-1', 'tear-l-2', 'tear-r-1', 'tear-r-2',
    'effect-sym', 'layer-blush'
  ];

  ids.forEach(id => {
    elements[id] = createElement('g', id);
  });

  return {
    querySelector(selector) {
      const clean = selector.replace('#', '');
      return elements[clean] || null;
    }
  };
}

const mockConfig = {
  canvas: { baseWidth: 800, baseHeight: 480 },
  blink: { minIntervalMs: 3000, maxIntervalMs: 6000, durationMs: 350 },
  expressions: {
    idle: {
      eyeL: { asset: 'assets/MATA.svg', x: 115, y: 154, w: 129, h: 171 },
      eyeR: { asset: 'assets/MATA.svg', x: 556, y: 154, w: 129, h: 171 },
      mouth: { asset: 'assets/IDLE.svg', x: 259, y: 325, w: 282, h: 96 }
    },
    happy: {
      eyeL: { asset: 'assets/MATA.svg', x: 115, y: 154, w: 129, h: 171 },
      eyeR: { asset: 'assets/MATA.svg', x: 556, y: 154, w: 129, h: 171 },
      mouth: { asset: 'assets/HAPPIER.svg', x: 259, y: 286, w: 282, h: 155 }
    },
    sad: {
      eyeL: { asset: 'assets/SAD EYE LEFT.svg', x: 106, y: 147, w: 142, h: 156 },
      eyeR: { asset: 'assets/SAD EYE RIGHT.svg', x: 552, y: 147, w: 142, h: 156 },
      mouth: { asset: 'assets/SAD MOUTH.svg', x: 262, y: 298, w: 276, h: 86 }
    },
    timeout: {
      eyeL: { asset: 'assets/TIMEOUT EYE LEFT.svg', x: 93.4, y: 130.65, w: 160, h: 162 },
      eyeR: { asset: 'assets/TIMEOUT EYE RIGHT.svg', x: 547.4, y: 130.65, w: 160, h: 162 },
      mouth: { asset: 'assets/TIMEOUT MOUTH.svg', x: 273.8, y: 355, w: 253, h: 45 }
    }
  },
  visemes: {
    P_B_M: 'assets/viseme/P,B,M.svg',
    DIAM: null
  },
  visemePositions: {
    P_B_M: { x: 258.5, y: 366, w: 283, h: 20 }
  }
};

describe('Transisi Pergantian Ekspresi Wajah (Kedip & Mulut Datar)', () => {
  let svg;
  let state;
  let blink;
  let renderer;

  beforeEach(() => {
    svg = createMockSvg();
    state = new FaceState(mockConfig);
    blink = new BlinkController(mockConfig.blink);
    if (typeof globalThis.window === 'undefined') {
      globalThis.window = {};
    }
  });

  afterEach(() => {
    if (renderer?.transitionTimers) {
      renderer.transitionTimers.forEach(id => clearTimeout(id));
    }
  });

  it('Renderer menginisialisasi ekspresi awal tanpa animasi transisi', () => {
    delete globalThis.window.anime;
    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true);

    assert.equal(renderer.currentEmotion, 'idle');
    assert.equal(renderer.targetEmotion, 'idle');
    assert.equal(renderer.isTransitioning, false);
    assert.equal(svg.querySelector('#eye-l').getAttribute('href'), 'assets/MATA.svg');
    assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/IDLE.svg');
  });

  it('Transisi fallback langsung memperbarui asset saat anime.js tidak tersedia', () => {
    delete globalThis.window.anime;
    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true);

    state.setEmotion('sad');
    assert.equal(renderer.currentEmotion, 'sad');
    assert.equal(svg.querySelector('#eye-l').getAttribute('href'), 'assets/SAD EYE LEFT.svg');
    assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/SAD MOUTH.svg');
    assert.equal(renderer.isTransitioning, false);
  });

  it('Memanfaatkan kedipan dan mulut datar (P,B,M) saat berganti ekspresi', (_, done) => {
    const animeCalls = [];
    const animeMock = function(params) {
      animeCalls.push(params);
      return {
        restart: () => {},
        play: () => {},
        pause: () => {}
      };
    };
    animeMock.remove = () => {};
    animeMock.set = () => {};

    globalThis.window.anime = animeMock;

    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true); // Mulai dari idle

    // Ganti ekspresi ke happy
    state.setEmotion('happy');

    assert.equal(renderer.targetEmotion, 'happy');
    assert.equal(renderer.isTransitioning, true);

    // Animasi kedip mata dipanggil
    const eyeBlinkCall = animeCalls.find(c => Array.isArray(c.targets) && c.targets.includes('#eye-l-wrap'));
    assert.ok(eyeBlinkCall, 'Harus memanggil anime untuk kedipan mata');
    assert.deepEqual(eyeBlinkCall.scaleY[0].value, 0.04);
    assert.deepEqual(eyeBlinkCall.scaleY[1].value, 1.0);

    // Animasi mulut merapat dipanggil
    const mouthCall = animeCalls.find(c => c.targets === '#layer-mouth');
    assert.ok(mouthCall, 'Harus memanggil anime untuk gerakan mulut merapat ke garis');

    // Cek setelah tFlatten: Mulut menjadi datar (P,B,M.svg)
    setTimeout(() => {
      assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/viseme/P,B,M.svg');
    }, 115);

    // Cek setelah midpoint (t = 180ms): Saat mata terpejam di dalam kedipan, mata dan mulut sudah menjadi target (senang)
    setTimeout(() => {
      assert.equal(svg.querySelector('#eye-l').getAttribute('href'), 'assets/MATA.svg');
      assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/HAPPIER.svg');
    }, 190);

    // Cek setelah selesai (t = 360ms): Mata terbuka penuh dan ekspresi baru sudah aktif
    setTimeout(() => {
      assert.equal(renderer.currentEmotion, 'happy');
      assert.equal(renderer.isTransitioning, false);
      done();
    }, 370);
  });

  it('Mode statis memicu transisi yang sama saat berganti ekspresi', () => {
    let animeCalled = false;
    const animeMock = function() {
      animeCalled = true;
      return {
        restart: () => {},
        play: () => {},
        pause: () => {}
      };
    };
    animeMock.remove = () => {};
    animeMock.set = () => {};

    globalThis.window.anime = animeMock;

    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true);

    // Simulasi klik tombol mode statis (state.setEmotion('sad'))
    state.setEmotion('sad');

    assert.equal(animeCalled, true, 'Animasi kedip transisi harus berjalan saat ekspresi berubah di mode statis');
    assert.equal(renderer.targetEmotion, 'sad');
    assert.equal(renderer.isTransitioning, true);
  });

  it('Ekspresi timeout terpasang dengan aset mata spiral dan mulut bergelombang', () => {
    delete globalThis.window.anime;
    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true);

    state.setEmotion('timeout');
    renderer.applyState(false);

    assert.equal(svg.querySelector('#eye-l').getAttribute('href'), 'assets/TIMEOUT EYE LEFT.svg');
    assert.equal(svg.querySelector('#eye-r').getAttribute('href'), 'assets/TIMEOUT EYE RIGHT.svg');
    assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/TIMEOUT MOUTH.svg');
    assert.equal(renderer.currentEmotion, 'timeout');
  });

  it('Dalam ekspresi timeout, kedip acak dinonaktifkan dan mata spiral berputar', () => {
    delete globalThis.window.anime;
    renderer = new Renderer(svg, state, blink, mockConfig);
    state.setEmotion('timeout');
    renderer.applyState(true);

    blink.isBlinking = true;
    renderer.render(1000);

    // Kedip acak dimatikan saat timeout
    assert.equal(blink.isBlinking, false);

    // Mata spiral diberi atribut transform rotate
    const eyeL = svg.querySelector('#eye-l');
    const eyeR = svg.querySelector('#eye-r');
    assert.ok(eyeL.getAttribute('transform')?.startsWith('rotate('), 'Mata kiri harus memiliki transform rotate');
    assert.ok(eyeR.getAttribute('transform')?.startsWith('rotate('), 'Mata kanan harus memiliki transform rotate');

    // Berpindah dari timeout ke idle membersihkan transform
    state.setEmotion('idle');
    renderer.applyState(false);
    renderer.render(2000);
    assert.equal(eyeL.hasAttribute('transform'), false, 'Transform putaran mata harus dibersihkan saat kembali ke idle');
    assert.equal(eyeR.hasAttribute('transform'), false);
  });
});
