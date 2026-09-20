/**
 * audit-settings.mjs — does every Graphics-menu control survive a reload, and
 * does what the menu SAYS match what the page DOES?
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-settings.mjs <outDir> [--phase A,B,C,D]
 *
 * Driven through the real menu (the gear button, the range inputs with an
 * `input` event, the tick boxes with a click, the preset buttons), never by
 * writing window.GFX, because a test that writes the object the menu writes
 * cannot see a menu bug.
 *
 *   A  desktop, fresh profile: change every control, reload, compare
 *      GFX + the menu's own display + the live render state (pixel ratio,
 *      FOV, layer visibility, #map filter, grain, context attributes).
 *      Then each preset button, reload, compare; then Reset.
 *   B  the phone profile (?lite=1, 390x844 touch): change two sliders and a
 *      preset, reload the URL the page rewrote itself to, compare.
 *   C  the geometry density the preset NAME carries: pick Performance, wait
 *      for the authored apartments, move one picture slider (grain), and
 *      read slopes.detail(), the apartments' triangle count and the
 *      roofscape density before and after.
 *
 * Output: <outDir>/settings.json, and a PASS/FAIL line per check. Exit 1 when
 * any persistence check fails, 0 otherwise.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-settings.mjs <outDir> [--phase A,B,C,D]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const pi = process.argv.indexOf('--phase');
const PHASES = (pi > 0 ? process.argv[pi + 1] : 'A,B,D,C').split(',');
const report = { base: BASE, checks: [] };
let failures = 0;
const check = (phase, name, ok, detail) => {
  report.checks.push({ phase, name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  [${phase}] ${name}${detail ? '  ' + JSON.stringify(detail).slice(0, 300) : ''}`);
};

// The menu's rows, by the label the visitor reads (js/graphics.js SCHEMA).
const ROWS = {
  'Resolution': 'renderScale', 'Smooth edges': 'msaa', 'Detail distance': 'renderDistance',
  'Trees': 'treeDensity', 'City beyond campus': 'outerDensity', 'Window reflections': 'windowReflections',
  'Building shadows': 'shadows', 'Shadows at the base': 'ao', 'Glow': 'bloom', 'Sun shafts': 'godRays',
  'Lens flare': 'flare', 'Brightness': 'exposure', 'Auto brightness': 'autoExposure', 'Contrast': 'contrast',
  'Colour strength': 'saturation', 'Darkened corners': 'vignette', 'Film grain': 'grain',
  'View width': 'fov', 'Clouds': 'clouds', 'Stars': 'stars',
};

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1500000 });

async function waitCity(page, needApartments) {
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded() && window.GFX,
    null, { timeout: 240000 });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 300000 }).catch(() => {});
  if (needApartments)
    await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.readyToReveal(), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
}

/** Everything a visitor could see about the settings, read from the page. */
async function readState(page) {
  return page.evaluate(() => {
    const m = window.__map, G = window.GFX;
    const rows = {};
    for (const r of document.querySelectorAll('#gfx-panel .gfx-row')) {
      const name = r.querySelector('.gfx-name')?.textContent;
      const inp = r.querySelector('input');
      rows[name] = { value: inp.type === 'checkbox' ? inp.checked : +inp.value, shown: r.querySelector('.gfx-val')?.textContent ?? null };
    }
    const active = [...document.querySelectorAll('#gfx-panel .gfx-preset.active')].map(b => b.dataset.preset);
    let ctx = null;
    try { ctx = m.getCanvas().getContext('webgl2').getContextAttributes(); } catch (e) {}
    const vis = id => { try { return m.getLayer(id) ? (m.getLayoutProperty(id, 'visibility') || 'visible') : 'absent'; } catch (e) { return 'err'; } };
    const lodHidden = (window.LOD_TIERS ? [...window.LOD_TIERS.fine, ...window.LOD_TIERS.mid] : []).filter(id => window.LOD_isHidden && window.LOD_isHidden(id));
    return {
      search: location.search,
      gfx: JSON.parse(JSON.stringify(G)),
      saved: (() => { try { return JSON.parse(localStorage.getItem('austin3d.gfx.v1')); } catch (e) { return 'threw'; } })(),
      rows, active,
      render: {
        dpr: window.devicePixelRatio, pixelRatio: m.getPixelRatio(), fov: +m.getVerticalFieldOfView().toFixed(2),
        ao: vis('buildings-ao'), shadowLayer: vis('buildings-shadow'),
        mapFilter: document.getElementById('map').style.filter,
        grain: getComputedStyle(document.getElementById('fx-grain') || document.body).display,
        fxCanvas: document.getElementById('fx-canvas') ? getComputedStyle(document.getElementById('fx-canvas')).display : null,
        antialias: ctx && ctx.antialias, preserveDrawingBuffer: ctx && ctx.preserveDrawingBuffer,
        lodHidden,
        sunShadowMaps: window.slopes && window.slopes.sunlightStats ? window.slopes.sunlightStats().shadowMaps : null,
        slopesDetail: window.slopes && window.slopes.detail ? window.slopes.detail() : null,
        roofDetail: window.ROOFSCAPE ? (typeof window.ROOFSCAPE.detail === 'number' ? window.ROOFSCAPE.detail : null) : null,
        aptTriangles: window.slopesApartments ? window.slopesApartments.count.triangles : null,
        aptDone: window.slopesApartments ? window.slopesApartments.count.done : null,
      },
      capture: window.__capture ? window.__capture() : null,
    };
  });
}

