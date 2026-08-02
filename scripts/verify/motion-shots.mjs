/**

 * motion-shots.mjs — visual proof for the camera feel pass. Saves to shots/:

 *

 *   motion-bank-day-level.png / motion-bank-day-turn.png

 *       spawn pitch, level vs mid-turn at near max bank (LOOK: horizon banks)

 *   motion-bank-dusk-level.png / motion-bank-dusk-turn.png

 *       golden hour facing the sun, level vs banked (LOOK: does the
 *       screen-space sky overlay shear against the banked world at BANK_MAX?)

 *   motion-fov-rest.png / motion-fov-sprint.png

 *       same pose at rest vs at full sprint (LOOK: wider FOV under speed)

 *

 * Prints the measured roll / FOV at each capture so the pictures can be tied

 * to numbers. Screenshots land in shots/ (gitignored).

 */

import { chromium } from 'playwright-core';

import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

import fs from 'node:fs';

import path from 'node:path';

import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

fs.mkdirSync(DIR, { recursive: true });

const browser = await launch(chromium);

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });

await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });

await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 30000 });

await page.waitForTimeout(4000);

await page.evaluate(() => {
  window.__raf = () => new Promise(r => requestAnimationFrame(r));
  window.__settle = async (n = 400) => {
    for (let i = 0; i < n; i++) { if (!window.__fly.eye().driving) return true; await window.__raf(); }
    return false;
  };
  window.__key = (code, down) => window.dispatchEvent(
    new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  window.__drag = { id: 91, x: 0, y: 0 };
  window.__dragStart = (x, y) => {
    window.__drag.x = x; window.__drag.y = y;
    window.__map.getCanvas().dispatchEvent(new PointerEvent('pointerdown', { pointerId: 91,
      pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
  };
  window.__dragMove = (dx, dy) => {
    window.__drag.x += dx; window.__drag.y += dy;
    window.__map.getCanvas().dispatchEvent(new PointerEvent('pointermove', { pointerId: 91,
      pointerType: 'mouse', clientX: window.__drag.x, clientY: window.__drag.y,
      movementX: dx, movementY: dy, bubbles: true, cancelable: true, isPrimary: true }));
  };
  window.__dragEnd = () => {
    window.__map.getCanvas().dispatchEvent(new PointerEvent('pointerup', { pointerId: 91,
      pointerType: 'mouse', clientX: window.__drag.x, clientY: window.__drag.y,
      bubbles: true, cancelable: true, isPrimary: true }));
  };
});

async function shot(name) {
  await page.screenshot({ path: path.join(DIR, name) });
  const s = await page.evaluate(() => ({
    roll: window.__map.getRoll(), fov: window.__map.getVerticalFieldOfView(),
    bearing: +window.__map.getBearing().toFixed(1), pitch: +window.__map.getPitch().toFixed(1),
  }));
  console.log(`${name}: roll ${s.roll.toFixed(2)} deg, fov ${s.fov.toFixed(2)}, bearing ${s.bearing}, pitch ${s.pitch}`);
  return s;
}

/** Sustain a fast look-drag until |roll| >= target (or frames run out). */

async function turnUntilRoll(target, maxFrames = 120) {
  return page.evaluate(async ([tgt, maxF]) => {
    window.__dragStart(640, 360);
    let got = 0;
    for (let i = 0; i < maxF; i++) {
      window.__dragMove(-30, 0);                    // leftward drag = bearing rises = right turn = +roll
      await window.__raf();
      got = window.__map.getRoll();
      if (Math.abs(got) >= tgt) break;
    }
    return got;
  }, [target, maxFrames]);
}

async function endTurn() {
  await page.evaluate(async () => {
    window.__dragEnd();
    for (let i = 0; i < 200; i++) { await window.__raf(); if (window.__map.getRoll() === 0) break; }
  });
}

// ── 1. Day bank at spawn pitch ──

await page.evaluate(() => window.__settle());

await shot('motion-bank-day-level.png');

const dayRoll = await turnUntilRoll(4.2);

await shot('motion-bank-day-turn.png');

await endTurn();

console.log(`day turn captured at roll ${dayRoll.toFixed(2)} deg`);

// ── 2. Dusk bank facing the sun (worst case for overlay shear) ──

await page.evaluate(async () => {
  await window.__settle();
  const p = 0.74;                                   // golden hour
  window.applyTimeOfDay(window.__map, p, true);
  const az = window.skyBodies(p).sun.az;
  // face the sun by dragging bearing there (stays inside the controller's rules)
  const m = window.__map;
  const err = () => ((az - m.getBearing() + 540) % 360) - 180;
  window.__dragStart(640, 360);
  for (let i = 0; i < 300 && Math.abs(err()) > 3; i++) {
    window.__dragMove(Math.max(-40, Math.min(40, -err() * 2)), 0);
    await window.__raf();
  }
  window.__dragEnd();
});

await page.evaluate(() => window.__settle());

await page.waitForTimeout(2500);                    // let the ToD style/paint settle

await shot('motion-bank-dusk-level.png');

const duskRoll = await turnUntilRoll(4.2, 40);      // short turn so the sun stays near frame

await shot('motion-bank-dusk-turn.png');

await endTurn();

console.log(`dusk turn captured at roll ${duskRoll.toFixed(2)} deg`);

// ── 3. FOV rest vs sprint ──

await page.evaluate(() => window.__settle());

// climb clear of the brakes so the sprint is sustained

await page.evaluate(async () => {
  window.__key('KeyQ', true);
  for (let i = 0; i < 25; i++) await window.__raf();
  window.__key('KeyQ', false);
  await window.__settle(600);
});

await shot('motion-fov-rest.png');

await page.evaluate(async () => {
  window.__key('ShiftLeft', true);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', shiftKey: true, bubbles: true }));
  for (let i = 0; i < 45; i++) await window.__raf();
});

await shot('motion-fov-sprint.png');

await page.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
  window.__key('ShiftLeft', false);
});

await browser.__done();

console.log('done — LOOK at the files in scripts/verify/shots/');
