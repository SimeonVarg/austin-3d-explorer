/**
 * light-rays.mjs — god rays must read as SHAFTS, not a starburst sticker,
 * and no flare ghost may read as a second sun.
 *
 * Both claims are measured on the fx-canvas ink itself (the DOM overlays sit
 * outside the GL canvas, so this is the layer that actually draws them), with
 * A/B through window.FX_TUNE — the same live-tunable constants the owner can
 * override.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: String(d) });

await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect());

/**
 * Pose at golden hour with the sun in frame, draw with the given FX_TUNE
 * patches, and integrate fx-canvas alpha into angular sectors around the sun
 * plus a coarse blob grid over the sky.
 */
async function inkStats(patch, opts) {
  return page.evaluate(async ({ patch, opts }) => {
    const m = window.__map;
    Object.assign(window.GFX, { bloom: 0, godRays: opts.rays, flare: opts.flare, dof: 0, grain: 0 });
    for (const [k, v] of Object.entries(patch.RAYS || {})) window.FX_TUNE.RAYS[k] = v;
    for (const [k, v] of Object.entries(patch.GHOSTS || {})) window.FX_TUNE.GHOSTS[k] = v;
    window.applyGraphics();
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.3, pitch: opts.pitch, bearing: opts.bearing });
    window.applyTimeOfDay(m, 0.47, true);
    await new Promise(r => setTimeout(r, 900));
    window.updateSky(m, 0.47);                       // one clean draw with the patch
    const F = window.skyFrame;
    const c = document.getElementById('fx-canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const scale = c.width / F.W;                     // fx canvas is half-res
    const sx = F.sun.x * scale, sy = F.sun.y * scale;
    // Angular sectors around the sun (alpha-weighted). hor15 is the NARROW
    // horizontal band where the anisotropy weight is ~1: shafts there must
    // keep their light, not be deleted along with the vertical fan.
    let hor = 0, hor15 = 0, horDown15 = 0, ver = 0;
    // Coarse blob grid, sun neighbourhood excluded, STRICTLY above the
    // horizon: a first cut let cells straddle the horizon line and the "sky
    // blob" it found was a city-overlapping ghost that legitimately never
    // damps.
    const cell = 24;
    const skyMaxY = (F.horizonPx - 24) * scale;
    const gw = Math.ceil(c.width / cell), gh = Math.ceil(c.height / cell);
    const grid = new Float64Array(gw * gh);
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const a = d[(y * c.width + x) * 4 + 3];
        if (!a) continue;
        const dx = x - sx, dy = y - sy;
        const rr = Math.hypot(dx, dy);
        if (rr > 20 * scale && rr < 420 * scale) {
          const angDeg = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;   // 0..180
          const fromHor = Math.min(angDeg, 180 - angDeg);                // 0 = horizontal
          if (fromHor < 15) { hor15 += a; if (dy > 0) horDown15 += a; }
          if (fromHor < 30) hor += a;
          else if (fromHor > 60) ver += a;
        }
        if (rr > 140 * scale && y < skyMaxY)
          grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] += a;
      }
    }
    let blobMax = 0, blobAt = null;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > blobMax) { blobMax = grid[i]; blobAt = [(i % gw) * cell / scale, Math.floor(i / gw) * cell / scale]; }
    }
    return { hor, hor15, horDown15, ver, blobMax, blobAt, sun: { x: F.sun.x, y: F.sun.y, elev: F.sun.elev }, horizonPx: F.horizonPx };
  }, { patch, opts });
}

// ── 1. Ray directionality ────────────────────────────────────────────
const P = { pitch: 84, bearing: 256 };
const aniso = await inkStats({ RAYS: { ANISO: 0.85 } }, { rays: 0.8, flare: 0, ...P });
const uniform = await inkStats({ RAYS: { ANISO: 0 } }, { rays: 0.8, flare: 0, ...P });
console.log('rays aniso  ', JSON.stringify(aniso));
console.log('rays uniform', JSON.stringify(uniform));
const rAniso = aniso.hor / Math.max(1, aniso.ver);
const rUniform = uniform.hor / Math.max(1, uniform.ver);
check('rays draw at all (both configurations put ink down)',
  aniso.hor + aniso.ver > 5000 && uniform.hor + uniform.ver > 5000,
  `aniso ${(aniso.hor + aniso.ver).toFixed(0)}, uniform ${(uniform.hor + uniform.ver).toFixed(0)}`);
check('weighted rays streak sideways: horizontal/vertical ink >= 2.5',
  rAniso >= 2.5, `ratio ${rAniso.toFixed(2)} (hor ${aniso.hor.toFixed(0)} / ver ${aniso.ver.toFixed(0)})`);
check('with ANISO=0 the fan is a starburst again (ratio < 1.6 — the lever is live)',
  rUniform < 1.6, `ratio ${rUniform.toFixed(2)}`);
// DOWNWARD near-horizontal only: upward wedges are deliberately halved by
// UP_FACTOR (shafts streak sideways and down). GAIN=1.35 deliberately
// under-compensates — the whole fan is calmer and the directionality is
// carried by the 3x+ hor/ver contrast, not by pumping the survivors — so the
// preservation claim is "clearly still there", >= 60% of the uniform ink.
// (Verified by eye on ab-sunfan-old/new: the horizontal glare band reads at
// full strength; the sticker spokes are what vanished.)
check('downward near-horizontal shafts keep >= 60% of their uniform ink',
  aniso.horDown15 > uniform.horDown15 * 0.60,
  `±15° down ink ${uniform.horDown15.toFixed(0)} (uniform) -> ${aniso.horDown15.toFixed(0)} (weighted)`);

// ── 2. Ghost second-sun damping, across bearings ─────────────────────
// The illusion appeared at bearings where the biggest ghost lands in open sky
// (sun near a corner). Sweep a few; assert the damp halves the sky blob.
const ghostRows = [];
for (const bearing of [210, 230, 275]) {
  const damped = await inkStats({ GHOSTS: { SKY_DAMP: 0.35 } }, { rays: 0, flare: 0.6, pitch: 80, bearing });
  const undamped = await inkStats({ GHOSTS: { SKY_DAMP: 1.0 } }, { rays: 0, flare: 0.6, pitch: 80, bearing });
  console.log(`ghosts b${bearing}`, 'damped', damped.blobMax.toFixed(0), 'undamped', undamped.blobMax.toFixed(0),
    'at', JSON.stringify(undamped.blobAt), 'sun', JSON.stringify(damped.sun));
  ghostRows.push({ bearing, damped: damped.blobMax, undamped: undamped.blobMax });
}
// The blob CELL mixes the ghost's rim (which scales by the full 0.35) with
// other flare ink crossing the same cell, so the cell sum lands ~0.6, not
// 0.35. Require a clearly visible reduction at EVERY swept bearing.
check('brightest off-sun sky blob drops >=30% at every bearing with SKY_DAMP',
  ghostRows.every(r => r.undamped > 500 && r.damped < r.undamped * 0.70),
  ghostRows.map(r => `b${r.bearing}: ${r.undamped.toFixed(0)}->${r.damped.toFixed(0)}`).join('  '));

// restore defaults for anything that runs after us in the same page
await page.evaluate(() => { window.FX_TUNE.RAYS.ANISO = 0.85; window.FX_TUNE.GHOSTS.SKY_DAMP = 0.35; });

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.__done();
process.exit(results.every(r => r.pass) ? 0 : 1);
