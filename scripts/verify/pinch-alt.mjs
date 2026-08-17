/**
 * pinch-alt.mjs — WHICH WAY DOES THE TWO-FINGER ALTITUDE GESTURE GO?
 *
 * QUEUE Y10 item 6 is the last unfixed item of the seven from the touch drive
 * and it has been open on the claim that the gesture is INVERTED:
 * `docs/mobile/driving-at-eye-level.md` §6 says *"pinching closed lifts you off
 * the ground — which is the opposite of the universal map convention, where
 * pinching closed zooms out, i.e. away."*
 *
 * That sentence contains its own refutation and nobody has ever driven it to
 * check. On every 2D map, pinch-closed zooms OUT; zooming out moves the camera
 * FURTHER FROM THE GROUND; further from the ground is UP. So "pinch closed
 * lifts you" is what Google Maps, Apple Maps and MapLibre all do — the doc
 * treats "away" and "lifts you" as opposites when for an altitude camera they
 * are the same direction.
 *
 * Reading the code says the same thing (`js/controls.js`):
 *
 *     touchLogAcc += Math.log(pinchDist / d);   // pinchDist = previous gap
 *     ...
 *     if (L) altUser *= Math.exp(L);
 *
 * closing the gap makes `d` smaller, the ratio > 1, the log positive, and the
 * altitude multiplies UP.
 *
 * But this repo's rule is that reading is not verifying, so this file drives
 * REAL touch events through CDP at a 393x852 phone viewport and reports the
 * measured altitude change for each gesture. Two reps of each, interleaved,
 * and the minimum magnitude is quoted — a single reading has been wrong here
 * before.
 *
 *   node scripts/verify/pinch-alt.mjs [outDir]
 *
 * Traps already paid for by the rest of this directory:
 *   - `cancelGraphicsAutoDetect()` first;
 *   - the controller keeps camera ownership for TUNE.BOB_TIMEOUT (8 sim
 *     seconds) after any input, which is why §6's own numbers are caveated:
 *     four of its five gestures started from the wrong altitude because the
 *     re-place did not take. This waits the gesture out and re-reads instead
 *     of assuming the placement stuck.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '8571';
const BASE = `http://127.0.0.1:${PORT}/index.html?intro=0&drift=0`;
const outDir = path.resolve(process.argv[2] || 'shots/lastfix/pinch');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map, s = m.getSource('austin-entrances');
  return !!s && m.isSourceLoaded('austin-entrances');
}, null, { timeout: 150000 }).catch(() => console.log('WARN entrances source never loaded'));

const cdp = await page.context().newCDPSession(page);
const eye = () => page.evaluate(() => {
  try { const e = window.__fly.eye(); return { alt: +e.alt.toFixed(3), lng: e.lng, lat: e.lat }; }
  catch (err) { return null; }
});

// Put the camera on the pavement and WAIT OUT the controller's ownership
// window before reading back, rather than assuming the placement took. There
// is no `__fly.setEye`; the eye is placed the way doorwalk.mjs places it, by
// jumping the MAP to the pose that puts the eye where we want it, and then
// the altitude is READ BACK rather than assumed.
const EYE = [-97.7394, 30.2857];        // South Mall lawn, open ground
async function place() {
  await page.evaluate(([elng, elat]) => {
    const m = window.__map, rad = d => d * Math.PI / 180;
    const C = 40030228.884, ML = C / 360, mLon = lat => ML * Math.cos(rad(lat));
    const alt = 1.7, pitch = 85;
    const fov = m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58;
    const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(rad(fov) / 2);
    const lead = alt * Math.tan(rad(pitch));
    const cLat = elat + lead / ML, cLng = elng;
    const D = alt / Math.cos(rad(pitch));
    const z = Math.log2(C * Math.cos(rad(cLat)) * camPx / (512 * D));
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: [cLng, cLat], zoom: z, bearing: 0, pitch });
  }, EYE);
  // TUNE.BOB_TIMEOUT is 8 sim seconds of controller ownership after any input;
  // §6's own numbers are caveated because its re-places did not take.
  await page.waitForTimeout(9000);
  return eye();
}

/** One two-finger gesture. `from`/`to` are the finger GAP in px, centred. */
async function pinch(fromGap, toGap, steps = 12) {
  const cx = 196, cy = 420;
  const pts = g => ([
    { x: cx - g / 2, y: cy, id: 1 },
    { x: cx + g / 2, y: cy, id: 2 },
  ]);
  const send = async (type, g) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : pts(g).map(p => ({
        x: p.x, y: p.y, id: p.id, radiusX: 12, radiusY: 12, force: 1,
      })),
    });
  };
  await send('touchStart', fromGap);
  for (let i = 1; i <= steps; i++) {
    await send('touchMove', fromGap + (toGap - fromGap) * (i / steps));
    await page.waitForTimeout(30);
  }
  await send('touchEnd', toGap);
  await page.waitForTimeout(900);
  return eye();
}

const rows = [];
async function rep(name, fromGap, toGap) {
  const before = await place();
  const after = await pinch(fromGap, toGap);
  const d = (after && before) ? +(after.alt - before.alt).toFixed(3) : null;
  rows.push({ name, fromGap, toGap, before: before && before.alt, after: after && after.alt, dAlt: d });
  console.log(`${name.padEnd(22)} gap ${String(fromGap).padStart(3)} -> ${String(toGap).padStart(3)}  ` +
              `alt ${String(before && before.alt).padStart(7)} -> ${String(after && after.alt).padStart(8)}  ` +
              `dAlt ${d > 0 ? '+' : ''}${d}`);
  return d;
}

// Interleaved, two reps each, so one bad launch cannot carry the verdict.
for (const r of [1, 2]) {
  await rep(`closed r${r}`, 260, 60);   // fingers together
  await rep(`open   r${r}`, 60, 260);   // fingers apart
}

await page.screenshot({ path: path.join(outDir, 'phone-393x852.png') });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'phone-393x852.png') });

const hint = await page.evaluate(() => {
  const el = document.querySelector('.controls-hint, #controls-hint');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
});

const closed = rows.filter(r => r.name.startsWith('closed')).map(r => r.dAlt);
const open = rows.filter(r => r.name.startsWith('open')).map(r => r.dAlt);
const verdict =
  closed.every(v => v > 0) && open.every(v => v < 0)
    ? 'PINCH CLOSED CLIMBS, SPREAD DESCENDS  (= zoom out is up: the MAP convention)'
    : closed.every(v => v < 0) && open.every(v => v > 0)
      ? 'PINCH CLOSED DESCENDS, SPREAD CLIMBS (= inverted against the map convention)'
      : 'INCONCLUSIVE — reps disagree, do not quote a single reading';

console.log('');
console.log('on-screen hint:', JSON.stringify(hint));
console.log('VERDICT:', verdict);
fs.writeFileSync(path.join(outDir, '_pinch.json'),
  JSON.stringify({ rows, hint, verdict }, null, 1) + '\n');

await browser.__done?.();
await browser.close();
