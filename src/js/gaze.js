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
