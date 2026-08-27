/**
 * plazawalk.mjs — photograph a walking route, so a change to the walking graph
 * can be LOOKED at instead of argued about (CLAUDE.md rule 3).
 *
 * It drives the real index.html at `?walk=1`, asks `window.wayfindRoute()` for
 * a named pair, reads the ribbon geometry back off the `wayfind-route` source,
 * poses the camera near-nadir over the union of the routes' bounding boxes, and
 * screenshots. It prints the route distance and HOW MANY RIBBON POLYGONS THE
 * RENDERER ACTUALLY RASTERISED in that viewport — because a frame with a route
 * pill in it and no ribbon on the ground has happened here before, and a
 * screenshot alone cannot tell you which one you got
 * (docs/walk-sidewalks.md §4).
 *
 * FOR A BEFORE/AFTER, run it twice around a re-bake and pass a different
 * --label each time — same camera, same everything, only data/walk_graph.json
 * swapped underneath, which is the way docs/walk-sidewalks.md §4 took its own
 * pairs. The camera pose for each pair is written to poses.json on the first
 * run and READ BACK on the second, so the two frames cannot drift apart by a
 * metre of altitude; the second run also prints the pose it used.
 *
 * Usage:
 *   python scripts/serve.py 8825                       # from the repo root
 *   VERIFY_URL=http://127.0.0.1:8825 node plazawalk.mjs OUTDIR --label before
 *   CHORDS=0 python scripts/bake_walk.py
 *   VERIFY_URL=http://127.0.0.1:8825 node plazawalk.mjs OUTDIR --label after
 *
 * A pair is FROM-TO, e.g. `PCL-UNB`. With none given it uses the three the
 * South Mall and the East Mall actually sit on.
 *
 * Exit codes: 0 frames written, 1 a route failed or a frame had no ribbon in
 * it, 2 bad arguments.
 */
import { chromium } from 'playwright-core';
import { launch, BASE as DEFAULT_BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const BASE = process.env.VERIFY_URL || DEFAULT_BASE;
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const LABEL = opt('--label', 'walk');
const BOX = opt('--box', null);          // "w,s,e,n" — force the camera frame
const NO_TREES = argv.includes('--no-trees');
const NO_CARD = argv.includes('--no-card');
// DEBUG ONLY, and it says so in the filename. scripts/verify/README.md: "To
// test WHERE something is, paint it magenta and take one render." A magenta
// frame is evidence about position, never about how the app looks.
const MAGENTA = argv.includes('--magenta');
const TAKEN = new Set(['--label', '--box']);
const rest = argv.filter((a, i) => !a.startsWith('--') && !TAKEN.has(argv[i - 1]));
const OUT = rest[0];
if (!OUT) { console.error('usage: node plazawalk.mjs OUTDIR [--label NAME] [FROM-TO ...]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

/** The default pairs. Each one crosses a mapped pedestrian area, which is the
 *  whole point — a pair that never touches a plaza cannot show this change. */
const DEFAULT_PAIRS = ['PCL-UNB', 'GRE-MAI', 'WAG-MEZ'];
const PAIRS = (rest.slice(1).length ? rest.slice(1) : DEFAULT_PAIRS)
  .map(s => { const [from, to] = s.split('-'); return { from, to, id: s.toLowerCase() }; });

/** Near-nadir on purpose: the first attempt at frames like these stood at 20 m
 *  with 74 degrees of pitch, photographed tree trunks, and contained no ribbon
 *  at all (docs/walk-sidewalks.md §9). */
const PITCH_DEG = Number(process.env.PLAZAWALK_PITCH || 12);
const BEARING_DEG = 0;
const PAD_FRAC = 0.18;     // padding round the route bbox, as a share of it
const SETTLE_MS = 4000;    // data-driven paint does not land in the call's frame

const URL = `${BASE}/index.html?walk=1&drift=0&intro=0`;
const browser = await launch(chromium, { maxMs: 900000 });
let bad = 0;

async function ready(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  // Correctness, not speed: the probe rewrites every graphics setting ~11 s in.
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
  await page.waitForFunction(() => typeof window.wayfindRoute === 'function', null, { timeout: 60000 });
  if (NO_TREES) {
    // The canopy is real and it is also opaque from above. Hiding it is how
    // docs/walk-sidewalks.md §9 photographed the malls; the `-city` frame with
    // the trees left in is what a person actually sees, and both are taken.
    const hidden = await page.evaluate(() => {
      const m = window.__map;
      const ids = m.getLayersOrder ? m.getLayersOrder() : m.getStyle().layers.map(l => l.id);
      const t = ids.filter(id => /tree|canopy|cnp|foliage/i.test(id));
      t.forEach(id => { try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} });
      return t.length;
    });
    console.log(`  trees hidden: ${hidden} layer(s)`);
  }
  if (MAGENTA) {
    await page.evaluate(() => {
      const m = window.__map;
      const ids = m.getLayersOrder ? m.getLayersOrder() : m.getStyle().layers.map(l => l.id);
      for (const id of ids.filter(i => /^wayfind-/.test(i))) {
        const ly = m.getLayer(id); if (!ly) continue;
        try {
          if (ly.type === 'fill-extrusion') {
            m.setPaintProperty(id, 'fill-extrusion-color', '#ff00ff');
            m.setPaintProperty(id, 'fill-extrusion-opacity', 1);
            m.setPaintProperty(id, 'fill-extrusion-height', 6);
          } else if (ly.type === 'line') {
            m.setPaintProperty(id, 'line-color', '#ff00ff');
            m.setPaintProperty(id, 'line-width', 6);
            m.setPaintProperty(id, 'line-opacity', 1);
          } else if (ly.type === 'fill') {
            m.setPaintProperty(id, 'fill-color', '#ff00ff');
            m.setPaintProperty(id, 'fill-opacity', 1);
          }
        } catch (e) {}
      }
    });
  }
  if (NO_CARD) {
    await page.addStyleTag({ content: '#wf-sheet,#wf-card,.wf-sheet{opacity:0 !important}' });
  }
}

/** Ask the page for a route and hand back its drawn geometry. */
async function routeOf(page, p) {
  return page.evaluate(async ([f, t]) => {
    const r = await window.wayfindRoute(f, t, {});
    if (!r || !r.ok) return { ok: false, why: r ? r.why : 'null' };
    // The router hands back its own bbox and vertex count — no need to dig the
    // geometry out of a private source, and no chance of framing a stale one.
    return { ok: true, distM: r.distM, bbox: r.bbox, vertices: r.vertices };
  }, [p.from, p.to]);
}

/** Frame the camera on a lon/lat bbox, near-nadir. */
async function poseTo(page, bbox) {
  await page.evaluate(([b, pitch, bearing, pad]) => {
    const dx = (b[2] - b[0]) * pad, dy = (b[3] - b[1]) * pad;
    window.__map.fitBounds([[b[0] - dx, b[1] - dy], [b[2] + dx, b[3] + dy]],
      { pitch, bearing, duration: 0, padding: 24 });
  }, [bbox, PITCH_DEG, BEARING_DEG, PAD_FRAC]);
  await page.waitForTimeout(600);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded() && !m.isMoving()) return r();
    m.once('idle', r);
  }));
}

