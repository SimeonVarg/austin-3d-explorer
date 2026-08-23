/**
 * smoke.mjs — the gate this round has to clear before it is pushed.
 *
 * Five things, and every one of them has been broken by an edit in this lane at
 * some point today:
 *   1. the page loads with no console error and no pageerror
 *   2. the lighting card still reports the same lamp counts it did before the
 *      canopy work, on a route whose numbers are written down (ANB->ETC: 24
 *      lamps, 2 phones, 680 m longest unmapped stretch)
 *   3. the canopy count is present, non-zero, and never larger than the lamp
 *      count it is a subset of
 *   4. `litCanopyMult` ships at 1, so the search is unchanged from round 2
 *   5. WITH THE SHIP SWITCH OFF (no ?walk), none of it exists: no wayfind
 *      layers, no walk_lamps.json fetch, no button
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/smoke.mjs
 */
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const fails = [];
const ok = (cond, what, got) => {
  console.log(`  ${cond ? 'pass' : '*FAIL'}  ${what}${got === undefined ? '' : '  ->  ' + JSON.stringify(got)}`);
  if (!cond) fails.push(what);
};

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

console.log('# smoke — with ?walk=1');
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate(() => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = '0.92'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, 0.92, true);
});
await page.waitForTimeout(1500);

const r = await page.evaluate(async () => {
  const res = await window.wayfindRoute('ANB', 'ETC', { expand: true });
  const lit = await window.wayfindLit();
  const pill = document.getElementById('wf-pill') || document.querySelector('#wayfind');
  return { res, lit, text: pill ? pill.innerText : '', mult: window.WAYFIND.litCanopyMult };
});
ok(r.res.ok, 'ANB->ETC routes');
ok(r.lit.lamps === 24, 'lamp count unchanged from round 2', r.lit.lamps);
ok(r.lit.phones === 2, 'phone count unchanged', r.lit.phones);
// 678, not the 680 the card prints — fmtDist rounds for the reader and
// wayfindLit returns the metres. Asserting the printed number against the
// measured one is how a test disagrees with itself.
ok(r.lit.longestGapM === 678, 'longest unmapped stretch unchanged', r.lit.longestGapM);
ok(r.lit.indexCanopy === 56, 'index flags 56 lamps under canopy', r.lit.indexCanopy);
ok(r.lit.lampsUnderCanopy > 0, 'this route has covered lamps', r.lit.lampsUnderCanopy);
ok(r.lit.lampsUnderCanopy <= r.lit.lamps, 'covered is a SUBSET of counted', [r.lit.lampsUnderCanopy, r.lit.lamps]);
ok(r.lit.lampsUnderCanopy + r.lit.lampsInClear === r.lit.lamps, 'covered + clear === counted');
ok(r.mult === 1, 'litCanopyMult ships at 1 (search unchanged from round 2)', r.mult);
ok(/under tree cover/.test(r.text), 'the card says the canopy line');
ok(/scenery, not mapped light/.test(r.text), 'the card says the decoration line');
ok(/24 mapped streetlights/.test(r.text), 'the card still says the lamp count');
// typeof INSIDE the page: a function cannot be serialised across CDP, so
// evaluating the function itself returns undefined and this assertion was
// failing on a hook that is plainly there.
ok(await page.evaluate(() => typeof window.wayfindLitReprice) === 'function', 'the reprice hook exists');
ok(errs.length === 0, 'no page or console errors', errs.slice(0, 4));

console.log('# smoke — ship switch OFF (no ?walk)');
const errs2 = [];
const page2 = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page2.on('pageerror', e => errs2.push(e.message));
const fetched = [];
page2.on('request', q => { if (/walk_lamps|walk_graph/.test(q.url())) fetched.push(q.url()); });
await page2.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 180000 });
await page2.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page2.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page2.waitForTimeout(2500);
const off = await page2.evaluate(() => ({
  layers: window.__map.getStyle().layers.map(l => l.id).filter(id => /^wayfind/.test(id)),
  src: !!window.__map.getSource('wayfind-lit'),
  btn: !!document.querySelector('#wf-btn, .wf-btn'),
}));
ok(off.layers.length === 0, 'no wayfind layers with the switch off', off.layers);
ok(!off.src, 'no wayfind-lit source with the switch off');
ok(fetched.length === 0, 'walk_lamps.json / walk_graph.json not fetched', fetched);
ok(errs2.length === 0, 'no errors with the switch off', errs2.slice(0, 4));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall pass');
process.exit(fails.length ? 1 : 0);
