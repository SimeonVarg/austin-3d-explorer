/**
 * light-tone.mjs — the filmic tone curve must be measurable in PIXELS.
 *
 * Claim under test: with the curve on, highlights roll off instead of clipping
 * (fewer flat-255 pixels where there was gradient) and shadows keep detail
 * (fewer flat-0 pixels), while midtones stay roughly where the grade put them.
 *
 * The curve is a CSS filter on #map, so it only affects the WebGL frame — the
 * screen-blended sky/fx overlays sit outside it. The A/B therefore hides those
 * overlays while measuring (they'd add uncontrolled light over the very pixels
 * being asserted), then a final composited pair is left in shots/ for eyes.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: String(d) });

await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

/** Decode a screenshot in-page and return per-region stats. */
async function stats(buf, regions) {
  return page.evaluate(async ({ b64, regions }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const out = {};
    for (const [name, r] of Object.entries(regions)) {
      const d = g.getImageData(r.x, r.y, r.w, r.h).data;
      let sum = 0, white = 0, black = 0, min = 255, max = 0;
      const hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l;
        if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) white++;
        if (d[i] <= 1 && d[i + 1] <= 1 && d[i + 2] <= 1) black++;
        if (l < min) min = l;
        if (l > max) max = l;
        hist[Math.min(255, Math.round(l))]++;
      }
      const n = d.length / 4;
      let levels = 0;
      for (let i = 0; i < 256; i++) if (hist[i]) levels++;
      out[name] = { mean: sum / n, whitePct: 100 * white / n, blackPct: 100 * black / n,
                    min: Math.round(min), max: Math.round(max), levels };
    }
    return out;
  }, { b64: buf.toString('base64'), regions });
}

async function pose(p, pitch, bearing, filmic, hideOverlays) {
  await page.evaluate(async ({ p, pitch, bearing, filmic, hideOverlays }) => {
    const m = window.__map;
    Object.assign(window.GFX, window.GFX_PRESETS.cinematic, { filmic });
    window.applyGraphics();
    for (const id of ['sky', 'fx-canvas', 'haze', 'vignette', 'fx-grain'])
      { const e = document.getElementById(id); if (e) e.style.visibility = hideOverlays ? 'hidden' : ''; }
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch, bearing });
    window.applyTimeOfDay(m, p, true);
  }, { p, pitch, bearing, filmic, hideOverlays });
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'tone-tmp.png') });   // throwaway; atlas settles
  await page.waitForTimeout(500);
  return page.screenshot({ path: path.join(outDir, `tone-p${p}-f${filmic}${hideOverlays ? '' : '-full'}.png`) });
}

// Regions in a 1440x900 frame at pitch 78 (horizon ~y290): sky above, city below.
const R = {
  sky:    { x: 120, y: 90,  w: 1100, h: 170 },
  city:   { x: 80,  y: 520, w: 1240, h: 300 },
};

// ── DAY: the curve must NOT re-grade the midtones ────────────────────
const dayA = await stats(await pose(0.12, 78, 250, 0,   true), R);
const dayB = await stats(await pose(0.12, 78, 250, 0.8, true), R);
console.log('DAY  filmic0', JSON.stringify(dayA));
console.log('DAY  filmic.8', JSON.stringify(dayB));
check('day: midtones stay put (city mean within 5%)',
  Math.abs(dayB.city.mean - dayA.city.mean) < dayA.city.mean * 0.05,
  `city mean ${dayA.city.mean.toFixed(1)} -> ${dayB.city.mean.toFixed(1)}`);
check('day: sky mean moves less than 4%',
  Math.abs(dayB.sky.mean - dayA.sky.mean) < dayA.sky.mean * 0.04,
  `sky mean ${dayA.sky.mean.toFixed(1)} -> ${dayB.sky.mean.toFixed(1)}`);

// ── GOLDEN: the real flat-255 plateau lives in the city region ───────
const golA = await stats(await pose(0.47, 78, 250, 0,   true), R);
const golB = await stats(await pose(0.47, 78, 250, 0.8, true), R);
console.log('GOLD filmic0', JSON.stringify(golA));
console.log('GOLD filmic.8', JSON.stringify(golB));
check('golden: flat-white plateau shrinks (city region, where it was measured)',
  golB.city.whitePct < golA.city.whitePct * 0.5 + 0.02,
  `city whitePct ${golA.city.whitePct.toFixed(3)}% -> ${golB.city.whitePct.toFixed(3)}%`);
check('golden: highlight ceiling never rises',
  golB.sky.max <= golA.sky.max + 1,
  `sky max ${golA.sky.max} -> ${golB.sky.max}`);
