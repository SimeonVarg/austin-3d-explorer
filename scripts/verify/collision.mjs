/**

 * verify-collision.mjs — the guarantees that matter for the actual use case:

 * never end up inside a building, and still be able to fly down a West Campus

 * street at sign-reading height without being lifted over the rooftops.

 * Also covers the headline mobile fix: joystick and look at the same time.

 */

import { chromium } from 'playwright-core';

// BASE honours VERIFY_URL so parallel worktrees can each test their own serve

// (chrome.mjs has exported it for this purpose all along). No assertion change.

import { BASE, launch } from './chrome.mjs';

const browser = await launch(chromium, { maxMs: Number(process.env.VERIFY_MAX_MS || 900000) });

try {

const page = await browser.newPage({ viewport: { width: 800, height: 560 }, hasTouch: true });

const errs = [];

page.on('pageerror', e => errs.push(e.message));

// Cancel before the delayed probe can alter settings during measurement.
await page.addInitScript(() => {
  const timer = setInterval(() => {
    if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(timer); }
  }, 10);
});
await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.slopesApartments?.readyToReveal() &&
  window.slopesApartments.count.buildings === 196 && !document.getElementById('veil'), null, { timeout: 180000 });
await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => window.__fly?.indexed(), null, { timeout: 30000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect());

const results = [];

const check = (name, pass, detail) => results.push({ name, pass, detail });

await page.evaluate(() => {
  const F = window.__fly, C = 40030228.884, M_LAT = C / 360;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  window.__metres = (a,b) => Math.hypot((a.lat-b.lat)*M_LAT,
    (a.lng-b.lng)*M_LAT*Math.cos(b.lat*Math.PI/180));
  window.__settle = async () => {
    const start=performance.now();
    while (F.eye().driving) {
      if (performance.now()-start >= 60000) throw new Error('Collision pose did not settle within 60 s');
      await sleep(50);
    }
  };
  // Effective control-loop time rather than RAF count. The independent wall
  // deadline rejects even if RAF stops completely; callers must await it.
  window.__runSim = async (seconds, sample=()=>{}, wallMax=90000) => {
    const from=F.simTime(); let timer, stopped=false;
    try {
      await Promise.race([
        (async () => {
          while (!stopped && F.simTime()-from < seconds) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (!stopped) sample();
          }
        })(),
        new Promise((_,reject) => { timer=setTimeout(() => reject(new Error(`Collision sim window ${seconds}s timed out`)),wallMax); })
      ]);
      return F.simTime()-from;
    } finally { stopped=true; clearTimeout(timer); }
  };
  window.__place = async (lng,lat,alt,bearing,pitch) => {
    await window.__settle();
    const m=window.__map, camPx=m.transform.cameraToCenterDistance;
    if (!(camPx>0)) throw new Error('Invalid cameraToCenterDistance');
    const D=alt/Math.cos(pitch*Math.PI/180),lead=alt*Math.tan(pitch*Math.PI/180);
    const cLat=lat+lead*Math.cos(bearing*Math.PI/180)/M_LAT;
    const cLng=lng+lead*Math.sin(bearing*Math.PI/180)/(M_LAT*Math.cos(lat*Math.PI/180));
    const zoom=Math.log2(C*Math.cos(cLat*Math.PI/180)*camPx/(512*D));
    m.jumpTo({center:[cLng,cLat],zoom,bearing,pitch});
    await window.__runSim(.1);
    const e=F.eye(),posError=window.__metres(e,{lng,lat});
    const bearingError=Math.abs(((e.bearing-bearing+540)%360)-180);
    if (![e.alt,e.lng,e.lat,e.pitch,e.bearing].every(Number.isFinite) ||
        posError>.5 || Math.abs(e.alt-alt)>.25 || bearingError>.1 || Math.abs(e.pitch-pitch)>.1 || e.driving)
      throw new Error(`Collision seed mismatch: ${JSON.stringify({requested:{lng,lat,alt,bearing,pitch},actual:e,posError})}`);
    return e;
  };
});

