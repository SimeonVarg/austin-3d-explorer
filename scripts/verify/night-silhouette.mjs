// night-workstream version of silhouette.mjs — same claim, same +8 threshold,
// but measured robustly and against VERIFY_URL (the original hardcodes :8099,
// which is a DIFFERENT checkout when worktrees run in parallel).
//
// Robustness changes, each one fixing a measured false reading:
// - The roofline scan now includes parts-3d/parts-roof. The original only
//   queried buildings-3d/buildings-roof, so a parts-rendered tower was
//   invisible to it: the "sky" sample landed on the tower's dark wall
//   (luma 11 — no horizon glow is that dark) and the "wall" sample on one of
//   its lit windows (83,48,45), reporting the skyline inverted when it wasn't.
// - Seven columns with the MEDIAN separation, instead of one pixel that fails
//   the build whenever a single lit pane sits at roofY+0.03.
// - Waits for the buildings to actually be queryable ("no building found in
//   column" was a plain tile-load race in the 4.5 s settle).
// - The sky sample sits just ABOVE the computed horizon line
//   (0.5 - 0.5*tan(90-pitch)/tan(fov/2); see README on horizonLineFromTop).
//   At this pose the roofline (y~0.27-0.30) is BELOW the horizon (y~0.21), so
//   the original's roofY-0.025 sample was reading distant GROUND, not sky:
//   luma 11 at night next to 117 at dusk for the same pixel. Wall-vs-far-ground
//   is not the silhouette claim; wall-vs-sky-at-the-horizon is.
/**
 * The night skyline must read as DARK against the sky. The judge measured the
 * old build as INVERTED: night walls at luma 27-34 sat brighter than the sky
 * at the roofline (~25). Assert the sign of that comparison, from real pixels.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const r = await page.evaluate(async () => {
  const m = window.__map, cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const LAYERS = ['buildings-3d', 'buildings-roof', 'parts-3d', 'parts-roof'];
  const col = (fxTop, fyTop) => {
    const b = new Uint8Array(4);
    gl.readPixels(Math.round(fxTop * cv.width), Math.round((1 - fyTop) * cv.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return [b[0], b[1], b[2]];
  };
  const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const out = {};
  for (const [name, p] of [['night', 1.0], ['dusk', 0.7]]) {
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch: 72, bearing: 118 });
    window.applyTimeOfDay(m, p, true);
    for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));
    // Tile rebuild after a forced time-of-day change happens in a worker; wait
    // until the scan can actually see buildings instead of racing it.
    for (let tries = 0; tries < 20; tries++) {
      const hit = m.queryRenderedFeatures([0.5 * cv.clientWidth, 0.5 * cv.clientHeight], { layers: LAYERS });
      if (hit.length) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const fovRad = m.getVerticalFieldOfView() * Math.PI / 180;
    const horizonY = 0.5 - 0.5 * Math.tan((90 - m.getPitch()) * Math.PI / 180) / Math.tan(fovRad / 2);
    const skyY = Math.max(0.01, horizonY - 0.02);
    const cols = [];
    for (const fx of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      let roofY = null;
      for (let y = 0.05; y < 0.60; y += 0.004) {
        const hit = m.queryRenderedFeatures([fx * cv.clientWidth, y * cv.clientHeight], { layers: LAYERS });
        if (hit.length) { roofY = y; break; }
      }
      if (roofY === null) continue;
      const wall = col(fx, roofY + 0.03);
      const sky = col(fx, Math.min(skyY, roofY - 0.025));
      cols.push({ fx, roofY: +roofY.toFixed(3), skyY: +Math.min(skyY, roofY - 0.025).toFixed(3),
        wallLuma: +luma(wall).toFixed(1), skyLuma: +luma(sky).toFixed(1),
        separation: +(luma(sky) - luma(wall)).toFixed(1) });
    }
    if (!cols.length) { out[name] = { note: 'no building found in any column' }; continue; }
    out[name] = {
      columns: cols,
      medianSky: median(cols.map(c => c.skyLuma)),
      medianWall: median(cols.map(c => c.wallLuma)),
      medianSeparation: median(cols.map(c => c.separation)),
    };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(r)) {
  if (v.medianSeparation === undefined) { console.log(`*FAIL  ${k}: ${v.note}`); fail++; continue; }
  const ok = v.medianSeparation >= 8;
  if (!ok) fail++;
  console.log(`${ok ? ' PASS' : '*FAIL'}  ${k}: median sky luma ${v.medianSky} vs wall ${v.medianWall} -> median separation ${v.medianSeparation} over ${v.columns.length} columns (want >= +8; negative = inverted)`);
}
await browser.close();
process.exit(fail ? 1 : 0);
