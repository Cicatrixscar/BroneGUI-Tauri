import { parseWordToVisemes, wordSettings } from './wordViseme.js';

// Streaming lifecycle only; legacy schedule/fallback remain in connector.js.
export class WordVisemeController {
  constructor(state) {
    this.state = state;
    this.settings = wordSettings(state.config?.bicara?.streaming);
    this.holdMs = state.config?.bicara?.holdAfterSpeechMs ?? 5000;
    this.active = false;
    this.closed = false;
    this.wordTimers = [];
    this.masterTimer = null;
    this.silenceTimer = null;
    this.holdTimer = null;
    this.deadline = null;
  }

  clearWord() {
    this.wordTimers.forEach(clearTimeout);
    this.wordTimers = [];
    clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  cancel() {
    this.clearWord();
    clearTimeout(this.masterTimer);
    clearTimeout(this.holdTimer);
    this.masterTimer = this.holdTimer = null;
    this.deadline = null;
    this.active = false;
    this.closed = true;
    this.state.setViseme('DIAM');
  }

  start(durationS, newSession = false) {
    if (this.active && !newSession) {
      // A late duration can supply a missing deadline, but never extend an existing one.
      if (this.deadline === null && Number.isFinite(durationS) && durationS > 0) {
        clearTimeout(this.masterTimer);
        clearTimeout(this.silenceTimer);
        this.deadline = performance.now() + durationS * 1000;
        this.masterTimer = setTimeout(() => this.finish(), durationS * 1000);
      }
      return;
    }
    this.cancel();
    this.closed = false;
    this.active = true;
    const durationMs = Number.isFinite(durationS) && durationS > 0 ? durationS * 1000 : null;
    this.deadline = durationMs === null ? null : performance.now() + durationMs;
    this.masterTimer = setTimeout(() => this.finish(), durationMs ?? this.settings.watchdogMs);
    this.state.setViseme('REST', this.settings.closureMorphMs);
    if (durationMs === null) this.waitForWord();
  }

  waitForWord() {
    clearTimeout(this.silenceTimer);
    if (this.deadline === null) {
      this.silenceTimer = setTimeout(() => this.finish(false), this.settings.silenceTimeoutMs);
    }
  }

  word(rawWord) {
    const steps = parseWordToVisemes(rawWord, this.settings);
    if (!steps.length || this.closed) return false;
    if (!this.active) this.start();
    if (this.deadline !== null && performance.now() >= this.deadline) {
      this.finish();
      return false;
    }
    this.clearWord();
    let elapsed = 0;
    for (const step of steps) {
      const display = () => this.state.setViseme(step.v,
        Math.min(step.durasi * 0.6, step.v === 'REST' ? this.settings.closureMorphMs : this.settings.morphMs));
      if (elapsed === 0) display();
      else this.wordTimers.push(setTimeout(display, elapsed));
      elapsed += step.durasi;
    }
    this.wordTimers.push(setTimeout(() => {
      this.state.setViseme('REST', this.settings.closureMorphMs);
      this.waitForWord();
    }, elapsed));
    return true;
  }

  finish(hard = true) {
    if (!this.active) return;
    this.cancel();
    // A silence-based end may resume if another word arrives during a long pause.
    this.closed = hard;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.closed = true;
      this.state.setEmotion('idle', 1.0);
    }, this.holdMs);
  }
}
