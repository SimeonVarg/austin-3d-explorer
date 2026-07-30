/**
 * duskcheck.mjs — the dusk handover must be CONTINUOUS.
 * Sweeps p in fine steps and measures the frame-to-frame change in the
 * premultiplied (alpha x colour) contribution of both horizon glows.
 */
import { chromium } from 'playwright-core';
import { chromePath } from './chrome.mjs';
const EXE = chromePath();
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8099/index.html?intro=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4000);

const r = await page.evaluate(() => {
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const out = [];
  // Recompute the two glow schedules exactly as sky.js does, so we can sweep at
  // a resolution no screenshot could reach.
  for (let i = 5000; i <= 8000; i++) {
    const p = i / 10000;
    const B = window.skyBodies(p);
    const golden = B.golden;
    const wSun = B.sun.elev >= 0 ? 1 : clamp01(1 + B.sun.elev / 20);
    const wMoon = Math.pow(clamp01((B.moon.elev + 3) / 9), 1.2);
    out.push({
      p,
      aSun: (0.26 + 0.40 * golden) * wSun,
      aMoon: 0.17 * wMoon,
      sunAz: B.sun.az, moonAz: B.moon.az,
    });
  }
  let worst = { d: 0 }, overlap = null;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    const d = Math.abs(b.aSun - a.aSun) + Math.abs(b.aMoon - a.aMoon);
    if (d > worst.d) worst = { d, p: b.p, aSun: b.aSun, aMoon: b.aMoon };
    if (overlap === null && b.aSun > 0.10 && b.aMoon > 0.10) overlap = b.p;
  }
  const at = q => out.find(o => Math.abs(o.p - q) < 0.00006);
  return { worst, overlap, samples: [0.50, 0.5924, 0.5926, 0.65, 0.685, 0.72, 0.778, 0.80].map(at) };
});
console.log('worst frame-to-frame glow change:', JSON.stringify(r.worst));
console.log('first p where BOTH glows exceed 0.10 (true overlap):', r.overlap);
console.log('');
console.log('   p      aSun    aMoon   sunAz  moonAz');
for (const s of r.samples) if (s) console.log(`${s.p.toFixed(4)}  ${s.aSun.toFixed(4)}  ${s.aMoon.toFixed(4)}  ${s.sunAz.toFixed(1)}  ${s.moonAz.toFixed(1)}`);
await browser.close();
