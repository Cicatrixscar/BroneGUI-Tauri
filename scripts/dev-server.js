#!/usr/bin/env node
/**
 * Dev Server & Terminal Bridge untuk Brone GUI
 *
 * Menjalankan server lokal pada port 3000 dengan dukungan:
 * 1. Static file serving (HTML, JS, CSS, SVG, JSON).
 * 2. SSE (Server-Sent Events) bridge ke browser Chrome.
 * 3. HTTP REST API (/api/message, /api/ekspresi, dll) agar bisa ditembak via curl/terminal.
 * 4. MQTT Bridge otomatis (via mosquitto_sub jika terinstall) agar mosquitto_pub langsung masuk ke browser!
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MQTT_HOST = process.env.BRONE_MQTT_HOST || '127.0.0.1';
const MQTT_PORT = process.env.BRONE_MQTT_PORT || '1883';

// Klien SSE browser yang sedang terhubung
const sseClients = new Set();

function broadcastToClients(payload) {
  if (typeof payload !== 'object' || !payload) return 0;
  const dataStr = JSON.stringify(payload);
  const message = `data: ${dataStr}\n\n`;

  let count = 0;
  for (const client of sseClients) {
    try {
      client.write(message);
      count++;
    } catch {
      sseClients.delete(client);
    }
  }
  return count;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS Headers untuk pengujian fleksibel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. Endpoint SSE: /events
  if (pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });

    res.write('retry: 2000\n\n');
    res.write('data: {"connected":true}\n\n');

    sseClients.add(res);
    console.log(`[Bridge] Browser terhubung ke SSE bridge. Total klien aktif: ${sseClients.size}`);

    req.on('close', () => {
      sseClients.delete(res);
      console.log(`[Bridge] Browser terputus dari SSE bridge. Sisa klien aktif: ${sseClients.size}`);
    });
    return;
  }

  // 2. Endpoint API Penerima Pesan Terminal: POST /api/message atau POST /api/ekspresi
  if (req.method === 'POST' && (pathname === '/api/message' || pathname === '/api/ekspresi' || pathname === '/api/viseme' || pathname === '/api/bicara')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        let payload = JSON.parse(body || '{}');

        // Normalisasi payload jika endpoint spesifik dipanggil tanpa field 'tipe'
        if (pathname === '/api/ekspresi' && !payload.tipe) {
          payload.tipe = 'ekspresi';
        } else if (pathname === '/api/viseme' && !payload.tipe) {
          payload.tipe = 'viseme';
        } else if (pathname === '/api/bicara' && !payload.tipe) {
          payload.tipe = 'bicara';
        }

        const deliveredCount = broadcastToClients(payload);
        console.log(`[Bridge] Pesan diterima dari terminal:`, payload, `(terkirim ke ${deliveredCount} browser)`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, deliveredTo: deliveredCount, payload }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Format JSON tidak valid', message: err.message }));
      }
    });
    return;
  }

  // 3. Static File Serving
  let filePath = path.join(ROOT_DIR, pathname);

  // Default redirect root ke /src/
  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { 'Location': '/src/' });
    res.end();
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${pathname}`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// 4. Jembatan otomatis Mosquitto MQTT -> Browser SSE
function startMosquittoSubBridge() {
  try {
    const sub = spawn('mosquitto_sub', ['-h', MQTT_HOST, '-p', MQTT_PORT, '-t', 'brone/face/#', '-F', '%t\t%p'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    sub.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split('\t');
        if (parts.length >= 2) {
          const topic = parts[0];
          const payloadStr = parts.slice(1).join('\t');
          try {
            const payload = JSON.parse(payloadStr);
            console.log(`[MQTT Bridge] Menerima pesan MQTT dari '${topic}':`, payload);
            broadcastToClients(payload);
          } catch {
            // Abaikan jika bukan JSON
          }
        }
      }
    });

    sub.on('error', () => {
      // mosquitto_sub tidak ditemukan di sistem, tidak apa-apa (fallback via curl / API)
    });
  } catch {
    // Abaikan jika gagal spawn mosquitto_sub
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Brone GUI Dev Server & Terminal Bridge Berjalan!`);
  console.log(`🌐 Buka di Chrome : http://localhost:${PORT}/src/`);
  console.log(`📡 Cara nembak dari terminal:`);
  console.log(`   1. Pakai Curl : curl -X POST http://localhost:${PORT}/api/ekspresi -d "{\\"emosi\\":\\"sedih\\",\\"durasi_ms\\":4000}"`);
  console.log(`   2. Pakai Script: node scripts/send.js ekspresi sedih 4000`);
  console.log(`   3. Pakai MQTT : mosquitto_pub -h ${MQTT_HOST} -t "brone/face/ekspresi" -m '{"tipe":"ekspresi","emosi":"sedih","durasi_ms":4000}'`);
  console.log(`=======================================================`);

  startMosquittoSubBridge();
});

