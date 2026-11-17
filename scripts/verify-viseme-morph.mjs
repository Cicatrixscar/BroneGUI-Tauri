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
    const { MouthMorph } = await import('./js/mouthMorph.js');
    const { Renderer } = await import('./js/renderer.js');
    const { FaceState } = await import('./js/state.js');
    const config = await (await fetch('./config/config.json')).json();
    const svg = document.getElementById('wajah');
    // Isolated renderer with deterministic timestamps: no audio, MQTT or scheduler needed.
    const state = new FaceState(config);
    const renderer = new Renderer(svg, state, null, config);
    await renderer.mouthMorph.load(config);
    renderer.applyState(true);
    const morph = renderer.mouthMorph;
    const codes = Object.keys(config.visemes).filter(v => v !== 'DIAM');
    const checks = [];
    let time = performance.now();
    for (const code of codes) {
      const box = config.visemePositions[code];
      if (!box) continue;
      morph.start(config.visemes[code], box, true, time);
      const from = JSON.stringify(morph.current);
      const to = JSON.stringify(morph.transition.to);
      renderer.mouthEl.setAttribute('href', config.visemes[code]);
      for (const [key, value] of Object.entries({x:box.x,y:box.y,width:box.w,height:box.h})) renderer.mouthEl.setAttribute(key,value);
      morph.update(time + 50);
      const middle = JSON.stringify(morph.current);
      checks.push({code, finite:morph.current.every(l => l.points.flat().every(Number.isFinite)), intermediate:from === to || (middle !== from && middle !== to)});
      morph.update(time + 100);
      time += 120;
    }
    for (const [emotion, expression] of Object.entries(config.expressions)) {
      morph.start(expression.mouth.asset, expression.mouth, true, time);
      const from = JSON.stringify(morph.current);
      const to = JSON.stringify(morph.transition.to);
      morph.update(time + 50);
      const middle = JSON.stringify(morph.current);
      checks.push({code:'DIAM/'+emotion, finite:morph.current.every(l => l.points.flat().every(Number.isFinite)), intermediate:from === to || (middle !== from && middle !== to)});
      morph.update(time + 100);
      time += 120;
    }
    state.setViseme('A'); morph.update(performance.now()+100);
    state.setViseme('O'); morph.update(performance.now()+50);
    window.morphProof = { renderer, state };
    return {checks, loaded:morph.assets.size, expected:new Set([...Object.values(config.visemes),...Object.values(config.expressions).map(e=>e.mouth.asset)].filter(Boolean)).size, pathCount:document.querySelectorAll('[data-mouth-morph] path').length};
  })()`);
  assert.equal(result.loaded, result.expected, 'all mouth SVGs load');
  assert.equal(result.pathCount, 4, 'renderer displays interpolated paths');
  assert.ok(result.checks.every(c => c.finite && c.intermediate), JSON.stringify(result.checks));
  await mkdir('reports/viseme-morph', { recursive: true });
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile('reports/viseme-morph/midpoint.png', Buffer.from(data, 'base64'));
  await evaluate(`(async () => {
    const { renderer } = window.morphProof;
    const morph = renderer.mouthMorph;
    const config = renderer.config;
    const root = document.createElement('div');
    root.style = 'position:fixed;inset:0;overflow:auto;background:#CBD8E2;color:black;font:14px sans-serif;z-index:100';
    let time = performance.now();
    const codes = ['A','I','U','E','O','REST','DIAM','A'];
    for(let i=1;i<codes.length;i++) {
      const row = document.createElement('div');
      row.style='display:flex;height:105px;align-items:center';
      const label = document.createElement('span'); label.style='width:90px'; label.textContent=codes[i-1]+' → '+codes[i]; row.append(label);
      const box = code => code === 'DIAM' ? config.expressions.idle.mouth : {asset:config.visemes[code],...config.visemePositions[code]};
      const a=box(codes[i-1]), b=box(codes[i]);
      for(const progress of [0,25,50,75,100]) {
        morph.cancel();
        for(const [key,value] of Object.entries({href:a.asset,x:a.x,y:a.y,width:a.w,height:a.h})) renderer.mouthEl.setAttribute(key,value);
        morph.start(b.asset,b,true,time);
        morph.update(time+progress);
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','240 275 320 210'); svg.style='width:125px;height:100px';
        if(morph.group) svg.append(morph.group.cloneNode(true));
        else { const image=renderer.mouthEl.cloneNode(true); for(const [key,value] of Object.entries({href:b.asset,x:b.x,y:b.y,width:b.w,height:b.h})) image.setAttribute(key,value); svg.append(image); }
        row.append(svg); time+=120;
      }
      root.append(row);
    }
    document.body.append(root);
  })()`);
  await send('Emulation.setDeviceMetricsOverride', {width:754,height:760,deviceScaleFactor:1,mobile:false}, sessionId);
  const grid = await send('Page.captureScreenshot', { format:'png' }, sessionId);
  await writeFile('reports/viseme-morph/transitions.png', Buffer.from(grid.data, 'base64'));
  console.log(`PASS: ${result.loaded} SVG assets; ${result.checks.length} transitions; ${result.pathCount} interpolated layers. Screenshots: reports/viseme-morph/`);
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
