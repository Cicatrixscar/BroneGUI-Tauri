// Kedip otomatis dengan interval acak sesuai F-04.
export class BlinkController {
  constructor(config = {}) {
    this.minIntervalMs = config.minIntervalMs ?? 3000;
    this.maxIntervalMs = config.maxIntervalMs ?? 6000;
    this.durationMs = config.durationMs ?? 150;

    this.isBlinking = false;
    this.blinkStartTime = 0;
    this.nextBlinkTime = performance.now() + this.randomDelay();
  }

  randomDelay() {
    return this.minIntervalMs + Math.random() * (this.maxIntervalMs - this.minIntervalMs);
  }

  update(now = performance.now()) {
    if (!this.isBlinking) {
      if (now >= this.nextBlinkTime) {
        this.isBlinking = true;
        this.blinkStartTime = now;
      }
      return 1.0; // Mata terbuka penuh
    }

    const elapsed = now - this.blinkStartTime;
    if (elapsed >= this.durationMs) {
      this.isBlinking = false;
      this.nextBlinkTime = now + this.randomDelay();
      return 1.0;
    }

    const progress = elapsed / this.durationMs; // 0.0 -> 1.0
    // Kurva mulus sinus: buka (1.0) -> tutup rapat (0.0) di tengah -> buka lagi (1.0)
    const factor = 1.0 - Math.sin(progress * Math.PI);
    return Math.max(0.0, Math.min(1.0, factor));
  }
}
