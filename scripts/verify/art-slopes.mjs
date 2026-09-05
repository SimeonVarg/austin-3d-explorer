/**
 * art-slopes.mjs — the gate for js/slopes-art.js.
 *
 * WHAT IT MEASURES, at one pose per artwork, on hardware:
 *
 *   built       the generator produced BOTH pieces, with the counts the data
 *               files' own sources publish — 70 hulls (Landmarks: "70 aluminum
 *               canoes and small boats") and 8 towers on a ring of 108 block
 *               fingers, in a group of its own that is drawing triangles.
 *   filter      while it draws, the two pieces' `artpart` slabs are filtered
 *               out of js/props.js's own layer BY NAME, and no other piece is.
 *   still       one settled page shot twice at a pose is the same frame, so
 *               every diff below is a real difference and not a settle race.
 *   on != off   the mesh is actually drawing the artwork: the frame changes
 *               when ART3D.on goes false.
 *   off = main  ART3D.on = false restores the filter and removes the group,
 *               and the runtime-off frame is the ?art3d=0 frame; with
 *               --against, the ?art3d=0 frame is the frame of a tree that
 *               never had this generator in it — so with the switch off the
 *               picture is what the rest of the branch draws, which at these
 *               two poses is what main draws plus other lanes' work.
 *
 * WHY --against IS NOT POINTED AT MAIN, and this cost a run to learn. It was,
 * and it reported 277,268 and 147,548 differing pixels. The control that keeps
 * such a number honest — a SECOND load of the branch's own ?art3d=0 page — came
 * back 0 and 0, so the difference was real, not settle noise, and looking at it
 * said whose: every differing pixel was GDC's atrium and doors and the kerb
 * under the sculpture, i.e. another lane's commits on the same branch (see
 * de03391, 8ec80d7, f30bfc8). Both of this gate's poses stand a few metres from
 * that work. A switch line has to vary ONE thing, so the archive is the branch
 * with this generator taken out of it.
 *
 * THE POSES. Both pieces are small — a 15 m sculpture and a 4.3 m ring — and
 * js/props.js does not draw art at all below zoom 15.5, so a cruise pose is
 * worthless here. Each pose is computed, not guessed: metres per pixel at this
 * latitude is 40075017*cos(30.287)/(512*2^z) = 67522/2^z, so the zoom that puts
 * an object of height h at `want` pixels is log2(67522*want/h). (A first
 * attempt used a camera-distance relation instead and put every pose four zoom
 * levels too close; the frames were pavement. Quote the arithmetic with the
 * number.)
 *
 * ONE HEADLESS CHROME AT A TIME, on hardware, served by scripts/serve.py. The
 * default backend for this suite is SwiftShader for determinism, but nothing
 * here asserts an exact hex — every assertion is a count, a filter or a
 * frame-to-frame diff of two pages under the same renderer — so hardware is
 * both safe and about fifty times faster. See scripts/verify/chrome.mjs.
 *
 * Usage
 *   python scripts/serve.py 8842
 *   VERIFY_URL=http://127.0.0.1:8842 node scripts/verify/art-slopes.mjs
 *   ... --shots DIR          write every frame it diffs
 *   ... --against URL        a second server on THIS BRANCH WITHOUT THIS
 *                            GENERATOR — not on main. Make it with
 *                              git archive HEAD | tar -x -C DIR
 *                              rm -rf DIR/data/art3d && : > DIR/js/slopes-art.js
 *                              python scripts/serve.py 8842 DIR
 *                            (serve.py takes the root as its second argument;
 *                            without it, it serves the repo it lives in and
 *                            you are comparing the branch against itself. That
 *                            happened on the first run here and the archive
 *                            answered 200 for a file it does not contain.)
 *   ... --break              sabotage the generator; the named lines must go red
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import { decodePNG, diffPNG } from './lib/png.mjs';

/**
 * Differing pixels inside one rectangle. The --against line needs it because
 * these poses stand six metres from a facade: at zoom 21 the facade atlas'
 * documented two-state residue lights up every mullion in the frame, and a
 * whole-frame count there is a measure of the pattern's sub-pixel phase, not
 * of this switch. The rect is the ARTWORK's own screen box plus a margin, read
 * off slopes.project(), so the line asks about the pixels this generator is
 * responsible for. The whole-frame number and a same-page CONTROL are printed
 * beside it, which is what keeps that honest.
 */
