/**
 * night-perf.mjs — do the streetlight layers cost frames at night?
 *
 * perf2.mjs pattern: HEADED (swiftshader timing is fiction), big viewport,
 * dropped-frame counts, interleaved a/b/a/b runs, judge by the MINIMUM.
 * Content is a scripted fixed bearing sweep so every run renders the same
 * buildings (holding W was a bigger noise source than any setting).
 *
 * The only per-frame delta the night workstream adds is the two circle layers
 * (pool + core, ~1200 features); the facade atlas is the same tile count and
 * size as before, so its repaint cost is unchanged by construction.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: false, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1400 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(6000);
await page.evaluate(async () => {
  window.applyTimeOfDay(window.__map, 0.95, true);
  await new Promise(res => window.__map.once('idle', res));
});

async function sweep(label, lightsVisible) {
  const r = await page.evaluate(async (vis) => {
    const m = window.__map;
    for (const id of ['night-streetlight-pool', 'night-streetlight-core']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none');
    }
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90 });
    await new Promise(r => setTimeout(r, 700));
    const dts = [];
    m.easeTo({ bearing: 210, duration: 4000, easing: t => t });
    const t0 = performance.now();
    await new Promise(res => {
      let last = null;
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        if (performance.now() - t0 > 4000) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    m.stop();
    const s = [...dts].sort((a, b) => a - b);
    const q = f => s[Math.min(s.length - 1, Math.floor(s.length * f))] || 0;
    const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    const el = dts.reduce((a, d) => a + d, 0);
    return { fps: 1000 * dts.length / el, p50: q(0.5), p95: q(0.95), dropped };
  }, lightsVisible);
  console.log(label.padEnd(16) + r.fps.toFixed(1).padStart(6) + ' fps  p50 ' +
    r.p50.toFixed(1).padStart(5) + '  p95 ' + r.p95.toFixed(1).padStart(6) + '  dropped ' + String(r.dropped).padStart(4));
  return r;
}

const on = [], off = [];
for (let i = 0; i < 3; i++) {
  on.push(await sweep(`lights ON  #${i + 1}`, true));
  off.push(await sweep(`lights OFF #${i + 1}`, false));
}
const min = a => a.reduce((x, y) => (y.dropped < x.dropped ? y : x));
const bestOn = min(on), bestOff = min(off);
console.log('\nminimum-dropped runs:  ON ' + bestOn.dropped + ' dropped @ ' + bestOn.fps.toFixed(1) +
  ' fps   OFF ' + bestOff.dropped + ' dropped @ ' + bestOff.fps.toFixed(1) + ' fps');
console.log('spread ON  [' + on.map(r => r.dropped).join(', ') + ']  OFF [' + off.map(r => r.dropped).join(', ') + ']');
console.log('If the spreads overlap there is no measurable cost.');
// Restore.
await page.evaluate(() => {
  const m = window.__map;
  for (const id of ['night-streetlight-pool', 'night-streetlight-core']) {
    if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible');
  }
});
await browser.close();
