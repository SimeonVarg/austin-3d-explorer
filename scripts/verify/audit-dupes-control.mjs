/**
 * audit-dupes-control.mjs — prove the duplicate probe can see, then look at the
 * one thing it found.
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-dupes-control.mjs <outDir>
 *
 * WHY. audit-dupes.mjs's run on 2026-09-19 ended with `control hits: []` — the
 * single assertion that says the probe is not blind, and it failed. Its finding
 * (exactly one legacy fill-extrusion inside 196 authored footprints) is a
 * NEGATIVE, and a negative from an instrument that failed its own control is
 * worth nothing. This re-runs the control against SIX ordinary buildings
 * instead of one, so a mis-sited point cannot be mistaken for a blind probe,
 * then re-probes the one hit and photographs it with the authored mesh on and
 * off, which is the only way to know whether a leftover prism is actually
 * visible or buried inside the replacement.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-dupes-control.mjs <outDir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

// Ordinary campus buildings, none of them authored. If the probe is live, every
// one of these must answer with at least one fill-extrusion.
const CONTROLS = [
  ['Batts Hall',            -97.73878, 30.28527],
  ['Welch Hall',            -97.73766, 30.28674],
  ['Painter Hall',          -97.73820, 30.28603],
  ['Burdine Hall',          -97.73950, 30.28450],
  ['Robert Lee Moore Hall', -97.73630, 30.28880],
  ['Belo Center',           -97.74120, 30.28800],
];

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1200000 });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await applySwaps(page);
await page.goto(BASE + '/?intro=0&drift=0&clip=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && !document.getElementById('veil'), null, { timeout: 400000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.readyToReveal() && window.slopesApartments.count.done, null, { timeout: 400000 });
const handoff = await page.evaluate(() => ({ on: !!(window.APARTMENTS && window.APARTMENTS.on), group: !!(window.slopesApartments && window.slopesApartments.group) }));
if (!handoff.on || !handoff.group) {
  console.log('[audit] authored buildings not in the scene - re-enabling and waiting');
  await page.evaluate(() => { window.APARTMENTS.on = true; window.applySlopesApartments(window.__map); });
  await page.waitForFunction(() => window.slopesApartments.group && window.slopesApartments.readyToReveal(), null, { timeout: 900000 });
}

const settle = async (c, z) => page.evaluate(async ([c, z]) => {
  const m = window.__map;
  m.jumpTo({ center: c, zoom: z, pitch: 0, bearing: 0 });
  await new Promise(r => { let d = false; const f = () => { if (!d) { d = true; r(); } }; m.once('idle', f); setTimeout(f, 8000); });
}, [c, z]);

console.log('--- control: can the probe see an ordinary building? ---');
let live = 0;
for (const [name, lng, lat] of CONTROLS) {
  await settle([lng, lat], 18);
  await page.waitForTimeout(900);
  const hits = await page.evaluate(([lng, lat]) => {
    const m = window.__map, p = m.project([lng, lat]);
    // a 3x3 tap, so a point that lands in a light well is not read as blindness
    const out = {};
    for (const dx of [-6, 0, 6]) for (const dy of [-6, 0, 6])
      for (const f of m.queryRenderedFeatures([p.x + dx, p.y + dy]))
        if (f.layer.type === 'fill-extrusion') out[f.layer.id] = (out[f.layer.id] || 0) + 1;
    return out;
  }, [lng, lat]);
  const n = Object.keys(hits).length;
  if (n) live++;
  console.log(`  ${n ? 'SEES ' : 'BLIND'} ${name.padEnd(24)} ${JSON.stringify(hits)}`);
}
console.log(`control: ${live}/${CONTROLS.length} ordinary buildings answered`);

console.log('--- the one hit: Longhorn Dining Facility inside Jester East Hall ---');
const jester = await page.evaluate(() => {
  const b = (window.slopesApartments.data.buildings || []).find(x => x.name === 'Jester East Hall');
  if (!b || !b.footprint) return null;
  const r = b.footprint.ring;
  let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; }
  return { centre: [x / r.length, y / r.length], hideRings: (b.hideRings || []).length, ring: r.length };
});
console.log('  Jester East footprint:', JSON.stringify(jester));
if (jester) {
  await settle(jester.centre, 17.6);
  await page.waitForTimeout(1200);
  const probe = await page.evaluate(() => {
    const m = window.__map, out = [];
    for (const f of m.queryRenderedFeatures({ layers: ['buildings-3d'] }))
      if (f.properties && /dining|jester/i.test(String(f.properties.name || '')))
        out.push({ name: f.properties.name, h: f.properties.h ?? f.properties.height ?? null, id: f.properties.id });
    const seen = {}; return out.filter(o => (seen[o.id] ? false : (seen[o.id] = 1)));
  });
  console.log('  buildings-3d features named dining/jester in view:', JSON.stringify(probe));

  // the picture: same camera, mesh on then off, from a flying angle where a
  // prism poking out would be visible (pitch 0 hides height differences).
  for (const [tag, pitch] of [['top', 0], ['oblique', 62]]) {
    await page.evaluate(async ([c, pitch]) => {
      const m = window.__map;
      m.jumpTo({ center: c, zoom: 17.2, pitch, bearing: 210 });
      await new Promise(r => { let d = false; const f = () => { if (!d) { d = true; r(); } }; m.once('idle', f); setTimeout(f, 8000); });
    }, [jester.centre, pitch]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `jester-${tag}-mesh.jpg`), type: 'jpeg', quality: 84 });
    await page.evaluate(() => { window.slopesApartments.group.visible = false; window.__map.triggerRepaint(); });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `jester-${tag}-nomesh.jpg`), type: 'jpeg', quality: 84 });
    await page.evaluate(() => { window.slopesApartments.group.visible = true; window.__map.triggerRepaint(); });
    await page.waitForTimeout(1200);
    console.log(`  wrote jester-${tag}-mesh.jpg / -nomesh.jpg`);
  }
}
await browser.__done();
process.exit(live === CONTROLS.length ? 0 : 1);
