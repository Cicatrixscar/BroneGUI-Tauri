// Adapter format eksternal CV/terminal ke kontrak internal GUI.
export function parseGaze(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 2 || payload.type !== 'gaze' ||
      !Object.hasOwn(payload, 'type') || !Object.hasOwn(payload, 'x') ||
      !Number.isFinite(payload.x)) {
    throw new Error('Gaze wajib berisi type:"gaze" dan angka x finite');
  }
  return { tipe: 'gaze', x: payload.x };
}

export const isGazeSuspended = emotion => ['cry', 'menangis', 'timeout'].includes(emotion);

// EOR lokal: pusat mata tetap dalam rectangle posisi asal, tidak melintasi
// tengah wajah atau keluar rounded face. Amplitudo visual dikalibrasi terpisah.
export function measureGazeGeometry(config = {}) {
  const fail = reason => ({ valid: false, reason, maxOffsetX: 0, poses: {} });
  const width = config.canvas?.baseWidth;
  const height = config.canvas?.baseHeight;
  const radius = config.gaze?.faceCornerRadius;
  const amplitudeRatio = config.gaze?.amplitudeRatio;
  if (![width, height, radius].every(Number.isFinite) || width <= 0 || height <= 0 ||
      radius < 0 || radius > Math.min(width, height) / 2) return fail('Invalid face geometry');
  if (!Number.isFinite(amplitudeRatio) || amplitudeRatio < 0) return fail('Invalid gaze amplitude ratio');
  const entries = Object.entries(config.expressions ?? {});
  if (!entries.length) return fail('Missing eye poses');
  for (const side of ['eyeL', 'eyeR']) {
    const eyes = entries.map(([, pose]) => pose?.[side]);
    if (eyes.some(e => !e || ![e.x, e.y, e.w, e.h].every(Number.isFinite) || e.w <= 0 ||
        e.h <= 0 || e.x < 0 || e.y < 0 || e.x + e.w > width || e.y + e.h > height)) {
      return fail(`Invalid ${side} geometry`);
    }
  }
  const poses = {};
  for (const [name, pose] of entries) {
    if (isGazeSuspended(name)) continue;
    let lo = -Infinity;
    let hi = Infinity;
    const regions = {};
    for (const side of ['eyeL', 'eyeR']) {
      const e = pose[side];
      // Rounded rectangle: gunakan batas tersempit sepanjang tinggi rectangle mata.
      const dy = Math.max(0, radius - e.y, e.y + e.h - (height - radius));
      const inset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const left = Math.max(inset, e.x - e.w / 2, side === 'eyeR' ? width / 2 : 0);
      const right = Math.min(width - inset, e.x + e.w * 1.5, side === 'eyeL' ? width / 2 : width);
      regions[side] = { left, right };
      lo = Math.max(lo, left - e.x);
      hi = Math.min(hi, right - e.x - e.w);
    }
    if (lo > 0 || hi < 0) return fail(`Neutral pose outside EOR: ${name}`);
    const referenceWidth = Math.min(pose.eyeL.w, pose.eyeR.w);
    const geometricMax = Math.max(0, Math.min(-lo, hi));
    const maxOffsetX = Math.min(geometricMax, amplitudeRatio * referenceWidth);
    poses[name] = { lower: lo, upper: hi, width: referenceWidth, geometricMax,
      maxOffsetX, maxEyeFraction: maxOffsetX / referenceWidth, regions };
  }
  if (!Object.keys(poses).length) return fail('Missing gaze-enabled poses');
  // Maximum ini hanya ringkasan diagnostik; renderer memilih profil pose aktual.
  const maxOffsetX = Math.max(...Object.values(poses).map(p => p.maxOffsetX));
  return { valid: true, reason: null, maxOffsetX, amplitudeRatio, poses };
}
