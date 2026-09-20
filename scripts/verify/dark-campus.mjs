/**
 * dark-campus.mjs — does the citywide sunlight light what is DRAWN?
 *
 *   VERIFY_URL=http://127.0.0.1:PORT node dark-campus.mjs [--break] [--q lite=1]
 *
 * Written for docs/dark-campus-diagnosis.md (2026-09-19). The owner's phone
 * frame of campus was dark and grey. Part of that is taste (a 6-degree sun at
 * the default hour lights almost nothing) and part was a defect: the sun's
 * shadow proxy (js/city-lighting.js shadowProxy) built its casters from every
 * legacy footprint, including the prisms that the Tower, hero, Drag, arts,
 * Moody and West Campus passes HIDE and redraw. The hidden 94 m "UT Tower"
 * prism covers the whole 79 x 87 m Main Building, so its roofs and the shaft
 * sat in permanent shadow and a 900 m streak lay across campus at golden hour.
 * The replacement models, meanwhile, cast nothing.
 *
 * WHAT IT MEASURES, per pixel, through shader debug outputs injected IN THE
 * PAGE ONLY (the shaderSource wrapper below; no file is changed): the surface
 * normal, the sun visibility the shader computed, whether each visible
 * building surface faces the camera, and its world position. It renders twice per pose and reads the
 * second frame inside a MapLibre `render` event.
 *
 * ASSERTIONS (exit 1 on any failure):
 *   1. The proxy leaves out every legacy prism buildings-3d hides.
 *   2. The Main Building's roofs at midday (p 0.25, sun 64 deg SSE) are lit:
 *      sun-facing roof pixels in that box have mean visibility >= 0.85.
 *   3. The Tower shaft (30-62 m: above the Main Building roof, below the
 *      cornice) at midday: its sun-facing wall pixels have mean visibility
 *      >= 0.85. Before the fix it stood inside the hidden 94 m prism.
 *   4. Visible building surfaces face the camera (normals not flipped):
 *      fewer than 0.5% of building pixels report a back-facing normal.
 *
 * Pixels are chosen by the world position the shader saw (debug mode 9),
 * never by a screen rectangle, which also takes in whatever stands in front
 * of or behind the box.
 *
 * --break drops the hidden-id clauses from what the proxy reads, which is the
 * pre-fix behaviour, and must come back red on 1, 2 and 3.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const args = process.argv.slice(2);
const BREAK = args.includes('--break');
const qi = args.indexOf('--q');
const EXTRA = qi >= 0 ? '&' + args[qi + 1] : '';

// In-page only: a debug branch at the top of cityShade. u_sunlight.x carries
// the mode (1 is normal lighting): 2 normal, 3 visibility/facing, 5 faces-camera,
// 9 world position (local metres, x/y +-256 m in 2 m steps, z 0-128 m in 0.5 m steps).
const HOOK = 'if(u_sunlight.x<.5||u_sunPresence.x<=0.0)return original;';
const DEBUG = `
  if(u_sunlight.x>1.5){
    vec3 dn=normalize(normal),dv=normalize(u_eye-pos);
    if(u_sunlight.x<2.5)return dn*.5+.5;
    if(u_sunlight.x<3.5)return vec3(sunlightVisibility(pos,dn),max(dot(dn,u_sunDirection),0.0),0.0);
    if(u_sunlight.x<5.5)return dot(dn,dv)<0.0?vec3(1.0,0.0,1.0):vec3(0.0,1.0,1.0);
    return vec3((pos.x+256.0)/512.0,(pos.y+256.0)/512.0,pos.z/128.0);
  }`;
// Poses around SLOPES.origin, which is the Tower. Boxes are local metres.
const POSES = [
  { name: 'main-building-noon', p: 0.25, pose: { center: [-97.7394, 30.2852], zoom: 17.3, pitch: 70, bearing: 0 },
    // The whole Main Building (79 x 87 m round SLOPES.origin), its roofs only.
    box: { c: [-97.7393587, 30.2860098], r: 42, z0: 12, z1: 40 }, want: 'roof' },
  { name: 'tower-shaft-noon', p: 0.25, pose: { center: [-97.7394, 30.2852], zoom: 17.3, pitch: 70, bearing: 0 },
    // The shaft proper (local ~(-0.6, 29) m from SLOPES.origin, 24 m square),
    // from 30 m, above the Main Building's own hipped roof, to 62 m, below
    // the cornice, clock stage and belfry, whose relief shades itself. At
    // midday nothing near it is taller. (Not at the default hour: then the
    // authored ICON tower, 94 m high and ~390 m west-south-west, correctly
    // shades the shaft up to ~52 m whenever the authored apartments load.)
    box: { c: [-97.7393655, 30.2862735], r: 12.5, z0: 30, z1: 62 }, want: 'wall' },
];

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 900000 });
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(({ HOOK, DEBUG }) => {
    const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { cancelGraphicsAutoDetect(); clearInterval(t); } }, 50);
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue;
      const o = C.prototype.shaderSource;
      C.prototype.shaderSource = function (sh, src) {
        if (typeof src === 'string' && src.includes(HOOK) && !src.includes('pos.x+256.0')) src = src.replace(HOOK, HOOK + DEBUG);
        return o.call(this, sh, src);
      };
    }
    let real;
    Object.defineProperty(window, 'CityLighting', { configurable: true, get() { return real; }, set(v) {
      if (v && !v.__dbg) { v.__dbg = true; const f = v.frame; v.frame = function (U, i, x) { if (window.__dbgMode) U.u_sunlight.value.x = window.__dbgMode; return f.call(this, U, i, x); }; }
      real = v;
    } });
  }, { HOOK, DEBUG });
  await page.goto(BASE + '/index.html?intro=0&drift=0&clip=1' + EXTRA, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.readyToReveal(), null, { timeout: 240000 });
  await page.evaluate((BREAK) => {
    window.__cap = () => new Promise(res => {
      const m = window.__map;
      m.once('render', () => { const gl = m.painter.context.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); res({ w, h, b }); });
      m.triggerRepaint();
    });
    if (BREAK) {
      // The pre-fix proxy: it never read the display filter.
      const m = window.__map, gs = m.getStyle.bind(m);
      m.getStyle = () => { const s = gs(); for (const l of s.layers) if (l.id === 'buildings-3d') delete l.filter; return s; };
    }
  }, BREAK);
  // 1. The proxy leaves out what buildings-3d hides.
  await page.evaluate(() => new Promise(r => { __map.fire('moveend'); __map.triggerRepaint(); setTimeout(() => { __map.triggerRepaint(); setTimeout(r, 1500); }, 600); }));
  const proxy = await page.evaluate(() => ({ hidden: window.CityLighting.stats.shadowProxyHidden, failures: window.CityLighting.stats.failures.slice(0, 3) }));
  check(proxy.hidden > 0 && !proxy.failures.length, `shadow proxy leaves out ${proxy.hidden} hidden legacy prisms (failures: ${JSON.stringify(proxy.failures)})`);

  for (const P of POSES) {
    const r = await page.evaluate(async (P) => {
      const m = window.__map, sl = document.getElementById('tod-slider');
      for (const l of m.getStyle().layers) if (l.type === 'fill-extrusion' && /tree|ground|prop|canopy|depth/.test(l.id + (l.source || ''))) m.setLayoutProperty(l.id, 'visibility', 'none');
      if (m.getLayer('aerial-fog')) m.setLayoutProperty('aerial-fog', 'visibility', 'none');
      window.SLOPES.surfaces.on = false;
      m.stop(); m.jumpTo({ ...P.pose, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      if (sl) sl.value = String(P.p);
      window.applyTimeOfDay(m, P.p, true);
      await new Promise(r => { const k = setTimeout(r, 25000); m.once('idle', () => { clearTimeout(k); r(); }); m.triggerRepaint(); });
      await new Promise(r => setTimeout(r, 3500));
      const caps = {};
      for (const [k, mode] of [['n', 2], ['v', 3], ['f', 5], ['p', 9]]) { window.__dbgMode = mode; await window.__cap(); caps[k] = await window.__cap(); }
      window.__dbgMode = 0; await window.__cap();
      // Pixels are selected by the WORLD position the shader saw, not by a
      // screen rectangle: a screen box around the shaft also takes in the
      // Main Building and whatever stands behind it.
      const { w, h } = caps.n, o = window.slopes.toLocal(P.box.c[0], P.box.c[1], 0);
      let n = 0, back = 0, facing = 0, vis = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, f = caps.f.b;
        if (!(f[i + 2] > 250 && ((f[i] > 250 && f[i + 1] < 5) || (f[i] < 5 && f[i + 1] > 250)))) continue;
        n++; if (f[i] > 250) back++;
        const px = caps.p.b[i] / 255 * 512 - 256, py = caps.p.b[i + 1] / 255 * 512 - 256, pz = caps.p.b[i + 2] / 255 * 128;
        if (Math.abs(px - o.x) > P.box.r || Math.abs(py - o.y) > P.box.r || pz < P.box.z0 || pz > P.box.z1) continue;
        const nz = caps.n.b[i + 2] / 127.5 - 1;
        const cls = nz > 0.6 ? 'roof' : Math.abs(nz) < 0.35 ? 'wall' : 'other';
        if (cls !== P.want || caps.v.b[i + 1] < 8) continue;
        facing++; vis += caps.v.b[i] / 255;
      }
      return { n, back, facing, vis: facing ? vis / facing : null };
    }, P);
    console.log(P.name, JSON.stringify(r));
    check(r.facing > 200 && r.vis >= 0.85, `${P.name}: ${r.facing} sun-facing ${P.want} px, mean visibility ${r.vis?.toFixed(3)} (>= 0.85)`);
    check(r.n > 10000 && r.back / r.n < 0.005, `${P.name}: ${(100 * r.back / r.n).toFixed(3)}% of ${r.n} building px back-facing (< 0.5%)`);
  }
} finally {
  await browser.__done();
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
