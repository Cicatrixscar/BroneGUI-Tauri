// Browser geometry proof. Set BRONE_BROWSER to a Chromium executable on other systems.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(path.join(tmpdir(), 'brone-morph-'));
const browser = spawn(process.env.BRONE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 20000);
    browser.on('error', reject);
    browser.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener('close', () => {
    for (const call of pending.values()) call.reject(new Error('Browser disconnected'));
    pending.clear();
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
      pending.set(++id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.navigate', { url: 'http://localhost:3000/src/' }, sessionId);
  for (let i = 0; i < 100; i++) {
    if (await evaluate('typeof window.sendBroneMessage === "function"')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const result = await evaluate(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const key = () => window.dispatchEvent(new KeyboardEvent('keydown', {key:'F2', bubbles:true}));
    const select = document.getElementById('viseme-mode');
    if (!select) throw new Error('Missing viseme selector');
    const defaults = select.value;
    const f4 = (extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', {key:'F4', bubbles:true, ...extra}));
    const cycle = [];
    for (let i = 0; i < 3; i++) {
      f4();
      cycle.push(select.value);
      if (!document.getElementById('control-panel').classList.contains('control-panel-hidden')) {
        throw new Error('F4 must stay in dynamic mode');
      }
    }
    f4(); // select streaming without entering static mode
    f4({repeat:true});
    f4({altKey:true});
    if (select.value !== 'streaming') throw new Error('Repeated/modified F4 changed source');
    const notice = document.getElementById('viseme-mode-notice');
    if (notice.hidden || !notice.textContent.includes('Streaming kata')) throw new Error('Missing active source notice');
    const mouth = () => document.getElementById('mouth').getAttribute('href');
    // Observe the actual app while eye emotion transition is still running.
    const history = [];
    const observer = new MutationObserver(() => history.push(mouth()));
    observer.observe(document.getElementById('mouth'), {attributes:true, attributeFilter:['href']});
    window.sendBroneMessage({tipe:'ekspresi', emosi:'happy', durasi_ms:1200});
    window.sendBroneMessage({tipe:'word', word:'belum'});
    await wait(160);
    const response = await fetch('/api/word', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({word:'BCA'})
    });
    const delivered = await response.json();
    if (!response.ok || delivered.deliveredTo < 1) throw new Error('Word HTTP/SSE bridge failed');
    await wait(600);
    const gap = mouth();
    await wait(500);
    const end = mouth();
    observer.disconnect();
    key();
    const panelVisible = !document.getElementById('control-panel').classList.contains('control-panel-hidden');
    const { MouthMorph } = await import('./js/mouthMorph.js');
    const config = await (await fetch('./config/config.json')).json();
    const svg = document.getElementById('wajah').cloneNode(true);
    const test = new MouthMorph(svg.querySelector('#layer-mouth'), svg.querySelector('#mouth'));
    await test.load(config);
    const box = code => config.visemePositions[code];
    test.image.setAttribute('href', config.visemes.A);
    for (const [key,value] of Object.entries(box('A'))) {
      test.image.setAttribute(key === 'w' ? 'width' : key === 'h' ? 'height' : key, value);
    }
    test.start(config.visemes.REST, box('REST'), true, 0, 25);
    test.update(25);
    const closureCompleted = test.transition === null;
    return {defaults, selected:select.value, cycle, panelVisible, history, gap, end, closureCompleted};
  })()`);
  assert.equal(result.defaults, 'bawaan');
  assert.equal(result.selected, 'streaming');
  assert.deepEqual(result.cycle, ['streaming', 'fallback', 'bawaan']);
  assert.equal(result.panelVisible, true);
  assert.ok(result.history.includes('assets/viseme/E.svg'), JSON.stringify(result));
  assert.ok(result.history.includes('assets/viseme/A.svg'), JSON.stringify(result));
  assert.equal(result.gap, 'assets/viseme/REST.svg');
  assert.equal(result.end, 'assets/HAPPIER.svg');
  assert.equal(result.closureCompleted, true);
  await send('Emulation.setDeviceMetricsOverride', {width:1000,height:650,deviceScaleFactor:1,mobile:false}, sessionId);
  await mkdir('reports/word-viseme', {recursive:true});
  const screenshot = await send('Page.captureScreenshot', {format:'png'}, sessionId);
  await writeFile('reports/word-viseme/mode-selector.png', Buffer.from(screenshot.data,'base64'));
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'F2'}));
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'F4'}));`);
  const dynamicShot = await send('Page.captureScreenshot', {format:'png'}, sessionId);
  await writeFile('reports/word-viseme/f4-dynamic.png', Buffer.from(dynamicShot.data,'base64'));
  await writeFile('reports/word-viseme/verification.json', JSON.stringify(result,null,2));
  console.log('PASS: F4 dynamic source cycle/notice, selector sync, real streaming during eye transition, preemption, REST gap, master deadline, 25ms PBM closure.');
} finally {
  socket?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise(resolve => browser.once('exit', resolve));
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('brone-morph-')) {
    throw new Error('Unexpected browser profile path');
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
