/**
 * v2-ground-phone.mjs - what the drawn ground near the camera (v2/ground-near.js) costs a phone: bytes fetched, JS heap, and the time from
 * a low camera to the drawn ground being on, at a phone viewport (390x844 @3, touch, so the app takes its phone path).
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-ground-phone.mjs "v2-ref-main|v2" [--reps 2]
 *
 * Each folder (an app copy beside v2/) gets a fresh page per rep, interleaved; the camera visits three low spots in turn (GDC lawn,
 * McCombs, Moffett). Reports the minimum over reps of each time, and the bytes and heap after the walk.
 */
import { chromium } from 'playwright-core';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const DIRS = String(process.argv[2] || 'v2').split('|');
const i = process.argv.indexOf('--reps'); const REPS = i < 0 ? 2 : +process.argv[i + 1];
const SPOTS = [['GDC lawn', 239.6, -44.2, 250.7], ['McCombs east', 200, 235, 60], ['Moffett court', 175, -280, 270]];
const browser = await launch(chromium, { args: HW_ARGS, maxMs: 1800000 });
const res = {};
for (let r = 0; r < REPS; r++) for (const dir of (r % 2 ? [...DIRS].reverse() : DIRS)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  let bytes = 0, files = 0;
  page.on('response', async (resp) => { if (/\/data\/ground\/near/.test(resp.url())) { try { bytes += (await resp.body()).length; files++; } catch (e) {} } });
  await page.goto(`${BASE.replace(/\/$/, '')}/${dir}/?intro=0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready && window.__v2groundNear, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  const bytesHigh = bytes;
  const times = [];
  for (const [name, x, z, az] of SPOTS) {
    const before = await page.evaluate(() => window.__v2groundNear.stats().rasters);
    const t0 = Date.now();
    await page.evaluate(([x, z, az]) => window.__v2.placeCamera({ target: [x, 0, z], distance: 30, polarDeg: 86.9, azimuthDeg: az }), [x, z, az]);
    let ok = false;
    while (Date.now() - t0 < 60000) {
      const s = await page.evaluate(() => { window.__v2.redraw(); return window.__v2groundNear.stats(); });
      if (s.on === 1 && s.rasters > before && !s.loading) { ok = true; break; }
      await page.waitForTimeout(50);
    }
    times.push([name, ok ? Date.now() - t0 : null]);
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const st = await page.evaluate(() => window.__v2groundNear.stats());
  (res[dir] ||= []).push({ times, bytes, files, bytesHigh, heap, phone: st.window ? st.window[2] : null, cells: st.cells, lastMs: st.lastMs });
  await ctx.close();
}
await browser.close();
for (const [dir, rs] of Object.entries(res)) {
  const t = SPOTS.map(([n], k) => `${n} ${Math.min(...rs.map((r) => r.times[k][1] ?? 1e9))} ms`).join(', ');
  const l = rs[rs.length - 1];
  console.log(`${dir}: ground near bytes before any low camera ${(l.bytesHigh / 1024).toFixed(0)} KB; after the walk ${(l.bytes / 1024).toFixed(0)} KB in ${l.files} files; ` +
    `JS heap after GC min ${(Math.min(...rs.map((r) => r.heap)) / 1048576).toFixed(1)} MB; low camera -> drawn ground on (min of ${rs.length}): ${t}; window ${l.phone} m, cells held ${l.cells ?? '-'}, last raster ${l.lastMs} ms`);
}
