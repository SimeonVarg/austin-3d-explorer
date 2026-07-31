/**
 * night-lights.mjs — streetlight system sanity (6 assertions).
 *
 * Asserts from real state, not from having called the API: point counts from
 * the generated source data, opacities read back off the style, buildings
 * present so the occlusion order means something.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (/\[night\]/.test(m.text())) console.log(' ', m.text()); });
await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// Streetlight generation waits for idle; give it a real chance.
await page.waitForFunction(() => !!window.__nightLights, null, { timeout: 45000 }).catch(() => {});

const r = await page.evaluate(async () => {
  const m = window.__map;
  const out = { gen: window.__nightLights || null };
  const layerOrder = m.getStyle().layers.map(l => l.id);
  out.poolIdx = layerOrder.indexOf('night-streetlight-pool');
  out.buildingsIdx = layerOrder.indexOf('buildings-3d');

  // The opacities are EXPRESSIONS now (the baked core-vs-edge boost multiplies
  // the tier's value), so reading the property back gives an array, not a
  // number. Reading a property back also does not prove the style validator
  // ACCEPTED it — and a rejected paint property takes the whole layer down
  // silently; that already happened once to this exact layer. So pull the
  // scalar out of the expression for the day/night assertion, and separately
  // assert both layers still exist after the write.
  const scalarOf = v => {
    if (typeof v === 'number') return v;
    if (!Array.isArray(v)) return NaN;
    if (v[0] === '*') return scalarOf(v[1]);
    // ['match', input, label1, out1, ...] — the first OUTPUT is index 3, not 2.
    if (v[0] === 'match') return scalarOf(v[3]);   // the 'major' output
    return NaN;
  };
  window.applyTimeOfDay(m, 0.95, true);
  await new Promise(res => setTimeout(res, 300));
  out.opacityNight = scalarOf(m.getPaintProperty('night-streetlight-core', 'circle-opacity'));
  out.poolOpacityNight = scalarOf(m.getPaintProperty('night-streetlight-pool', 'circle-opacity'));
  out.layersAliveNight = !!(m.getLayer('night-streetlight-pool') && m.getLayer('night-streetlight-core'));
  window.applyTimeOfDay(m, 0.12, true);
  await new Promise(res => setTimeout(res, 300));
  out.opacityDay = scalarOf(m.getPaintProperty('night-streetlight-core', 'circle-opacity'));

  // Every feature must carry the baked properties the paint expressions read;
  // one missing `color` renders that lamp with the fallback, not the tier.
  const data = m.getSource('night-streetlights');
  const fc = [data._data, data.serialize && data.serialize().data]
    .find(d => d && typeof d !== 'string' && d.features && d.features.length);
  out.featureN = fc ? fc.features.length : 0;
  out.baked = fc ? fc.features.every(f => /^#[0-9a-f]{6}$/.test(f.properties.color) &&
                                          /^#[0-9a-f]{6}$/.test(f.properties.head) &&
                                          typeof f.properties.ob === 'number' &&
                                          f.properties.w >= 0 && f.properties.w <= 1) : false;
  // Warm core, cool edge: the mean warmth of lamps inside 500 m of the anchor
  // must be materially higher than of lamps beyond 1500 m.
  if (fc) {
    const A = [-97.7394, 30.2862], M_LAT = 110540;
    const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);
    let ni = 0, wi = 0, no = 0, wo = 0;
    for (const f of fc.features) {
      const [lng, lat] = f.geometry.coordinates;
      const d = Math.hypot((lng - A[0]) * mLon(lat), (lat - A[1]) * M_LAT);
      if (d < 500) { ni++; wi += f.properties.w; }
      else if (d > 1500) { no++; wo += f.properties.w; }
    }
    out.warmInner = ni ? +(wi / ni).toFixed(3) : null;
    out.warmOuter = no ? +(wo / no).toFixed(3) : null;
    out.innerN = ni; out.outerN = no;
  }
  return out;
});

const checks = [
  ['points generated', r.gen && r.gen.count > 0],
  ['point count sane (200..9000)', r.gen && r.gen.count >= 200 && r.gen.count <= 9000],
  ['fenced to the buildings bbox', r.gen && r.gen.fenced === true],
  ['not trimmed at cap', r.gen && !r.gen.trimmed],
  ['all three tiers present', r.gen && r.gen.major > 0 && r.gen.minor > 0 && r.gen.walk > 0],
  ['the campus walk tier is a real share, not a rounding error',
   r.gen && r.gen.walk / r.gen.count > 0.1],
  ['pool layer sits before buildings-3d', r.poolIdx >= 0 && r.buildingsIdx > r.poolIdx],
  ['both lamp layers survived the paint write', r.layersAliveNight === true],
  ['core opacity: >0.5 at night, 0 by day', r.opacityNight > 0.5 && r.opacityDay === 0],
  ['pool opacity live at night', r.poolOpacityNight > 0.3],
  ['every lamp carries baked colour/head/ob/w', r.baked === true],
  ['warm core, cool edge (inner warmth > outer + 0.4)',
   r.warmInner != null && r.warmOuter != null && r.warmInner > r.warmOuter + 0.4],
];
console.log(JSON.stringify(r));
let fail = 0;
for (const [name, ok] of checks) { console.log(`${ok ? ' PASS' : '*FAIL'}  ${name}`); if (!ok) fail++; }
await browser.close();
process.exit(fail ? 1 : 0);
