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
ok(/24 mapped streetlights/.test(r.text), 'the card still says the lamp count');

// ROUND 4: the strip, and the fold.
//
// The three source paragraphs now sit in a drawer, so they are legitimately
// NOT in the card's text until it is opened — which is exactly why the two
// disclaimers that must never be behind a tap are asserted on the visible
// label FIRST, and the paragraphs asserted after opening it. A test that only
// checked the opened state would pass on a build that hid the warning too.
const fold = await page.evaluate(() => {
  const card = document.getElementById('wf-card');
  const kids = Array.from(card.children);
  const tog = kids.find(k => /where these numbers come from/i.test(k.textContent || ''));
  const before = card.innerText;
  if (tog) tog.click();
  return { label: tog ? tog.textContent : null, before, after: card.innerText };
});
ok(!!fold.label, 'the provenance fold has a visible label');
ok(/Mapped lamps only/.test(fold.label || ''), 'the label says the count is of the MAP', fold.label);
ok(/not a safety rating/.test(fold.label || ''), 'the label says it is not a safety rating');
ok(!/scenery, not mapped light/.test(fold.before), 'sources are folded away until asked for');
ok(/scenery, not mapped light/.test(fold.after), 'the decoration line is there when opened');
ok(/OpenStreetMap has 193 streetlights/.test(fold.after), 'the lamp source line is there when opened');
ok(/12 June 2026/.test(fold.after), 'and it still carries its own date');

const strip = await page.evaluate(() => {
  const t = document.querySelector('#wf-card [role="img"]');
  if (!t) return null;
  const segs = Array.from(t.children).filter(c => !c.style.position);
  const r = t.getBoundingClientRect();
  return {
    aria: t.getAttribute('aria-label'), segs: segs.length,
    ticks: Array.from(t.children).filter(c => c.style.position === 'absolute').length,
    w: Math.round(r.width), h: Math.round(r.height),
    // the segments must TILE the track: a gap is a stretch the picture makes
    // no claim about while the count does
    span: Math.round(segs.reduce((a, c) => a + c.getBoundingClientRect().width, 0)),
  };
});
ok(!!strip, 'the lighting strip is drawn');
ok(strip && strip.w > 100 && strip.h >= 8, 'the strip has real size', strip && [strip.w, strip.h]);
ok(strip && Math.abs(strip.span - strip.w) <= 2, 'its runs tile the whole track', strip && [strip.span, strip.w]);
ok(strip && strip.segs === r.lit.runs, 'one segment per run, none dropped', strip && [strip.segs, r.lit.runs]);
ok(strip && /mapped streetlight within 25 metres/.test(strip.aria || ''), 'the strip describes itself in words', strip && strip.aria);
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

// ROUND 4: the near-miss clause. CMB->TMM is one of the three routes in 60
// that carry it (shots/walk/lit/nearmiss.json) — a route with no counted lamp
// and two mapped just outside the radius. It is asserted on a NAMED route
// rather than 'some route somewhere', so a change that silently stops it
// firing fails here instead of going quiet.
const nm = await page.evaluate(async () => {
  await window.wayfindRoute('CMB', 'TMM', { expand: true });
  const lit = await window.wayfindLit();
  return { lamps: lit.lamps, nearMiss: lit.nearMiss, ring: lit.nearMissM,
    text: document.getElementById('wf-card').innerText };
});
ok(nm.lamps === 0, 'CMB->TMM still has no counted lamp', nm.lamps);
ok(nm.nearMiss === 2, 'and two mapped just outside the radius', nm.nearMiss);
// ROUND 5 narrowed the ring from 50 m to 40 m, at the measured edge of what is
// visible from the pavement at night (js/wayfind.js `litNearMissM`,
// shots/walk/lit/stretchscene.mjs). The sentence is asserted against the RING
// THE PAGE IS ACTUALLY USING rather than a hard-coded 50, so a future change of
// mind moves one constant and this gate follows it — but the ring itself is
// pinned below, because a silent drift back to 50 is exactly what this is for.
ok(nm.ring === 40, 'the near-miss ring is the measured 40 m', nm.ring);
ok(new RegExp(`No mapped streetlight along this route · 2 more are mapped within ${nm.ring} m of it`).test(nm.text),
  'the near-miss clause rides on the zero-lamp sentence');
const noNm = await page.evaluate(async () => {
  await window.wayfindRoute('ANB', 'ETC', { expand: true });
  await window.wayfindLit();
  return document.getElementById('wf-card').innerText;
});
ok(!/more are mapped within/.test(noNm), 'and does NOT appear on a route that has counted lamps');

// ROUND 5: the ring round a lamp with a tree on it. ANB->ETC has 24 counted
// lamps, 4 of them canopy-flagged (asserted above, unchanged since round 3), so
// the marks on the ground must split 20/4 — the card's sentence and the map's
// receipt agreeing is the whole point of the change.
//
// COUNTED OFF THE ARRAY litDraw HANDED THE SOURCE, and it took two wrong
// instruments to get there. `getSource('wayfind-lit')._data` is not the
// FeatureCollection that was set: it comes back undefined with zero features,
// which reads exactly like "the change did nothing". And `querySourceFeatures`
// repeats a feature in every tile it touches — 24 rings tallied as 64, then as
// 39 after deduplicating by first vertex, because tile clipping moves the
// vertices. Right ratio, meaningless count, and the kind of number that would
// pass a ">0" assertion and quietly fail an equality forever.
const pads = await page.evaluate(async () => {
  await window.wayfindRoute('ANB', 'ETC', { expand: true });
  const lit = await window.wayfindLit();
  return { n: lit.drawn || {}, on: lit.padCanopyOn, canopyCol: window.WAYFIND.litPadCanopyCol };
});
console.log('  (marks drawn: ' + JSON.stringify(pads.n) + ')');
ok(pads.on === true, 'the canopy ring ships on', pads.on);
ok(pads.n.lampcanopy === 4, 'four rings are drawn dim, one per covered lamp', pads.n.lampcanopy);
ok(pads.n.lamp === 20, 'and the other twenty at full strength', pads.n.lamp);
ok((pads.n.lamp || 0) + (pads.n.lampcanopy || 0) === 24,
  'every counted lamp still gets a ring — the count and the map agree');
ok(typeof pads.canopyCol === 'string' && /^#[0-9a-f]{6}$/i.test(pads.canopyCol),
  'the dim value is a named constant', pads.canopyCol);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall pass');
process.exit(fails.length ? 1 : 0);
