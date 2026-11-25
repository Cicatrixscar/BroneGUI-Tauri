// Browser geometry proof. Set BRONE_BROWSER to a Chromium executable on other systems.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { measureGazeGeometry } from '../src/js/gaze.js';
const config = JSON.parse(await readFile(new URL('../src/config/config.json', import.meta.url)));
const geometry = measureGazeGeometry(config);
assert.equal(geometry.valid, true);
const limit = geometry.poses.idle.maxOffsetX;
const offsetOf = state => Number(state.transform.match(/translate\(([^ ]+)/)[1]);
const expectOffset = (state, expected) => assert.ok(Math.abs(offsetOf(state) - expected) < 1e-8, state.transform);

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
      return { asset: el.getAttribute('href'), baseX: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
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
  const result = {geometry, center: await cli(0)};
  for (const [name, x] of [['left', 1], ['right', -1], ['center', 0]]) {
    const state = await cli(x);
    expectOffset(state, -Math.max(-1, Math.min(1, x)) * limit);
    for (const side of ['left', 'right']) {
      assert.equal(state[side].baseX, result.center[side].baseX);
      assert.equal(state[side].y, result.center[side].y);
      assert.ok(Math.abs(state[side].screenX - result.center[side].screenX - (-Math.max(-1, Math.min(1, x))) * limit) < 0.01);
    }
    const screenshot = await send('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(`reports/gaze/${name}.png`, Buffer.from(screenshot.data,'base64'));
    result[name] = state;
  }
  result.clamped = [];
  for (const [x, target] of [[-5, -1], [8, 1], [-Number.MAX_VALUE, -1], [Number.MAX_VALUE, 1], [0.2, 0.2], [0.4, 0.4], [-0.2, -0.2], [-0.4, -0.4], [0.5, 0.5]]) {
    const state = await cli(x);
    const offset = Number(state.transform.match(/translate\(([^ ]+)/)[1]);
    assert.ok(Math.abs(offset + target * limit) < 1e-8, state.transform);
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
  expectOffset(await sample(), -limit);
  const blinkSeen = await evaluate(`(async () => {
    const until = performance.now() + 7000;
    while (performance.now() < until) {
      if (Math.abs(Number(document.getElementById('layer-eyes').getAttribute('transform').match(/translate\\(([^ ]+)/)[1]) + ${limit}) > 1e-8) {
        throw new Error('Blink changed gaze offset');
      }
      const scale = document.getElementById('eye-l-wrap').style.transform.match(/scaleY\\(([^)]+)/);
      if (scale && Number(scale[1]) < 0.8) return true;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return false;
  })()`);
  assert.equal(blinkSeen, true, 'Automatic blink was not observed');
  expectOffset(await sample(), -limit);
  await post({tipe:'ekspresi', emosi:'cry'});
  await wait(450);
  assert.equal((await sample()).transform, 'translate(0 0)');
  await cli(-1);
  assert.equal((await sample()).transform, 'translate(0 0)');
  await post({tipe:'ekspresi', emosi:'idle'});
  await wait(650);
  expectOffset(await sample(), limit);
  await post({tipe:'ekspresi', emosi:'timeout'});
  await wait(450);
  assert.equal((await sample()).transform, 'translate(0 0)');
  const rotation = await evaluate(`document.getElementById('eye-l').getAttribute('transform')`);
  assert.match(rotation, /rotate/);
  await post({tipe:'ekspresi', emosi:'idle'});
  await wait(650);
  expectOffset(await sample(), limit);

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
  expectOffset(speaking, -limit);
  assert.match(speaking.mouth, /viseme\/(A|I)\.svg/);
  await wait(450);
  assert.match((await sample()).mouth, /HAPPIER\.svg/);
  await cli(0);
  await post({tipe:'bicara', status:'selesai'});
  // End the streaming test before starting isolated expression geometry checks.
  await evaluate(`(() => {
    const select = document.getElementById('viseme-mode');
    select.value = 'bawaan';
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  // Observe real matrices through every canonical asset swap, not just final transforms.
  result.expressionSweeps = [];
  await send('Emulation.setDeviceMetricsOverride', {width:800,height:480,deviceScaleFactor:1,mobile:false}, sessionId);
  const observeGeometry = () => evaluate(`(async () => {
    const profiles = ${JSON.stringify(geometry.poses)};
    const expressions = ${JSON.stringify(config.expressions)};
    const until = performance.now() + 450;
    let frames = 0;
    let maxOffset = 0;
    while (performance.now() < until) {
      const offset = Number(document.getElementById('layer-eyes').getAttribute('transform').match(/translate\\(([^ ]+)/)[1]);
      maxOffset = Math.max(maxOffset, Math.abs(offset));
      if (Math.abs(offset) > ${geometry.maxOffsetX} + 1e-8) throw new Error('Offset exceeds geometric maximum');
      for (const [id, side] of [['eye-l','eyeL'], ['eye-r','eyeR']]) {
        const el = document.getElementById(id), box = el.getBBox(), m = el.getCTM();
        const rotating = el.getAttribute('href').includes('TIMEOUT');
        const name = Object.keys(profiles).find(name => {
          const e = expressions[name][side];
          return e.asset === el.getAttribute('href') && e.x === Number(el.getAttribute('x')) && e.y === Number(el.getAttribute('y')) && e.w === Number(el.getAttribute('width')) && e.h === Number(el.getAttribute('height'));
        });
        const region = name ? profiles[name].regions[side] : null;
        if (!name && !/CRY|TIMEOUT/.test(el.getAttribute('href'))) throw new Error('Unknown rendered gaze pose');
        if (name && Math.abs(offset) > profiles[name].maxOffsetX + 1e-7) throw new Error('Offset exceeds pose limit');
        if (!rotating) {
          const clip = document.getElementById(id + '-bounds');
          for (const key of ['x','y','width','height']) {
            if (Number(clip.getAttribute(key)) !== Number(el.getAttribute(key))) throw new Error('Stale eye clipping bounds');
          }
        }
        for (const x of [box.x, box.x+box.width]) for (const y of [box.y, box.y+box.height]) {
          const px = m.a*x + m.c*y + m.e, py = m.b*x + m.d*y + m.f;
          const dy = Math.max(0, 40-py, py-440);
          const inset = 40-Math.sqrt(Math.max(0,1600-dy*dy));
          if (py < -1e-7 || py > 480+1e-7 || px < inset-1e-7 || px > 800-inset+1e-7) throw new Error('Eye outside rounded face');
          if (region && (px < region.left-1e-7 || px > region.right+1e-7)) throw new Error('Eye outside local EOR');
          if (name && (box.x + box.width/2 + offset < box.x-1e-7 || box.x + box.width/2 + offset > box.x+box.width+1e-7)) throw new Error('Eye center left its anchor');
        }
      }
      frames++;
      await new Promise(requestAnimationFrame);
    }
    return {frames, maxOffset};
  })()`);
  for (const emotion of ['idle','happy','happier','happier_transisi','sad','confused','shock','cry','timeout','idle']) {
    await post({type:'gaze', x:1});
    await post({tipe:'ekspresi', emosi:emotion});
    const observed = await observeGeometry();
    const finalState = await sample();
    assert.equal(finalState.left.asset, config.expressions[emotion].eyeL.asset, emotion);
    assert.equal(finalState.right.asset, config.expressions[emotion].eyeR.asset, emotion);
    const snapshot = await send('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(`reports/gaze/expression-${emotion}.png`, Buffer.from(snapshot.data,'base64'));
    const expectedLimit = geometry.poses[emotion]?.maxOffsetX ?? 0;
    // Opening from a held pose can finish after the 450ms geometry sampling window.
    await wait(250);
    expectOffset(await sample(), -expectedLimit);
    result.expressionSweeps.push({emotion, ...observed, expectedLimit, leftAsset:finalState.left.asset, rightAsset:finalState.right.asset});
  }
  await cli(0);
  const backdropRadius = await evaluate(`(async () => {
    const text = await (await fetch('assets/BRONE_FACE_BACKSIDE.svg')).text();
    return Number(new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('rect').getAttribute('rx'));
  })()`);
  assert.equal(config.gaze.faceCornerRadius, backdropRadius);
  result.frameProbe = await evaluate(`(async () => {
    const measurements = [];
    for (const active of [false, true]) {
      window.sendBroneMessage({tipe:'gaze',x:0});
      await new Promise(resolve => setTimeout(resolve, 200));
      let writes = 0;
      const observer = new MutationObserver(items => {writes += items.length;});
      observer.observe(document.getElementById('layer-eyes'), {attributes:true,attributeFilter:['transform']});
      const intervals = [];
      let previous;
      for (let frame = 0; frame < 120; frame++) {
        const now = await new Promise(requestAnimationFrame);
        if (previous !== undefined) intervals.push(now-previous);
        previous = now;
        if (active) window.sendBroneMessage({tipe:'gaze',x:Math.sin(frame/12)});
      }
      observer.disconnect();
      intervals.sort((a,b)=>a-b);
      measurements.push({active,frames:120,transformWrites:writes,
        p50FrameMs:intervals[Math.floor(intervals.length*0.5)],
        p95FrameMs:intervals[Math.floor(intervals.length*0.95)]});
    }
    window.sendBroneMessage({tipe:'gaze',x:0});
    return {userAgent:navigator.userAgent,measurements};
  })()`);
  assert.equal(result.frameProbe.measurements[0].transformWrites, 0, 'Idle gaze should not rewrite transform');
  assert.ok(result.frameProbe.measurements[1].transformWrites > 0);
  result.viewports = [];
  for (const [width, height] of [[400, 240], [1600, 960], [1000, 600]]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false}, sessionId);
    const resized = await cli(1);
    expectOffset(resized, -limit);
    assert.ok(Math.abs(resized.left.screenX - (115 - limit) * width / 800) < 0.01);
    result.viewports.push({width, height, leftScreenX:resized.left.screenX});
  }
  await cli(0);
  result.verified = ['terminal CLI -> HTTP -> SSE -> rendered SVG', 'finite CV input clamped to [-1, 1] without amplification; per-expression amplitude from configurable eye-width ratio, capped by local anchor and rounded face geometry', 'camera mirroring: positive input moves left, negative input moves right', 'invalid gaze rejected',
    'observed automatic blink and expression transitions', 'cry/timeout suppression and resume', 'static reset',
    'SVG scaling at 400x240 and 1600x960',
    'streaming sentence and mouth isolation', 'real matrices and clipping bounds sampled during canonical expression changes, including timeout rotation', 'configured face radius matches backdrop SVG', '120-frame baseline and active-gaze probe; idle transform writes zero'];
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