console.log('grid bytes:', await page.evaluate(() => window.__fly.gridBytes()));

console.log('roofAt spawn r=400:', await page.evaluate(() => window.__fly.roofAt(-97.7434, 30.2857, 400).toFixed(1)),
            '(snapshot max is 97.5)');

// ── 1. NEVER INSIDE. Fly many randomised low-altitude segments and sample the

//      clearance on every single frame.

{
  const worst = await page.evaluate(async () => {
    const F = window.__fly;
    let worst = { margin: 1e9 }, frames = 0;
    // deterministic pseudo-random so the run is reproducible
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let seg = 0; seg < 24; seg++) {
      const lng = -97.7500 + rnd() * 0.020, lat = 30.2790 + rnd() * 0.0150;
      const alt = 18 + rnd() * 60, bearing = rnd() * 360;
      await window.__place(lng, lat, alt, bearing, 70);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
      try { for (let i = 0; i < 22; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const e = F.eye();
        const roof = F.roofAt(e.lng, e.lat, 6);
        frames++;
        if (roof > 0) {
          const margin = e.alt - roof;
          if (margin < worst.margin) worst = { margin, roof, alt: e.alt, lng: e.lng, lat: e.lat };
        }
      }
      } finally { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true })); }
      await window.__settle();
    }
    return { ...worst, frames };
  });
  check('camera is never inside a building (alt >= roof + 4 m, every frame)',
    worst.frames === 528 && worst.margin >= 3.99,
    `worst clearance ${worst.margin === 1e9 ? 'n/a' : worst.margin.toFixed(2) + ' m'} over ${worst.frames} sampled frames`);
}

// ── 2. STREETS STAY FLYABLE. The whole point of the small 6 m probe: flying a

//      street at sign height must not lift you over the flanking rooftops.

{
  const r = await page.evaluate(async () => {
    const F = window.__fly;
    const C = 40030228.884, M_LAT = C / 360;
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
    let dtSim;
    try { dtSim=await window.__runSim(8, () => { maxAlt=Math.max(maxAlt,F.eye().alt); }); }
    finally { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true })); }
    await window.__settle();
    const end = F.eye();
    const dist = Math.hypot((end.lat - start.lat) * M_LAT, (end.lng - start.lng) * mLon(start.lat));
    return { dist, dtSim, maxAlt, startAlt: start.alt, flank: Math.min(site.flankL, site.flankR) };
  });
  if (r.none) {
    check('a street stays flyable at sign height', false, 'no qualifying street site found in the snapshot');
  } else {
    check('a street stays flyable at sign height (no lift over flanking roofs)',
      r.startAlt < 30 && r.maxAlt < 45,
      `start ${r.startAlt.toFixed(0)} m, peak ${r.maxAlt.toFixed(0)} m, flanked by ${r.flank.toFixed(0)} m buildings (want peak <45)`);
    // Cruise is altitude-scaled by design. This assertion checks that the
    // camera moved freely; it does not establish a speed-performance result.
    check('the street flight actually covers ground (not blocked)',
      r.dist > 35, `travelled ${r.dist.toFixed(0)} m at sign-reading speed over ${r.dtSim.toFixed(2)} s simulation`);
  }
}

// ── 3. STANDOFF. Fly at the tallest tower; stop close enough to read a sign,

//      never inside, and without an elevator climb over the top.

