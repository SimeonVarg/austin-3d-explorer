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
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
console.log(JSON.stringify(r, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(r)) {
  if (v.medianSeparation === undefined) { console.log(`*FAIL  ${k}: ${v.note}`); fail++; continue; }
  const ok = v.medianSeparation >= 8;
  if (!ok) fail++;
  console.log(`${ok ? ' PASS' : '*FAIL'}  ${k}: median sky luma ${v.medianSky} vs wall ${v.medianWall} -> median separation ${v.medianSeparation} over ${v.columns.length} columns (want >= +8; negative = inverted)`);
}
await browser.__done();
process.exit(fail ? 1 : 0);
