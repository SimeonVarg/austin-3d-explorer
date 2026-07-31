/**
 * light-ae.mjs — auto-exposure must move the right way, stay near 1.0 at the
 * looks the hours were authored for, and never pump.
 *
 * Prints the raw metered luma at each pose — that is where the AE.TARGET_*
 * constants in graphics.js come from (measured, not guessed).
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
console.log('white ground', JSON.stringify(bright));
check('brighter-than-typical frame: exposure pulls DOWN (whitened ground, real pixels)',
  bright.luma > spawnNight.luma + 0.1 && bright.gain <= 0.9 && bright.gain >= 0.85 - 1e-6,
  `luma ${bright.luma.toFixed(3)}, gain ${bright.gain.toFixed(3)}`);

// ── No pumping at a fixed pose ───────────────────────────────────────
// Only meaningful where swiftshader managed >= 5 frames; the headed perf run
// exercises the real 60 fps path.
const traces = [spawnDay, spawnGold, spawnNight, nightSky];
const judged = traces.filter(r => r.frames >= 5);
check('no pumping: settled gain spread < 0.02 wherever measurable',
  judged.length >= 1 && judged.every(r => r.settleSpread < 0.02),
  traces.map(r => `${r.frames}f/${r.settleSpread.toFixed(4)}`).join(' ') + ` (${judged.length} judged)`);

// ── Off switch really is off ─────────────────────────────────────────
const off = await page.evaluate(async () => {
  Object.assign(window.GFX, { autoExposure: false });
  window.updateSky(window.__map, 0.12);
  await new Promise(r => setTimeout(r, 100));
  window.updateSky(window.__map, 0.12);
  return window.__ae();
});
check('autoExposure=false resets the gain to exactly 1', off.gain === 1, JSON.stringify(off));

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.__done();
process.exit(results.every(r => r.pass) ? 0 : 1);
