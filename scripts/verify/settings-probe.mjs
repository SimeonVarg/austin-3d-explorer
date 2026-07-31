/**
 * settings-probe.mjs — does applyGroundSettings actually apply the settings?
 *
 * The perf A/B echoes the layer state next to every result, on the rule that a
 * configuration you did not verify is a configuration that may not have been
 * set. That echo reported `road=none` in the run that had just turned the roads
 * ON, which is either a bug in the toggle or a bug in the echo — and the two
 * have opposite consequences, so this drives the toggle directly.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text()); });

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const STEPS = [
  { label: 'as shipped',            roads: true,  texture: true  },
  { label: 'roads OFF',             roads: false, texture: true  },
  { label: 'roads back ON',         roads: true,  texture: true  },
  { label: 'texture OFF',           roads: true,  texture: false },
  { label: 'texture back ON',       roads: true,  texture: true  },
  { label: 'both OFF (the A of A/B)', roads: false, texture: false },
  { label: 'both back ON',          roads: true,  texture: true  },
];

const IDS = ['ground-road', 'ground-road-casing', 'ground-road-lane',
             'ground-texture', 'ground-base-texture', 'ground-areas'];

// Ground only, post off, a pose with plenty of road in it. The style flags are
// reported for diagnosis but the VERDICT column is pixels: a setting that was
// written and did not change the frame did not happen.
await page.evaluate(() => {
  const m = window.__map;
  Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
  window.applyGraphics();
  for (const l of m.getStyle().layers) {
    const keep = l.id.startsWith('ground-') || l.type === 'background' ||
                 /^sky|atmos|haze/.test(l.id) ||
                 ((l['source-layer'] || '') === 'transportation' && l.type === 'line');
    try { if (!keep) m.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
  }
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo({ center: [-97.7418, 30.2855], zoom: 16.3, pitch: 70, bearing: 8 });
  window.applyTimeOfDay(m, 0.14, true);
});
await page.waitForTimeout(3000);

console.log('step                      ' + IDS.map(i => i.replace('ground-', '').padEnd(9)).join('') +
            ' | darkPx%  paleRoadPx%');
for (const s of STEPS) {
  const threw = await page.evaluate((s) => {
    window.GROUND.roads = s.roads;
    window.GROUND.texture = s.texture;
    try { window.applyGroundSettings(window.__map); } catch (e) { return e.message; }
    window.__map.triggerRepaint();
    return null;
  }, s);
  // A style change does not land in the frame it was written in. Settle, then
  // read — reading in the same turn is what made this table lag by one step.
  await page.waitForTimeout(1500);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 10000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(700);

  const out = await page.evaluate((IDS) => {
    const m = window.__map;
    const vis = id => {
      const l = m.getLayer(id);
      if (!l) return 'ABSENT';
      const v = m.getLayoutProperty(id, 'visibility');
      return v === undefined ? 'visible' : v;
    };
    const cv = m.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const n = cv.width * cv.height;
    const buf = new Uint8Array(n * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let dark = 0, pale = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = buf[j], g = buf[j+1], b = buf[j+2];
      // our asphalt: dark, near-neutral, slightly blue
      if (r > 55 && r < 130 && Math.abs(r - g) < 22 && b >= r - 6 && b < 150) dark++;
      // the basemap's road cream: bright and warm
      if (r > 195 && g > 185 && b > 155 && r - b > 18 && r - b < 60) pale++;
    }
    return { state: IDS.map(vis), darkPct: +(100 * dark / n).toFixed(2),
             palePct: +(100 * pale / n).toFixed(2) };
  }, IDS);
  console.log(s.label.padEnd(26) + out.state.map(v => v.padEnd(9)).join('') +
              ' | ' + String(out.darkPct).padStart(6) + '  ' + String(out.palePct).padStart(10) +
              (threw ? '   THREW: ' + threw : ''));
}
console.log('\ndarkPx%      our asphalt on screen — must track the roads flag');
console.log('paleRoadPx%  the basemap cream — must go UP when we hand the roads back');
await browser.close();
