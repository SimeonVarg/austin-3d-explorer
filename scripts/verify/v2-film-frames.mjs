/**
 * v2-film-frames.mjs - DRAW THE FRAMES OF THE OPENING FILM (v2/film.js). A tool, not a check.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-film-frames.mjs <out dir> [first frame] [last frame] [step]
 *   then: scripts/v2/film_encode.sh <out dir> <film dir> <where the files will be served from>
 *
 * What it does: for each film frame (60 a second over the flight's 12.6 s = 757 frames) it puts the camera at the flight's own
 * pose of that moment (the same poses, lengths and easings as v2/main.js: read from the page, not copied here), waits until
 * everything that view wants is loaded (tiles, far copies, the photograph on the ground) and the clean still is complete
 * (v2/rest.js: 16 shifted frames of 4 samples = 64 samples a pixel), and saves the page's picture as a PNG. The page is opened
 * with ?fade=0 (a tile is in or out, no half-faded tile is frozen into a frame) and with the names and controls hidden.
 *
 * The size is the film's: 3072 x 1440 at one canvas pixel per CSS pixel (v2/film.js "The lens": the height is the view's height,
 * the width is more than any usual window). About 2 s a frame on the owner's Mac: half an hour. It can be stopped and started
 * again: a frame that is already in <out dir> is not drawn again. Needs a real GPU (a software renderer would take a day).
 * Make the film again whenever the tile list or the far-copy list changes: the page refuses a film whose hash is not the city's.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
const [out, aS = '0', bS = '', stS = '1'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const VW = +(process.env.VW || 3072), VH = +(process.env.VH || 1440), FPS = +(process.env.FPS || 60);
const browser = await launch(chromium, { gl: 'hardware', maxMs: 9000000 });
const page = await (await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&steady=0&rest=1${process.env.Q || ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
const T = await page.evaluate(() => { const v = window.__v2, m = v.map, I = v.INTRO, w = (d) => ((d + 180) % 360 + 360) % 360 - 180, ll = (c) => ({ lng: c[0], lat: c[1] });
  v.skipIntro(); m.jumpTo(I.start); const f1 = m.pose();
  const t1 = { center: ll(I.crest.center), zoom: I.crest.zoom, pitch: I.crest.pitch, bearing: f1.bearing + w(I.crest.bearing - f1.bearing) };
  m.setPose({ center: [t1.center.lng, t1.center.lat], zoom: t1.zoom, pitch: t1.pitch, bearing: t1.bearing }); const f2 = m.pose();
  const t2 = { center: ll(I.end.center), zoom: I.end.zoom, pitch: I.end.pitch, bearing: f2.bearing + w(I.end.bearing - f2.bearing) };
  window.__film = { legs: [{ from: f1, to: t1, ms: I.leg1Ms, ease: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t) }, { from: f2, to: t2, ms: I.leg2Ms, ease: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) }] };
  return { ms: I.leg1Ms + I.leg2Ms, rest: !!v.rest(), steady: !!(v.steady && v.steady()), size: [v.renderer.domElement.width, v.renderer.domElement.height], fov: v.camera.fov }; });
const N = Math.round(T.ms * FPS / 1000), a = +aS, b = bS === '' ? N : +bS, st = +stS;
console.log(`film: ${T.ms} ms, ${N + 1} frames at ${FPS} a second; canvas ${T.size.join(' x ')}; fov ${T.fov}; rest ${T.rest}; steady ${T.steady}; frames ${a}..${b} step ${st}`);
const t00 = Date.now(); let made = 0, late = 0;
for (let i = a; i <= b; i += st) {
  const file = `${out}/f_${String(i).padStart(4, '0')}.png`; if (fs.existsSync(file)) continue;
  const t0 = Date.now();
  await page.evaluate((t) => { const F = window.__film, v = window.__v2; let L = F.legs[0], k = t / L.ms; if (t > L.ms) { L = F.legs[1]; k = Math.min(1, (t - F.legs[0].ms) / L.ms); }
    const e = L.ease(k), lerp = (p, q) => p + (q - p) * e;
    v.map.setPose({ center: [lerp(L.from.center.lng, L.to.center.lng), lerp(L.from.center.lat, L.to.center.lat)], zoom: lerp(L.from.zoom, L.to.zoom), pitch: lerp(L.from.pitch, L.to.pitch), bearing: lerp(L.from.bearing, L.to.bearing) });
    v.rest().reset(); }, i * 1000 / FPS);
  let calm = 0;
  while (calm < 2 && Date.now() - t0 < 180000) { const s = await page.evaluate(() => { const v = window.__v2, g = window.__v2ground ? window.__v2ground.stats() : { missing: 0, loading: 0, waitingUpload: 0 }, t = v.tiles(), r = v.rest();
      return v.map.tilesLoaded() && t.loading === 0 && !t.fading && (t.wanting || 0) === 0 && g.missing === 0 && g.loading === 0 && g.waitingUpload === 0 && !r.more() && r.count() >= 16; });
    calm = s ? calm + 1 : 0; await page.waitForTimeout(calm ? 90 : 60); }
  if (calm < 2) { late++; console.log(`frame ${i}: not settled in 180 s (saved as it is)`); }
  await page.screenshot({ path: file, type: 'png' }); made++;
  if (made <= 3 || made % 25 === 0) console.log(`frame ${i}: ${Date.now() - t0} ms; ${made} made in ${((Date.now() - t00) / 60000).toFixed(1)} min`);
}
console.log(`done: ${made} frames, ${late} not settled, ${((Date.now() - t00) / 60000).toFixed(1)} min`);
await browser.close();
