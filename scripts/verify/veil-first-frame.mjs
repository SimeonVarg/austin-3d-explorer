/**
 * veil-first-frame.mjs — is the first frame after the veil lifts the same picture as the settled city? (2026-10-10)
 *
 * The veil gate (js/app.js authoredViewReady) used to wait for every source behind a hidden layer, including
 * the ones their modules defer past the opening flight (campus-storeys, entrance doors). It no longer waits for
 * those. This check is the proof that nothing the first view shows was left out: per pose and per arm
 * (`veilgate=full` = the old gate, default = the new gate), it
 *   A  photographs the page the moment the veil element is gone,
 *   B  waits until the deferred sources have landed and the map is idle, waits `--settle` more seconds, and
 *      photographs the same camera again,
 * then counts the pixels that moved between A and B (a pixel "moved" if a channel moved by more than 12 of 255,
 * the same rule as ci/pictures.mjs). A load of the SAME gate against itself is the noise floor, so it also
 * compares B(old) with B(new): the settled city must not depend on which gate lifted the veil.
 *
 * VERDICT (exit code): for each pose, moved%(A->B, new gate) must not exceed moved%(A->B, old gate) by more than
 * `--slack` percentage points (default 0.05), and settled(old) against settled(new) must be within `--slack`.
 * Nothing here weakens another check; it only adds one.
 *
 *   VERIFY_URL=http://127.0.0.1:8480 node scripts/verify/veil-first-frame.mjs --out DIR [--reps 2] [--settle 8]
 *     [--poses spawn,start] [--throttle 1] [--gl hardware]
 *
 * Settings printed with the numbers: 1280x800 at DPR 1, graphics auto-detect cancelled, `?drift=0&intro=0&clip=1`
 * plus the picture query (name labels off, facade/time-of-day pacing off: ci/pictures.mjs explains why).
 * Pose `spawn` is the page's own spawn camera; pose `start` is the opening flight's first frame (INTRO.start),
 * jumped to under the veil exactly as primeIntro does, because that is where the veil lifts on a normal visit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { startChrome } from '../perf/lib/cdp.mjs';
import { decodePNG } from './lib/png.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BASE = (process.env.VERIFY_URL || 'http://127.0.0.1:8099').replace(/\/$/, '') + '/';
const OUT = path.resolve(arg('--out', process.env.VERIFY_OUT || 'veil-first-frame-out'));
const REPS = +arg('--reps', 2);
const SETTLE = +arg('--settle', 8) * 1000;
const POSES = arg('--poses', 'spawn,start').split(',');
const THROTTLE = +arg('--throttle', 1);
const GL = arg('--gl', 'hardware');
const SLACK = +arg('--slack', 0.05);
const MAX = +arg('--max', 300) * 1000;
const TOL = 12;
const ARMS = [{ name: 'old', q: 'veilgate=full' }, { name: 'new', q: '' }];
const PIC_Q = 'namelabels=0&facadepace=0&timeofdaypace=0';
const START = { center: [-97.7420, 30.2680], zoom: 16.2, pitch: 78, bearing: 5 };   // INTRO.start in js/app.js
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function moved(fileA, fileB) {
  const A = decodePNG(fileA), B = decodePNG(fileB);
  if (A.width !== B.width || A.height !== B.height) throw new Error('size mismatch');
  let n = 0;
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * A.bpp, j = (y * B.width + x) * B.bpp;
    if (Math.abs(A.data[i] - B.data[j]) > TOL || Math.abs(A.data[i + 1] - B.data[j + 1]) > TOL || Math.abs(A.data[i + 2] - B.data[j + 2]) > TOL) n++;
  }
  return +(100 * n / (A.width * A.height)).toFixed(4);
}

async function one(pose, arm, rep) {
  const tag = `${pose}-${arm.name}-r${rep}`;
  const chrome = await startChrome({ gl: GL, width: 1280, height: 800, vsync: 'off', maxMs: MAX + 120000 });
  const page = await chrome.newPage();
  const ev = async expr => (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const shot = async name => {
    const r = await page.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, `${tag}-${name}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f;
  };
  try {
    await page.send('Page.enable'); await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    if (THROTTLE > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const iv=setInterval(()=>{if(window.cancelGraphicsAutoDetect){try{window.cancelGraphicsAutoDetect()}catch(e){}clearInterval(iv)}},10);setTimeout(()=>clearInterval(iv),30000);})();` });
    const url = BASE + '?drift=0&intro=0&clip=1&' + PIC_Q + (arm.q ? '&' + arm.q : '');
    const t0 = Date.now();
    await page.send('Page.navigate', { url });
    let jumped = pose !== 'start';
    let revealedAt = null, gone = false;
    for (;;) {
      await sleep(100);
      if (Date.now() - t0 > MAX) throw new Error(`${tag}: veil did not lift in ${MAX / 1000} s`);
      if (!jumped) {
        jumped = !!(await ev(`(()=>{ if(!window.__map||!window.__intro) return false; try{ window.__map.jumpTo(${JSON.stringify(START)}); return true;}catch(e){return false;} })()`));
        continue;
      }
      const s = JSON.parse(await ev(`JSON.stringify({r:window.__intro&&window.__intro.reason,v:!!document.getElementById('veil')})`) || '{}');
      if (s.r && revealedAt == null) revealedAt = Date.now() - t0;
      if (s.r && !s.v) { gone = true; break; }
    }
    // The veil is gone: the same render scale the user gets, then the first frame.
    const A = await shot('A-first');
    const aAt = Date.now() - t0;
    // Settle: the deferred sources landed (or 120 s), the map idle, then SETTLE more.
    for (let i = 0; i < 1200; i++) {
      const s = JSON.parse(await ev(`JSON.stringify((()=>{const m=window.__map;const ld=id=>{try{return !m.getSource(id)||m.isSourceLoaded(id)}catch(e){return true}};return {cs:!!(m.getSource('campus-storeys')&&m.isSourceLoaded('campus-storeys')),ent:!!(m.getSource('austin-entrances')&&m.isSourceLoaded('austin-entrances')),tiles:m.areTilesLoaded()}})())`) || '{}');
      if (s.cs && s.ent && s.tiles) break;
      if (Date.now() - t0 > MAX) break;
      await sleep(100);
    }
    await sleep(SETTLE);
    const info = JSON.parse(await ev(`JSON.stringify({reason:window.__intro.reason,waited:window.__intro.waitedMs,gates:window.__intro.gates&&window.__intro.gates['apt.firstView'],c:window.__map.getCenter(),z:window.__map.getZoom(),p:window.__map.getPitch(),b:window.__map.getBearing()})`));
    const B = await shot('B-settled');
    return { tag, pose, arm: arm.name, rep, revealedAtMs: revealedAt, firstShotAtMs: aAt, info, A, B, movedPct: moved(A, B) };
  } finally { await chrome.close(); }
}

const rows = [];
for (let rep = 1; rep <= REPS; rep++) {
  for (const pose of POSES) {
    const order = rep % 2 ? ARMS : [...ARMS].reverse();
    for (const arm of order) {
      try {
        const r = await one(pose, arm, rep); rows.push(r);
        console.log(`${r.tag}: veil lifted at ${r.info.waited} ms into the intro gate, first shot at ${r.firstShotAtMs} ms, moved A->B ${r.movedPct}%, reason ${r.info.reason}`);
      } catch (e) { console.log(`${pose}-${arm.name}-r${rep}: FAILED ${e.message}`); rows.push({ pose, arm: arm.name, rep, error: e.message }); }
    }
  }
}

let fail = 0;
const report = [];
for (const pose of POSES) {
  const by = n => rows.filter(r => r.pose === pose && r.arm === n && !r.error);
  const o = by('old'), nw = by('new');
  if (!o.length || !nw.length) { console.log(`${pose}: NOT MEASURED (old ${o.length} loads, new ${nw.length})`); fail++; continue; }
  const maxO = Math.max(...o.map(r => r.movedPct)), maxN = Math.max(...nw.map(r => r.movedPct));
  const cross = [];
  for (const a of o) for (const b of nw) cross.push(moved(a.B, b.B));
  const maxCross = Math.max(...cross);
  const noise = [];
  if (o.length > 1) noise.push(moved(o[0].B, o[1].B));
  if (nw.length > 1) noise.push(moved(nw[0].B, nw[1].B));
  const ok = maxN <= maxO + SLACK && maxCross <= Math.max(...noise, 0) + SLACK;
  if (!ok) fail++;
  const line = `${pose}: first-vs-settled moved% old [${o.map(r => r.movedPct)}] new [${nw.map(r => r.movedPct)}]; settled old-vs-new [${cross.map(x => +x.toFixed(4))}]; settled same-gate noise [${noise.map(x => +x.toFixed(4))}]  ${ok ? 'PASS' : 'FAIL'}`;
  console.log(line); report.push(line);
}
fs.writeFileSync(path.join(OUT, 'veil-first-frame.json'), JSON.stringify({ settings: { base: BASE, reps: REPS, settleMs: SETTLE, throttle: THROTTLE, gl: GL, tolerance: TOL, slackPct: SLACK, viewport: '1280x800@1' }, rows, report }, null, 1));
console.log(fail ? `FAIL: ${fail} pose(s)` : 'PASS: the first frame after the veil matches the settled city as well as the old gate does');
process.exit(fail ? 1 : 0);
