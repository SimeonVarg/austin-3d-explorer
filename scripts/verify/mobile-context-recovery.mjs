// Two real context losses after authored geometry uploads. Desktop Chromium
// touch emulation on hardware GL; not physical iPhone/Safari acceptance.
// Run through the shared gpu-run.mjs, with --out outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const args = process.argv.slice(2), oi = args.indexOf('--out');
assert.ok(oi >= 0 && args[oi + 1], 'Required: --out <outside-repo-directory>');
const OUT = path.resolve(args[oi + 1]);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const relative = path.relative(ROOT, OUT);
assert.ok(relative && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)), '--out must be outside the repository');
fs.mkdirSync(OUT, { recursive: true });
const READY_MS = Number(process.env.MOBILE_REVEAL_MS || 240000);
const WELCH = { center: [-97.73785, 30.2867], zoom: 18.5, pitch: 57, bearing: 22 };
const EXTRUSION_LAYERS = ['buildings-3d', 'buildings-roof', 'campus-storeys', 'wc-wall', 'wc-wall-cap',
  'wc-solid', 'wc-detail', 'roofscape-deck', 'roofscape-major', 'roofscape-minor', 'roofs-pitched',
  'parts-3d', 'parts-roof', 'moody-wall', 'moody-roof', 'moody-plant', 'moody-cap'];
const report = { valid: false, base: BASE, settings: { gl: 'hardware', cpuThrottle: 1, width: 390, height: 844, dpr: 3 },
  limitation: 'Desktop Chromium touch emulation; not physical iPhone, Safari, thermal or performance evidence.',
  events: [], errors: [], consoleErrors: [], checkpoints: [], screens: [], navigationRequests: 0, crashed: false };
