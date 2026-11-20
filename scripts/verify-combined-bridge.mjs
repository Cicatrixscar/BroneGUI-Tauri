import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const port = 43000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, ['scripts/dev-server.js'], {
  env: { ...process.env, PORT: String(port) },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let reader;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge startup timed out')), 5000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Bridge exited: ${code}`)); });
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('Dev Server')) { clearTimeout(timer); resolve(); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const sse = await fetch(`${base}/events`, { signal: AbortSignal.timeout(6000) });
  reader = sse.body.getReader();
  const packet = { expression: 'happy', duration: 3.5, sentence: 'Halo, apa kabar?' };
  for (const path of ['/api/message', '/api/ekspresi', '/api/sentence']) {
    const response = await fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.deliveredTo, 1);
    assert.deepEqual(result.payload, { ...packet, tipe: 'sentence' });
    let received = '';
    while (!received.includes(packet.sentence)) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      received += new TextDecoder().decode(value);
    }
    const event = received.split('\n').find(line => line.startsWith('data: ') && line.includes(packet.sentence));
    assert.deepEqual(JSON.parse(event.slice(6)), { ...packet, tipe: 'sentence' });
  }
  console.log('PASS: combined expression/duration/sentence preserved through all HTTP/SSE endpoints');
} finally {
  await reader?.cancel().catch(() => {});
  server.kill();
}
