#!/usr/bin/env node
/**
 * CLI Tool Cepat untuk Menembak State Wajah dari Terminal
 *
 * Contoh penggunaan:
 *   node scripts/send.js sad 4000
 *   node scripts/send.js timeout
 *   node scripts/send.js ekspresi happy 2000
 *   node scripts/send.js viseme A
 *   node scripts/send.js '{"tipe":"ekspresi","emosi":"cry","durasi_ms":3000}'
 */

const args = process.argv.slice(2);
const PORT = process.env.PORT || '3000';
const URL = `http://localhost:${PORT}/api/message`;

if (args.length === 0) {
  console.log(`Penggunaan CLI:`);
  console.log(`  node scripts/send.js <emosi> [durasi_ms]`);
  console.log(`  node scripts/send.js viseme <kode_viseme>`);
  console.log(`  node scripts/send.js '<json_payload>'`);
  console.log(`\nContoh:`);
  console.log(`  node scripts/send.js sad 4000`);
  console.log(`  node scripts/send.js timeout`);
  console.log(`  node scripts/send.js viseme A`);
  process.exit(0);
}

let payload = {};

// Cek jika argumen pertama adalah string JSON lengkap
if (args[0].startsWith('{')) {
  try {
    payload = JSON.parse(args.join(' '));
  } catch (e) {
    console.error('Format JSON tidak valid:', e.message);
    process.exit(1);
  }
} else if (args[0] === 'ekspresi' || args[0] === 'emotion') {
  payload = {
    tipe: 'ekspresi',
    emosi: args[1] || 'idle',
    intensitas: 1.0,
    durasi_ms: args[2] ? parseInt(args[2], 10) : undefined
  };
} else if (args[0] === 'viseme') {
  payload = {
    tipe: 'viseme',
    jadwal: [{ t: 0.0, v: args[1] || 'A' }]
  };
} else if (args[0] === 'bicara') {
  payload = {
    tipe: 'bicara',
    status: args[1] || 'selesai'
  };
} else {
  // Shorthand: nama emosi langsung
  // misal: node scripts/send.js sedih 4000
  payload = {
    tipe: 'ekspresi',
    emosi: args[0],
    intensitas: 1.0,
    durasi_ms: args[1] ? parseInt(args[1], 10) : undefined
  };
}

fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
  .then(async res => {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    console.log(`✅ Berhasil terkirim ke ${data.deliveredTo} browser:`, payload);
  })
  .catch(err => {
    console.error(`❌ Gagal terhubung ke Dev Server (${URL}).`);
    console.error(`   Pastikan server sudah jalan dengan perintah: node scripts/dev-server.js`);
    console.error(`   Detail error:`, err.message);
  });

