import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { BASE, launch } from './chrome.mjs';

const require = createRequire(new URL('./package.json', import.meta.url));
const { chromium } = require('playwright-core');
const argv = process.argv.slice(2);
const option = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const profile = option('--profile', 'desktop');
if (!['desktop', 'phone'].includes(profile)) throw new Error('Use --profile desktop or phone');
const output = path.resolve(option('--out', 'context-restore-local'));
fs.mkdirSync(output, { recursive: true });

// Decode lossless screenshot pixels without an additional test dependency.
function decodePNG(buffer) {
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('Unsupported screenshot PNG');
    }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    const filter = packed[row * (stride + 1)];
    for (let column = 0; column < stride; column++) {
      const left = column >= channels ? pixels[row * stride + column - channels] : 0;
      const up = row ? pixels[(row - 1) * stride + column] : 0;
      const corner = row && column >= channels ? pixels[(row - 1) * stride + column - channels] : 0;
      const estimate = left + up - corner;
      const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - corner)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : corner;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      if (predictor === undefined) throw new Error('Unsupported PNG filter');
      pixels[row * stride + column] = packed[row * (stride + 1) + column + 1] + predictor;
    }
  }
  return { width, height, channels, pixels };
}

function difference(first, second) {
  const baseline = decodePNG(first), candidate = decodePNG(second);
  if (baseline.width !== candidate.width || baseline.height !== candidate.height) throw new Error('Frame size changed');
  let changed = 0, significant = 0, maximum = 0;
  const total = baseline.width * baseline.height;
  for (let pixel = 0; pixel < total; pixel++) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) delta = Math.max(delta, Math.abs(baseline.pixels[pixel * baseline.channels + channel] - candidate.pixels[pixel * candidate.channels + channel]));
    if (delta) changed++;
    if (delta > 12) significant++;
    maximum = Math.max(maximum, delta);
  }
  return { changed, significant, total, changedFraction: changed / total, significantFraction: significant / total, maximum };
}

