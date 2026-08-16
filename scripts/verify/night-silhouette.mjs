/**
 * night-silhouette.mjs — THE NIGHT SKYLINE MUST READ AS DARK AGAINST THE SKY.
 *
 * The judge measured the old build as INVERTED: night walls at luma 27-34 sat
 * BRIGHTER than the sky at the roofline (~25), so the city glowed against a
 * darker sky. This asserts the sign of that comparison, from real pixels.
 *
 * THIS FILE REPLACES `silhouette.mjs`, which is deleted in the same commit.
 * They made the same claim with the same +8 threshold; this one measures it
 * properly, and every difference below is a false reading that was actually
 * observed:
 *  - the roofline scan includes `parts-3d`/`parts-roof`. The old one queried
 *    only `buildings-3d`/`buildings-roof`, so a parts-rendered tower was
 *    invisible to it: the "sky" sample landed on the tower's dark wall
 *    (luma 11 — no horizon glow is that dark) and the "wall" sample on one of
 *    its lit windows, reporting the skyline inverted when it was not;
 *  - SEVEN columns and the MEDIAN separation, instead of one pixel that fails
 *    the build whenever a single lit pane sits at roofY+0.03;
 *  - it waits for the buildings to be queryable — "no building found in
 *    column" was a plain tile-load race inside the 4.5 s settle;
 *  - the sky sample sits just ABOVE the computed horizon line
 *    (0.5 - 0.5*tan(90-pitch)/tan(fov/2); README, `horizonLineFromTop` returns
 *    0 at every pitch). At this pose the roofline (y~0.27-0.30) is BELOW the
 *    horizon (y~0.21), so the old `roofY-0.025` sample was reading distant
 *    GROUND, not sky: luma 11 at night next to 117 at dusk for the same pixel.
 *    Wall-vs-far-ground is not the silhouette claim; wall-vs-sky is;
 *  - it honours VERIFY_URL. The old one hardcoded :8099, which is a DIFFERENT
 *    checkout the moment two worktrees are served at once.
 *
 * AND IT COULD NOT RUN. Both files were gutted on 2026-07-31 by the mass-edit
 * that introduced `launch()` (commit 90ad9d7): `newPage`, `goto` and the whole
 * `page.evaluate` were deleted and the trailing verdict loop left behind, so
 * this has thrown `ReferenceError: r is not defined` on every invocation
 * since — across the entire sky rewrite it exists to guard.
 *
 *   node night-silhouette.mjs           gate
 *   node night-silhouette.mjs --break   the SAME gate against walls forced
 *                                       bright IN THE PAGE, which must be RED
 *
 * A "no building found" outcome is a FAIL, never a skip. A guard that quietly
 * reports nothing when it cannot see is the exact failure mode this repo has
 * shipped four times.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const BREAK = process.argv.includes('--break');
if (BREAK) console.log('*** --break: building layers forced to #f2f2f2 IN THE PAGE, as the last write before each sample');

// ── Taste / threshold values, all in one place (CLAUDE.md rule 11) ───────────
const TUNE = {
  POSE: { center: [-97.7434, 30.2857], zoom: 16.4, pitch: 72, bearing: 118 },
  HOURS: [['night', 1.0], ['dusk', 0.7]],
  COLUMNS: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
  LAYERS: ['buildings-3d', 'buildings-roof', 'parts-3d', 'parts-roof'],
  WALL_BELOW: 0.03,     // how far below the roofline to sample the wall
  DIFF_MIN: 6,          // per-channel change that counts as "a building is here"
  SKY_ABOVE: 0.02,      // how far above the horizon line to sample the sky
  MIN_SEPARATION: 8,    // sky luma minus wall luma. Negative = inverted.
  SETTLE_FRAMES: 40,
};

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const r = await page.evaluate(async (T) => {
  const m = window.__map, cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  // Read a whole column at native device pixels, top-down. One readPixels per
  // column, not one per row: a per-row read of 760 rows x 7 columns x 2 passes
  // is 10,640 GL round trips.
  const column = (fx) => {
    const h = cv.height, x = Math.round(fx * cv.width);
    const buf = new Uint8Array(4 * h);
    gl.readPixels(x, 0, 1, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const px = [];
    for (let row = h - 1; row >= 0; row--) px.push([buf[row * 4], buf[row * 4 + 1], buf[row * 4 + 2]]);
    return px;                                  // px[0] is the TOP of the frame
  };
  const settle = async (n) => { for (let i = 0; i < n; i++) await new Promise(res => requestAnimationFrame(res)); };
  const setVis = (v) => { for (const id of T.LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v); };

  const out = {};
  for (const [name, p] of T.HOURS) {
    m.jumpTo(T.POSE);
    window.applyTimeOfDay(m, p, true);
    await settle(T.SETTLE_FRAMES);

    // THE ROOFLINE IS FOUND BY DIFFING TWO RENDERS, NOT BY queryRenderedFeatures.
    //
    // The restored original scanned each column downward calling
    // queryRenderedFeatures on the building layers and taking the first hit as
    // the roofline. On its first real run every one of seven columns returned a
    // hit at the FIRST row it tried, y=0.050 — which at this pose is ABOVE the
    // computed horizon (y=0.207) and therefore cannot be a building: a finite
    // building at finite distance always projects below the horizon. It was
    // hit-testing sky, and the resulting "wall" sample was sky too, so the gate
    // reported the skyline INVERTED at both hours with total confidence. That
    // is a bigger sin than the crash it replaced.
    //
    // So: render the column with the building layers hidden, render it again
    // with them shown, and the topmost row that CHANGED is a building pixel by
    // construction. README's rule for "which layer owns this pixel" is to hide
    // layers and diff, and it is the only reading here that cannot be fooled.
    setVis('none');
    await settle(T.SETTLE_FRAMES);
    const bare = {}; for (const fx of T.COLUMNS) bare[fx] = column(fx);
    setVis('visible');
    // --break goes HERE, not before the sweep. The first attempt set the paint
    // property once at startup and the gate came back byte-identical to the
    // clean run: `applyTimeOfDay(m, p, true)` rewrites every building colour on
    // each hour, so the sabotage was overwritten before a single pixel was
    // read. A --break that silently does nothing is worse than none — it is a
    // green run that reads as proof the gate fires. The override is now the
    // LAST write before the frame is sampled.
    //
    // The pattern has to go too. With only the colour forced, the NIGHT half of
    // this gate came back byte-identical to the clean run while dusk went red:
    // at night js/facades.js paints the walls with `fill-extrusion-pattern`
    // (the lit-window atlas) and MapLibre ignores `fill-extrusion-color`
    // wherever a pattern is set. Half a watched failure is not a watched
    // failure.
    if (T.BREAK) for (const id of T.LAYERS) {
      if (!m.getLayer(id)) continue;
      try { m.setPaintProperty(id, 'fill-extrusion-pattern', null); } catch (e) {}
      try { m.setPaintProperty(id, 'fill-extrusion-color', '#f2f2f2'); } catch (e) {}
    }
    await settle(T.SETTLE_FRAMES);
    const full = {}; for (const fx of T.COLUMNS) full[fx] = column(fx);

    const fovRad = m.getVerticalFieldOfView() * Math.PI / 180;
    const horizonY = 0.5 - 0.5 * Math.tan((90 - m.getPitch()) * Math.PI / 180) / Math.tan(fovRad / 2);
    const H = cv.height;
    const skyRow = Math.max(1, Math.round((horizonY - T.SKY_ABOVE) * H));

    const cols = [];
    for (const fx of T.COLUMNS) {
      const a = bare[fx], b = full[fx];
      // Start AT the horizon. Anything above it is sky by geometry, and the old
      // scan's false hits all lived up there.
      let roofRow = null;
      for (let row = Math.round(horizonY * H); row < Math.round(0.85 * H); row++) {
        const d = Math.max(Math.abs(b[row][0] - a[row][0]),
                           Math.abs(b[row][1] - a[row][1]),
                           Math.abs(b[row][2] - a[row][2]));
        if (d >= T.DIFF_MIN) { roofRow = row; break; }
      }
      if (roofRow === null) continue;
      const wallRow = Math.min(H - 1, roofRow + Math.round(T.WALL_BELOW * H));
      const wall = b[wallRow], sky = b[skyRow];
      cols.push({ fx,
        roofY: +(roofRow / H).toFixed(3), skyY: +(skyRow / H).toFixed(3),
        wall: wall.join(','), sky: sky.join(','),
        wallLuma: +luma(wall).toFixed(1), skyLuma: +luma(sky).toFixed(1),
        separation: +(luma(sky) - luma(wall)).toFixed(1) });
    }
    if (!cols.length) { out[name] = { note: `no building pixel found below the horizon in any of ${T.COLUMNS.length} columns` }; continue; }
    out[name] = {
      horizonY: +horizonY.toFixed(3),
      columns: cols,
      medianSky: median(cols.map(c => c.skyLuma)),
      medianWall: median(cols.map(c => c.wallLuma)),
      medianSeparation: median(cols.map(c => c.separation)),
    };
  }
  return out;
}, { ...TUNE, BREAK });

for (const [k, v] of Object.entries(r)) {
  console.log(`\n-- ${k} --------------------------------------------------`);
  if (v.note) { console.log('  ' + v.note); continue; }
  console.log(`  horizon y=${v.horizonY}`);
  console.log('    fx    roofY   skyY   sky rgb        luma    wall rgb       luma    sep');
  for (const c of v.columns)
    console.log(`  ${c.fx.toFixed(2)}   ${c.roofY.toFixed(3)}  ${c.skyY.toFixed(3)}   ` +
      `${c.sky.padEnd(13)}  ${String(c.skyLuma).padStart(5)}   ${c.wall.padEnd(13)}  ` +
      `${String(c.wallLuma).padStart(5)}  ${String(c.separation).padStart(6)}`);
}

console.log('');
let fail = 0;
for (const [k, v] of Object.entries(r)) {
  if (v.medianSeparation === undefined) { console.log(`*FAIL  ${k}: ${v.note}`); fail++; continue; }
  const ok = v.medianSeparation >= TUNE.MIN_SEPARATION;
  if (!ok) fail++;
  console.log(`${ok ? ' PASS' : '*FAIL'}  ${k}: median sky luma ${v.medianSky} vs wall ${v.medianWall} -> ` +
    `median separation ${v.medianSeparation} over ${v.columns.length} columns ` +
    `(want >= +${TUNE.MIN_SEPARATION}; negative = inverted)`);
}
if (Object.keys(r).length !== TUNE.HOURS.length) {
  console.log(`*FAIL  only ${Object.keys(r).length} of ${TUNE.HOURS.length} hours were measured at all`);
  fail++;
}
await browser.__done();
process.exit(fail ? 1 : 0);
