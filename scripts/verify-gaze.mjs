// Browser geometry proof. Set BRONE_BROWSER to a Chromium executable on other systems.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(path.join(tmpdir(), 'brone-gaze-'));
const browser = spawn(process.env.BRONE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'
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
  await send('Page.navigate', { url: `http://localhost:${process.env.PORT || '3000'}/src/` }, sessionId);
  for (let i = 0; i < 100; i++) {
    if (await evaluate('typeof window.sendBroneMessage === "function"')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await send('Emulation.setDeviceMetricsOverride', {width:800,height:480,deviceScaleFactor:1,mobile:false}, sessionId);
  await send('Page.bringToFront', {}, sessionId);
  await mkdir('reports/gaze', {recursive:true});
  const sample = () => evaluate(`(() => {
    const eye = id => {
      const el = document.getElementById(id);
      const box = el.getBBox();
      const matrix = el.getCTM();
      return { baseX: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
        screenX: matrix.a * box.x + matrix.c * box.y + matrix.e };
    };
    return { transform: document.getElementById('layer-eyes').getAttribute('transform'),
      left: eye('eye-l'), right: eye('eye-r'), mouth: document.getElementById('mouth').getAttribute('href') };
  })()`);
  const post = async payload => {
    const response = await fetch(`http://localhost:${process.env.PORT || '3000'}/api/message`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    return {status:response.status, body:await response.json()};
  };
  const cli = async x => {
    const {stdout} = await run(process.execPath, ['scripts/send.js', 'gaze', String(x)], {windowsHide:true});
    assert.match(stdout, /terkirim ke [1-9][0-9]* browser/);
    await wait(250);
    return sample();
  };
  await wait(500);
  const result = {center: await cli(0)};
  for (const [name, x] of [['left', -1], ['right', 1], ['center', 0]]) {
    const state = await cli(x);
    assert.equal(state.transform, `translate(${x * 20} 0)`);
    for (const side of ['left', 'right']) {
      assert.equal(state[side].baseX, result.center[side].baseX);
      assert.equal(state[side].y, result.center[side].y);
      assert.ok(Math.abs(state[side].screenX - result.center[side].screenX - x * 20) < 0.01);
    }
    const screenshot = await send('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(`reports/gaze/${name}.png`, Buffer.from(screenshot.data,'base64'));
    result[name] = state;
  }
  result.clamped = [];
  for (const [x, target] of [[-5, -1], [8, 1], [-Number.MAX_VALUE, -1], [Number.MAX_VALUE, 1], [0.5, 0.5]]) {
    const state = await cli(x);
    assert.equal(state.transform, `translate(${target * 20} 0)`);
    result.clamped.push({input:x, transform:state.transform});
  }
  await cli(0);
  for (const x of ['0.5', null, true]) {
    assert.equal((await post({type:'gaze', x})).status, 400);
  }
  assert.equal((await post({type:'gaze', x:0, y:0})).status, 400);
  assert.equal((await sample()).transform, 'translate(0 0)');

  // Actual browser blink and expression transition retain the parent gaze transform.
  await cli(1);
  await post({tipe:'ekspresi', emosi:'happy'});
  await wait(450);
  assert.equal((await sample()).transform, 'translate(20 0)');
  const blinkSeen = await evaluate(`(async () => {
    const until = performance.now() + 7000;
    while (performance.now() < until) {
      if (document.getElementById('layer-eyes').getAttribute('transform') !== 'translate(20 0)') {
        throw new Error('Blink changed gaze offset');
      }
      const scale = document.getElementById('eye-l-wrap').style.transform.match(/scaleY\\(([^)]+)/);
      if (scale && Number(scale[1]) < 0.8) return true;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return false;
  })()`);
  assert.equal(blinkSeen, true, 'Automatic blink was not observed');
  assert.equal((await sample()).transform, 'translate(20 0)');
  await post({tipe:'ekspresi', emosi:'cry'});
  await wait(450);
  assert.equal((await sample()).transform, 'translate(0 0)');
  await cli(-1);
  assert.equal((await sample()).transform, 'translate(0 0)');
  await post({tipe:'ekspresi', emosi:'idle'});
  await wait(650);
  assert.equal((await sample()).transform, 'translate(-20 0)');
  await post({tipe:'ekspresi', emosi:'timeout'});
  await wait(450);
  assert.equal((await sample()).transform, 'translate(0 0)');
  const rotation = await evaluate(`document.getElementById('eye-l').getAttribute('transform')`);
  assert.match(rotation, /rotate/);
  await post({tipe:'ekspresi', emosi:'idle'});
  await wait(650);
  assert.equal((await sample()).transform, 'translate(-20 0)');

  // Static mode rejects gaze; returning to dynamic does not replay it.
  const key = key => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)}}))`);
  await key('F2');
  await cli(1);
  assert.equal((await sample()).transform, 'translate(0 0)');
  await key('F2');
  await wait(450);
  assert.equal((await sample()).transform, 'translate(0 0)');

  // Streaming sentences continue while gaze arrives through the terminal bridge.
  await evaluate(`(() => {
    const select = document.getElementById('viseme-mode');
    select.value = 'streaming';
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await post({expression:'happy', duration:0.6, sentence:'a i'});
  await cli(1);
  const speaking = await sample();
  assert.equal(speaking.transform, 'translate(20 0)');
  assert.match(speaking.mouth, /viseme\/(A|I)\.svg/);
  await wait(450);
  assert.match((await sample()).mouth, /HAPPIER\.svg/);
  await cli(0);
  await post({tipe:'bicara', status:'selesai'});
  result.viewports = [];
  for (const [width, height] of [[400, 240], [1600, 960]]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false}, sessionId);
    const resized = await cli(1);
    assert.equal(resized.transform, 'translate(20 0)');
    assert.ok(Math.abs(resized.left.screenX - (115 + 20) * width / 800) < 0.01);
    result.viewports.push({width, height, leftScreenX:resized.left.screenX});
  }
  await cli(0);
  result.verified = ['terminal CLI -> HTTP -> SSE -> rendered SVG', 'finite out-of-range input clamped by GUI', 'invalid gaze rejected',
    'observed automatic blink and expression transitions', 'cry/timeout suppression and resume', 'static reset',
    'SVG scaling at 400x240 and 1600x960',
    'streaming sentence and mouth isolation'];
  await writeFile('reports/gaze/verification.json', JSON.stringify(result,null,2));
  console.log('PASS:', result.verified.join('; '));
} finally {
  socket?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise(resolve => browser.once('exit', resolve));
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('brone-gaze-')) {
    throw new Error('Unexpected browser profile path');
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
