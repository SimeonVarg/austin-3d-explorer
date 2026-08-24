/**
 * eyeshot.mjs — the walking ribbon FROM WALKING HEIGHT, with its own controls.
 *
 * WHY IT LIVES HERE AND NOT IN scripts/verify. `scripts/verify/` is not this
 * lane's file to write, and round 2 already lost a set of measuring scripts to
 * a session scratchpad ("the reason nobody would ever re-run them"). It sits
 * beside the frames it produced instead. To run it, copy it into
 * `scripts/verify/` — it imports `./chrome.mjs` and needs that directory's
 * `playwright-core`:
 *
 *   python scripts/serve.py 8812                         # from the repo root
 *   cp shots/walk/sidewalks/eyeshot.mjs scripts/verify/
 *   cd scripts/verify && VERIFY_URL=http://127.0.0.1:8812 node eyeshot.mjs <outdir>
 *
 * Write the frames to a scratch directory, not into this one (CLAUDE.md
 * rule 12) — only a frame a doc actually cites belongs in the repo.
 *
 * Three rounds of this lane's frames have been near-nadir. Nadir cannot see the
 * defect round 2 fixed: js/wayfind.js's own comment records that a coplanar
 * ribbon "appeared from altitude (1,064 px, up from 9) and was still invisible
 * at walking height". Whether a ribbon SITS on the pavement is a side-view
 * question, so this stands the camera on the route and looks along it.
 *
 * THREE FRAMES PER POSE, one camera, because a frame on its own proves nothing:
 *   <name>.png          this branch as it ships
 *   <name>-noroute.png  wayfindClear() — every pixel that differs from the
 *                       first frame IS the ribbon. Without this control a pale
 *                       strip on tan paving is an assertion, not a measurement.
 *   <name>-float.png    the same route with WAYFIND.routeBaseM = FLOAT_TEST_M,
 *                       i.e. what a ribbon that does NOT sit on the pavement
 *                       looks like from this exact camera. If this frame were
 *                       identical to the first, the pose would be blind to
 *                       height and the whole claim unmeasurable from it.
 *
 * The diff runs INSIDE the page (a 1280x800 RGBA buffer is 4.1 M numbers and
 * serialising it out of the browser three times per site took minutes).
 *
 * VERIFY_URL=http://127.0.0.1:8812 node eyeshot2.mjs <outdir> [tag]
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const TAG = process.argv[3] || '';
const VW = 1280, VH = 800;

// POSE AND CONTROL VALUES, all named (CLAUDE.md rule 11).
const EYE_PITCH = 78;         // degrees; the map's maxPitch is 88
const EYE_ZOOM = 20.0;
const LOOK_AHEAD_M = 28;      // map centre this far along the route from the
                              // stand point, so the camera sits ON the route
const SHOT_SETTLE_MS = 1500;
const FLOAT_TEST_M = 0.95;    // the deliberate float the control frame renders
const SHIP_BASE_M = 0.22;     // WAYFIND.routeBaseM as this branch ships it
// Tree crowns sit at exactly eye height over these malls and render slightly
// differently run to run. The question here is what the ribbon is lying on.
const HIDE_LAYERS = ['trees-canopy', 'trees-trunk'];
const RIBBON_LAYERS = ['wayfind-ribbon', 'wayfind-thread', 'wayfind-ghost', 'wayfind-column'];

const SITES = [
  { name: 'eye-mainmall', from: 'GRE', to: 'MAI', t: 0.30,
    note: 'the Main Mall — a pedestrian area round 2 turned from a flat plaza fill into a walk' },
  { name: 'eye-eastmall', from: 'PCL', to: 'JES', t: 0.30,
    note: 'the East Mall outside Jester' },
  { name: 'eye-speedway', from: 'PCL', to: 'RLP', t: 0.45,
    note: 'Speedway — an ordinary surveyed footway beside the brick mall' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const log = [];

  await page.goto(`${BASE}/index.html?intro=0&drift=0&walk=1`, { waitUntil: 'load' });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.waitForFunction(
    () => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded()
      && (!window.__intro || window.__intro.reason != null),
    null, { timeout: 180000 });
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 180000 });

  // the in-page frame store + differ
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
      // walk `m` metres along the line from the start
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

    const pose = async () => {
      await page.evaluate(([c, bearing, z, p]) => {
        window.__map.jumpTo({ center: c, zoom: z, pitch: p, bearing });
      }, [info.centre, info.bearing, EYE_ZOOM, EYE_PITCH]);
      await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
      await sleep(SHOT_SETTLE_MS);
    };

    await pose();
    await page.screenshot({ path: path.join(OUT, '_throwaway.png') });  // shoot twice, keep the second
    await sleep(SHOT_SETTLE_MS);

    const seen = await page.evaluate((layers) => {
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
    await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}.png`) });
    const dims = await page.evaluate(() => window.__snap('ship'));

    await page.evaluate(() => window.wayfindClear());
    await pose();
    await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}-noroute.png`) });
    await page.evaluate(() => window.__snap('none'));

    const floated = await page.evaluate(async ([s, f]) => {
      window.WAYFIND.routeBaseM = f;
      const r = await window.wayfindRoute(s.from, s.to);
      return !!(r && r.ok);
    }, [s, FLOAT_TEST_M]);
    await pose();
    await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}-float.png`) });
    await page.evaluate(() => window.__snap('float'));

    const ribbonPx = await page.evaluate(() => window.__diff('ship', 'none'));
    const floatPx = await page.evaluate(() => window.__diff('ship', 'float'));

    await page.evaluate(async ([s, base]) => {
      window.WAYFIND.routeBaseM = base;
      await window.wayfindRoute(s.from, s.to);
    }, [s, SHIP_BASE_M]);

    const px = dims[0] * dims[1];
    log.push(`${s.name}  ${s.from}>${s.to} ${Math.round(info.distM)} m route, ${Math.round(info.totalM)} m drawn  `
      + `cam=${JSON.stringify(seen.__cam)}  rasterised: ribbon ${seen['wayfind-ribbon']}, ghost ${seen['wayfind-ghost']}, thread ${seen['wayfind-thread']}  `
      + `| RIBBON OWNS ${ribbonPx} px (${(100 * ribbonPx / px).toFixed(2)} % of frame)  `
      + `| a ${FLOAT_TEST_M} m FLOAT MOVES ${floatPx} px (${(100 * floatPx / px).toFixed(2)} %)  floatOk=${floated}`);
    console.log(log[log.length - 1]);
  }

  for (const f of fs.readdirSync(OUT)) if (f.startsWith('_throwaway')) fs.unlinkSync(path.join(OUT, f));
  await browser.close();
  console.log('\n=== SUMMARY ===\n' + log.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
