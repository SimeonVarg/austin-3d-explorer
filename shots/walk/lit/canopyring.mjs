/**
 * canopyring.mjs — the picture for round 5's one visible change, and the A/B
 * that proves it is a change.
 *
 * A counted street lamp with a live oak on it gets the same receipt ring as one
 * standing in the open, in a dimmer value (`litPadCanopyCol`). The reason is a
 * measurement, not a preference: round 5's matrix put twelve cameras on amber
 * stretches and the two that were pitch black were both canopy-flagged, with
 * trees alone worth +4,380 and +3,034 pool pixels when hidden. A full-strength
 * amber ring around a lamp throwing nothing was the only mark in this feature
 * claiming more light than the scene has.
 *
 * THREE THINGS, AND THE FIRST TWO ARE PICTURES:
 *   1. the flagged lamp and a clear lamp on the SAME route, same night, same
 *      pose, so the two rings can be compared without trusting a hex value;
 *   2. the same flagged lamp with `litPadCanopyOn` flipped off — which is what
 *      shipped before this round, so the pair is the change;
 *   3. the ring's own pixels, read back off the frame and matched against the
 *      two constants. A ring that is "obviously dimmer" to me and 3 RGB values
 *      dimmer on the screen is a change nobody will ever see, and this project
 *      has shipped one of those before.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/canopyring.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const NIGHT = 0.92, ZOOM = 20.6, W = 960, H = 600;
const PAIR = ['AFP', 'TCC'];   // one of round 5's two black amber sites
const fails = [];
const ok = (c, what, got) => {
  console.log(`  ${c ? 'pass' : '*FAIL'}  ${what}${got === undefined ? '' : '  ->  ' + JSON.stringify(got)}`);
  if (!c) fails.push(what);
};

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate((p) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(p); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, p, true);
}, NIGHT);
await page.waitForTimeout(1500);
// Same guard stretchscene.mjs needed: a camera pointed at a layer that has not
// been added yet reports a confident zero.
await page.waitForFunction(() => !!(window.__map.getLayer('props-lit') && window.__map.getLayer('props-lamp')),
  null, { timeout: 120000 });

const site = await page.evaluate(async ([f, t]) => {
  await window.wayfindRoute(f, t, {});
  const lit = await window.wayfindLit();
  const root = document.getElementById('wf-root'); if (root) root.style.display = 'none';
  const cov = lit.canopyAt || [];
  const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const covKeys = new Set(cov.map(key));
  const clear = (lit.lampsAt || []).filter(p => !covKeys.has(key(p)));
  return { covered: cov[0] || null, clear: clear[0] || null, lamps: lit.lamps,
    underCanopy: lit.lampsUnderCanopy, drawn: lit.drawn, cols: {
      lamp: window.WAYFIND.litLampCol, canopy: window.WAYFIND.litPadCanopyCol } };
}, PAIR);
console.log(`${PAIR.join('->')}: ${site.lamps} counted lamps, ${site.underCanopy} under canopy · marks ${JSON.stringify(site.drawn)}`);
ok(!!site.covered, 'the route has a canopy-flagged lamp to photograph');
ok(!!site.clear, 'and an unflagged one on the same route to compare it against');

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const BRIGHT = hex(site.cols.lamp), DIM = hex(site.cols.canopy);
console.log(`ring colours: open ${site.cols.lamp} ${BRIGHT}  ·  covered ${site.cols.canopy} ${DIM}`);

/**
 * Fly to a ring and read the pixels that are actually IT — by hiding the pad
 * layer and diffing, which is the only way to isolate a mark that is composited.
 *
 * THE FIRST CUT CLASSIFIED AGAINST THE TWO CONSTANTS and got a confident,
 * completely wrong answer. `fill-extrusion-opacity` is 0.8, multiplied again by
 * the night clock, over near-black ground — so a ring painted #ffc27a
 * (255,194,122) lands on screen at about (131,113,82), which is NEARER THE DIM
 * CONSTANT THAN THE BRIGHT ONE. The open lamp's ring was scored as the covered
 * one's, 11,454 pixels of it, and the covered lamp scored as nothing at all
 * because it composited darker than either. A test that reads a paint constant
 * off a composited pixel is measuring the opacity, not the colour.
 */
