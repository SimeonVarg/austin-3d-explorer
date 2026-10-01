import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const require = createRequire(new URL('./package.json', import.meta.url));
const { chromium } = require('playwright-core');
const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
const origin = new URL(option('url') || BASE).origin;
const output = option('out');
const label = option('label') || 'sunset';
const results = [];
const sunset = 0.5;
// The level view (84) and one looking down (66). The cold band the owner saw
// GREW as the camera tilted down, which the level view alone never showed.
const PITCHES = [84, 66];
// The coolest clear horizon column must be at least this warm (red minus blue).
// The band the owner saw measured -13 (pale blue, desktop level), 42 and 51
// (dusty pink, phone) before the fix. Tilted down on a desktop the widest view
// puts its coolest column at the screen edge, ~27 degrees off the sun, where
// the glow is honestly fainter: tan (192, 148, 113) = 76 after the fix. So the
// tilted view gets its own bar, still above every pre-fix frame.
const MIN_WARMTH = { 84: 90, 66: 60 };
let browser;

try {
  if (output) await mkdir(output, { recursive: true });
  // No maxMs here: the watchdog takes VERIFY_MAX_MS, which CI sets from this
  // check's ceiling (SwiftShader needs more than 5 min). Four views on a GPU
  // take about 6 min on the owner's laptop; the 5 min default killed the last
  // one, so raise it only when nothing has set it (chrome.mjs reads it at
  // launch time).
  process.env.VERIFY_MAX_MS ||= '600000';
  browser = await launch(chromium, { gl: 'hardware' });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const device = viewport.width === 390 ? 'phone' : 'desktop';
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('austin3d.gfx.v1', JSON.stringify({ autoExposure: false, grain: 0 }));
      const cancel = setInterval(() => {
        if (typeof window.cancelGraphicsAutoDetect === 'function') {
          window.cancelGraphicsAutoDetect();
          clearInterval(cancel);
        }
      }, 20);
      setTimeout(() => clearInterval(cancel), 60000);
    });
    await page.goto(origin + '/?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__map?.isStyleLoaded() && window.skyBodies && window.applyTimeOfDay);
    const pose = await page.evaluate(progress => {
      window.cancelGraphicsAutoDetect();
      window.GFX.autoExposure = false;
      window.GFX.grain = 0;
      window.applyGraphics();
      const map = window.__map;
      const camera = { center: [-97.7315, 30.285], zoom: 15.5, pitch: 84, bearing: window.skyBodies(progress).sun.az };
      map.jumpTo(camera);
      window.applyTimeOfDay(map, progress, true);
      return camera;
    }, sunset);
    await page.waitForFunction(() => {
      const map = window.__map;
      return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roofscape',
        'austin-tower', 'austin-westcampus', 'austin-drag', 'austin-arts']
        .every(id => map.getSource(id) && map.isSourceLoaded(id));
    }, null, { timeout: 90000 });
    await page.waitForTimeout(5000);
    for (const pitch of PITCHES) {
      await page.evaluate(camera => window.__map.jumpTo(camera), { ...pose, pitch });
      await page.waitForTimeout(2500);
      // A software-rendered full-city frame (CI has no GPU) can take far longer
      // than 20 s to capture; the colour it measures is the same either way.
      await page.screenshot({ timeout: 90000 });
      await page.waitForTimeout(1000);
      const frame = await page.screenshot({ timeout: 90000 });
      const measurement = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        image.close();
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const map = window.__map;
        const bounds = map.getCanvas().getBoundingClientRect();
        const fov = map.getVerticalFieldOfView();
        const horizon = bounds.top + bounds.height * (0.5 - 0.5 *
          Math.tan((90 - map.getPitch()) * Math.PI / 180) / Math.tan(fov * Math.PI / 360));
        const skyHorizon = bounds.top + window.skyFrame.horizonPx;
        if (!Number.isFinite(fov) || Math.abs(horizon - skyHorizon) > 1 || horizon < 24 || horizon >= canvas.height) {
          throw new Error('Invalid horizon: geometric ' + horizon + ', sky ' + skyHorizon + ', FOV ' + fov);
        }
        const pixel = (column, row) => {
          const offset = (row * canvas.width + column) * 4;
          return [data[offset], data[offset + 1], data[offset + 2]];
        };
        const rows = [3, 6, 9].map(offset => Math.floor(horizon) - offset);
        const columns = [];
        let tested = 0;
        for (let column = Math.ceil(bounds.left + bounds.width * 0.06);
          column < bounds.left + bounds.width * 0.94; column += 4) {
          tested++;
          const patches = rows.map(row => {
            const values = [];
            for (let horizontal = -2; horizontal <= 2; horizontal++) {
              values.push(pixel(column + horizontal, row));
            }
            return values;
          });
          const samples = patches.flat();
          const smooth = patches.every(values => [0, 1, 2].every(channel =>
            Math.max(...values.map(value => value[channel])) - Math.min(...values.map(value => value[channel])) <= 8));
          let skyContinuous = true;
          for (let row = Math.max(0, Math.floor(horizon) - 80); row < rows[0]; row++) {
            const above = pixel(column, row), below = pixel(column, row + 1);
            if (above.some((value, channel) => Math.abs(value - below[channel]) > 12)) skyContinuous = false;
          }
          const clear = smooth && skyContinuous && samples.every(([red, green, blue]) => red > 100 && green > 90 && blue > 40);
          const unobscured = rows.every(row => !document.elementsFromPoint(column, row)
            .some(element => element.closest('#tod-panel, #gfx-panel, button, [role="dialog"]')));
          if (!clear || !unobscured) continue;
          const rgb = [0, 1, 2].map(channel => samples.reduce((sum, value) => sum + value[channel], 0) / samples.length);
          const warmth = Math.min(...patches.map(values => values.reduce((sum, value) => sum + value[0] - value[2], 0) / values.length));
          columns.push({ column, rgb, warmth });
        }
        columns.sort((left, right) => left.warmth - right.warmth);
        return { fov, horizon, rows, tested, clearColumns: columns.length, coolest: columns[0] || null,
          time: window.__todCurrentP, sun: window.skyFrame.sun, mapSky: map.getSky(),
          graphics: { exposure: window.GFX.exposure, autoExposure: window.GFX.autoExposure, grain: window.GFX.grain },
          sourceBuildings: map.getSource('austin-buildings')?._data?.features?.length ?? null };
      }, frame.toString('base64'));
      const pass = measurement.clearColumns >= Math.ceil(measurement.tested * 0.2) &&
        measurement.coolest?.warmth >= MIN_WARMTH[pitch] && Math.abs(measurement.time - sunset) < 0.001 && errors.length === 0;
      const result = { device, viewport, pose: { ...pose, pitch }, ...measurement, errors, pass };
      results.push(result);
      console.log((pass ? ' PASS ' : '*FAIL ') + device + ' tilt ' + pitch + ': coolest clear horizon R-B = ' +
        (measurement.coolest?.warmth.toFixed(2) ?? 'missing') + ' (need >= ' + MIN_WARMTH[pitch] + '); ' +
        measurement.clearColumns + '/' + measurement.tested + ' clear columns; horizon y=' +
        measurement.horizon.toFixed(2) + '; FOV=' + measurement.fov);
      if (output) {
        await writeFile(path.join(output, label + '-' + device + '-' + pitch + '.png'), frame);
        await writeFile(path.join(output, label + '-' + device + '-' + pitch + '.json'), JSON.stringify(result, null, 2));
      }
    }
    await context.close();
  }
} catch (error) {
  results.push({ pass: false, error: String(error.stack || error) });
  console.error('*FAIL  sunset-band: ' + (error.stack || error));
} finally {
  if (browser) await browser.__done();
}
if (output) await writeFile(path.join(output, label + '-report.json'), JSON.stringify({ origin, sunset, results }, null, 2));
console.log('\n' + results.filter(result => result.pass).length + '/' + results.length + ' passed');
process.exitCode = results.length === 2 * PITCHES.length && results.every(result => result.pass) ? 0 : 1;
