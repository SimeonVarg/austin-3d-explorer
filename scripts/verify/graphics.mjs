/**

 * graphics.mjs — assert the post-process stack and its menu actually exist,

 * actually change pixels, and actually cost what the menu claims.

 *

 * The trap this suite keeps hitting: a subsystem that silently fails looks

 * identical to a subsystem that is subtly tuned. So every effect here is

 * asserted by sampling the rendered frame with the effect off and then on and

 * requiring the pixels to DIFFER — not by checking that a style property was set.

 */

import { chromium } from 'playwright-core';

const browser = await launch(chromium);

const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });

const errs = [];

page.on('pageerror', e => errs.push(e.message));

page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

const results = [];

const check = (n, pass, d) => results.push({ name: n, pass, detail: String(d) });

function report() {
  console.log('');
  for (const r of results) {
    console.log((r.pass ? ' PASS  ' : '*FAIL  ') + r.name);
    console.log('         ' + r.detail);
  }
  console.log('\n' + results.filter(r => r.pass).length + '/' + results.length + ' passed');
}

process.on('uncaughtException', async (e) => {
  check('ran to completion', false, String(e && e.message).split(/\r?\n/)[0]);
  report(); try { await browser.close(); } catch (x) {} process.exit(1);
});

import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });

await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });

await page.waitForTimeout(5000);

// The auto-detect probe fires 11 s in and rewrites every setting. Left running

// it lands in the middle of this script and reads as the render-scale lever

// being broken. Production cancels it on the first deliberate change; a test IS

// a deliberate change, so say so up front.

await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// ── existence ─────────────────────────────────────────────────────────

const boot = await page.evaluate(() => ({
  gfx: typeof window.GFX,
  keys: window.GFX ? Object.keys(window.GFX).length : 0,
  renderFX: typeof window.renderFX,
  setGrade: typeof window.setGrade,
  skyFrame: typeof window.skyFrame,
  button: !!document.getElementById('gfx-button'),
  panel: !!document.getElementById('gfx-panel'),
  layers: ['fx-dof', 'fx-canvas', 'fx-grain', 'vignette'].filter(id => !!document.getElementById(id)),
  bloomLegacy: !!document.getElementById('fx-bloom'),
  aoLayer: !!window.__map.getLayer('buildings-ao'),
  pixelRatio: window.__map.getPixelRatio ? window.__map.getPixelRatio() : null,
  fov: window.__map.getVerticalFieldOfView(),
}));

check('GFX settings object exists', boot.gfx === 'object' && boot.keys >= 15, `${boot.gfx}, ${boot.keys} keys`);

check('renderFX + setGrade are wired', boot.renderFX === 'function' && boot.setGrade === 'function',
  `renderFX ${boot.renderFX}, setGrade ${boot.setGrade}`);

check('sky.js publishes a frame for the FX pass', boot.skyFrame === 'object', boot.skyFrame);

check('all four post-process layers are in the DOM', boot.layers.length === 4, boot.layers.join(', '));

// The CSS backdrop-filter bloom is gone for good — it darkened the frame instead

// of adding light. If this element ever comes back, so did the bug.

check('the broken backdrop-filter bloom div is gone', !boot.bloomLegacy, 'fx-bloom present: ' + boot.bloomLegacy);

check('menu button + panel exist', boot.button && boot.panel, `button ${boot.button}, panel ${boot.panel}`);

check('contact-shadow (AO) layer was added', boot.aoLayer, String(boot.aoLayer));

check('FOV comes from GFX', Math.abs(boot.fov - 58) < 0.01 || Math.abs(boot.fov - 62) < 0.01, boot.fov);

// ── the roof z-fight fix ──────────────────────────────────────────────

// The bug was two coplanar surfaces: the cap's side faces spanned [h-1.2, h],

// exactly inside the wall's [0, h]. Assert zero overlap now.

const geom = await page.evaluate(() => {
  const m = window.__map;
  const j = (l, p) => JSON.stringify(m.getPaintProperty(l, p));
  return {
    wallH: j('buildings-3d', 'fill-extrusion-height'),
    roofH: j('buildings-roof', 'fill-extrusion-height'),
    roofB: j('buildings-roof', 'fill-extrusion-base'),
    partH: j('parts-roof', 'fill-extrusion-height'),
    partB: j('parts-roof', 'fill-extrusion-base'),
    cap: window.CAP_GEOM ? window.CAP_GEOM.liftFor(100) : null,
  };
});

// base must be the wall top exactly, height strictly above it: the cap sits ON

// the wall instead of inside it.

check('roof cap no longer overlaps the wall (buildings)',
  geom.roofB === '["get","final_height"]' && geom.roofH.startsWith('["+",["get","final_height"]'),
  `base ${geom.roofB}  height ${geom.roofH}`);

check('roof cap no longer overlaps the wall (parts)',
  geom.partB === '["get","h"]', `base ${geom.partB}  height ${geom.partH}`);