check('golden: midtones stay put (city mean within 5%)',
  Math.abs(golB.city.mean - golA.city.mean) < golA.city.mean * 0.05,
  `city mean ${golA.city.mean.toFixed(1)} -> ${golB.city.mean.toFixed(1)}`);

// ── NIGHT: contrast-crushed shadows must come back, night stays night ─
const ngtA = await stats(await pose(0.92, 70, 90, 0,   true), R);
const ngtB = await stats(await pose(0.92, 70, 90, 0.8, true), R);
console.log('NGT  filmic0', JSON.stringify(ngtA));
console.log('NGT  filmic.8', JSON.stringify(ngtB));
check('night: flat-black crush shrinks with the curve on',
  ngtB.city.blackPct < ngtA.city.blackPct * 0.6 + 0.05,
  `city blackPct ${ngtA.city.blackPct.toFixed(2)}% -> ${ngtB.city.blackPct.toFixed(2)}%`);
check('night: shadow floor lifts off 0, never sinks',
  ngtB.city.min >= ngtA.city.min,
  `city min ${ngtA.city.min} -> ${ngtB.city.min}`);
check('night: still reads as night (city mean within 10%, may only rise)',
  ngtB.city.mean >= ngtA.city.mean - 1 &&
  ngtB.city.mean < ngtA.city.mean * 1.10 + 1,
  `city mean ${ngtA.city.mean.toFixed(1)} -> ${ngtB.city.mean.toFixed(1)}`);

// ── Numeric probe: what the browser ACTUALLY applies vs the authored LUT ──
// ctx.filter = 'url(#a3d-tone)' runs the same SVG filter over a grey ramp we
// can read back — this catches an sRGB/linearRGB surprise or a dead url() ref,
// which from screenshots alone would look like "subtle tuning".
const probe = await page.evaluate(() => {
  const src = document.createElement('canvas'); src.width = 256; src.height = 1;
  const sg = src.getContext('2d');
  const im = sg.createImageData(256, 1);
  for (let i = 0; i < 256; i++) { im.data[i*4] = im.data[i*4+1] = im.data[i*4+2] = i; im.data[i*4+3] = 255; }
  sg.putImageData(im, 0, 0);
  const dst = document.createElement('canvas'); dst.width = 256; dst.height = 1;
  const dg = dst.getContext('2d');
  dg.filter = 'url(#a3d-tone)';
  dg.drawImage(src, 0, 0);
  const out = dg.getImageData(0, 0, 256, 1).data;
  const tv = document.querySelector('filter#a3d-tone feFuncR').getAttribute('tableValues').split(' ').map(Number);
  const samples = [];
  for (const x of [0, 32, 64, 128, 192, 224, 255]) {
    const u = x / 255 * (tv.length - 1);
    const i0 = Math.floor(u), f = u - i0;
    const exp = (tv[i0] * (1 - f) + tv[Math.min(tv.length - 1, i0 + 1)] * f) * 255;
    samples.push({ x, got: out[x * 4], exp: Math.round(exp) });
  }
  return samples;
});
console.log('PROBE', JSON.stringify(probe));
check('browser transfer matches the authored LUT (sRGB, alive, no recolour)',
  probe.every(s => Math.abs(s.got - s.exp) <= 3),
  probe.map(s => `${s.x}->${s.got}(exp ${s.exp})`).join(' '));

// ── Composited pairs for the eyeball pass ────────────────────────────
await pose(0.47, 78, 250, 0, false);
await pose(0.47, 78, 250, 0.8, false);

// ── The filter chain itself ──────────────────────────────────────────
const chain = await page.evaluate(() => {
  Object.assign(window.GFX, { filmic: 0.8 });
  window.applyGraphics();
  const f = document.getElementById('map').style.filter;
  const svg = !!document.querySelector('filter#a3d-tone feFuncR[type="table"]');
  const tv = document.querySelector('filter#a3d-tone feFuncR');
  const vals = tv ? tv.getAttribute('tableValues').split(' ').map(Number) : [];
  let monotonic = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1] - 1e-6) monotonic = false;
  return { f, svg, n: vals.length, first: vals[0], last: vals[vals.length - 1], monotonic };
});
check('filter chain references the SVG LUT', chain.f.includes('url("#a3d-tone")') || chain.f.includes('url(#a3d-tone)'), chain.f);
check('LUT exists, is monotonic, spans toe to shoulder',
  chain.svg && chain.n >= 17 && chain.monotonic && chain.first >= 0 && chain.last <= 1,
  `${chain.n} samples, [${chain.first} .. ${chain.last}], monotonic=${chain.monotonic}`);

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(r => r.pass) ? 0 : 1);
