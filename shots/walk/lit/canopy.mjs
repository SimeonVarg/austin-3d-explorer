/**
 * canopy.mjs — the new claim, against the pixels, in both directions.
 *
 * The card now says some of a route's counted street lamps are under tree
 * cover. That sentence is only allowed to exist if a camera can be flown to one
 * of those lamps and find a tree standing over it, and flown to an uncovered
 * one and not. So this does exactly that, and it picks its two sites FROM THE
 * DATA — the covered lamp nearest the middle of a real route, and an uncovered
 * one on the same route — rather than by eye.
 *
 * THE TEST THAT COULD FAIL. At each site, two frames at the same pose: one as
 * shipped, one with every tree layer hidden. If the lamp is genuinely under a
 * canopy, hiding the trees makes lamp pixels APPEAR. If it is in the clear, the
 * two frames have the same lamp pixels. A flag that could not be told apart
 * from its opposite this way would not be worth printing.
 *
 * Also A/Bs the search: does `litCanopyMult` change which route is offered, or
 * is it decoration in the cost function? Either answer is publishable; not
 * knowing is not.
 *
 * Usage:
 *   VERIFY_MAX_MS=900000 VERIFY_URL=http://127.0.0.1:8714 \
 *     node shots/walk/lit/canopy.mjs [--tod 0.92] [--tag canopy]
 */
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOD = parseFloat(opt('--tod', '0.92'));
const TAG = opt('--tag', 'canopy');
const OUT = 'shots/walk/lit';

const SITE_ZOOM = 19.8, SITE_PITCH = 0;
const EYE_ZOOM = 19.0, EYE_PITCH = 58;   // a walker's view, under the 70 deg
                                         // above which qRF stops seeing props
const MIN_PX = 40;
// The same fixed list litaudit.mjs uses, so the two runs describe one city.
const PAIRS = [
  ['ANB', 'ETC'], ['KIN', 'LTH'], ['PMA', 'JES'], ['GDC', 'JES'],
  ['UTC', 'DKR'], ['MAI', 'SZB'], ['WEL', 'BUR'], ['CLA', 'PAI'],
  ['GRE', 'JGB'], ['BAT', 'ETC'], ['UNB', 'PCL'], ['NHB', 'ECJ'],
];

fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const MPD_LAT = 111320, MPD_LON = 96500;
const distM = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => say('  [pageerror] ' + e.message));

say(`# canopy ${TAG} — ${new Date().toISOString()}`);
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate((v) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(2000);
const gotP = await page.evaluate(() => window.__todCurrentP);
if (gotP == null || Math.abs(gotP - TOD) > 0.02) { say(`FAIL: tod is ${gotP}`); await browser.close(); process.exit(1); }
say(`tod asserted: ${gotP}`);

await page.evaluate(() => {
  window.__ca = {
    async read() {
      const m = window.__map;
      m.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = m.getCanvas();
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const px = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w: c.width, h: c.height, px };
    },
    settle(ms) {
      return new Promise(r => {
        const m = window.__map; m.triggerRepaint();
        if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, ms || 500);
        m.once('idle', () => setTimeout(r, ms || 500)); setTimeout(r, 20000);
      });
    },
    jump(q) { window.__map.jumpTo(q); },
  };
});

// ── what the index says ─────────────────────────────────────────────────
say('');
say('## routes, and how many of their lamps are under a tree');
const rows = [];
let pick = null;
for (const [a, b] of PAIRS) {
  const r = await page.evaluate(async ([f, t]) => {
    const res = await window.wayfindRoute(f, t, {});
    if (!res || !res.ok) return null;
    const lit = await window.wayfindLit();
    return { distM: res.distM, lit };
  }, [a, b]);
  if (!r) { say(`  ${a}->${b}: no route`); continue; }
  const L = r.lit;
  rows.push({
    pair: `${a}->${b}`, m: Math.round(r.distM), lamps: L.lamps,
    underTree: L.lampsUnderCanopy, inClear: L.lampsInClear,
  });
  if (!pick && L.lampsUnderCanopy > 0 && L.lampsInClear > 0) {
    const covered = L.canopyAt;
    const clear = L.lampsAt.filter(p => !covered.some(q => distM(p, q) < 0.5));
    pick = { pair: `${a}->${b}`, covered: covered[0], clear: clear[0] };
  }
}
console.table(rows);
say('routes: ' + JSON.stringify(rows));
const idx = await page.evaluate(() => window.wayfindLit().then ? null : null).catch(() => null);
const nWarmCanopy = await page.evaluate(async () => (await window.wayfindLit()).indexCanopy);
say(`city-wide, the index flags ${nWarmCanopy} of its warm street lamps as under a canopy`);
if (!pick) { say('FAIL: no route carries both a covered and an uncovered lamp — nothing to compare'); await browser.close(); process.exit(1); }
say(`comparing on ${pick.pair}: covered lamp ${JSON.stringify(pick.covered)} vs clear lamp ${JSON.stringify(pick.clear)}`);

