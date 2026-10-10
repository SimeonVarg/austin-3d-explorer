/**
 * facet-bias.mjs - THE MEAN COLOUR OF ONE WALL, geometry against the Facet shader, term by term, at several distances.
 *
 * Why: at the far view the shader wall reads about 3 levels darker than the geometry it replaces (91.1 against 94.2, three runs). The far view is where
 * the meter is supposed to prefer the shader, and a mean that is off by 3 levels is a visible tone step between a shader wall and its neighbour. This is
 * the instrument that finds which term makes the step, and that holds the fix to a number: far mean within 1 level of the 4x supersampled geometry.
 *
 * ONE PAGE, ONE LOAD (?facadeshader=1). The same page draws the wall both ways: with the Facet mesh (the shader) and, after
 * slopesApartments.facetSet(false) and a rebuild, with the geometry the generator would have written (the module refuses nothing then). Every MapLibre layer
 * except the custom three.js layers is hidden, so what is left is sky + the authored buildings, the same in every shot (as packverts-pixels.mjs).
 *
 * THE WALL. The pixels where the Facet mesh draws (found once per distance: hide the Facet mesh, the pixels that change by more than 8 levels). The same pixel
 * mask is used for the geometry shots, so both arms average the same pixels.
 *
 * THE NUMBERS. Per distance, per variant: mean R,G,B of the mask at 1x, and of the 4x supersampled truth box-filtered to 1x (the alias-free mean). The bias of
 * a variant is (its truth mean) - (geometry truth mean), per channel and as luminance. Variants (a "term" is switched off in BOTH arms where a global switch
 * exists, so the contribution of the term to each arm's mean is the difference against the arm's own baseline):
 *   base        everything on
 *   noReflect   SLOPES.surfaces.reflection = 0   (the sky mirrored in glass)
 *   noShadow    SLOPES.sunlight.shadows = false   (the sun shadow map off)
 *   shader-only: shadeSplit (u_fdbg 1: the sun / sky / glass shading of a part-glass pixel done for the wall and for the glass apart and the two colours
 *   averaged), lightSplit (u_fdbg 2: the same for the per-vertex light), both (3), noParallax (u_fParallax 0)
 *
 * Usage: VERIFY_URL=http://127.0.0.1:PORT node facet-bias.mjs --out DIR [--views far,mid,near] [--ss 4] [--json f]
 * Run through the one-browser queue; software GL is enough (the bias is shader maths, not the chip).
 */
