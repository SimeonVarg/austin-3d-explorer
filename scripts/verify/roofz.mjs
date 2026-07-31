/**
 * roofz.mjs — "roofs glitch out while I'm moving" (reported on a phone).
 *
 * Diagnosis: the parapet cap was `base: h - 1.2, height: h + 0.4`, so its side
 * faces were EXACTLY COPLANAR with the wall's over a 1.2 m band, in a different
 * colour. Which surface wins is then decided by depth-buffer rounding, so it
 * flips as the camera moves. A desktop's 24-bit depth buffer usually hides it; a
 * phone's does not.
 *
 * Measuring it: z-fighting shows up as SPECKLE — isolated pixels that disagree
 * with both horizontal neighbours, densely, along the contested band. Window
 * patterns are high-frequency too, but they are identical in both configurations,
 * so comparing the old cap geometry against the new one at the same camera pose
 * isolates the fight. The A/B happens inside one page load, by writing the old
 * expressions back with setPaintProperty.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);

const out = await page.evaluate(async () => {
  const m = window.__map;

  /**
   * Speckle density over a central band of the frame: pixels that differ from
   * BOTH horizontal neighbours by more than `TH`. Depth fighting between two
   * coplanar faces produces exactly this signature.
   */
  function speckle() {
    const cv = m.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const W = cv.width, H = cv.height;
    // Mid-distance rooflines, where depth precision is worst and roofs are
    // visible edge-on. readPixels is bottom-up, so this is measured from the top.
    const y0 = Math.round(H * 0.30), h = Math.round(H * 0.34);
    const buf = new Uint8Array(W * h * 4);
    gl.readPixels(0, H - y0 - h, W, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const TH = 26;
    let spk = 0, total = 0;
    for (let y = 0; y < h; y++) {
      const row = y * W * 4;
      for (let x = 1; x < W - 1; x++) {
        const i = row + x * 4, l = i - 4, r = i + 4;
        const dl = Math.abs(buf[i] - buf[l]) + Math.abs(buf[i + 1] - buf[l + 1]) + Math.abs(buf[i + 2] - buf[l + 2]);
        const dr = Math.abs(buf[i] - buf[r]) + Math.abs(buf[i + 1] - buf[r + 1]) + Math.abs(buf[i + 2] - buf[r + 2]);
        total++;
        if (dl > TH && dr > TH) spk++;
      }
    }
    return { pct: 100 * spk / total, spk, total };
  }

  async function settle() {
    m.triggerRepaint();
    await new Promise(r => setTimeout(r, 800));
  }

  // Several poses, because a single one could get lucky on depth rounding.
  const POSES = [
    { center: [-97.7434, 30.2857], zoom: 16.6, pitch: 70, bearing: 90 },
    { center: [-97.7420, 30.2870], zoom: 17.2, pitch: 76, bearing: 45 },
    { center: [-97.7450, 30.2840], zoom: 16.9, pitch: 64, bearing: 200 },
  ];

  const NEW_H = ['+', ['get', 'final_height'], ['max', 1.0, ['*', 0.015, ['get', 'final_height']]]];
  const NEW_B = ['get', 'final_height'];
  const OLD_H = ['+', ['get', 'final_height'], 0.4];
  const OLD_B = ['-', ['get', 'final_height'], 1.2];
  const NEW_PH = ['+', ['get', 'h'], ['max', 1.0, ['*', 0.015, ['get', 'h']]]], NEW_PB = ['get', 'h'];
  const OLD_PH = ['+', ['get', 'h'], 0.4],  OLD_PB = ['-', ['get', 'h'], 1.2];

  const set = (H, B, PH, PB) => {
    m.setPaintProperty('buildings-roof', 'fill-extrusion-height', H);
    m.setPaintProperty('buildings-roof', 'fill-extrusion-base', B);
    if (m.getLayer('parts-roof')) {
      m.setPaintProperty('parts-roof', 'fill-extrusion-height', PH);
      m.setPaintProperty('parts-roof', 'fill-extrusion-base', PB);
    }
  };

  const rows = [];
  for (const pose of POSES) {
    m.jumpTo(pose);
    await settle();
    set(OLD_H, OLD_B, OLD_PH, OLD_PB); await settle();
    const before = speckle();
    set(NEW_H, NEW_B, NEW_PH, NEW_PB); await settle();
    const after = speckle();
    rows.push({ pose: `z${pose.zoom} p${pose.pitch} b${pose.bearing}`, before: before.pct, after: after.pct });
  }
  return rows;
});

console.log('\nSpeckle density in the mid-distance band (lower is better).');
console.log('"overlapping" = the old cap, base h-1.2 / height h+0.4 — coplanar with the wall.');
console.log('"stacked"     = the new cap, base h / height h+max(1, .015h) — no shared surface.\n');
console.log('pose'.padEnd(24) + 'overlapping   stacked    change');
let wins = 0;
for (const r of out) {
  const d = r.after - r.before;
  const pct = r.before > 0 ? (100 * d / r.before) : 0;
  if (d < 0) wins++;
  console.log(r.pose.padEnd(24) +
    r.before.toFixed(3).padStart(8) + '%' +
    r.after.toFixed(3).padStart(10) + '%' +
    (pct >= 0 ? '   +' : '   ') + pct.toFixed(1) + '%');
}
const meanBefore = out.reduce((a, r) => a + r.before, 0) / out.length;
const meanAfter = out.reduce((a, r) => a + r.after, 0) / out.length;
console.log('\nmean ' + meanBefore.toFixed(3) + '% -> ' + meanAfter.toFixed(3) + '%  (' +
  (100 * (meanAfter - meanBefore) / meanBefore).toFixed(1) + '%)  ' +
  wins + '/' + out.length + ' poses improved');

// THIS SCRIPT DOES NOT ASSERT A PASS, and the reason matters.
//
// Measured here the two configurations come out within ~1% of each other, i.e.
// no fight is visible at all. That is the EXPECTED result and it is not evidence
// the fix was unnecessary — it is evidence this harness cannot see the bug:
//
//   * swiftshader rasterises in software with a 24-bit depth buffer, while the
//     phone this was reported on very likely has 16-bit;
//   * MapLibre draws buildings-roof after buildings-3d and depth-tests LEQUAL,
//     so on a buffer with enough precision the later layer wins every tie
//     deterministically — coplanar, but not flickering.
//
// So the change is justified on the geometry rather than on a repro: the old cap
// shared a surface with the wall over a 1.2 m band, which makes the winner
// undefined, and its top face sat only 0.4 m above the wall's. The new one shares
// nothing and separates the two roof planes by 1.0-1.5 m. Strictly safer on every
// device; whether it cures what was seen needs a real phone.
console.log('\nNOTE: a null result here is expected — see the comment at the end of this file.');
console.log('      Software rasterisation has 24-bit depth and MapLibre breaks coplanar ties');
console.log('      deterministically by draw order, so this harness cannot reproduce a');
console.log('      16-bit mobile depth fight. Confirm on real hardware.');
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
await browser.__done();
