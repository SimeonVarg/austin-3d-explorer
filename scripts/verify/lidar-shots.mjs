/**
 * lidar-shots.mjs - labelled before/after frames of the roof-height knob, from
 * the SAME camera, on a real GPU, in ONE browser.
 *
 * Usage (always through the one-browser gate):
 *   VERIFY_GL=hardware node <gpu-run.mjs> --label lidar -- \
 *     node lidar-shots.mjs <outDir> <shots.json> [--legs "off=,on=lidarheights=1"]
 *
 *   shots.json: [{name, center:[lng,lat], zoom, pitch, bearing, p, probe:[lng,lat], probeId}]
 *     `probe` is a point inside the building the shot is about and `probeId` its
 *     footprint id: the script asks the renderer which `buildings-3d` prism it
 *     draws for that id and what height it has, so the frame carries proof that
 *     the knob (not the basemap, not a default) is what changed. Written to
 *     <outDir>/proof.json.
 *
 * Why this is not shot.mjs. Every earlier run of the knob's pictures timed out at
 * 30 s. Causes found, each one fixed here rather than retried blind:
 *   1. SwiftShader is chrome.mjs's default (3.7 fps); a screenshot of a heavy
 *      frame outlives the 30 s limit. This asks for the real GPU (VERIFY_GL) and
 *      refuses to run on software unless VERIFY_ALLOW_SOFTWARE=1.
 *   2. The loading veil was still up (the authored apartments build under it).
 *      This waits for the veil to be GONE and the authored group ready.
 *   3. The knob's data file (data/lidar_heights.json) lands after the page; a
 *      frame taken before it is a "before". The `on` leg waits for
 *      LIDAR_HEIGHTS.changed and fails loudly if it is 0.
 *   4. No retry. A failed capture is retried with the cause logged (frame time,
 *      veil, tiles pending), not silently.
 * Scratch frames belong in a scratchpad folder, not the repo (CLAUDE.md 12).
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'lidar-shots');
const SHOTS = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const li = process.argv.indexOf('--legs');
const LEGS = (li > 0 ? process.argv[li + 1] : 'off=,on=lidarheights=1').split(',').map(s => {
  const i = s.indexOf('=');
  return { name: s.slice(0, i), q: s.slice(i + 1) };
});
fs.mkdirSync(OUT, { recursive: true });

if ((process.env.VERIFY_GL || '') !== 'hardware' && process.env.VERIFY_ALLOW_SOFTWARE !== '1') {
  console.error('refusing to shoot on SwiftShader: set VERIFY_GL=hardware (or VERIFY_ALLOW_SOFTWARE=1 to accept the 30 s timeouts)');
  process.exit(2);
}

const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + ' s', ...a);
const browser = await launch(chromium, { maxMs: 1500000 });
const proof = { gl: process.env.VERIFY_GL, viewport: [1440, 900], dpr: 1, legs: {} };

async function frameMs(page) {
  return page.evaluate(() => new Promise(r => {
    let n = 0; const t = performance.now();
    const f = () => { if (++n === 12) r(+((performance.now() - t) / 12).toFixed(1)); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
    setTimeout(() => r(-1), 10000);
  }));
}
async function diag(page) {
  return page.evaluate(() => ({
    veil: !!document.getElementById('veil'),
    loaded: window.__map.loaded(), tiles: window.__map.areTilesLoaded(),
    lidar: window.LIDAR_HEIGHTS ? { on: window.LIDAR_HEIGHTS.on, changed: window.LIDAR_HEIGHTS.changed ?? null } : null,
    renderer: (() => { try { const g = document.createElement('canvas').getContext('webgl'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch (e) { return '?'; } })(),
  }));
}
async function snap(page, file) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await page.screenshot({ path: file, timeout: 120000 }); return attempt; }
    catch (e) {
      log('SCREENSHOT FAILED (attempt ' + attempt + '):', e.message.split('\n')[0],
        '| ms/frame', await frameMs(page).catch(() => 'n/a'), '|', JSON.stringify(await diag(page).catch(() => null)));
      await page.waitForTimeout(4000);
    }
  }
  throw new Error('screenshot failed 3 times: ' + file);
}

for (const leg of LEGS) {
  log('LEG', leg.name, JSON.stringify(leg.q));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(SERVER + '/_harness.html?intro=0&drift=0' + (leg.q ? '&' + leg.q : ''), { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const m = window.__map;
    if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roofscape', 'austin-tower',
            'austin-westcampus', 'austin-drag', 'austin-arts', 'austin-moody', 'austin-stadium']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 180000 }).catch(() => log('WARN: sources not all loaded'));
  await page.waitForFunction(() => {
    const a = window.slopesApartments;
    return !a || (a.group && a.count && a.count.ms > 0 && a.readyToReveal());
  }, null, { timeout: 300000, polling: 500 }).catch(() => log('WARN: authored apartments not ready'));
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 180000, polling: 500 })
    .catch(() => log('WARN: veil still up'));
  const intro = await page.evaluate(() => window.__intro ? { reason: window.__intro.reason, waitedMs: window.__intro.waitedMs } : null);
  log('veil gone', JSON.stringify(intro));
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  const lidar = await page.evaluate(() => window.LIDAR_HEIGHTS ? { on: window.LIDAR_HEIGHTS.on, changed: window.LIDAR_HEIGHTS.changed ?? null } : null);
  log('knob', JSON.stringify(lidar));
  if (/lidarheights=1/.test(leg.q) && !(lidar && lidar.changed > 0)) throw new Error('the `on` leg loaded but the knob changed nothing: ' + JSON.stringify(lidar));
  const gl = await diag(page);
  log('renderer', gl.renderer);
  if (/swiftshader|software/i.test(gl.renderer) && process.env.VERIFY_ALLOW_SOFTWARE !== '1') throw new Error('page is on a software renderer: ' + gl.renderer);
  proof.renderer = gl.renderer;
  await page.waitForTimeout(3000);
  proof.legs[leg.name] = { query: leg.q, intro, lidar, shots: {} };

  for (const s of SHOTS) {
    await page.evaluate((s) => {
      const m = window.__map;
      if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: s.center, zoom: s.zoom ?? 17, pitch: s.pitch ?? 62, bearing: s.bearing ?? 0 });
      if (typeof s.p === 'number') {
        const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
        window.applyTimeOfDay(m, s.p);
      }
    }, s);
    await page.waitForTimeout(4000);
    await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 20000); }));
    if (await page.evaluate(() => !!(window.CityLighting && window.CityLighting.stats && window.CityLighting.stats.shadowProxyBuilding))) {
      await page.waitForFunction(() => !(window.CityLighting.stats.shadowProxyBuilding), null, { timeout: 90000, polling: 200 }).catch(() => {});
    }
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(1500);
    const file = path.join(OUT, `${leg.name}-${s.name}.png`);
    await snap(page, file);              // first frame: thrown away
    await page.waitForTimeout(800);
    const tries = await snap(page, file); // second frame: kept
    const info = await page.evaluate((s) => {
      const m = window.__map;
      const out = { cam: { center: m.getCenter().toArray().map(v => +v.toFixed(5)), zoom: +m.getZoom().toFixed(2), pitch: +m.getPitch().toFixed(1), bearing: +m.getBearing().toFixed(1) } };
      if (s.probe) {
        // Ask the renderer which prism it draws for THIS building. A box rather
        // than a point: from a pitched camera the ground point under the
        // centroid is behind the front wall, and a neighbour may stand in front.
        const pt = m.project(s.probe);
        out.probePx = [Math.round(pt.x), Math.round(pt.y)];
        const R = 120;
        const hits = [];
        try {
          const feats = m.queryRenderedFeatures([[pt.x - R, pt.y - R * 1.5], [pt.x + R, pt.y + R]], { layers: ['buildings-3d'].filter(id => m.getLayer(id)) });
          const seen = new Set();
          for (const f of feats) {
            const p = f.properties;
            if (s.probeId && p.id !== s.probeId) continue;
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            hits.push({ id: p.id, name: p.name || null, final_height: p.final_height ?? null, prior: p.final_height_prior ?? null, src: p.source_height ?? null });
          }
        } catch (e) { hits.push({ error: String(e) }); }
        out.hits = hits;
      }
      return out;
    }, s);
    proof.legs[leg.name].shots[s.name] = { ...info, screenshotAttempts: tries, msPerFrame: await frameMs(page) };
    log('WROTE', file, JSON.stringify(info.hits || ''), 'ms/frame', proof.legs[leg.name].shots[s.name].msPerFrame);
  }
  if (errors.length) { proof.legs[leg.name].errors = errors.slice(0, 10); log('ERRORS', errors.slice(0, 5)); }
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 1));
log('wrote proof.json');
await browser.__done();