check('cap geometry is exported once, not duplicated', geom.cap > 0, 'lift for a 100 m tower = ' + geom.cap + ' m');

// ── pixels change when an effect is switched on ───────────────────────

/** Average RGB of the whole frame, read from OUR canvas (harness forces preserveDrawingBuffer). */

async function frameStats() {
  return page.evaluate(async () => {
    const m = window.__map;
    m.triggerRepaint();
    await new Promise(r => setTimeout(r, 700));
    const cv = m.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const W = cv.width, H = cv.height;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const n = px.length / 4;
    return [r / n, g / n, b / n];
  });
}

// The DOM overlays composite OUTSIDE the WebGL canvas, so readPixels cannot see

// them. Assert what is observable from the page instead: that the effect's

// element is actually live and carrying a real filter/opacity.

await page.evaluate(() => {
  window.GFX.godRays = 0; window.GFX.flare = 0; window.GFX.bloom = 0;
  window.GFX.dof = 0; window.GFX.grain = 0;
  window.applyGraphics();
});

await page.waitForTimeout(600);

const off = await page.evaluate(() => ({
  dof: getComputedStyle(document.getElementById('fx-dof')).display,
  grain: getComputedStyle(document.getElementById('fx-grain')).display,
  fx: getComputedStyle(document.getElementById('fx-canvas')).display,
}));

check('every effect layer is display:none at zero',
  off.dof === 'none' && off.grain === 'none' && off.fx === 'none',
  JSON.stringify(off));

await page.evaluate(() => {
  window.GFX.godRays = 0.8; window.GFX.flare = 0.6; window.GFX.bloom = 0.6;
  window.GFX.dof = 0.5; window.GFX.grain = 0.3;
  window.applyGraphics();
});

await page.waitForTimeout(600);

const on = await page.evaluate(() => {
  const g = id => getComputedStyle(document.getElementById(id));
  return {
    dofDisplay: g('fx-dof').display,
    grainDisplay: g('fx-grain').display,
    grainImage: g('fx-grain').backgroundImage.slice(0, 22),
    grainBlend: g('fx-grain').mixBlendMode,
    fxDisplay: g('fx-canvas').display,
    fxBlend: g('fx-canvas').mixBlendMode,
  };
});

check('distance blur (DOF) turns on', on.dofDisplay === 'block', on.dofDisplay);

check('fx canvas composites additively', on.fxBlend === 'screen', on.fxBlend);

// Bloom must put real ink on the fx canvas, and it must come from the rendered

// frame — an all-black copy (no preserveDrawingBuffer) is the silent failure.

