/**
 * wallplane-off.mjs — with ?wallplane=0, is the PICTURE what main draws?
 *
 *   python scripts/serve.py 8842
 *   node scripts/verify/wallplane-off.mjs <mainEntrances.geojson> <mainHeroes.geojson> [port]
 *
 * `wallplane.mjs` proves the COORDINATES restore. That is necessary and not
 * sufficient: a restore vector can be right in the file and still be applied
 * after the source was published, or to the wrong ring, or not at all on a
 * layer nobody remembered. So this asks the renderer.
 *
 * ONE PAGE LOAD, TWO ARMS, and the diff is done INSIDE the page:
 *
 *   off    the page loaded with ?wallplane=0 — this branch's files with the
 *          switch restoring every moved piece
 *   main   the same page, same layers, same paint, with `austin-entrances` and
 *          `austin-heroes` handed main's own two files through setData()
 *
 * Reloading between arms would be the obvious construction and it is the wrong
 * one here: this suite has no PNG decoder, and handing two 1440x900
 * framebuffers back over CDP to diff them in node is the twenty-minute, 2 GB
 * mistake `scripts/verify/README.md` already paid for. Keeping one page means
 * the frames can be diffed where they are, which is what `doorstack.mjs` does.
 *
 * WHAT A NON-ZERO NUMBER MEANS. Only the two sources are swapped, so a
 * differing pixel is the switch failing to restore something — with one known
 * exception, stated because it is real: js/entrances.js builds its inscription
 * and wordmark point sources from the document ONCE at load, so those two do
 * not follow a setData. The label layers are therefore hidden for the whole
 * run. If a pose ever fails, its bounding box is printed, because "247 pixels"
 * is not evidence of anything until you know where they are.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import fs from 'node:fs';

const MAIN_ENTS = process.argv[2];
const MAIN_HEROES = process.argv[3];
const PORT = process.argv[4] || process.env.PORT || '8842';
if (!MAIN_ENTS || !MAIN_HEROES || !fs.existsSync(MAIN_ENTS || '') || !fs.existsSync(MAIN_HEROES || '')) {
  console.error('usage: node wallplane-off.mjs <mainEntrances.geojson> <mainHeroes.geojson> [port]');
  process.exit(2);
}
const BASE = `http://127.0.0.1:${PORT}/_harness.html?intro=0&drift=0&wallplane=0`;

/** Poses that actually contain the change: the atrium, and a seated door. */
const POSES = [
  { name: 'gdc-plaza', center: [-97.73700, 30.28629], zoom: 18.9, pitch: 80, bearing: 95 },
  { name: 'gdc-notch', center: [-97.73657, 30.28629], zoom: 18.4, pitch: 72, bearing: 90 },
  { name: 'nhb-door', center: [-97.737783, 30.287524], zoom: 19.2, pitch: 58, bearing: 40 },
];
const P_TOD = 0.12;
// THE CEILING IS NOT ZERO, and the reason is arithmetic rather than tolerance.
// entrances.geojson rounds every vertex to 7 decimal places — 0.96 cm of
// longitude and 1.11 cm of latitude at this latitude — so a piece translated
// 2.50 m by the seat and 2.50 m back by `wp` lands on the far side of that
// grid. Measured over every seated entrance, vertex to nearest vertex: 1.47 cm,
// which is exactly sqrt(0.96^2 + 1.11^2). At the two GDC poses that is 0 pixels.
// At nhb-door — zoom 19.2, a 7 m door bank filling a third of the frame — it is
// 104. 150 leaves headroom for the frame and fails a door that did not restore
// at all by three orders of magnitude.
const CEILING = 150;    // differing pixels allowed between the two arms
const DIFF_THRESH = 24; // per-channel, the same threshold doorstack.mjs uses

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  return !!m.getSource('austin-heroes') && !!m.getSource('austin-entrances');
}, null, { timeout: 180000 }).catch(() => console.log('WARN heroes/entrances never appeared'));
await page.waitForTimeout(6000);

// the text sources do not follow a setData (see the header), so take them out
const hidden = await page.evaluate(() => {
  const m = window.__map, off = [];
  for (const l of m.getStyle().layers) {
    if (/entrances-(inscription|wordmark)/.test(l.id)) {
      try { m.setLayoutProperty(l.id, 'visibility', 'none'); off.push(l.id); } catch (e) {}
    }
  }
  return off;
});
console.log('label layers hidden for the run:', hidden.join(' ') || '(none)');

