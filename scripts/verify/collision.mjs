/**

 * verify-collision.mjs — the guarantees that matter for the actual use case:

 * never end up inside a building, and still be able to fly down a West Campus

 * street at sign-reading height without being lifted over the rooftops.

 * Also covers the headline mobile fix: joystick and look at the same time.

 */

import { chromium } from 'playwright-core';

// BASE honours VERIFY_URL so parallel worktrees can each test their own serve

// (chrome.mjs has exported it for this purpose all along). No assertion change.

import { chromePath, BASE, launch } from './chrome.mjs';

const EXE = chromePath();

const browser = await launch(chromium);

const page = await browser.newPage({ viewport: { width: 800, height: 560 }, hasTouch: true });

const errs = [];

page.on('pageerror', e => errs.push(e.message));

await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });

await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });

await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 30000 });

await page.waitForTimeout(3000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const results = [];

const check = (name, pass, detail) => results.push({ name, pass, detail });

await page.evaluate(() => {
  window.__settle = async () => {
    for (let i = 0; i < 240; i++) {
      if (!window.__fly.eye().driving) return true;
      await new Promise(r => requestAnimationFrame(r));
    }
    return false;
  };
  window.__place = async (lng, lat, alt, bearing, pitch) => {
    const m = window.__map;
    const C = 40030228.884, M_LAT = C / 360;
    const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(58 * Math.PI / 360);
    await window.__settle();
    const D = alt / Math.cos(pitch * Math.PI / 180);
    const lead = alt * Math.tan(pitch * Math.PI / 180);
    const cLat = lat + lead * Math.cos(bearing * Math.PI / 180) / M_LAT;
    const cLng = lng + lead * Math.sin(bearing * Math.PI / 180) / (M_LAT * Math.cos(lat * Math.PI / 180));
    const z = Math.log2(C * Math.cos(cLat * Math.PI / 180) * camPx / (512 * D));
    m.jumpTo({ center: [cLng, cLat], zoom: z, bearing, pitch });
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    return window.__fly.eye();
  };
});

console.log('grid bytes:', await page.evaluate(() => window.__fly.gridBytes()));

console.log('roofAt spawn r=400:', await page.evaluate(() => window.__fly.roofAt(-97.7434, 30.2857, 400).toFixed(1)),
            '(snapshot max is 97.5)');

// ── 1. NEVER INSIDE. Fly many randomised low-altitude segments and sample the

//      clearance on every single frame.

{
  const worst = await page.evaluate(async () => {
    const m = window.__map, F = window.__fly;
    const set = (lng, lat, alt, bearing) => {
      const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(58 * Math.PI / 360);
      const C = 40030228.884, M_LAT = C / 360;
      const pitch = 70, D = alt / Math.cos(pitch * Math.PI / 180);
      const lead = alt * Math.tan(pitch * Math.PI / 180);
      const cLat = lat + lead * Math.cos(bearing * Math.PI / 180) / M_LAT;
      const cLng = lng + lead * Math.sin(bearing * Math.PI / 180) / (M_LAT * Math.cos(lat * Math.PI / 180));
      const z = Math.log2(C * Math.cos(cLat * Math.PI / 180) * camPx / (512 * D));
      m.jumpTo({ center: [cLng, cLat], zoom: z, bearing, pitch });
    };
    let worst = { margin: 1e9 }, frames = 0;
    // deterministic pseudo-random so the run is reproducible
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let seg = 0; seg < 24; seg++) {
      const lng = -97.7500 + rnd() * 0.020, lat = 30.2790 + rnd() * 0.0150;
      const alt = 18 + rnd() * 60, bearing = rnd() * 360;
      set(lng, lat, alt, bearing);
      await new Promise(r => requestAnimationFrame(r));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
      for (let i = 0; i < 22; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const e = F.eye();
        const roof = F.roofAt(e.lng, e.lat, 6);
        frames++;
        if (roof > 0) {
          const margin = e.alt - roof;
          if (margin < worst.margin) worst = { margin, roof, alt: e.alt, lng: e.lng, lat: e.lat };
        }
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
      await new Promise(r => requestAnimationFrame(r));
    }
    return { ...worst, frames };
  });
  check('camera is never inside a building (alt >= roof + 4 m, every frame)',
    worst.margin >= 3.99,
    `worst clearance ${worst.margin === 1e9 ? 'n/a' : worst.margin.toFixed(2) + ' m'} over ${worst.frames} sampled frames`);
}

// ── 2. STREETS STAY FLYABLE. The whole point of the small 6 m probe: flying a

//      street at sign height must not lift you over the flanking rooftops.

{
  const r = await page.evaluate(async () => {
    const m = window.__map, F = window.__fly;
    const C = 40030228.884, M_LAT = C / 360;
    const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(58 * Math.PI / 360);
    const mLon = lat => M_LAT * Math.cos(lat * Math.PI / 180);

    // Find a genuine street cell: nothing under the camera, but tall buildings
    // within ~35 m on either side. Guessing a coordinate is how the first
    // version of this test ended up starting on top of a building.
    let site = null;
    for (let a = 0; a < 140 && !site; a++) {
      for (let b = 0; b < 140 && !site; b++) {
        const lng = -97.7510 + a * (0.0240 / 140), lat = 30.2800 + b * (0.0120 / 140);
        if (F.roofAt(lng, lat, 8) !== 0) continue;
        // clear for 120 m due north (so W with bearing 0 runs down the street)
        let clear = true;
        for (let d = 10; d <= 120; d += 10) if (F.roofAt(lng, lat + d / M_LAT, 7) !== 0) { clear = false; break; }
        if (!clear) continue;
        const flankL = F.roofAt(lng - 30 / mLon(lat), lat, 10);
        const flankR = F.roofAt(lng + 30 / mLon(lat), lat, 10);
        if (Math.min(flankL, flankR) >= 20) site = { lng, lat, flankL, flankR };
      }
    }
    if (!site) return { none: true };

    const start = await window.__place(site.lng, site.lat, 24, 0, 72);
    let maxAlt = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 70; i++) { await new Promise(r => requestAnimationFrame(r)); maxAlt = Math.max(maxAlt, F.eye().alt); }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    const end = F.eye();
    const dist = Math.hypot((end.lat - start.lat) * M_LAT, (end.lng - start.lng) * mLon(start.lat));
    return { dist, maxAlt, startAlt: start.alt, flank: Math.min(site.flankL, site.flankR) };
  });
  if (r.none) {
    check('a street stays flyable at sign height', false, 'no qualifying street site found in the snapshot');
  } else {
    check('a street stays flyable at sign height (no lift over flanking roofs)',
      r.startAlt < 30 && r.maxAlt < 45,
      `start ${r.startAlt.toFixed(0)} m, peak ${r.maxAlt.toFixed(0)} m, flanked by ${r.flank.toFixed(0)} m buildings (want peak <45)`);
    // Cruise is altitude-scaled by design: at 24 m it is ~7.8 m/s, slow enough
    // to read signage. The assertion is that it MOVED freely, not that it was fast.
    check('the street flight actually covers ground (not blocked)',
      r.dist > 35, `travelled ${r.dist.toFixed(0)} m at sign-reading speed`);
  }
}