async function openMenu(page) {
  const hidden = await page.evaluate(() => document.getElementById('gfx-panel')?.classList.contains('hidden'));
  if (hidden) await page.click('#gfx-button');
  await page.waitForTimeout(300);
}

/** Move one control through the DOM the way a person does. */
async function setControl(page, label, value) {
  return page.evaluate(({ label, value }) => {
    for (const r of document.querySelectorAll('#gfx-panel .gfx-row')) {
      if (r.querySelector('.gfx-name')?.textContent !== label) continue;
      const inp = r.querySelector('input');
      if (inp.type === 'checkbox') { if (inp.checked !== value) inp.click(); return inp.checked; }
      inp.value = String(value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return +inp.value;
    }
    return 'no-row';
  }, { label, value });
}

const near = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;

// ─────────────────────────────────────────────────────────────── A ──
if (PHASES.includes('A')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await applySwaps(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const URL0 = BASE + '/?intro=0&drift=0&apartments=0';
  await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitCity(page, false);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await openMenu(page);
  const s0 = await readState(page);
  report.A = { initial: s0 };
  check('A', 'fresh profile starts on balanced', s0.gfx.preset === 'balanced', { preset: s0.gfx.preset });

  // A value per row that differs from the starting one and is on the slider's
  // own step grid.
  const want = {};
  const specs = await page.evaluate(() => [...document.querySelectorAll('#gfx-panel .gfx-row')].map(r => {
    const i = r.querySelector('input');
    return { label: r.querySelector('.gfx-name').textContent, type: i.type, min: +i.min, max: +i.max, step: +i.step, value: i.type === 'checkbox' ? i.checked : +i.value };
  }));
  for (const sp of specs) {
    if (sp.type === 'checkbox') { want[sp.label] = !sp.value; continue; }
    // one third of the way from the current value to the far end, snapped
    const far = (sp.value - sp.min) > (sp.max - sp.value) ? sp.min : sp.max;
    let v = sp.value + (far - sp.value) / 3;
    v = Math.round((v - sp.min) / sp.step) * sp.step + sp.min;
    want[sp.label] = +v.toFixed(4);
  }
  // Bloom from zero asks for a reload; so does MSAA. Both are in the list.
  for (const [label, v] of Object.entries(want)) await setControl(page, label, v);
  await page.waitForTimeout(1500);
  const s1 = await readState(page);
  report.A.changed = s1;
  for (const [label, v] of Object.entries(want)) {
    const key = ROWS[label];
    check('A', `menu writes ${label} -> GFX.${key}`, key ? near(s1.gfx[key], v) : false, { want: v, got: key ? s1.gfx[key] : 'no key for label' });
  }
  check('A', 'a moved control marks the settings custom', (s1.gfx.preset === 'custom' || s1.gfx.custom === true) && s1.active.length === 0, { preset: s1.gfx.preset, custom: s1.gfx.custom, active: s1.active });
  check('A', 'saved settings equal live settings after the change',
    s1.saved && Object.values(ROWS).every(k => near(s1.saved[k], s1.gfx[k])),
    Object.values(ROWS).filter(k => !(s1.saved && near(s1.saved[k], s1.gfx[k]))));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitCity(page, false);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await openMenu(page);
  const s2 = await readState(page);
  report.A.reloaded = s2;
  for (const [label, v] of Object.entries(want)) {
    const key = ROWS[label];
    check('A', `survives reload: ${label}`, near(s2.gfx[key], v) && near(s2.rows[label]?.value, v),
      { want: v, gfx: s2.gfx[key], menu: s2.rows[label] });
  }
  check('A', 'settings still read custom after reload', (s2.gfx.preset === 'custom' || s2.gfx.custom === true) && s2.active.length === 0, { preset: s2.gfx.preset, custom: s2.gfx.custom, active: s2.active });
  // The render must follow the restored values, not just the object.
  const wantPR = +(s2.render.dpr * s2.gfx.renderScale).toFixed(3);
  check('A', 'render scale applied after reload', Math.abs(s2.render.pixelRatio - wantPR) < 0.002, { pixelRatio: s2.render.pixelRatio, want: wantPR });
  check('A', 'view width applied after reload', Math.abs(s2.render.fov - s2.gfx.fov) < 0.05, { fov: s2.render.fov, want: s2.gfx.fov });
  check('A', 'base shadows layer follows the tick box', (s2.render.ao === 'visible') === !!s2.gfx.ao, { ao: s2.render.ao, gfx: s2.gfx.ao });
  check('A', 'building shadows layer follows the tick box', (s2.render.shadowLayer === 'visible') === !!s2.gfx.shadows, { layer: s2.render.shadowLayer, gfx: s2.gfx.shadows });
  check('A', 'smooth edges applied after reload', s2.render.antialias === !!s2.gfx.msaa, { antialias: s2.render.antialias, gfx: s2.gfx.msaa });
  check('A', 'glow/auto-brightness buffer present after reload', s2.render.preserveDrawingBuffer === (s2.gfx.bloom > 0.01 || !!s2.gfx.autoExposure), { pdb: s2.render.preserveDrawingBuffer });
  check('A', 'film grain element follows the slider', (s2.render.grain !== 'none') === (s2.gfx.grain > 0.01), { grain: s2.gfx.grain, display: s2.render.grain });
  for (const [label, key] of Object.entries(ROWS)) {
    const r = s2.rows[label];
    if (!r || r.shown == null) continue;
    // the displayed number is the formatted GFX value
    const n = parseFloat(String(r.shown).replace(/[^0-9.\-]/g, ''));
    const g = s2.gfx[key];
    const ok = /unlimited/.test(r.shown) ? g >= 1500
      : /%/.test(r.shown) ? Math.abs(n - Math.round(g * 100)) < 0.6
      : /°/.test(r.shown) ? Math.abs(n - g) < 0.6
      : / m$/.test(r.shown) ? Math.abs(n - g) < 0.6
      : Math.abs(n - g) < 0.006;
    check('A', `label shows the value: ${label}`, ok, { shown: r.shown, gfx: g });
  }

  // Each preset button, reloaded.
  for (const name of ['performance', 'cinematic', 'ultra', 'balanced']) {
    await openMenu(page);
    await page.click(`#gfx-panel .gfx-preset[data-preset="${name}"]`);
    await page.waitForTimeout(800);
    const before = await readState(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitCity(page, false);
    await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
    await openMenu(page);
    const after = await readState(page);
    const diff = Object.values(ROWS).filter(k => !near(before.gfx[k], after.gfx[k]));
    check('A', `preset ${name} survives reload`, after.gfx.preset === name && diff.length === 0 && after.active.join() === name,
      { preset: after.gfx.preset, active: after.active, diff });
    check('A', `preset ${name}: smooth edges matches context after reload`, after.render.antialias === !!after.gfx.msaa, { antialias: after.render.antialias, msaa: after.gfx.msaa });
    report.A['preset_' + name] = { before: before.gfx, after: after.gfx, render: after.render };
  }
  // Reset lands on balanced.
  await openMenu(page);
  await setControl(page, 'Brightness', 1.3);
  await page.click('#gfx-reset');
  await page.waitForTimeout(500);
  const sr = await readState(page);
  check('A', 'Reset returns to balanced', sr.gfx.preset === 'balanced' && sr.active.join() === 'balanced', { preset: sr.gfx.preset });
  report.A.pageErrors = errs;
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────── B ──
if (PHASES.includes('B')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await applySwaps(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE + '/?intro=0&drift=0&apartments=0&lite=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitCity(page, false);
  await openMenu(page);
  const b0 = await readState(page);
  report.B = { initial: b0 };
  check('B', 'phone profile applied (preset performance)', b0.gfx.preset === 'performance', { search: b0.search, preset: b0.gfx.preset, capture: b0.capture });
  await setControl(page, 'Brightness', 1.2);
  await setControl(page, 'Trees', 0.8);
  await page.waitForTimeout(800);
  const b1 = await readState(page);
  report.B.changed = b1;
  check('B', 'phone: the change is written to storage', !!(b1.saved && near(b1.saved.exposure, 1.2)), { saved: b1.saved && { exposure: b1.saved.exposure, preset: b1.saved.preset } });
  // js/mobile.js counts boots and clears the count when the veil is gone; two
  // uncleared boots put the third on the safe profile (?slopes=0). Record the
  // count the page left behind, then clear it so the reloads below test the
  // SETTINGS and not the crash counter.
  const boot1 = await page.evaluate(() => { try { return localStorage.getItem('flyover.boot'); } catch (e) { return 'threw'; } });
  report.B.bootCounterAfterCityShown = boot1;
  check('B', 'phone: boot counter cleared once the city is shown (js/mobile.js)', boot1 === '0' || boot1 === null, { 'flyover.boot': boot1 });
  await page.evaluate(() => { try { localStorage.setItem('flyover.boot', '0'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitCity(page, false);
  await openMenu(page);
  const b2 = await readState(page);
  report.B.reloaded = b2;
  check('B', 'phone: Brightness survives reload', near(b2.gfx.exposure, 1.2), { got: b2.gfx.exposure, search: b2.search });
  check('B', 'phone: Trees survives reload', near(b2.gfx.treeDensity, 0.8), { got: b2.gfx.treeDensity });
  await page.click('#gfx-panel .gfx-preset[data-preset="balanced"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => { try { localStorage.setItem('flyover.boot', '0'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitCity(page, false);
  await openMenu(page);
  const b3 = await readState(page);
  report.B.presetReloaded = b3;
  check('B', 'phone: a chosen preset survives reload', b3.gfx.preset === 'balanced', { got: b3.gfx.preset, search: b3.search });
  check('B', 'phone: auto-detect is not frozen as if filming', !(b3.capture && b3.capture.autoDetectFrozen) || b3.gfx.autoDetected, { capture: b3.capture });
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────── C ──
if (PHASES.includes('C')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await applySwaps(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE + '/?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitCity(page, true);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  // js/app.js drops the authored buildings for the visit when they are not
  // ready 90 s in (INTRO.authoredCeilingMs) — on this laptop, whenever other
  // lanes' browsers run. readyToReveal() is then TRUE with no mesh at all, and
  // this phase would compare two empty scenes and pass. Put them back first.
  const handoffC = await page.evaluate(() => ({ on: !!(window.APARTMENTS && window.APARTMENTS.on), group: !!window.slopesApartments.group, fallback: (window.__intro && window.__intro.modelFallback) || null, waitedMs: window.__intro && window.__intro.waitedMs }));
  report.handoffC = handoffC;
  if (!handoffC.on || !handoffC.group) {
    console.log('[audit] C: authored buildings were not in the scene (' + JSON.stringify(handoffC) + ') - re-enabling and waiting');
    await page.evaluate(() => { window.APARTMENTS.on = true; window.applySlopesApartments(window.__map); });
    await page.waitForFunction(() => window.slopesApartments.group && window.slopesApartments.readyToReveal(), null, { timeout: 900000 });
  }
  await openMenu(page);
  await page.click('#gfx-panel .gfx-preset[data-preset="performance"]');
  // the preset change triggers a rebuild at the new density
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => window.slopesApartments.readyToReveal() && window.slopesApartments.count.done, null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const readDensity = () => page.evaluate(() => ({
    preset: window.GFX.preset,
    slopesDetail: window.slopes.detail(),
    triangles: window.slopes.stats ? window.slopes.stats().triangles : null,
    aptTriangles: window.slopesApartments.count.triangles,
    aptSigns: window.slopesApartments.count.signs,
    roofFilter: JSON.stringify(window.__map.getFilter('roofscape-major') || null).match(/"d"\]\,([0-9.]+)/)?.[1] ?? 'none',
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  }));
  const c0 = await readDensity();
  await setControl(page, 'Film grain', 0.1);
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => window.slopesApartments.readyToReveal() && window.slopesApartments.count.done, null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const c1 = await readDensity();
  report.C = { performance: c0, afterGrain: c1 };
  check('C', 'the authored buildings are in the scene (else this phase proves nothing)', c0.aptTriangles > 0, { aptTriangles: c0.aptTriangles });
  check('C', 'a picture slider does not change the geometry density',
    c0.slopesDetail === c1.slopesDetail && c0.roofFilter === c1.roofFilter && c0.aptSigns === c1.aptSigns && c0.aptTriangles === c1.aptTriangles,
    { before: c0, after: c1 });
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────── D ──
// Auto brightness meters the GL canvas, so it needs preserveDrawingBuffer,
// which is fixed at context creation. On `performance` the context is built
// without it. Ticking the box there must either work or say "Reload to apply".
if (PHASES.includes('D')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await applySwaps(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE + '/?intro=0&drift=0&apartments=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitCity(page, false);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await openMenu(page);
  await page.click('#gfx-panel .gfx-preset[data-preset="performance"]');
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitCity(page, false);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await openMenu(page);
  const d0 = await readState(page);
  await setControl(page, 'Auto brightness', true);
  // stare at bright sky so a working meter has something to correct
  await page.evaluate(() => { const m = window.__map; m.jumpTo({ center: [-97.7393, 30.2861], zoom: 16.2, pitch: 85, bearing: 250 }); window.__aeReset && window.__aeReset(); });
  await page.waitForTimeout(4000);
  const d1 = await page.evaluate(() => ({ ticked: window.GFX.autoExposure, ae: window.__ae(), reloadShown: document.getElementById('gfx-reload').classList.contains('show') }));
  report.D = { before: { pdb: d0.render.preserveDrawingBuffer, preset: d0.gfx.preset }, after: d1 };
  check('D', 'Auto brightness ticked on a context without the buffer: works or asks for a reload',
    d1.ticked && (d1.reloadShown || (d1.ae && d1.ae.luma != null)), { pdb: d0.render.preserveDrawingBuffer, ...d1 });
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, 'settings.json'), JSON.stringify(report, null, 1));
console.log(`\n${failures} failing check(s). Report: ${path.join(OUT, 'settings.json')}`);
await browser.__done();
process.exit(failures ? 1 : 0);
