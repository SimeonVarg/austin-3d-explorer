/**
 * night-perf.mjs — do the streetlight layers cost frames at night?
 *
 * perf2.mjs pattern: HEADED (swiftshader timing is fiction), big viewport,
 * dropped-frame counts, interleaved a/b/a/b runs, judge by the MINIMUM.
 * Content is a scripted fixed bearing sweep so every run renders the same
 * buildings (holding W was a bigger noise source than any setting).
 *
 * The only per-frame delta the night workstream adds is the two circle layers
 * (pool + core); the facade atlas is the same tile count and size as before, so
 * its repaint cost is unchanged by construction — the July 31 night pass moved
 * PIXEL VALUES inside the existing tiles (occupancy, pane brightness, tone
 * bias) and added no image, no tile and no draw call.
 *
 * The lamp count went from 1,027 to ~3,350 in that pass (a third tier for the
 * campus service roads and walks, plus tighter spacing). This A/B is ON vs OFF
 * at the NEW count, which is the conservative form of the question: if the
 * whole layer at 3,350 features is free, the 1,027 -> 3,350 delta inside it is
 * free too.
 *
 * Two things this did not have and the README says it must (see "Two traps
 * this suite added to the list"):
 *   - Chrome throttles rAF in a window it thinks is occluded, which produced a
 *     p10 of exactly 50.00 ms against 49.90 ms in another suite — 20 Hz,
 *     quantised, identical for both configurations, i.e. the window manager
 *     rather than the scene. The launch flags and bringToFront() below are the
 *     fix outer-perf.mjs already carries.
 *   - Interleaving alone is not enough: the machine drifts warmer across a run,
 *     so whichever configuration always goes first wins by construction. The
 *     order is counterbalanced on alternate reps.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium, { executablePath: chromePath(), headless: false, args: [
  '--no-sandbox',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1400 } });
await page.bringToFront();
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(6000);
await page.evaluate(async () => {
  window.applyTimeOfDay(window.__map, 0.95, true);
  await new Promise(res => window.__map.once('idle', res));
});

// Snapshot the generated lamps so a run can be replayed at any density.
await page.evaluate(() => {
  const src = window.__map.getSource('night-streetlights');
  const fc = [src._data, src.serialize && src.serialize().data]
    .find(d => d && typeof d !== 'string' && d.features && d.features.length);
  window.__lampsFull = fc;
});

/**
 * `keep` is the fraction of lamps to render (1 = the new build, ~0.305 = the
 * 1,027 lamps the pre-July-31 build generated, 0 = the layer switched off).
 *
 * ON-vs-OFF answers "does this layer cost anything", which is the wrong
 * question when the layer already existed: what shipped is a DENSITY change
 * inside it. Subsampling the same generated points keeps the layer, the paint
 * expressions, the source and the draw calls identical between configurations
 * and varies only the feature count — so whatever the difference is, it is the
 * thing that actually changed.
 */
async function sweep(label, keep) {
  const r = await page.evaluate(async (keep) => {
    const m = window.__map;
    const vis = keep > 0;
    for (const id of ['night-streetlight-pool', 'night-streetlight-core']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none');
    }
    if (vis) {
      const all = window.__lampsFull.features;
      const step = 1 / keep;
      const feats = keep >= 1 ? all : all.filter((f, i) => Math.floor(i % step) === 0);
      m.getSource('night-streetlights').setData({ type: 'FeatureCollection', features: feats });
      await new Promise(res => { m.once('idle', res); setTimeout(res, 4000); });
      window.__lampsRendered = feats.length;
    } else {
      // Echo what was ACTUALLY set, not what was set last time. Leaving this
      // stale printed "off #2 ... 3370 lamps" — the same class of misleading
      // config echo the README calls out ("printed a config echo claiming the
      // roads layer was hidden in the configuration that had just switched it
      // on"). A perf table nobody can trust is worse than no perf table.
      window.__lampsRendered = 0;
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
    return { fps: 1000 * dts.length / el, p50: q(0.5), p95: q(0.95), dropped, lamps: window.__lampsRendered || 0 };
  }, keep);
  console.log(label.padEnd(22) + String(r.lamps).padStart(5) + ' lamps ' + r.fps.toFixed(1).padStart(6) + ' fps  p50 ' +
    r.p50.toFixed(1).padStart(6) + '  p95 ' + r.p95.toFixed(1).padStart(6) + '  dropped ' + String(r.dropped).padStart(4));
  return r;
}

console.log('lamps generated:', JSON.stringify(await page.evaluate(() => window.__nightLights)));
console.log('');

// Three configurations, rotated so none of them always gets the coolest slot.
const CONFIGS = [
  { name: 'off',      keep: 0 },
  { name: 'old 1027', keep: 1027 / (await page.evaluate(() => window.__lampsFull.features.length)) },
  { name: 'new full', keep: 1 },
];
const REPS = Number(process.argv[2] || 5);
const runs = { off: [], 'old 1027': [], 'new full': [] };
for (let i = 0; i < REPS; i++) {
  for (let k = 0; k < CONFIGS.length; k++) {
    const c = CONFIGS[(i + k) % CONFIGS.length];         // rotate the order
    runs[c.name].push(await sweep(`${c.name} #${i + 1}`, c.keep));
  }
}
console.log('');
console.log('MINIMUM dropped frames per configuration (the mean measures the machine, not the scene):');
const mins = {};
for (const c of CONFIGS) {
  const rs = runs[c.name];
  const best = rs.reduce((x, y) => (y.dropped < x.dropped ? y : x));
  mins[c.name] = best.dropped;
  console.log(`   ${c.name.padEnd(10)} min ${String(best.dropped).padStart(4)} dropped @ ${best.fps.toFixed(1)} fps` +
              `   spread [${rs.map(r => r.dropped).join(', ')}]`);
}
console.log('');
console.log(`   old -> new costs ${mins['new full'] - mins['old 1027']} dropped frames on the minimum ` +
            `(layer off -> old costs ${mins['old 1027'] - mins.off}).`);
console.log('   If the spreads overlap there is no measurable cost.');

// Restore.
await page.evaluate(() => {
  const m = window.__map;
  for (const id of ['night-streetlight-pool', 'night-streetlight-core']) {
    if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible');
  }
});
await browser.__done();
