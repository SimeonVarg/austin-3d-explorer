/**
 * moire-clip.mjs - frames for a BEFORE | AFTER moving picture of the moire fix. A picture tool: no verdict.
 *
 * Moire is judged in motion. One page load; for each view the camera travels STEP pixel(s) a frame for FRAMES frames and every
 * frame is drawn twice, the fix off (MoireFix.set('off'): main's picture) and on. Writes <out>/<view>.<off|on>.<nnn>.png; put them
 * side by side and encode them with any tool (see scripts/verify/README.md, "The moire bar").
 *
 *   VERIFY_URL=http://127.0.0.1:<port> node moire-clip.mjs --out <dir> [--views guad-street,campus-far] [--frames 90] [--step 1]
 *        [--size 960x600] [--msaa 0|1] [--q k=v,...]
 * Needs a real GPU to be worth watching (VERIFY_GL=hardware).
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const DAY = 0.2, NIGHT = 1.0;
const VIEWS = [   // the same cameras as moire-bar.mjs
  { name: 'campus-far',        p: DAY,   center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4, dir: [1, 0] },
  { name: 'west-mid',          p: DAY,   center: [-97.7445, 30.2880],   zoom: 16.6,  pitch: 72, bearing: 300,   dir: [1, 0] },
  { name: 'guad-street',       p: DAY,   center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356,   dir: [0, 1] },
  { name: 'downtown-far',      p: DAY,   center: [-97.7430, 30.2690],   zoom: 16.4,  pitch: 70, bearing: 20,    dir: [1, 0] },
  { name: 'campus-far-night',  p: NIGHT, center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4, dir: [1, 0] },
  { name: 'guad-street-night', p: NIGHT, center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356,   dir: [0, 1] },
];
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', process.env.VERIFY_OUT || null);
if (!OUT) { console.error('usage: moire-clip.mjs --out <dir> [--views a,b] [--frames 90] [--step 1] [--size WxH] [--msaa 0|1]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const [W, H] = opt('--size', '960x600').split('x').map(Number);
const FRAMES = +opt('--frames', '90'), STEP = +opt('--step', '1'), MSAA = opt('--msaa', '0') === '1';
const QS = ['intro=0', 'drift=0', 'namelabels=0', 'facadepace=0', 'timeofdaypace=0', 'moirefix=1', 'smooth=' + (MSAA ? 1 : 0)].concat((opt('--q', '') || '').split(',').filter(Boolean));
const list = (opt('--views', 'guad-street,campus-far')).split(',').map(n => VIEWS.find(v => v.name === n)).filter(Boolean);

const browser = await launch(chromium, { maxMs: +(opt('--max-min', '55')) * 60000 });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.addInitScript(cfg => { try { const K = 'austin3d.gfx.v1', cur = JSON.parse(localStorage.getItem(K) || '{}'); cur.msaa = cfg.msaa; cur.autoDetected = true; cur.autoExposure = false; localStorage.setItem(K, JSON.stringify(cur)); } catch (e) {} }, { msaa: MSAA });
await page.goto(`${BASE}/_harness.html?${QS.join('&')}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 420000, polling: 500 });   // the app is still booting when the style has loaded (see moire-bar.mjs)
await page.waitForFunction(() => { const A = window.slopesApartments; return !A || !!(A.count.done && A.group); }, null, { timeout: 420000, polling: 500 });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false;
  const m = window.__map; for (const id of m.getLayersOrder()) { const l = m.getLayer(id); if (l && l.type === 'symbol') m.setLayoutProperty(id, 'visibility', 'none'); } });
await page.evaluate(() => {
  const m = window.__map, sleep = ms => new Promise(r => setTimeout(r, ms));
  const quiet = () => { const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count, L = window.CityLighting && window.CityLighting.stats; return !(P && P.busy) && !(A && !A.done) && !(L && L.shadowProxyBuilding); };
  window.__settle = async extra => { if (extra) await sleep(extra); for (let k = 0; k < 2; k++) { const t = Date.now(); while (!quiet() && Date.now() - t < 120000) await sleep(100);
    await new Promise(r => { const to = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(to); r(); }); m.triggerRepaint(); }); await sleep(60); } };
  window.__cams = (v, n, step) => { m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }); if (window.applyTimeOfDay) window.applyTimeOfDay(m, v.p, true);
    const c0 = m.project(v.center), out = []; for (let f = 0; f < n; f++) { const c = m.unproject([c0.x + f * step * v.dir[0], c0.y + f * step * v.dir[1]]); out.push([c.lng, c.lat]); } return out; };
});
for (const v of list) {
  const cams = await page.evaluate(([v, n, s]) => window.__cams(v, n, s), [v, FRAMES, STEP]);
  await page.evaluate(() => window.__settle(1500));
  for (let f = 0; f < FRAMES; f++) {
    await page.evaluate(([v, c]) => { window.__map.jumpTo({ center: c, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }); return window.__settle(350); }, [v, cams[f]]);
    for (const arm of ['off', 'on']) {
      const url = await page.evaluate(async arm => { window.MoireFix.reset(); window.MoireFix.set(arm); await window.__settle(); return window.__map.getCanvas().toDataURL('image/png'); }, arm);
      fs.writeFileSync(path.join(OUT, `${v.name}.${arm}.${String(f).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    if (f % 15 === 0) console.error(`[clip] ${v.name} frame ${f}/${FRAMES}`);
  }
}
console.log(`frames in ${OUT}: ${list.map(v => v.name).join(', ')} x ${FRAMES} x off|on`);
await browser.__done();
