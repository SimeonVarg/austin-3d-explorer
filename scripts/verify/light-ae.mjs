/**

 * light-ae.mjs — auto-exposure must move the right way, stay near 1.0 at the

 * looks the hours were authored for, and never pump.

 *

 * Prints the raw metered luma at each pose — that is where the AE.TARGET_*

 * constants in graphics.js come from (measured, not guessed).

 */

import { chromium } from 'playwright-core';

const browser = await launch(chromium);

const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });

const errs = [];

page.on('pageerror', e => errs.push(e.message));

const results = [];

const check = (n, pass, d) => results.push({ name: n, pass, detail: String(d) });

await page.goto(`${BASE}/_harness.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });

await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });

await page.waitForTimeout(4500);

await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

/**

 * Pose the camera, then drive updateSky (the renderFX host) for `ms` so the

 * EMA meter converges, and return the AE state plus gain trace.

 */

async function meter(p, pitch, bearing, ms = 3200) {
  return page.evaluate(async ({ p, pitch, bearing, ms }) => {
    const m = window.__map;
    Object.assign(window.GFX, { autoExposure: true });
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch, bearing });
    window.applyTimeOfDay(m, p, true);
    // Wait for a genuinely SETTLED frame: metering mid-repaint reads a partial
    // buffer (measured day luma 0.52-0.59 mid-repaint vs 0.80 settled).
    await new Promise(res => {
      let done = false;
      const onIdle = () => { if (!done) { done = true; m.off('idle', onIdle); res(); } };
      m.on('idle', onIdle);
      m.triggerRepaint();
      setTimeout(onIdle, 8000);
    });
    await new Promise(r => setTimeout(r, 600));
    window.__aeReset();                                // clean seed per pose
    const trace = [];
    const t0 = performance.now();
    await new Promise(res => {
      const step = () => {
        window.updateSky(m, p);                        // renderFX -> aeMeter
        trace.push(window.__ae().gain);
        if (performance.now() - t0 > ms) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const tail = trace.slice(Math.floor(trace.length * 0.6));   // settled part
    return {
      gain: window.__ae().gain, luma: window.__ae().luma,
      frames: trace.length,
      settleSpread: Math.max(...tail) - Math.min(...tail),
    };
  }, { p, pitch, bearing, ms });
}

const spawnDay = await meter(0.12, 64, 90);

const spawnGold = await meter(0.50, 66, 250);

const spawnNight = await meter(0.92, 70, 90);

console.log('day spawn   ', JSON.stringify(spawnDay));

console.log('golden spawn', JSON.stringify(spawnGold));

console.log('night spawn ', JSON.stringify(spawnNight));

check('day spawn pose: gain stays near 1.0', Math.abs(spawnDay.gain - 1) < 0.05,
  `gain ${spawnDay.gain.toFixed(3)}, raw luma ${spawnDay.luma.toFixed(3)}`);

check('golden spawn pose: gain stays near 1.0', Math.abs(spawnGold.gain - 1) < 0.05,
  `gain ${spawnGold.gain.toFixed(3)}, raw luma ${spawnGold.luma.toFixed(3)}`);

check('night spawn pose: gain stays near 1.0', Math.abs(spawnNight.gain - 1) < 0.05,
  `gain ${spawnNight.gain.toFixed(3)}, raw luma ${spawnNight.luma.toFixed(3)}`);

const nightSky = await meter(1.0, 85, 250);      // deep-night sky, moon behind

console.log('night sky   ', JSON.stringify(nightSky));

check('darker-than-typical frame: exposure lifts UP',
  nightSky.luma < spawnNight.luma - 0.02 && nightSky.gain > 1 + 0.05 && nightSky.gain <= 1.20 + 1e-6,
  `gain ${spawnNight.gain.toFixed(3)} (spawn) -> ${nightSky.gain.toFixed(3)} (sky), luma ${spawnNight.luma.toFixed(3)} -> ${nightSky.luma.toFixed(3)}`);

const bright = await page.evaluate(async () => {
  const m = window.__map;
  m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch: 30, bearing: 90 });
  window.applyTimeOfDay(m, 0.92, true);
  for (const l of m.getStyle().layers) {
    try {
      if (l.type === 'background') m.setPaintProperty(l.id, 'background-color', '#ffffff');
      else if (l.type === 'fill') m.setPaintProperty(l.id, 'fill-color', '#ffffff');
      else if (l.type === 'line') m.setPaintProperty(l.id, 'line-color', '#ffffff');
    } catch (e) {}
  }
  await new Promise(res => {
    let done = false;
    const onIdle = () => { if (!done) { done = true; m.off('idle', onIdle); res(); } };
    m.on('idle', onIdle);
    m.triggerRepaint();
    setTimeout(onIdle, 8000);
  });
  await new Promise(r => setTimeout(r, 400));
  window.__aeReset();
  window.updateSky(m, 0.92);
  const r = window.__ae();
  window.applyTimeOfDay(m, 0.92, true);            // force-path restores the paints
  return r;
});

import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

console.log('white ground', JSON.stringify(bright));

check('brighter-than-typical frame: exposure pulls DOWN (whitened ground, real pixels)',
  bright.luma > spawnNight.luma + 0.1 && bright.gain <= 0.9 && bright.gain >= 0.85 - 1e-6,
  `luma ${bright.luma.toFixed(3)}, gain ${bright.gain.toFixed(3)}`);

// ── No pumping at a fixed pose ───────────────────────────────────────

// Only meaningful where swiftshader managed >= 5 frames; the headed perf run

// exercises the real 60 fps path.

const traces = [spawnDay, spawnGold, spawnNight, nightSky];

const judged = traces.filter(r => r.frames >= 5);

check('no pumping: settled gain spread < 0.02 wherever measurable',
  judged.length >= 1 && judged.every(r => r.settleSpread < 0.02),
  traces.map(r => `${r.frames}f/${r.settleSpread.toFixed(4)}`).join(' ') + ` (${judged.length} judged)`);

// ── Off switch really is off ─────────────────────────────────────────

const off = await page.evaluate(async () => {
  Object.assign(window.GFX, { autoExposure: false });
  window.updateSky(window.__map, 0.12);
  await new Promise(r => setTimeout(r, 100));
  window.updateSky(window.__map, 0.12);
  return window.__ae();
});

check('autoExposure=false resets the gain to exactly 1', off.gain === 1, JSON.stringify(off));

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');

for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);

console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);

await browser.__done();

process.exit(results.every(r => r.pass) ? 0 : 1);