/** How many ribbon polygons the renderer actually rasterised in this viewport.
 *  A frame that reports zero is not evidence of anything. */
async function ribbonCount(page) {
  return page.evaluate(() => {
    const ids = window.__map.getLayersOrder
      ? window.__map.getLayersOrder() : window.__map.getStyle().layers.map(l => l.id);
    const wf = ids.filter(id => /^wayfind-/.test(id));
    let n = 0;
    // The RASTERISED geometry, not the source's — this is what is on screen,
    // and it is the only reading that can tell a drawn route from a computed
    // one. The three wayfind sources hold their data privately in MapLibre 5;
    // reading `_data` off them came back empty and looked exactly like
    // "the route is missing", which it was not.
    const pts = [];
    for (const id of wf) {
      try {
        const fs2 = window.__map.queryRenderedFeatures({ layers: [id] });
        n += fs2.length;
        for (const f of fs2) {
          const g = f.geometry; if (!g) continue;
          const eat = c => { if (typeof c[0] === 'number') pts.push([+c[0].toFixed(6), +c[1].toFixed(6)]); else c.forEach(eat); };
          eat(g.coordinates);
        }
      } catch (e) {}
    }
    return { layers: wf.length, features: n, pts };
  });
}

async function arm(label, poses) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await ready(page);
  const out = [];
  for (const p of PAIRS) {
    const r = await routeOf(page, p);
    if (!r.ok) { console.error(`  ${p.id}: route FAILED (${r.why})`); bad++; out.push(null); continue; }
    const bb = r.bbox;
    const flat = Array.isArray(bb) && bb.length === 4 && typeof bb[0] === 'number'
      ? bb : (Array.isArray(bb) && bb.length === 2 ? [bb[0][0], bb[0][1], bb[1][0], bb[1][1]] : null);
    if (!flat || !flat.every(Number.isFinite)) {
      console.error(`  ${p.id}: the router returned no usable bbox (${JSON.stringify(bb)})`);
      bad++; continue;
    }
    const box = BOX ? BOX.split(',').map(Number)
      : (poses[p.id] || [Math.min(flat[0], flat[2]), Math.min(flat[1], flat[3]),
                         Math.max(flat[0], flat[2]), Math.max(flat[1], flat[3])]);
    poses[p.id] = box;
    await poseTo(page, box);
    await page.waitForTimeout(SETTLE_MS);
    await page.evaluate(() => window.__map.triggerRepaint && window.__map.triggerRepaint());
    // Screenshot twice, keep the second (scripts/verify/README.md).
    await page.screenshot({ path: path.join(OUT, `_throwaway.png`) });
    const file = path.join(OUT, `${p.id}-${label}${MAGENTA ? '-magenta' : ''}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    const rc = await ribbonCount(page);
    if (!rc.features) { console.error(`  ${p.id} [${label}]: NO ribbon rasterised in the frame`); bad++; }
    console.log(`  ${p.id} [${label}]  ${r.distM.toFixed(0)} m  ${r.vertices} vertices   ` +
      `ribbon layers ${rc.layers}, features ${rc.features}   ${path.basename(file)}`);
    out.push({ id: p.id, label, distM: r.distM, ribbon: rc.features, file, box, pts: rc.pts });
  }
  if (errs.length) { console.error(`  [${label}] ${errs.length} page error(s): ${errs[0]}`); bad++; }
  await page.close();
  return out;
}

console.log(`plazawalk — ${BASE}  label=${LABEL}`);
const POSEFILE = path.join(OUT, 'poses.json');
let poses = {};
try { poses = JSON.parse(fs.readFileSync(POSEFILE, 'utf8')); } catch (e) {}
const reused = Object.keys(poses).length;
if (reused) console.log(`  reusing ${reused} camera pose(s) from ${path.basename(POSEFILE)}`);
const rows = await arm(LABEL, poses);
fs.writeFileSync(POSEFILE, JSON.stringify(poses, null, 1));
fs.writeFileSync(path.join(OUT, `routes-${LABEL}.json`), JSON.stringify(rows, null, 1));
try { fs.unlinkSync(path.join(OUT, '_throwaway.png')); } catch (e) {}
browser.__done();
console.log(bad ? `FAIL — ${bad} problem(s)` : 'PASS');
process.exit(bad ? 1 : 0);
