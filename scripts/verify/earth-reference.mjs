/**
 * earth-reference.mjs — Google Earth 3D reference frames at a named centre.
 *
 * WHAT IT MEASURES: nothing. It CAPTURES the reference every look-fix round is
 * judged against — Google Earth's own photogrammetry of a building, at poses
 * that match the app's cameras — so a round can compare ours to the source
 * instead of to a memory of it. HANDOFF §228 lost this capability twice by
 * leaving it in a scratchpad; it is tracked now for that reason.
 *
 *   LAT=30.28699 LNG=-97.74578 OUT=<dir> node earth-reference.mjs [pose ...]
 *
 * Poses (all around the given centre): north south nw sw ne se nadir.
 * Default: north south.
 *
 * Three things about Earth that are not obvious and cost a round each:
 *   - `canvas.toDataURL` is BLACK on Earth. Only `page.screenshot()` returns
 *     the globe, so this writes files rather than handing back buffers.
 *   - Earth streams its mesh in. A frame taken before it sharpens is a blurry
 *     lie that looks like a real capture. This waits, shoots twice and keeps
 *     the second — scripts/verify/README.md's rule, for the same reason.
 *   - Two overlays cover the building on first load (the sign-in strip and the
 *     place card). They are dismissed by Escape and by coordinate; if Earth's
 *     chrome moves, those two clicks are what to re-measure.
 * Hardware GL, one browser, closed at the end.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';

const OUT = process.env.OUT;
if (!OUT) { console.error('OUT=<dir> is required'); process.exit(2); }
const LAT = Number(process.env.LAT), LNG = Number(process.env.LNG);
if (!Number.isFinite(LAT) || !Number.isFinite(LNG)) { console.error('LAT= and LNG= are required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

// TASTE/INSTRUMENT CONSTANTS (CLAUDE.md rule 11): the eye altitude, the two
// camera distances and the tilt each pose is flown at. `h` is the heading the
// camera LOOKS along, so `north` (180) stands to the north looking south.
const ALT = 190, FAR = 300, NEAR = 220, FOV = 35;
const POSE = { north: [FAR, 180, 60], south: [FAR, 0, 60], ne: [NEAR, 225, 55], nw: [NEAR, 135, 55],
               se: [NEAR, 315, 55], sw: [NEAR, 45, 55], nadir: [260, 0, 0] };
const SETTLE_MS = 40000;      // Earth's mesh streaming; measured, not guessed
const RESHOOT_MS = 6000;      // the gap between the throwaway and the kept frame

const want = process.argv.slice(2).length ? process.argv.slice(2) : ['north', 'south'];
const bad = want.filter(n => !POSE[n]);
if (bad.length) { console.error('unknown pose(s):', bad.join(' '), '— have:', Object.keys(POSE).join(' ')); process.exit(2); }

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const name of want) {
  const [d, h, t] = POSE[name];
  const url = `https://earth.google.com/web/@${LAT},${LNG},${ALT}a,${d}d,${FOV}y,${h}h,${t}t,0r`;
  console.log('Loading', name, url);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(SETTLE_MS);
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(45, 148).catch(() => {});     // the left rail's sign-in strip
    await page.waitForTimeout(1500);
    await page.mouse.click(716, 410).catch(() => {});    // the place card over the building
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/earth-${name}-1.png` });
    await page.waitForTimeout(RESHOOT_MS);
    await page.screenshot({ path: `${OUT}/earth-${name}.png` });   // the one to use
    fs.writeFileSync(`${OUT}/earth-${name}-final-url.txt`, page.url());
    console.log('saved', name, page.url());
  } catch (e) { console.log('ERROR', name, e.message); }
}
await page.close();
await browser.__done();
console.log('Done.');
