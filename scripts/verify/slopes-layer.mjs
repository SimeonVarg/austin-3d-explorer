/**
 * slopes-layer.mjs — the three.js layer behaves like the fill-extrusion beside it.
 *
 * js/slopes.js draws real angled geometry inside MapLibre's frame. Before any
 * generator lands on it, this proves — from pixels, on the real page — that a
 * mesh in that layer is treated exactly like a building: same hour, same sun,
 * same depth buffer, same haze, same render-distance rule, and that the whole
 * thing switches off to a frame identical to the one it was never in.
 *
 * Every assertion is RELATIVE — mesh against a fill-extrusion twin in the same
 * frame, on against off — never an absolute hex, so it runs on the real GPU
 * (the default here) where exact hex would not survive a driver update. Set
 * VERIFY_GL=swiftshader to run it on the software rasteriser instead.
 *
 * What it asserts (numbers from the first run, RTX 3050 Ti, 2026-09-02):
 *
 *   switch    ?slopes=0 leaves no layer, no renderer, no frame. SLOPES.on =
 *             false at runtime: 0 of 1,296,000 mall-cruise pixels differ.
 *             ?slopes=0 against a git-archive of main served from a second
 *             port: 1 pixel, Δ1. The empty layer ON against ?slopes=0, two
 *             page LOADS: 3,100 pixels beyond Δ2 (40 beyond Δ20), all in one
 *             band 100-200 px from the top across the full width — the far
 *             field, where nothing of this layer draws. NOT explained on the
 *             first day; far-tile detail between loads is the suspect. That
 *             line is red until someone proves what it is.
 *   stack     slopes-mesh sits before aerial-fog; only the sky compositor and
 *             the labels sit above the fog.
 *   frame     slopes.project(slopes.toLocal(lng, lat)) lands on map.project
 *             to 0.00 px at three points across campus and the Capitol.
 *   light     the ENU light vector is skyBodies(p).sun to 1e-15, at the
 *             light's own radial.
 *   hour      a 16 m mesh cube and a fill-extrusion twin of the same baked
 *             colour on the South Mall lawn: top, south and west faces equal
 *             to the unit at golden hour, within 3/255 at morning and night;
 *             the mesh top gets darker morning → golden → night.
 *   depth     a slab behind the Tower: the Tower's pixel is identical with
 *             the layer on and off; from the north the same slab is visible.
 *             A slab in front of the Tower changes the Tower's pixel.
 *   haze      a mesh post and an extrusion post 2.5 km out: identical with
 *             the fog on (175,108,60) and off (153,87,46); the fog moves both.
 *   lod       at ~800 m with render distance 700 the mesh is hidden with
 *             roofs-pitched (LOD_isHidden, and its pixel is the ground);
 *             at the slider's top it is back. LOD IS PER GROUP: the custom
 *             layer's layout visibility stays 'visible' at every altitude
 *             (lod.js never writes it), render() keeps running, the roofs
 *             group goes and the Capitol dome group stays. Asserting
 *             visibility 'none' here was the old contract and it is gone —
 *             a hidden custom layer's render() is never called, which took
 *             the dome off the skyline with the roofs on 2026-09-02.
 *   preset    GFX.preset = 'performance' halves slopes.detail(); the debug
 *             lathe rebuilds at half its segments.
 *   raycast   slopes.raycast() at the cube's top centre hits it at 16.00 m;
 *             at the sky it returns null.
 *
 * With the generators (js/slopes-roofs.js, -arches.js, -dome.js) drawing:
 *
 *   built     112 roofs + Gregory Gym's gable, 24 arched entrances and the
 *             three dome parts are in the scene; roofs-pitched shows only the
 *             `f` tags it keeps, entrances-portal/glass exclude `arc`, and
 *             capitol-dome excludes the three lathed parts; SLOPES.on = false
 *             puts all three filters back to what they were.
 *   ridge     at the gregory pose, on the hipped roof nearest the frame's
 *             centre whose two long slopes the light tells apart most: the
 *             slopes read as two tones either side of the ridge (pixels), each
 *             slope is one tone along its length (pixels), and a raycast down
 *             the slope climbs continuously at the rig's own pitch — a
 *             staircase would plateau.
 *   arch      at the battle-street pose, on the arched door nearest the
 *             frame's centre: six raycasts along the surround's curve all hit
 *             the arches mesh within 10 cm of the ellipse, the six pixels are
 *             one tone and lighter than the fanlight glass inside, and the
 *             frame differs from the chord frame where the arch is. The same
 *             door from 22 m (`battle-door`), where the curve is 300 px wide,
 *             is the frame worth looking at.
 *
 * --break moves the layer to the END of the style, above the fog — inside the
 * page only — and the stack and haze assertions must go red. Use it before
 * trusting a green.
 *
 * Usage (from scripts/verify, README's way):
 *   VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs [--shots DIR] [--break] [--against URL]
 *
 *   --shots DIR     save the proof frames (never into the repo; the scratchpad)
 *   --against URL   a second server (e.g. a pristine main export) whose
 *                   mall-cruise frame the ?slopes=0 frame must equal
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import { diffPNG } from './lib/png.mjs';

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const BREAK = argv.includes('--break');
const SHOTS = arg('--shots');
const AGAINST = arg('--against');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const W = 1440, H = 900;
const TOWER = [-97.7393587, 30.2860098];
// js/controls.js's own altitude formula, inverted: zoom for an altitude at a pitch.
const zoomFor = (alt, pitch, lat) => {
  const camPx = 0.5 * H / Math.tan(29 * Math.PI / 180);
  const mpp = alt / (Math.cos(pitch * Math.PI / 180) * camPx);
  return Math.log2(40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * mpp));
};

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); };
const rgb = v => v ? v.join(',') : 'null';
const maxd = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 1500000 });   // three page loads and twelve poses: ~15 min
const errors = [];
async function open(url) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => {
    const m = window.__map;
    return m.getSource('austin-buildings') && m.getLayer('buildings-3d') && m.getLayer('aerial-fog');
  }, null, { timeout: 180000 });
  await page.evaluate(() => {
    // Average RGB in a (2R+1)² box around CSS points, read INSIDE the render
    // event so the drawing buffer is still there without preserveDrawingBuffer.
    window.__sample = (pts, R) => new Promise(res => {
      const m = window.__map, cv = m.getCanvas(); const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      m.once('render', () => {
        const dpr = cv.width / cv.clientWidth; R = R == null ? 2 : R;
        res(pts.map(([x, y]) => {
          const px = Math.round(x * dpr), py = Math.round((cv.clientHeight - y) * dpr); const n = 2 * R + 1;
          const buf = new Uint8Array(n * n * 4); gl.readPixels(px - R, py - R, n, n, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          const s = [0, 0, 0]; for (let i = 0; i < buf.length; i += 4) { s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; }
          return s.map(v => Math.round(v / (n * n)));
        }));
      });
      m.triggerRepaint();
    });
    // 'idle' raced against a cap: a map that is already idle never fires it.
    window.__settle = ms => new Promise(r => { const m = window.__map; const t = setTimeout(r, ms || 8000); m.once('idle', () => { clearTimeout(t); r(); }); });
  });
  return page;
}
async function pose(page, center, zoom, pitch, bearing) {
  await page.evaluate(o => window.__map.jumpTo(o), { center, zoom, pitch, bearing });
  await page.evaluate(() => window.__settle());
  await page.waitForTimeout(700);
}
async function shot(page, name) {
  if (!SHOTS) return;
  const f = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: f }); await page.waitForTimeout(250); await page.screenshot({ path: f });
  console.log('   shot', f);
}
const scr = (page, x, y, z) => page.evaluate(([x, y, z]) => { const p = window.slopes.project(x, y, z); return p && [Math.round(p.x), Math.round(p.y)]; }, [x, y, z]);
const sample = (page, pts, R) => page.evaluate(([pts, R]) => window.__sample(pts, R), [pts, R]);
const setOn = (page, on) => page.evaluate(on => { window.SLOPES.on = on; window.__map.triggerRepaint(); }, on).then(() => page.waitForTimeout(500));

// ═══════════════════════════════════════════════════════════════════════
// 1. The debug scene: everything that needs a mesh to measure.
// ═══════════════════════════════════════════════════════════════════════
const page = await open(`${SERVER}/index.html?intro=0&drift=0&slopesdebug=1`);
const booted = await page.waitForFunction(() => window.slopes && window.slopes.frames > 0 && window.slopes.debugGroup, null, { timeout: 90000 }).then(() => true).catch(() => false);
check('the layer boots and renders a frame', booted, booted ? 'slopes.frames > 0 with the debug scene present' : 'no frame after 90 s');
if (!booted) { report(); }

const env = await page.evaluate(() => {
  const gl = window.__map.getCanvas().getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), three: window.THREE && window.THREE.REVISION, src: [...document.scripts].map(s => s.src).find(s => /three/.test(s)) };
});
console.log('GL renderer:', env.renderer);
check('three.js is the pinned unpkg build', env.three === '159' && /unpkg\.com\/three@0\.159\.0\/build\/three\.min\.js/.test(env.src || ''), `REVISION ${env.three}, ${env.src}`);

if (BREAK) {
  await page.evaluate(() => { window.__map.moveLayer('slopes-mesh'); });   // to the very end: above the fog and the sky
  console.log('--break: slopes-mesh moved to the end of the style');
}

// stack
// js/sky.js anchors the fog AFTER THE LAST layer that writes depth and before
// the trailing run of labels — not before the first symbol layer in the style
// (passes interleave symbol layers among the 3D ones; the first run of this
// gate asserted the stricter thing and went red at slopes 208 / fog 210 /
// first symbol 199). The claim that matters: the mesh is below the fog, and
// nothing below the labels sits above the fog except the sky compositor.
const order = await page.evaluate(() => {
  const m = window.__map, o = m.style._order;
  const fog = o.indexOf('aerial-fog');
  const above = o.slice(fog + 1).filter(id => id !== 'sky-overlay' && !(m.getLayer(id) && m.getLayer(id).type === 'symbol'));
  return { slopes: o.indexOf('slopes-mesh'), fog, sky: o.indexOf('sky-overlay'), aboveFogNotLabel: above, n: o.length };
});
check('slopes-mesh sits before aerial-fog, and only the sky and the labels sit above the fog',
  order.slopes >= 0 && order.slopes < order.fog && order.aboveFogNotLabel.length === 0,
  `order: slopes ${order.slopes}, fog ${order.fog}, sky ${order.sky} of ${order.n}; non-label layers above the fog: [${order.aboveFogNotLabel.join(', ')}]`);

// frame
const proj = await page.evaluate(() => {
  const m = window.__map, s = window.slopes;
  return [[-97.7393587, 30.2860098], [-97.7365, 30.2845], [-97.7404, 30.2747]].map(([lng, lat]) => {
    const l = s.toLocal(lng, lat, 0); const a = s.project(l.x, l.y, l.z); const b = m.project([lng, lat]);
    return a ? Math.hypot(a.x - b.x, a.y - b.y) : 1e9;
  });
});
check('slopes.project(slopes.toLocal(lng, lat)) is map.project(lng, lat)', Math.max(...proj) < 0.5, `worst ${Math.max(...proj).toFixed(3)} px over the Tower, Gregory Gym and the Capitol`);

// light
const light = await page.evaluate(() => {
  const s = window.slopes, p = window.__todCurrentP; const sun = window.skyBodies(p).sun; const R = Math.PI / 180;
  const want = [Math.sin(sun.az * R) * Math.cos(sun.elev * R), Math.cos(sun.az * R) * Math.cos(sun.elev * R), Math.sin(sun.elev * R)];
  const l = s.light(); const len = Math.hypot(...l.enu); const L = window.__map.getLight();
  return { diff: Math.max(...l.enu.map((v, i) => Math.abs(v / len - want[i]))), len, radial: L.position[0], az: sun.az, elev: sun.elev, p };
});
check('the mesh light is skyBodies(p).sun, at the light\'s own radial', light.diff < 1e-6 && Math.abs(light.len - light.radial) < 1e-6, `unit diff ${light.diff.toExponential(2)}, |L| ${light.len.toFixed(4)} vs radial ${light.radial}, sun az ${light.az} elev ${light.elev} at p ${light.p}`);

// hour: the parity pair on the lawn
await pose(page, [-97.7394, 30.2846], zoomFor(60, 60, 30.2846), 60, 20);
const P = await page.evaluate(() => { const s = window.slopes, S = window.SLOPES; const o = s.debugGroup.getObjectByName('parity'); return { x: o.position.x, y: o.position.y, E: S.debugCube, tw: S.debugTwinEast }; });
const faces = {
  top:   [await scr(page, P.x, P.y, P.E - 0.01),                 await scr(page, P.x + P.tw, P.y, P.E - 0.01)],
  south: [await scr(page, P.x, P.y - P.E / 2 + 0.01, P.E / 2),   await scr(page, P.x + P.tw, P.y - P.E / 2 + 0.01, P.E / 2)],
  west:  [await scr(page, P.x - P.E / 2 + 0.01, P.y, P.E / 2),   await scr(page, P.x + P.tw - P.E / 2 + 0.01, P.y, P.E / 2)],
};
const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const topLuma = {};
for (const [p, tol, label] of [[0.5, 1, 'golden'], [0.1, 3, 'morning'], [0.95, 3, 'night']]) {
  await page.evaluate(p => window.applyTimeOfDay(window.__map, p, true), p);
  await page.waitForTimeout(1800);        // the light eases over 300 ms; the atlas lands later
  const v = await sample(page, [faces.top[0], faces.top[1], faces.south[0], faces.south[1], faces.west[0], faces.west[1]], 2);
  const d = { top: maxd(v[0], v[1]), south: maxd(v[2], v[3]), west: maxd(v[4], v[5]) };
  topLuma[label] = luma(v[0]);
  check(`p=${p} (${label}): mesh cube = fill-extrusion twin on top, south and west faces within ${tol}/255`,
    d.top <= tol && d.south <= tol && d.west <= tol,
    `top ${rgb(v[0])} vs ${rgb(v[1])} | south ${rgb(v[2])} vs ${rgb(v[3])} | west ${rgb(v[4])} vs ${rgb(v[5])} — max Δ ${Math.max(d.top, d.south, d.west)}`);
  await shot(page, `lawn-${label}`);
}
check('the mesh follows the slider: top luma morning > golden > night', topLuma.morning > topLuma.golden + 5 && topLuma.golden > topLuma.night + 20, `luma ${topLuma.morning.toFixed(1)} > ${topLuma.golden.toFixed(1)} > ${topLuma.night.toFixed(1)}`);
await page.evaluate(() => window.applyTimeOfDay(window.__map, 0.5, true)); await page.waitForTimeout(1500);

// raycast
const ray = await page.evaluate(([pt, E]) => { const h = window.slopes.raycast(pt[0], pt[1]); return { hit: h && h.object.name, z: h && h.point.z, sky: window.slopes.raycast(4, 4) }; }, [faces.top[0], P.E]);
check('slopes.raycast() at the cube top hits the cube at its height; at the sky it is null', ray.hit === 'parity' && Math.abs(ray.z - P.E) < 0.05 && ray.sky === null, `hit ${ray.hit} at z ${ray.z && ray.z.toFixed(3)} (cube ${P.E}); sky → ${ray.sky}`);

// lathe: visible, and its segments follow the preset
const lathe = await page.evaluate(() => { const s = window.slopes; const o = s.debugGroup.getObjectByName('lathe'); const S = window.SLOPES; return { x: o.position.x, y: o.position.y, h: S.debugLatheH, seg: o.userData.segments, detail: s.detail(), preset: window.GFX.preset }; });
await pose(page, [-97.7395, 30.2839], zoomFor(45, 55, 30.2839), 55, 0);
const apex = await scr(page, lathe.x, lathe.y, lathe.h * 0.7);
const apexOn = (await sample(page, [apex], 2))[0]; await setOn(page, false); const apexOff = (await sample(page, [apex], 2))[0]; await setOn(page, true);
check('the debug lathe (LatheGeometry rotated to Z-up) is drawn', maxd(apexOn, apexOff) >= 20, `on ${rgb(apexOn)} vs off ${rgb(apexOff)} at its flank`);
await shot(page, 'lathe');
const pre = await page.evaluate(async () => {
  const s = window.slopes; const before = s.debugGroup.getObjectByName('lathe').userData.segments;
  window.GFX.preset = 'performance'; window.applyGraphics(); await new Promise(r => setTimeout(r, 400));
  const perf = { detail: s.detail(), seg: s.debugGroup.getObjectByName('lathe').userData.segments };
  window.GFX.preset = 'balanced'; window.applyGraphics(); await new Promise(r => setTimeout(r, 400));
  const bal = { detail: s.detail(), seg: s.debugGroup.getObjectByName('lathe').userData.segments };
  return { before, perf, bal, byPreset: window.SLOPES.byPreset };
});
check('the graphics preset drives slopes.detail() and the lathe rebuilds at that density',
  pre.perf.detail === pre.byPreset.performance && pre.bal.detail === pre.byPreset.balanced && pre.perf.seg === Math.round(pre.before * pre.byPreset.performance) && pre.bal.seg === pre.before,
  `performance → detail ${pre.perf.detail}, ${pre.perf.seg} segments; balanced → ${pre.bal.detail}, ${pre.bal.seg} (was ${pre.before})`);

// depth: the Tower from the south, then from the north
await pose(page, TOWER, zoomFor(70, 75, TOWER[1]), 75, 0);
const B = await page.evaluate(() => { const g = window.slopes.debugGroup; const b = g.getObjectByName('behind'), f = g.getObjectByName('front'); const S = window.SLOPES; return { b: [b.position.x, b.position.y, S.debugBehind.d, S.debugBehind.h], f: [f.position.x, f.position.y, S.debugFront.d, S.debugFront.h] }; });
const bC = await scr(page, B.b[0], B.b[1] - B.b[2] / 2 + 0.01, B.b[3] / 2), fC = await scr(page, B.f[0], B.f[1] - B.f[2] / 2 + 0.01, B.f[3] / 2);
let on = await sample(page, [bC, fC], 2); await setOn(page, false); let off = await sample(page, [bC, fC], 2); await setOn(page, true);
check('a slab behind the Tower is hidden by it: the Tower\'s pixel is identical with the layer on and off', maxd(on[0], off[0]) <= 1, `behind-slab centre ${rgb(on[0])} on vs ${rgb(off[0])} off`);
check('a slab in front of the Tower hides it: the pixel changes with the layer on', maxd(on[1], off[1]) >= 20, `front-slab centre ${rgb(on[1])} on vs ${rgb(off[1])} off`);
await shot(page, 'tower-south'); await setOn(page, false); await shot(page, 'tower-south-off'); await setOn(page, true);
await pose(page, TOWER, zoomFor(70, 75, TOWER[1]), 75, 180);
const bN = await scr(page, B.b[0], B.b[1] + B.b[2] / 2 - 0.01, B.b[3] / 2);
on = await sample(page, [bN], 2); await setOn(page, false); off = await sample(page, [bN], 2); await setOn(page, true);
check('...and from the north the same slab is there (so it was the Tower hiding it, not a no-draw)', maxd(on[0], off[0]) >= 20, `behind-slab north face ${rgb(on[0])} on vs ${rgb(off[0])} off`);
await shot(page, 'tower-north');

// haze: the far pair
await pose(page, [TOWER[0], 30.2900], zoomFor(120, 80, 30.29), 80, 0);
const X = await page.evaluate(() => { const o = window.slopes.debugGroup.getObjectByName('far'); const S = window.SLOPES.debugFar; return { x: o.position.x, y: o.position.y, gap: S.gap, h: S.h, d: S.d }; });
const farM = await scr(page, X.x, X.y - X.d / 2 + 0.01, X.h / 2), farT = await scr(page, X.x + X.gap, X.y - X.d / 2 + 0.01, X.h / 2);
const hOn = await sample(page, [farM, farT], 1);
await page.evaluate(() => { window.HAZE_TUNE.on = false; window.__map.triggerRepaint(); }); await page.waitForTimeout(800);
const hOff = await sample(page, [farM, farT], 1);
await page.evaluate(() => { window.HAZE_TUNE.on = true; window.__map.triggerRepaint(); }); await page.waitForTimeout(800);
check('2.5 km out, the fog ladder tints a mesh post and an extrusion post identically (within 2/255)', maxd(hOn[0], hOn[1]) <= 2 && maxd(hOff[0], hOff[1]) <= 2, `haze on: mesh ${rgb(hOn[0])} twin ${rgb(hOn[1])} | off: mesh ${rgb(hOff[0])} twin ${rgb(hOff[1])}`);
check('...and the fog is really doing something there', maxd(hOn[0], hOff[0]) >= 8, `mesh post moved by ${maxd(hOn[0], hOff[0])}/255 when the haze was switched off`);
await shot(page, 'far');

// lod: climb until the mid tier drops, and the mesh with it
const lodPose = [-97.7394, 30.2846];
await pose(page, lodPose, zoomFor(850, 60, 30.2846), 60, 0);
const lod = await page.evaluate(async () => {
  const m = window.__map, s = window.slopes;
  const alt = () => { try { const a = window.__fly && window.__fly.eye().alt; if (isFinite(a) && a > 0) return a; } catch (e) {} return m.transform.cameraToCenterDistance / m.transform.pixelsPerMeter; };
  const groups = () => { const o = {}; for (const g of s.stats().groups) o[g.name] = g.visible; return o; };
  const state = () => ({ alt: +alt().toFixed(0), roofs: m.getLayoutProperty('roofs-pitched', 'visibility') || 'visible', meshHidden: window.LOD_isHidden('slopes-mesh'), meshVisible: s.layer.isVisible(), custVis: m.getLayoutProperty('slopes-mesh', 'visibility') || 'visible', frames: s.frames, groups: groups() });
  window.GFX.renderDistance = 700; window.applyLOD(m); await new Promise(r => setTimeout(r, 500));
  const hidden = state();
  // The layer must still be RENDERING while LOD holds it down — that is the
  // whole point of the per-group contract, and a frame counter that has
  // stopped is how the dome disappeared on 2026-09-02.
  m.triggerRepaint(); await new Promise(r => setTimeout(r, 500));
  const hiddenLater = state();
  window.GFX.renderDistance = 1500; window.applyLOD(m); await new Promise(r => setTimeout(r, 500));
  const shown = state();
  window.GFX.renderDistance = 700; window.applyLOD(m); await new Promise(r => setTimeout(r, 500));
  return { hidden, hiddenLater, shown };
});
const P2 = await scr(page, P.x, P.y, P.E - 0.01);
const cubeHidden = (await sample(page, [P2], 1))[0];
await page.evaluate(async () => { window.GFX.renderDistance = 1500; window.applyLOD(window.__map); await new Promise(r => setTimeout(r, 500)); });
const cubeShown = (await sample(page, [P2], 1))[0];
// THE CONTRACT CHANGED ON 2026-09-02 and this is where it is asserted. It used
// to read `custVis === 'none'`: js/lod.js wrote layout visibility on the custom
// layer as well as calling setVisible. MapLibre 5.24 honours that by never
// calling render() again — and render() is where this layer decides PER GROUP,
// so the Capitol dome (no tier, `lod: null`) went with the roofs and there was
// no dome at all, its 18+7+4 discs still held down by the layer's own filter.
// Now lod.js tells the layer and ONLY tells the layer: visibility stays
// 'visible' at every altitude, render() keeps running, and the groups answer
// for themselves.
check('at altitude past the render distance the mesh is hidden with roofs-pitched',
  lod.hidden.alt > 700 * 1.08 && lod.hidden.roofs === 'none' && lod.hidden.meshHidden === true && lod.hidden.meshVisible === false && lod.hidden.custVis === 'visible',
  `alt ${lod.hidden.alt} m, D=700: roofs-pitched ${lod.hidden.roofs}, LOD_isHidden(slopes-mesh) ${lod.hidden.meshHidden}, layer.isVisible ${lod.hidden.meshVisible}, visibility '${lod.hidden.custVis}' (must stay 'visible' — lod.js never writes it)`);
check('...and the layer is still RENDERING while it is hidden, so the per-group verdict can be given',
  lod.hiddenLater.frames > lod.hidden.frames,
  `frames ${lod.hidden.frames} -> ${lod.hiddenLater.frames} over one repaint while LOD_isHidden is true`);
check('...the roofs group goes with roofs-pitched and the DOME STAYS ON THE SKYLINE',
  lod.hidden.groups['slopes-roofs'] === false && lod.hidden.groups['slopes-dome'] === true,
  `groups at D=700: ${JSON.stringify(lod.hidden.groups)}`);
check('...and every group is back when the slider is at the top',
  lod.shown.groups['slopes-roofs'] === true && lod.shown.groups['slopes-dome'] === true,
  `groups at D=1500: ${JSON.stringify(lod.shown.groups)}`);
check('...and the slider top brings both back', lod.shown.roofs === 'visible' && lod.shown.meshHidden === false && lod.shown.meshVisible === true, `D=1500: roofs-pitched ${lod.shown.roofs}, LOD_isHidden ${lod.shown.meshHidden}, isVisible ${lod.shown.meshVisible}`);
check('...measured on the cube itself: its pixel is the ground while hidden and the cube when shown', maxd(cubeHidden, cubeShown) >= 15, `cube top ${rgb(cubeHidden)} hidden vs ${rgb(cubeShown)} shown`);
await shot(page, 'lod-altitude');
await page.evaluate(() => { window.GFX.renderDistance = 700; });
await pose(page, lodPose, zoomFor(60, 60, 30.2846), 60, 20);
const back = await page.evaluate(async () => { window.applyLOD(window.__map); await new Promise(r => setTimeout(r, 500)); return { roofs: window.__map.getLayoutProperty('roofs-pitched', 'visibility') || 'visible', meshHidden: window.LOD_isHidden('slopes-mesh'), vis: window.slopes.layer.isVisible() }; });
check('descending restores the mesh with the slabs', back.roofs === 'visible' && !back.meshHidden && back.vis, `roofs-pitched ${back.roofs}, LOD_isHidden ${back.meshHidden}, isVisible ${back.vis}`);

// ═══════════════════════════════════════════════════════════════════════
// 1b. The generators: real shapes, from pixels.
// ═══════════════════════════════════════════════════════════════════════
const GREGORY = { center: [-97.7365, 30.2845], zoom: 17.722, pitch: 50, bearing: 90 };
const BATTLE = { center: [-97.74095, 30.28495], zoom: 19.765, pitch: 65, bearing: 200 };
const BATTLE_DOOR = { center: [-97.74015, 30.28541], zoom: 21.17, pitch: 75, bearing: 270 };
await page.evaluate(() => window.GFX.renderDistance = 1500);
await page.waitForFunction(() => window.slopesRoofs && window.slopesRoofs.count.roofs > 0 && window.slopesArches && window.slopesArches.count.done && window.slopesDome && window.slopesDome.count.done, null, { timeout: 90000 }).catch(() => {});
const gen = await page.evaluate(() => {
  const m = window.__map;
  const names = window.slopes.root.children.map(g => g.name);
  return { roofs: window.slopesRoofs.count, arches: window.slopesArches.count, dome: window.slopesDome.count, names,
           filters: { roofs: JSON.stringify(m.getFilter('roofs-pitched') || null), portal: JSON.stringify(m.getFilter('entrances-portal') || null), glass: JSON.stringify(m.getFilter('entrances-glass') || null), dome: JSON.stringify(m.getFilter('capitol-dome') || null) } };
});
check('the three generators built: roofs + gable, 24 arches, 3 dome parts, each a group in the scene',
  gen.roofs.roofs >= 100 && gen.roofs.gables === 1 && gen.arches.arches === 24 && gen.dome.parts === 3 && ['slopes-roofs', 'slopes-arches', 'slopes-dome'].every(n => gen.names.includes(n)),
  `${gen.roofs.roofs} roofs + ${gen.roofs.gables} gable (${gen.roofs.triangles} tris, ${gen.roofs.ms} ms), ${gen.arches.arches} arches (${gen.arches.triangles} tris), ${gen.dome.parts} dome parts (${gen.dome.triangles} tris); groups ${gen.names.join(', ')}`);
check('the stand-ins are filtered out: roofs-pitched keeps only its f tags, entrances exclude arc, capitol-dome excludes the lathed parts',
  /"match","\["get","f"\]/.test(gen.filters.roofs.replace(/\s/g, '')) && /has","arc/.test(gen.filters.portal) && /has","arc/.test(gen.filters.glass) && /bullock-dome/.test(gen.filters.dome),
  `roofs ${gen.filters.roofs} | portal …${gen.filters.portal.slice(-40)} | dome ${gen.filters.dome}`);
const restored = await page.evaluate(async () => {
  const m = window.__map;
  window.SLOPES.on = false; await new Promise(r => setTimeout(r, 300));
  const off = { roofs: m.getFilter('roofs-pitched') || null, portal: JSON.stringify(m.getFilter('entrances-portal') || null), glass: JSON.stringify(m.getFilter('entrances-glass') || null), dome: m.getFilter('capitol-dome') || null, groups: window.slopes.root.children.map(g => g.name) };
  window.SLOPES.on = true; await new Promise(r => setTimeout(r, 300));
  return off;
});
check('SLOPES.on = false puts every filter back (roofs-pitched and capitol-dome to none, the entrance layers to their own) and takes the groups out',
  restored.roofs === null && restored.dome === null && !/arc/.test(restored.portal) && !/arc/.test(restored.glass) && /"k"/.test(restored.portal) && !restored.groups.some(n => /slopes-(roofs|arches|dome)/.test(n)),
  `off: roofs ${restored.roofs}, dome ${restored.dome}, portal …${restored.portal.slice(-60)}, groups [${restored.groups.join(', ')}]`);

// ridge: the hipped roof the light separates best, near the frame's centre
await pose(page, GREGORY.center, GREGORY.zoom, GREGORY.pitch, GREGORY.bearing);
const ridge = await page.evaluate(() => {
  const S = window.slopes, R = window.slopesRoofs.data, meta = R.meta, cv = window.__map.getCanvas();
  const L = S.light().enu, Ln = Math.hypot(...L);
  const cands = [];
  for (const key of Object.keys(R.roofs)) {
    const r = R.roofs[key]; const M = r.pts.length;
    if (M !== 4 || !r.deck) continue;                        // a plain hip: four corners, a ridge or a narrow deck
    const at = (k, d) => { const c = Math.min(d, r.caps[k]); const l = S.toLocal((r.pts[k][0] + r.rays[k][0] * c) * r.dpm[0], (r.pts[k][1] + r.rays[k][1] * c) * r.dpm[1], 0); return [l.x, l.y]; };
    const z = d => r.base + meta.lip + r.rise * d / r.d;
    const edges = r.spans.map(([a, b]) => { const p = r.pts[a], q = r.pts[b % M]; const dx = q[0] - p[0], dy = q[1] - p[1], Lw = Math.hypot(dx, dy); return { a, b: b % M, L: Lw, n: [dy / Lw, -dx / Lw] }; }).sort((x, y) => y.L - x.L);
    if (edges[0].L < 25) continue;
    const pitch = Math.atan2(r.rise, r.d);
    const lit = e => { const n = [e.n[0] * Math.sin(pitch), e.n[1] * Math.sin(pitch), Math.cos(pitch)]; return Math.max(0, Math.min(1, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]))); };
    const mid = (e, f) => { const d = r.d * f; const A = at(e.a, d), B = at(e.b, d); return { x: (A[0] + B[0]) / 2, y: (A[1] + B[1]) / 2, z: z(d) }; };
    const scr = p => { const s = S.project(p.x, p.y, p.z); return s && s.x > 40 && s.x < cv.clientWidth - 40 && s.y > 80 && s.y < cv.clientHeight - 80 ? [s.x, s.y] : null; };
    const A = mid(edges[0], 0.5), B = mid(edges[1], 0.5);
    const sa = scr(A), sb = scr(B);
    if (!sa || !sb) continue;
    const dl = Math.abs(lit(edges[0]) - lit(edges[1]));
    const along = [0.12, 0.3, 0.5, 0.7, 0.88].map(f => { const p = mid(edges[0], f); return { px: scr(p), z: p.z, d: r.d * f }; });
    if (along.some(a => !a.px)) continue;
    const c = Math.hypot(sa[0] - cv.clientWidth / 2, sa[1] - cv.clientHeight / 2);
    cands.push({ key, name: r.name, dl, sa, sb, along, pitch: r.rise / r.d, centre: c, base: r.base, rise: r.rise, dUse: r.d });
  }
  cands.sort((x, y) => (y.dl - x.dl) || (x.centre - y.centre));
  return cands[0] || null;
});
if (!ridge) check('a hipped roof is in the gregory frame', false, 'no four-corner roof with both long slopes on screen');
else {
  const pts = [ridge.sa, ridge.sb].concat(ridge.along.map(a => a.px));
  const on = await sample(page, pts, 1);
  const rc = await page.evaluate(pts => pts.map(([x, y]) => { const h = window.slopes.raycast(x, y); return h ? { o: h.object.name, z: +h.point.z.toFixed(3) } : null; }), ridge.along.map(a => a.px));
  await setOn(page, false); const off = await sample(page, pts, 1); await setOn(page, true);
  const lA = luma(on[0]), lB = luma(on[1]);
  const alongL = on.slice(2).map(luma);
  const spread = Math.max(...alongL) - Math.min(...alongL);
  check(`ridge: ${ridge.name}'s two long slopes read as two tones either side of the ridge`, Math.abs(lA - lB) >= 6,
    `slope A ${rgb(on[0])} (luma ${lA.toFixed(1)}) vs slope B ${rgb(on[1])} (luma ${lB.toFixed(1)}); predicted lit difference ${ridge.dl.toFixed(2)}; slabs read ${rgb(off[0])} / ${rgb(off[1])}`);
  check('...and one slope is one tone from the eave to the ridge (a plane, not five treads)', spread <= 8,
    `luma along the slope ${alongL.map(v => v.toFixed(0)).join(' ')} (spread ${spread.toFixed(1)}); the slabs there ${off.slice(2).map(rgb).join(' | ')}`);
  const zs = rc.map(h => h && h.z);
  const hits = rc.every(h => h && h.o === 'roofs');
  const climbs = hits && zs.every((z, i) => i === 0 || z > zs[i - 1] + 0.05);
  const want = ridge.along.map(a => a.z);
  const err = hits ? Math.max(...zs.map((z, i) => Math.abs(z - want[i]))) : 1e9;
  check('...and a raycast down the slope climbs continuously at the rig\'s own pitch', climbs && err < 0.35,
    `hits ${rc.map(h => h ? h.o + '@' + h.z : 'none').join(', ')}; expected z ${want.map(v => v.toFixed(2)).join(', ')} (base ${ridge.base}, rise ${ridge.rise} over ${ridge.dUse} m: ${(ridge.pitch * 12).toFixed(1)}:12); worst ${err.toFixed(2)} m`);
  await shot(page, 'ridge-gregory');
}

// arch: the arched door nearest the frame's centre at the battle-street pose, then the same door from the street
async function archTest(P, label, minPx) {
  await pose(page, P.center, P.zoom, P.pitch, P.bearing);
  const A = await page.evaluate(() => {
    const S = window.slopes, D = window.slopesArches.data, cv = window.__map.getCanvas();
    let best = null;
    for (const eid of Object.keys(D)) {
      const a = D[eid]; if (!a.band) continue;
      const F = S.frame(a.o, a.t, a.n);
      const crown = a.spring + a.rise, sw = a.band.sw, v = a.band.v[1] + 0.005;
      const pt = (th, dv) => { const w = a.half * Math.cos(th), u = w + (w >= 0 ? sw / 2 : -sw / 2); const p = F.at(u, v + (dv || 0), a.spring + a.rise * Math.sin(th)); return p; };
      const ths = [20, 45, 70, 110, 135, 160].map(d => d * Math.PI / 180);
      const world = ths.map(th => pt(th));
      const scr = world.map(p => S.project(p[0], p[1], p[2]));
      if (scr.some(s => !s || s.w <= 0)) continue;
      const cx = scr.reduce((s, p) => s + p.x, 0) / scr.length, cy = scr.reduce((s, p) => s + p.y, 0) / scr.length;
      if (cx < 60 || cx > cv.clientWidth - 60 || cy < 80 || cy > cv.clientHeight - 80) continue;
      const g = F.at(0, a.tr ? a.tr.v[1] + 0.005 : v, a.spring + a.rise * 0.45); const gs = S.project(g[0], g[1], g[2]);
      const span = Math.hypot(scr[0].x - scr[5].x, scr[0].y - scr[5].y);
      const c = Math.hypot(cx - cv.clientWidth / 2, cy - cv.clientHeight / 2);
      // toward the camera a hair, so the ray lands on the band's face and not behind it
      if (!best || c < best.centre) best = { eid, ref: a.ref, centre: c, span, pts: scr.map(s => [s.x, s.y]), world, glass: gs && [gs.x, gs.y], half: a.half, rise: a.rise };
    }
    return best;
  });
  if (!A) { check(`an arched door is in the ${label} frame`, false, 'none on screen'); return; }
  const on = await sample(page, A.pts.concat([A.glass]), 1);
  const rc = await page.evaluate(([pts, world]) => pts.map(([x, y], i) => { const h = window.slopes.raycast(x, y); if (!h) return null; const w = world[i]; return { o: h.object.name, d: +Math.hypot(h.point.x - w[0], h.point.y - w[1], h.point.z - w[2]).toFixed(3) }; }), [A.pts, A.world]);
  await setOn(page, false); const off = await sample(page, A.pts.concat([A.glass]), 1);
  // the frame changes where the arch is: a grid over the door's head, on vs off
  const box = (() => { const xs = A.pts.map(p => p[0]), ys = A.pts.map(p => p[1]); return [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4]; })();
  const grid = []; for (let y = box[1]; y <= box[3]; y += 2) for (let x = box[0]; x <= box[2]; x += 2) grid.push([x, y]);
  const gOff = await sample(page, grid, 0); await setOn(page, true); const gOn = await sample(page, grid, 0);
  const changed = grid.filter((_, i) => maxd(gOn[i], gOff[i]) > 10).length;
  const bandL = on.slice(0, 6).map(luma), glassL = luma(on[6]);
  const spread = Math.max(...bandL) - Math.min(...bandL);
  const hits = rc.every(h => h && h.o === 'arches' && h.d <= 0.12);
  check(`arch (${label}): six raycasts along ${A.ref}'s surround curve hit the arches mesh on the ellipse (${A.span.toFixed(0)} px across)`, hits,
    `eid ${A.eid}, half ${A.half} rise ${A.rise}: ${rc.map(h => h ? h.o + ' ' + h.d + ' m' : 'miss').join(', ')}`);
  check(`arch (${label}): the six pixels on the curve are one tone, lighter than the fanlight inside`, spread <= 24 && Math.min(...bandL) >= glassL + 12,
    `band ${bandL.map(v => v.toFixed(0)).join(' ')} (spread ${spread.toFixed(0)}) vs glass ${glassL.toFixed(0)}; the chords there read ${off.slice(0, 6).map(luma).map(v => v.toFixed(0)).join(' ')}`);
  check(`arch (${label}): the frame differs from the chord frame over the door's head`, changed >= Math.max(3, grid.length * 0.03),
    `${changed} of ${grid.length} grid points over the head differ by more than 10/255 between curve and chords${A.span < minPx ? ' — at ' + A.span.toFixed(0) + ' px the curve and the chords are within a pixel of each other on the band itself; the closer pose below is the visual proof' : ''}`);
  await shot(page, `arch-${label}`);
}
await archTest(BATTLE, 'battle-street', 120);
await archTest(BATTLE_DOOR, 'battle-door', 120);
await page.evaluate(() => window.GFX.renderDistance = 700);
await page.close();

// ═══════════════════════════════════════════════════════════════════════
// 2. The switch, on the REAL page (no debug scene): off is today.
// ═══════════════════════════════════════════════════════════════════════
const MALL = { center: [-97.7393, 30.2856], zoom: 17.48, pitch: 55, bearing: 0 };   // the pass's mall-cruise pose
const tmp = SHOTS || fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || '.', 'slopes-'));
async function mallFrame(url, name, before) {
  const pg = await open(url);
  if (before) await before(pg);
  await pose(pg, MALL.center, MALL.zoom, MALL.pitch, MALL.bearing);
  await pg.waitForTimeout(3000); await pg.evaluate(() => window.__settle(4000));
  const f = path.join(tmp, `${name}.png`);
  await pg.screenshot({ path: f }); await pg.waitForTimeout(300); await pg.screenshot({ path: f });
  return { pg, f };
}
const A = await mallFrame(`${SERVER}/index.html?intro=0&drift=0`, 'switch-on', async pg => {
  await pg.waitForFunction(() => window.slopes && window.slopes.frames > 0, null, { timeout: 90000 });
});
const onState = await A.pg.evaluate(() => ({ layer: !!window.__map.getLayer('slopes-mesh'), frames: window.slopes.frames, renderer: !!window.slopes.renderer, children: window.slopes.root.children.length }));
check('by default the layer is installed, drawing an empty scene', onState.layer && onState.frames > 0 && onState.renderer && onState.children === 0, `layer ${onState.layer}, frames ${onState.frames}, renderer ${onState.renderer}, root children ${onState.children}`);
await A.pg.evaluate(() => { window.SLOPES.on = false; window.__map.triggerRepaint(); }); await A.pg.waitForTimeout(800);
const fA2 = path.join(tmp, 'switch-live-off.png'); await A.pg.screenshot({ path: fA2 }); await A.pg.waitForTimeout(300); await A.pg.screenshot({ path: fA2 });
await A.pg.close();
const C = await mallFrame(`${SERVER}/index.html?intro=0&drift=0&slopes=0`, 'switch-url-off');
const offState = await C.pg.evaluate(() => ({ layer: !!window.__map.getLayer('slopes-mesh'), frames: window.slopes ? window.slopes.frames : -1, renderer: !!(window.slopes && window.slopes.renderer), on: window.SLOPES.on }));
check('?slopes=0 leaves no layer, no renderer and no frame', !offState.layer && offState.frames === 0 && !offState.renderer && offState.on === false, `layer ${offState.layer}, frames ${offState.frames}, renderer ${offState.renderer}, SLOPES.on ${offState.on}`);
await C.pg.close();
// Within one page the comparison is exact. Across two page LOADS a channel
// may wobble by a unit or two (the first run: 1 pixel, Δ1, against a pristine
// main), so cross-load comparisons ignore Δ ≤ 2 and print the raw count too.
const d1 = diffPNG(A.f, fA2), d2 = diffPNG(A.f, C.f, 2), d2raw = diffPNG(A.f, C.f);
check('SLOPES.on = false at runtime: the mall-cruise frame is pixel-identical', d1.pixels === 0, `${d1.pixels} of ${d1.total} pixels differ (max channel Δ ${d1.maxChannelDiff})`);
check('the empty layer ON vs ?slopes=0 (a separate page load): pixel-identical beyond Δ2', d2.pixels === 0, `${d2.pixels} of ${d2.total} pixels differ by more than 2 (${d2raw.pixels} by any amount, max channel Δ ${d2raw.maxChannelDiff})${d2.bbox ? ', bbox ' + d2.bbox.join(',') : ''}`);
if (AGAINST) {
  const D = await mallFrame(`${AGAINST}/index.html?intro=0&drift=0`, 'against');
  await D.pg.close();
  const d3 = diffPNG(C.f, D.f, 2), d3raw = diffPNG(C.f, D.f);
  check(`?slopes=0 vs the build at ${AGAINST}: pixel-identical beyond Δ2`, d3.pixels === 0, `${d3.pixels} of ${d3.total} pixels differ by more than 2 (${d3raw.pixels} by any amount, max channel Δ ${d3raw.maxChannelDiff})${d3.bbox ? ', bbox ' + d3.bbox.join(',') : ''}`);
}
if (!SHOTS) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
report();

function report() {
  let bad = 0;
  for (const r of results) { console.log(`${r.pass ? ' PASS ' : '*FAIL '} ${r.name}\n         ${r.detail}`); if (!r.pass) bad++; }
  console.log(`\n${results.length - bad}/${results.length} passed${BREAK ? '  (--break: the stack and haze lines are meant to be red)' : ''}`);
  browser.__done();
  process.exit(bad ? 1 : 0);
}
