/**
 * Sample-lattice experiment meter, derived from origin/mac/smooth-edges:moire-bar.mjs.
 * Fixed 16-jitter native-footprint truth; raw RGB error/residual flicker in levels/255.
 * --motion rest: settled poses (upstream behavior).
 * --motion step: consecutive rendered one-pixel camera steps, no settling between.
 * --motion drag: synthetic pointer drag through the actual controls, recorded camera
 * poses replayed consecutively for the candidate; each pose gets independent truth.
 * --fast: truth still waits two rendered frames per shift, rather than two idle events.
 * Every run repeats main and truth to check that those waits are adequate.
 * Quantization lower bound and rounded-display-reference scores are diagnostics;
 * the raw reference/threshold are never replaced. --gate checks selected views only;
 * moire-zero-gate.mjs checks the complete quality/cost/construction evidence packet.
 *
 * --out DIR --views campus-far,west-mid --arms main --q samplelattice=1
 * --xarm 'lattice=window.SampleLattice.set(true);' --motion step --fast
 * --size 960x600 --ss 4 --frames 3 --frames-out
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {runtimeManifest,manifestDigest} from './moire-r2-gate.mjs';
const runtimeSHA256=runtimeManifest(),runtimeManifestSHA256=manifestDigest(runtimeSHA256);

// ---- everything you may want to change is in this block -------------------
let VIEW_W = 960, VIEW_H = 600;         // CSS px (--size); the truth frame is SS x this
const MASK_LEVELS = 8;                  // |hidden - shown| that counts as a building pixel
const REST_MAX = 0.16;                  // --gate: a converged picture's err over building pixels (an 8-bit frame rounds a mean: about 0.1 to 0.2)
const NOT_BUILDING = /^(ground|props|capitol-ground|stadium-field|roofscape)/;
const AUTHORED = 'slopes-mesh';         // the three.js layer that draws the authored buildings
const DAY = 0.2, NIGHT = 1.0;           // time of day (js/timeofday.js: 0 day .. 0.5 sunset .. 1 night)
// name, time of day, camera, and the direction of travel in screen pixels (a sideways drag, or forward along a street)
const VIEWS = [
  { name: 'campus-far',       p: DAY,   center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4, dir: [1, 0] },
  { name: 'west-mid',         p: DAY,   center: [-97.7445, 30.2880],   zoom: 16.6,  pitch: 72, bearing: 300,   dir: [1, 0] },
  { name: 'guad-street',      p: DAY,   center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356,   dir: [0, 1] },
  { name: 'downtown-far',     p: DAY,   center: [-97.7430, 30.2690],   zoom: 16.4,  pitch: 70, bearing: 20,    dir: [1, 0] },
  { name: 'campus-far-night', p: NIGHT, center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4, dir: [1, 0] },
  { name: 'guad-street-night', p: NIGHT, center: [-97.74175, 30.28700], zoom: 18.6, pitch: 82, bearing: 356,   dir: [0, 1] },
  // not in the bar; kept for looking further (--views)
  { name: 'west-near',        p: DAY,   center: [-97.74525, 30.287604], zoom: 18.1, pitch: 55, bearing: 45,    dir: [1, 0] },
  { name: 'drag-mid',         p: DAY,   center: [-97.74155, 30.2876],  zoom: 17.8,  pitch: 70, bearing: 180,   dir: [1, 0] },
  { name: 'west-tower',       p: DAY,   center: [-97.74495, 30.2866],  zoom: 17.9,  pitch: 70, bearing: 205,   dir: [1, 0] },
  { name: 'downtown-night',   p: NIGHT, center: [-97.7430, 30.2690],   zoom: 16.4,  pitch: 70, bearing: 20,    dir: [1, 0] },
  { name: 'spawn-day',        p: 0.12,  center: [-97.7434, 30.2857],   zoom: 16.5,  pitch: 64, bearing: 90,    dir: [1, 0] },
];
const BAR = ['campus-far', 'west-mid', 'guad-street', 'downtown-far', 'campus-far-night', 'guad-street-night'];
// An arm: the page state (run before every picture of that arm) and whose truth it is held to.
const FT = on => `window.FrameTarget?.setRest(${on[1]}); window.FrameTarget?.setSmooth(${on[0]}); window.SampleLattice?.set(false);`;
const ARMS = {
  main:     { js: FT([false, false]), truth: 'main' },
  calm: {js:'window.CalmFar.enabled=true;window.FrameTarget?.setRest(false);window.FrameTarget?.setSmooth(false);',truth:'main'},
  calmrest: {js:'window.FrameTarget?.setRest(true);window.FrameTarget?.setSmooth(false);',truth:'main',rest:true},
  msaa:     { js: FT([true, false]),  truth: 'msaa' },
  rest:     { js: FT([false, true]),  truth: 'main', rest: true },
  restmsaa: { js: FT([true, true]),   truth: 'msaa', rest: true },
  fix:      { js: FT([false, false]) + 'window.MoireFix.reset(); window.MoireFix.set("on")',   truth: 'main' },
  flat:     { js: FT([false, false]) + 'window.MoireFix.reset(); window.MoireFix.set("flat")', truth: 'flat' },
};
// ----------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', process.env.VERIFY_OUT || null);
if (!OUT) { console.error('usage: moire-bar.mjs --out <dir> [--views a,b] [--arms main,msaa,rest,restmsaa] [--size WxH] [--ss 4] [--frames 6]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
{ const sz = opt('--size', null); if (sz) [VIEW_W, VIEW_H] = sz.split('x').map(Number); }
const SS = +opt('--ss', '4'), FRAMES = +opt('--frames', '6'), STEP_PX = +opt('--step', '1');
const MOTION = opt('--motion', 'rest'), FAST = argv.includes('--fast'), FREEZE = argv.includes('--freeze-truth');
const TRUTH = opt('--truth', 'jitter');   // 'jitter' (default) or 'scale' (one frame at SS x the pixels: shader fades that read the pixel size then differ from the 1x picture)
const FRAMES_OUT = argv.includes('--frames-out'), GATE = argv.includes('--gate'), RAW = argv.includes('--raw-truth'), REF = opt('--reference-in', '');
const QS = (opt('--q','')||'').split(',').filter(Boolean).concat(['intro=0', 'drift=0', 'namelabels=0', 'facadepace=0', 'timeofdaypace=0', 'smooth=0', 'restaccum=0']   // the arms flip Smooth edges and the accumulation inside the page
  );
// --xarm "name=js" (repeatable): one more arm, held to main's truth, whose page state is that JavaScript (for tuning a parameter inside one page load)
for (let i = 0; i < argv.length; i++) if (argv[i] === '--xarm') { const a = argv[i + 1], k = a.indexOf('='); ARMS[a.slice(0, k)] = { js: a.slice(k + 1), truth: 'main', extra: true }; }
const armNames = (opt('--arms', 'main')).split(',').filter(Boolean).concat(Object.keys(ARMS).filter(k => ARMS[k].extra));
const REPEAT = !argv.includes('--no-repeat') && !QS.some(x=>/^detailcut=(faces|fins|rails)$/.test(x));   // the second shot of main (the noise); off only for a tuning run
for (const a of armNames) if (!ARMS[a]) { console.error('unknown arm ' + a); process.exit(2); }
if (!armNames.includes('main')) { console.error('the main arm is the reference; it must be in --arms'); process.exit(2); }
const want = (opt('--views', '') || '').split(',').filter(Boolean);
const list = (want.length ? want : BAR).map(n => { const v = VIEWS.find(v => v.name === n); if (!v) { console.error('unknown view ' + n); process.exit(2); } return v; });

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(cfg => {
  const probe=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(probe);}},20);
  try {
    const K = 'austin3d.gfx.v1', cur = JSON.parse(localStorage.getItem(K) || '{}');
    cur.autoDetected = true; cur.autoExposure = false;
    localStorage.setItem(K, JSON.stringify(cur));
  } catch (e) {}
});
const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
await page.goto(`${opt('--base',BASE)}/_harness.html?${QS.join('&')}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
page.on('console', m => { if (m.type() === 'error') { errs.push('console: ' + m.text().slice(0, 200)); if(errs.length<12) console.error('[page] '+m.text().slice(0,500)); } });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 });
// The style being loaded is not the page being ready: the app is still booting (it sets its own time of day, adds the buildings' name layers,
// builds the authored buildings) and a meter that starts now races it. Measured: a warm second load started 2 s in and scored a SUNSET city
// with labels as "campus by day". Wait for the veil to go and the authored buildings to be built, then one more quiet second.
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 420000, polling: 500 });
await page.waitForFunction(() => { const A = window.slopesApartments; return !A || !!(A.count.done && A.group); }, null, { timeout: 420000, polling: 500 });
if(QS.includes('calm=1'))await page.evaluate(async()=>{await window.Calm.ready;});
if(QS.includes('samplecompact=1'))await page.waitForFunction(()=>window.MoireRuntime?.stats.phase==='ready',null,{timeout:240000});
await page.waitForTimeout(1500);
await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false; });
console.error(`[bar] style loaded ${T()}`);

// ---- the in-page instrument ------------------------------------------------
await page.evaluate(({ SS, MASK_LEVELS, NOT_BUILDING, AUTHORED, STEP_PX, TRUTH, MOTION, FAST, FREEZE, RAW, REF }) => {
  const m = window.__map;
  let frozen=false;
  const nativeJump=m.jumpTo, nativeRoll=m.setRoll;
  m.jumpTo=function(p,e){if(frozen&&e?.fly)return this;return nativeJump.call(this,p,e);};
  if(nativeRoll)m.setRoll=function(v,e){if(frozen)return this;return nativeRoll.call(this,v,e);};
  async function frame(){await new Promise(r=>{m.once('render',r);m.triggerRepaint();});}
  async function sample(){await frame();await frame();}
  const quiet = () => {
    const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count, L = window.CityLighting && window.CityLighting.stats;
    return !(P && P.busy) && !(A && !A.done) && !(L && L.shadowProxyBuilding);
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let slow = 0;
  async function settle(extra) {                    // walls stamped, buildings built, shadows built, map idle - twice
    if (extra) await sleep(extra);
    for (let k = 0; k < 2; k++) {
      const t = Date.now();
      while (!quiet() && Date.now() - t < 120000) await sleep(100);
      await new Promise(r => { const to = setTimeout(() => { slow++; r(); }, 20000); m.once('idle', () => { clearTimeout(to); r(); }); m.triggerRepaint(); });
      await sleep(60);
    }
    // the accumulation on: the picture is final once the cycle is done (idle is held back until then; this is the belt to that)
    const F = window.FrameTarget;
    if (F && F.REST.on) { const t = Date.now(); while (F.state() !== 'done' && Date.now() - t < 20000) await sleep(50); if (F.state() !== 'done') notDone++; }
  }
  let notDone = 0;
  async function setScale(s) { if (window.GFX.renderScale !== s) { window.GFX.renderScale = s; window.applyGraphics(); } await settle(); }
  const cv2 = document.createElement('canvas'), cx2 = cv2.getContext('2d', { willReadFrequently: true });
  function grab() {
    const c = m.getCanvas(); cv2.width = c.width; cv2.height = c.height;
    cx2.drawImage(c, 0, 0);
    return { w: c.width, h: c.height, d: cx2.getImageData(0, 0, c.width, c.height).data };
  }
  function rgb(g) { const N = g.w * g.h, o = new Float32Array(N * 3); for (let p = 0, i = 0, k = 0; p < N; p++, i += 4, k += 3) { o[k] = g.d[i]; o[k + 1] = g.d[i + 1]; o[k + 2] = g.d[i + 2]; } return o; }
  function box(big, w, h) {                         // SS x SS box filter -> Float32 RGB at w x h
    const out = new Float32Array(w * h * 3), W = big.w, k = 1 / (SS * SS);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < SS; j++) { let i = ((y * SS + j) * W + x * SS) * 4; for (let q = 0; q < SS; q++, i += 4) { r += big.d[i]; g += big.d[i + 1]; b += big.d[i + 2]; } }
      const o = (y * w + x) * 3; out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
    }
    return out;
  }
  const hideIds = () => m.getLayersOrder().filter(id => { const l = m.getLayer(id); return l && l.type === 'fill-extrusion' && !new RegExp(NOT_BUILDING).test(id); });
  async function withHidden(ids, fn) {
    const prev = ids.map(id => [id, m.getLayoutProperty(id, 'visibility')]);
    for (const id of ids) m.setLayoutProperty(id, 'visibility', 'none');
    await settle(300);
    try { return await fn(); } finally { for (const [id, v] of prev) m.setLayoutProperty(id, 'visibility', v || 'visible'); await settle(300); }
  }
  const png = (rgb3, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const im = x.createImageData(w, h);
    for (let p = 0, o = 0, i = 0; p < w * h; p++, o += 3, i += 4) { im.data[i] = rgb3[o]; im.data[i + 1] = rgb3[o + 1]; im.data[i + 2] = rgb3[o + 2]; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return c.toDataURL('image/png'); };
  const run = async js => { if (js) await new (Object.getPrototypeOf(async function () {}).constructor)('m', js)(m); };

  window.__bar = async function (v, frames, arms, framesOut, repeat) {
    m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    if (window.applyTimeOfDay) window.applyTimeOfDay(m, v.p, true);
    // Text is not a wall: a label over a building is "building pixels" to the mask, its letters would be scored as error, and labels fade in and
    // out as the camera moves. Hide every symbol layer, at every view (the building generators add theirs after the style has loaded).
    for (const id of m.getLayersOrder()) { const l = m.getLayer(id); if (l && l.type === 'symbol' && m.getLayoutProperty(id, 'visibility') !== 'none') m.setLayoutProperty(id, 'visibility', 'none'); }
    await run(arms[0].js);
    await setScale(1); await settle(800);
    const W = m.getCanvas().width, H = m.getCanvas().height, N = W * H;
    // -- which pixels are buildings, and whose --
    const shown = grab().d;
    const diffMask = hid => { const f = new Uint8Array(N); for (let p = 0, i = 0; p < N; p++, i += 4) f[p] = (Math.abs(hid[i] - shown[i]) + Math.abs(hid[i + 1] - shown[i + 1]) + Math.abs(hid[i + 2] - shown[i + 2])) / 3 > MASK_LEVELS ? 1 : 0; return f; };
    const mA = m.getLayer(AUTHORED) ? await withHidden([AUTHORED], async () => diffMask(grab().d)) : new Uint8Array(N);
    const mB = await withHidden(hideIds(), async () => diffMask(grab().d));
    const src = new Uint8Array(N);                  // 1 = authored, 2 = maplibre walls, 0 = not a building
    // one pixel of margin: the camera moves `frames` pixels, and a pixel must be a building in every frame's neighbourhood to be worth scoring
    for (let p = 0; p < N; p++) src[p] = mA[p] ? 1 : mB[p] ? 2 : 0;
    // every camera position is worked out NOW, from the view's own centre: unproject() answers for the camera of the moment
    m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    const c0 = m.project(v.center), cams = [];
    for (let f = 0; f < frames; f++) cams.push(m.unproject([c0.x + f * STEP_PX * v.dir[0], c0.y + f * STEP_PX * v.dir[1]]));
    let poses=cams.map(c=>({center:c,zoom:v.zoom,pitch:v.pitch,bearing:v.bearing,roll:0}));
    const reference=REF?await fetch(REF+'/bar.json').then(r=>r.json()):null;
    const referenceRow=reference?.rows.find(r=>r.name===v.name);
    if(REF&&MOTION==='drag'){
      if(reference.motion!=='drag'||!referenceRow?.poses||referenceRow.poses.length<frames)throw Error('recorded main pointer path missing');
      poses=referenceRow.poses.slice(0,frames);
    }
    const poseAt=f=>poses[f];
    const recordPose=()=>({center:m.getCenter().toArray(),zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing(),roll:m.getRoll?.()||0});
    // -- the pictures: [arm][frame] 1x, and the truth of every arm that is somebody's truth --
    const truthOf = REF?[]:[...new Set(arms.map(a => a.truth))];
    const one = {}, tru = {}, shots = {};
    for (const a of arms) one[a.name] = [];
    for (const t of truthOf) tru[t] = [];
    const armBy = Object.fromEntries(arms.map(a => [a.name, a]));
    async function pass(list1, listT, into1, intoT) {
      for (let f = 0; f < frames; f++) {
        m.jumpTo(poseAt(f));
        await setScale(1); await settle(350);
        for (const a of list1) { await run(armBy[a].js); await settle(); into1[a].push(rgb(grab())); }
        if (TRUTH === 'scale') {
          await setScale(SS);
          for (const t of listT) { await run(armBy[t].js); await settle(); const big = grab(); if (big.w !== W * SS || big.h !== H * SS) throw new Error(`truth canvas ${big.w}x${big.h}, wanted ${W * SS}x${H * SS}`); intoT[t].push(box(big, W, H)); }
        } else {
          // SS x SS pictures at THIS resolution, the lens shifted by a fraction of a pixel each time (map padding moves the principal point:
          // an exact translation of the picture at every depth), and averaged. The samples sit where a SS-times-larger frame's pixel centres sit.
          for (const t of listT) {
            await run(armBy[t].js);
            const acc = new Float32Array(N * 3);
            for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
              const dx = (i + 0.5) / SS - 0.5, dy = (j + 0.5) / SS - 0.5;
              m.setPadding({ left: dx > 0 ? 2 * dx : 0, right: dx < 0 ? -2 * dx : 0, top: dy > 0 ? 2 * dy : 0, bottom: dy < 0 ? -2 * dy : 0 });
              if(FAST)await sample();else await settle();
              const g = grab().d; for (let p = 0, q = 0, o = 0; p < N; p++, q += 4, o += 3) { acc[o] += g[q]; acc[o + 1] += g[q + 1]; acc[o + 2] += g[q + 2]; }
            }
            m.setPadding({ left: 0, right: 0, top: 0, bottom: 0 }); await settle();
            const k = 1 / (SS * SS); for (let o = 0; o < acc.length; o++) acc[o] *= k;
            intoT[t].push(acc);
          }
        }
        await run(arms[0].js);
      }
      await setScale(1);
    }
    async function sequence(a, into, liveDrag=false) {
      frozen=false;
      m.jumpTo(poseAt(0));await run(armBy[a].js);await settle(500);
      const c=m.getCanvas(),times=[];
      const pointer=(type,x,dx=0)=>c.dispatchEvent(new PointerEvent(type,{pointerId:77,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:200,movementX:dx,movementY:0,bubbles:true,cancelable:true}));
      if(liveDrag){pointer('pointerdown',300);poses=[];}else frozen=true;
      let prev=performance.now();
      for(let f=0;f<frames;f++) {
        if(liveDrag)pointer('pointermove',302+f*2,2);else m.jumpTo(poseAt(f));
        await frame();
        into[a].push(rgb(grab()));
        const now=performance.now();times.push(now-prev);prev=now;
        if(liveDrag)poses.push(recordPose());
      }
      if(liveDrag){pointer('pointerup',302+frames*2);window.dispatchEvent(new Event('blur'));}
      frozen=true;
      return times;
    }
    const motionTimes={};
    if(MOTION==='rest')await pass(arms.map(a=>a.name),truthOf,one,tru);
    else {
      if(FREEZE){
        motionTimes.main=await sequence('main',one,MOTION==='drag'&&!REF);
        await pass([],truthOf,one,tru);
        for(const a of arms)if(a.name!=='main')motionTimes[a.name]=await sequence(a.name,one,false);
      }else{
        for(const a of arms)motionTimes[a.name]=await sequence(a.name,one,MOTION==='drag'&&!REF&&a.name==='main');
        await pass([],truthOf,one,tru);
      }
    }
    if(REF){
      const row=referenceRow;
      if(!row||row.canvas[0]!==W||row.canvas[1]!==H||reference.ss!==SS)throw Error('frozen truth dimensions/view mismatch');
      for(let f=0;f<frames;f++){
        const expected=row.poses[Math.min(f,row.poses.length-1)],actual=poses[f];
        const center=c=>Array.isArray(c)?c:[c.lng,c.lat];
        if(Math.abs(expected.zoom-actual.zoom)>1e-7||Math.abs(expected.pitch-actual.pitch)>1e-7||Math.abs(expected.bearing-actual.bearing)>1e-7||center(expected.center).some((v,i)=>Math.abs(v-center(actual.center)[i])>1e-9))throw Error('frozen truth camera mismatch');
      }
      tru.main=await Promise.all(Array.from({length:frames},(_,f)=>fetch(REF+'/'+v.name+'.truth-'+f+'.f32').then(r=>{if(!r.ok)throw Error('frozen truth missing');return r.arrayBuffer();}).then(b=>{if(b.byteLength!==N*3*4)throw Error('frozen truth length');return new Float32Array(b);} )));
      const img=await new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=REF+'/'+v.name+'.mask.png';});
      cv2.width=W;cv2.height=H;cx2.drawImage(img,0,0);const mask=cx2.getImageData(0,0,W,H).data;
      for(let p=0;p<N;p++)src[p]=mask[p*4]>128?1:mask[p*4+1]>128?2:0;
    }
    // -- the second shot of main, for the noise --
    let one2 = { main: [] }, tru2 = { main: [] };
    if(repeat){
      if(MOTION==='rest'){await pass(['main'],REF?[]:['main'],one2,tru2);if(REF)tru2.main=tru.main;}
      else {await sequence('main',one2);if(REF)tru2.main=tru.main;else await pass([],['main'],one2,tru2);}
    } else {one2=one;tru2=tru;}
    frozen=false;
    const st = window.slopes && window.slopes.stats ? window.slopes.stats() : null;
    // -- scores --
    const inner = p => { const x = p % W; return x >= 1 && x <= W - 2 && p >= W && p < N - W; };
    function score(O, Tr, sel) {
      let n = 0, sErr = 0, sFl = 0, sBias = 0;
      for (let p = 0; p < N; p++) {
        if (!sel(p) || !inner(p)) continue;
        n++; const o = p * 3;
        let pe0 = 0, pe1 = 0, pe2 = 0;
        for (let f = 0; f < frames; f++) {
          const e0 = O[f][o] - Tr[f][o], e1 = O[f][o + 1] - Tr[f][o + 1], e2 = O[f][o + 2] - Tr[f][o + 2];
          sErr += (Math.abs(e0) + Math.abs(e1) + Math.abs(e2)) / 3; sBias += (e0 + e1 + e2) / 3;
          if (f) sFl += (Math.abs(e0 - pe0) + Math.abs(e1 - pe1) + Math.abs(e2 - pe2)) / 3;
          pe0 = e0; pe1 = e1; pe2 = e2;
        }
      }
      return { n, err: n ? sErr / (n * frames) : 0, flicker: n && frames > 1 ? sFl / (n * (frames - 1)) : 0, bias: n ? sBias / (n * frames) : 0 };
    }
    const diffPx = (A, B, sel) => { let n = 0, s = 0; for (let p = 0; p < N; p++) { if (!sel(p) || !inner(p)) continue; n++; const o = p * 3; for (let f = 0; f < frames; f++) s += (Math.abs(A[f][o] - B[f][o]) + Math.abs(A[f][o + 1] - B[f][o + 1]) + Math.abs(A[f][o + 2] - B[f][o + 2])) / 3; } return n ? s / (n * frames) : 0; };
    const sels = { all: p => src[p] > 0, apt: p => src[p] === 1, mpl: p => src[p] === 2 };
    const res = { calm:window.Calm?{phase:window.Calm.stats.phase,far:window.CalmFar?.stats,rest:window.FrameTarget?.stats,state:window.FrameTarget?.state()}:null, name: v.name, motion: MOTION, motionTimes, poses, canvas: [W, H], slow, notDone, detailCut:window.DetailCut, draw: st ? { tris: st.triangles, calls: st.calls } : null, share: {}, arms: {}, noise: {}, png: {} };
    for (const k in sels) { let n = 0; for (let p = 0; p < N; p++) if (sels[k](p)) n++; res.share[k] = n / N; }
    for (const a of arms) { res.arms[a.name] = {}; for (const k in sels) res.arms[a.name][k] = score(one[a.name], tru[a.truth], sels[k]); }
    for (const k in sels) {
      const a = score(one.main, tru.main, sels[k]), b = score(one2.main, tru2.main, sels[k]);
      res.noise[k] = { err: Math.abs(a.err - b.err), flicker: Math.abs(a.flicker - b.flicker), bias: Math.abs(a.bias - b.bias), px: diffPx(one.main, one2.main, sels[k]), truthPx: diffPx(tru.main, tru2.main, sels[k]), second: b };
    }
    // Quantization lower bounds, independent of any proposed renderer.
    // O[f+1]-O[f] is integer in an 8-bit capture, so residual change cannot be
    // smaller than distance(truth[f+1]-truth[f], nearest integer), per channel.
    res.quantization = {};
    const oracle = tru.main.map(t => Float32Array.from(t, x => Math.round(x)));
    for (const k in sels) {
      let n = 0, least = 0;
      for (let p = 0; p < N; p++) if (sels[k](p) && inner(p)) {
        n++;
        for (let f = 1; f < frames; f++) for (let c = 0; c < 3; c++) {
          const d = tru.main[f][p*3+c] - tru.main[f-1][p*3+c];
          least += Math.abs(d - Math.round(d));
        }
      }
      res.quantization[k] = { roundedTruth: score(oracle, tru.main, sels[k]),
        absoluteFlickerLowerBound: frames > 1 && n ? least/(3*n*(frames-1)) : 0 };
    }
    res.displayReference={};
    for(const a of arms)res.displayReference[a.name]=score(one[a.name],oracle,sels.all);
    // -- mean colour of the building pixels, per arm (frame 0): the far-mean check --
    for (const a of arms) { let n = 0, s = 0; const O = one[a.name][0]; for (let p = 0; p < N; p++) if (src[p] && inner(p)) { n++; s += (O[p * 3] + O[p * 3 + 1] + O[p * 3 + 2]) / 3; } res.arms[a.name].meanLevel = n ? s / n : 0; }
    { let n = 0, s = 0; const O = tru.main[0]; for (let p = 0; p < N; p++) if (src[p] && inner(p)) { n++; s += (O[p * 3] + O[p * 3 + 1] + O[p * 3 + 2]) / 3; } res.truthMeanLevel = n ? s / n : 0; }
    for (const a of arms) res.png[a.name] = framesOut ? one[a.name].map(o => png(o, W, H)) : [png(one[a.name][0], W, H)];
    for (const t of truthOf) res.png['truth-' + t] = [png(tru[t][0], W, H)];
    res.png.mask = [png((() => { const o = new Uint8ClampedArray(N * 3); for (let p = 0, k = 0; p < N; p++, k += 3) { o[k] = src[p] === 1 ? 255 : 0; o[k + 1] = src[p] === 2 ? 255 : 0; o[k + 2] = src[p] ? 0 : 60; } return o; })(), W, H)];
    if(RAW){
      res.rawTruth=[];
      for(const frame of tru.main)res.rawTruth.push(await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(new Blob([frame.buffer]));}));
    }
    return res;
  };
}, { SS, MASK_LEVELS, NOT_BUILDING: NOT_BUILDING.source, AUTHORED, STEP_PX, TRUTH, MOTION, FAST, FREEZE, RAW, REF: REF?new URL(REF+'/',BASE+'/').href.replace(/\/$/,''):'' });

const arms = armNames.map(n => ({ name: n, ...ARMS[n] }));
const rows = [];
for (const v of list) {
  const tv = Date.now();
  let r;
  try { r = await page.evaluate(([v, n, arms, fo, rp]) => window.__bar(v, n, arms, fo, rp), [v, FRAMES, arms, FRAMES_OUT, REPEAT]); }
  catch (e) { console.error(`[bar] ${v.name} FAILED: ${String(e.message || e).slice(0, 400)}`); rows.push({ name: v.name, failed: String(e.message || e).slice(0, 400) }); continue; }
  if (r.quantization) console.error('[bar] quantization ' + JSON.stringify(r.quantization.all));
  for (const k in r.png) r.png[k].forEach((u, i) => fs.writeFileSync(path.join(OUT, `${v.name}.${k}${r.png[k].length > 1 ? '.' + String(i).padStart(2, '0') : ''}.png`), Buffer.from(u.split(',')[1], 'base64')));
  if(r.rawTruth){r.rawTruth.forEach((b,f)=>fs.writeFileSync(path.join(OUT,`${v.name}.truth-${f}.f32`),Buffer.from(b,'base64')));delete r.rawTruth;}
  delete r.png; rows.push(r);
  fs.writeFileSync(path.join(OUT,'partial.json'),JSON.stringify({size:[VIEW_W,VIEW_H],ss:SS,frames:FRAMES,motion:MOTION,fast:FAST,rows},null,1));
  console.error('[bar] display-reference '+JSON.stringify(r.displayReference));
  const s = a => r.arms[a] ? `${a} ${r.arms[a].all.err.toFixed(2)}/${r.arms[a].all.flicker.toFixed(2)}` : '';
  console.error(`[bar] ${v.name} ${((Date.now() - tv) / 1000).toFixed(0)}s bldg ${(r.share.all * 100).toFixed(0)}% (authored ${(r.share.apt * 100).toFixed(0)}%)  ${armNames.map(s).join('  ')}  noise ${r.noise.all.err.toFixed(3)}/${r.noise.all.flicker.toFixed(3)} px ${r.noise.all.px.toFixed(3)}${r.slow ? '  SLOW-IDLE x' + r.slow : ''}`);
}

// ---- the table ---------------------------------------------------------------
const f2 = x => x.toFixed(2), f3 = x => x.toFixed(3), pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
const ctx = await page.evaluate(() => { const gl = window.__map.painter.context.gl; const e = gl.getExtension('WEBGL_debug_renderer_info'); const F = window.FrameTarget;
  return { own: !!(F && F.own()), samples: F && F.own() ? Math.min(F.SMOOTH.samples, gl.getParameter(gl.MAX_SAMPLES)) : gl.getParameter(gl.SAMPLES), ctxAA: gl.getContextAttributes().antialias, count: F ? F.REST.count : 0, stats: F ? F.stats : null,
    renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', lattice: window.SampleLattice?.stats, regions:window.MeshRegions?.stats,daySpecialize:window.DaySpecialize?.stats,fix: window.MoireFix ? window.MoireFix.info() : null, failures: (window.CityLighting && window.CityLighting.stats.failures) || [] }; });
const lines = [];
lines.push(`moire-bar  ${VIEW_W}x${VIEW_H} truth=${TRUTH} ss=${SS} frames=${FRAMES} step=${STEP_PX}px  arms=${armNames.join(',')}  smooth edges: ${ctx.own ? 'own target, ' + ctx.samples + ' samples' : 'context antialias=' + ctx.ctxAA}  rest shifts=${ctx.count}  renderer=${ctx.renderer}`);
lines.push(`levels of 255 over building pixels. err = mean |1x - 4x4 truth|; flicker = mean |e(f+1) - e(f)|; noise = second shot of main against the first. A rest arm is the converged picture of a still camera: read its err.`);
let allAt = true;
for (const who of ['all', 'apt', 'mpl']) {
  lines.push('');
  lines.push(who === 'all' ? 'ALL BUILDING PIXELS' : who === 'apt' ? 'AUTHORED BUILDINGS ONLY (three.js)' : 'MAPLIBRE PATTERN WALLS ONLY');
  lines.push(pad('view', 20) + lp('px%', 5) + ' |' + armNames.map(a => lp(a, 9)).join('') + lp('noise', 8) + ' |' + armNames.map(a => lp(a, 9)).join('') + lp('noise', 8) + ' |' + armNames.map(a => lp(a, 9)).join(''));
  lines.push(pad('', 20) + lp('', 5) + ' |' + pad('  ERROR', 9 * armNames.length + 8) + ' |' + pad('  FLICKER', 9 * armNames.length + 8) + ' |  BIAS');
  for (const r of rows) {
    if (r.failed) { lines.push(pad(r.name, 20) + ' FAILED ' + r.failed); allAt = false; continue; }
    const g = (a, k) => r.arms[a][who][k], nz = r.noise[who];
    if (who === 'all') {
      const candidates=armNames.filter(a=>a!=='main');
      if(!candidates.length)allAt=false;
      for(const a of candidates)if(!(g(a,'err')<=REST_MAX&&g(a,'flicker')<=REST_MAX))allAt=false;
      if(r.noise.all.px>.01||r.noise.all.truthPx>.01||!r.arms.main.all.n)allAt=false;
    }
    if (r.notDone) allAt = false;
    lines.push(pad(r.name, 20) + lp((r.share[who] * 100).toFixed(0), 5) + ' |' + armNames.map(a => lp(f2(g(a, 'err')), 9)).join('') + lp(f3(nz.err), 8) + ' |' + armNames.map(a => lp(f2(g(a, 'flicker')), 9)).join('') + lp(f3(nz.flicker), 8) + ' |' + armNames.map(a => lp(f2(g(a, 'bias')), 9)).join(''));
  }
}
lines.push('');
lines.push('NOISE DETAIL (all building pixels): px = mean |1x second - 1x first|, truthPx the same for the truth; meanLevel = mean brightness of building pixels at frame 0');
for (const r of rows) if (!r.failed) lines.push(pad(r.name, 20) + ` px ${f3(r.noise.all.px)}  truthPx ${f3(r.noise.all.truthPx)}  second main ${f2(r.noise.all.second.err)}/${f2(r.noise.all.second.flicker)}  meanLevel truth ${f2(r.truthMeanLevel)} ${armNames.map(a => a + ' ' + f2(r.arms[a].meanLevel)).join(' ')}  tris ${r.draw ? r.draw.tris : '-'}${r.slow ? '  slow-idle ' + r.slow : ''}${r.notDone ? '  NOT-CONVERGED x' + r.notDone : ''}`);
if (ctx.lattice) lines.push('sample lattice: '+JSON.stringify(ctx.lattice));
if (ctx.stats) lines.push('frame target: ' + JSON.stringify(ctx.stats));
if (ctx.fix) lines.push('fix: ' + JSON.stringify(ctx.fix));
if(ctx.failures.length||errs.length)allAt=false;
if (ctx.failures.length) lines.push('SHADER FAILURES: ' + JSON.stringify(ctx.failures).slice(0, 600));
if (errs.length) lines.push('PAGE ERRORS: ' + [...new Set(errs)].slice(0, 6).join(' | '));
const text = lines.join('\n');
console.log(text);
fs.writeFileSync(path.join(OUT, 'bar.txt'), text + '\n');
fs.writeFileSync(path.join(OUT, 'bar.json'), JSON.stringify({ runtimeSHA256,runtimeManifestSHA256,own: ctx.own, samples: ctx.samples, renderer: ctx.renderer, size: [VIEW_W, VIEW_H], ss: SS, frames: FRAMES, step: STEP_PX, q: QS, motion: MOTION, reference: REF||null, fast: FAST, arms: armNames, lattice: ctx.lattice, regions:ctx.regions,daySpecialize:ctx.daySpecialize,fix: ctx.fix, errors: errs, shaderFailures:ctx.failures, rows }, null, 1));
await browser.__done();
process.exit(GATE && !allAt ? 1 : 0);
