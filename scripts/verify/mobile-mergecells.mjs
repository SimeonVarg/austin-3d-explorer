/**
 * mobile-mergecells.mjs — does merging same-tone wall cells change a pixel?
 *
 * js/slopes-apartments.js APTS.mergeCells (?mergecells=0 turns it off) draws a
 * run of same-tone wall cells as one quad instead of one quad per cell. The
 * claim is "same pixels, fewer triangles". A two-page-load diff cannot test
 * that here: a CONTROL of the same code loaded twice moved 99.8% of a frame
 * (HANDOFF "Sep 16 2026"). So this toggles the flag INSIDE ONE PAGE and
 * rebuilds only the apartments, shooting every pose three times:
 *
 *     A  merge on      B  merge off      A2  merge on again (the control)
 *
 * diff(A, A2) is the noise floor of this instrument; diff(A, B) is the change.
 * The claim holds when the change is no bigger than the control.
 *
 *   VERIFY_URL=http://127.0.0.1:8601 node mobile-mergecells.mjs [--out DIR] [--arms phone,desktop]
 *
 * Arms: `phone` = ?lite=1 (the phone profile at any viewport: performance
 * preset, so NO window reveals — panes sit flush in the wall plane, where a
 * T-junction between a merged pier and a window cell would show), `desktop` =
 * ?lite=0 (balanced, reveals on). Day (p=0) and night (p=1) at each pose.
 * SwiftShader (deterministic), 640x640 at DPR 1. Exit 0 = change <= control
 * everywhere (+ a small tolerance), 1 otherwise.
 *
 * RESULT 2026-09-19 (docs/mobile-real-buildings.md): the phone arm FAILED —
 * merged runs leave single-pixel sparkles (T-junction cracks) in 21 Rio's dark
 * window bands, absent with ?mergecells=0. The change was left out.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import { diffPNG } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg('--out', path.join(os.tmpdir(), 'mobile-mergecells'));
const ARMS = arg('--arms', 'phone,desktop').split(',');
const NAMES = (arg('--buildings', 'The Standard,The Otis Hotel,Moody Center,21 Rio,Icon,Villas on 24th,Moontower')).split(',');
const TODS = [['day', 0], ['night', 1]];
const TOL = 2;             // per-channel tolerance for "a differing pixel"
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function poseFor(name) {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments/index.json'), 'utf8'));
  for (const f of idx.buildings) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments', f), 'utf8'));
    if (d.name !== name) continue;
    const ring = d.footprint.ring || (d.footprint.rings && d.footprint.rings[0]) || d.footprint;
    let x = 0, y = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const [lng, lat] of ring) { x += lng; y += lat; minx = Math.min(minx, lng); maxx = Math.max(maxx, lng); miny = Math.min(miny, lat); maxy = Math.max(maxy, lat); }
    x /= ring.length; y /= ring.length;
    const k = Math.cos(y * Math.PI / 180);
    const ext = Math.max((maxx - minx) * 111320 * k, (maxy - miny) * 110540);
    const fl = d.levels && d.levels.floors;
    const h = (d.levels && (d.levels.top || d.levels.roof)) || (fl ? fl[fl.length - 1] : 30);
    const mpp = Math.max(ext, h * 1.2) * 1.4 / 640;
    return { center: [x, y], zoom: Math.min(19.4, Math.log2(156543.03 * k / mpp)), pitch: 58, bearing: 25 };
  }
  throw new Error('no building ' + name);
}
const POSES = NAMES.map(n => [n, poseFor(n)]);

const browser = await launch(chromium, { maxMs: 3600000 });
const rows = [];
for (const arm of ARMS) {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  const flag = arm === 'phone' ? 'lite=1' : 'lite=0';
  await page.goto(`${BASE}/index.html?drift=0&intro=0&${flag}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()).catch(() => {});
  await page.waitForFunction(() => window.__intro && window.__intro.reason, null, { timeout: 600000, polling: 500 });
  // On a slow machine a DESKTOP load passes app.js's 90 s authored ceiling and
  // turns the authored buildings off for the visit (the phone keeps them,
  // js/mobile.js LITE.lateAuthored). This instrument needs them: turn them back on.
  await page.evaluate(() => { if (!window.APARTMENTS.on) { window.APARTMENTS.on = true; window.applySlopesApartments(window.__map); } });
  await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.group && window.slopesApartments.readyToReveal(), null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => { if (window.GFX) window.GFX.autoExposure = false; if (window.applyGraphics) window.applyGraphics(); });
  const info = await page.evaluate(() => ({ preset: window.GFX.preset, merge: window.APARTMENTS.mergeCells, reveals: window.APARTMENTS.reveals }));
  console.log(`\n=== arm ${arm}: preset=${info.preset} mergeCells=${info.merge}`);
  if (info.merge === undefined) { console.log('APARTMENTS.mergeCells is not defined in this build — nothing to compare.'); process.exit(2); }

  const tri = {};
  for (const [tag, merge] of [['A', true], ['B', false], ['A2', true]]) {
    if (tag !== 'A') {
      await page.evaluate(m => { window.APARTMENTS.mergeCells = m; window.slopesApartments.rebuild(); }, merge);
      await sleep(1500);
      await page.waitForFunction(() => window.slopesApartments.group && window.slopesApartments.readyToReveal(), null, { timeout: 600000, polling: 500 });
    }
    tri[tag] = await page.evaluate(() => ({ apts: window.slopesApartments.count.triangles, cells: window.slopesApartments.count.cells }));
    console.log(`${tag} (merge ${merge}):`, JSON.stringify(tri[tag]));
    for (const [name, p] of POSES) {
      for (const [tn, tp] of TODS) {
        await page.evaluate(([o, t]) => { window.__map.jumpTo(o); window.applyTimeOfDay(window.__map, t, true); }, [p, tp]);
        await page.evaluate(() => new Promise(r => { const m = window.__map; const t = setTimeout(r, 12000); m.once('idle', () => { clearTimeout(t); r(); }); }));
        await sleep(1500);
        const f = path.join(OUT, `${arm}-${name.replace(/\W+/g, '')}-${tn}-${tag}.png`);
        await page.screenshot({ path: f });
        await sleep(800);
        await page.screenshot({ path: f });          // twice, trust the second
      }
    }
  }
  for (const [name] of POSES) for (const [tn] of TODS) {
    const f = t => path.join(OUT, `${arm}-${name.replace(/\W+/g, '')}-${tn}-${t}.png`);
    const ctrl = diffPNG(f('A'), f('A2'), TOL), chg = diffPNG(f('A'), f('B'), TOL);
    rows.push({ arm, name, tod: tn, ctrl: ctrl.pixels, ctrlMax: ctrl.maxChannelDiff, chg: chg.pixels, chgMax: chg.maxChannelDiff, bbox: chg.bbox });
  }
  rows.push({ arm, tri });
  if (errs.length) console.log('page errors:', errs.slice(0, 4).join(' | '));
  await page.close();
}
browser.__done();

let bad = 0;
console.log('\narm      building          tod    control px (max)   merge-off px (max)');
for (const r of rows) {
  if (r.tri) { console.log(`${r.arm}: apartments triangles merge on ${r.tri.A.apts}, off ${r.tri.B.apts}, on again ${r.tri.A2.apts}; cells ${r.tri.A.cells} / ${r.tri.B.cells}`); continue; }
  // "no visible change beyond noise": the change may not exceed the control by
  // more than 0.05% of the frame (205 px at 640x640).
  const ok = r.chg <= r.ctrl + 205;
  if (!ok) bad++;
  console.log(`${ok ? '  ' : '!!'} ${r.arm.padEnd(8)} ${r.name.padEnd(16)} ${r.tod.padEnd(6)} ${String(r.ctrl).padStart(8)} (${String(r.ctrlMax).padStart(3)})     ${String(r.chg).padStart(8)} (${String(r.chgMax).padStart(3)})  ${r.bbox ? JSON.stringify(r.bbox) : ''}`);
}
fs.writeFileSync(path.join(OUT, 'mergecells.json'), JSON.stringify(rows, null, 1));
console.log(bad ? `\nFAIL: ${bad} frame(s) changed beyond the control` : '\nPASS: merging cells changes nothing beyond the control');
process.exit(bad ? 1 : 0);