// ── 3. STANDOFF. Fly at the tallest tower; stop close enough to read a sign,

//      never inside, and without an elevator climb over the top.

{
  const r = await page.evaluate(async () => {
    const m = window.__map, F = window.__fly;
    const C = 40030228.884, M_LAT = C / 360;
    const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(58 * Math.PI / 360);
    // find the tallest indexed roof by scanning a coarse lattice
    let best = { h: 0 };
    for (let a = 0; a < 60; a++) for (let b = 0; b < 60; b++) {
      const lng = -97.7520 + a * (0.026 / 60), lat = 30.2760 + b * (0.020 / 60);
      const h = F.roofAt(lng, lat, 8);
      if (h > best.h) best = { h, lng, lat };
    }
    const startLng = best.lng - 140 / (M_LAT * Math.cos(best.lat * Math.PI / 180));
    const s0 = await window.__place(startLng, best.lat, 40, 90, 70);   // approach from the west
    const gap0 = Math.hypot((s0.lat - best.lat) * M_LAT, (s0.lng - best.lng) * M_LAT * Math.cos(best.lat * Math.PI / 180));
    let maxAlt = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 120; i++) { await new Promise(r => requestAnimationFrame(r)); maxAlt = Math.max(maxAlt, F.eye().alt); }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 30; i++) await new Promise(r => requestAnimationFrame(r));
    const e = F.eye();
    const gap = Math.hypot((e.lat - best.lat) * M_LAT,
                           (e.lng - best.lng) * M_LAT * Math.cos(best.lat * Math.PI / 180));
    return { towerH: best.h, gap, gap0, startAlt: s0.alt, alt: e.alt, maxAlt, roofUnder: F.roofAt(e.lng, e.lat, 6) };
  });
  check('flying into the tallest tower stops outside it, not inside',
    r.roofUnder === 0 || r.alt >= r.roofUnder + 3.99,
    `tower ${r.towerH.toFixed(0)} m; approached from ${r.gap0.toFixed(0)} m at alt ${r.startAlt.toFixed(0)} m, ended ${r.gap.toFixed(0)} m away at ${r.alt.toFixed(0)} m, roof under camera ${r.roofUnder.toFixed(0)} m`);
  check('it brakes rather than riding an elevator over the top',
    r.maxAlt < r.towerH + 20, `peak altitude ${r.maxAlt.toFixed(0)} m vs tower ${r.towerH.toFixed(0)} m`);
}