function diffRect(a, b, r) {
  const A = decodePNG(a), B = decodePNG(b);
  if (A.width !== B.width || A.height !== B.height) throw new Error('size mismatch');
  const x0 = Math.max(0, r[0] | 0), y0 = Math.max(0, r[1] | 0);
  const x1 = Math.min(A.width, r[2] | 0), y1 = Math.min(A.height, r[3] | 0);
  let n = 0, max = 0, tot = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * A.width + x) * A.bpp, j = (y * B.width + x) * B.bpp;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i + c] - B.data[j + c]));
    if (d > 0) n++;
    if (d > max) max = d;
    tot++;
  }
  return { pixels: n, total: tot, maxChannelDiff: max };
}

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const SHOTS = arg('--shots');
const AGAINST = arg('--against');
const BREAK = argv.includes('--break');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const W = 1200, H = 900;
const LAYER = 'props-artpart';
const NAMES = ['Monochrome for Austin', 'Circle with Towers'];

// Ground scale at this latitude: metres per pixel = 67522 / 2^z.
const MPP0 = 67522;
const zoomFor = (h, want) => Math.min(21.9, Math.log2(MPP0 * want / h));

// Where the two pieces' own slabs sit in data/art.geojson — the mesh is placed
// on those, not on the published GPS, so the geometry lands where the label and
// the footprint already are.
const MONO = [-97.7370979, 30.2874649], CIRC = [-97.7369445, 30.2862735];
const POSES = {
  // The elevation the hulls were measured in: low, from the south-west.
  mono: { at: MONO, h: 15.24, r: 9.5, want: 380, pitch: 66, bearing: 215 },
  // The aerial the ring and the towers were measured in: down at the plan.
  circ: { at: CIRC, h: 4.27, r: 4.5, want: 150, pitch: 46, bearing: 120 },
};

// What the data files publish. A count that drifts off its own source is the
// failure this gate exists to catch, so these are the SOURCE's numbers, not the
// renderer's.
const WANT_HULLS = 70;         // Landmarks: "70 aluminum canoes and small boats"
const WANT_TOWERS = 8;         // counted in Landmarks' aerial
const WANT_FINGERS_MIN = 40;   // 108 round the ring less the ~44 the eight piers stand on: measured 64
const TRIS_MIN = 8000;         // measured 14,080 (2026-09-05, balanced preset)
const LIVE_PX = 2000;          // pixels that change at a pose when the mesh goes: measured ~1.3e4 and ~2.6e4
// A runtime-off page against a LOAD carries the page's own two-state history,
// not the generator's — the same residue scripts/verify/slopes-layer.mjs bounds
// at 7,000 px for the whole slopes switch. Measured here: see the run.
const SWITCH_OFF_PX = 7000;
// The facade atlas' documented two-state residue, for the --against lines.
const ATLAS_PX = 1200, ATLAS_DELTA = 16;
// THE HOUR IS PINNED ON EVERY PAGE AND RE-PINNED AFTER EVERY jumpTo. It has to
// be: the first run of this gate asked for a page shot twice at one pose and
// got 277,322 differing pixels, and the diff was a broad sky wash with a
// building's windows LIT in one frame and not the other — the night lighting
// and the sky were still moving between the two shots. A gate that cannot get
// zero out of one settled page cannot say anything about a switch. 0.30 is a
// clean daylight value; nothing here depends on which one.
const TOD_P = 0.30;

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); };
const errors = [];

