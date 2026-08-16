/**
 * doorpx.mjs — how many pixels does ONE door contribute at this pose?
 *
 * Same construction as shots/nb2 and shots/relocated: at every pose the
 * `entrances-*` layers are toggled off and on and the SAME box around the
 * door's own projected pixel is captured twice.  `doorPixels` is the count of
 * pixels in that box that differ, which is camera-independent and immune to
 * `queryRenderedFeatures` returning one feature for the whole screen at high
 * pitch.
 *
 * Written for QUEUE NB9 (eid 292 on DKR).  Lives in shots/ rather than
 * scripts/verify/ because a red-gates lane owns scripts/verify/ this round.
 *
 * Usage: PORT=8521 node shots/regraph/doorpx.mjs <outDir> <posesJson>
 */
import { chromium } from '../../scripts/verify/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '8521';
// ?drift=0 — the idle cinema creeps the time of day after 25 s of silence and
// a moving sun changes every pixel in the box.
const BASE = `http://127.0.0.1:${PORT}/index.html?intro=0&drift=0`;
const outDir = path.resolve(process.argv[2]);
const POSES = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=gl', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// THE LOAD RACE: entrances are fetched lazily. A frame taken before the source
// lands is a blank wall that reads exactly like a missing door, and that race
// invented 447 phantom pixels once. WAIT for LOADED, and say how long it took.
const t0 = Date.now();
await page.waitForFunction(() => {
  const m = window.__map, s = m.getSource('austin-entrances');
  return !!s && m.isSourceLoaded('austin-entrances');
}, null, { timeout: 150000 });
const waitMs = Date.now() - t0;
console.log(`austin-entrances LOADED after ${(waitMs / 1000).toFixed(1)} s`);

const M_LAT = 40030228.884 / 360;
const place = (s) => page.evaluate((s) => {
  const m = window.__map, rad = d => d * Math.PI / 180;
  const C = 40030228.884, ML = C / 360, mLon = lat => ML * Math.cos(rad(lat));
  const fov = m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58;
  const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(rad(fov) / 2);
  const [elng, elat] = s.eye, lead = s.alt * Math.tan(rad(s.pitch));
  const cLat = elat + lead * Math.cos(rad(s.bearing)) / ML;
  const cLng = elng + lead * Math.sin(rad(s.bearing)) / mLon(elat);
  const D = s.alt / Math.cos(rad(s.pitch));
  const z = Math.log2(C * Math.cos(rad(cLat)) * camPx / (512 * D));
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo({ center: [cLng, cLat], zoom: z, bearing: s.bearing, pitch: s.pitch });
  // Force ONE updateSky call at a fixed time so auto-exposure gain, which
  // persists across poses and only re-meters inside updateSky, is settled.
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(m, 0.30);
}, s);

const setEnt = (on) => page.evaluate((on) => {
  const m = window.__map;
  const ids = m.getStyle().layers.filter(l => l.id.startsWith('entrances-')).map(l => l.id);
  ids.forEach(id => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  return ids.length;
}, on);

const settle = async () => {
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r();
    m.once('idle', r); setTimeout(r, 3000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(700);
};

const R = 130;                       // half-size of the box around the door
const shot = async (clip) => Buffer.from(await page.screenshot({ clip }));

const rows = [];
for (const s of POSES) {
  await place(s);
  await page.waitForTimeout(900);
  await settle();
  const info = await page.evaluate((s) => {
    const m = window.__map, pt = m.project(s.door);
    let e = null; try { e = window.__fly.eye(); } catch (err) {}
    let src = -1; try { src = m.querySourceFeatures('austin-entrances').length; } catch (err) {}
    return { x: Math.round(pt.x), y: Math.round(pt.y), entSrc: src,
             eyeAlt: e ? +e.alt.toFixed(2) : null, zoom: +m.getZoom().toFixed(2) };
  }, s);
  const clip = { x: Math.max(0, Math.min(1440 - 2 * R, info.x - R)),
                 y: Math.max(0, Math.min(900 - 2 * R, info.y - R)),
                 width: 2 * R, height: 2 * R };

  // NOISE FLOOR FIRST. on1 -> on2 with nothing changed in between is what this
  // pose costs from repaint jitter alone; any door count below it is nothing.
  const nLayers = await setEnt(true);  await settle();
  const onBuf = await shot(clip);
  await settle();
  const on2Buf = await shot(clip);
  await setEnt(false);                 await settle();
  const offBuf = await shot(clip);
  await setEnt(true);                  await settle();

  // count differing pixels by decoding both PNGs through the page's own canvas
  const cmp = (a, b) => page.evaluate(async ([a, b]) => {
    const load = (d) => new Promise(res => {
      const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c1 = document.createElement('canvas'); c1.width = ia.width; c1.height = ia.height;
    const c2 = document.createElement('canvas'); c2.width = ib.width; c2.height = ib.height;
    c1.getContext('2d').drawImage(ia, 0, 0); c2.getContext('2d').drawImage(ib, 0, 0);
    const A = c1.getContext('2d').getImageData(0, 0, ia.width, ia.height).data;
    const B = c2.getContext('2d').getImageData(0, 0, ib.width, ib.height).data;
    let n = 0, over24 = 0, max = 0;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d > 0) n++;
      if (d > 24) over24++;
      if (d > max) max = d;
    }
    return { n, over24, max };
  }, [a, b]);

  const floor = await cmp(onBuf.toString('base64'), on2Buf.toString('base64'));
  const diff = await cmp(onBuf.toString('base64'), offBuf.toString('base64'));

  fs.writeFileSync(path.join(outDir, `${s.name}-on.png`), onBuf);
  fs.writeFileSync(path.join(outDir, `${s.name}-off.png`), offBuf);
  rows.push({ ...s, ...info, nLayers, floor, diff });
  fs.writeFileSync(path.join(outDir, '_doorpx.json'), JSON.stringify(rows, null, 1));
  const verdict = diff.over24 > Math.max(20, floor.over24 * 3) ? 'DOOR VISIBLE' : 'dark';
  console.log(`${s.name.padEnd(16)} eyeAlt=${String(info.eyeAlt).padStart(6)} entSrc=${String(info.entSrc).padStart(5)} doorPx=(${info.x},${info.y})  door over24=${String(diff.over24).padStart(6)}  FLOOR over24=${String(floor.over24).padStart(5)}  ${verdict}`);
}
await browser.close();