// ── the two-frame test ──────────────────────────────────────────────────
await page.evaluate(() => { if (window.wayfindClear) window.wayfindClear(); });
await page.waitForTimeout(400);
const treeLayers = await page.evaluate(() => window.__map.getStyle().layers.map(l => l.id).filter(id => /^trees-/.test(id)));
say(`tree layers hidden for the B frame: ${treeLayers.join(', ')}`);

// MEASURE THE LAMP, NOT "ANY WARM PIXEL". The first cut of this counted every
// bright warm pixel in the disc and reported the flag could not tell a covered
// lamp from a clear one — because js/night.js's decorative road pool is also
// bright and warm, and it was drowning the thing being measured. Repaint
// props-lit flat green and count green: then the number is the lamp and only
// the lamp. occluder.mjs, which did it this way from the start, got a clean
// 0 -> 3,285 at the same kind of site.
const MASKC = ['match', ['get', 'c'], 'blue', '#0000ff', '#00ff00'];
const shippedPaint = await page.evaluate(() => ({
  lit: window.__map.getPaintProperty('props-lit', 'circle-color'),
  core: window.__map.getPaintProperty('props-lit-core', 'circle-color'),
}));
await page.evaluate((c) => {
  window.__map.setPaintProperty('props-lit', 'circle-color', c);
  window.__map.setPaintProperty('props-lit-core', 'circle-color', c);
}, MASKC);

const lampPx = (R) => page.evaluate(async (rad) => {
  const shot = await window.__ca.read();
  const cx = shot.w / 2, cy = shot.h / 2, R2 = rad * rad;
  let n = 0;
  for (let y = 0; y < shot.h; y++) {
    const dy = y - cy; if (dy * dy > R2) continue;
    for (let x = 0; x < shot.w; x++) {
      const dx = x - cx; if (dx * dx + dy * dy > R2) continue;
      const k = (y * shot.w + x) * 4;
      const Rc = shot.px[k], G = shot.px[k + 1], B = shot.px[k + 2];
      const mx = Math.max(Rc, G, B); if (mx < 12) continue;
      if (G > mx * 0.55 && !(Rc > mx * 0.55)) n++;   // the masked lamp
    }
  }
  return n;
}, R);

const discR = await page.evaluate(([ll, z]) => {
  const m = window.__map;
  m.jumpTo({ center: ll, zoom: z, pitch: 0, bearing: 0 });
  const a = m.project(ll);
  const dLon = 25 / (111320 * Math.cos(ll[1] * Math.PI / 180));
  const b = m.project([ll[0] + dLon, ll[1]]);
  const cssR = Math.hypot(b.x - a.x, b.y - a.y);
  const c = m.getCanvas();
  return { cssR, devR: cssR * (c.width / c.clientWidth) };
}, [pick.covered, SITE_ZOOM]);
say(`25 m disc = ${discR.devR.toFixed(0)} device px`);

const results = [];
for (const [name, ll] of [['covered', pick.covered], ['clear', pick.clear]]) {
  for (const [pname, pose] of [['plan', { zoom: SITE_ZOOM, pitch: SITE_PITCH }], ['eye', { zoom: EYE_ZOOM, pitch: EYE_PITCH }]]) {
    await page.evaluate((q) => { window.__ca.jump(q); }, { center: ll, bearing: 0, ...pose });
    await page.evaluate(() => window.__ca.settle(800));
    const withTrees = await lampPx(discR.devR);
    await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-${pname}-trees.png`) });
    await page.evaluate((ids) => { for (const id of ids) window.__map.setLayoutProperty(id, 'visibility', 'none'); }, treeLayers);
    await page.evaluate(() => window.__ca.settle(700));
    const noTrees = await lampPx(discR.devR);
    await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-${pname}-notrees.png`) });
    await page.evaluate((ids) => { for (const id of ids) window.__map.setLayoutProperty(id, 'visibility', 'visible'); }, treeLayers);
    await page.evaluate(() => window.__ca.settle(400));
    results.push({ lamp: name, pose: pname, withTrees, noTrees, revealed: noTrees - withTrees });
  }
}
console.table(results);
say('frames: ' + JSON.stringify(results));

