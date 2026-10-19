/**
 * v2-flycam.mjs - v2's camera controls are v1's flycam: the same keys, drags, wheel, limits, glide and collision.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-flycam.mjs
 *
 * Owner, 2026-10-18: "the controls are like the blender controls or the 3d editor controls can you make the controls like the OG?"
 * v2/flycam.js ports js/controls.js. This drives it with real keyboard, mouse, wheel and pointer events, and steps the controls
 * on a manual clock (controls.clock), so the numbers do not depend on how fast the renderer is (CI's SwiftShader draws a frame
 * every few seconds; v1's tick drops any frame longer than 1 s, so real time would integrate nothing there).
 *
 * Every expectation is v1's own arithmetic (js/controls.js), with v2's lens factor on the look (40 / 58):
 *   W 1 s then coast 1 s     forward along the view, 40 m/s x (alt / 163)^0.75 with the 0.2 s / 0.45 s glide, no sideways drift
 *   Shift+W                  2.5x the speed
 *   drag 100 px right        bearing -100 x 0.20 x 40/58 degrees (the view turns left: you grab the city)
 *   drag 50 px down          pitch +50 x 0.13 x 40/58 (toward the horizon)
 *   wheel 100 px down        altitude x e^(-0.18)
 *   Q held 1 s               altitude x e^0.25
 *   limits                   pitch 5..88 degrees from straight down, eye 1.7..900 m
 *   a building               flying low at the UT Tower never puts the eye inside it (the camera's point is always above the roof
 *                            under it) and stops it short of the Tower's middle
 *   R                        eases home
 *   phone                    the joystick and BOOST are on the page; the stick moves the camera forward
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const browser = await launch(chromium, { maxMs: 1200000 });
let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : '*FAIL ') + msg); ok &&= !!c; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 300000 });
  await page.evaluate(() => window.__v2.ready);
  await page.waitForFunction(() => window.__v2.fly().field.ready, null, { timeout: 300000 });
  // the manual clock: __step(n) advances the controls n frames of 1/60 s
  await page.evaluate(() => {
    const c = window.__v2.controls; let t = 1e7; c.clock = () => t; c.lastTs = null; c.update();
    window.__step = (n, ms = 1000 / 60) => { const out = []; for (let i = 0; i < n; i++) { t += ms; c.update(); out.push(window.__v2.fly()); } return out; };
  });
  return { ctx, page, errs };
}
const place = (page, p) => page.evaluate((p) => { window.__v2.placeCamera(p); window.__step(1); return window.__v2.fly(); }, p);
const step = (page, n) => page.evaluate((n) => window.__step(n).pop(), n);
const fly = (page) => page.evaluate(() => window.__v2.fly());

// ── desktop ──
{
  const { ctx, page, errs } = await open({ viewport: { width: 1100, height: 700 } });
  const K = await page.evaluate(() => ({ ...window.__v2.FLY, fov: window.__v2.camera.fov }));
  const look = K.fov / K.V1_FOV_DEG;
  // over the South Mall, high, looking north (bearing 0)
  const start = { target: [-150, 0, 260], distance: 420, polarDeg: 70, azimuthDeg: 0 };

  let s0 = await place(page, start);
  check(near(s0.bearing % 360, 0, 0.5) || near(s0.bearing, 360, 0.5), `placed looking north (bearing ${s0.bearing.toFixed(2)})`);
  await page.mouse.move(550, 350);
  await page.keyboard.down('w'); let s1 = await step(page, 60); await page.keyboard.up('w');
  const v1speed = Math.min(K.SPEED_MAX, Math.max(K.SPEED_MIN, K.SPEED_REF * Math.pow(s0.alt / K.ALT_REF, K.SPEED_EXP)));
  const after1 = v1speed * (1 - Math.exp(-1 / K.TAU_ACCEL));
  check(near(Math.hypot(s1.vE, s1.vN), after1, after1 * 0.06), `W 1 s: speed ${Math.hypot(s1.vE, s1.vN).toFixed(1)} m/s (v1: ${after1.toFixed(1)} of ${v1speed.toFixed(1)})`);
  let s2 = await step(page, 90);
  const dn = s0.z - s2.z, de = s2.x - s0.x;
  check(dn > 20 && Math.abs(de) < 0.5, `W moved the eye north ${dn.toFixed(1)} m, sideways ${de.toFixed(2)} m`);
  check(Math.hypot(s2.vE, s2.vN) < 0.5 * Math.hypot(s1.vE, s1.vN), `released: the glide slows it (${Math.hypot(s2.vE, s2.vN).toFixed(2)} m/s after 1.5 s)`);

  // Shift boost
  s0 = await place(page, start);
  await page.keyboard.down('Shift'); await page.keyboard.down('w'); s1 = await step(page, 90); await page.keyboard.up('w'); await page.keyboard.up('Shift');
  await step(page, 120);
  check(Math.hypot(s1.vE, s1.vN) > 2.2 * after1, `Shift+W: ${Math.hypot(s1.vE, s1.vN).toFixed(1)} m/s (x2.5 boost)`);

  // look: drag right 100 px, then down 50 px
  s0 = await place(page, start);
  await page.mouse.move(500, 350); await page.mouse.down();
  await page.mouse.move(600, 350, { steps: 10 }); await step(page, 2);
  await page.mouse.move(600, 400, { steps: 10 }); await step(page, 2);
  await page.mouse.up(); s1 = await step(page, 2);
  const db = ((s1.bearing - s0.bearing + 540) % 360) - 180;
  check(near(db, -100 * K.SENS_YAW_MOUSE * look, 0.6), `drag 100 px right: bearing ${db.toFixed(2)} degrees (v1 x lens: ${(-100 * K.SENS_YAW_MOUSE * look).toFixed(2)})`);
  check(near(s1.pitch - s0.pitch, 50 * K.SENS_PITCH_MOUSE * look, 0.4), `drag 50 px down: pitch +${(s1.pitch - s0.pitch).toFixed(2)} (v1 x lens: ${(50 * K.SENS_PITCH_MOUSE * look).toFixed(2)})`);
  await step(page, 600);   // let the feel effects die away

  // wheel and Q
  s0 = await place(page, start);
  await page.mouse.move(550, 350); await page.mouse.wheel(0, 100); s1 = await step(page, 3);
  check(near(s1.alt / s0.alt, Math.exp(-100 * K.WHEEL_GAIN), 0.01), `wheel 100 px down: altitude x${(s1.alt / s0.alt).toFixed(3)} (v1 ${Math.exp(-100 * K.WHEEL_GAIN).toFixed(3)})`);
  s0 = s1; await page.keyboard.down('q'); s1 = await step(page, 60); await page.keyboard.up('q');
  check(near(s1.alt / s0.alt, Math.exp(K.VERT_GAIN), 0.02), `Q 1 s: altitude x${(s1.alt / s0.alt).toFixed(3)} (v1 ${Math.exp(K.VERT_GAIN).toFixed(3)})`);
  await step(page, 600);

  // limits
  await page.mouse.move(550, 200); await page.mouse.down(); await page.mouse.move(550, 600, { steps: 20 }); await step(page, 2);
  await page.mouse.up(); s1 = await step(page, 2);
  check(s1.pitch <= K.PITCH_MAX + 1e-6 && s1.pitch > K.PITCH_MAX - 0.5, `pitch stops at ${s1.pitch.toFixed(2)} (v1 ${K.PITCH_MAX})`);
  for (let i = 0; i < 4; i++) { await page.mouse.move(550, 600); await page.mouse.down(); await page.mouse.move(550, 90, { steps: 20 }); await step(page, 2); await page.mouse.up(); }
  s1 = await step(page, 2);
  check(s1.pitch >= K.PITCH_MIN - 1e-6 && s1.pitch < K.PITCH_MIN + 0.5, `pitch stops at ${s1.pitch.toFixed(2)} looking down (v1 ${K.PITCH_MIN})`);
  // over open ground (no footprint within 12 m), the wheel takes the eye down to the floor
  const spot = await page.evaluate(() => { const f = window.__v2.controls.field; for (let r = 0; r < 600; r += 6) for (let a = 0; a < 6.28; a += 0.4) { const x = -150 + r * Math.cos(a), z = 650 + r * Math.sin(a); if (f.heightIn(x, z, 12) === 0 && !f.trunkAt(x, z, 1.7) && f.heightIn(x, z, 40) === 0) return [x, z]; } return null; });
  await place(page, { target: [spot[0], 0, spot[1] - 300], distance: 320, polarDeg: 70, azimuthDeg: 0 });
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 240); await step(page, 3); }
  s1 = await step(page, 240);
  check(s1.alt >= K.ALT_MIN - 1e-6 && s1.alt < 2.5, `wheel down: the eye stops at ${s1.alt.toFixed(2)} m (v1 ${K.ALT_MIN}) over open ground`);
  await page.keyboard.down('q'); s1 = await step(page, 60 * 30); await page.keyboard.up('q');
  check(s1.alt <= K.ALT_MAX + 1e-6 && s1.alt > K.ALT_MAX - 1, `Q: the eye stops at ${s1.alt.toFixed(1)} m (v1 ${K.ALT_MAX})`);
  await step(page, 600);

  // a building: at 30 m, 160 m south of the UT Tower, fly north into it for 8 s
  const tower = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()).then((m) => m.buildings['ut-tower-main-building']));
  await place(page, { target: [tower.x, 0, tower.z - 40], distance: 205, polarDeg: 81.6, azimuthDeg: 0 });
  s0 = await fly(page);
  await page.keyboard.down('w');
  const path = await page.evaluate(() => { const out = []; for (let i = 0; i < 480; i++) { const s = window.__step(1)[0]; const c = window.__v2.camera.position; out.push([c.x, c.y, c.z, window.__v2.controls.field.heightIn(c.x, c.z, 0.01)]); } return out; });
  await page.keyboard.up('w'); await step(page, 120);
  const inside = path.filter((p) => p[1] <= p[3]).length;
  const closest = Math.min(...path.map((p) => Math.hypot(p[0] - tower.x, p[2] - tower.z)));
  check(s0.alt < 40, `low approach at ${s0.alt.toFixed(1)} m (the Tower stands ${tower.top} m)`);
  check(inside === 0, `the eye never inside a building over 480 frames (${inside} frames below the roof under it)`);
  check(path[path.length - 1][2] > tower.z, `stopped short of the Tower's middle (eye ${(path[path.length - 1][2] - tower.z).toFixed(1)} m south of it; nearest ${closest.toFixed(1)} m)`);

  // R: home
  await page.keyboard.press('r');
  check(await page.evaluate(() => window.__v2.map.isEasing()), 'R eases home');

  const tick = await page.evaluate(() => window.__v2.fly().tickMs);
  console.log(`controls tick (desktop, this machine): ${tick.toFixed(3)} ms a frame`);
  if (errs.length) { console.log('page errors:', errs.slice(0, 3)); ok = false; }
  await ctx.close();
}

// ── phone: the joystick ──
{
  const { ctx, page, errs } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const vis = await page.evaluate(() => { const b = document.getElementById('joystick-base'), r = b && b.getBoundingClientRect(); const boost = document.getElementById('joy-boost'); return { joy: !!r && r.width > 20 && getComputedStyle(b).display !== 'none', boost: !!boost && boost.getBoundingClientRect().width > 20, r: r && [r.left + r.width / 2, r.top + r.height / 2] }; });
  check(vis.joy && vis.boost, 'phone: the joystick and BOOST are on screen');
  const s0 = await place(page, { target: [-150, 0, 260], distance: 420, polarDeg: 70, azimuthDeg: 0 });
  // the stick works with any pointer (v1: "so it also works with a mouse, pen or trackpad")
  await page.mouse.move(vis.r[0], vis.r[1]); await page.mouse.down(); await page.mouse.move(vis.r[0], vis.r[1] - 40, { steps: 4 });
  await step(page, 60); await page.mouse.up(); const s1 = await step(page, 60);
  check(s0.z - s1.z > 15, `phone: stick forward moved the eye north ${(s0.z - s1.z).toFixed(1)} m`);
  if (errs.length) { console.log('page errors:', errs.slice(0, 3)); ok = false; }
  await ctx.close();
}
await browser.close();
process.exit(ok ? 0 : 1);
