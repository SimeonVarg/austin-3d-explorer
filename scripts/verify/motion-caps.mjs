/**
 * motion-caps.mjs — LIVE capability probe for the motion pass.
 *
 * Verifies, against the actually-vendored MapLibre (5.24 from unpkg), that:
 *   1. camera roll exists (getRoll/setRoll, and jumpTo({roll}) round-trips)
 *   2. what easeTo does to a non-zero roll when `roll` is not specified
 *      (this decides how the controller must hand the camera back)
 *   3. setRoll issued mid-ease: does it stick or get overwritten
 *   4. setVerticalFieldOfView exists and round-trips
 *   5. screenshots at roll 0 / +5 / -5 so the tilt direction and any sky-overlay
 *      shear can be LOOKED at (saved next to this script as motion-caps-*.png)
 *
 * Prints findings; exits 1 only if roll or FOV APIs are missing entirely.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
console.log('caps:', JSON.stringify(caps, null, 2));

// easeTo behaviour with roll left non-zero
const ease = await page.evaluate(async () => {
  const m = window.__map;
  if (typeof m.setRoll !== 'function') return { skipped: true };
  const c = m.getCenter();
  m.setRoll(4);
  await new Promise(r => requestAnimationFrame(r));
  const rollBefore = m.getRoll();
  m.easeTo({ center: [c.lng + 0.0005, c.lat], duration: 600 });
  await new Promise(r => setTimeout(r, 200));
  const rollMidEase = m.getRoll();
  m.setRoll(0);                       // does this stick mid-ease?
  await new Promise(r => setTimeout(r, 100));
  const rollAfterMidEaseSetRoll = m.getRoll();
  await new Promise(r => setTimeout(r, 600));
  const rollAfterEaseEnds = m.getRoll();
  m.setRoll(0);
  // and: does easeTo with an explicit roll:0 animate it down?
  m.setRoll(4);
  m.easeTo({ center: [c.lng, c.lat], duration: 400, roll: 0 });
  await new Promise(r => setTimeout(r, 700));
  const rollAfterExplicitRoll0Ease = m.getRoll();
  return { rollBefore, rollMidEase, rollAfterMidEaseSetRoll, rollAfterEaseEnds, rollAfterExplicitRoll0Ease };
});
console.log('easeTo/roll interaction:', JSON.stringify(ease, null, 2));

// Screenshots: roll 0 / +5 / -5 at the spawn view, so tilt direction and
// sky-overlay shear can be inspected by eye.
async function shotAtRoll(roll, name) {
  await page.evaluate(async r => {
    const m = window.__map;
    m.setRoll(r);
    m.triggerRepaint();
    await new Promise(res => setTimeout(res, 400));
  }, roll);
  await page.waitForTimeout(600);
  await page.screenshot({ path: new URL(name, import.meta.url).pathname.slice(process.platform === 'win32' ? 1 : 0) });
  console.log('saved', name);
}
await shotAtRoll(0, 'motion-caps-roll0.png');
await shotAtRoll(5, 'motion-caps-roll+5.png');
await shotAtRoll(-5, 'motion-caps-roll-5.png');
await page.evaluate(() => window.__map.setRoll(0));

if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5));
await browser.__done();
const ok = caps.hasGetRoll && caps.hasSetFov;
console.log(ok ? 'CAPS OK — native roll + FOV both available' : 'CAPS MISSING — see above');
process.exit(ok ? 0 : 1);