const browser = await launch(chromium, {
  gl: process.env.VERIFY_GL || 'hardware',
  // 30 min floor. A plain run is three page loads and finishes in about ten;
  // --against adds the archive AND the control, and at 15 min the watchdog
  // killed a run one shot from the end — a gate that cannot finish inside its
  // own watchdog is a dead gate. VERIFY_MAX_MS raises it further.
  maxMs: Math.max(1800000, Number(process.env.VERIFY_MAX_MS) || 0),
});

const tmp = SHOTS || fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || '.', 'art-slopes-'));
const snap = async (pg, name) => {
  const f = path.join(tmp, `${name}.png`);
  await pg.screenshot({ path: f }); await pg.waitForTimeout(300); await pg.screenshot({ path: f });
  return f;
};

async function open(url) {
  const pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  pg.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await pg.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
  await pg.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  // A correctness measure, not a speed one: the probe re-picks the graphics
  // preset mid-run and would change the geometry under a diff.
  await pg.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  // Auto-exposure OFF on every page, which is what lets the switch comparisons
  // below be asked for a small number instead of a percentage: js/graphics.js's
  // meter is open loop and rides `updateSky`, so two pages compared across a
  // jumpTo are otherwise comparing METER HISTORIES.
  await pg.evaluate(() => { window.GFX.autoExposure = false; });
  await pg.evaluate(p => window.applyTimeOfDay(window.__map, p, true), TOD_P);
  await pg.evaluate(() => {
    window.__settle = ms => new Promise(r => { const m = window.__map; const t = setTimeout(r, ms || 8000); m.once('idle', () => { clearTimeout(t); r(); }); });
  });
  // An archive page never loaded the generator and settles the moment the
  // slabs draw; ours waits for the build to finish.
  await pg.waitForFunction(() => window.__map.getLayer('props-artpart')
    && (!window.slopesArt || window.slopesArt.count.done), null, { timeout: 150000 }).catch(() => {});
  return pg;
}
async function poseAt(pg, P) {
  await pg.evaluate(o => window.__map.jumpTo(o), {
    center: P.at, zoom: zoomFor(P.h, P.want), pitch: P.pitch, bearing: P.bearing,
  });
  // A jumpTo rides updateSky, so re-pin the hour AFTER the move, not before.
  await pg.evaluate(p => window.applyTimeOfDay(window.__map, p, true), TOD_P);
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => window.__settle(4000));
  await pg.waitForTimeout(800);
}
const artState = pg => pg.evaluate(layer => {
  const m = window.__map, A = window.slopesArt;
  const st = window.slopes ? window.slopes.stats().groups.find(g => g.name === 'slopes-art') : null;
  return {
    count: A ? A.count : null,
    filtered: A ? A.filtered : null,
    on: !!(window.ART3D && window.ART3D.on),
    filter: JSON.stringify(m.getFilter(layer) || null),
    // The literal the filter hides by, so "and only those two" is a set
    // comparison rather than a substring test — the first version of this line
    // asked whether the filter contained 'Austin"' as a proof that Kelly's
    // 'Austin' was NOT hidden, and "Monochrome for Austin" ends with it.
    // Found by WALKING the filter for the ['in', ['get','name'], ['literal',
    // [...]]] clause, not by indexing a fixed path: js/slopes-art.js wraps any
    // pre-existing filter in an ['all', ...], so the clause's depth depends on
    // whether js/props.js had already put one there, and a hard-coded path
    // reads null on one of the two shapes (it did).
    names: (() => {
      const want = (n) => {
        if (!Array.isArray(n)) return null;
        if (n[0] === 'in' && JSON.stringify(n[1]) === '["get","name"]'
            && Array.isArray(n[2]) && n[2][0] === 'literal') return n[2][1];
        for (const k of n) { const r = want(k); if (r) return r; }
        return null;
      };
      return want(m.getFilter(layer));
    })(),
    groups: window.slopes ? window.slopes.root.children.map(g => g.name) : [],
    tris: st ? st.triangles : 0, visible: st ? st.visible : false,
    minzoom: st ? st.minzoom : null, lod: st ? st.lod : null,
  };
}, LAYER);

