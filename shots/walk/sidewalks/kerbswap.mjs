/**
 * kerbswap.mjs — before/after of `data/ground.geojson` IN ONE BROWSER SESSION.
 *
 * WHY THIS EXISTS, and it is a method correction to §14's method. Round 3 shot
 * its before/after pairs by swapping the file on disk between two runs and
 * reported a **0-pixel** noise floor. Round 5 tried the same thing and could not
 * reproduce that: three separate browser launches at the identical camera, with
 * `?p` PINNING the hour, still differ from each other by **12–22 % of the
 * frame**. Whatever round 3 had holding the renderer still, three launches
 * twenty minutes apart do not have it, and a 69 % before/after diff on top of a
 * 14 % floor is not evidence of anything.
 *
 * So swap the DATA instead of the process. `austin-ground` is a plain geojson
 * source; `setData()` on it repaints the whole ground band without touching the
 * camera, the sun, the tiles or the route. One page load, one light, two
 * frames — and the noise floor is measured rather than assumed, by re-setting
 * the SAME data and diffing that.
 *
 *   python scripts/serve.py 8812                        # from the repo root
 *   cp <the other ground file> data/_ground_alt.geojson  # served, never committed
 *   cp shots/walk/sidewalks/kerbswap.mjs scripts/verify/
 *   cd scripts/verify && VERIFY_URL=http://127.0.0.1:8812 node kerbswap.mjs <outdir>
 *
 * Frames land in a scratch directory (CLAUDE.md rule 12); only the ones a doc
 * cites get committed.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const VW = 1280, VH = 800;

// POSE AND CONTROL VALUES, all named (CLAUDE.md rule 11).
const EYE_PITCH = 78;
const EYE_ZOOM = 20.0;
const NADIR_PITCH = 0;
const NADIR_ZOOM = 20.0;
const LOOK_AHEAD_M = 28;
const SHOT_SETTLE_MS = 1800;
const DAY_P = 0.30;
const FLOAT_TEST_M = 0.95;
const SHIP_BASE_M = 0.22;
const GROUND_SRC = 'austin-ground';         // js/ground.js `SRC`
const SHIP_URL = 'data/ground.geojson';     // what the page loads
const ALT_URL = 'data/_ground_alt.geojson'; // the other file, served alongside
const HIDE_LAYERS = ['trees-canopy', 'trees-trunk'];

const SITES = [
  { name: 'kerb-greaf2', from: 'GRE', to: 'AF2', t: 0.935, run: 194,
    note: 'Robert Dedman Drive — the longest single run of ribbon standing on '
        + 'asphalt in either fixture' },
  { name: 'kerb-mezcal', from: 'MEZ', to: 'CAL', t: 0.600, run: 64,
    note: 'Inner Campus Drive — the case §5 predicted' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const log = [];

  await page.goto(`${BASE}/index.html?intro=0&drift=0&walk=1&p=${DAY_P}`, { waitUntil: 'load' });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.waitForFunction(
    () => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded()
      && (!window.__intro || window.__intro.reason != null),
    null, { timeout: 180000 });
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 180000 });

  await page.evaluate((ls) => {
    for (const id of ls) { try { window.__map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }
    window.__frames = {};
    window.__snap = (k) => {
      const c = window.__map.getCanvas();
      const g = document.createElement('canvas');
      g.width = c.width; g.height = c.height;
      g.getContext('2d').drawImage(c, 0, 0);
      window.__frames[k] = g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
      return [g.width, g.height];
    };
    window.__diff = (a, b) => {
      const A = window.__frames[a], B = window.__frames[b];
      if (!A || !B || A.length !== B.length) return -1;
      let n = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) n++;
      }
      return n;
    };
    window.__setGround = async (url) => {
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json();
      window.__map.getSource(window.__GSRC).setData(d);
      return (d.features || []).length;
    };
  }, HIDE_LAYERS);
  await page.evaluate((s) => { window.__GSRC = s; }, GROUND_SRC);
  await sleep(2500);

  for (const s of SITES) {
    const info = await page.evaluate(async (s) => {
      const r = await window.wayfindRoute(s.from, s.to);
      if (!r || !r.ok) return { err: 'no route' };
      const src = window.__map.getSource('wayfind-route');
      const data = (src.serialize && src.serialize().data) || src._data;
      const feat = (data.features || []).find(f => f.properties && f.properties.k === 'path');
      if (!feat) return { err: 'no path feature' };
      const L = feat.geometry.coordinates;
      const MPD_LAT = 111195, mpdLon = p => 111195 * Math.cos(p * Math.PI / 180);
      const seg = []; let total = 0;
      for (let i = 0; i < L.length - 1; i++) {
        const dx = (L[i + 1][0] - L[i][0]) * mpdLon(L[i][1]);
        const dy = (L[i + 1][1] - L[i][1]) * MPD_LAT;
        const d = Math.hypot(dx, dy); seg.push(d); total += d;
      }
      const at = (m) => {
        let acc = 0;
        for (let i = 0; i < seg.length; i++) {
          if (acc + seg[i] >= m) {
            const f = seg[i] > 0 ? (m - acc) / seg[i] : 0;
            return [L[i][0] + (L[i + 1][0] - L[i][0]) * f,
                    L[i][1] + (L[i + 1][1] - L[i][1]) * f];
          }
          acc += seg[i];
        }
        return L[L.length - 1];
      };
      const stand = at(total * s.t);
      const centre = at(Math.min(total, total * s.t + s.ahead));
      const bearing = Math.atan2((centre[0] - stand[0]) * Math.cos(stand[1] * Math.PI / 180),
                                 (centre[1] - stand[1])) * 180 / Math.PI;
      return { stand, centre, bearing, distM: r.distM, totalM: total };
    }, { ...s, ahead: LOOK_AHEAD_M });
    if (info.err) { log.push(`${s.name}: ${info.err}`); console.log(log[log.length - 1]); continue; }

    const pose = async (centre, zoom, pitch) => {
      await page.evaluate(([c, b, z, p]) => {
        window.__map.jumpTo({ center: c, zoom: z, pitch: p, bearing: b });
      }, [centre, info.bearing, zoom, pitch]);
      await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
      await sleep(SHOT_SETTLE_MS);
    };

    for (const [view, centre, zoom, pitch] of
         [['eye', info.centre, EYE_ZOOM, EYE_PITCH],
          ['nadir', info.stand, NADIR_ZOOM, NADIR_PITCH]]) {
      await pose(centre, zoom, pitch);
      await page.screenshot({ path: path.join(OUT, '_throwaway.png') });  // twice, keep the second
      await sleep(SHOT_SETTLE_MS);
      await page.screenshot({ path: path.join(OUT, `${s.name}-${view}-after.png`) });
      const dims = await page.evaluate(() => window.__snap('after'));

      // NOISE FLOOR FIRST: re-set the SAME data and shoot again. Whatever this
      // reports is what a repaint costs; the before/after number below is only
      // worth quoting against it.
      await page.evaluate((u) => window.__setGround(u), SHIP_URL);
      await sleep(SHOT_SETTLE_MS);
      await page.evaluate(() => window.__snap('again'));
      const floor = await page.evaluate(() => window.__diff('after', 'again'));

      const nAlt = await page.evaluate((u) => window.__setGround(u), ALT_URL);
      await sleep(SHOT_SETTLE_MS);
      await page.screenshot({ path: path.join(OUT, `${s.name}-${view}-before.png`) });
      await page.evaluate(() => window.__snap('before'));
      const changed = await page.evaluate(() => window.__diff('after', 'before'));

      await page.evaluate((u) => window.__setGround(u), SHIP_URL);
      await sleep(SHOT_SETTLE_MS);

      const px = dims[0] * dims[1];
      log.push(`${s.name}-${view}  ${s.from}>${s.to} ${Math.round(info.distM)} m  `
        + `alt file has ${nAlt} features  `
        + `| GROUND CHANGE ${changed} px (${(100 * changed / px).toFixed(2)} %)  `
        + `| noise floor ${floor} px (${(100 * floor / px).toFixed(3)} %)`);
      console.log(log[log.length - 1]);
    }

    // The height control, on the eye camera, off the shipping data. It snaps
    // under its OWN key: the loop above leaves `after` holding the NADIR frame,
    // and diffing a float test against that measures the camera move, not the
    // float. (It did, the first time this ran: 1,008,396 px, i.e. the whole
    // frame, which is what a wrong control looks like.)
    await pose(info.centre, EYE_ZOOM, EYE_PITCH);
    await page.evaluate(() => window.__snap('eyeship'));
    await page.evaluate(async ([s, f]) => {
      window.WAYFIND.routeBaseM = f;
      await window.wayfindRoute(s.from, s.to);
    }, [s, FLOAT_TEST_M]);
    await pose(info.centre, EYE_ZOOM, EYE_PITCH);
    await page.screenshot({ path: path.join(OUT, `${s.name}-eye-float.png`) });
    await page.evaluate(() => window.__snap('float'));
    const floatPx = await page.evaluate(() => window.__diff('eyeship', 'float'));
    await page.evaluate(async ([s, base]) => {
      window.WAYFIND.routeBaseM = base;
      await window.wayfindRoute(s.from, s.to);
    }, [s, SHIP_BASE_M]);
    log.push(`${s.name}-eye  a ${FLOAT_TEST_M} m FLOAT MOVES ${floatPx} px`);
    console.log(log[log.length - 1]);
  }

  for (const f of fs.readdirSync(OUT)) if (f.startsWith('_throwaway')) fs.unlinkSync(path.join(OUT, f));
  await browser.close();
  console.log('\n=== SUMMARY ===\n' + log.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
