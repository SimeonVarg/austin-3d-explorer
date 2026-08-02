/**
 * focus-move.mjs — can you still fly after touching the daylight slider?
 *
 * THE DEFECT. "on acer when i change daylight i can't move anymore - also
 * sometimes even when i dont change movement stops." It was reported as an
 * Acer-only fault, which sent the first look at it hunting a GPU driver.
 *
 * It is not hardware. `controls.js` swallowed every key whenever the event
 * target was INPUT|SELECT|TEXTAREA|BUTTON, and index.html's only form controls
 * are a checkbox, the time-of-day range slider and the play button. Click any
 * of them and WASD is dead until you click the canvas again.
 *
 * WHY ONLY ONE MACHINE. macOS does not move keyboard focus to a button or a
 * slider on click; Windows does. Identical build, dead on one, fine on the
 * other. That asymmetry is the entire reason this survived so long, so the
 * regression test has to FORCE focus rather than trust the platform to grant
 * it — otherwise this script would pass on a Mac while the bug was live.
 *
 * WHAT IT ASSERTS, in the order the failures actually happen:
 *   1. the camera moves with nothing focused          (the control)
 *   2. the camera still moves with the SLIDER focused (the reported bug)
 *   3. the camera still moves with the BUTTON focused (the "even when i dont")
 *   4. arrow keys still belong to the slider          (the guard's real job)
 *   5. a key released while a widget has focus does not latch down
 *
 * 5 is the one that bites in the other direction: the old keyup mirrored the
 * keydown guard, so pressing W over the canvas and clicking the slider before
 * letting go stuck the key on and flew the camera away by itself.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/focus-move.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => !!window.__fly, null, { timeout: 30000 });
await page.waitForTimeout(2500);

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

const eye = () => page.evaluate(() => {
  const e = window.__fly.eye();
  return { lng: e.lng, lat: e.lat };
});
const metres = (a, b) =>
  Math.hypot((b.lat - a.lat) * 111320,
             (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));

/**
 * Focus is SET EXPLICITLY, not clicked into. A click would reproduce the
 * platform difference that hid the bug — the point is to test the code path,
 * on any OS.
 *
 * Keys go through real dispatched events on the focused element so that
 * `e.target` is the widget, which is the only thing the guard looks at.
 */
async function flyWith(selector, code = 'KeyW', ms = 1400) {
  await page.evaluate(sel => {
    const el = sel ? document.querySelector(sel) : null;
    if (el) el.focus(); else document.activeElement && document.activeElement.blur();
  }, selector);
  await page.waitForTimeout(250);
  const before = await eye();
  await page.evaluate(c => {
    const t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
  }, code);
  await page.waitForTimeout(ms);
  await page.evaluate(c => {
    const t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
  }, code);
  await page.waitForTimeout(1200);          // let the glide finish
  const after = await eye();
  return metres(before, after);
}

const MOVED = 5;   // metres. A real W burst covers tens of metres; drift is <1.

const free = await flyWith(null);
check('camera flies with nothing focused', free > MOVED, `moved ${free.toFixed(1)} m`);

// The reported bug, verbatim: touch the daylight slider, then try to move.
await page.evaluate(() => {
  const el = document.getElementById('tod-slider');
  el.focus();
  el.value = '0.78';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(1200);
const afterSlider = await flyWith('#tod-slider');
check('camera still flies after moving the daylight slider',
  afterSlider > MOVED, `moved ${afterSlider.toFixed(1)} m with #tod-slider focused`);

const afterButton = await flyWith('#tod-play');
check('camera still flies with the play button focused',
  afterButton > MOVED, `moved ${afterButton.toFixed(1)} m with #tod-play focused`);

const afterCheckbox = await flyWith('#debug-toggle');
check('camera still flies with the debug checkbox focused',
  afterCheckbox > MOVED, `moved ${afterCheckbox.toFixed(1)} m with #debug-toggle focused`);

// The guard's real job: the slider's own keys must stay the slider's.
{
  await page.evaluate(() => {
    const el = document.getElementById('tod-slider');
    el.focus(); el.value = '0.50';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const before = await eye();
  const prevented = await page.evaluate(() => {
    const el = document.getElementById('tod-slider');
    const ev = new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    el.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight', bubbles: true }));
    return ev.defaultPrevented;
  });
  await page.waitForTimeout(1400);
  const after = await eye();
  const drift = metres(before, after);
  check('arrow keys still belong to the slider, not the camera',
    !prevented && drift < 1.5,
    `defaultPrevented=${prevented}, camera drifted ${drift.toFixed(2)} m (want not-prevented and <1.5)`);
}

/**
 * The latch. Press over the canvas, release over the widget — the old keyup
 * guard dropped the release and the camera never stopped.
 */
{
  await page.evaluate(() => {
    document.activeElement && document.activeElement.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const el = document.getElementById('tod-slider');
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
  });
  await page.waitForTimeout(2000);                 // glide out
  const a = await eye();
  await page.waitForTimeout(2000);
  const b = await eye();
  const drift = metres(a, b);
  check('a key released over a widget does not latch down',
    drift < 1.5, `camera drifted ${drift.toFixed(2)} m two seconds after release (want <1.5)`);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

check('no uncaught page errors', pageErrors.length === 0,
  pageErrors.slice(0, 3).join(' | ') || 'none');

const pass = results.filter(r => r.pass).length;
console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${pass}/${results.length} passed`);

await browser.__done();
if (pass !== results.length) process.exit(1);
