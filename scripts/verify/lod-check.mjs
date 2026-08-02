/**
 * lod-check.mjs — the shipped render-distance control, asserted on behaviour.
 *
 * lod-perf.mjs proved the LEVER is worth pulling. This proves the CONTROL pulls
 * it: that the tiers drop at the altitudes js/lod.js claims, that street level
 * is untouched at every setting, that the slider's top really means unlimited,
 * and that lod.js restores only layers it hid itself.
 *
 * Usage: node lod-check.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(`${SERVER}/index.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-buildings') && m.getSource('austin-outer') && window.LOD_TIERS;
}, null, { timeout: 180000 });
await page.waitForTimeout(6000);

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

/**
 * Put the camera at a ZOOM and read back the altitude it actually reached,
 * plus which tiers are drawn.
 *
 * Deliberately not "put the camera at altitude X": the first cut of this file
 * inverted altitude to zoom itself, got it wrong, asked for 400 m, landed at
 * 274 m and reported a FAILURE for behaviour that was correct at the altitude
 * the camera was really at. Zoom is what the map takes; altitude is what the
 * rule reads; so set the first and MEASURE the second, and assert against the
 * measurement.
 */
async function at(zoom, renderDistance) {
  return page.evaluate(async ([zoom, D]) => {
    const m = window.__map;
    window.GFX.renderDistance = D;
    m.jumpTo({ center: [-97.7434, 30.2857], zoom, pitch: 70, bearing: 200 });
    window.applyLOD(m);
    await new Promise(r => setTimeout(r, 400));
    const vis = id => !m.getLayer(id) ? null
      : (m.getLayoutProperty(id, 'visibility') || 'visible');
    const T = window.LOD_TIERS;
    const state = t => {
      const present = T[t].filter(id => m.getLayer(id));
      const shown = present.filter(id => vis(id) === 'visible');
      return { present: present.length, shown: shown.length };
    };
    let alt = null;
    try { alt = window.__fly ? window.__fly.eye().alt : null; } catch (e) {}
    if (!isFinite(alt) || !alt) alt = m.transform.cameraToCenterDistance / m.transform.pixelsPerMeter;
    return { altActual: +alt.toFixed(0), fine: state('fine'), mid: state('mid'),
             bulk: ['buildings-3d', 'outer-3d', 'outer-tower'].map(vis) };
  }, [zoom, renderDistance]);
}

// The rule under test, restated here so the assertions cannot drift from it:
//   fine hidden when alt > D * 0.45   (±8% hysteresis)
//   mid  hidden when alt > D
const FINE_AT = 0.45, HYST = 0.08;
const expectFine = (alt, D) => alt > D * FINE_AT * (1 + HYST);
const expectMid  = (alt, D) => alt > D * (1 + HYST);
const shownIsRight = (st, shouldHide) => shouldHide ? st.shown === 0 : st.shown === st.present;

// 1. Street level is untouched at the tightest setting.
let r = await at(17.6, 400);
check('street level keeps every tier at the tightest render distance',
  r.fine.shown === r.fine.present && r.mid.shown === r.mid.present,
  `alt ${r.altActual} m — fine ${r.fine.shown}/${r.fine.present}, mid ${r.mid.shown}/${r.mid.present}`);

// 2. Fine tier goes first, at distance * fineAt.
// Sweep zooms until one lands between the two thresholds, then assert there.
let band = null;
for (const z of [16.0, 15.6, 15.2, 15.0, 14.8, 14.6, 14.4]) {
  const s = await at(z, 700);
  console.log('   sweep zoom', z, '-> alt', s.altActual, 'm  fine', s.fine.shown + '/' + s.fine.present, 'mid', s.mid.shown + '/' + s.mid.present);
  if (expectFine(s.altActual, 700) && !expectMid(s.altActual, 700)) { band = { z, ...s }; break; }
}
check('there is an altitude band where fine is dropped and mid is not',
  !!band && band.fine.shown === 0 && band.mid.shown === band.mid.present,
  band ? `zoom ${band.z}, alt ${band.altActual} m, D=700 (thresholds 315 / 700) — fine ${band.fine.shown}/${band.fine.present}, mid ${band.mid.shown}/${band.mid.present}`
       : 'no zoom in the swept range landed between 340 m and 756 m');

// 3. Both tiers go once past the distance itself.
r = await at(14.0, 700);
check('both tiers drop well past the render distance',
  r.altActual > 700 * (1 + HYST) && r.fine.shown === 0 && r.mid.shown === 0,
  `alt ${r.altActual} m, D=700 — fine ${r.fine.shown}/${r.fine.present}, mid ${r.mid.shown}/${r.mid.present}`);

// 4. The city itself is NEVER dropped — that would be losing the view.
check('the bulk building layers are never hidden',
  r.bulk.every(v => v === null || v === 'visible'),
  'buildings-3d / outer-3d / outer-tower = ' + JSON.stringify(r.bulk));

// 5. The slider's top means unlimited.
r = await at(14.0, 1500);
check('the slider maximum means unlimited, not a 1.5 km cull',
  r.fine.shown === r.fine.present && r.mid.shown === r.mid.present,
  `alt ${r.altActual} m, D=1500 — fine ${r.fine.shown}/${r.fine.present}, mid ${r.mid.shown}/${r.mid.present}`);

// 6. Coming back down restores everything.
r = await at(17.6, 700);
check('descending restores every layer it hid',
  r.fine.shown === r.fine.present && r.mid.shown === r.mid.present,
  `alt ${r.altActual} m — fine ${r.fine.shown}/${r.fine.present}, mid ${r.mid.shown}/${r.mid.present}`);

// 7. lod.js must not resurrect a layer another module is holding down.
const foreign = await page.evaluate(async () => {
  const m = window.__map;
  m.setLayoutProperty('trees-canopy', 'visibility', 'none');   // stand in for another module
  window.GFX.renderDistance = 1500;                            // unlimited: lod wants everything shown
  window.applyLOD(m);
  await new Promise(r => setTimeout(r, 300));
  const v = m.getLayoutProperty('trees-canopy', 'visibility');
  m.setLayoutProperty('trees-canopy', 'visibility', 'visible');
  return v;
});
check('does not force-show a layer another module hid',
  foreign === 'none', `trees-canopy stayed '${foreign}' (want 'none')`);

// THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL BUG.
//
// Every mechanical test above passed while the control did nothing on three of
// the four presets, because the thresholds sat above the altitude the camera can
// physically reach (ALT_MAX = 900 m). A control that is wired, asserted and
// unreachable is indistinguishable from a broken one — reported as "I don't
// think it works".
const reach = await page.evaluate(() => {
  const P = window.GFX_PRESETS, out = {};
  for (const k of Object.keys(P)) out[k] = P[k].renderDistance;
  return out;
});
const ALT_MAX = 900, FINE = 0.45;
for (const [name, d] of Object.entries(reach)) {
  const fineThr = d * FINE;
  const unlimited = d >= 1500;
  check(`preset ${name}: its detail threshold is an altitude you can reach`,
    unlimited || fineThr < ALT_MAX,
    `${d} m -> fine tier at ${Math.round(fineThr)} m, camera ceiling ${ALT_MAX} m` +
    (unlimited ? ' (slider max = unlimited, by design)' : ''));
}

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

let bad = 0;
for (const r of results) {
  console.log(`${r.pass ? ' PASS ' : '*FAIL '} ${r.name}\n         ${r.detail}`);
  if (!r.pass) bad++;
}
console.log(`\n${results.length - bad}/${results.length} passed`);
browser.__done();
process.exitCode = bad ? 1 : 0;
