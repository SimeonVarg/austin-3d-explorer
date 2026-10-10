/**
 * downtown-shots.mjs — downtown from the same made-up cameras, BEFORE and AFTER
 * a change to the outer ring, in one browser.
 *
 * WHY ONE SCRIPT. A before/after pair from two checkouts photographs two
 * machines. Downtown is drawn from two files only (the outer tiles and their
 * facade palette), so the BEFORE side is this same checkout with those two
 * requests answered from another ref's copies: everything else on screen
 * (roads, trees, the campus, the sky, the code) is identical by construction.
 *
 *   BEFORE  data/tiles/outer.pmtiles + data/outer_tower_palette.json from
 *           DT_BEFORE (default: the public `main` branch on GitHub)
 *   AFTER   this checkout's own files
 *
 * The cameras are made up here (shots-downtown.json): a skyline, two aerials, a
 * straight-down plan, and street level on Congress Avenue and 6th Street. None
 * is fitted to a photograph.
 *
 * Each view is shot TWICE on each side and the second frame is kept
 * (scripts/verify/README.md). With --flicker (or DT_FLICKER=1) each side also takes a frame
 * with the camera turned 0.3 degrees and prints how much of the picture moved,
 * for the roofs the coplanar check lists (a z-fight shows as a change far
 * larger than a 0.3 degree turn can make).
 *
 * Usage:  node downtown-shots.mjs [shots-downtown.json] [--out DIR] [--flicker]
 *   --out / VERIFY_OUT where the pictures go (default scripts/verify/shots/downtown)
 *   DT_BEFORE=<url>    base URL of the BEFORE files, or `none` to shoot AFTER only
 *   DT_ONLY=a,b        only these view names
 * Never fails on a difference: it photographs. It fails only if the page breaks.
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the latter is '/C:/...' and joins to 'C:\\C:\\...'
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const outAt = ARGS.indexOf('--out');
const OUT = (outAt >= 0 ? ARGS.splice(outAt, 2)[1] : null) ||
  process.env.VERIFY_OUT || path.join(HERE, 'shots', 'downtown');
const BEFORE = process.env.DT_BEFORE ||
  'https://raw.githubusercontent.com/SimeonVarg/austin-3d-explorer/main/';
const ONLY = process.env.DT_ONLY ? new Set(process.env.DT_ONLY.split(',')) : null;
const flickAt = ARGS.indexOf('--flicker');
if (flickAt >= 0) ARGS.splice(flickAt, 1);
const FLICKER = flickAt >= 0 || process.env.DT_FLICKER === '1';
const SHOTS = JSON.parse(fs.readFileSync(ARGS[0] || path.join(HERE, 'shots-downtown.json'), 'utf8'));
const SWAPPED = ['data/tiles/outer.pmtiles', 'data/outer_tower_palette.json'];
// Walls painted at once and no name labels: the same switches the CI pictures use.
const QUERY = '?intro=0&drift=0&facadepace=0&timeofdaypace=0&labels=0';

fs.mkdirSync(OUT, { recursive: true });

async function beforeFiles() {
  const out = {};
  for (const f of SWAPPED) {
    const r = await fetch(BEFORE + f);
    if (!r.ok) throw new Error(`BEFORE file ${f}: HTTP ${r.status}`);
    out[f] = Buffer.from(await r.arrayBuffer());
    console.log(`before ${f}: ${out[f].length} bytes`);
  }
  return out;
}

async function shoot(side, swap) {
  // Eighteen views with their waits take longer than the launcher's default 5 minute
  // watchdog (the first laptop run was killed one view short of the end of BEFORE).
  const browser = await launch(chromium, { maxMs: Number(process.env.VERIFY_MAX_MS) || 1200000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  if (swap) {
    for (const f of SWAPPED) {
      // The tiles are read with HTTP range requests; answer each range from the buffer.
      await page.route('**/' + f + '*', route => {
        const buf = swap[f];
        const range = route.request().headers()['range'];
        const m = range && /bytes=(\d+)-(\d*)/.exec(range);
        if (!m) return route.fulfill({ status: 200, body: buf, headers: { 'accept-ranges': 'bytes' } });
        const a = Number(m[1]);
        const b = Math.min(m[2] ? Number(m[2]) : buf.length - 1, buf.length - 1);
        return route.fulfill({
          status: 206, body: buf.subarray(a, b + 1),
          headers: { 'content-range': `bytes ${a}-${b}/${buf.length}`, 'accept-ranges': 'bytes',
                     'content-type': 'application/octet-stream' },
        });
      });
    }
  }
  await page.goto(SERVER + '/_harness.html' + QUERY, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  const renderer = await page.evaluate(() => {
    try {
      const gl = window.__map.painter.context.gl;
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
    } catch (e) { return 'unknown'; }
  });
  console.log(`${side}: renderer ${renderer}`);

  const settle = async () => {
    await page.waitForTimeout(3500);
    await page.evaluate(() => new Promise(r => {
      const m = window.__map;
      if (m.loaded()) return r();
      m.once('idle', () => r());
      setTimeout(() => r(), 20000);
    }));
    const t0 = Date.now(); let quiet = 0;
    while (quiet < 3 && Date.now() - t0 < 60000) {
      const busy = await page.evaluate(() => {
        const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count;
        const S = window.CityLighting && window.CityLighting.stats;
        return !!(P && P.busy) || !!(A && !A.done) || !!(S && S.shadowProxyBuilding);
      });
      quiet = busy ? 0 : quiet + 1;
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(1200);
  };

  for (const s of SHOTS) {
    if (ONLY && !ONLY.has(s.name)) continue;
    await page.evaluate((s) => {
      const m = window.__map;
      if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
      const p = typeof s.p === 'number' ? s.p : 0.25;
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p);
      window.applyTimeOfDay(m, p);
    }, s);
    await settle();
    const file = path.join(OUT, `${s.name}-${side}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    const n = await page.evaluate(() => {
      try { return window.__map.queryRenderedFeatures({ layers: window.__map.getStyle().layers
        .filter(l => l.source === 'austin-outer' || /outer/.test(l.id)).map(l => l.id) }).length; }
      catch (e) { return -1; }
    });
    console.log(`WROTE ${file} (outer features on screen: ${n})`);
    if (FLICKER && s.flicker) {
      const a = await page.screenshot({ type: 'png' });
      await page.evaluate((s) => window.__map.jumpTo({ bearing: s.bearing + 0.3 }), s);
      await page.waitForTimeout(1500);
      const file2 = path.join(OUT, `${s.name}-${side}-turned.jpg`);
      await page.screenshot({ path: file2, type: 'jpeg', quality: 90 });
      fs.writeFileSync(path.join(OUT, `${s.name}-${side}-still.png`), a);
      console.log(`WROTE ${file2}`);
    }
  }
  await browser.close();
  if (errors.length) { console.log(errors.slice(0, 5).join('\n')); return false; }
  return true;
}

let ok = true;
if (BEFORE !== 'none') ok = await shoot('before', await beforeFiles()) && ok;
ok = await shoot('after', null) && ok;
console.log(ok ? 'PASS downtown-shots' : 'FAIL downtown-shots (page errors)');
process.exit(ok ? 0 : 1);
