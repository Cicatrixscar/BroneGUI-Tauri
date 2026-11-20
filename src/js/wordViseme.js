export const WORD_DEFAULTS = {
  syllableMs: 150,
  bilabialMs: 45,
  extraVowelMs: 100,
  punctuationMs: 180,
  silenceTimeoutMs: 1200,
  watchdogMs: 10000,
  morphMs: 60,
  closureMorphMs: 25,
};

const BILABIAL = /[pbm]/;
const LETTER_SOUNDS = {
  A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'ef', G: 'ge',
  H: 'ha', I: 'i', J: 'je', K: 'ka', L: 'el', M: 'em', N: 'en',
  O: 'o', P: 'pe', Q: 'ki', R: 'er', S: 'es', T: 'te', U: 'u',
  V: 'fe', W: 'we', X: 'eks', Y: 'ye', Z: 'zet',
};

export function wordSettings(config = {}) {
  const result = { ...WORD_DEFAULTS };
  for (const key of Object.keys(result)) {
    if (Number.isFinite(config[key]) && config[key] > 0) result[key] = config[key];
  }
  // Leave room for a vowel even when both edges contain PBM.
  result.bilabialMs = Math.min(result.bilabialMs, result.syllableMs / 3);
  return result;
}

export function parseWordToVisemes(rawWord, config = {}) {
  if (typeof rawWord !== 'string' || rawWord.length > 256) return [];
  const settings = wordSettings(config);
  const word = rawWord.replace(/[,.!?;:"'“”‘’()]/g, '').trim();
  if (!/^[a-zA-Z]+(?:-[a-zA-Z]+)*$/.test(word)) return [];
  const steps = [];
  const push = (v, durasi) => {
    const previous = steps.at(-1);
    if (previous?.v === v) previous.durasi += durasi;
    else steps.push({ v, durasi });
  };
  const syllable = (vowels, onset, coda) => {
    const closeBefore = BILABIAL.test(onset);
    const closeAfter = BILABIAL.test(coda);
    const total = settings.syllableMs + (vowels.length - 1) * settings.extraVowelMs;
    if (closeBefore) push('REST', settings.bilabialMs);
    push(vowels[0].toUpperCase(), total - settings.bilabialMs * (Number(closeBefore) + Number(closeAfter)));
    if (closeAfter) push('REST', settings.bilabialMs);
  };
  const parse = text => {
    const nuclei = [...text.matchAll(/([aiueo])\1*/g)];
    let onset = text.slice(0, nuclei[0]?.index ?? text.length);
    nuclei.forEach((nucleus, index) => {
      const end = nucleus.index + nucleus[0].length;
      const next = nuclei[index + 1];
      const bridge = text.slice(end, next?.index ?? text.length);
      // ponytail: written-vowel heuristic; explicit hyphens preserve supplied syllable boundaries.
      const nextOnset = next ? (bridge.match(/(?:ng|ny|sy|kh|[a-z])$/)?.[0] ?? '') : '';
      const coda = bridge.slice(0, bridge.length - nextOnset.length);
      syllable(nucleus[0], onset, coda);
      onset = nextOnset;
    });
  };
  if (/^[A-Z]{2,5}$/.test(word)) {
    for (const letter of word) parse(LETTER_SOUNDS[letter]);
  } else {
    for (const part of word.toLowerCase().split('-')) parse(part);
  }
  if (steps.length && /[,.!?;:]["'”’)]*$/.test(rawWord.trim())) push('REST', settings.punctuationMs);
  return steps;
}

export function parseSentenceToVisemes(sentence, config = {}) {
  if (typeof sentence !== 'string' || [...sentence].length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(sentence)) return [];
  return sentence.trim().split(/\s+/).flatMap(word => parseWordToVisemes(word, config));
}
