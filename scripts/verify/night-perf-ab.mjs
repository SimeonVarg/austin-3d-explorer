/**
 * night-perf-ab.mjs — frame cost, night vs day, two views, one browser per mode.
 *
 * This is the script behind `docs/night-implementation-plan.md` §1.5 "Cost
 * baselines" and acceptance row A10. Its two kept runs are
 * `docs/night/harness-runs/night-perf-ab-desktop.json` and
 * `night-perf-ab-lite.json`; read their `committedCopy` before quoting a number.
 *
 *   VERIFY_URL=http://127.0.0.1:8661 OUTJ=<scratch>/perf-desktop.json
 *     node scripts/verify/night-perf-ab.mjs desktop "" 5
 *   VERIFY_URL=http://127.0.0.1:8661 OUTJ=<scratch>/perf-lite.json
 *     node scripts/verify/night-perf-ab.mjs lite "lite=1" 5
 *
 * Args are <label> [extraQuery] [reps]; `SITE` is accepted as an alias for
 * VERIFY_URL. OUTJ is where the report lands — leave it unset and the run only
 * prints. Write it to the scratchpad, not into the repo: a report is only worth
 * committing when a doc cites it.
 *
 * RUN IT THROUGH THE SHARED GPU-SLOT WRAPPER. This launches a HARDWARE-GL
 * Chrome, and on the Acer several of those at once blue-screen the machine
 * (0x116, 4 GB VRAM). The wrapper is `<lanes>/gpu-run.mjs` in the session's
 * scratch folder, not in the repo — it holds the three machine-wide slots that
 * every hardware-GL script here has to take one of:
 *
 *   node <lanes>/gpu-run.mjs --label night-perf-ab --
 *     env VERIFY_URL=http://127.0.0.1:8661 OUTJ=<scratch>/perf-desktop.json
 *     node scripts/verify/night-perf-ab.mjs desktop "" 5
 *
 * Hardware GL (headless), 1440x900 dsf1, ?intro=0&drift=0 (+extraQuery, e.g.
 * lite=1), auto-detect cancelled, waits for readyToReveal. Per rep, per view,
 * per hour (order counterbalanced on alternate reps):
 *   - set hour with applyTimeOfDay(force), idle, 2.5 s settle
 *   - pose, idle, 1.5 s
 *   - FORCED: 40 x { map.redraw(); gl.finish() } at the parked camera -> ms (CPU+GPU of one full frame)
 *   - SWEEP: 4 s linear easeTo of +60 deg bearing, rAF intervals -> fps / p50 / p95 / dropped
 * Reports min and spread across reps. Also the one-off retint (day->night) cost.
 *
 * JUDGE BY THE MINIMUM, AND ONLY THE MINIMUM. The two kept runs were shot on a
 * machine other lanes were loading, and a single rep of an identical scene
 * varies by 50% here (campus-aerial night: 45.9 to 59.7 ms across five reps).
 * That is the suite's standing rule, not a caveat about these two runs.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

const LABEL = process.argv[2] || 'desktop';
const EXTRA = process.argv[3] || '';
const REPS = +(process.argv[4] || 5);
const SITE = process.env.SITE || BASE;
const OUTJ = process.env.OUTJ;
const HOURS = { day: 0.30, night: 1.0 };
const VIEWS = {
  'campus-aerial': { center: [-97.7395, 30.2860], zoom: 16.0, pitch: 68, bearing: 200 },
  'wc-elev-north': null, // filled from the capture derive
};
// same derive as night-capture.mjs for 04-wc-elev-north
{
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const eye = [-97.7437, 30.2850, 70], target = [-97.7462, 30.2895, 40], H = 900;
  const mlon = 111320 * Math.cos(rad(eye[1])), mlat = 110540;
  const dx = (target[0] - eye[0]) * mlon, dy = (target[1] - eye[1]) * mlat;
  const horiz = Math.hypot(dx, dy), bearing = (deg(Math.atan2(dx, dy)) + 360) % 360;
  const pitch = Math.min(88, deg(Math.atan2(horiz, eye[2] - target[2])));
  const gd = eye[2] * Math.tan(rad(pitch));
  const lng = eye[0] + Math.sin(rad(bearing)) * gd / mlon, lat = eye[1] + Math.cos(rad(bearing)) * gd / mlat;
  const range = eye[2] / Math.cos(rad(pitch)), c2c = 0.5 * H / Math.tan(rad(29));
  VIEWS['wc-elev-north'] = { center: [lng, lat], zoom: Math.log2(40075016.686 * Math.cos(rad(lat)) / (512 * (range / c2c))), pitch, bearing };
}

const browser = await launch(chromium, { gl: 'hardware', maxMs: 2 * 3600000 });
const out = { label: LABEL, extra: EXTRA, reps: REPS, when: new Date().toISOString(), runs: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('crash', () => console.log('PAGE CRASHED (renderer)'));
  page.on('close', () => console.log('PAGE CLOSED'));
  if (browser.on) browser.on('disconnected', () => console.log('BROWSER DISCONNECTED'));
  const t0 = Date.now();
  await page.goto(SITE + '/index.html?intro=0&drift=0' + (EXTRA ? '&' + EXTRA : ''), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.readyToReveal(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  out.bootS = +((Date.now() - t0) / 1000).toFixed(1);
  // js/app.js:1945-1950 switches the authored apartments OFF for the visit when they are not ready
  // 90 s after boot (INTRO.authoredCeilingMs). Under this machine's parallel load that fires, and the
  // city falls back to legacy prisms. Re-enable them in-page so the frames show the normal scene.
  const aptBefore = await page.evaluate(() => ({ on: window.APARTMENTS && window.APARTMENTS.on, group: !!(window.slopesApartments && window.slopesApartments.group) }));
  if (aptBefore.on === false) await page.evaluate(() => { window.APARTMENTS.on = true; window.applySlopesApartments && window.applySlopesApartments(window.__map); });
  const aptOk = await page.waitForFunction(() => !!(window.slopesApartments && window.slopesApartments.group) && window.slopesApartments.readyToReveal(), null, { timeout: 600000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(3000);
  console.log('APARTMENTS before', JSON.stringify(aptBefore), 'group after re-enable', aptOk);
  out.apartments = { before: aptBefore, groupAfter: aptOk };

  out.gfx = await page.evaluate(() => ({ preset: window.GFX.preset, renderScale: window.GFX.renderScale, bloom: window.GFX.bloom, godRays: window.GFX.godRays, autoExposure: window.GFX.autoExposure, lite: window.LITE_PROFILE, dpr: devicePixelRatio,
    canvas: [window.__map.getCanvas().width, window.__map.getCanvas().height], gl: (() => { const gl = window.__map.painter.context.gl; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() }));
  console.log(LABEL, 'boot', out.bootS, 's', JSON.stringify(out.gfx));

  // one-off: the retint itself, day -> night and back, twice
  out.retint = [];
  for (let i = 0; i < 2; i++) for (const [from, to] of [[0.30, 1.0], [1.0, 0.30]]) {
    const r = await page.evaluate(async ([from, to]) => {
      const m = window.__map;
      window.applyTimeOfDay(m, from, true);
      await new Promise(r => { const k = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(k); r(); }); });
      await new Promise(r => setTimeout(r, 1500));
      const t = performance.now();
      window.applyTimeOfDay(m, to, true);
      const sync = performance.now() - t;
      await new Promise(r => { const k = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(k); r(); }); });
      return { from, to, syncMs: +sync.toFixed(0), toIdleMs: +(performance.now() - t).toFixed(0) };
    }, [from, to]);
    out.retint.push(r);
    console.log('retint', JSON.stringify(r));
  }

  for (let rep = 0; rep < REPS; rep++) {
    for (const [vname, pose] of Object.entries(VIEWS)) {
      const order = rep % 2 ? ['night', 'day'] : ['day', 'night'];
      for (const hour of order) {
        const r = await page.evaluate(async (a) => {
          const m = window.__map, gl = m.painter.context.gl;
          window.applyTimeOfDay(m, a.p, true);
          const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(a.p);
          await new Promise(r => { const k = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(k); r(); }); });
          await new Promise(r => setTimeout(r, 2500));
          m.jumpTo({ center: a.pose.center, zoom: a.pose.zoom, pitch: a.pose.pitch, bearing: a.pose.bearing });
          await new Promise(r => { const k = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(k); r(); }); });
          await new Promise(r => setTimeout(r, 1500));
          const forced = [];
          for (let i = 0; i < 40; i++) { const t = performance.now(); (m.redraw ? m.redraw() : m._render(0)); gl.finish(); forced.push(performance.now() - t); }
          forced.sort((x, y) => x - y);
          const dts = [];
          m.easeTo({ bearing: a.pose.bearing + 60, duration: 4000, easing: t => t });
          const t0 = performance.now();
          await new Promise(res => { let last = null; const step = ts => { if (last !== null) dts.push(ts - last); last = ts; if (performance.now() - t0 > 4000) return res(); requestAnimationFrame(step); }; requestAnimationFrame(step); });
          m.stop();
          const s = [...dts].sort((x, y) => x - y), q = f => s[Math.min(s.length - 1, Math.floor(s.length * f))] || 0;
          const el = dts.reduce((x, d) => x + d, 0);
          return { forcedMin: +forced[0].toFixed(2), forcedMed: +forced[20].toFixed(2), forcedP90: +forced[36].toFixed(2),
            fps: +(1000 * dts.length / el).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1),
            dropped: dts.reduce((x, d) => x + Math.max(0, Math.round(d / 16.67) - 1), 0) };
        }, { p: HOURS[hour], pose });
        out.runs.push({ rep, view: vname, hour, ...r });
        console.log(LABEL, 'rep', rep, vname.padEnd(14), hour.padEnd(5), JSON.stringify(r));
      }
    }
  }
} finally {
  if (OUTJ) fs.writeFileSync(OUTJ, JSON.stringify(out, null, 1));
  await browser.__done();
}
// summary
const sum = {};
for (const r of out.runs) { const k = r.view + '|' + r.hour; (sum[k] = sum[k] || []).push(r); }
console.log('\nSUMMARY', LABEL, '(min across reps; spread in brackets)');
for (const [k, rs] of Object.entries(sum)) {
  const f = rs.map(r => r.forcedMin), fm = rs.map(r => r.forcedMed), fp = rs.map(r => r.fps), dr = rs.map(r => r.dropped);
  console.log(k.padEnd(22), 'forced-frame min', Math.min(...f).toFixed(2), 'ms [' + f.join(', ') + ']', ' median-of-40 min', Math.min(...fm).toFixed(2), '[' + fm.join(', ') + ']',
    ' sweep fps max', Math.max(...fp), '[' + fp.join(', ') + ']', ' dropped min', Math.min(...dr), '[' + dr.join(', ') + ']');
}
