/**
 * light-tone.mjs — the filmic tone curve must be measurable in PIXELS.
 *
 * Claim under test: with the curve on, highlights roll off instead of clipping
 * (fewer flat-255 pixels where there was gradient) and shadows keep detail
 * (fewer flat-0 pixels), while midtones stay roughly where the grade put them.
 *
 * The curve is a CSS filter on #map, so it only affects the WebGL frame — the
 * screen-blended sky/fx overlays sit outside it. The A/B therefore hides those
 * overlays while measuring (they'd add uncontrolled light over the very pixels
 * being asserted), then a final composited pair is left in shots/ for eyes.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const browser = await launch(chromium);
console.log('PROBE', JSON.stringify(probe));
check('browser transfer matches the authored LUT (sRGB, alive, no recolour)',
  probe.every(s => Math.abs(s.got - s.exp) <= 3),
  probe.map(s => `${s.x}->${s.got}(exp ${s.exp})`).join(' '));

// ── Composited pairs for the eyeball pass ────────────────────────────
await pose(0.47, 78, 250, 0, false);
await pose(0.47, 78, 250, 0.8, false);

// ── The filter chain itself ──────────────────────────────────────────
const chain = await page.evaluate(() => {
  Object.assign(window.GFX, { filmic: 0.8 });
  window.applyGraphics();
  const f = document.getElementById('map').style.filter;
  const svg = !!document.querySelector('filter#a3d-tone feFuncR[type="table"]');
  const tv = document.querySelector('filter#a3d-tone feFuncR');
  const vals = tv ? tv.getAttribute('tableValues').split(' ').map(Number) : [];
  let monotonic = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1] - 1e-6) monotonic = false;
  return { f, svg, n: vals.length, first: vals[0], last: vals[vals.length - 1], monotonic };
});
check('filter chain references the SVG LUT', chain.f.includes('url("#a3d-tone")') || chain.f.includes('url(#a3d-tone)'), chain.f);
check('LUT exists, is monotonic, spans toe to shoulder',
  chain.svg && chain.n >= 17 && chain.monotonic && chain.first >= 0 && chain.last <= 1,
  `${chain.n} samples, [${chain.first} .. ${chain.last}], monotonic=${chain.monotonic}`);

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.__done();
process.exit(results.every(r => r.pass) ? 0 : 1);
