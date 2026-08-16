// night-workstream copy of sky.mjs - identical assertions, but honours VERIFY_URL
// (the original hardcodes :8099, which is a DIFFERENT checkout when worktrees run in parallel)
/**
 * verify-sky.mjs â€” assert the sky is COHERENT, not just pretty.
 * The central claim is "one sun": the ground shadows, MapLibre's light and the
 * visible disc must all agree. That is measurable, so measure it.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch } from './chrome.mjs';
const EXE = chromePath();
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: d });

// â”€â”€ 1. Shadows point away from the sun, at every hour â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const rows = await page.evaluate(async () => {
    const m = window.__map;
    const out = [];
    for (const p of [0.0, 0.15, 0.3, 0.45, 0.5]) {
      window.applyTimeOfDay(m, p);
      // updateShadows debounces ~140 ms, then setData, and THEN the GeoJSON
      // source re-tiles in a worker. Reading too early returns the previous
      // hour's shadows â€” which is what made this test claim a 43 deg error.
      await new Promise(r => setTimeout(r, 400));
      await new Promise(res => {
        let done = false;
        const onIdle = () => { if (!done) { done = true; m.off('idle', onIdle); res(); } };
        m.on('idle', onIdle);
        setTimeout(onIdle, 6000);
      });
      await new Promise(r => setTimeout(r, 300));
      const sun = window.skyBodies(p).sun;
      let feats = [];
      try { feats = m.querySourceFeatures('austin-shadows'); } catch (e) {}
      if (!feats.length) { out.push({ p, sunAz: sun.az, sunElev: sun.elev, n: 0 }); continue; }
      const data = { features: feats };
      // A shadow hull is the footprint swept away from the sun. Its centroid is
      // therefore offset from the footprint centroid in the anti-solar direction.
      // Compare the hull centroid against the hull's own most-sunward vertex.
      let sx = 0, sy = 0, n = 0, area = 0;
      for (const f of data.features.slice(0, 400)) {
        const ring = f.geometry.coordinates[0];
        let cx = 0, cy = 0;
        for (const q of ring) { cx += q[0]; cy += q[1]; }
        cx /= ring.length; cy /= ring.length;
        // sunward-most vertex = the one furthest toward the sun azimuth
        const ax = Math.sin(sun.az * Math.PI / 180), ay = Math.cos(sun.az * Math.PI / 180);
        let best = -1e9, bx = 0, by = 0;
        for (const q of ring) {
          const d = (q[0] - cx) * ax * Math.cos(cy * Math.PI / 180) + (q[1] - cy) * ay;
          if (d > best) { best = d; bx = q[0]; by = q[1]; }
        }
        // vector from the sunward edge toward the hull centroid == anti-solar
        sx += (cx - bx) * Math.cos(cy * Math.PI / 180);
        sy += (cy - by);
        // shoelace area, in square metres
        let A = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          A += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]);
        }
        area += Math.abs(A / 2) * 111320 * 111320 * Math.cos(cy * Math.PI / 180);
        n++;
      }
      const shadowAz = ((Math.atan2(sx, sy) * 180 / Math.PI) + 360) % 360;
      out.push({ p, sunAz: sun.az, sunElev: sun.elev, shadowAz, n, meanArea: area / Math.max(1, n) });
    }
    return out;
  });
  // The direction estimator reads the sweep out of each convex hull, so it only
  // works when the sweep is longer than the footprint is wide. reach =
  // 1/tan(elevation); below reach ~1.0 (sun above 45 deg) the hull is dominated
  // by the building's own shape and the estimate is meaningless. Assert the
  // direction where it is measurable, and assert SHORTENING where it is not.
  for (const r of rows) {
    if (!r.n) { check(`shadows absent only when the sun is down (p=${r.p})`, r.sunElev <= 0,
      `no shadow features but sun elev is ${r.sunElev}`); continue; }
    const reach = 1 / Math.tan(r.sunElev * Math.PI / 180);
    if (reach < 1.0) continue;                 // covered by the shortening assertion below
    const expected = (r.sunAz + 180) % 360;
    const err = Math.abs(((r.shadowAz - expected + 540) % 360) - 180);
    check(`shadows point away from the sun at p=${r.p} (sun ${r.sunElev.toFixed(0)}Â° up)`,
      err < 20, `sun az ${r.sunAz.toFixed(0)}Â° â†’ shadows ${r.shadowAz.toFixed(0)}Â°, expected ~${expected.toFixed(0)}Â° (off ${err.toFixed(0)}Â°)`);
  }
  // Physically: the lower the sun, the longer the shadows â€” but shadows.js caps
  // reach at MAX_LENGTH = 2.4 building heights on purpose, so that at any
  // elevation below ~22.6 deg the length stops growing. Encode the cap, or the
  // assertion fails on correct behaviour (21 deg and 6 deg are both capped and
  // measured within 4%, which is tile-sampling noise).
  const MAX_REACH = 2.4;
  const eff = e => Math.min(MAX_REACH, 1 / Math.tan(e * Math.PI / 180));
  const bySun = rows.filter(r => r.n).sort((a, b) => b.sunElev - a.sunElev);   // highest sun first
  let ok = true;
  const detail = bySun.map(r => `${r.sunElev.toFixed(0)}Â°(reach ${eff(r.sunElev).toFixed(2)})â†’${Math.round(r.meanArea)}mÂ²`);
  for (let i = 1; i < bySun.length; i++) {
    const a = bySun[i - 1], c = bySun[i];
    if (eff(c.sunElev) > eff(a.sunElev) * 1.02) {
      if (c.meanArea < a.meanArea * 0.98) ok = false;        // reach grew, area must too
    } else if (Math.abs(c.meanArea / a.meanArea - 1) > 0.12) {
      ok = false;                                            // reach capped, area must match
    }
  }
  check('shadow size tracks the sun elevation, respecting the 2.4x reach cap', ok, detail.join('  '));
}

// â”€â”€ 2. MapLibre's light agrees with the same sun â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const rows = await page.evaluate(async () => {
    const m = window.__map, out = [];
    for (const p of [0.0, 0.25, 0.5, 0.8]) {
      window.applyTimeOfDay(m, p);
      await new Promise(r => setTimeout(r, 200));
      const L = m.getLight();
      const sun = window.skyBodies(p).sun;
      out.push({ p, lightAz: L.position[1], lightPolar: L.position[2], sunAz: sun.az, sunElev: sun.elev });
    }
    return out;
  });
  let worstAz = 0, worstEl = 0;
  for (const r of rows) {
    worstAz = Math.max(worstAz, Math.abs(((r.lightAz - r.sunAz + 540) % 360) - 180));
    worstEl = Math.max(worstEl, Math.abs((90 - r.lightPolar) - r.sunElev));
  }
  check('setLight azimuth equals the shared sun azimuth', worstAz < 0.5, `worst mismatch ${worstAz.toFixed(2)}Â°`);
  check('setLight polar equals 90 minus the sun elevation', worstEl < 0.5, `worst mismatch ${worstEl.toFixed(2)}Â°`);
}

// â”€â”€ 3. The disc projects where the geometry says it should â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const r = await page.evaluate(async () => {
    const m = window.__map;
    window.applyTimeOfDay(m, 0.5);
    const sun = window.skyBodies(0.5).sun;
    // Aim at the sun's azimuth and pitch as far up as the map allows. maxPitch is
    // 85, so the sun will sit ABOVE the view axis, not on it â€” which is exactly
    // what makes this a real test of the projection rather than a tautology.
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, bearing: sun.az, pitch: 85 });
    await new Promise(r => setTimeout(r, 900));
    const core = document.getElementById('sky-core');
    const cv = m.getCanvas();
    const mm = getComputedStyle(core).transform.match(/matrix\(([^)]+)\)/);
    const parts = mm ? mm[1].split(',').map(Number) : null;
    const w = parseFloat(core.style.width);
    const H = cv.clientHeight, W = cv.clientWidth;
    const fov = m.getVerticalFieldOfView();
    const axisElev = m.getPitch() - 90;              // view axis, degrees above horizontal
    // Independent expectation: tan-space offset from centre.
    const tv = Math.tan(fov * Math.PI / 360);
    const rel = Math.tan((sun.elev - axisElev) * Math.PI / 180);
    const expectedY = H / 2 - 0.5 * (rel / tv) * H;
    return {
      sun, opacity: +getComputedStyle(core).opacity,
      cx: parts ? parts[4] + w / 2 : null, cy: parts ? parts[5] + w / 2 : null,
      expectedY, expectedX: W / 2, W, H, pitch: m.getPitch(), axisElev, fov,
    };
  });
  const dx = r.cx == null ? 1e9 : Math.abs(r.cx - r.expectedX);
  const dy = r.cy == null ? 1e9 : Math.abs(r.cy - r.expectedY);
  check('sun disc lands where the camera geometry predicts',
    dx < 6 && dy < 8,
    `disc at (${r.cx?.toFixed(0)}, ${r.cy?.toFixed(0)}), predicted (${r.expectedX.toFixed(0)}, ${r.expectedY.toFixed(0)}) ` +
    `for sun elev ${r.sun.elev}Â° vs view axis ${r.axisElev}Â°`);
  check('sun disc is visible when in front of the camera',
    r.opacity > 0.2, `opacity ${r.opacity}`);
}

// â”€â”€ 4. Behind the camera the disc must be hidden â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const o = await page.evaluate(async () => {
    const m = window.__map;
    const sun = window.skyBodies(0.5).sun;
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, bearing: (sun.az + 180) % 360, pitch: 70 });
    await new Promise(r => setTimeout(r, 900));
    return { core: +getComputedStyle(document.getElementById('sky-core')).opacity,
             bloom: +getComputedStyle(document.getElementById('sky-bloom')).opacity };
  });
  check('sun disc hidden when it is behind the camera', o.core < 0.01 && o.bloom < 0.01,
    `core ${o.core}, bloom ${o.bloom}`);
}

// â”€â”€ 5. The sun must be gone once it sets, and the moon must show â”€â”€â”€
{
  const o = await page.evaluate(async () => {
    const m = window.__map;
    window.applyTimeOfDay(m, 1.0);
    const moon = window.skyBodies(1.0).moon;
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, bearing: moon.az, pitch: 90 + moon.elev });
    await new Promise(r => setTimeout(r, 900));
    return { sunUp: window.skyBodies(1.0).sunUp,
             core: +getComputedStyle(document.getElementById('sky-core')).opacity,
             night: window.skyBodies(1.0).night };
  });
  check('after sunset the sun is down and the moon is what is lit',
    o.sunUp === false && o.core > 0.2, `sunUp=${o.sunUp}, disc opacity ${o.core}, night=${o.night.toFixed(2)}`);
}

// â”€â”€ 6. Nothing in the sky may hide a building â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const o = await page.evaluate(() => {
    const ids = ['sky-canvas', 'sky-glow', 'sky-bloom', 'sky-core'];
    return ids.map(id => {
      const el = document.getElementById(id);
      return { id, blend: el ? getComputedStyle(el).mixBlendMode : 'MISSING',
               pe: el ? getComputedStyle(el).pointerEvents : 'MISSING' };
    });
  });
  const allScreen = o.every(x => x.blend === 'screen');
  const noPointer = o.every(x => x.pe === 'none');
  check('every sky element blends with screen (can only add light)', allScreen,
    o.map(x => `${x.id}=${x.blend}`).join(', '));
  check('no sky element intercepts pointer events', noPointer,
    o.map(x => `${x.id}=${x.pe}`).join(', '));
}

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);

// EXIT CODE, added 2026-08-16 (§154). This file printed *FAIL and exited 0 for
// its whole life. §149 deleted silhouette.mjs partly for exactly that and added
// no lint to stop the next one; suite-lint rule 7 does now. Every wrapper in
// this repo reads the exit code — inventory.mjs classifies on it and §142 made
// exit codes load-bearing — so a red printed only to scrollback is a red that
// nothing downstream can see.
const _failed = results.filter(r => !r.pass);
if (_failed.length) console.log('\n*FAIL — ' + _failed.length + ' of ' + results.length + ' failed: ' + _failed.map(r => r.name).join('; '));
process.exitCode = _failed.length ? 1 : 0;
await browser.__done();