// put the real colours back before anything else looks at the scene
await page.evaluate((p) => {
  window.__map.setPaintProperty('props-lit', 'circle-color', p.lit);
  window.__map.setPaintProperty('props-lit-core', 'circle-color', p.core);
}, shippedPaint);

const cov = results.filter(r => r.lamp === 'covered');
const clr = results.filter(r => r.lamp === 'clear');
const covGain = cov.reduce((s, r) => s + r.revealed, 0);
const clrGain = clr.reduce((s, r) => s + r.revealed, 0);
say('');
say(`hiding the trees at the COVERED lamp reveals ${covGain} more warm pixels`);
say(`hiding the trees at the CLEAR   lamp reveals ${clrGain} more warm pixels`);
const verdict = covGain > clrGain && covGain >= MIN_PX;
say(verdict
  ? 'PASS — the flag separates a lamp with a tree over it from one without'
  : 'FAIL — the flag does not distinguish the two, do not print the sentence');

// ── does it change the route, or only the sentence? ─────────────────────
say('');
say('## the search A/B: litCanopyMult 1.25 (shipped) vs 1.0 (off)');
const ab = [];
for (const mult of [1.25, 1.0]) {
  const repriced = await page.evaluate((m) => {
    window.WAYFIND.litCanopyMult = m;
    // The weight array is memoised on the graph; drop it or the second half of
    // this A/B answers with the first half's array — the classic way to A/B
    // nothing. `wayfindLitReprice` exists for exactly this and its return value
    // is checked, because a hook that quietly is not there would look like a
    // clean null result.
    return typeof window.wayfindLitReprice === 'function' && window.wayfindLitReprice();
  }, mult);
  if (!repriced) { say('FAIL: no wayfindLitReprice hook — this A/B would be meaningless'); await browser.close(); process.exit(1); }
  for (const [a, b] of PAIRS) {
    const r = await page.evaluate(async ([f, t]) => {
      const res = await window.wayfindRoute(f, t, {});
      if (!res || !res.ok) return null;
      const lit = await window.wayfindLit();
      return { alt: lit.alt, lamps: lit.lamps, canopy: lit.lampsUnderCanopy };
    }, [a, b]);
    ab.push({
      mult, pair: `${a}->${b}`, lamps: r && r.lamps, underTree: r && r.canopy,
      altExtraM: r && r.alt ? r.alt.extraM : null,
      altLamps: r && r.alt ? r.alt.lamps : null,
      why: r && r.alt ? r.alt.why : null,
    });
  }
}
console.table(ab);
say('ab: ' + JSON.stringify(ab));
const half = ab.length / 2;
const changed = ab.slice(0, half).filter((r, i) => JSON.stringify(r.altExtraM) !== JSON.stringify(ab[half + i].altExtraM)).length;
say(`offers that differ between the two settings: ${changed}/${half}`);
await page.evaluate(() => { window.WAYFIND.litCanopyMult = 1.25; window.wayfindLitReprice(); });

// ── the card, so somebody can read it ───────────────────────────────────
await page.evaluate(async () => {
  await window.wayfindRoute('ANB', 'ETC', { expand: true });
});
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__ca.jump({ center: [-97.7355, 30.2870], zoom: 16.2, pitch: 45, bearing: 20 }); });
await page.evaluate(() => window.__ca.settle(900));
await page.screenshot({ path: path.join(OUT, `${TAG}-card.png`) });
const cardText = await page.evaluate(() => {
  const c = document.getElementById('wf-card') || document.querySelector('.wf-card');
  const pill = document.getElementById('wf-pill') || document.querySelector('#wayfind, .wf-pill');
  return ((pill && pill.innerText) || (c && c.innerText) || '').split('\n').filter(Boolean);
});
say('');
say('card reads:');
for (const l of cardText) say('  ' + l);

fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({
  when: new Date().toISOString(), tod: gotP, routes: rows, indexCanopy: nWarmCanopy,
  site: pick, discR, frames: results, covGain, clrGain, verdict, ab, cardText,
}, null, 1));
fs.writeFileSync(path.join(OUT, `${TAG}.log`), log.join('\n') + '\n');
say(`wrote ${OUT}/${TAG}.json`);
await browser.close();
process.exit(verdict ? 0 : 1);
