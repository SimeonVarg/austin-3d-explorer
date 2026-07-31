/**
 * light-sky2.mjs — the sky-canvas beauty pass: shaded clouds, the Belt of
 * Venus, star twinkle. All pixel-asserted on the sky canvas itself.
 *
 * Cloud shading is measured GLOBALLY without per-cloud geometry: diff the
 * canvas with clouds on vs off (cloud-only ink), then compare the
 * luma-weighted y-centroid against the alpha-weighted one. A bright top over
 * a grey base pulls the luma centroid ABOVE the mass centroid; flat lobes
 * (OFFSET=0, BASE_MIX=0) leave the two equal.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: String(d) });

await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect());

// Grab the sky canvas RGBA after a clean synchronous redraw.
const grab = `(() => {
  const c = document.getElementById('sky-canvas');
  return { w: c.width, h: c.height,
           d: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) };
})()`;

async function skyDiffStats(p, pitch, bearing, patchA, patchB) {
  return page.evaluate(async ({ p, pitch, bearing, patchA, patchB, grabSrc }) => {
    const m = window.__map;
    const apply = (patch) => {
      for (const [grp, vals] of Object.entries(patch.tune || {}))
        Object.assign(window.SKY_TUNE[grp], vals);
      for (const [k, v] of Object.entries(patch.gfx || {})) window.GFX[k] = v;
    };
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch, bearing });
    window.applyTimeOfDay(m, p, true);
    await new Promise(r => setTimeout(r, 700));
    // Warm up the readback path: Chrome demotes a canvas from GPU to CPU
    // rasterisation after repeated getImageData, and the two rasterisers
    // dither soft gradients differently — a ONE-TIME 40k-px "diff" that
    // masqueraded as a belt facing the wrong way. Burn it here.
    for (let k = 0; k < 3; k++) { window.updateSky(m, p); eval(grabSrc); }
    apply(patchA);
    window.updateSky(m, p);
    const A = eval(grabSrc);
    apply(patchB);
    window.updateSky(m, p);
    const B = eval(grabSrc);
    // Diff: ink present in A but not B (per-channel absolute difference).
    let sumA = 0, sumL = 0, sumAY = 0, sumLY = 0, changed = 0;
    let redY = 0, redW = 0, blueY = 0, blueW = 0;
    for (let i = 0; i < A.d.length; i += 4) {
      const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
      const da = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      if (da < 6) continue;
      changed++;
      const y = Math.floor(i / 4 / A.w);
      const l = Math.max(0, dr) + Math.max(0, dg) + Math.max(0, db);
      sumA += da; sumAY += da * y;
      sumL += l * l; sumLY += l * l * y;      // luma^2 weights the bright core
      if (dr > db + 10) { redW += da; redY += da * y; }
      if (db > dr + 10) { blueW += da; blueY += da * y; }
    }
    return {
      changed,
      massY: sumA ? sumAY / sumA : null,
      brightY: sumL ? sumLY / sumL : null,
      redY: redW ? redY / redW : null,
      blueY: blueW ? blueY / blueW : null,
      h: A.h,
    };
  }, { p, pitch, bearing, patchA, patchB, grabSrc: grab });
}

// Twinkle moves ~100k px per redraw at night; freeze it for every A/B diff
// in sections 1 and 2 or the star field IS the diff (measured: a "belt" of
// 207k changed px facing away from the belt).
await page.evaluate(() => { window.SKY_TUNE.TWINKLE.AMP = 0; });

// ── 1. Cloud shading ─────────────────────────────────────────────────
const SHADED = { tune: { CLOUD: { OFFSET: 0.45, BASE_MIX: 0.68 } }, gfx: { clouds: 1, stars: 1 } };
const CLOUDS_OFF = { gfx: { clouds: 0 } };
const FLAT = { tune: { CLOUD: { OFFSET: 0, BASE_MIX: 0 } }, gfx: { clouds: 1 } };

// Day, sun high overhead: bright TOPS. (p=0.25: sun elev 64.)
const dayShaded = await skyDiffStats(0.25, 84, 90, SHADED, CLOUDS_OFF);
const dayFlat = await skyDiffStats(0.25, 84, 90, FLAT, CLOUDS_OFF);
console.log('day shaded', JSON.stringify(dayShaded));
console.log('day flat  ', JSON.stringify(dayFlat));
const tiltShaded = dayShaded.brightY - dayShaded.massY;   // negative = bright side UP
const tiltFlat = dayFlat.brightY - dayFlat.massY;
check('clouds draw (diff has real ink)', dayShaded.changed > 4000, `${dayShaded.changed} px changed`);
// The absolute tilt is small BY CONSTRUCTION: lobes are squashed 0.30-0.52,
// so a local vertical offset compresses ~3x on screen, and clamped ink near
// the bright horizon dilutes the centroid further. The claims that matter:
// the sign (lit from ABOVE at day), a clear factor over the flat-lobe
// residual, and the strong flip at golden hour below. Confirmed by eye on
// sky2-clouds-day.png (bright tops, grey-blue bases).
check('day clouds: bright top over grey base (luma centroid above mass centroid)',
  tiltShaded < -0.4, `tilt ${tiltShaded.toFixed(2)} px (negative = lit from above)`);
check('flat lobes (OFFSET=0, BASE_MIX=0) have no tilt — the lever is live',
  Math.abs(tiltFlat) < Math.abs(tiltShaded) * 0.45,
  `flat tilt ${tiltFlat.toFixed(2)} vs shaded ${tiltShaded.toFixed(2)}`);

// Golden, sun at ~7 deg — BELOW most of the cloud band: undersides catch it.
const goldShaded = await skyDiffStats(0.49, 84, 250, SHADED, CLOUDS_OFF);
console.log('gold shaded', JSON.stringify(goldShaded));
const tiltGold = goldShaded.brightY - goldShaded.massY;
check('golden clouds: the lit side moves DOWN versus day (undersides catch the low sun)',
  tiltGold > tiltShaded + 1.0,
  `day tilt ${tiltShaded.toFixed(2)} -> golden tilt ${tiltGold.toFixed(2)} px`);

// restore cloud defaults
await page.evaluate(() => { Object.assign(window.SKY_TUNE.CLOUD, { OFFSET: 0.45, BASE_MIX: 0.68 }); window.GFX.clouds = 1; });

// ── 2. Belt of Venus ─────────────────────────────────────────────────
const BELT_ON = { tune: { BELT: { ROSE_A: 0.22, BLUE_A: 0.20 } } };
const BELT_OFF = { tune: { BELT: { ROSE_A: 0, BLUE_A: 0 } } };
// p=0.58: sun az ~266 -> anti-solar ~86. Face EAST.
const beltEast = await skyDiffStats(0.58, 84, 86, BELT_ON, BELT_OFF);
const beltWest = await skyDiffStats(0.58, 84, 266, BELT_ON, BELT_OFF);
const beltDay = await skyDiffStats(0.40, 84, 86, BELT_ON, BELT_OFF);
const beltNight = await skyDiffStats(0.78, 84, 86, BELT_ON, BELT_OFF);
console.log('belt east ', JSON.stringify(beltEast));
console.log('belt west ', JSON.stringify(beltWest));
check('belt draws on the anti-solar horizon at dusk (facing east)',
  beltEast.changed > 3000, `${beltEast.changed} px`);
check('belt rose band sits ABOVE its blue band',
  beltEast.redY != null && beltEast.blueY != null && beltEast.redY < beltEast.blueY - 3,
  `rose y ${beltEast.redY?.toFixed(1)}, blue y ${beltEast.blueY?.toFixed(1)} (canvas h ${beltEast.h})`);
check('no belt toward the sun', beltWest.changed < beltEast.changed * 0.1,
  `west ${beltWest.changed} px vs east ${beltEast.changed} px`);
check('belt only lives in its dusk window', beltDay.changed === 0 && beltNight.changed === 0,
  `p=0.40: ${beltDay.changed} px, p=0.78: ${beltNight.changed} px`);

// ── 3. Star twinkle ──────────────────────────────────────────────────
await page.evaluate(() => { window.SKY_TUNE.TWINKLE.AMP = 0.35; });
const tw = await page.evaluate(async (grabSrc) => {
  const m = window.__map;
  m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch: 84, bearing: 20 });
  window.applyTimeOfDay(m, 0.95, true);
  await new Promise(r => setTimeout(r, 700));
  const count = (X, Y) => {
    let n = 0;
    for (let i = 0; i < X.d.length; i += 4) {
      const da = Math.abs(X.d[i] - Y.d[i]) + Math.abs(X.d[i + 1] - Y.d[i + 1]) + Math.abs(X.d[i + 2] - Y.d[i + 2]);
      if (da >= 5) n++;
    }
    return n;
  };
  window.SKY_TUNE.TWINKLE.AMP = 0.35;
  window.updateSky(m, 0.95);
  const t1 = eval(grabSrc);
  await new Promise(r => setTimeout(r, 400));
  window.updateSky(m, 0.95);
  const t2 = eval(grabSrc);
  window.SKY_TUNE.TWINKLE.AMP = 0;
  window.updateSky(m, 0.95);
  const s1 = eval(grabSrc);
  await new Promise(r => setTimeout(r, 400));
  window.updateSky(m, 0.95);
  const s2 = eval(grabSrc);
  window.SKY_TUNE.TWINKLE.AMP = 0.35;
  return { twinkling: count(t1, t2), still: count(s1, s2) };
}, grab);
console.log('twinkle', JSON.stringify(tw));
check('bright stars twinkle between redraws', tw.twinkling > 40, `${tw.twinkling} px changed over 400 ms`);
check('with AMP=0 the star field is bit-still (no noise source)', tw.still === 0, `${tw.still} px changed`);

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.__done();
process.exit(results.every(r => r.pass) ? 0 : 1);
