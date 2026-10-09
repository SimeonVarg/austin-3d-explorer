// Keyless companion acceptance, using its own installed browser library.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GEV_COMPANION_ROOT;
assert.ok(root, 'GEV_COMPANION_ROOT must select the reviewed external checkout');
const { default: puppeteer } = await import(pathToFileURL(path.join(root, 'node_modules/puppeteer/lib/puppeteer/puppeteer.js')));
const [base, output] = process.argv.slice(2);
assert.ok(base && output, 'server URL and private output folder are required');
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const kill = () => {
  const pid = browser.process()?.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') browser.process().kill('SIGKILL');
    else process.kill(-pid, 'SIGKILL');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
};
const watchdog = setTimeout(kill, 180_000);
const interrupt = () => { kill(); process.exit(130); };
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => window.cancelGraphicsAutoDetect?.());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?welcome=0#v=2&lat=30.285&lon=-97.74&alt=1100&heading=0&pitch=-55&style=normal&map=esri-imagery`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log('Loaded companion page');
  await page.waitForFunction(() => window.__godsEyeView?.voiceCommands, { timeout: 90_000 });
  console.log('Application tools ready');
  await page.evaluate(async () => {
    const entry = [...document.scripts].find(script => /\/src\/main\.js(?:\?|$)/.test(script.src));
    const { application } = await import(entry.src);
    window.__companionApplication = application;
    const app = window.__godsEyeView;
    await app.styleManager.initialRestorePromise;
    // This acceptance is for reference viewing; no live layer readiness claim.
    for (const [id] of app.dataManager.layers) await app.dataManager.setEnabled(id, false);
  });
  console.log('Camera restored; waiting for aerial tiles');
  await page.waitForFunction(() => window.__godsEyeView.viewer.scene.globe.tilesLoaded, { timeout: 60_000 });
  await new Promise(resolve => setTimeout(resolve, 4000));
  const before = await page.evaluate(() => {
    const app = window.__godsEyeView;
    const camera = app.viewer.camera;
    const carto = camera.positionCartographic;
    const gl = app.viewer.scene.canvas.getContext('webgl2') || app.viewer.scene.canvas.getContext('webgl');
    const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    const credit = document.querySelector('#cesium-credits');
    return {
      ready: window.__companionApplication.getState().status,
      photorealTileset: Boolean(app.tileset),
      imageryCount: app.viewer.imageryLayers.length,
      tilesLoaded: app.viewer.scene.globe.tilesLoaded,
      eye: { lat: carto.latitude * 180 / Math.PI, lon: carto.longitude * 180 / Math.PI, alt: carto.height, pitch: camera.pitch * 180 / Math.PI },
      credits: credit?.textContent,
      creditsVisible: Boolean(credit && [...credit.querySelectorAll('*')].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })),
      effectiveVerticalFov: camera.frustum.fovy * 180 / Math.PI,
      renderer: rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    };
  });
  fs.writeFileSync(path.join(output, 'startup.json'), JSON.stringify(before, null, 2));
  await page.screenshot({ path: path.join(output, 'austin-reference-first.png') });
  await new Promise(resolve => setTimeout(resolve, 1500));
  await page.screenshot({ path: path.join(output, 'austin-reference.png') });
  assert.equal(before.ready, 'ready');
  assert.equal(before.photorealTileset, false, 'keyless route must not contain Google 3D');
  assert.ok(before.imageryCount > 0);
  assert.ok(before.tilesLoaded);
  assert.ok(before.creditsVisible);
  assert.match(before.credits, /Esri/i, 'aerial source attribution must be visible');
  assert.ok(Math.abs(before.eye.lat - 30.285) < 0.001, 'latitude restored from share pose');
  assert.ok(Math.abs(before.eye.lon + 97.74) < 0.001, 'longitude restored from share pose');
  assert.ok(Math.abs(before.eye.alt - 1100) < 2, 'ellipsoidal altitude restored');
  assert.ok(Math.abs(before.eye.pitch + 55) < 0.1, 'view pitch restored');
  const after = await page.evaluate(async () => {
    const app = window.__godsEyeView;
    const application = window.__companionApplication;
    await application.destroy();
    return {
      status: application.getState().status,
      viewerDestroyed: app.viewer.isDestroyed(),
      layers: app.dataManager.layers.size,
      governor: app.getRenderGovernorDiagnostics(),
      debugRemoved: !window.__godsEyeView,
    };
  });
  assert.equal(after.status, 'destroyed');
  assert.ok(after.viewerDestroyed);
  assert.equal(after.layers, 0);
  assert.equal(after.governor.installed, false);
  assert.deepEqual(after.governor.holds, []);
  assert.ok(after.debugRemoved);
  assert.deepEqual(errors, [], 'browser runtime errors');
  fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ before, after, errors }, null, 2));
  console.log('PASS: keyless Austin aerials, camera pose, visible credits, source readiness and full teardown');
} finally {
  clearTimeout(watchdog);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  let closeTimeout;
  try {
    await Promise.race([
      browser.close(),
      new Promise(resolve => { closeTimeout = setTimeout(() => { kill(); resolve(); }, 5000); }),
    ]);
  } finally { clearTimeout(closeTimeout); }
}
