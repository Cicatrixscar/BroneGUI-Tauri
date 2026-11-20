#!/usr/bin/env node
// node scripts/test-gaze.mjs [interval_ms=1000] [jumlah_siklus]
// Satu siklus: kiri -> kanan. Tanpa jumlah siklus, berjalan sampai Ctrl+C.
import { setTimeout as wait } from 'node:timers/promises';

const args = process.argv.slice(2);
const usage = 'Gunakan: node scripts/test-gaze.mjs [interval_ms=1000] [jumlah_siklus]';
if (args[0] === '--help') {
  console.log(usage);
  console.log('Contoh: node scripts/test-gaze.mjs 700 10');
  console.log('Tanpa jumlah siklus: berulang sampai Ctrl+C. Setelah selesai, mata kembali ke tengah.');
  process.exit(0);
}

const intervalMs = Number(args[0] ?? 1000);
const cycles = args[1] === undefined ? Infinity : Number(args[1]);
if (args.length > 2 || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647 ||
    (args[1] !== undefined && (!Number.isSafeInteger(cycles) || cycles < 1))) {
  console.error(usage);
  console.error('Interval dan jumlah siklus harus bilangan bulat positif.');
  process.exit(1);
}

const url = `http://localhost:${process.env.PORT || '3000'}/api/message`;
const stopSignal = new AbortController();
const stop = () => stopSignal.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function send(x) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'gaze', x }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  return result.deliveredTo;
}

let sent = false;
console.log(`Gaze kiri-kanan setiap ${intervalMs} ms melalui ${url}`);
console.log('Buka browser pada /src/ dalam mode dinamis. Ctrl+C untuk berhenti.');
try {
  for (let cycle = 1; cycle <= cycles && !stopSignal.signal.aborted; cycle++) {
    for (const x of [-1, 1]) {
      if (stopSignal.signal.aborted) break;
      const receivers = await send(x);
      sent = true;
      console.log(`Siklus ${cycle}: ${x < 0 ? 'kiri' : 'kanan'} (x=${x}), terkirim ke ${receivers} browser`);
      await wait(intervalMs, undefined, { signal: stopSignal.signal });
    }
  }
} catch (error) {
  if (error.name !== 'AbortError') {
    console.error(`Pengujian gagal: ${error.message}. Pastikan dev server aktif.`);
    process.exitCode = 1;
  }
} finally {
  if (sent) {
    try {
      await send(0);
      console.log('Selesai. Target mata dikembalikan ke tengah (x=0).');
    } catch (error) {
      console.error(`Gagal mengembalikan mata ke tengah: ${error.message}`);
      process.exitCode = 1;
    }
  }
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