async function ringAt(ll, tag, pose) {
  await page.evaluate(([p, z, pi]) => { window.__map.jumpTo({ center: p, zoom: z, pitch: pi, bearing: 0 }); }, [ll, pose.z, pose.pitch]);
  await page.waitForTimeout(800);
  await page.evaluate(() => new Promise((r) => { const t = setTimeout(r, 3000); window.__map.once('idle', () => { clearTimeout(t); r(); }); }));
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  fs.writeFileSync(`${OUT}/${tag}.png`, shot);
  await page.evaluate(() => { window.__map.setLayoutProperty('wayfind-lit-pad', 'visibility', 'none'); });
  await page.waitForTimeout(500);
  const without = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await page.evaluate(() => { window.__map.setLayoutProperty('wayfind-lit-pad', 'visibility', 'visible'); });
  await page.waitForTimeout(400);
  const rad = await page.evaluate(([p]) => {
    const m = window.__map, c = m.project(p);
    const dLon = 6 / (111320 * Math.cos(p[1] * Math.PI / 180));   // 6 m: the 2.8 m ring plus slack
    return { cx: c.x, cy: c.y, r: Math.abs(m.project([p[0] + dLon, p[1]]).x - c.x) };
  }, [ll]);
  return page.evaluate(async ([a64, b64, cx, cy, r, w]) => {
    const load = (b) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b; });
    const [A, B] = await Promise.all([load(a64), load(b64)]);
    const dat = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, im.width, im.height).data; };
    const a = dat(A), b = dat(B), Wp = A.width;
    const sx = Wp / w, PX = cx * sx, PY = cy * sx, PR = r * sx;
    let n = 0, sum = [0, 0, 0];
    for (let y = Math.max(0, Math.floor(PY - PR)); y < Math.min(A.height, PY + PR); y++) {
      for (let x = Math.max(0, Math.floor(PX - PR)); x < Math.min(Wp, PX + PR); x++) {
        const i = (y * Wp + x) * 4;
        // the ring is exactly the pixels that CHANGE when its layer is hidden
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 8) continue;
        sum[0] += a[i]; sum[1] += a[i + 1]; sum[2] += a[i + 2]; n++;
      }
    }
    const mean = n ? sum.map(v => Math.round(v / n)) : null;
    return { n, mean, lum: mean ? Math.round(0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]) : 0 };
  }, [shot.toString('base64'), without.toString('base64'), rad.cx, rad.cy, rad.r, W]);
}

// TWO POSES, AND THE PLAN ONE IS NOT THE ANSWER. Straight down at z20.6 a live
// oak fills the frame and hides the lamp AND the ring under it: 0 ring pixels,
// nothing to overstate, and a test run only there would conclude the change is
// pointless. The pose this feature is FOR is the one the app opens in — a
// person on the pavement, under the canopy, looking along the path. From there
// the ring is on the ground in front of them and the light is not.
const PLAN = { pitch: 0, z: ZOOM }, EYE = { pitch: 58, z: 19.6 };

console.log('\n# 0. straight down, where the tree hides both');
const covPlan = await ringAt(site.covered, 'r5-ring-covered-plan', PLAN);
console.log(`  covered lamp from above: ${covPlan.n} ring px  (the canopy is over the ring as well as the lamp)`);

console.log('\n# 1. the two rings from the pavement, same route, same night');
const cov = await ringAt(site.covered, 'r5-ring-covered', EYE);
const clr = await ringAt(site.clear, 'r5-ring-clear', EYE);
console.log(`  covered lamp: ${cov.n} ring px, mean ${JSON.stringify(cov.mean)}, luminance ${cov.lum}`);
console.log(`  clear   lamp: ${clr.n} ring px, mean ${JSON.stringify(clr.mean)}, luminance ${clr.lum}`);
ok(cov.n > 200 && clr.n > 200, 'both rings are actually on screen', [cov.n, clr.n]);
ok(cov.lum < clr.lum, 'the ring at the covered lamp is darker than the one at the open lamp', [cov.lum, clr.lum]);

console.log('\n# 2. the A/B — the same lamp with the change switched off');
await page.evaluate(async ([f, t]) => {
  window.WAYFIND.litPadCanopyOn = false;
  window.wayfindLitReprice();
  await window.wayfindRoute(f, t, {});
  const root = document.getElementById('wf-root'); if (root) root.style.display = 'none';
}, PAIR);
const before = await ringAt(site.covered, 'r5-ring-covered-before', EYE);
console.log(`  with litPadCanopyOn=false: ${before.n} ring px, mean ${JSON.stringify(before.mean)}, luminance ${before.lum}`);
ok(Math.abs(before.lum - clr.lum) <= 12,
  'before the change the covered lamp had the same bright ring as an open one', [before.lum, clr.lum]);
// The two frames must differ by more than a rounding: a change nobody can see
// is not a change. Mean channel distance between the shipped and previous ring.
const dist = (before.mean && cov.mean)
  ? Math.round(Math.sqrt(before.mean.reduce((s, v, i) => s + (v - cov.mean[i]) ** 2, 0))) : 0;
console.log(`  mean ring colour moved ${dist} in RGB distance (${JSON.stringify(before.mean)} -> ${JSON.stringify(cov.mean)})`);
ok(dist >= 25, 'and the difference is one a person can see, not a rounding', dist);
await page.evaluate(() => { window.WAYFIND.litPadCanopyOn = true; window.wayfindLitReprice(); });

fs.writeFileSync(`${OUT}/canopyring.json`, JSON.stringify({ pair: PAIR, night: NIGHT, plan: PLAN, eye: EYE, site, covPlan, cov, clr, before, dist, errs }, null, 1));
console.log('\nerrors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall pass');
process.exit(fails.length ? 1 : 0);