// ═══════════════════════════════════════════════════════════════════════
// 1. The generator built both pieces, and the slabs are filtered.
// ═══════════════════════════════════════════════════════════════════════
// EVERY branch page this gate opens carries `&apartments=0`, so the only thing
// that varies across its comparisons is THIS switch. The branch also carries
// another builder's apartments generator, and a line that leaves it on is
// measuring somebody else's commit.
const ON = await open(`${SERVER}/index.html?intro=0&drift=0&apartments=0`);
if (BREAK) {
  await ON.evaluate(() => { window.ART3D.on = false; window.applySlopesArt(window.__map); });
  await ON.waitForTimeout(900);
  console.log('--break: ART3D.on = false — both artworks are their stacked slabs again');
}
const st = await artState(ON);
const c = st.count || {};
check('art3d: both pieces are built — 70 hull shells and 8 towers on a ring of block fingers, in a group of its own that is drawing',
  c.done && c.pieces === 2 && c.hulls === WANT_HULLS && c.towers === WANT_TOWERS
  && c.fingers >= WANT_FINGERS_MIN && c.triangles >= TRIS_MIN
  && st.groups.includes('slopes-art') && st.tris >= TRIS_MIN && st.visible,
  `${c.pieces} piece(s), ${c.hulls} hulls (want ${WANT_HULLS}), ${c.fingers} fingers (want >= ${WANT_FINGERS_MIN}), ${c.towers} towers (want ${WANT_TOWERS}), ${c.triangles} tris in ${c.ms} ms; group ${st.groups.includes('slopes-art') ? 'present' : 'MISSING'} (${st.tris} tris, visible ${st.visible}, minzoom ${st.minzoom}, lod ${st.lod})`);
check(`art3d: while it draws, both pieces' artpart slabs are filtered out of ${LAYER} by name — and only those two`,
  st.filtered === true && NAMES.every(n => st.filter.includes(n))
  && (st.names || []).length === 2 && NAMES.every(n => (st.names || []).includes(n)),
  `filtered ${st.filtered}; hides ${JSON.stringify(st.names)}; filter ${st.filter}`);

// ═══════════════════════════════════════════════════════════════════════
// 2. One settled page shot twice is one frame; ON differs from OFF.
// ═══════════════════════════════════════════════════════════════════════
// The repeat is taken AT the pose with no camera move between the two, which
// is the only thing this line is entitled to claim. Shooting it either side of
// an excursion to the other artwork and back — the first version here — folds
// a full tile reload and a sky resettle into a line whose name says "the same
// frame", and it reported 277,322 px.
await poseAt(ON, POSES.mono);
const fOn = await snap(ON, 'art-mono-on');
const fOnAgain = await snap(ON, 'art-mono-on-again');
const dSame = diffPNG(fOn, fOnAgain);
check('art3d: one settled page shot twice at the Monochrome pose is the same frame',
  dSame.pixels === 0, `${dSame.pixels} of ${dSame.total} pixels differ (max channel Δ ${dSame.maxChannelDiff})`);