import fs from 'node:fs';
import path from 'node:path';
import { settleWith } from './moire-score.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', null); if (!OUT) { console.error('usage: facet-bias.mjs --out <dir> [--views far,mid,near] [--ss 4] [--json f]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const SS = +opt('--ss', '4'), VIEW_W = 480, VIEW_H = 300, PS = opt('--ps', '0.12,0.5').split(',').map(Number), MASK_LEVELS = 8;
const ALL = [
  // the meter's own West Campus cameras (moire-meter.mjs VIEWS) so the numbers join the meter's; vfar is west-far from higher up
  { name: 'vfar', center: [-97.7445, 30.2880], zoom: 15.6, pitch: 72, bearing: 300 },
  { name: 'far', center: [-97.7445, 30.2880], zoom: 16.6, pitch: 72, bearing: 300 },
  { name: 'mid', center: [-97.74495, 30.2866], zoom: 17.9, pitch: 70, bearing: 205 },
  { name: 'near', center: [-97.74525, 30.287604], zoom: 18.1, pitch: 55, bearing: 45 },
];
const ARMSEL = opt('--arm', 'both'), GV = (opt('--gv', '') || '').split(',').filter(Boolean), SV = (opt('--sv', '') || '').split(',').filter(Boolean);
const want = opt('--views', 'vfar,far,mid,near').split(',');
const VIEWS = ALL.filter(v => want.includes(v.name));
const VARIANTS = [
  { name: 'base', shader: true, geom: true, truth: true, set: {} },
  { name: 'noShadow', shader: true, geom: true, set: { shadow: 0 } },
  { name: 'noGlassSky', shader: true, geom: true, set: { glass: 0 } },
  { name: 'noSun', shader: true, geom: true, set: { sun: 0 } },   // the sun path (cityShade) off: only the albedo + per-vertex light remain: what is left of a bias is the LAYOUT, not the shading
  { name: 'shadeSplit', shader: true, geom: false, truth: true, set: { fdbg: 1 } },
  { name: 'lightSplit', shader: true, geom: false, set: { fdbg: 2 } },
  { name: 'both', shader: true, geom: false, truth: true, set: { fdbg: 3 } },
  { name: 'noParallax', shader: true, geom: false, set: { parallax: 0 } },
  { name: 'rev75', shader: true, geom: false, truth: true, set: { rev: 0.75 } },
  { name: 'rev50', shader: true, geom: false, truth: true, set: { rev: 0.5 } },
  { name: 'stage1', shader: true, geom: true, png: true, set: { stage: 1 } },   // the colour right after cityShade (sun, shadow, sky mirror, glint), nothing after it
  { name: 'stage2', shader: true, geom: true, png: true, set: { stage: 2 } },   // red = glass response fed to cityShade, green = glazing, blue = shop
  { name: 'stage3', shader: true, geom: true, png: true, set: { stage: 3 } },   // red = |n.v|, green = n.sun, blue = sun presence
  { name: 'dbgCgGw', shader: true, geom: false, png: true, set: { fdbg: 100 } },     // red = glass share, green = glass response, blue = surface kind / 8
  { name: 'forceGlass', shader: true, geom: false, png: true, set: { fdbg: 200 } },   // glass response forced to 1 wherever there is glass
];

const { chromium } = await import('playwright-core');
const { BASE, launch } = await import('./chrome.mjs');
const browser = await launch(chromium, { maxMs: +(process.env.VERIFY_MAX_MS || 9000000) });
const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(() => { try { const K = 'austin3d.gfx.v1', cur = JSON.parse(localStorage.getItem(K) || '{}'); cur.msaa = false; cur.autoDetected = true; cur.autoExposure = false; localStorage.setItem(K, JSON.stringify(cur)); } catch (e) {} });
await page.goto(`${BASE}/_harness.html?intro=0&drift=0&facadeshader=1&namelabels=0&facadepace=0&timeofdaypace=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 });
await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false; });
await page.waitForFunction(() => { const A = window.slopesApartments; return !!(A && A.count.done && A.group); }, null, { timeout: 1500000, polling: 1000 });
await page.evaluate(`window.__ss = { settleWith: ${settleWith} };`);
await page.evaluate(({ SS, MASK_LEVELS, VIEW_W, VIEW_H }) => {
  const m = window.__map, sleep = ms => new Promise(r => setTimeout(r, ms));
  const quiet = () => { const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count; return !(P && P.busy) && !(A && !A.done); };
  const settle = () => window.__ss.settleWith({ quiet, sleep, now: Date.now, quietMaxMs: 600000, idleMaxMs: 120000, waitIdle: ms => new Promise(r => { const to = setTimeout(() => r(false), ms); m.once('idle', () => { clearTimeout(to); r(true); }); m.triggerRepaint(); }) });
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const grab = () => { const c = m.getCanvas(); cv.width = c.width; cv.height = c.height; cx.drawImage(c, 0, 0); return { w: c.width, h: c.height, d: cx.getImageData(0, 0, c.width, c.height).data }; };
  async function setScale(s) { window.GFX.renderScale = s; window.applyGraphics(); await settle(); }
  const hidden = []; for (const l of m.getStyle().layers) if (l.type !== 'custom') { try { m.setLayoutProperty(l.id, 'visibility', 'none'); hidden.push(l.id); } catch (e) {} }
  const facetMesh = () => { let f = null; window.slopesApartments.group.traverse(o => { if (o.name === 'apartments-facet') f = o; }); return f; };
  const S = {
    hidden: hidden.length,
    async goto(v, p) { m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }); if (window.applyTimeOfDay) window.applyTimeOfDay(m, p, true); await setScale(1); },
    async mask() {                                   // the pixels the Facet mesh draws
      const f = facetMesh(); if (!f) throw new Error('no Facet mesh: the page was not loaded with ?facadeshader=1 or the module took nothing');
      const shown = grab().d; f.visible = false; await settle(); const hid = grab().d; f.visible = true; await settle();
      const N = shown.length / 4, mk = new Uint8Array(N); let n = 0;
      for (let p = 0, i = 0; p < N; p++, i += 4) { if ((Math.abs(hid[i] - shown[i]) + Math.abs(hid[i + 1] - shown[i + 1]) + Math.abs(hid[i + 2] - shown[i + 2])) / 3 > MASK_LEVELS) { mk[p] = 1; n++; } }
      S.maskArr = mk; return { n, of: N };
    },
    maskPng() { const c = document.createElement('canvas'); c.width = VIEW_W; c.height = VIEW_H; const x = c.getContext('2d'), im = x.createImageData(VIEW_W, VIEW_H); for (let p = 0, i = 0; p < VIEW_W * VIEW_H; p++, i += 4) { im.data[i] = im.data[i + 1] = im.data[i + 2] = S.maskArr[p] ? 255 : 0; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return c.toDataURL('image/png'); },
    setMask(a) { S.maskArr = Uint8Array.from(a); },
    tris() { const c = window.slopesApartments.cull || {}; return { total: Math.round(c.totalTriangles || 0), done: !!window.slopesApartments.count.done, building: !!(window.slopesApartments.count && window.slopesApartments.count.building) }; },
    // all the variants of one arm at this view: one pass at 1x, one at the supersampled size (a change of scale costs a full settle; a change of a uniform costs two frames)
    async variants(list) {
      const U = window.slopes.uniforms(), f = facetMesh();
      const frame = () => new Promise(r => { m.once('render', () => r()); m.triggerRepaint(); });
      const mean = (d, w, k) => { let r = 0, g = 0, b = 0, n = 0; const mk = S.maskArr; for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) { const p = y * VIEW_W + x; if (!mk[p]) continue; let rr = 0, gg = 0, bb = 0; for (let j = 0; j < k; j++) for (let q = 0; q < k; q++) { const i = ((y * k + j) * w + x * k + q) * 4; rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; } r += rr / (k * k); g += gg / (k * k); b += bb / (k * k); n++; } return { r: r / n, g: g / n, b: b / n, n }; };
      const dbgMats = on => { window.slopesApartments.group.traverse(o => { for (const m of [].concat(o.material || [])) if (m && m.isShaderMaterial) { m.defines = { ...(m.defines || {}) }; if (on) m.defines.DBG_STAGE = 1; else delete m.defines.DBG_STAGE; m.needsUpdate = true; } }); };
      const out = list.map(v => ({ name: v.name }));
      for (const scale of [1, SS]) {
        await setScale(scale);
        for (let i = 0; i < list.length; i++) {
          if (scale !== 1 && !list[i].truth) continue;   // the supersampled truth costs 16x the pixels: only for the variants that matter (others: 1x differences are enough to see a term's size)
          const set = list[i].set, keep = { reflect: window.SLOPES.surfaces.reflection, shadow: window.SLOPES.sunlight.shadows, glass: window.GFX.windowReflections ?? 1, sun: window.SLOPES.sunlight.on, parallax: f ? f.material.uniforms.u_fParallax.value : null, rev: f ? f.material.uniforms.u_fRev.value : null, fdbg: f && f.material.uniforms.u_fdbg ? f.material.uniforms.u_fdbg.value : null };
          if ('reflect' in set) window.SLOPES.surfaces.reflection = set.reflect;
          if ('shadow' in set) window.SLOPES.sunlight.shadows = !!set.shadow;
          if ('glass' in set) window.GFX.windowReflections = set.glass;
          if ('sun' in set) window.SLOPES.sunlight.on = !!set.sun;
          if ('stage' in set) { dbgMats(true); U.u_dbgStage.value = set.stage; await frame(); await frame(); }
          if (f && 'parallax' in set) f.material.uniforms.u_fParallax.value = set.parallax;
          if (f && 'rev' in set) f.material.uniforms.u_fRev.value = set.rev;
          if (f && 'fdbg' in set && f.material.uniforms.u_fdbg) f.material.uniforms.u_fdbg.value = set.fdbg;
          try { await frame(); await frame(); await sleep(100); await frame(); const a = grab(); out[i][scale === 1 ? 'one' : 'truth'] = mean(a.d, a.w, scale); if (scale === 1 && (list[i].name === 'base' || list[i].png)) out[i].png = cv.toDataURL('image/png'); }
          finally {
            window.SLOPES.surfaces.reflection = keep.reflect; window.SLOPES.sunlight.shadows = keep.shadow; if ('glass' in set) window.GFX.windowReflections = keep.glass; if ('sun' in set) window.SLOPES.sunlight.on = keep.sun; if ('stage' in set) { U.u_dbgStage.value = 0; dbgMats(false); }
            if (f && 'parallax' in set) f.material.uniforms.u_fParallax.value = keep.parallax;
            if (f && 'rev' in set) f.material.uniforms.u_fRev.value = keep.rev;
            if (f && 'fdbg' in set && f.material.uniforms.u_fdbg) f.material.uniforms.u_fdbg.value = keep.fdbg;
          }
        }
      }
      await setScale(1);
      return out;
    },
  };
  window.__bias = S;
}, { SS, MASK_LEVELS, VIEW_W, VIEW_H });
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const rows = [];
const save = () => fs.writeFileSync(opt('--json', path.join(OUT, 'facet-bias.json')).replace(/\.json$/, '.rows.json'), JSON.stringify({ ss: SS, size: [VIEW_W, VIEW_H], ps: PS, rows }, null, 1));
async function arm(armName) {
  for (const P of PS) for (const v of VIEWS) {
    const key = v.name + '@' + P;
    await page.evaluate(([v, P]) => window.__bias.goto(v, P), [v, P]);
    if (armName === 'shader') { const mk = await page.evaluate(() => window.__bias.mask()); (v._mask ||= {})[P] = await page.evaluate(() => Array.from(window.__bias.maskArr)); fs.writeFileSync(path.join(OUT, `${key}-mask.png`), Buffer.from((await page.evaluate(() => window.__bias.maskPng())).split(',')[1], 'base64')); console.error(`[bias] ${key}: mask ${mk.n} of ${mk.of} pixels are Facet-wall`); }
    else await page.evaluate(m => window.__bias.setMask(m), v._mask[P]);
    const list = VARIANTS.filter(va => va[armName === 'shader' ? 'shader' : 'geom'] && (armName !== 'shader' || !SV.length || SV.includes(va.name)) && (armName === 'shader' || !GV.length || GV.includes(va.name)));
    console.error(`[bias] ${key} ${armName} apartment triangles ${JSON.stringify(await page.evaluate(() => window.__bias.tris()))}`);
    const res = (armName === 'shader' && ARMSEL === 'geom') ? [] : await page.evaluate(l => window.__bias.variants(l), list);
    for (const r of res) {
      if (r.png) { fs.writeFileSync(path.join(OUT, `${key}-${armName}-${r.name === 'base' ? '1x' : r.name}.png`), Buffer.from(r.png.split(',')[1], 'base64')); delete r.png; }
      rows.push({ view: key, arm: armName, variant: r.name, oneLum: lum(r.one), truthLum: r.truth ? lum(r.truth) : null, one: r.one, truth: r.truth || null });
      save(); console.error(`[bias] ${key} ${armName} ${r.name}: 1x ${lum(r.one).toFixed(2)} truth ${r.truth ? lum(r.truth).toFixed(2) : '--'} (n ${r.one.n})`);
    }
  }
}
await arm('shader');
save();
if (ARMSEL !== 'shader') {
const msBefore = await page.evaluate(() => { const A = window.slopesApartments, ms = A.count.ms; A.facetSet(false); A.rebuild(); return ms; });
await page.waitForFunction(ms => { const A = window.slopesApartments; return !!(A.group && A.count.done && A.count.ms !== ms && A.count.ms > 0); }, msBefore, { timeout: 1500000, polling: 1000 });
await page.waitForTimeout(3000);
const nomesh = await page.evaluate(() => { let f = null; window.slopesApartments.group.traverse(o => { if (o.name === 'apartments-facet') f = o; }); return !f; });
if (!nomesh) { console.error('FAIL: the geometry arm still has the Facet mesh'); process.exit(1); }
await arm('geom');
}
save();
await browser.__done();
// ---- the table ----
const g = (view, arm, variant) => rows.find(r => r.view === view && r.arm === arm && r.variant === variant);
const KEYS = PS.flatMap(P => VIEWS.map(v => v.name + '@' + P));
const f2 = x => x == null ? '   -- ' : (x >= 0 ? '+' : '') + x.toFixed(2).padStart(5);
const lines = [];
lines.push('A. the bias of the shader against the geometry (luminance 0..255, mean over the pixels the Facet mesh draws; "truth" = 4x supersampled, box-filtered)');
lines.push('view        variant      geometry truth   shader truth   bias(truth)  | geometry 1x  shader 1x   bias(1x)');
for (const k of KEYS) for (const va of VARIANTS) {
  const s = g(k, 'shader', va.name), q = g(k, 'geom', 'base');
  if (!s || !(va.truth || va.name === 'base')) continue;
  lines.push(`${k.padEnd(11)} ${va.name.padEnd(12)} ${q && q.truthLum != null ? q.truthLum.toFixed(2).padStart(8) : '    --  '}       ${s.truthLum != null ? s.truthLum.toFixed(2).padStart(8) : '    --  '}       ${q && s.truthLum != null && q.truthLum != null ? f2(s.truthLum - q.truthLum) : '   -- '}      | ${q ? q.oneLum.toFixed(2).padStart(8) : '    --  '}    ${s.oneLum.toFixed(2).padStart(8)}      ${q ? f2(s.oneLum - q.oneLum) : '   -- '}`);
}
lines.push('\nB. per channel, base variant, truth (R G B):');
for (const k of KEYS) { const s = g(k, 'shader', 'base'), q = g(k, 'geom', 'base'); if (s && q && s.truth && q.truth) lines.push(`${k.padEnd(11)} geometry ${q.truth.r.toFixed(1)} ${q.truth.g.toFixed(1)} ${q.truth.b.toFixed(1)}   shader ${s.truth.r.toFixed(1)} ${s.truth.g.toFixed(1)} ${s.truth.b.toFixed(1)}   diff ${(s.truth.r - q.truth.r).toFixed(2)} ${(s.truth.g - q.truth.g).toFixed(2)} ${(s.truth.b - q.truth.b).toFixed(2)}`); }
lines.push('\nC. what each term contributes to each arm\'s mean (1x; base minus the term switched off; the same pixels). A term that adds more to the geometry than to the shader is a term the shader under-counts:');
for (const k of KEYS) for (const t of ['noShadow', 'noGlassSky']) {
  const sb = g(k, 'shader', 'base'), st = g(k, 'shader', t), gb = g(k, 'geom', 'base'), gtt = g(k, 'geom', t);
  if (sb && st && gb && gtt) lines.push(`${k.padEnd(11)} ${t.padEnd(10)} geometry ${(gb.oneLum - gtt.oneLum).toFixed(2).padStart(6)}   shader ${(sb.oneLum - st.oneLum).toFixed(2).padStart(6)}   (shader minus geometry ${((sb.oneLum - st.oneLum) - (gb.oneLum - gtt.oneLum)).toFixed(2)})`);
}
lines.push('\nD. the shader-only variants against the shader base (1x): the change each makes to the mean');
for (const k of KEYS) for (const t of ['shadeSplit', 'lightSplit', 'both', 'noParallax']) { const sb = g(k, 'shader', 'base'), sv = g(k, 'shader', t); if (sb && sv) lines.push(`${k.padEnd(11)} ${t.padEnd(11)} ${f2(sv.oneLum - sb.oneLum)}`); }
console.log(lines.join('\n'));
if (errs.length) console.error('PAGE ERRORS:', [...new Set(errs)].slice(0, 5).join(' | '));
fs.writeFileSync(opt('--json', path.join(OUT, 'facet-bias.json')), JSON.stringify({ ss: SS, size: [VIEW_W, VIEW_H], ps: PS, rows, table: lines }, null, 1));
