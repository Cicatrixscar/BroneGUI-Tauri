# Viseme streaming modular

Implemented optional `bicara.visemeMode`: `bawaan` (default), `streaming`, `fallback`.

## Usage

Press **F4 in dynamic mode** to cycle Bawaan -> Streaming kata -> Fallback mulut. A source notice appears for two seconds. Source changes cancel previous timers without entering static mode. F2 still switches dynamic/static, and the static panel dropdown remains synchronized. F4 ignores key repeat and modified keys such as Alt+F4. Panel selection lasts for the current application session; set `bicara.visemeMode` in `src/config/config.json` for startup behavior.

Publish `robot/expression` with `{"expression":"happy","duration":6.0}`, then `robot/word` with `{"word":"belum"}` as each word plays. Optional `robot/voice_stage` with `{"stage":"tts","state":"end"}` ends speech early. The duration is the master bound; silence timeout and a hard watchdog cover missing duration/end signals.

PBM shares the syllable budget; repeated vowels extend; 2-5 full capitals use Indonesian letter names. Existing viseme assets, legacy schedules and fallback remain available. Calibration settings live under `bicara.streaming`.

## Validation

- `npm.cmd test`: 47 frontend tests passed, including legacy behavior, parser, preemption, mode isolation, timers, duplicate delivery and streaming during emotion transitions.
- `node scripts/verify-word-viseme.mjs`: passed in Edge headless; F4 dynamic source cycle/notice and selector synchronization, word HTTP/SSE bridge, preemption, REST gaps, master deadline, 25ms PBM morph completion. Screenshot: `reports/word-viseme/mode-selector.png`.
- `node scripts/verify-viseme-morph.mjs`: passed; 21 SVG assets, 34 transitions, 4 interpolated layers.
- `node --check src/js/main.js` and `node --check scripts/dev-server.js`: passed.
- `git diff --check`: passed.
- Rust tests were added for word parsing/validation and unknown voice-stage states. Cargo is unavailable on this host, so Rust compilation/tests and desktop MQTT integration have not been executed. A stray duplicated assertion with unmatched braces at the end of the existing protocol test module was removed.

## Limits

Written-vowel syllable splitting is a heuristic. Full capitals are interpreted literally as spelling; unsupported numeric tokens produce no animation. Silence timeout approximates speech ending when duration/end metadata is missing. Parameters are initial visual calibration, not additional measured audio data. No new dependencies.
