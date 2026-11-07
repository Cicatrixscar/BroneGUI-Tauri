import { describe, it, beforeEach } from 'node:test';
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
    getAttribute(k) { return this.attributes[k]; }
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
    netral: {
      eyeL: { asset: 'assets/MATA.svg', x: 115, y: 154, w: 129, h: 171 },
      eyeR: { asset: 'assets/MATA.svg', x: 556, y: 154, w: 129, h: 171 },
      mouth: { asset: 'assets/IDLE.svg', x: 259, y: 325, w: 282, h: 96 }
    },
    senang: {
      eyeL: { asset: 'assets/MATA.svg', x: 115, y: 154, w: 129, h: 171 },
      eyeR: { asset: 'assets/MATA.svg', x: 556, y: 154, w: 129, h: 171 },
      mouth: { asset: 'assets/HAPPIER.svg', x: 259, y: 286, w: 282, h: 155 }
    },
    sedih: {
      eyeL: { asset: 'assets/SAD EYE LEFT.svg', x: 106, y: 147, w: 142, h: 156 },
      eyeR: { asset: 'assets/SAD EYE RIGHT.svg', x: 552, y: 147, w: 142, h: 156 },
      mouth: { asset: 'assets/SAD MOUTH.svg', x: 262, y: 298, w: 276, h: 86 }
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

  it('Renderer menginisialisasi ekspresi awal tanpa animasi transisi', () => {
    delete globalThis.window.anime;
    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true);

    assert.equal(renderer.currentEmotion, 'netral');
    assert.equal(renderer.targetEmotion, 'netral');
    assert.equal(renderer.isTransitioning, false);
    assert.equal(svg.querySelector('#eye-l').getAttribute('href'), 'assets/MATA.svg');
    assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/IDLE.svg');
  });

  it('Transisi fallback langsung memperbarui asset saat anime.js tidak tersedia', () => {
    delete globalThis.window.anime;
    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true);

    state.setEmotion('sedih');
    assert.equal(renderer.currentEmotion, 'sedih');
    assert.equal(svg.querySelector('#eye-l').getAttribute('href'), 'assets/SAD EYE LEFT.svg');
    assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/SAD MOUTH.svg');
    assert.equal(renderer.isTransitioning, false);
  });

  it('Memanfaatkan kedipan dan mulut datar (P,B,M) dalam timeline anime.js', () => {
    const timelineSteps = [];
    let timelineCompleteCallback = null;

    const animeMock = function() {
      return {
        restart: () => {},
        play: () => {},
        pause: () => {}
      };
    };
    animeMock.timeline = (params) => {
      timelineCompleteCallback = params.complete;
      return {
        add: (step, offset) => {
          timelineSteps.push({ step, offset });
          return this;
        },
        pause: () => {}
      };
    };
    animeMock.remove = () => {};
    animeMock.set = () => {};

    globalThis.window.anime = animeMock;

    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true); // Mulai dari netral

    // Ganti ekspresi ke senang
    state.setEmotion('senang');

    assert.equal(renderer.targetEmotion, 'senang');
    assert.equal(renderer.isTransitioning, true);

    // Verifikasi langkah-langkah timeline anime.js
    assert.ok(timelineSteps.length >= 4, 'Timeline harus memiliki langkah mata menutup, mulut datar, dan buka kembali');

    // Langkah 1: Mata berkedip menutup (scaleY 0.04)
    const eyeCloseStep = timelineSteps.find(s => s.step.targets?.includes('#eye-l-wrap') && s.step.scaleY === 0.04);
    assert.ok(eyeCloseStep, 'Harus ada animasi mata berkedip menutup ke scaleY 0.04');

    // Langkah 2: Mulut memipih ke garis datar
    const mouthSquashStep = timelineSteps.find(s => s.step.targets === '#layer-mouth' && s.step.scaleY === 0.08);
    assert.ok(mouthSquashStep, 'Harus ada animasi mulut memipih ke garis datar');

    // Jalankan callback swap mulut datar
    mouthSquashStep.step.complete();
    assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/viseme/P,B,M.svg');

    // Langkah midpoint swap: Ganti mata dan mulut ke emosi target saat tertutup
    const midpointStep = timelineSteps.find(s => typeof s.step.complete === 'function' && s.step.duration === 1);
    assert.ok(midpointStep, 'Harus ada step midpoint untuk swap asset');
    midpointStep.step.complete();

    // Verifikasi mata dan mulut telah diset ke senang
    assert.equal(svg.querySelector('#eye-l').getAttribute('href'), 'assets/MATA.svg');
    assert.equal(svg.querySelector('#mouth').getAttribute('href'), 'assets/HAPPIER.svg');

    // Selesaikan timeline
    timelineCompleteCallback();
    assert.equal(renderer.currentEmotion, 'senang');
    assert.equal(renderer.isTransitioning, false);
  });

  it('Mode statis memicu transisi yang sama saat berganti ekspresi', () => {
    let timelineCreated = false;

    const animeMock = function() {
      return {
        restart: () => {},
        play: () => {},
        pause: () => {}
      };
    };
    animeMock.timeline = () => {
      timelineCreated = true;
      return {
        add: () => {},
        pause: () => {}
      };
    };
    animeMock.remove = () => {};
    animeMock.set = () => {};

    globalThis.window.anime = animeMock;

    renderer = new Renderer(svg, state, blink, mockConfig);
    renderer.applyState(true);

    // Simulasi klik tombol mode statis (state.setEmotion('sedih'))
    state.setEmotion('sedih');

    assert.equal(timelineCreated, true, 'Transisi timeline harus berjalan saat ekspresi berubah di mode statis');
    assert.equal(renderer.targetEmotion, 'sedih');
    assert.equal(renderer.isTransitioning, true);
  });
});