const bloom = await page.evaluate(async () => {
  const m = window.__map;
  m.jumpTo({ pitch: 70, bearing: 90 });
  const ink = () => {
    const c = document.getElementById('fx-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4 * 17) { if (d[i + 3] > 4) lit++; sum += d[i] + d[i + 1] + d[i + 2]; }
    return { lit, sum };
  };
  window.GFX.godRays = 0; window.GFX.flare = 0;
  // Sample at BOTH a daytime and a golden-hour pose. A threshold tuned only
  // against golden hour passed a one-pose test while producing literally zero
  // bloom for the whole day half of the slider.
  const at = async (p, bloomOn) => {
    window.GFX.bloom = bloomOn;
    window.applyGraphics();
    window.applyTimeOfDay(m, p, true);
    await new Promise(r => setTimeout(r, 900));
    m.triggerRepaint();
    await new Promise(r => setTimeout(r, 700));
    return ink();
  };
  const dayOff = await at(0.12, 0), dayOn = await at(0.12, 0.6);
  const goldOff = await at(0.47, 0), goldOn = await at(0.47, 0.6);
  const gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl');
  return { dayOff, dayOn, goldOff, goldOn, pdb: gl.getContextAttributes().preserveDrawingBuffer };
});

check('the context kept its drawing buffer (bloom needs it)', bloom.pdb, String(bloom.pdb));

check('bloom writes real light at DAY',
  bloom.dayOn.lit > 50 && bloom.dayOn.sum > bloom.dayOff.sum * 4 + 500,
  `off: ${bloom.dayOff.lit} lit / sum ${bloom.dayOff.sum}  ->  on: ${bloom.dayOn.lit} lit / sum ${bloom.dayOn.sum}`);

check('bloom writes real light at GOLDEN HOUR',
  bloom.goldOn.lit > 50 && bloom.goldOn.sum > bloom.goldOff.sum * 4 + 500,
  `off: ${bloom.goldOff.lit} lit / sum ${bloom.goldOff.sum}  ->  on: ${bloom.goldOn.lit} lit / sum ${bloom.goldOn.sum}`);

check('film grain has a tile and overlay blend',
  on.grainDisplay === 'block' && on.grainImage.startsWith('url(') && on.grainBlend === 'overlay',
  `${on.grainDisplay} ${on.grainBlend} ${on.grainImage}...`);

check('fx canvas turns on for rays/flare', on.fxDisplay === 'block', on.fxDisplay);

// God rays only draw when the sun is up AND in frame. Pitch up at golden hour

// and confirm the canvas has non-zero ink; then drop to night and confirm it clears.

const ink = await page.evaluate(async () => {
  const m = window.__map;
  const count = () => {
    const c = document.getElementById('fx-canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 6) lit++;
    return lit;
  };
  // Golden hour, sun in the west, camera looking west and pitched up.
  // Set every input this test depends on rather than inheriting whatever the
  // bloom test left behind — it left godRays at 0, and "no rays drawn" then read
  // as the rays being broken.
  window.GFX.bloom = 0;                            // isolate the rays' own ink
  window.GFX.godRays = 0.8; window.GFX.flare = 0.6;
  window.applyGraphics();
  m.jumpTo({ pitch: 84, bearing: 256 });
  window.applyTimeOfDay(m, 0.47, true);
  await new Promise(r => setTimeout(r, 900));
  const day = count();
  // Snapshot the sun HERE. Reading window.skyFrame after the night switch below
  // reported elev -35 next to a passing "sun in frame" assertion, which looks
  // like the test proving the opposite of what it checked.
  const sunThen = JSON.parse(JSON.stringify(window.skyFrame.sun));
  window.applyTimeOfDay(m, 0.95, true);
  await new Promise(r => setTimeout(r, 900));
  const night = count();
  return { day, night, sun: sunThen };
});

check('god rays draw with the sun in frame', ink.day > 30, `${ink.day} lit samples, sun ` + JSON.stringify(ink.sun));

check('god rays clear at night (no shafts from a moon)', ink.night === 0, ink.night + ' lit samples');

// ── render scale ──────────────────────────────────────────────────────

const scale = await page.evaluate(async () => {
  const m = window.__map;
  const before = m.getCanvas().width;
  window.GFX.renderScale = 0.5; window.applyGraphics();
  await new Promise(r => setTimeout(r, 700));
  const half = m.getCanvas().width;
  window.GFX.renderScale = 1.0; window.applyGraphics();
  await new Promise(r => setTimeout(r, 700));
  const full = m.getCanvas().width;
  return { before, half, full };
});

check('render scale resizes the drawing buffer', scale.half < scale.full * 0.75,
  `1.0 -> ${scale.full}px wide, 0.5 -> ${scale.half}px wide`);

// ── the time-of-day lockout ───────────────────────────────────────────

const tod = await page.evaluate(async () => {
  const panel = document.getElementById('tod-panel');
  const cv = document.querySelector('#map canvas');
  document.body.classList.add('flying');
  const flyingOnly = getComputedStyle(panel).pointerEvents;
  cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 500, clientY: 400, bubbles: true, isPrimary: true, button: 0, pointerType: 'mouse' }));
  await new Promise(r => setTimeout(r, 60));
  const duringDrag = getComputedStyle(panel).pointerEvents;
  cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 500, clientY: 400, bubbles: true, isPrimary: true, button: 0, pointerType: 'mouse' }));
  await new Promise(r => setTimeout(r, 60));
  const afterDrag = getComputedStyle(panel).pointerEvents;
  const stillFlying = document.body.classList.contains('flying');
  document.body.classList.remove('flying');
  return { flyingOnly, duringDrag, afterDrag, stillFlying };
});

check('slider is live while .flying but no pointer is down',
  tod.flyingOnly !== 'none' && tod.afterDrag !== 'none' && tod.stillFlying,
  `.flying only: ${tod.flyingOnly}, after release: ${tod.afterDrag} (still .flying: ${tod.stillFlying})`);

check('slider is still protected DURING a look drag', tod.duringDrag === 'none', tod.duringDrag);

// ── sky canvas is sized to the sky, not the viewport ──────────────────

const skyCv = await page.evaluate(async () => {
  const m = window.__map;
  m.jumpTo({ pitch: 64, bearing: 90 });
  await new Promise(r => setTimeout(r, 600));
  const c = document.getElementById('sky-canvas');
  return { h: c.height, cssH: parseFloat(c.style.height), viewH: m.getCanvas().clientHeight,
           dpr: window.devicePixelRatio };
});

check('sky canvas is a band, not a full-screen buffer',
  skyCv.cssH <= skyCv.viewH * 0.5,
  `${skyCv.cssH} css px tall of a ${skyCv.viewH} px viewport ` +
  `(${(100 * skyCv.cssH / skyCv.viewH).toFixed(0)}% — was 100%)`);

// ── persistence ───────────────────────────────────────────────────────

await page.evaluate(() => { window.GFX.bloom = 0.77; window.applyGraphics(); });

await page.waitForTimeout(300);

const stored = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('austin3d.gfx.v1') || '{}').bloom; } catch (e) { return null; }
});

check('settings persist to localStorage', Math.abs(stored - 0.77) < 1e-6, 'stored bloom = ' + stored);

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

report();

await browser.__done();

process.exit(results.every(r => r.pass) ? 0 : 1);
