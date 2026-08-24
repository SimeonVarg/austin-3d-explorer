/**
 * kerbshot.mjs — the ribbon where the route runs BESIDE A STREET.
 *
 * Round 4's eye-level frames stood on the Main Mall, the East Mall and
 * Speedway: three places earlier rounds had already fixed. The one place the
 * ribbon demonstrably did NOT sit on the pavement had never been photographed —
 * `--walkaudit` measured 4.9 % of the twenty pairs' drawn length standing on a
 * `roadarea`, and js/wayfind.js's `routeBaseM` is 0.22 m because a walk stands
 * 0.22 m proud while a road is a flat fill at zero. So this stands the camera
 * exactly there.
 *
 *   python scripts/serve.py 8812                         # from the repo root
 *   cp shots/walk/sidewalks/kerbshot.mjs scripts/verify/
 *   cd scripts/verify && VERIFY_URL=http://127.0.0.1:8812 node kerbshot.mjs <outdir> [tag]
 *
 * Write frames to a scratch directory, not into this one (CLAUDE.md rule 12).
 *
 * THE POSES ARE DERIVED FROM THE ROUTER, not chosen by eye: each `t` is the
 * midpoint of that route's LONGEST contiguous run of ribbon standing on a
 * `roadarea`, measured offline against the ground file this round changes FROM.
 * The subject therefore cannot be off screen, and the same `t` against the same
 * `data/walk_graph.json` gives the same camera in the before run and the after
 * run — routing never reads `data/ground.geojson`, so only the paint moves.
 *
 * Two frames per site, plus one control on the after run:
 *   <name>-eye.png     pitch 78, standing on the route, looking along it —
 *                      the only angle that can see whether a ribbon SITS on
 *                      something (a coplanar pair is invisible edge-on).
 *   <name>-nadir.png   straight down, so the strip of pavement itself is
 *                      readable rather than foreshortened.
 *   <name>-float.png   the same camera with routeBaseM = FLOAT_TEST_M. If this
 *                      were identical to the eye frame the pose would be blind
 *                      to height and "it sits on the pavement" unmeasurable.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const TAG = process.argv[3] || '';
const VW = 1280, VH = 800;

// POSE AND CONTROL VALUES, all named (CLAUDE.md rule 11).
const EYE_PITCH = 78;          // degrees; the map's maxPitch is 88
const EYE_ZOOM = 20.0;
const NADIR_PITCH = 0;
const NADIR_ZOOM = 20.0;
const LOOK_AHEAD_M = 28;       // map centre this far along the route from the
                               // stand point, so the camera sits ON the route
const SHOT_SETTLE_MS = 1500;
const FLOAT_TEST_M = 0.95;
const SHIP_BASE_M = 0.22;      // WAYFIND.routeBaseM as this branch ships it
const DAY_P = 0.30;            // ?p — the app's own default opening hour, pinned
                               // so two runs are lit identically
const HIDE_LAYERS = ['trees-canopy', 'trees-trunk'];
const RIBBON_LAYERS = ['wayfind-ribbon', 'wayfind-thread', 'wayfind-ghost', 'wayfind-column'];

const SITES = [
  // t values from the offline pose pass; the run length is the number of
  // contiguous drawn metres that stood on a carriageway in the BEFORE file.
  { name: 'kerb-mezcal', from: 'MEZ', to: 'CAL', t: 0.600, run: 64,
    note: 'Inner Campus Drive — the exact case §5 of docs/walk-sidewalks.md '
        + 'predicted: a surveyed sidewalk whose slab the carriageway cut removed' },
  { name: 'kerb-greaf2', from: 'GRE', to: 'AF2', t: 0.935, run: 194,
    note: 'the longest single run of ribbon on asphalt in either fixture' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const log = [];

  // ?p PINS THE HOUR, and it is not optional for a before/after pair. The first
  // attempt at these frames left it out: the two runs were twelve minutes apart,
  // the sun moved, and the pixel diff came back 68.7 % with the difference
  // spread over every facade and the sky. Every earlier round's frames were shot
  // in one run, which is why this never bit before.
  await page.goto(`${BASE}/index.html?intro=0&drift=0&walk=1&p=${DAY_P}`,
                  { waitUntil: 'load' });
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
  }, HIDE_LAYERS);
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
      const seg = [];
      let total = 0;
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
      return { stand, centre, bearing, distM: r.distM, totalM: total, n: L.length };
    }, { ...s, ahead: LOOK_AHEAD_M });
    if (info.err) { log.push(`${s.name}: ${info.err}`); console.log(log[log.length - 1]); continue; }

    const pose = async (centre, zoom, pitch, bearing) => {
      await page.evaluate(([c, b, z, p]) => {
        window.__map.jumpTo({ center: c, zoom: z, pitch: p, bearing: b });
      }, [centre, bearing, zoom, pitch]);
      await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
      await sleep(SHOT_SETTLE_MS);
    };

    const cam = async () => page.evaluate((layers) => {
      const m = window.__map, out = {};
      let tot = 0;
      for (const L of layers) {
        try { const f = m.queryRenderedFeatures({ layers: [L] }); out[L] = f.length; tot += f.length; }
        catch (e) { out[L] = -1; }
      }
      const c = m.getCenter();
      out.__tot = tot;
      out.__cam = { lng: +c.lng.toFixed(6), lat: +c.lat.toFixed(6), z: +m.getZoom().toFixed(2),
                    pitch: +m.getPitch().toFixed(1), bearing: +m.getBearing().toFixed(1) };
      return out;
    }, RIBBON_LAYERS);

    // ---- eye level -------------------------------------------------------
    await pose(info.centre, EYE_ZOOM, EYE_PITCH, info.bearing);
    await page.screenshot({ path: path.join(OUT, '_throwaway.png') });   // shoot twice, keep the second
    await sleep(SHOT_SETTLE_MS);
    const seenEye = await cam();
    await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}-eye.png`) });
    const dims = await page.evaluate(() => window.__snap('eye'));

    // ---- the float control, on this same camera --------------------------
    await page.evaluate(async ([s, f]) => {
      window.WAYFIND.routeBaseM = f;
      await window.wayfindRoute(s.from, s.to);
    }, [s, FLOAT_TEST_M]);
    await pose(info.centre, EYE_ZOOM, EYE_PITCH, info.bearing);
    await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}-float.png`) });
    await page.evaluate(() => window.__snap('float'));
    const floatPx = await page.evaluate(() => window.__diff('eye', 'float'));
    await page.evaluate(async ([s, base]) => {
      window.WAYFIND.routeBaseM = base;
      await window.wayfindRoute(s.from, s.to);
    }, [s, SHIP_BASE_M]);

    // ---- nadir -----------------------------------------------------------
    await pose(info.stand, NADIR_ZOOM, NADIR_PITCH, info.bearing);
    await page.screenshot({ path: path.join(OUT, '_throwaway.png') });
    await sleep(SHOT_SETTLE_MS);
    const seenNad = await cam();
    await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}-nadir.png`) });

    const px = dims[0] * dims[1];
    log.push(`${s.name}  ${s.from}>${s.to} ${Math.round(info.distM)} m route, `
      + `${Math.round(info.totalM)} m drawn, ${s.run} m of it on asphalt BEFORE  `
      + `| eye cam=${JSON.stringify(seenEye.__cam)}  `
      + `| nadir cam=${JSON.stringify(seenNad.__cam)} ribbon features ${seenNad['wayfind-ribbon']}  `
      + `| a ${FLOAT_TEST_M} m FLOAT MOVES ${floatPx} px (${(100 * floatPx / px).toFixed(2)} % of frame)`);
    console.log(log[log.length - 1]);
  }

  for (const f of fs.readdirSync(OUT)) if (f.startsWith('_throwaway')) fs.unlinkSync(path.join(OUT, f));
  await browser.close();
  console.log('\n=== SUMMARY ===\n' + log.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