// The artwork's own screen box at each pose, for diffRect above. The margin is
// generous — 60 px — so it covers the ground the mesh sits on and the slabs it
// hides, not only the mesh.
const boxOf = (pg, P) => pg.evaluate(([ll, h, r]) => {
  const S = window.slopes, o = S.toLocal(ll[0], ll[1], 0), pts = [];
  for (const dx of [-r, 0, r]) for (const dy of [-r, 0, r]) for (const dz of [0, h]) {
    const p = S.project(o.x + dx, o.y + dy, dz); if (p) pts.push([p.x, p.y]);
  }
  if (!pts.length) return null;
  const M = 60;
  return [Math.min(...pts.map(p => p[0])) - M, Math.min(...pts.map(p => p[1])) - M,
          Math.max(...pts.map(p => p[0])) + M, Math.max(...pts.map(p => p[1])) + M];
}, [P.at, P.h, P.r]);
const boxMono = await boxOf(ON, POSES.mono);
await poseAt(ON, POSES.circ);
const boxCirc = await boxOf(ON, POSES.circ);
const fOnCirc = await snap(ON, 'art-circ-on');

await ON.evaluate(() => { window.ART3D.on = false; window.applySlopesArt(window.__map); window.__map.triggerRepaint(); });
await ON.waitForTimeout(1500);
await poseAt(ON, POSES.mono);
const fLiveOffMono = await snap(ON, 'art-mono-live-off');
await poseAt(ON, POSES.circ);
const fLiveOffCirc = await snap(ON, 'art-circ-live-off');
const offSt = await artState(ON);
await ON.close();

const dMono = diffPNG(fOnAgain, fLiveOffMono);
const dCirc = diffPNG(fOnCirc, fLiveOffCirc);
check('art3d: ON and OFF differ at BOTH poses — the mesh is drawing both artworks',
  dMono.pixels > LIVE_PX && dCirc.pixels > LIVE_PX,
  `Monochrome ${dMono.pixels} px (max Δ ${dMono.maxChannelDiff}), Circle ${dCirc.pixels} px (max Δ ${dCirc.maxChannelDiff}) — floor ${LIVE_PX} each`);

// ═══════════════════════════════════════════════════════════════════════
// 3. Off is main: the group goes, the filter is restored, and the frame
//    is the ?art3d=0 page's.
// ═══════════════════════════════════════════════════════════════════════
const URLOFF = await open(`${SERVER}/index.html?intro=0&drift=0&art3d=0&apartments=0`);
await poseAt(URLOFF, POSES.mono);
const fUrlMono = await snap(URLOFF, 'art-mono-url-off');
await poseAt(URLOFF, POSES.circ);
const fUrlCirc = await snap(URLOFF, 'art-circ-url-off');
const urlSt = await artState(URLOFF);
await URLOFF.close();

check('art3d: ART3D.on = false removes the group and restores the filter to what a ?art3d=0 page carries, and ?art3d=0 never builds one',
  !offSt.groups.includes('slopes-art') && offSt.filtered === false && offSt.filter === urlSt.filter
  && !urlSt.groups.includes('slopes-art') && urlSt.on === false && urlSt.filtered !== true,
  `off: group ${offSt.groups.includes('slopes-art') ? 'STILL THERE' : 'gone'}, filtered ${offSt.filtered}, filter ${offSt.filter === urlSt.filter ? 'identical to ?art3d=0' : 'DIFFERS: ' + offSt.filter + ' vs ' + urlSt.filter}; ?art3d=0: on ${urlSt.on}, group ${urlSt.groups.includes('slopes-art') ? 'PRESENT' : 'absent'}, filtered ${urlSt.filtered}`);

const dSwitchMono = diffPNG(fLiveOffMono, fUrlMono);
const dSwitchCirc = diffPNG(fLiveOffCirc, fUrlCirc);
check('art3d: the runtime-off frames are the ?art3d=0 frames at both poses, within the slopes switch\'s own OFF-vs-load ceiling',
  dSwitchMono.pixels <= SWITCH_OFF_PX && dSwitchCirc.pixels <= SWITCH_OFF_PX,
  `Monochrome ${dSwitchMono.pixels} px (max Δ ${dSwitchMono.maxChannelDiff}), Circle ${dSwitchCirc.pixels} px (max Δ ${dSwitchCirc.maxChannelDiff}) — ceiling ${SWITCH_OFF_PX} each`);

