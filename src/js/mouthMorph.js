const NS = 'http://www.w3.org/2000/svg';
const SAMPLES = 160;

// Match winding and starting point before interpolating closed contours.
export function alignContour(reference, points) {
  let best = points;
  let distance = Infinity;
  for (const direction of [1, -1]) {
    for (let offset = 0; offset < points.length; offset++) {
      let score = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[(offset + direction * i + points.length) % points.length];
        score += (p[0] - reference[i][0]) ** 2 + (p[1] - reference[i][1]) ** 2;
      }
      if (score < distance) {
        distance = score;
        best = points.map((_, i) => points[(offset + direction * i + points.length) % points.length]);
      }
    }
  }
  return best;
}

export function interpolateMouth(from, to, progress) {
  return from.map((layer, index) => ({
    points: layer.points.map((p, i) => p.map((v, axis) => v + (to[index].points[i][axis] - v) * progress)),
    opacity: layer.opacity + (to[index].opacity - layer.opacity) * progress,
    width: layer.width + (to[index].width - layer.width) * progress
  }));
}

function sample(path, box, viewBox) {
  const [vx, vy, vw, vh] = viewBox;
  const scale = Math.min(box.w / vw, box.h / vh);
  const x = box.x + (box.w - vw * scale) / 2;
  const y = box.y + (box.h - vh * scale) / 2;
  const length = path.getTotalLength();
  const closed = /z\s*$/i.test(path.getAttribute('d'));
  return Array.from({ length: SAMPLES }, (_, i) => {
    // An open lip line becomes a zero-area closed contour, so it can morph into a vowel.
    const t = closed ? i / SAMPLES : (i <= SAMPLES / 2 ? i : SAMPLES - i) / (SAMPLES / 2);
    const p = path.getPointAtLength(t * length);
    return [x + (p.x - vx) * scale, y + (p.y - vy) * scale];
  });
}

function geometry(svg, box) {
  const viewBox = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  const paths = [...svg.querySelectorAll('path')].filter(p => !p.closest('defs, mask, clipPath'));
  const stroke = paths.filter(p => p.getAttribute('stroke') === 'black');
  const use = svg.querySelector('use[fill="#232322"]');
  const reference = use?.getAttribute('href') || use?.getAttribute('xlink:href');
  const outer = paths.find(p => p.getAttribute('fill') === '#232322') ||
    (reference && svg.querySelector(reference)) || stroke[0];
  if (!outer) throw new Error('SVG mulut tidak memiliki kontur');
  const tongue = paths.find(p => p.getAttribute('fill') === '#EF775D');
  const outline = stroke[stroke.length - 1] || outer;
  const lineOnly = !/z\s*$/i.test(outer.getAttribute('d'));
  const boundary = sample(outer, box, viewBox);
  const center = boundary.reduce((a, p) => [a[0] + p[0] / SAMPLES, a[1] + p[1] / SAMPLES], [0, 0]);
  const collapsed = () => boundary.map(() => [...center]);
  const scale = Math.min(box.w / viewBox[2], box.h / viewBox[3]);
  const seam = lineOnly ? stroke[1] : null;
  return [
    { points: boundary, opacity: 1, width: 0 },
    { points: tongue ? sample(tongue, box, viewBox) : collapsed(), opacity: tongue ? 1 : 0, width: 0 },
    { points: sample(lineOnly ? outer : outline, box, viewBox), opacity: 1, width: Number((lineOnly ? outer : outline).getAttribute('stroke-width') || 0) * scale },
    { points: seam ? sample(seam, box, viewBox) : collapsed(), opacity: seam ? 1 : 0, width: Number(seam?.getAttribute('stroke-width') || 0) * scale }
  ];
}

export class MouthMorph {
  constructor(layer, image) {
    this.layer = layer;
    this.image = image;
    this.assets = new Map();
    this.shapes = new Map();
    this.current = null;
    this.transition = null;
  }

  async load(config) {
    const assets = new Set([...Object.values(config.visemes || {}),
      ...Object.values(config.expressions || {}).map(e => e.mouth?.asset)].filter(Boolean));
    await Promise.all([...assets].map(async asset => {
      try {
        const response = await fetch(asset);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const svg = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
        this.assets.set(asset, svg);
      } catch (error) {
        console.warn(`[MouthMorph] Gagal memuat ${asset}; memakai gambar asli.`, error);
      }
    }));
  }

  shape(asset, box) {
    const svg = this.assets.get(asset);
    if (!svg) return null;
    const key = JSON.stringify([asset, box]);
    if (!this.shapes.has(key)) this.shapes.set(key, geometry(svg, box));
    return this.shapes.get(key);
  }

  cancel() {
    this.transition = null;
    this.current = null;
    this.group?.remove();
    this.group = null;
    this.image.style.display = '';
  }

  start(asset, box, animate = true, now = performance.now()) {
    this.update(now);
    const target = this.shape(asset, box);
    if (!target || !animate) { this.cancel(); return false; }
    const previous = this.current || this.shape(this.image.getAttribute('href'), {
      x: Number(this.image.getAttribute('x')), y: Number(this.image.getAttribute('y')),
      w: Number(this.image.getAttribute('width')), h: Number(this.image.getAttribute('height'))
    });
    if (!previous) { this.cancel(); return false; }
    const aligned = target.map((layer, i) => ({ ...layer, points: alignContour(previous[i].points, layer.points) }));
    this.current = previous;
    this.transition = { from: previous, to: aligned, start: now };
    if (!this.group) {
      this.group = document.createElementNS(NS, 'g');
      this.group.setAttribute('data-mouth-morph', '');
      this.paths = ['#232322', '#EF775D', 'none', 'none'].map((fill, i) => {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('fill', fill);
        path.setAttribute('stroke', i >= 2 ? 'black' : 'none');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-linecap', 'round');
        this.group.appendChild(path);
        return path;
      });
      this.layer.appendChild(this.group);
    }
    this.image.style.display = 'none';
    this.draw();
    return true;
  }

  draw() {
    this.current.forEach((layer, i) => {
      this.paths[i].setAttribute('d', layer.points.map((p, j) => `${j ? 'L' : 'M'}${p[0]},${p[1]}`).join('') + 'Z');
      this.paths[i].setAttribute('opacity', layer.opacity);
      this.paths[i].setAttribute('stroke-width', layer.width);
    });
  }

  update(now) {
    if (!this.transition) return;
    const t = Math.max(0, Math.min(1, (now - this.transition.start) / 100));
    this.current = interpolateMouth(this.transition.from, this.transition.to, t * t * (3 - 2 * t));
    this.draw();
    if (t === 1) {
      this.transition = null;
      this.group.remove();
      this.group = null;
      this.image.style.display = '';
    }
  }
}
