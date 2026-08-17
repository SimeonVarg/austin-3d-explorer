/**
 * smear3.mjs — is the band a WARM-UP or a POSE?  Then: whose pixels are they?
 *
 * smear2 froze the intro at the moment the veil lifts and the band did not
 * decay in 8 s. That is suggestive and NOT sufficient: pinning the camera also
 * pins every altitude- and zoom-gated thing in the app (LOD tier, atlas tier,
 * the entrances gate), so a warm-up that is waiting on the camera would look
 * exactly like a permanent artefact.
 *
 * So this script does the one test that separates them:
 *
 *   ARM `settled` — load with ?intro=0 (no flight at all), sit for 25 s so
 *   every source is idle and every tier has landed, and only THEN jumpTo the
 *   pose smear2 froze at. If the band is there, it is a property of the pose
 *   and the word "warm-up" is wrong.
 *
 * Then the magenta mask (HANDOFF §48): each fill-extrusion family is painted
 * `#ff00ff` in turn and the frame is shot, so the pixels inside the band can be
 * assigned to a layer instead of guessed at.
 *
 * Usage:
 *   VERIFY_URL=https://flyover-utx.vercel.app node smear3.mjs --arm settled
 *   VERIFY_URL=https://flyover-utx.vercel.app node smear3.mjs --arm magenta
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const ARM = arg('arm', 'settled');
const OUTDIR = path.resolve(arg('out', 'shots/smear'));
const SETTLE = Number(arg('settle', '25000'));
fs.mkdirSync(OUTDIR, { recursive: true });

// The pose smear2 pinned. Recorded, not invented — shots/smear/f2-log.json.
const POSE = { center: [-97.742, 30.268], zoom: 16.2, pitch: 78, bearing: 5 };

const browser = await launch(chromium, { headless: false });
const page = await (await browser.newContext({
  viewport: { width: 1920, height: 965 }, deviceScaleFactor: 1,
})).newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

async function shoot(name) {
  const file = path.join(OUTDIR, `s-${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92, timeout: 60000 });
  await page.waitForTimeout(180);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92, timeout: 60000 });
  return file;
}

console.log(`smear3 arm=${ARM} url=${BASE}`);
await page.goto(BASE + '/?intro=0&drift=0', { timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
console.log(`  settling ${SETTLE} ms …`);
await page.waitForTimeout(SETTLE);
await page.evaluate(() => new Promise(r => {
  const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 20000);
}));

// The controller owns the camera while flying — a seeded pose is overwritten on
// the next frame unless the fly rig has stopped driving (README).
await page.waitForFunction(() => !(window.__fly && window.__fly.eye && window.__fly.eye().driving),
  null, { timeout: 30000 }).catch(() => {});
await page.evaluate(P => { const m = window.__map; m.stop(); m.jumpTo(P); }, POSE);
await page.waitForTimeout(4000);
await page.evaluate(() => new Promise(r => {
  const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 20000);
}));
await page.evaluate(() => window.__map.triggerRepaint());
await page.waitForTimeout(1500);

const st = await page.evaluate(() => {
  const m = window.__map;
  return { z: +m.getZoom().toFixed(3), p: +m.getPitch().toFixed(1), b: +m.getBearing().toFixed(1),
           loaded: m.loaded(), tiles: m.areTilesLoaded(), preset: window.GFX && window.GFX.preset };
});
console.log('  pose', st);

if (ARM === 'settled') {
  console.log('  ', await shoot('settled-A'));
  await page.waitForTimeout(3000);
  console.log('  ', await shoot('settled-B'));   // pair = the instrument's noise floor
  // And the same pose again after a nudge away and back, to show it is the pose
  // and not one unlucky tile set.
  await page.evaluate(() => { window.__map.jumpTo({ center: [-97.75, 30.29], zoom: 15.5, pitch: 60, bearing: 180 }); });
  await page.waitForTimeout(6000);
  await page.evaluate(P => window.__map.jumpTo(P), POSE);
  await page.waitForTimeout(5000);
  console.log('  ', await shoot('settled-C-returned'));
} else {
  const fams = arg('fams', 'outer-tower,outer-midrise,outer-detail,outer-3d,outer-tower-roof,outer-midrise-roof,buildings-3d,buildings-roof,building-3d,heroes-glass,heroes-solid,places-glass,places-solid,parts-3d,roofs-pitched,roofscape-major,campus-storeys').split(',');
  await shoot('mag-BASE');
  for (const id of fams) {
    const ok = await page.evaluate(id => {
      const m = window.__map; const l = m.getStyle().layers.find(x => x.id === id);
      if (!l) return null;
      const prop = l.type === 'fill-extrusion' ? 'fill-extrusion-color'
                 : l.type === 'fill' ? 'fill-color' : l.type === 'line' ? 'line-color' : null;
      if (!prop) return null;
      const was = m.getPaintProperty(id, prop);
      window.__restore = () => m.setPaintProperty(id, prop, was);
      // A pattern beats a colour on a fill-extrusion, so the pattern has to go
      // for the mask to be visible at all — HANDOFF §48's trap.
      try { window.__pat = m.getPaintProperty(id, 'fill-extrusion-pattern'); } catch (e) { window.__pat = undefined; }
      if (l.type === 'fill-extrusion' && window.__pat !== undefined) {
        try { m.setPaintProperty(id, 'fill-extrusion-pattern', null); } catch (e) {}
        window.__restorePat = () => { try { m.setPaintProperty(id, 'fill-extrusion-pattern', window.__pat); } catch (e) {} };
      } else window.__restorePat = () => {};
      m.setPaintProperty(id, prop, '#ff00ff');
      m.triggerRepaint();
      return true;
    }, id);
    if (!ok) { console.log(`  (skip ${id})`); continue; }
    await page.waitForTimeout(1400);
    await shoot('mag-' + id);
    console.log('  magenta', id);
    await page.evaluate(() => { window.__restore(); window.__restorePat(); window.__map.triggerRepaint(); });
    await page.waitForTimeout(400);
  }
  await shoot('mag-RESTORED');
}
fs.writeFileSync(path.join(OUTDIR, `s-${ARM}.json`), JSON.stringify({ arm: ARM, pose: POSE, st, errors }, null, 2));
console.log('errors:', errors.length ? errors : 'none');
await browser.__done();