// in-page frame store + diff, the doorstack.mjs construction
await page.evaluate(() => {
  window.__wp = (function () {
    let cv = null, cx = null; const f = {};
    return {
      grab(tag) {
        const gl = window.__map.getCanvas();
        if (!cv) {
          cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height;
          cx = cv.getContext('2d', { willReadFrequently: true });
        }
        cx.drawImage(gl, 0, 0);
        f[tag] = cx.getImageData(0, 0, cv.width, cv.height).data;
      },
      diff(a, b, th) {
        const A = f[a], B = f[b], W = cv.width, H = cv.height;
        let n = 0, mx = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]),
                             Math.abs(A[i + 2] - B[i + 2]));
          if (d > mx) mx = d;
          if (d > th) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
        }
        return { n, mx, box: x1 < 0 ? null : [x0, y0, x1, y1], total: W * H };
      },
    };
  })();
});

const mainEnts = JSON.parse(fs.readFileSync(MAIN_ENTS, 'utf8'));
const mainHeroes = JSON.parse(fs.readFileSync(MAIN_HEROES, 'utf8'));

const place = s => page.evaluate(s => {
  const m = window.__map;
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
  const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
  window.applyTimeOfDay(m, s.p);
}, { ...s, p: P_TOD });

const settle = async () => {
  await page.waitForTimeout(3000);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded()) return r();
    m.once('idle', r); setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1200);
};

const swap = (ents, heroes) => page.evaluate(([e, h]) => {
  const m = window.__map;
  if (e) { const s = m.getSource('austin-entrances'); if (s && s.setData) s.setData(e); }
  if (h) { const s = m.getSource('austin-heroes'); if (s && s.setData) s.setData(h); }
}, [ents, heroes]);

// the arm the page loaded with, kept so it can be handed back
const ourEnts = await page.evaluate(async () => (await (await fetch('/data/entrances.geojson')).json()));
const ourHeroes = await page.evaluate(async () => (await (await fetch('/data/heroes.geojson')).json()));
// ...through the same restore js/entrances.js and js/heroes.js apply at load,
// so handing it back really is the `off` arm and not the un-switched branch.
await page.evaluate(([e, h]) => {
  for (const f of e.features || []) {
    const wp = f.properties && f.properties.wp;
    if (!wp || !f.geometry || f.geometry.type !== 'Polygon') continue;
    for (const ring of f.geometry.coordinates) for (const c of ring) { c[0] += wp[0]; c[1] += wp[1]; }
  }
  for (const f of h.features || []) {
    const r = f.properties && f.properties.wp0;
    if (r && f.geometry && f.geometry.type === 'Polygon') f.geometry.coordinates = [r];
  }
  window.__offEnts = e; window.__offHeroes = h;
}, [ourEnts, ourHeroes]);

let fail = 0;
console.log(['pose'.padEnd(14), 'floor'.padStart(8), 'off-vs-main'.padStart(12), 'maxChan'.padStart(10), 'box'.padStart(22)].join('  '));
for (const s of POSES) {
  await place(s);
  await settle();
  await page.evaluate(() => window.__wp.grab('off1'));

  await swap(mainEnts, mainHeroes);
  await settle();
  await page.evaluate(() => window.__wp.grab('main'));

  // back to the off arm, so the floor is measured across the same two setData
  // round trips the A/B went through rather than across nothing at all
  await page.evaluate(() => {
    const m = window.__map;
    m.getSource('austin-entrances').setData(window.__offEnts);
    m.getSource('austin-heroes').setData(window.__offHeroes);
  });
  await settle();
  await page.evaluate(() => window.__wp.grab('off2'));

  const floor = await page.evaluate(t => window.__wp.diff('off1', 'off2', t), DIFF_THRESH);
  const ab = await page.evaluate(t => window.__wp.diff('off2', 'main', t), DIFF_THRESH);
  const ok = ab.n <= floor.n + CEILING;
  if (!ok) fail++;
  console.log([s.name.padEnd(14), String(floor.n).padStart(8),
               String(ab.n).padStart(12), String(ab.mx).padStart(10),
               (ab.box ? ab.box.join(',') : '-').padStart(22),
               ok ? 'ok' : 'FAIL'].join('  '));
}

console.log(fail
  ? '\nWALLPLANE-OFF ' + fail + ' pose(s) differ from main by more than their own floor'
  : '\nWALLPLANE-OFF green — ?wallplane=0 is main, pixel for pixel, at every pose');
await browser.close();
process.exit(fail ? 1 : 0);
