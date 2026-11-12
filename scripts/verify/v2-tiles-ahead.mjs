/**
 * v2-tiles-ahead.mjs - the tiles of a flight load AHEAD of the camera (v2/tiles.js: ahead, cruise; v2/main.js: the opening flight).
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-tiles-ahead.mjs
 *
 * Why: measured 2026-11-12 on the owner's Mac, the second leg of the opening flight (40 to 80 m of camera travel a frame) wanted 76
 * tile copies at once and loaded them under the moving camera: about 20 frames of 60 to 200 ms in 5 s, and buildings that faded in
 * as the camera reached them. With the places ahead named, they load behind the loading screen.
 *
 * What it asserts (the plan only, on a page with no flight: fast, any renderer):
 *   1. a tile out of the camera's reach is wanted once a place ahead is near it, and it is marked "ahead only" (the loading screen
 *      does not wait for a tile that only a place ahead wants);
 *   2. no tile the camera wanted before wants LESS because of a place ahead;
 *   3. with the place taken away again the tile is not wanted, and every tile wants what it wanted before;
 *   4. a place where the camera STOPS wants the full model of a tile inside the far copy's line; a place it only PASSES wants the
 *      far copy there (a full model would not draw in motion), and so does the camera itself while it is on the flight (cruise).
 * The veil's wait and the flight itself are timed by scripts/verify/v2-flight.mjs (a real GPU).
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const browser = await launch(chromium, { maxMs: 900000 });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&steady=0&far=1`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 600000 });
await page.evaluate(() => window.__v2.ready);
let calm = 0; const t0 = Date.now();
while (calm < 2 && Date.now() - t0 < 600000) { const s = await page.evaluate(() => { window.__v2.redraw(); return window.__v2.tiles(); }); calm = s && s.planned !== false && s.loading === 0 && !s.fading && (s.wanting || 0) === 0 ? calm + 1 : 0; await page.waitForTimeout(calm ? 400 : 200); }

const r = await page.evaluate(async () => {
  // Plans only (plan() loads nothing and drops nothing), all in one step, so the app's own loop cannot act in between. The camera
  // is put at a corner of the city for the plans, so that some tiles are out of its reach, and put back at the end.
  const v = window.__v2, T = v.THREE, t = v.tileStreamer(), FAR = v.FAR, rank = { null: 0, far: 1, lod0: 2 };
  const all = () => [...t.tiles.values()];
  const wants = () => Object.fromEntries(all().map((s) => [s.def.id, s.want || null]));
  const out = { tiles: t.tiles.size, far: FAR.ON, coats: all().filter((s) => s.coat).length };
  const cam = v.camera.position.clone(), B = all().map((s) => s.def.bounds);
  const corner = new T.Vector3(Math.min(...B.map((b) => b[0])) - 1500, 100, Math.min(...B.map((b) => b[1])) - 1500);
  v.camera.position.copy(corner);
  t.ahead = []; t.cruise = false; t.plan();
  const before = wants();
  const away = all().filter((s) => !s.want && s.coat).sort((p, q) => q.d - p.d);
  out.away = away.length;
  if (away.length) {
    const X = away[0], [x0, z0, x1, z1] = X.def.bounds, mid = [(x0 + x1) / 2, (z0 + z1) / 2];
    // 1, 2: a place ahead, over the middle of the tile
    t.ahead = [{ p: new T.Vector3(mid[0], 100, mid[1]), rest: true }]; t.plan();
    const withAhead = wants();
    out.wantAhead = X.want; out.aheadOnly = X.aheadOnly; out.here = X.here || null;
    out.less = Object.keys(before).filter((id) => rank[withAhead[id]] < rank[before[id]]).length;
    // 3: the place taken away
    t.ahead = []; t.plan();
    const after = wants(); out.wantAfter = X.want || null; out.changed = Object.keys(before).filter((id) => before[id] !== after[id]).length;
    // 4: inside the line (three quarters of it from the tile's edge): a place the camera stops at, a place it passes, and the
    // camera itself standing there and on a flight. The tile is taken as one with no full model in memory (a tile that has its
    // full model keeps it: that is not what is tested here)
    const full = X.full; X.full = null;
    const line = X.line, at = (rest) => [{ p: new T.Vector3(x1 + line * 0.75, 100, mid[1]), rest }];
    out.line = Math.round(line); out.motionScale = FAR.MOTION_SCALE;
    t.ahead = at(true); t.plan(); out.stops = X.want;
    t.ahead = at(false); t.plan(); out.passes = X.want;
    t.ahead = [];
    v.camera.position.set(x1 + line * 0.75, 100, mid[1]);
    t.cruise = false; t.plan(); out.camStill = X.want;
    t.cruise = true; t.plan(); out.camCruise = X.want;
    X.full = full;
  }
  t.ahead = []; t.cruise = false; v.camera.position.copy(cam); t.plan();
  return out;
});
await browser.close();

let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : '*FAIL ') + msg); ok &&= !!c; };
console.log(`     ${r.tiles} tiles, ${r.coats} with a far copy, ${r.away} out of the camera's reach; far copies ${r.far ? 'on' : 'OFF'}`);
check(r.far && r.away > 0, 'the page has far copies and a tile out of reach to test with');
if (r.away > 0) {
  check(r.wantAhead && r.aheadOnly === true && r.here === null, `a tile out of reach is wanted once a place ahead is over it (wants "${r.wantAhead}"), and only the place ahead wants it`);
  check(r.less === 0, `no tile wants less because of a place ahead (${r.less})`);
  check(r.wantAfter === null && r.changed === 0, `with the place taken away the tile is not wanted, and every tile wants what it wanted before (${r.changed} differ)`);
  check(r.stops === 'lod0', `a place where the camera stops, at 0.75 of the far copy's line (${r.line} m), wants the full model ("${r.stops}")`);
  check(r.passes === 'far', `a place the camera only passes wants the far copy there ("${r.passes}"; in motion the far copy draws from ${r.motionScale} of the line)`);
  check(r.camStill === 'lod0' && r.camCruise === 'far', `the camera itself: standing there it wants the full model ("${r.camStill}"), on a flight the far copy ("${r.camCruise}")`);
}
if (errs.length) { console.log('errors:', [...new Set(errs)].slice(0, 4)); ok = false; }
process.exit(ok ? 0 : 1);
