/**
 * scene-unavailable.mjs — after a graphics reset a phone city is either WHOLE or
 * PAUSED behind a "Reload city" card. Never a hollow city you can still walk.
 *
 * WHY (Sep 27 2026, PR #310 + Codex's "recovery v2"). On a phone the authored
 * buildings' and the campus ground's vertex arrays are dropped once they are on
 * the GPU (js/mobile.js LITE.budget.freeGeometryCpu). A lost WebGL context
 * cannot upload them again, so a restored document is missing geometry while
 * its controller and its walking supports (js/campus-landscape.js floorAt)
 * still answer. The first loss reloads by itself; a SECOND loss inside the
 * 10-minute reload limit, or a loss whose reload cannot be recorded, used to
 * leave that hollow city running with 35 positive supports. Zero page errors
 * and a 196-building registry did not notice.
 *
 * SCENARIOS (default: all four; one hardware browser, a fresh context each,
 * 390x844 at DPR 3, touch, iPhone UA, CPU 1x, graphics auto-detect cancelled)
 *   early    the context is lost BEFORE the three.js root exists (the map style
 *            request is held), with the reload record refused. It must pause,
 *            stay paused after the style lands, and the real "Reload city"
 *            button must bring back a whole `lighter` city that moves.
 *   intro    lost during the opening flight: exactly one automatic reload onto
 *            `lighter`, whole. Lost again there: no reload, paused. "Reload
 *            city": whole again, same tier, reload record untouched, it moves.
 *   storage  the normal phone tier with the two reload-record keys refusing
 *            writes: no automatic reload, paused. "Reload city": a whole
 *            phone-tier city that moves.
 *   nodialog Safari before 15.4 has no <dialog>: a settled loss must still
 *            make its one automatic reload and come back whole.
 *
 * PAUSED = all nine: sceneUnavailable set; no controller; every support sample
 *   0; the notice is a native modal; it has no dismiss button; the three.js
 *   root hidden (or never built); custom frames stopped; the camera unchanged
 *   through W held 1.5 s + Escape; no page or console errors.
 * WHOLE = context live; 196 authored buildings, none missing; all 35 support
 *   samples positive, including the 10 that need Gearing's authored model;
 *   released CPU arrays in both the buildings and the structural ground (so it
 *   IS the freed-buffer path, not a retained-buffer shortcut); draw calls > 0;
 *   a hardware renderer (printed).
 *
 *   VERIFY_URL=http://127.0.0.1:8871 node scene-unavailable.mjs [early|intro|storage|nodialog ...] [--out DIR] [--break]
 *
 * --break makes `sceneUnavailable` impossible to set inside the page (the flag
 * every guard reads) and runs `storage`; it must exit 1, and does: the walking
 * supports stay at 35/35 over a city whose buffers are gone, and the card is
 * an ordinary dismissable one. No file on disk changes.
 * Frames (second capture of each pair, JPEG) go to --out, outside the repo.
 * This is desktop Chromium phone emulation: not an iPhone, not memory, not
 * timing. Exit: 0 pass, 1 an assertion failed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BASE, launch, HW_ARGS } from './chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const OUT = oi >= 0 ? argv[oi + 1] : path.join(os.tmpdir(), 'scene-unavailable');
const BREAK = argv.includes('--break');
const picked = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
const SCEN = BREAK ? ['storage'] : (picked.length ? picked : ['early', 'intro', 'storage', 'nodialog']);
fs.mkdirSync(OUT, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA };
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';   // js/app.js new maplibregl.Map({ style })
const TOKEN_KEYS = ['flyover.autoreload', 'flyover.ctxreload'];     // js/mobile.js LITE.autoReload
const READY_MS = +(process.env.READY_MS || 240000);
// The Gearing approach at walking height (Codex, docs/phone-structural-ground.md):
// the ten stair floors that need Gearing's authored model are in view.
const POSE = { eyeLL: [-97.73924014728303, 30.287478156928522], alt: 1.8, pitch: 88, bearing: 5 };

// One sample point inside each walking surface (outer ring, outside its holes),
// from the data the page itself loads.
const GROUND = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'campus_landscape.json'), 'utf8')).walkableGround;
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function interior(rings) {
  const o = rings[0];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, cx = 0, cy = 0;
  for (const [x, y] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); cx += x; cy += y; }
  cx /= o.length; cy /= o.length;
  let best = null, bd = Infinity;
  const N = 41;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = [x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N];
    if (!inRing(p, o) || rings.slice(1).some(r => inRing(p, r))) continue;
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
const SAMPLES = GROUND.map(f => ({ ll: interior(f.rings), authored: !!f.requiresAuthored }));
if (SAMPLES.some(s => !s.ll)) { console.error('a walking surface has no interior sample point'); process.exit(2); }
const NEED_FLOORS = SAMPLES.length, NEED_AUTHORED = SAMPLES.filter(s => s.authored).length;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let failed = 0;
const check = (scen, name, ok, detail) => {
  results.push({ scen, name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${scen.padEnd(8)} ${name}${detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  return !!ok;
};

const browser = await launch(chromium, {
  gl: 'hardware', maxMs: +(process.env.VERIFY_MAX_MS || 1800000),
  args: [...HW_ARGS, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});

async function run(scen) {
  const early = scen === 'early', storageBlocked = scen === 'early' || scen === 'storage', noDialog = scen === 'nodialog';
  const ctx = await browser.newContext(PHONE);
  const errors = [], docs = [];
  let releaseStyle = () => {};
  const styleGate = new Promise(r => { releaseStyle = r; });
  let styleHeld = false;
  try {
    await ctx.exposeBinding('__sceneLife', (_, x) => { docs.push(x); });
    await ctx.addInitScript(({ storageBlocked, TOKEN_KEYS, BREAK, noDialog }) => {
      window.__lifeId = Math.random().toString(36).slice(2);
      window.__sceneLife({ doc: window.__lifeId, url: location.href });
      window.__recoveryHandlers = [];
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, fn, opt) {
        if (type === 'webglcontextlost') window.__recoveryHandlers.push({ onWindow: this === window, src: String(fn).slice(0, 400) });
        return add.call(this, type, fn, opt);
      };
      const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 10);
      if (storageBlocked) {
        const put = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (TOKEN_KEYS.includes(k)) throw new DOMException('test refuses the automatic-reload record', 'SecurityError');
          return put.call(this, k, v);
        };
      }
      if (noDialog) delete HTMLDialogElement.prototype.showModal;   // Safari before 15.4
      if (BREAK) {
        // The code before the fix: nothing can mark the scene unavailable.
        let lp;
        Object.defineProperty(window, 'LITE_PROFILE', { configurable: true, get() { return lp; }, set(v) {
          if (v && typeof v === 'object') Object.defineProperty(v, 'sceneUnavailable', { get: () => false, set() {} });
          lp = v;
        } });
      }
    }, { storageBlocked, TOKEN_KEYS, BREAK, noDialog });
    if (early) await ctx.route(STYLE_URL, async route => { if (!styleHeld) { styleHeld = true; await styleGate; } return route.continue(); });

    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + String(e.stack || e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
    await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 1 });

    const state = () => page.evaluate((samples) => {
      const gl = window.__map && window.__map.painter && window.__map.painter.context.gl;
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const released = g => { let attributes = 0, freed = 0; if (g) g.traverse(o => { if (!o.geometry) return; for (const a of [o.geometry.index, ...Object.values(o.geometry.attributes)]) if (a) { attributes++; if (a.array === null) freed++; } }); return { attributes, freed }; };
      const n = document.getElementById('lite-notice');
      const L = window.LITE_PROFILE || {};
      let token = null; try { token = localStorage.getItem('flyover.autoreload'); } catch (e) {}
      const S = window.slopes, A = window.slopesApartments, C = window.campusLandscape;
      return {
        doc: window.__lifeId, tierName: L.tierName, unavailable: !!L.sceneUnavailable, notice: L.notice || null,
        modal: !!(n && n.matches(':modal')), dismiss: !!(n && n.querySelector('[data-act=close]')),
        controller: !!window.__fly, eye: window.__fly ? window.__fly.eye() : null,
        cam: window.__map ? [...window.__map.getCenter().toArray(), window.__map.getZoom(), window.__map.getBearing(), window.__map.getPitch()] : null,
        lost: gl ? gl.isContextLost() : null, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
        rootBuilt: !!(S && S.root), rootVisible: S && S.root ? S.root.visible : null, frames: S ? S.frames : null,
        draws: S && S.renderer ? S.renderer.info.render.calls : 0,
        geometry: released(S && S.root), structural: released(C && C.structuralGroup),
        buildings: A && A.count ? A.count.buildings : 0, missing: A && A.hidden ? A.hidden.missing.length : null,
        floors: C ? samples.map(s => ({ authored: s.authored, h: C.floorAt(s.ll[0], s.ll[1]) })) : [],
        token,
      };
    }, SAMPLES);
    const ready = async () => {
      await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.group && window.slopesApartments.readyToReveal() &&
        !document.getElementById('veil') && window.campusLandscape && window.campusLandscape.count.done &&
        window.slopesApartments.hidden.missing.length === 0, null, { timeout: READY_MS, polling: 250 });
      await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.WAYFIND) window.WAYFIND.on = false; });
      await sleep(2000);
    };
    const setPose = async () => {
      await page.evaluate(p => {
        window.dispatchEvent(new Event('flycam:takeover')); window.__map.stop();
        const rad = Math.PI / 180, C = 40030228.884, ML = C / 360, lead = p.alt * Math.tan(p.pitch * rad), mx = ML * Math.cos(p.eyeLL[1] * rad);
        const center = [p.eyeLL[0] + lead * Math.sin(p.bearing * rad) / mx, p.eyeLL[1] + lead * Math.cos(p.bearing * rad) / ML];
        const camPx = .5 * window.__map.getCanvas().clientHeight / Math.tan(window.__map.getVerticalFieldOfView() * rad / 2);
        const zoom = Math.log2(camPx * C * Math.cos(center[1] * rad) * Math.cos(p.pitch * rad) / (512 * p.alt));
        window.__map.jumpTo({ center, zoom, pitch: p.pitch, bearing: p.bearing, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
        window.applyTimeOfDay(window.__map, .3, true);
      }, POSE);
      await sleep(4000);
    };
    const frame = async label => {
      await page.screenshot({ path: path.join(OUT, `${scen}-${label}.jpg`), type: 'jpeg', quality: 85 });
      await sleep(650);
      await page.screenshot({ path: path.join(OUT, `${scen}-${label}.jpg`), type: 'jpeg', quality: 85 });
    };
    const lose = async () => {
      const old = await page.evaluate(() => {
        window.__lossExt = window.__map.painter.context.gl.getExtension('WEBGL_lose_context');
        if (!window.__lossExt) throw Error('no WEBGL_lose_context');
        window.__lossExt.loseContext();
        return window.__lifeId;
      });
      await sleep(650);
      await page.evaluate(() => window.__lossExt && window.__lossExt.restoreContext()).catch(e => { if (!/destroyed|navigat/i.test(String(e))) throw e; });
      return old;
    };
    const whole = (label, x, tier) => {
      const pos = x.floors.filter(f => f.h > 0).length, posA = x.floors.filter(f => f.authored && f.h > 0).length;
      const ok = !x.lost && !x.unavailable && x.controller && x.rootVisible === true && x.buildings === 196 && x.missing === 0 &&
        pos === NEED_FLOORS && posA === NEED_AUTHORED && x.geometry.freed > 0 && x.structural.freed > 0 && x.draws > 0 &&
        !!x.renderer && !/swiftshader|software|llvmpipe/i.test(x.renderer) && (!tier || x.tierName === tier);
      return check(scen, `${label}: whole city`, ok, { tier: x.tierName, buildings: x.buildings, missing: x.missing, supports: `${pos}/${NEED_FLOORS}`, authoredSupports: `${posA}/${NEED_AUTHORED}`, freed: x.geometry.freed, structuralFreed: x.structural.freed, draws: x.draws, controller: x.controller, renderer: x.renderer });
    };
    const moves = async label => {
      const a = await page.evaluate(() => window.__fly.eye());
      await page.keyboard.down('s'); await sleep(1100); await page.keyboard.up('s'); await sleep(500);
      const b = await page.evaluate(() => window.__fly.eye());
      const m = Math.hypot((b.lng - a.lng) * 96126, (b.lat - a.lat) * 111320);
      return check(scen, `${label}: keyboard movement`, m > 0.2, `${m.toFixed(2)} m`);
    };

    await page.goto(`${BASE}/index.html?drift=0${(storageBlocked && !early) || noDialog ? '&intro=0' : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    let old;
    if (early) {
      await page.waitForFunction(() => window.__map && window.__map.painter && window.__map.painter.context.gl && window.SLOPES && window.slopes &&
        window.__recoveryHandlers.some(h => h.onWindow && h.src.includes('isMapCanvas')), null, { timeout: 60000 });
      const pre = await page.evaluate(() => ({ rootAbsent: !window.slopes.root, noController: !window.__fly, slopesOn: window.SLOPES.on }));
      check(scen, 'loss lands before the three.js root and the controller exist', styleHeld && pre.rootAbsent && pre.noController && pre.slopesOn, pre);
      old = await lose();
      await sleep(6000);
      const held = await state();
      check(scen, 'paused while the style is still held', held.doc === old && held.unavailable && !held.lost && held.modal, { doc: held.doc === old, unavailable: held.unavailable, lost: held.lost, modal: held.modal });
      releaseStyle();
      await sleep(6000);
    } else if (noDialog) {
      // No <dialog> (Safari before 15.4): a settled loss must still make its
      // one automatic reload - showing the card must not throw it away.
      await ready();
      old = await lose();
      await page.waitForFunction(o => window.__lifeId && window.__lifeId !== o, old, { timeout: 20000 }).catch(() => {});
      const moved = await page.evaluate(() => window.__lifeId).catch(() => old);
      check(scen, 'no <dialog>: the loss still reloads by itself', moved !== old, { reloaded: moved !== old });
      if (moved !== old) { await ready(); whole('after the automatic reload', await state(), 'phone'); }
      check(scen, 'no page or console errors', errors.length === 0, errors.slice(0, 3));
      return;
    } else if (!storageBlocked) {
      await page.waitForFunction(() => window.__intro && window.__intro.flight && window.__intro.flight.state === 'flying' && window.slopes && window.slopes.frames > 2, null, { timeout: READY_MS, polling: 100 });
      old = await lose();
      await page.waitForFunction(o => window.__lifeId && window.__lifeId !== o, old, { timeout: 30000 });
      await ready(); await setPose();
      const first = await state();
      const appDocs = docs.filter(d => d.url.includes('/index.html')).length;
      check(scen, 'first loss in the flight: one automatic reload, recorded', appDocs === 2 && !!first.token, { documents: appDocs, token: !!first.token });
      whole('after the automatic reload', first, 'lighter');
      await frame('before-second-loss');
      old = await lose();
      await sleep(6000);
    } else {
      await ready(); await setPose();
      whole('before the loss', await state(), 'phone');
      await frame('before-loss');
      old = await lose();
      await sleep(6000);
    }

    const blocked = await state();
    check(scen, 'no automatic reload, the GL context itself restored', blocked.doc === old && !blocked.lost && blocked.notice === 'ctx', { sameDocument: blocked.doc === old, lost: blocked.lost, notice: blocked.notice });
    await page.keyboard.down('w'); await sleep(1500); await page.keyboard.up('w'); await page.keyboard.press('Escape'); await sleep(400);
    const after = await state();
    const gate = {
      unavailable: after.unavailable, noController: !after.controller, supportsZero: after.floors.length === NEED_FLOORS && after.floors.every(f => f.h === 0),
      modal: after.modal, noDismiss: !after.dismiss, rootHidden: early ? after.rootVisible !== true : after.rootVisible === false,
      framesStopped: after.frames === blocked.frames, cameraFixed: !!after.cam && after.cam.every((v, i) => Math.abs(v - blocked.cam[i]) < 1e-9),
      noErrors: errors.length === 0,
    };
    await frame('paused');
    const paused = check(scen, 'paused (all nine)', Object.values(gate).every(Boolean), Object.entries(gate).filter(([, v]) => !v).map(([k]) => k).join(',') || 'nine of nine');
    if (paused) {
      const token = after.token;
      await page.locator('#lite-notice [data-act=full]').click();
      await page.waitForFunction(o => window.__lifeId && window.__lifeId !== o, old, { timeout: 30000 });
      await ready(); await setPose();
      const back = await state();
      whole('after "Reload city"', back, early ? 'lighter' : storageBlocked ? 'phone' : 'lighter');
      check(scen, '"Reload city" leaves the automatic-reload record alone', back.token === token, { before: token, after: back.token });
      await frame('reloaded');
      await moves('after "Reload city"');
    }
    check(scen, 'no page or console errors', errors.length === 0, errors.slice(0, 3));
  } finally {
    releaseStyle();
    await ctx.close().catch(() => {});
  }
}

console.log(`scene-unavailable: ${BASE}  scenarios ${SCEN.join(',')}${BREAK ? '  (--break: must fail)' : ''}  samples ${NEED_FLOORS} supports, ${NEED_AUTHORED} need authored`);
for (const s of SCEN) {
  try { await run(s); } catch (e) { check(s, 'ran to the end', false, String(e && e.message || e).slice(0, 300)); }
}
fs.writeFileSync(path.join(OUT, 'scene-unavailable.json'), JSON.stringify({ base: BASE, break: BREAK, results }, null, 2));
await browser.__done();
console.log(failed ? `FAIL: ${failed} check(s)` : `PASS: ${results.length} checks`);
process.exit(failed ? 1 : 0);
