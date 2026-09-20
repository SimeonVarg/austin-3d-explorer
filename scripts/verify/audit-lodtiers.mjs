/**
 * audit-lodtiers.mjs — the deterministic before/after gate for js/lod.js.
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-lodtiers.mjs [--distance 700]
 *
 * WHY NOT lod-check.mjs. On 2026-09-19 lod-check.mjs returned three DIFFERENT
 * verdict sets for the same code on this machine (BEFORE runs at 09:01 and
 * 01:35: 10/12 and 9/12, with disjoint FAIL lists; a 10:48 run reported the
 * same altitude, 116 m, for every zoom in its sweep). Its sweep asks for a
 * ZOOM and reads an altitude back, and the flight controller re-syncs from the
 * map on idle, so which altitude a given zoom lands on is a race. An
 * instrument whose verdict flips run to run cannot gate a change.
 *
 * This asks for an ALTITUDE instead, the way audit-motion.mjs does: invert the
 * slant range to a zoom (alt = cameraToCenterDistance / pixelsPerMeter x
 * cos(pitch) — measured exact to 0.06 m over 16 poses by audit-camera.mjs),
 * jump there, wait out the LOD debounce, and assert on window.LOD_isHidden. It
 * prints the altitude it actually reached next to the one it asked for, so a
 * miss is visible rather than silent.
 *
 * Climbs a ladder and descends the same one, then checks:
 *   A  the roof caps are never dropped by the LOD  (the bug this PR fixes)
 *   B  every pose landed within 2 % of the altitude asked for (instrument)
 *   C  there is a band where fine is dropped and mid is not
 *   D  the descent restores everything the climb hid
 *   E  hysteresis: fine hides higher on the way up than it returns on the way
 *      down  (the _tierHidden fix — before, the tier state was read off the
 *      first id in the list, which is absent until its own fetch lands)
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';

const di = process.argv.indexOf('--distance');
const D = di > 0 ? +process.argv[di + 1] : 700;
const CAPS = ['drag-cap', 'wc-wall-cap', 'moody-roof'];
const LADDER = [60, 120, 200, 260, 300, 320, 340, 360, 400, 500, 620, 700, 760, 820, 880];

const browser = await launch(chromium, { gl: 'swiftshader', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await applySwaps(page);
await page.goto(BASE + '/?intro=0&drift=0&clip=1&apartments=0&slopes=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && !document.getElementById('veil'), null, { timeout: 300000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// Give the tier layers that arrive on their own fetches (props-lit, trees-canopy)
// time to land — the hysteresis bug is invisible once they have.
await page.waitForTimeout(6000);
await page.evaluate(d => { window.GFX.renderDistance = d; window.applyGraphics(); }, D);
await page.waitForTimeout(500);

const present = await page.evaluate(() => {
  const t = window.LOD_TIERS, m = window.__map;
  const has = ids => ids.filter(id => !!m.getLayer(id));
  return { fine: has(t.fine), mid: has(t.mid), fineAll: t.fine, midAll: t.mid };
});
console.log(`[tiers] renderDistance ${D}; fine ${present.fine.length}/${present.fineAll.length} present, mid ${present.mid.length}/${present.midAll.length}`);
console.log(`[tiers] fine absent: ${present.fineAll.filter(i => !present.fine.includes(i)).join(', ') || '-'}`);
console.log(`[tiers] mid absent:  ${present.midAll.filter(i => !present.mid.includes(i)).join(', ') || '-'}`);
console.log(`[tiers] caps still listed in a tier: ${CAPS.filter(c => present.fineAll.includes(c) || present.midAll.includes(c)).join(', ') || 'none'}`);

// A FIXED SLEEP AFTER jumpTo IS NOT ENOUGH, and getting this wrong is the whole
// reason lod-check.mjs is unreliable. js/controls.js only re-derives its eye
// state in syncFromMap(), which runs on the controller's tick — and the tick is
// driven by repaints. Once the map goes idle after a jump it stops painting, so
// `__fly.eye().alt` can sit on the PREVIOUS pose indefinitely. A first cut of
// this script slept 1.2 s and read 126.8 m for all fifteen rungs of the climb.
// So: keep asking for a repaint and wait for the altitude to actually arrive.
async function at(alt) {
  await page.evaluate((alt) => {
    const m = window.__map, rad = x => x * Math.PI / 180;
    const lng = -97.7434, lat = 30.2857, pitch = 70, bearing = 200;
    const Dd = alt / Math.cos(rad(pitch)), lead = Dd * Math.sin(rad(pitch));
    const clat = lat + lead * Math.cos(rad(bearing)) / 110540;
    const clng = lng + lead * Math.sin(rad(bearing)) / (111320 * Math.cos(rad(lat)));
    const zoom = Math.log2(40075016.686 * Math.cos(rad(clat)) / (512 * (Dd / m.transform.cameraToCenterDistance)));
    m.jumpTo({ center: [clng, clat], zoom, pitch, bearing });
  }, alt);
  await page.waitForFunction((want) => {
    window.__map.triggerRepaint();
    const e = window.__fly && window.__fly.eye();
    return !!e && Math.abs(e.alt - want) / want < 0.01;
  }, alt, { timeout: 25000, polling: 120 }).catch(() => {});   // a miss is check B's to report, not an exception
  await page.waitForTimeout(600);       // > LOD.settleMs (140) plus a repaint
  return await page.evaluate(() => {
    const t = window.LOD_TIERS, m = window.__map, e = window.__fly ? window.__fly.eye() : null;
    const hid = ids => ids.filter(id => m.getLayer(id) && window.LOD_isHidden(id));
    const none = ids => ids.filter(id => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') === 'none');
    return { alt: e ? +e.alt.toFixed(1) : null, fineHidden: hid(t.fine), midHidden: hid(t.mid),
             fineNone: none(t.fine).length, midNone: none(t.mid).length };
  });
}

const up = [], down = [];
for (const a of LADDER) {
  const r = await at(a); up.push({ ask: a, ...r });
  console.log(`  up   ask ${String(a).padStart(3)} m -> ${String(r.alt).padStart(6)} m  fineHidden ${String(r.fineHidden.length).padStart(2)} midHidden ${r.midHidden.length}`);
}
for (const a of [...LADDER].reverse()) {
  const r = await at(a); down.push({ ask: a, ...r });
  console.log(`  down ask ${String(a).padStart(3)} m -> ${String(r.alt).padStart(6)} m  fineHidden ${String(r.fineHidden.length).padStart(2)} midHidden ${r.midHidden.length}`);
}

const rows = [...up, ...down];
const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass }); console.log(`${pass ? ' PASS ' : '*FAIL '} ${name}`); console.log(`         ${detail}`); };

// A — the caps are never dropped
const capHits = rows.flatMap(r => [...r.fineHidden, ...r.midHidden]).filter(id => CAPS.includes(id));
ok('the roof caps are never dropped by the LOD',
   capHits.length === 0,
   capHits.length ? `hidden at some altitude: ${[...new Set(capHits)].join(', ')}`
                  : `${CAPS.join(', ')} stayed drawn at all ${rows.length} poses`);

// B — the instrument itself
const worst = rows.reduce((w, r) => Math.max(w, Math.abs(r.alt - r.ask) / r.ask), 0);
ok('every pose landed on the altitude it asked for', worst < 0.02,
   `worst miss ${(100 * worst).toFixed(2)} % over ${rows.length} poses (tolerance 2 %)`);

// C — a band where fine is gone and mid is not
const band = up.filter(r => r.fineHidden.length > 0 && r.midHidden.length === 0);
ok('there is an altitude band where fine is dropped and mid is not', band.length > 0,
   band.length ? `${band.length} poses, ${band[0].alt}-${band[band.length - 1].alt} m (thresholds ${Math.round(D * 0.45)} / ${D})`
               : 'none in the ladder');

// D — the descent restores everything
const bottom = down[down.length - 1];
ok('the descent restores every layer the climb hid',
   bottom.fineHidden.length === 0 && bottom.midHidden.length === 0 && bottom.fineNone === 0 && bottom.midNone === 0,
   `back at ${bottom.alt} m: fineHidden ${bottom.fineHidden.length}, midHidden ${bottom.midHidden.length}, visibility:none ${bottom.fineNone + bottom.midNone}`);

// E — hysteresis is real and in the right direction
const upOn = up.find(r => r.fineHidden.length > 0);
const downOff = [...down].reverse().find(r => r.fineHidden.length > 0);
const thr = D * 0.45;
ok('fine hides higher going up than it returns going down (hysteresis)',
   !!(upOn && downOff) && upOn.alt > downOff.alt + 1,
   upOn && downOff ? `up: first hidden at ${upOn.alt} m; down: last hidden at ${downOff.alt} m; threshold ${thr.toFixed(0)} m +/-8 % = ${(thr * 0.92).toFixed(0)}-${(thr * 1.08).toFixed(0)} m`
                   : 'the fine tier never hid in the ladder');

ok('no uncaught page errors', errs.length === 0, errs.length ? errs.join(' | ') : 'none');

const passed = checks.filter(c => c.pass).length;
console.log(`\n${passed}/${checks.length} passed`);
// __done(), not close(): it clears chrome.mjs's watchdog and SIGKILLs the
// browser process. close() alone leaves the watchdog armed and can orphan a
// Chrome on Windows, which is the one thing this round must not do.
await browser.__done();
process.exit(passed === checks.length ? 0 : 1);
