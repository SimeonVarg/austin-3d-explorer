/**
 * v2-shimmer.mjs - how much fine detail on the Blender buildings flickers in motion, measured against a supersampled truth.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-shimmer.mjs [--refs "main|."] [--q "a=1|"] [--frames 24] [--ss 3] [--out dir] [--views "name part;name part"]
 *
 * Rule 15 (CLAUDE.md): nothing may shimmer in motion, and blur is not a fix. The fine repeats on the Blender buildings (Moody
 * Center's fins, the Health Transformation Building's louvres and grilles, DKR's fins, window grids) are geometry finer than a pixel
 * when seen from far. This meter takes the method of scripts/verify/moire.mjs to v2:
 *   - the camera orbits the building slowly (0.15 degrees a frame, the app's own measuring orbit), at a grazing angle;
 *   - each frame is drawn twice: NATIVE (the app's canvas at its own pixel ratio, with its own antialiasing) and TRUTH (the same
 *     frame at SS x the pixel ratio, box-filtered back down: alias-free to a very good approximation);
 *   - inside the building's box on screen:
 *       shimmer = mean |native(t+1) - native(t)| - mean |truth(t+1) - truth(t)|     (8-bit luma)
 *     the frame-to-frame change the truth does not have, i.e. the flicker; and
 *       alias = mean |native - truth|     the still-frame error (jaggies + moire);
 *       soft  = mean |blur(truth) - truth| - mean |blur(native) - native|  > 0 when native is SOFTER than the truth (a blur "fix").
 *   - --refs compares app versions interleaved, as in v2-frame.mjs (each ref's v2/ extracted beside v2/).
 *   - --flip "glassFar=0,1" (rule 13: load once, test many): in ONE page load, per view, calls window.__v2.glassFar(v) for each value
 *     (a value "1:0.4" passes two arguments),
 *     twice interleaved (0,1,0,1), re-placing the camera before each pass. Extra columns: the whole canvas's mean rgb (8-bit) in the
 *     first native frame, and its difference from the first value's frame (mean |luma diff| over the whole canvas, share of pixels > 2).
 * Instrument: viewport 800x500 at device scale 2 (canvas 1600x1000, the owner's Mac density); tiles settled and their fades
 * finished before any frame; no frame loop runs between the native and the truth draw (one synchronous pass per frame). REAL GPU
 * only (fails on SwiftShader). PNGs of the first native and truth frame per (version, view) go to --out when given.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const FRAMES = +arg('--frames', 24), SS = +arg('--ss', 3), OUT = arg('--out', '');
const QS = String(arg('--q', '')).split('|');
const FLIP = arg('--flip', '') ? (([fn, vs]) => ({ fn, vals: vs.split(',') }))(String(arg('--flip', '')).split('=')) : null;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function refFolder(ref) {
  if (ref === '.') return 'v2';
  const run = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  let sha = '';
  try { sha = run('rev-parse', '--verify', '--quiet', ref + '^{commit}'); } catch (e) { sha = ''; }
  if (!sha) { run('fetch', '--depth', '1', 'origin', ref); sha = run('rev-parse', 'FETCH_HEAD'); }
  const dir = 'v2-ref-' + ref.replace(/[^A-Za-z0-9._-]+/g, '_');
  fs.rmSync(path.join(REPO, dir), { recursive: true, force: true });
  const tar = execFileSync('git', ['archive', '--format=tar', `--prefix=${dir}/`, `${sha}:v2`], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', REPO], { input: tar, maxBuffer: 1 << 30 });
  console.log(`ref ${ref} = ${sha.slice(0, 10)} -> /${dir}/`);
  return dir;
}
const REFS = String(arg('--refs', '.')).split('|').map((r) => ({ ref: r, dir: refFolder(r) }));
const VARIANTS = REFS.flatMap((r) => QS.map((q) => ({ ...r, q, name: [REFS.length > 1 ? r.ref : '', q].filter(Boolean).join(' ') || '(default)' })));
let VIEWS = [
  { name: 'Moody Center fins, 650 m', slug: 'moody-center', distance: 650, polar: 74, azimuth: 160 },
  { name: 'Moody Center fins, 1100 m', slug: 'moody-center', distance: 1100, polar: 76, azimuth: 160 },
  { name: 'Moody Center fins, 1800 m', slug: 'moody-center', distance: 1800, polar: 78, azimuth: 160 },
  { name: 'Health Transformation Building, 600 m', slug: 'health-transformation-building', distance: 600, polar: 74, azimuth: 200 },
  { name: 'Health Transformation Building, 1100 m', slug: 'health-transformation-building', distance: 1100, polar: 76, azimuth: 200 },
  { name: 'DKR fins, 1000 m', slug: 'dkr-memorial-stadium', distance: 1000, polar: 74, azimuth: 250 },
  { name: 'DKR fins, 1800 m', slug: 'dkr-memorial-stadium', distance: 1800, polar: 77, azimuth: 250 },
  { name: 'West Campus window grids, 900 m', slug: 'the-venue', distance: 900, polar: 75, azimuth: 30 },
];
// V2_SHIMMER_VIEWS='[{"name":"...","slug":"...","distance":300,"polar":75,"azimuth":315}]' measures these views instead (any building)
if (process.env.V2_SHIMMER_VIEWS) VIEWS.splice(0, VIEWS.length, ...JSON.parse(process.env.V2_SHIMMER_VIEWS));
const VIEWS_RUN = VIEWS.filter((v) => !arg("--views", "") || String(arg("--views", "")).split(";").some((s) => v.name.includes(s)));   // --views "Moody Center fins, 650;DKR fins, 1000" = only these
const browser = await launch(chromium, { args: HW_ARGS, maxMs: 2400000 });
const rows = [];
let renderer = '';
for (const variant of VARIANTS) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${BASE.replace(/\/$/, '')}/${variant.dir}/?intro=0${variant.q ? '&' + variant.q : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
  const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
  for (const v of VIEWS_RUN) {
    // a view may carry its own target point and top (x, z, top: metres, the branch's manifest values), so main and the branch are measured
    // at the SAME camera and box even where main has no entry for the slug (main draws the plain block and the neighbours there).
    // 2026-10-27: the gate is always main vs branch; before, a new slug fell back to an absolute limit that charged unchanged neighbours to it.
    const b = v.x != null && v.z != null ? { x: v.x, z: v.z, top: v.top } : man.buildings[v.slug];
    if (!b) { console.log('no building', v.slug); continue; }
    await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [b.x, b.z, v.distance, v.polar, v.azimuth]);
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 180000) {
      const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground && window.__v2ground.stats(); return { t: window.__v2.tiles(), g }; });
      const groundCalm = !s.g || s.g.failed || (s.g.index && s.g.missing === 0 && s.g.loading === 0 && s.g.waitingUpload === 0);
      calm = s.t && s.t.loading === 0 && !s.t.fading && groundCalm ? calm + 1 : 0; await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1200);
    const passes = FLIP ? [0, 1].flatMap(() => FLIP.vals) : [null];
    for (const [pi, fv] of passes.entries()) {
    if (FLIP) {
      await page.evaluate(([fn, val, x, z, d, p, a]) => { window.__v2[fn](...String(val).split(':').map(Number)); window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }); window.__v2.redraw(); }, [FLIP.fn, fv, b.x, b.z, v.distance, v.polar, v.azimuth]);
      await page.waitForTimeout(400);
    }
    const r = await page.evaluate(({ frames, SS, slug, top, want, flipKey, flipRef }) => {
      const { renderer, scene, camera, controls, THREE } = window.__v2;
      const gl = renderer.getContext(), canvas = renderer.domElement, dpr = renderer.getPixelRatio();
      const W = canvas.clientWidth, H = canvas.clientHeight;
      // the building's box on screen (from its manifest point and top, padded), in CSS pixels
      const b = window.__v2bld || null;
      const pts = []; const c = new THREE.Vector3();
      const box = (x, z, r, h) => { for (const dx of [-r, r]) for (const dz of [-r, r]) for (const y of [0, h]) { c.set(x + dx, y, z + dz).project(camera); pts.push([(c.x + 1) / 2 * W, (1 - c.y) / 2 * H]); } };
      box(want.x, want.z, want.r, top);
      let x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0]))));
      let y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))));
      if (x1 - x0 < 8 || y1 - y0 < 8) return { error: 'building off screen' };
      const rw = x1 - x0, rh = y1 - y0;
      const grab = (scale) => {
        renderer.setPixelRatio(dpr * scale); renderer.setSize(W, H, false);
        camera.updateMatrixWorld(); renderer.render(scene, camera);
        const k = dpr * scale, gx = Math.round(x0 * k), gy = Math.round((H - y1) * k), gw = Math.round(rw * k), gh = Math.round(rh * k);
        const px = new Uint8Array(gw * gh * 4); gl.readPixels(gx, gy, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // luma at the native resolution: box-filter scale x scale blocks
        const nw = Math.round(rw * dpr), nh = Math.round(rh * dpr), out = new Float32Array(nw * nh), s = scale;
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
          let acc = 0;
          for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const o = ((y * s + j) * gw + (x * s + i)) * 4; acc += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; }
          out[y * nw + x] = acc / (s * s);
        }
        return { L: out, w: nw, h: nh };
      };
      const blur = (F) => { const o = new Float32Array(F.L.length); for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) { let a = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= F.w || yy >= F.h) continue; a += F.L[yy * F.w + xx]; n++; } o[y * F.w + x] = a / n; } return o; };
      const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
      const off = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      let prevN = null, prevT = null, dN = 0, dT = 0, alias = 0, soft = 0, first = null, eN = null, eT = null;
      let whole = null;
      for (let f = 0; f < frames; f++) {
        if (f === 0 && flipKey) {
          // the whole canvas, native, first frame: mean colour, and the difference from the first flip value's frame
          renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); camera.updateMatrixWorld(); renderer.render(scene, camera);
          const cw = canvas.width, ch = canvas.height, px = new Uint8Array(cw * ch * 4); gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const m = [0, 0, 0]; for (let i = 0; i < px.length; i += 4) { m[0] += px[i]; m[1] += px[i + 1]; m[2] += px[i + 2]; }
          const n = cw * ch; whole = { mean: m.map((x) => x / n) };
          window.__flipRef ||= {};
          if (flipRef) window.__flipRef[flipKey] = px;
          const ref = window.__flipRef[flipKey];
          if (ref && ref !== px) { let d = 0, big = 0; for (let i = 0; i < px.length; i += 4) { const e = Math.abs(0.2126 * (px[i] - ref[i]) + 0.7152 * (px[i + 1] - ref[i + 1]) + 0.0722 * (px[i + 2] - ref[i + 2])); d += e; if (e > 2) big++; } whole.diff = d / n; whole.big = big / n; }
          else whole.diff = 0, whole.big = 0;
        }
        if (f) { off.copy(camera.position).sub(controls.target).applyAxisAngle(up, THREE.MathUtils.degToRad(0.15)); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); }
        const N = grab(1), T = grab(SS);
        alias += mad(N.L, T.L); soft += mad(blur(T), T.L) - mad(blur(N), N.L);
        if (prevN) {
          dN += mad(N.L, prevN.L); dT += mad(T.L, prevT.L);
          eN ||= new Float32Array(N.L.length); eT ||= new Float32Array(N.L.length);
          for (let i = 0; i < N.L.length; i++) { eN[i] += Math.abs(N.L[i] - prevN.L[i]); eT[i] += Math.abs(T.L[i] - prevT.L[i]); }
        }
        if (!first) first = { N, T };
        prevN = N; prevT = T;
      }
      renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); window.__v2.redraw();
      // where it flickers: per pixel, the mean frame-to-frame change native has over the truth's
      const ex = Array.from(eN, (v, i) => (v - eT[i]) / (frames - 1)).sort((a, b) => a - b);
      const hot = ex.filter((v) => v > 6).length / ex.length;
      const png = (F) => { const cv = document.createElement('canvas'); cv.width = F.w; cv.height = F.h; const g = cv.getContext('2d'); const im = g.createImageData(F.w, F.h); for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) { const v = F.L[(F.h - 1 - y) * F.w + x], o = (y * F.w + x) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255; } g.putImageData(im, 0, 0); return cv.toDataURL('image/png'); };
      return { p99: ex[Math.floor(ex.length * 0.99)], hot, region: [x0, y0, rw, rh], shimmer: (dN - dT) / (frames - 1), nativeChange: dN / (frames - 1), truthChange: dT / (frames - 1), alias: alias / frames, soft: soft / frames,
        pngN: png(first.N), pngT: png(first.T), tiles: window.__v2.tiles(), whole };
    }, { frames: FRAMES, SS, slug: v.slug, top: (b.top || 30) + 2, want: { x: b.x, z: b.z, r: v.slug === 'dkr-memorial-stadium' ? 150 : v.slug === 'moody-center' ? 95 : 45 }, flipKey: FLIP ? v.name : '', flipRef: FLIP ? pi === 0 : false });
    if (r.error) { console.log(variant.name, v.name, r.error); continue; }
    const vname = FLIP ? `${variant.name === '(default)' ? '' : variant.name + ' '}${FLIP.fn}=${fv}` : variant.name;
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      const slugOf = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
      for (const [k, u] of [['native', r.pngN], ['truth', r.pngT]]) fs.writeFileSync(path.join(OUT, `${slugOf(vname)}--${slugOf(v.name)}--${k}.png`), Buffer.from(u.split(',')[1], 'base64'));
    }
    rows.push({ variant: vname, view: v.name, ...r, pngN: undefined, pngT: undefined });
    }
  }
  await ctx.close();
}
await browser.close();
const f = (x) => x.toFixed(2);
console.log(`renderer: ${renderer}`);
console.log(`instrument: 800x500 @2 (canvas 1600x1000), ${FRAMES} frames of orbit at 0.15 deg/frame, truth = ${SS}x${SS} supersample box-filtered; 8-bit luma inside the building's box`);
console.log('version/query | view | shimmer (native change - truth change) | p99 per-pixel excess change | flickering share (pixels with excess > 6) | native change | truth change | alias (|native - truth|) | soft (> 0: native blurrier than truth) | region px | tiles full/far');
for (const r of rows) console.log(`${r.variant} | ${r.view} | ${f(r.shimmer)} | ${f(r.p99)} | ${(100 * r.hot).toFixed(2)} % | ${f(r.nativeChange)} | ${f(r.truthChange)} | ${f(r.alias)} | ${f(r.soft)} | ${r.region[2]}x${r.region[3]} | ${r.tiles.lod0}/${r.tiles.lod1 || 0}` +
  (r.whole ? ` | mean rgb ${r.whole.mean.map((x) => x.toFixed(2)).join(',')} | vs first: ${r.whole.diff.toFixed(3)} luma, ${(100 * r.whole.big).toFixed(3)} % > 2` : ''));
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
