import { parseWordToVisemes, parseSentenceToVisemes, wordSettings } from './wordViseme.js';

const SENTENCE_EMOTIONS = ['idle', 'happy', 'happier', 'happier_transisi', 'sad', 'cry', 'shock', 'confused', 'timeout'];

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
    this.playbackEnd = 0;
    this.watchdogEnd = 0;
    this.combined = false;
  }

  clearWord() {
    this.wordTimers.forEach(clearTimeout);
    this.wordTimers = [];
    this.playbackEnd = 0;
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
    this.combined = false;
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
    this.watchdogEnd = performance.now() + this.settings.watchdogMs;
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
    return this.play(parseWordToVisemes(rawWord, this.settings));
  }

  sentence({ expression, duration, sentence }) {
    if (!SENTENCE_EMOTIONS.includes(expression) || !Number.isFinite(duration) || duration <= 0 || duration > 3600) return false;
    let steps = parseSentenceToVisemes(sentence, this.settings);
    // Valid text with no supported vowels still occupies its audio duration.
    if (typeof sentence !== 'string' || !sentence.trim() || [...sentence].length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(sentence)) return false;
    if (!steps.length) steps = [{ v: 'REST', durasi: 1 }];
    const total = steps.reduce((sum, step) => sum + step.durasi, 0);
    const durationMs = duration * 1000;
    steps = steps.map(step => ({ ...step, durasi: step.durasi / total * durationMs }));
    if (!this.combined || !this.active) {
      this.start(undefined, true);
      this.combined = true;
    }
    return this.play(steps, true, expression, durationMs);
  }

  play(steps, append = false, expression = null, durationMs = null) {
    if (!steps.length || this.closed) return false;
    if (!this.active) this.start();
    if (this.deadline !== null && performance.now() >= this.deadline) {
      this.finish();
      return false;
    }
    if (!append || this.playbackEnd <= performance.now()) this.clearWord();
    clearTimeout(this.silenceTimer);
    let elapsed = Math.max(0, this.playbackEnd - performance.now());
    if (expression !== null) {
      const applyExpression = () => this.state.setEmotion(expression, 1.0);
      if (elapsed === 0) applyExpression();
      else this.wordTimers.push(setTimeout(applyExpression, elapsed));
    }
    const end = performance.now() + elapsed + (durationMs ?? steps.reduce((sum, step) => sum + step.durasi, 0));
    for (const step of steps) {
      const display = () => this.state.setViseme(step.v,
        Math.min(step.durasi * 0.6, step.v === 'REST' ? this.settings.closureMorphMs : this.settings.morphMs));
      if (elapsed === 0) display();
      else this.wordTimers.push(setTimeout(display, elapsed));
      elapsed += step.durasi;
    }
    this.playbackEnd = end;
    // A sentence can outlast the word-mode watchdog; allow accepted text to finish.
    if (append && this.deadline === null && this.playbackEnd + this.settings.silenceTimeoutMs > this.watchdogEnd) {
      this.watchdogEnd = this.playbackEnd + this.settings.silenceTimeoutMs;
      clearTimeout(this.masterTimer);
      this.masterTimer = setTimeout(() => this.finish(), this.watchdogEnd - performance.now());
    }
    this.wordTimers.push(setTimeout(() => {
      if (this.playbackEnd !== end) return;
      if (expression !== null) {
        this.finish(false);
        return;
      }
      this.state.setViseme('REST', this.settings.closureMorphMs);
      this.waitForWord();
    }, Math.max(0, end - performance.now())));
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