const report = { profile, base: BASE, viewport: profile === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 }, checks: [], pageErrors: [], consoleErrors: [], reloads: 0, recoveryRequests: [] };
const check = (name, pass, detail) => report.checks.push({ name, pass: !!pass, detail });
// No maxMs here: the watchdog then takes VERIFY_MAX_MS, which CI sets from
// this check's ceiling (SwiftShader needs more than 5 min), and defaults to
// 5 min on a GPU, where a run takes about 1.
const browser = await launch(chromium, { gl: 'hardware' });
try {
  const context = await browser.newContext({ viewport: report.viewport, screen: report.viewport, isMobile: profile === 'phone', hasTouch: profile === 'phone', deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  let navigations = 0, recovering = false;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  page.on('request', request => { if (recovering && /\/data\/[^?]+\.json(?:\?|$)/.test(request.url())) report.recoveryRequests.push(request.url()); });
  await page.addInitScript(() => {
    const cancel = () => {
      if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect();
      else setTimeout(cancel, 20);
    };
    cancel();
  });
  await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map?.isStyleLoaded() && window.slopes?.renderer && window.slopesApartments?.count.done, null, { timeout: 150000 });
  await page.evaluate(() => {
    window.cancelGraphicsAutoDetect();
    const slider = document.getElementById('tod-slider');
    if (slider) {
      slider.value = '0.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.__map.jumpTo({ center: [-97.7404, 30.2851], zoom: 16.25, pitch: 68, bearing: -100 });
  });
  const settle = async () => {
    await page.waitForFunction(() => {
      const map = window.__map;
      if (!map?.isStyleLoaded()) return false;
      return Object.keys(map.getStyle().sources).filter(name => /^austin-/.test(name)).every(name => map.isSourceLoaded(name));
    }, null, { timeout: 45000 });
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => !document.getElementById('veil') || document.getElementById('veil').classList.contains('lift'), null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    // The shadow model is built from the tiles MapLibre is drawing. After a
    // restore those tiles return over several frames, and on CI's SwiftShader
    // (about one frame a second) the model can sit idle between two partial
    // builds: CI once compared a 368k-triangle model against the 401k one it
    // replaced. Wait until two readings 4 s apart agree.
    let last = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForFunction(() => !window.CityLighting?.stats.shadowProxyBuilding, null, { timeout: 90000 });
      const now = await page.evaluate(() => JSON.stringify(window.CityLighting?.proxyHash()));
      if (now === last) break;
      last = now;
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(1500);
  };
  // CI renders on SwiftShader (no GPU): one 1440x900 frame of the full city
  // took over 15 s there, so a screenshot gets 90 s. On a GPU it takes < 1 s.
  const capture = async name => {
    await page.screenshot({ timeout: 90000 });
    await page.waitForTimeout(700);
    return page.screenshot({ path: path.join(output, name + '.png'), timeout: 90000 });
  };
  const state = () => page.evaluate(() => ({
    layer: !!window.__map?.getLayer('slopes-mesh'), renderer: !!window.slopes?.renderer,
    contextBound: !!window.slopes?.renderer && window.slopes.renderer.getContext() === window.__map.painter.context.gl,
    frames: window.slopes?.frames, triangles: window.slopes?.stats().triangles,
    buildings: window.slopesApartments?.count.buildings, done: window.slopesApartments?.count.done,
    phone: !!window.LITE_PROFILE?.on, tier: window.LITE_PROFILE?.tierName,
    unavailable: !!window.LITE_PROFILE?.sceneUnavailable, shadows: window.slopes?.sunlightStats(),
    proxyHash: window.CityLighting?.proxyHash(), lighting: window.CityLighting?.stats,
    camera: { center: window.__map.getCenter().toArray(), zoom: window.__map.getZoom(), pitch: window.__map.getPitch(), bearing: window.__map.getBearing() },
    sunMatrices: ['u_sunShadowMatrix0', 'u_sunShadowMatrix1'].map(name => window.slopes.uniforms()[name].value.elements.slice()),
    layerOrder: window.__map.getLayersOrder(),
    sharedUniforms: Object.fromEntries(Object.entries(window.slopes.uniforms()).filter(([name, slot]) => typeof slot.value === 'number' || slot.value?.toArray).map(([name, slot]) => [name, slot.value?.toArray ? slot.value.toArray() : slot.value])),
    eye: window.slopes.uniforms().u_eye.value.toArray(),
  }));
  await settle();
  report.before = await state();
  check('requested touch profile', report.before.phone === (profile === 'phone'), report.before);
  check('authored city present before loss', report.before.layer && report.before.renderer && report.before.triangles > 100000 && report.before.done, report.before);
  if (profile === 'phone') {
    // A phone drops each mesh's CPU copy after upload (~260 MB), so it cannot
    // re-upload in place; its recovery is the reload in js/mobile.js. Assert
    // that contract instead of forcing a loss.
    const phone = await page.evaluate(() => ({ freeGeometryCpu: !!window.LITE_PROFILE?.budget?.freeGeometryCpu, canRestoreContext: window.slopes?.canRestoreContext }));
    check('phone keeps its memory saving and reload recovery', phone.freeGeometryCpu && phone.canRestoreContext === false, phone);
    check('no uncaught page errors', report.pageErrors.length === 0, report.pageErrors);
  } else {
    const still = await capture('still');
    await page.waitForTimeout(4000);
    const settled = await capture('settled');
    report.before = await state();
    report.noise = difference(still, settled);
    // Exclude tiny channel differences, then allow twice measured temporal noise
    // or its value plus 0.01% of the frame. Fail rather than accept a noisy view.
    report.noiseFloor = Math.max(report.noise.significantFraction * 2, report.noise.significantFraction + 0.0001);
    check('still scene has a usable noise floor', report.noiseFloor < 0.01, report.noise);
    report.navigationBaseline = navigations;
    report.autoReloadSuppressed = argv.includes('--suppress-auto-reload');
    if (report.autoReloadSuppressed) await page.evaluate(() => sessionStorage.setItem('flyover.autoreload', String(Date.now())));
    recovering = true;
    await page.evaluate(() => {
      const canvas = window.__map.getCanvas();
      const gl = window.__map.painter.context.gl;
      const extension = gl.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('WEBGL_lose_context is unavailable');
      window.__restoreCheck = { lost: false, restored: false, root: window.slopes.root, renderer: window.slopes.renderer };
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); window.__restoreCheck.lost = true; }, { once: true });
      canvas.addEventListener('webglcontextrestored', () => { window.__restoreCheck.restored = true; }, { once: true });
      window.__restoreCheck.extension = extension;
      extension.loseContext();
    });
    await page.waitForFunction(() => window.__restoreCheck?.lost, null, { timeout: 15000 });
    // THE STYLELESS GAP. Until the restore, MapLibre has destroyed the style
    // (map.style is null). On CI's slow renderer a texture refresh on a timer
    // landed in that gap and threw "reading 'getImage'". Move the clock in the
    // gap on purpose, from timers as the app's own refreshes run, so every
    // machine exercises it; then put it back so the light check below holds.
    await page.evaluate(() => {
      const p = window.__todCurrentP;
      setTimeout(() => window.applyTimeOfDay(window.__map, (p + 0.08) % 1, true), 0);
      setTimeout(() => window.applyTimeOfDay(window.__map, p, true), 300);
    });
    await page.waitForTimeout(1000);
    const started = Date.now();
    await page.evaluate(() => window.__restoreCheck.extension.restoreContext());
    await page.waitForFunction(() => window.__restoreCheck?.restored, null, { timeout: 90000 }).catch(error => check('restored original document', false, error.message));
    await settle();
    const after = await capture('after-restore');
    report.restoreMs = Date.now() - started;
    report.after = await state();
    report.restoreDifference = difference(settled, after);
    report.reloads = navigations - report.navigationBaseline;
    check('city pixels recover within measured noise', report.restoreDifference.significantFraction <= report.noiseFloor, report.restoreDifference);
    check('custom layer and renderer return', report.after.layer && report.after.renderer && report.after.contextBound && report.after.frames > 0 && !report.after.unavailable && report.after.triangles >= report.before.triangles, report.after);
    check('original CPU scene retained', await page.evaluate(() => window.__restoreCheck?.root === window.slopes?.root), 'same scene object');
    check('no page reload', report.reloads === 0, report.reloads);
    check('no city data requested during restoration', report.recoveryRequests.length === 0, report.recoveryRequests);
    check('shadow maps rebuilt', report.before.shadows.shadowMaps === 0 || report.after.shadows.shadowMaps === report.before.shadows.shadowMaps && report.after.shadows.shadowMapRenders > 0, report.after.shadows);
    check('same camera after restoration', JSON.stringify(report.before.camera) === JSON.stringify(report.after.camera), report.after.camera);
    check('time-of-day light retained', ['u_lightpos', 'u_lightcolor', 'u_lightintensity'].every(name => JSON.stringify(report.before.sharedUniforms[name]) === JSON.stringify(report.after.sharedUniforms[name])), 'evaluated light uniforms');
    check('new renderer created', await page.evaluate(() => window.__restoreCheck?.renderer !== window.slopes?.renderer), 'fresh GPU state');
    recovering = false;
    await page.evaluate(() => {
      window.__visibilityCheck = [];
      document.addEventListener('visibilitychange', () => window.__visibilityCheck.push(document.visibilityState));
    });
    const client = await page.context().newCDPSession(page);
    // Headless tabs stay visible: emulate the visibility handlers, but freeze
    // and thaw the actual renderer. Do not claim a physical background-tab test.
    const visibility = async value => page.evaluate(value => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, value);
    await visibility('hidden');
    await client.send('Page.setWebLifecycleState', { state: 'frozen' });
    await page.waitForTimeout(1500);
    await client.send('Page.setWebLifecycleState', { state: 'active' });
    await visibility('visible');
    await client.detach();
    await settle();
    const shown = await capture('after-hide-show');
    report.hideShowDifference = difference(after, shown);
    report.visibility = await page.evaluate(() => window.__visibilityCheck);
    report.visibilityMode = 'headless visibility emulation plus CDP renderer freeze/thaw';
    check('hide/show handlers and renderer freeze/thaw exercised', report.visibility.includes('hidden') && report.visibility.includes('visible'), report.visibility);
    check('tab hide/show keeps recovered city', report.hideShowDifference.significantFraction <= report.noiseFloor, report.hideShowDifference);
    check('no uncaught page errors', report.pageErrors.length === 0, report.pageErrors);
  }
} catch (error) {
  check('check completed', false, error.stack);
} finally {
  report.pass = report.checks.length > 0 && report.checks.every(result => result.pass);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  for (const result of report.checks) console.log((result.pass ? 'PASS' : 'FAIL') + ' ' + result.name + ': ' + JSON.stringify(result.detail).slice(0, 600));
  console.log('Noise floor: ' + report.noiseFloor + '; restore difference: ' + report.restoreDifference?.significantFraction + '; ' + (report.pass ? 'PASS' : 'FAIL') + ' ' + profile);
  await browser.__done();
}
process.exitCode = report.pass ? 0 : 1;
