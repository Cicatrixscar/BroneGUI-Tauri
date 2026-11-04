// Transisi halus antar parameter wajah (F-03).

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export const EASING = {
  linear: (t) => t,
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3)
};

export class Interpolator {
  constructor(durationMs = 400, easingName = 'easeInOutQuad') {
    this.durationMs = durationMs;
    this.easing = EASING[easingName] ?? EASING.easeInOutQuad;
    this.startTime = null;
    this.startValues = {};
    this.targetValues = {};
    this.currentValues = {};
    this.isTransitioning = false;
  }

  start(current, target, durationMs = this.durationMs) {
    this.durationMs = durationMs;
    this.startTime = performance.now();
    this.startValues = { ...current };
    this.targetValues = { ...target };
    this.currentValues = { ...current };
    this.isTransitioning = true;
  }

  update(now = performance.now()) {
    if (!this.isTransitioning) return this.currentValues;

    const elapsed = now - this.startTime;
    if (elapsed >= this.durationMs) {
      this.currentValues = { ...this.targetValues };
      this.isTransitioning = false;
      return this.currentValues;
    }

    const t = Math.max(0, Math.min(1, elapsed / this.durationMs));
    const easeT = this.easing(t);

    for (const key of Object.keys(this.targetValues)) {
      const start = this.startValues[key] ?? 0;
      const target = this.targetValues[key] ?? 0;
      this.currentValues[key] = lerp(start, target, easeT);
    }

    return this.currentValues;
  }
}