{
  const r = await page.evaluate(async () => {
    const F = window.__fly;
    const C = 40030228.884, M_LAT = C / 360;
    // find the tallest indexed roof by scanning a coarse lattice
    let best = { h: 0 };
    for (let a = 0; a < 60; a++) for (let b = 0; b < 60; b++) {
      const lng = -97.7520 + a * (0.026 / 60), lat = 30.2760 + b * (0.020 / 60);
      const h = F.roofAt(lng, lat, 0);
      if (h > best.h) best = { h, lng, lat };
    }
    if (!(best.h>40)) throw new Error('No tall solid tower found for standoff');
    // Start 140 m away on a clear approach. The first blocking footprint must
    // belong to the target; braking at an intervening building is not this test.
    let approach=null;
    for (let direction=0; direction<16 && !approach; direction++) {
      const angle=(270+direction*22.5)*Math.PI/180;
      const point=d => ({lng:best.lng+d*Math.sin(angle)/(M_LAT*Math.cos(best.lat*Math.PI/180)),
                        lat:best.lat+d*Math.cos(angle)/M_LAT});
      const start=point(140);
      if (F.roofAt(start.lng,start.lat,6)!==0) continue;
      for (let d=138; d>=0; d-=2) {
        const p=point(d),h=F.roofAt(p.lng,p.lat,6);
        if (h+2.5<=40) continue;
        if (h>=best.h-.1 && d<=100) approach={...start,bearing:(270+direction*22.5+180)%360,wallGap:d};
        break;
      }
    }
    if (!approach) throw new Error('No unobstructed approach to tallest tower; standoff was not exercised');
    const s0=await window.__place(approach.lng,approach.lat,40,approach.bearing,70);
    const gap0=window.__metres(s0,best);
    let maxAlt = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    let minGap=gap0,dtSim;
    try { dtSim=await window.__runSim(20, () => {
      const eye=F.eye(); maxAlt=Math.max(maxAlt,eye.alt); minGap=Math.min(minGap,window.__metres(eye,best));
    }); }
    finally { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true })); }
    await window.__settle();
    const e = F.eye();
    const gap = Math.hypot((e.lat - best.lat) * M_LAT,
                           (e.lng - best.lng) * M_LAT * Math.cos(best.lat * Math.PI / 180));
    return { towerH: best.h, gap, gap0, minGap, dtSim, wallGap:approach.wallGap, startAlt: s0.alt, alt: e.alt, maxAlt, roofUnder: F.roofAt(e.lng, e.lat, 6) };
  });
  check('tower standoff actually reaches the target approach',
    Math.abs(r.gap0-140)<1 && r.gap0-r.minGap>35 && r.minGap<=r.wallGap+20,
    `start ${r.gap0.toFixed(1)} m, closest ${r.minGap.toFixed(1)} m, target wall ${r.wallGap.toFixed(1)} m from sampled tower point; ${r.dtSim.toFixed(2)} s simulation`);
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
    await window.__place(-97.7434,30.2857,180,0,65);
    const base = document.getElementById('joystick-base');
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const pd = (el, id, x, y, type) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
    const before = F.eye();
    const z0 = m.getZoom();
    const cv = m.getCanvas();
    let mid, dtSim;
    try {
      // Thumb on the stick, pushed forward; second thumb looks on the canvas.
      pd(base, 1, cx, cy, 'pointerdown');
      pd(base, 1, cx, cy - 30, 'pointermove');
      await new Promise(r => requestAnimationFrame(r));
      pd(cv, 2, 600, 300, 'pointerdown');
      for (let i = 1; i <= 10; i++) {
        pd(cv, 2, 600 - i * 20, 300, 'pointermove');
        await new Promise(r => requestAnimationFrame(r));
      }
      dtSim = await window.__runSim(2);
      mid = F.eye();
    } finally {
      pd(cv, 2, 400, 300, 'pointerup');
      pd(base, 1, cx, cy - 30, 'pointerup');
    }
    await window.__settle();
    const C = 40030228.884, M_LAT = C / 360;
    return {
      dtSim,
      moved: Math.hypot((mid.lat - before.lat) * M_LAT,
                        (mid.lng - before.lng) * M_LAT * Math.cos(before.lat * Math.PI / 180)),
      bearingDelta: Math.abs(((mid.bearing - before.bearing + 540) % 360) - 180),
      zoomDelta: Math.abs(m.getZoom() - z0),
    };
  });
  check('joystick moves the camera while a second finger looks around',
    r.moved > 3 && r.bearingDelta > 15,
    `moved ${r.moved.toFixed(1)} m and turned ${r.bearingDelta.toFixed(0)}° at the same time over ${r.dtSim.toFixed(2)} s simulation`);
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

} finally { await browser.__done(); }