if (AGAINST) {
  const A = await open(`${AGAINST}/index.html?intro=0&drift=0`);
  // ...and the branch also carries another builder's SLOPES_ROOFS.lines.on =
  // false, so the archive page is put into that state before its frame. Two
  // buildings' ridge courses are in shot at the Monochrome pose; without this
  // the line reports a quarter of a million pixels of somebody else's commit.
  await A.evaluate(() => {
    if (window.SLOPES_ROOFS && window.SLOPES_ROOFS.lines && window.slopesRoofs) {
      window.SLOPES_ROOFS.lines.on = false; window.slopesRoofs.rebuild();
    }
  });
  await A.waitForTimeout(1200);
  await poseAt(A, POSES.mono);
  const gMono = await snap(A, 'art-mono-against');
  await poseAt(A, POSES.circ);
  const gCirc = await snap(A, 'art-circ-against');
  await A.close();
  // THE CONTROL, and it is what makes the next line mean anything: a SECOND
  // load of the branch's own ?art3d=0 page, diffed against the first. Whatever
  // it reports is the page's own noise at these poses with no archive and no
  // generator involved — measured 0 and 0 on 2026-09-05, which is what let the
  // 277k against MAIN be read as real rather than as flake.
  const CTRL = await open(`${SERVER}/index.html?intro=0&drift=0&art3d=0&apartments=0`);
  await poseAt(CTRL, POSES.mono);
  const kMono = await snap(CTRL, 'art-mono-url-off-again');
  await poseAt(CTRL, POSES.circ);
  const kCirc = await snap(CTRL, 'art-circ-url-off-again');
  await CTRL.close();
  const ctrlM = diffPNG(fUrlMono, kMono), ctrlC = diffPNG(fUrlCirc, kCirc);
  check('art3d (--against): the control — a second load of the same ?art3d=0 page is the same frame at both poses, so the comparison below is measuring the archive and not the page',
    ctrlM.pixels <= ATLAS_PX && ctrlC.pixels <= ATLAS_PX,
    `Monochrome ${ctrlM.pixels} px (max Δ ${ctrlM.maxChannelDiff}), Circle ${ctrlC.pixels} px (max Δ ${ctrlC.maxChannelDiff}) — ceiling ${ATLAS_PX}`);

  const dm = diffPNG(fUrlMono, gMono), dc = diffPNG(fUrlCirc, gCirc);
  const rm = diffRect(fUrlMono, gMono, boxMono), rc = diffRect(fUrlCirc, gCirc, boxCirc);
  const zeroButAtlas = d => d.pixels === 0 || (d.pixels <= ATLAS_PX && d.maxChannelDiff <= ATLAS_DELTA);
  check("art3d (--against): with the switch off the picture is what the tree without this generator draws — whole frame, at both poses, to the facade atlas' two-state residue",
    zeroButAtlas(dm) && zeroButAtlas(dc),
    `WHOLE FRAME: Monochrome ${dm.pixels} of ${dm.total} px (max Δ ${dm.maxChannelDiff}), Circle ${dc.pixels} of ${dc.total} px (max Δ ${dc.maxChannelDiff}) — ceiling ${ATLAS_PX} px at Δ<=${ATLAS_DELTA}. In each artwork's own screen box: ${rm.pixels} and ${rc.pixels} px. Control ${ctrlM.pixels} and ${ctrlC.pixels} px`);
}

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

let bad = 0;
for (const r of results) { console.log(`${r.pass ? ' PASS ' : '*FAIL '} ${r.name}\n         ${r.detail}`); if (!r.pass) bad++; }
console.log(`\n${results.length - bad}/${results.length} passed${BREAK ? '  (--break: the built, filter and ON-vs-OFF lines are meant to be red — 3 of them)' : ''}`);
console.log(`frames in ${tmp}`);
browser.__done();
process.exit(bad ? 1 : 0);
