/**
 * smear2.mjs — FREEZE the smear, then take it apart.
 *
 * smear.mjs establishes that the band reproduces; it cannot attribute it,
 * because the camera is flying and every screenshot is a different pose.
 *
 * THE FREEZE IS THE WHOLE TRICK, and one `map.stop()` is NOT a freeze: the
 * intro's leg 1 resolves and immediately eases into leg 2, so a run that
 * stopped once was back at z16.9 over campus by the time the peel started and
 * photographed a pose with nothing wrong in it. This version pins the pose with
 * a repeating `stop() + jumpTo(P)` and asserts the pose is unchanged in every
 * shot's log line.
 *
 * Then, at that ONE pose:
 *   1. shoot it repeatedly — does the artefact decay on its own, with the
 *      camera held still? (This is what separates "not ready yet" from
 *      "this is what the scene looks like from here".)
 *   2. peel each DOM overlay (#fx-canvas, #sky, #vignette, #fx-grain, #fx-dof);
 *   3. hide one map-layer family at a time and diff. The family whose removal
 *      kills the band owns it. (README: to find which layer owns a pixel, hide
 *      layers one at a time and diff.)
 *
 * Every shot is taken twice and only the second is kept.
 *
 * Usage: VERIFY_URL=https://flyover-utx.vercel.app node smear2.mjs --rep 1
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const REP = arg('rep', '1');
const URLQ = arg('q', '');
const OUTDIR = path.resolve(arg('out', 'shots/smear'));
fs.mkdirSync(OUTDIR, { recursive: true });

const FAMS = (arg('fams', 'outer,buildings,building,roofs,roofscape,heroes,places,night,trees,ground,props,drag,wc,signs,entrances')).split(',');

const browser = await launch(chromium, { headless: false });
const page = await (await browser.newContext({
  viewport: { width: 1920, height: 965 }, deviceScaleFactor: 1,
})).newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.addInitScript(() => {
  const set = () => {
    const v = document.getElementById('veil');
    if (!v) return;
    new MutationObserver(() => {
      if (v.classList.contains('lift') && window.__liftAt == null) {
        window.__liftAt = performance.now();
        const m = window.__map;
        if (!m) return;
        try { m.stop(); } catch (e) {}
        const P = { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
        window.__frozenAt = P;
        // A single stop() is not a freeze — leg 2 starts as soon as leg 1
        // resolves, and the idle attract loop will fly it later too.
        window.__pin = setInterval(() => {
          try { if (m.isEasing()) m.stop(); m.jumpTo(P); } catch (e) {}
        }, 90);
      }
    }).observe(v, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.getElementById('veil')) set();
  else document.addEventListener('DOMContentLoaded', set, { once: true });
});

const log = [];
async function shoot(name, extraMs = 0) {
  if (extraMs) await page.waitForTimeout(extraMs);
  const file = path.join(OUTDIR, `f${REP}-${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92, timeout: 60000 });
  await page.waitForTimeout(180);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92, timeout: 60000 });
  const s = await page.evaluate(() => {
    const m = window.__map;
    return { t: Math.round(performance.now() - (window.__liftAt || 0)),
             z: m ? +m.getZoom().toFixed(3) : null, p: m ? +m.getPitch().toFixed(1) : null,
             b: m ? +m.getBearing().toFixed(1) : null,
             lng: m ? +m.getCenter().lng.toFixed(5) : null, lat: m ? +m.getCenter().lat.toFixed(5) : null,
             tiles: m ? m.areTilesLoaded() : null };
  });
  log.push({ name, file: path.basename(file), ...s });
  console.log(`  ${name.padEnd(24)} t=${String(s.t).padStart(6)} z=${s.z} pitch=${s.p} bear=${s.b} tiles=${s.tiles}`);
}

const setDisp = (sel, v) => page.evaluate(([sel, v]) => {
  document.querySelectorAll(sel).forEach(e => e.style.setProperty('display', v, 'important'));
}, [sel, v]);
const clearDisp = sel => page.evaluate(sel => {
  document.querySelectorAll(sel).forEach(e => e.style.removeProperty('display'));
}, sel);

const setFam = (fam, vis) => page.evaluate(([fam, vis]) => {
  const m = window.__map; let n = 0;
  for (const l of m.getStyle().layers) {
    if (!l.id.startsWith(fam)) continue;
    try { m.setLayoutProperty(l.id, 'visibility', vis); n++; } catch (e) {}
  }
  m.triggerRepaint(); return n;
}, [fam, vis]);

console.log(`smear2 rep=${REP} url=${BASE}/${URLQ}`);
await page.goto(BASE + '/' + URLQ, { timeout: 180000 });
await page.waitForFunction(() => window.__liftAt != null, null, { timeout: 180000, polling: 20 });

// 1. Does it decay with the camera held still?
await shoot('A-t0000');
await shoot('A-t0800', 400);
await shoot('A-t2000', 900);
await shoot('A-t4000', 1600);
await shoot('A-t8000', 3600);
await shoot('A-noise', 400);   // pair with A-t8000: the instrument's own floor

// 2. DOM overlays, one at a time.
for (const [tag, sel] of [
  ['B-off-fxcanvas', '#fx-canvas'],
  ['B-off-sky', '#sky'],
  ['B-off-vignette', '#vignette'],
  ['B-off-grain', '#fx-grain'],
  ['B-off-dof', '#fx-dof'],
  ['B-off-ALL', '#fx-canvas,#sky,#vignette,#fx-grain,#fx-dof'],
]) {
  await setDisp(sel, 'none');
  await shoot(tag, 450);
  await clearDisp(sel);
}
await shoot('B-restored', 450);

// 3. Map layers, one family at a time.
const layers = await page.evaluate(() => window.__map.getStyle().layers.map(l => ({ id: l.id, type: l.type })));
fs.writeFileSync(path.join(OUTDIR, `f${REP}-layers.json`), JSON.stringify(layers, null, 2));
for (const fam of FAMS) {
  const n = await setFam(fam, 'none');
  if (!n) { console.log(`  (skip ${fam}: 0 layers)`); continue; }
  await shoot(`C-hide-${fam}`, 500);
  await setFam(fam, 'visible');
}
await shoot('C-restored', 500);

fs.writeFileSync(path.join(OUTDIR, `f${REP}-log.json`),
  JSON.stringify({ url: BASE + '/' + URLQ, errors, log }, null, 2));
console.log('errors:', errors.length ? errors : 'none');
await browser.__done();