// ── 4. THE HEADLINE MOBILE FIX: joystick and look at the same time.

{
  const r = await page.evaluate(async () => {
    const m = window.__map, F = window.__fly;
    const base = document.getElementById('joystick-base');
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const pd = (el, id, x, y, type) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
    const before = F.eye();
    const z0 = m.getZoom();
    // thumb on the stick, pushed forward
    pd(base, 1, cx, cy, 'pointerdown');
    pd(base, 1, cx, cy - 30, 'pointermove');
    await new Promise(r => requestAnimationFrame(r));
    // second thumb swipes on the canvas to look
    const cv = m.getCanvas();
    pd(cv, 2, 600, 300, 'pointerdown');
    for (let i = 1; i <= 10; i++) {
      pd(cv, 2, 600 - i * 20, 300, 'pointermove');
      await new Promise(r => requestAnimationFrame(r));
    }
    for (let i = 0; i < 25; i++) await new Promise(r => requestAnimationFrame(r));
    const mid = F.eye();
    pd(cv, 2, 400, 300, 'pointerup');
    pd(base, 1, cx, cy - 30, 'pointerup');
    for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
    const C = 40030228.884, M_LAT = C / 360;
    return {
      moved: Math.hypot((mid.lat - before.lat) * M_LAT,
                        (mid.lng - before.lng) * M_LAT * Math.cos(before.lat * Math.PI / 180)),
      bearingDelta: Math.abs(((mid.bearing - before.bearing + 540) % 360) - 180),
      zoomDelta: Math.abs(m.getZoom() - z0),
    };
  });
  check('joystick moves the camera while a second finger looks around',
    r.moved > 3 && r.bearingDelta > 15,
    `moved ${r.moved.toFixed(1)} m and turned ${r.bearingDelta.toFixed(0)}° at the same time`);
  check('a second finger is not misread as a pinch-zoom',
    r.zoomDelta < 1.5, `zoom changed ${r.zoomDelta.toFixed(2)}`);
}

check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');

for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);

console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);

// EXIT CODE, added 2026-08-16 (§155). This file printed *FAIL and exited 0 for
// its whole life. §149 deleted silhouette.mjs partly for exactly that and added
// no lint to stop the next one; suite-lint rule 7 does now. Every wrapper in
// this repo reads the exit code — inventory.mjs classifies on it and §142 made
// exit codes load-bearing — so a red printed only to scrollback is a red that
// nothing downstream can see.
const _failed = results.filter(r => !r.pass);
if (_failed.length) console.log('\n*FAIL — ' + _failed.length + ' of ' + results.length + ' failed: ' + _failed.map(r => r.name).join('; '));
process.exitCode = _failed.length ? 1 : 0;

await browser.__done();