const save = () => fs.writeFileSync(path.join(OUT, 'mobile-context-recovery.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, context, page;

function healthy() {
  assert.equal(report.crashed, false, 'page crashed');
  assert.deepEqual(report.errors, [], 'uncaught page errors, including invalid geometry re-upload');
  assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert.ok(report.navigationRequests <= 2, 'more than one automatic reload');
}
async function snapshot() {
  return page.evaluate(ids => {
    const map = window.__map, A = window.slopesApartments, S = window.slopes;
    const gl = map?.painter?.context?.gl;
    const released = { positions: 0, indices: 0, attributes: 0, geometry: 0 };
    A?.group?.traverse(o => {
      const g = o.geometry;
      if (!g) return;
      released.geometry++;
      if (g.attributes.position?.array === null && g.attributes.position.count > 0) released.positions++;
      if (g.index?.array === null && g.index.count > 0) released.indices++;
      for (const a of Object.values(g.attributes)) if (a.array === null && a.count > 0) released.attributes++;
    });
    let ready = false, features = [], extrusions = [], renderer = null;
    const queryErrors = [], extrusionLayers = [];
    try { ready = !!A?.readyToReveal?.(); } catch {}
    if (map?.style && !gl?.isContextLost()) {
      for (const id of ids) if (map.getLayer(id)?.type === 'fill-extrusion') extrusionLayers.push(id);
      const canvas = map.getCanvas(), box = [[0, 0], [canvas.clientWidth, canvas.clientHeight]];
      try { features = map.queryRenderedFeatures(box); } catch (e) { queryErrors.push('all: ' + String(e)); }
      if (extrusionLayers.length) {
        try { extrusions = map.queryRenderedFeatures(box, { layers: extrusionLayers }); }
        catch (e) { queryErrors.push('extrusions: ' + String(e)); }
      }
    }
    if (gl && !gl.isContextLost()) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
    const notice = document.getElementById('lite-notice');
    return { doc: performance.timeOrigin, ready, group: !!A?.group, built: A?.built?.length || 0,
      catalog: A?.data?.buildings?.length || 0, released, slopesOn: !!window.SLOPES?.on,
      fallback: !!S?.contextFallback, profileFallback: !!window.LITE_PROFILE?.contextFallback,
      tier: window.LITE_PROFILE?.tierName, freeCpu: !!window.LITE_PROFILE?.budget?.freeGeometryCpu,
      coarse: matchMedia('(pointer: coarse)').matches, touch: navigator.maxTouchPoints,
      flight: window.__intro?.flight?.state || null, revealed: !!window.__intro?.reason,
      veil: !!document.getElementById('veil'), driving: !!window.__fly?.eye?.().driving, moving: !!map?.isMoving?.(),
      lost: gl ? gl.isContextLost() : null, renderer, mapFrames: window.__packingMapFrames || 0,
      slopesFrames: S?.frames || 0, tiles: !!map?.areTilesLoaded?.(),
      features: features.length, extrusions: extrusions.length, extrusionLayers, queryErrors,
      extrusionHits: Object.fromEntries(extrusionLayers.map(id => [id, extrusions.filter(f => f.layer.id === id).length])),
      center: map?.getCenter()?.toArray(), zoom: map?.getZoom(), pitch: map?.getPitch(), bearing: map?.getBearing(), eye: window.__fly?.eye?.(),
      notice: notice ? { kind: notice.dataset.kind, shown: getComputedStyle(notice).display !== 'none' && notice.getBoundingClientRect().height > 0, text: notice.innerText } : null };
  }, EXTRUSION_LAYERS);
}
async function diagnostics() {
  return page.evaluate(ids => {
    const map = window.__map, layers = [], sources = [], seen = new Set();
    for (const id of ids) {
      const layer = map?.getLayer(id);
      if (!layer) { layers.push({ id, missing: true }); continue; }
      const source = layer.source, sourceLayer = layer.sourceLayer;
      layers.push({ id, type: layer.type, source, sourceLayer, minzoom: layer.minzoom, maxzoom: layer.maxzoom,
        visibility: map.getLayoutProperty(id, 'visibility'), filterBytes: JSON.stringify(map.getFilter(id) || []).length });
      const key = source + '/' + (sourceLayer || '');
      if (!source || seen.has(key)) continue;
      seen.add(key);
      try {
        const features = map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : {});
        sources.push({ source, sourceLayer, loaded: map.isSourceLoaded(source), features: features.length,
          examples: features.slice(0, 3).map(f => ({ id: f.id, name: f.properties?.name, height: f.properties?.height ?? f.properties?.h })) });
      } catch (e) { sources.push({ source, sourceLayer, error: String(e) }); }
    }
    return { layers, sources, hidden: window.slopesApartments?.hidden };
  }, EXTRUSION_LAYERS);
}
async function waitFor(label, predicate, timeout = READY_MS) {
  const start = Date.now(); let lastLog = 0;
  while (Date.now() - start < timeout) {
    healthy();
    let state;
    try { state = await snapshot(); } catch { await sleep(250); continue; }
    report.lastState = state;
    if (Date.now() - lastLog >= 10000) {
      console.log(label, JSON.stringify({ ms: Date.now() - start, tier: state.tier, built: state.built, ready: state.ready, released: state.released.positions, flight: state.flight, driving: state.driving, veil: state.veil, tiles: state.tiles, extrusions: state.extrusions, fallback: state.fallback }));
      save(); lastLog = Date.now();
    }
    if (predicate(state)) { report.checkpoints.push({ label, state }); save(); return state; }
    await sleep(200);
  }
  throw Error(label + ' timed out; last state: ' + JSON.stringify(report.lastState));
}
const full = s => s.ready && s.group && s.built === s.catalog && s.catalog >= 196 && s.slopesOn &&
  s.freeCpu && s.released.positions > 0 && s.released.indices > 0 && s.slopesFrames > 1 && !s.lost;
const atWelch = s => s.center && Math.abs(s.center[0] - WELCH.center[0]) < 2e-6 && Math.abs(s.center[1] - WELCH.center[1]) < 2e-6 &&
  Math.abs(s.zoom - WELCH.zoom) < .02 && Math.abs(s.pitch - WELCH.pitch) < .1 && Math.abs(s.bearing - WELCH.bearing) < .1;
const settledWelch = s => atWelch(s) && !s.driving && !s.moving && !s.veil && s.tiles && !s.lost && !s.queryErrors.length;
async function setWelchPose() {
  await page.evaluate(pose => { window.__map.jumpTo(pose); window.__aeReset?.(); window.__map.triggerRepaint(); }, WELCH);
  return waitFor('settled Welch camera', s => full(s) && settledWelch(s), 60000);
}
async function secondShot(name) {
  await page.screenshot({ path: path.join(OUT, name + '-1.jpg'), type: 'jpeg', quality: 82 });
  await sleep(1200);
  const file = path.join(OUT, name + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  report.screens.push({ name, file, state: await snapshot() }); save(); healthy();
}
async function injectLoss(label) {
  await page.evaluate(label => {
    const map = window.__map, canvas = map.getCanvas(), gl = map.painter.context.gl;
    if (gl.isContextLost() || gl.canvas !== canvas || window.slopes.renderer.getContext() !== gl) throw Error('Expected live shared map context');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) throw Error('WEBGL_lose_context unavailable');
    const emit = type => window.__packingRecoveryEvent({ label, type, doc: performance.timeOrigin, at: performance.now(),
      lost: gl.isContextLost(), slopesOn: window.SLOPES.on, fallback: window.slopes.contextFallback, group: !!window.slopesApartments.group }).catch(() => {});
    for (const type of ['webglcontextlost', 'webglcontextrestored']) canvas.addEventListener(type, () => emit(type), { once: true });
    emit('loss-called');
    ext.loseContext();
    setTimeout(() => { ext.restoreContext(); emit('restore-called'); }, 1000);
  }, label);
}
function assertLoss(label) {
  const lost = report.events.find(e => e.label === label && e.type === 'webglcontextlost');
  const restored = report.events.find(e => e.label === label && e.type === 'webglcontextrestored');
  assert.ok(lost?.lost, label + ': actual loss event required');
  assert.ok(restored && !restored.lost, label + ': actual restore event required');
  assert.ok(!lost.slopesOn && lost.fallback, label + ': invalid meshes must be suspended in the loss event');
  assert.ok(!restored.slopesOn && restored.fallback && !restored.group, label + ': no authored group may upload on restoration');
}

try {
  save();
  browser = await launch(chromium, { gl: 'hardware', maxMs: READY_MS * 2 + 120000 });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  await context.exposeBinding('__packingRecoveryEvent', (_, event) => { report.events.push(event); save(); });
  await context.addInitScript(() => {
    window.__packingMapFrames = 0;
    const probe = setInterval(() => {
      window.cancelGraphicsAutoDetect?.();
      if (window.WAYFIND) window.WAYFIND.on = false;
      if (window.__map && !window.__packingFrameHook) {
        window.__packingFrameHook = true;
        window.__map.on('render', () => window.__packingMapFrames++);
      }
      if (window.cancelGraphicsAutoDetect && window.__packingFrameHook && window.WAYFIND) clearInterval(probe);
    }, 20);
  });
  page = await context.newPage();
  page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) { report.navigationRequests++; save(); } });
  page.on('pageerror', e => { report.errors.push({ message: e.message, stack: e.stack }); save(); });
  page.on('console', m => { if (m.type() === 'error') { report.consoleErrors.push(m.text()); save(); } });
  page.on('crash', () => { report.crashed = true; save(); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const url = new URL('/', BASE); url.search = '?drift=0';
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  report.initial = await waitFor('initial full city', s => full(s) && s.revealed && s.flight === 'flying');
  assert.equal(report.initial.tier, 'phone', 'fresh natural phone profile');
  assert.ok(report.initial.coarse && report.initial.touch > 0, 'touch profile active');
  assert.ok(report.initial.renderer && !/swiftshader|llvmpipe|software/i.test(report.initial.renderer), 'real hardware renderer required');
  await secondShot('phone-before-loss');
  assert.equal((await snapshot()).flight, 'flying', 'first loss must occur during the real opening flight');
  await injectLoss('first');
  report.lighter = await waitFor('reloaded full lighter city', s => s.doc !== report.initial.doc && full(s) && s.tier === 'lighter');
  assertLoss('first');
  assert.equal(report.navigationRequests, 2, 'exactly one automatic reload');
  assert.equal(report.lighter.flight, null, 'lighter tier skips opening flight');
  // A jump during the first page's real flight would cancel the condition that
  // earns a lighter tier. Use the fixed city pose after its genuine reload.
  await waitFor('lighter camera available', s => full(s) && !s.veil && !s.driving && !s.moving);
  report.welch = await setWelchPose();
  await secondShot('lighter-welch');
  // Prove the exact fallback pose and query before damaging the GL context.
  // Authored replacements deliberately filter legacy extrusions while on.
  await page.evaluate(() => { window.SLOPES.on = false; });
  report.referenceFallback = await waitFor('Welch fallback reference', s => settledWelch(s) && !s.slopesOn && !s.group && s.extrusions > 0, 60000);
  assert.equal(report.referenceFallback.fallback, false, 'normal settings probe must not latch context recovery');
  report.referenceDiagnostics = await diagnostics();
  await secondShot('welch-maplibre-reference');
  await page.evaluate(() => { window.SLOPES.on = true; });
  report.beforeSecond = await waitFor('rebuilt and released Welch city', s => full(s) && settledWelch(s));
  await secondShot('lighter-before-loss');
  assert.ok(full(await snapshot()), 'second loss must also have built and released geometry');
  await injectLoss('second');
  report.fallback = await waitFor('restored map fallback', s => s.doc === report.lighter.doc && !s.lost && !s.slopesOn &&
    s.fallback && s.profileFallback && !s.group && settledWelch(s) && s.features > 0 && s.extrusions > 0 && s.notice?.shown && s.notice.kind === 'ctx', 60000);
  assertLoss('second');
  assert.equal(report.navigationRequests, 2, 'exhausted allowance must not navigate again');
  report.recoveredDiagnostics = await diagnostics();
  await secondShot('welch-maplibre-restored');
  const framesBefore = report.fallback.mapFrames;
  await page.evaluate(() => { window.SLOPES.on = true; window.__map.triggerRepaint(); });
  await page.keyboard.down('w');
  try { await sleep(1200); } finally { await page.keyboard.up('w'); }
  report.moved = await waitFor('fallback camera and tiles', s => s.tiles && s.mapFrames > framesBefore + 1 && s.features > 0 && s.extrusions > 0, 60000);
  const a = report.fallback.center, b = report.moved.center;
  report.movementMetres = Math.hypot((b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (b[1] - a[1]) * 111320);
  assert.ok(report.movementMetres >= .5, 'camera input must move the restored map');
  assert.ok(!report.moved.slopesOn && !report.moved.group, 'settings must not revive released geometry');
  await secondShot('restored-fallback');
  await page.locator('#lite-notice button[data-act=close]').click();
  assert.equal(await page.locator('#lite-notice').count(), 0, 'fallback notice must respond to input');
  await sleep(10000);
  report.final = await snapshot();
  assert.equal(report.final.doc, report.lighter.doc, 'same document survives the second loss');
  assert.equal(report.navigationRequests, 2, 'no delayed second reload');
  assert.ok(!report.final.slopesOn && report.final.fallback && !report.final.group && report.final.tiles, 'usable fallback remains');
  healthy(); report.valid = true;
  console.log('PASS: two full-city context losses; one lighter reload; live MapLibre fallback, camera, tiles and UI after the cap');
} catch (e) {
  report.failure = String(e); console.error(report.failure); process.exitCode = 1;
  if (page && !page.isClosed()) {
    try { report.failureState = await snapshot(); } catch (err) { report.failureStateError = String(err); }
    try { report.failureDiagnostics = await diagnostics(); } catch (err) { report.failureDiagnosticsError = String(err); }
    report.failureScreens = [];
    for (const name of ['failure-1', 'failure']) {
      const file = path.join(OUT, name + '.jpg');
      try { await page.screenshot({ path: file, type: 'jpeg', quality: 82, timeout: 10000 }); report.failureScreens.push(file); }
      catch (err) { report.failureScreens.push({ file, error: String(err) }); }
      if (name === 'failure-1') await sleep(1200);
      save();
    }
  }
} finally {
  save();
  if (context) await context.close().catch(() => {});
  if (browser) { await browser.close().catch(() => {}); browser.__done(); }
  console.log('Browser released');
}
