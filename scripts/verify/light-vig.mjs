/**
 * light-vig.mjs — the vignette must follow the hour: near-neutral and barely
 * there at midday, warm-dark at golden, blue-black at night.
 *
 * Two layers of proof: the element's computed gradient (which hour tint was
 * written), and pixels — toggling GFX.vignette at a corner must darken it
 * with the right RELATIVE colour shift (warm tint preserves red's fraction at
 * golden, blue's at night). Absolute corner hue would mostly measure the
 * scene, so the assertion is on per-channel survival ratios.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';
import path from 'node:path';
import fs from 'node:fs';

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

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

/** Parse the last rgba() in the vignette's computed background. */
async function vigState(p) {
  return page.evaluate(async (p) => {
    const m = window.__map;
    Object.assign(window.GFX, window.GFX_PRESETS.cinematic, { autoExposure: false });
    window.applyGraphics();
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch: 70, bearing: 250 });
    window.applyTimeOfDay(m, p, true);
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('vignette');
    const cs = getComputedStyle(el);
    const mats = [...cs.backgroundImage.matchAll(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/g)];
    const last = mats[mats.length - 1];
    return {
      rgb: last ? [+last[1], +last[2], +last[3]] : null,
      a: last && last[4] != null ? +last[4] : 1,
      // INLINE opacity, not computed: #vignette has a 0.2 s opacity
      // transition, and on the software rasteriser the computed value lags a
      // read by whole transitions (measured 0.325 computed vs 0.451 inline).
      // The pixel checks below prove the visual result; this asserts intent.
      opacity: +el.style.opacity,
      todP: window.__todCurrentP,
    };
  }, p);
}

const day = await vigState(0.12);
const gold = await vigState(0.50);
const night = await vigState(0.92);
console.log('day  ', JSON.stringify(day));
console.log('gold ', JSON.stringify(gold));
console.log('night', JSON.stringify(night));

check('midday: near-neutral tint, barely there',
  day.rgb && Math.max(...day.rgb) - Math.min(...day.rgb) <= 14 && day.opacity * day.a < 0.09,
  `rgb ${day.rgb} a ${day.a} x opacity ${day.opacity} = ${(day.opacity * day.a).toFixed(3)}`);
check('golden: warm-dark tint (r clearly above b), stronger than midday',
  gold.rgb && gold.rgb[0] > gold.rgb[2] + 25 && gold.opacity * gold.a > day.opacity * day.a * 2,
  `rgb ${gold.rgb}, strength ${(gold.opacity * gold.a).toFixed(3)} vs day ${(day.opacity * day.a).toFixed(3)}`);
check('night: blue-black tint (b clearly above r)',
  night.rgb && night.rgb[2] > night.rgb[0] + 10,
  `rgb ${night.rgb}, strength ${(night.opacity * night.a).toFixed(3)}`);

// ── Pixel proof: per-channel survival at a corner when the vignette toggles ──
async function cornerMeans(p, vig) {
  await page.evaluate(async ({ p, vig }) => {
    const m = window.__map;
    Object.assign(window.GFX, { vignette: vig });
    window.applyGraphics();
    window.applyTimeOfDay(m, p, true);
  }, { p, vig });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(900);
  const buf = await page.screenshot({ path: path.join(outDir, `vig-p${p}-v${vig}.png`) });
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(6, 700, 110, 110).data;      // bottom-left corner
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [r / n, gg / n, b / n];
  }, buf.toString('base64'));
}

for (const [label, p, warm] of [['golden', 0.50, true], ['night', 0.92, false]]) {
  const off = await cornerMeans(p, 0);
  const on = await cornerMeans(p, 1.6);
  const rSurv = on[0] / Math.max(1, off[0]);
  const bSurv = on[2] / Math.max(1, off[2]);
  console.log(`${label} corner off ${off.map(v => v.toFixed(1))} on ${on.map(v => v.toFixed(1))} ` +
    `rSurv ${rSurv.toFixed(3)} bSurv ${bSurv.toFixed(3)}`);
  check(`${label}: vignette darkens the corner (pixels changed)`,
    on[0] + on[1] + on[2] < (off[0] + off[1] + off[2]) * 0.93,
    `luma sum ${(off[0] + off[1] + off[2]).toFixed(0)} -> ${(on[0] + on[1] + on[2]).toFixed(0)}`);
  check(warm ? 'golden: corner shifts WARM (red survives better than blue)'
             : 'night: corner shifts COOL (blue survives better than red)',
    warm ? rSurv > bSurv + 0.01 : bSurv > rSurv + 0.01,
    `rSurv ${rSurv.toFixed(3)}, bSurv ${bSurv.toFixed(3)}`);
}

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.__done();
process.exit(results.every(r => r.pass) ? 0 : 1);
