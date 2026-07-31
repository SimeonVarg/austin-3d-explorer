/**
 * drift-check.mjs — the idle cinema and the photo key, against the REAL page.
 *
 * Loads index.html?intro=0 (the flight is verified separately; skipping it puts
 * the idle countdown on a known clock), waits out DRIFT.idleMs, and asserts:
 *   1. the camera starts drifting on its own (bearing moves, easing active)
 *   2. the hour creeps while it drifts
 *   3. any input stops the drift immediately
 *   4. P toggles the chrome away and back
 * Wall-clock waits are fine here: the drift is wall-clock scheduled.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import path from 'node:path';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
let pass = 0, fail = 0;
const check = (ok, name, detail) => {
  console.log(`${ok ? ' PASS ' : '*FAIL '} ${name}${detail ? `\n         ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await page.goto(SERVER + '/index.html?intro=0', { timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const pose = () => page.evaluate(() => ({
  b: window.__map.getBearing(), z: window.__map.getZoom(),
  p: window.__todCurrentP, easing: window.__map.isEasing(),
}));

// 1+2: wait out the idle window, then sample twice.
await page.waitForTimeout(28000);
const a = await pose();
await page.waitForTimeout(9000);
const b = await pose();
const moved = Math.abs(b.b - a.b);
check(moved > 2 || (a.easing && b.easing), 'camera drifts on its own after the idle window',
  `bearing ${a.b.toFixed(1)} -> ${b.b.toFixed(1)} (moved ${moved.toFixed(1)}deg), easing ${a.easing}/${b.easing}`);
check(b.p > a.p - 1e-9 && b.p !== a.p, 'the hour creeps while drifting',
  `p ${a.p} -> ${b.p}`);
await page.screenshot({ path: path.resolve('shots/drift-mid.png'), timeout: 120000 });

// 3: real input stops it.
await page.mouse.move(450, 350);
await page.mouse.wheel(0, -120);
await page.waitForTimeout(2500);
const c = await pose();
await page.waitForTimeout(8000);
const d = await pose();
check(!d.easing && Math.abs(d.b - c.b) < 0.5, 'input stops the drift (no re-drift inside the idle window)',
  `easing ${c.easing}->${d.easing}, bearing ${c.b.toFixed(1)}->${d.b.toFixed(1)}`);

// 4: P toggles chrome.
const hudVisible = () => page.evaluate(() => {
  const el = document.getElementById('hud');
  return !!(el && el.offsetParent !== null);
});
const before = await hudVisible();
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
const hidden = await hudVisible();
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
const restored = await hudVisible();
check(before && !hidden && restored, 'P toggles photo mode (chrome away and back)',
  `visible ${before} -> ${hidden} -> ${restored}`);

console.log(`\n${pass}/${pass + fail} passed`);
await browser.__done();
process.exit(fail ? 1 : 0);
