/**
 * v2-demo-checks.mjs - the three classes of defect the 2026-10-19 demo walk found on the live v2, counted over EVERY building and
 * EVERY name in a set of views (not only the ones in the pictures):
 *   covers  - a plain extrusion that is COVER.HIDE_SHARE (50 %) or more under a Blender model that is on screen, and still drawn
 *             (its geometry not collapsed). Counted over every tile loaded in the view. Needs v2/covers.js on the page under test
 *             (this branch and later); on an older page it prints n/a. "before" on this branch = the same page with ?cover=0.
 *   names   - for every name on screen (.v2-label.on): overlap with another name (rectangles, 1 px slack); a near-duplicate name
 *             (same words after normalising, or one name's words all inside the other's, both within DUP_M metres); a name whose
 *             building is HIDDEN: a ray from the camera to the name's point hits a building (plain extrusion or Blender model,
 *             three.js Raycaster on the real meshes) more than OWN_M metres (map distance) from the name's building.
 *   pins    - in the finder: visible number pins overlapping each other, and a visible pin overlapping a visible name.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8131 node scripts/verify/v2-demo-checks.mjs [--q "cover=0"] [--shots DIR] [--tag before] [view ...]
 *   VERIFY_URL=https://flyover-utx.vercel.app ... (the live site: names and pins are checked the same way; covers print n/a)
 *
 * Instrument: 1440x900 at device scale 2, real GPU (the renderer string is printed), one fresh page per view, every view waits for
 * the tiles and the aerial to settle (3 calm polls), then 1.2 s, draws twice and reads the second. Exit 1 when any count is not 0
 * (and the covers check ran). A manual hardware tool, not a CI check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const Q = opt('--q', '');
const TAG = opt('--tag', '');
const SHOTS = opt('--shots', '');
const ONLY = argv;
const LIM = { DUP_M: 150, OWN_M: 45, SLACK_PX: 1 };

// target [x, z] (v2 metres: x east, z south of the Tower), distance, polar (0 = straight down), azimuth; or eye [x, z, heading, height]
const VIEWS = [
  { name: 'opening', start: true },
  { name: 'dkr-near', xz: [621, 228], distance: 170, polar: 68, azimuth: 200 },
  { name: 'dkr-far', xz: [621, 228], distance: 380, polar: 58, azimuth: 235 },
  { name: 'tower-near', xz: [0, -0.5], distance: 150, polar: 74, azimuth: 185 },
  { name: 'tower-far', xz: [0, -0.5], distance: 330, polar: 62, azimuth: 200 },
  { name: 'speedway-eye', eye: [243.9, -424.5, 184.8, 1.8] },
  { name: 'finder', start: true, finder: true },
].filter((v) => !ONLY.length || ONLY.includes(v.name));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 1500000 });
const out = [];
for (const v of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0${Q ? '&' + Q : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  if (v.eye) {
    await page.evaluate(([x, z, hdg, h]) => {
      const { controls, THREE } = window.__v2, r = THREE.MathUtils.degToRad(hdg), ahead = 30;
      controls.minDistance = 1; controls.maxPolarAngle = THREE.MathUtils.degToRad(89.5);
      window.__v2.placeCamera({ target: [x + Math.sin(r) * ahead, 0, z - Math.cos(r) * ahead], distance: Math.hypot(ahead, h),
        polarDeg: THREE.MathUtils.radToDeg(Math.atan2(ahead, h)), azimuthDeg: -hdg });
    }, v.eye);
  } else if (v.xz) {
    await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth]);
  } else {
    await page.evaluate(() => window.__v2.skipIntro && window.__v2.skipIntro());
  }
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 150000) {
    const s = await page.evaluate(() => { window.__v2.redraw(); return { t: window.__v2.tiles(), g: window.__v2ground ? window.__v2ground.stats() : null }; });
    const g = s.g, gc = !g || g.failed || (g.index && g.missing === 0 && g.loading === 0 && g.waitingUpload === 0 && g.queued === 0);
    calm = s.t && s.t.loading === 0 && !s.t.fading && gc ? calm + 1 : 0;
    await page.waitForTimeout(700);
  }
  if (v.finder) {
    await page.getByText('Where should I live?').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.fd-pinwrap').length > 5, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__v2.redraw());
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG ? TAG + '-' : ''}${v.name}.tmp.png`) });
  await page.waitForTimeout(800);
  if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, `${TAG ? TAG + '-' : ''}${v.name}.png`) }); fs.rmSync(path.join(SHOTS, `${TAG ? TAG + '-' : ''}${v.name}.tmp.png`), { force: true }); }

  const r = await page.evaluate(async (LIM) => {
    const V = window.__v2, { THREE, camera } = V;
    const res = { renderer: (() => { const gl = V.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; })() };
    // ── covers ──
    let C = null;
    try { C = await import(new URL('./covers.js', location.href).href); } catch (e) { C = null; }
    if (C && V.field && V.tileStreamer) {
      const T = V.tileStreamer(), bad = [], seen = new Set();
      let checked = 0, tilesOn = 0;
      const collapsed = (id) => {
        const recs = V.city.byId.get(String(id)) || []; if (!recs.length) return true;
        return recs.every(([rec, k]) => { const P = rec.mesh.geometry.attributes.position.array, s = rec.starts[k] * 3, n = rec.counts[k] * 3; for (let i = 3; i < n; i++) if (P[s + i] !== P[s + (i % 3)]) return false; return true; });
      };
      for (const s of T.tiles.values()) {
        if (!s.obj || !s.obj.parent || s.fade) continue;
        tilesOn++;
        for (const c of C.coveredIds(C.modelRaster(s.obj), V.field)) {
          if (c.share < C.COVER.HIDE_SHARE || seen.has(c.id)) continue;
          seen.add(c.id); checked++;
          if (!collapsed(c.id)) bad.push({ tile: s.def.id, id: c.id, share: +c.share.toFixed(2) });
        }
      }
      res.covers = { tilesOn, checked, visible: bad.length, list: bad.slice(0, 40), stats: V.coverStats };
    } else res.covers = 'n/a';
    // ── names ──
    camera.updateMatrixWorld();
    const labels = [...document.querySelectorAll('.v2-label.on')].filter((el) => !el.hidden && el.style.visibility !== 'hidden' && el._it);
    const rect = (el) => el.getBoundingClientRect();
    const L = labels.map((el) => ({ el, it: el._it, r: rect(el), text: el._it.name }));
    const S = LIM.SLACK_PX, hit = (a, b) => a.left + S < b.right && a.right - S > b.left && a.top + S < b.bottom && a.bottom - S > b.top;
    const overlaps = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (hit(L[i].r, L[j].r)) overlaps.push([L[i].text, L[j].text]);
    const norm = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['the', 'and', 'of', 'at', 'bldg', 'building', 'hall', 'center', 'ctr'].includes(w));
    const dups = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]; if (Math.hypot(a.it.x - b.it.x, a.it.z - b.it.z) > LIM.DUP_M) continue;
      const A = norm(a.text), B = norm(b.text); if (!A.length || !B.length) continue;
      const [s, l] = A.length <= B.length ? [A, B] : [B, A];
      const inL = s.filter((w) => l.some((x) => x === w || (w.length >= 3 && x.startsWith(w)))).length;
      if (inL / s.length >= 0.75) dups.push([a.text, b.text]);
    }
    const roots = [V.scene.getObjectByName('city'), V.scene.getObjectByName('blender-tiles')].filter(Boolean);
    const meshes = []; for (const r of roots) r.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && (o.parent?.name !== 'city' || /^buildings /.test(o.name))) meshes.push(o); });
    const ray = new THREE.Raycaster(), hidden = [];
    for (const a of L) {
      const p = new THREE.Vector3(a.it.x, a.it.y, a.it.z), o = camera.position.clone(), d = p.clone().sub(o), dist = d.length();
      ray.set(o, d.normalize()); ray.far = dist - 1;
      const h = ray.intersectObjects(meshes, false).find((h) => Math.hypot(h.point.x - a.it.x, h.point.z - a.it.z) > LIM.OWN_M);
      if (h) hidden.push({ name: a.text, by: h.object.name, at: [Math.round(h.point.x), Math.round(h.point.y), Math.round(h.point.z)] });
    }
    res.names = { shown: L.length, overlaps: overlaps.length, dups: dups.length, hidden: hidden.length, overlapList: overlaps.slice(0, 12), dupList: dups.slice(0, 12), hiddenList: hidden.slice(0, 12) };
    // ── pins ──
    const pins = [...document.querySelectorAll('.fd-pinwrap')].filter((w) => w.isConnected && getComputedStyle(w).visibility !== 'hidden' && getComputedStyle(w).display !== 'none' && +getComputedStyle(w).opacity > 0.05)
      .map((w) => ({ n: w.textContent.trim(), r: (w.querySelector('.fd-pin') || w).getBoundingClientRect() }))
      .filter((p) => p.r.right > 0 && p.r.left < innerWidth && p.r.bottom > 0 && p.r.top < innerHeight);
    const pp = [], pl = [];
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) if (hit(pins[i].r, pins[j].r)) pp.push([pins[i].n, pins[j].n]);
    for (const p of pins) for (const a of L) if (hit(p.r, a.r)) pl.push([p.n, a.text]);
    res.pins = { shown: pins.length, pinOverPin: pp.length, pinOverName: pl.length, ppList: pp.slice(0, 12), plList: pl.slice(0, 12) };
    return res;
  }, LIM);
  out.push({ view: v.name, query: Q, ...r, errors: errs.slice(0, 3) });
  console.log(JSON.stringify(out[out.length - 1]));
  await ctx.close();
}
await browser.close();
const sum = (f) => out.reduce((n, o) => n + (f(o) || 0), 0);
const T = {
  coversVisible: out.some((o) => o.covers !== 'n/a') ? sum((o) => o.covers?.visible) : 'n/a',
  coversChecked: out.some((o) => o.covers !== 'n/a') ? sum((o) => o.covers?.checked) : 'n/a',
  names: sum((o) => o.names.shown), nameOverlaps: sum((o) => o.names.overlaps), nameDups: sum((o) => o.names.dups), nameHidden: sum((o) => o.names.hidden),
  pins: sum((o) => o.pins.shown), pinOverPin: sum((o) => o.pins.pinOverPin), pinOverName: sum((o) => o.pins.pinOverName),
  pageErrors: sum((o) => o.errors.length),
};
console.log('TOTAL ' + JSON.stringify(T));
const fail = (T.coversVisible !== 'n/a' && T.coversVisible) || T.nameOverlaps || T.nameDups || T.nameHidden || T.pinOverPin || T.pinOverName || T.pageErrors;
process.exit(fail ? 1 : 0);
