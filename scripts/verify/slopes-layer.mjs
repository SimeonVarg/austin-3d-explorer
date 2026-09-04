/**
 * slopes-layer.mjs — the three.js layer behaves like the fill-extrusion beside it.
 *
 * js/slopes.js draws real angled geometry inside MapLibre's frame. Before any
 * generator lands on it, this proves — from pixels, on the real page — that a
 * mesh in that layer is treated exactly like a building: same hour, same sun,
 * same depth buffer, same haze, same render-distance rule, and that the whole
 * thing switches off to a frame identical to the one it was never in.
 *
 * Every assertion is RELATIVE — mesh against a fill-extrusion twin in the same
 * frame, on against off — never an absolute hex, so it runs on the real GPU
 * (the default here) where exact hex would not survive a driver update. Set
 * VERIFY_GL=swiftshader to run it on the software rasteriser instead.
 *
 * What it asserts (numbers from the first run, RTX 3050 Ti, 2026-09-02):
 *
 *   switch    THE PROMISE IS ABOUT OFF, NOT ABOUT ON. With the generators
 *             drawing, the ON frame is SUPPOSED to differ from the slabs —
 *             108 roofs, 24 arches and a dome are in the mall-cruise frame.
 *             What must hold is that the switch RETURNS and that OFF is
 *             today's city: `SLOPES.on` false then true again is the frame it
 *             started from at 0 of 1,296,000 px; every filter the layer
 *             touched comes back BYTE-IDENTICAL to a `?slopes=0` page's;
 *             `?slopes=0` equals a `git archive main` served on a second port
 *             (--against) at 0 px, which is the bake-identity contract for
 *             scripts/bake_roofs.py. Two supporting lines keep those zeros
 *             honest: the harness's own noise floor (one settled page shot
 *             twice = 0 px) and a live count showing the layer really draws at
 *             this pose, so nothing here can pass by drawing nothing.
 *
 *             (Since 2026-09-03 the three zero lines accept, at most, the
 *             facade atlas' own two-state residue — the same 971 pixels of
 *             Δ ≤ 12 on the pattern walls' window grids, present between two
 *             pages that carry no mesh at all; ATLAS_RESIDUE_PX below.)
 *             The one line that is NOT a zero, with its reason: the OFF frame
 *             against a `?slopes=0` LOAD is 6,134 px (0.47 %, nine independent
 *             pairs, identical to ±1). None of it is the mesh — stopping the
 *             layer's render() altogether moves 0 pixels, and that control is
 *             asserted beside it. 5,178 px is the mere PRESENCE of one more
 *             layer in the style: MapLibre slices the depth range per layer,
 *             so a 224-layer style resolves the ties between coplanar roof
 *             steps the other way from a 223-layer one. The last 969 px, which
 *             survive removing the layer, are not explained. So that line is a
 *             ratchet with its ceiling named, not a zero pretended into being.
 *
 *             All of it became measurable only once auto-exposure was pinned
 *             off in open(): the meter rides map 'move' and reads the previous
 *             frame, so any two pages compared across a jumpTo were being
 *             compared on their METER HISTORIES. That, and not this layer, was
 *             the 163,822-px Δ1 "far field" and the 3.8% toggle brightening
 *             chased on 2026-09-02 — both reproduce with no layer present.
 *   stack     slopes-mesh sits before aerial-fog; only the sky compositor and
 *             the labels sit above the fog.
 *   frame     slopes.project(slopes.toLocal(lng, lat)) lands on map.project
 *             to 0.00 px at three points across campus and the Capitol.
 *   light     the ENU light vector is skyBodies(p).sun to 1e-15, at the
 *             light's own radial.
 *   hour      a 16 m mesh cube and a fill-extrusion twin of the same baked
 *             colour on the South Mall lawn: top, south and west faces equal
 *             to the unit at golden hour, within 3/255 at morning and night;
 *             the mesh top gets darker morning → golden → night.
 *   depth     a slab behind the Tower: the Tower's pixel is identical with
 *             the layer on and off; from the north the same slab is visible.
 *             A slab in front of the Tower changes the Tower's pixel.
 *   haze      a mesh post and an extrusion post 2.5 km out: identical with
 *             the fog on (175,108,60) and off (153,87,46); the fog moves both.
 *   lod       at ~800 m with render distance 700 the mesh is hidden with
 *             roofs-pitched (LOD_isHidden, and its pixel is the ground);
 *             at the slider's top it is back. LOD IS PER GROUP: the custom
 *             layer's layout visibility stays 'visible' at every altitude
 *             (lod.js never writes it), render() keeps running, the roofs
 *             group goes and the Capitol dome group stays. Asserting
 *             visibility 'none' here was the old contract and it is gone —
 *             a hidden custom layer's render() is never called, which took
 *             the dome off the skyline with the roofs on 2026-09-02. The other
 *             half of that defect is asserted too: while the layer is held
 *             down, capitol-dome's filter must STILL be excluding the stacked
 *             discs, because the dome group is still drawing. Both shapes gone
 *             at once is how the skyline went empty.
 *   preset    GFX.preset = 'performance' halves slopes.detail(); the debug
 *             lathe rebuilds at half its segments.
 *   raycast   slopes.raycast() at the cube's top centre hits it at 16.00 m;
 *             at the sky it returns null.
 *
 * With the generators (js/slopes-roofs.js, -arches.js, -dome.js) drawing:
 *
 *   built     108 roofs + Gregory Gym's gable, 24 arched entrances, the
 *             three dome parts and the Main Building's three hips (the
 *             tower bake's rig, its own group `slopes-tower` since
 *             2026-09-03) are in the scene; roofs-pitched shows only the
 *             `f` tags it keeps, entrances-portal/glass exclude `arc`, and
 *             capitol-dome excludes the three lathed parts; SLOPES.on = false
 *             puts all three filters back to what they were. The roofs-filter
 *             regex is ROOFS_FILTER_RE at the top of this file, and it is
 *             there because the first one (/"match","\["get","f"\]/) could
 *             not match a correct filter: the gate was red on 2026-09-02
 *             against a filter that was right.
 *   ridge     at the gregory pose, on the hipped roof nearest the frame's
 *             centre whose two long slopes the light tells apart most: the
 *             slopes read as two tones either side of the ridge (pixels), each
 *             slope is one tone along its length (pixels), and a raycast down
 *             the slope climbs continuously at the rig's own pitch — a
 *             staircase would plateau.
 *   arch      the stand-in is not a five-sided polygon, it is a STAIRCASE:
 *             bake_entrances.py's ARCH_TIERS = 5 chords each freeze their half
 *             width at their own tier's mid height. So on the arched door
 *             nearest the frame's centre: ARCH_SAMPLES = 33 raycasts walk the
 *             head from 8° to 172° and must land on the arches mesh within
 *             3 cm of the exact ellipse, where the five chords are out by tens
 *             of centimetres — both numbers printed, and the mesh must be 5x
 *             closer. Then ARCH_PROBES = 6 pixels chosen where the curve is
 *             surround and the chords are NOT must move when the chords come
 *             back, and the head as a whole must differ from the chord frame.
 *             (The first version asked instead that "the six pixels on the
 *             curve are one tone". That was over-strict AND blind: at
 *             battle-door the mesh reads 136 103 87 136 136 136 and the chords
 *             read exactly the same, so it went red on a correct arch and
 *             would have gone green on a wrong one. What separates a curve
 *             from five chords is WHERE the surround is, not its tone.)
 *   one fetch (2026-09-04) data/entrances.geojson — 6.4 MB, wanted by
 *             js/entrances.js for the doors and by js/slopes-arches.js for its
 *             `arches` member — is REQUESTED EXACTLY ONCE per page load. It
 *             was requested twice on every ON load until this line existed:
 *             the arches pass recovered the parsed object from
 *             `getSource('austin-entrances')._data.arches` and fetched the
 *             file when that came up empty, and it ALWAYS came up empty,
 *             because MapLibre 5.24.0 stores `_data = { geojson: <your
 *             object> }` and keeps the original on `_options.data`. The ON
 *             page was 25.04 MB against ?slopes=0's 18.67 MB and that
 *             duplicate was the whole of the delta (CDP encodedDataLength,
 *             cold, both figures). The fix is a published promise —
 *             js/entrances.js's `window.entrancesGeoJSON()` — not a better
 *             private field to read. Counted as REQUESTS and not as bytes: a
 *             duplicate the HTTP cache absorbs is still the defect, and this
 *             gate shares one cache across its three page loads.
 *
 *   flat      (round 5, 2026-09-03) the footprints the bake tagged `flat` —
 *             a membrane middle, or a flat deck beside a tile block: Welch,
 *             the Union, Painter, Hogg Auditorium — draw no band and no
 *             plate; their tiled parts are hips of their own and their cap
 *             is painted the flat roof's colour. Measured at mall-cruise:
 *             a raycast at each flat entry's centroid does not land on the
 *             mesh at the plate's exact height, and the cap wrapper carries
 *             a deck branch.
 *   courses   (round 6, 2026-09-03) every roof carries its ridge, hip and
 *             valley courses (SLOPES_ROOFS.lines — the pale lines a barrel-
 *             tile roof shows from the air, which are what makes a hip read
 *             as a hip at mall-cruise, where a far slope is four pixels).
 *             Measured at mall-cruise on the plain four-corner hips in
 *             frame: a raycast at the ridge lands on the mesh `h` above the
 *             ridge, and the ridge's pixel column is lighter than both
 *             slopes 4 m either side; the generators report the count.
 *
 * --break sabotages the page — inside the page only, no file on disk changes —
 * in the five ways this gate exists to catch, and TWELVE lines must go red:
 *   1. the layer is moved to the END of the style, above the fog: the `stack`
 *      line and the two `haze` lines (3).
 *   2. SLOPES_ARCHES.on = false, so the arched heads are the five chords
 *      again: all three `arch` lines at both poses (6). That is the exact
 *      regression those assertions exist to catch — and they are the ones
 *      this gate already got wrong once, so they are the ones worth watching.
 *   3. SLOPES_ROOFS.flatRoofs = false on the switch page, so every flat roof
 *      wears its band and plate again: the `flat roofs` line (1).
 *   4. SLOPES_ROOFS.lines.on = false on the same page, so no roof carries a
 *      course: the `courses` line (1).
 *   5. data/entrances.geojson is fetched a second time from the page, which is
 *      exactly what js/slopes-arches.js did until 2026-09-04: the `one fetch`
 *      line (1).
 * Use it before trusting a green. Measured 2026-09-02, hardware GL:
 * 38/47 with --break (no --against) against 48/48 without; 2026-09-03 with
 * the flat line: 38/48 with --break (the ten intended reds and nothing
 * else) against 49/49 with --against; later that day with the courses
 * line: see HANDOFF §213 for the pair.
 *
 * Usage (from scripts/verify, README's way):
 *   VERIFY_URL=http://127.0.0.1:8442 node slopes-layer.mjs [--shots DIR] [--break] [--against URL]
 *
 *   --shots DIR     save the proof frames (never into the repo; the scratchpad)
 *   --against URL   a second server (e.g. a pristine main export) whose
 *                   mall-cruise frame the ?slopes=0 frame must equal
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import { diffPNG } from './lib/png.mjs';

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const BREAK = argv.includes('--break');
const SHOTS = arg('--shots');
const AGAINST = arg('--against');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const W = 1440, H = 900;
const TOWER = [-97.7393587, 30.2860098];
// js/controls.js's own altitude formula, inverted: zoom for an altitude at a pitch.
const zoomFor = (alt, pitch, lat) => {
  const camPx = 0.5 * H / Math.tan(29 * Math.PI / 180);
  const mpp = alt / (Math.cos(pitch * Math.PI / 180) * camPx);
  return Math.log2(40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * mpp));
};

// ══════════════════════════════════════════════════════════════════════
//  The gate's own constants. CLAUDE.md rule 11: no measurement buried in a
//  function body.
// ══════════════════════════════════════════════════════════════════════

// roofs-pitched's filter serialises as ["match",["get","f"],[...],true,false]:
// a `match` whose input is the ["get","f"] EXPRESSION, not the string "f".
// The first version of this line asked for /"match","\["get","f"\]/ — the
// comma INSIDE the quotes — which no correct filter can ever produce. The gate
// was red on 2026-09-02 against a filter that was right. A regex that cannot
// match is a guard that cannot pass, which is the same defect as one that
// cannot fail (README: "every gate must be watchable failing").
const ROOFS_FILTER_RE = /^\["match",\["get","f"\],\[/;

// THE ARCH IS A CURVE — and the stand-in it replaces is not a five-sided
// polygon, it is a STAIRCASE. scripts/bake_entrances.py draws an arched head
// as ARCH_TIERS = 5 horizontal chords, each a rectangle whose half width is
// frozen at its own tier's MID height:
//     w_i = half * sqrt(1 - t_i²),   t_i = (i + 0.5) / 5
// so at a given height the chords are out by up to `half` near the crown
// (the top tier is 57 cm wide on Battle Hall where the ellipse has closed to
// nothing) and by millimetres near the springing. That is the number this
// gate measures against.
//
// The assertion it replaces — "the six pixels on the curve are one tone" —
// was over-strict AND non-discriminating: at battle-door the mesh reads
// 136 103 87 136 136 136 and the chords read exactly the same, so it was red
// on a correct arch and would have been green on a wrong one. What separates
// a curve from five chords is WHERE the surround is, not what tone it is.
const ARCH_SAMPLES = 33;          // raycasts across the head, ARCH_TH0..ARCH_TH1
const ARCH_TH0 = 8, ARCH_TH1 = 172;   // degrees; inside the springing, over the crown
const ARCH_ON_ELLIPSE_M = 0.03;   // a 24-segment quarter is off its ellipse by 0.7 mm
const ARCH_CHORD_RATIO = 5;       // ...and must be at least this much closer than the chords
const ARCH_TIERS = 5;             // bake_entrances.py's own ARCH_TIERS
// The probes are chosen in the (u, z) PLANE, not along the band's midline.
// At a given height the mesh's surround occupies u from the intrados
// half*sqrt(1-t²) out to the extrados (half+sw)*sqrt(1-(t')²), and the chords'
// occupies [w_i, w_i + sw] with w_i frozen at the tier's mid height. Where
// those two intervals do NOT overlap by at least ARCH_PROBE_GAP is a place the
// two shapes genuinely disagree — limestone surround on the mesh against
// fanlight glass (inside) or terracotta spandrel (outside) on the chords. The
// first cut of this measured clearance along the midline alone and found only
// 5 such samples of 33 on a semicircular portal, which is why it is written
// this way.
// Some probe positions are a TIE even where the two shapes disagree — the
// chord's spandrel and the mesh's surround can happen to carry the same tone
// at that height. The first run of this asked 5 of 6 and got exactly 5 at both
// poses, i.e. no margin at all, which is how a correct arch turns a gate red.
// So it asks for a MAJORITY of a wider sample.
const ARCH_PROBES = 8;            // pixels sampled where the curve is surround and the chords are not
const ARCH_PROBE_GAP = 0.10;      // m; the disagreement must be this wide to be worth a pixel
const ARCH_PROBE_UMIN = 0.35;     // m; keep off the centreline — bake_entrances.py lays a KEYSTONE
                                  // across the crown, proud of the band, present in BOTH shapes
const ARCH_PROBE_DELTA = 12;      // /255 luma; how far such a pixel must move when the chords come back
const ARCH_PROBE_MIN = 5;         // of ARCH_PROBES — a majority, not all of them
// THE 971 PIXELS THAT ARE NOT THE MESH, named at last (2026-09-03). Three
// runs of this gate on one tree: the OFF→ON toggle line read 971 px twice
// and 0 once; the bake-identity line (?slopes=0 against a `git archive main`
// on a second port — two pages with NO custom layer in either) read 0, 1 and
// 968 px; the render()-stopped control 0, 1 and 0. The two 971-pixel sets
// are the SAME 971 pixels with the same before/after colours, and 884 of
// them are in the 968. Marked on the frame they sit on the WINDOW GRIDS of
// the fill-extrusion-pattern walls — js/facades.js's atlas — at Δ1 to Δ12:
// the pattern is sampled at one of two texel phases, and which one a page
// lands in is decided at load (or at a source reload, which a setFilter on
// the toggle causes). It is the "last 969 px which survive removing the
// layer" of 204d, and it appears between two mesh-less pages, so it is not
// this layer's. A zero is still the usual outcome and still the target;
// these three lines now accept AT MOST this residue, bounded in both count
// and depth so nothing the mesh could do — a roof over a wall is Δ 50+,
// the ON frame is 223,748 px — can hide under it.
// THE MERGE VERIFIER'S NUMBERS (2026-09-04), left here because the next pass
// will be tempted to tighten this ceiling and should see the floor first.
// A ceiling of "2 px at Δ ≤ 1" was proposed for the bake-identity line on the
// strength of two runs that read 1 px at Δ 1. It was NOT taken, and the
// measurement that settles it is the HARNESS NOISE FLOOR: two loads of the
// SAME build, same pose, same settle, auto-exposure pinned off, diffed at
// tolerance 0 — mall-cruise 0 px, gregory 0 px, battle-street 0 px,
// capitol-dome 12 px at Δ 1. A 2-px ceiling sits UNDER that floor and would
// go red on a page compared with itself. This run's bake-identity line read
// 1 px at Δ 1; earlier runs read 0, 968 and 969.
// What the line is really guarding is settled away from pixels anyway:
// the bake is PURELY ADDITIVE. Against `git archive e232953`, roofs/entrances/
// capitol_dome/tower.geojson each keep their feature count, every feature's
// geometry is byte-identical, no existing property value changes, and the only
// difference is new keys (`f`, `arc`) and new top-level members (`rig`,
// `arches`, `drum`, `lathe`) that no fill-extrusion layer reads. data/
// roof_runs.json changed too and has no runtime consumer at all — only the
// bake and scripts/verify/roofowner.mjs read it. And ?slopes=0 against that
// archive is 0 px at ALL FOUR poses at tolerance 0, not just mall-cruise.
const ATLAS_RESIDUE_PX = 1200;      // measured 968, 971, 971
const ATLAS_RESIDUE_DELTA = 16;     // measured Δ 12
const zeroButAtlas = d => d.pixels === 0 || (d.pixels <= ATLAS_RESIDUE_PX && d.maxChannelDiff <= ATLAS_RESIDUE_DELTA);
const residueNote = d => d.pixels === 0 ? '' : ` — within the facade atlas' two-state residue (≤ ${ATLAS_RESIDUE_PX} px, Δ ≤ ${ATLAS_RESIDUE_DELTA})`;
// The generator groups the scene must hold on a plain page: the campus
// roofs, the arches, the Capitol dome, and — since 2026-09-03 — the Main
// Building's hips from the tower bake's rig (js/slopes-roofs.js ROOFS.extra).
const WANT_GROUPS = ['slopes-roofs', 'slopes-arches', 'slopes-dome', 'slopes-tower'];
// THE COURSES (round 6, 2026-09-03). "Almost every red roof reads as a flat
// plateau with a bevelled rim (a truncated pyramid), not two slopes meeting
// at a ridge" — on a mesh whose roofs already ran to their ridges. From the
// mall-cruise camera a far slope is four pixels and nothing marked the
// ridge; a barrel-tile roof marks it with a ridge course and hip courses,
// pale from the air (Google's Garrison at the same pose). SLOPES_ROOFS.lines
// draws them as boxes standing `h` proud of the ridge, so at every plain
// hip in frame a raycast at the ridge lands on the mesh `h` ABOVE the ridge
// (not on the ridge itself), and the ridge's pixel column reads lighter
// than both slopes 4 m either side. Measured on the first run: 1,780 courses
// on the campus rig, 22 on the Main Building; the ridge column 114-135 luma
// over slopes of 60-114. --break switches the courses off.
const COURSES_MIN = 1000;         // campus courses, measured 1,780
const COURSE_Z_TOL = 0.06;        // m; a raycast at the ridge may land at most this much above ridge + h
const COURSE_LUMA = 10;           // /255; the ridge column must beat the brighter slope sample by this
const COURSE_FRAC = 0.75;         // ...on this share of the plain hips in frame (a 1-px course lands on one row or the next)
const COURSE_RIDGE_PX = 20;       // a ridge shorter than this on screen is too small to carry a course a pixel wide
const COURSE_SLOPE_PX = 2;        // a slope sample this close (Chebyshev, px) to the ridge pixel is the course itself, not the slope
const COURSE_OCCLUDED_M = 1.0;    // a raycast this far from the ridge hit something in front of it: no verdict

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); };
const rgb = v => v ? v.join(',') : 'null';
const maxd = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// Three page loads and twelve poses: ~15 min on a quiet machine, and the 25 min
// ceiling has been enough every time until 2026-09-04, when a run was killed at
// it mid-gate. VERIFY_MAX_MS raises it, which chrome.mjs's own header tells you
// to do and §155 made possible — a hard-coded `maxMs:` used to win over the
// env, which is the same shape of dead gate walk.mjs was in (exit 124 one
// minute after it had printed PASS on everything). The floor stays 25 min: the
// watchdog exists because "slow" and "wedged" look identical from outside.
const browser = await launch(chromium, {
  gl: process.env.VERIFY_GL || 'hardware',
  maxMs: Math.max(1500000, Number(process.env.VERIFY_MAX_MS) || 0),
});
const errors = [];
async function open(url) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // EVERY REQUEST THE PAGE MAKES, so the gate can count them. See the
  // `one fetch` assertion below: data/entrances.geojson is 6.4 MB and two
  // passes want it, and for a while both downloaded it.
  //
  // 'request', not 'response' and not CDP encodedDataLength: a duplicate that
  // the HTTP cache happens to absorb is still the defect, and would still cost
  // a visitor the round trip on a cold load. Counting requests catches it
  // whatever the cache did. (It also survives this gate sharing one browser —
  // and therefore one cache — across its three page loads, where a byte count
  // would read zero on the second page and prove nothing.)
  page.__requests = [];
  page.on('request', r => page.__requests.push(r.url()));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  // AUTO-EXPOSURE OFF ON EVERY PAGE THIS GATE OPENS — the reason the switch
  // comparisons below can be asked for ZERO pixels.
  //
  // js/graphics.js's meter is OPEN LOOP and rides `updateSky`, which runs on
  // map 'move', 'resize' and hour changes — never per frame — and its 40x24
  // drawImage reads the PREVIOUS frame's buffer. So the first jumpTo after a
  // load meters the LOAD pose, and any two pages compared across a jumpTo are
  // comparing METER HISTORIES, not renders. That is the whole of the
  // 163,822-pixel Δ1 "far field" difference chased on 2026-09-02 and of the
  // 3.8% brightening the runtime toggle appeared to cause; both reproduce on a
  // ?slopes=0 page with no layer present at all. aeMeter resets its gain to 1
  // the next time it runs with the flag off, which the pose's jumpTo
  // guarantees, and every frame this gate diffs is asserted at gain 1.
  // gl.readPixels never saw the gain anyway (the grade is a CSS filter on
  // #map), so the sampled colours above are untouched — only the screenshots
  // move, and they move to zero.
  await page.evaluate(() => { window.GFX.autoExposure = false; });
  await page.waitForFunction(() => {
    const m = window.__map;
    return m.getSource('austin-buildings') && m.getLayer('buildings-3d') && m.getLayer('aerial-fog');
  }, null, { timeout: 180000 });
  await page.evaluate(() => {
    // Average RGB in a (2R+1)² box around CSS points, read INSIDE the render
    // event so the drawing buffer is still there without preserveDrawingBuffer.
    window.__sample = (pts, R) => new Promise(res => {
      const m = window.__map, cv = m.getCanvas(); const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      m.once('render', () => {
        const dpr = cv.width / cv.clientWidth; R = R == null ? 2 : R;
        res(pts.map(([x, y]) => {
          const px = Math.round(x * dpr), py = Math.round((cv.clientHeight - y) * dpr); const n = 2 * R + 1;
          const buf = new Uint8Array(n * n * 4); gl.readPixels(px - R, py - R, n, n, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          const s = [0, 0, 0]; for (let i = 0; i < buf.length; i += 4) { s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; }
          return s.map(v => Math.round(v / (n * n)));
        }));
      });
      m.triggerRepaint();
    });
    // 'idle' raced against a cap: a map that is already idle never fires it.
    window.__settle = ms => new Promise(r => { const m = window.__map; const t = setTimeout(r, ms || 8000); m.once('idle', () => { clearTimeout(t); r(); }); });
  });
  return page;
}
async function pose(page, center, zoom, pitch, bearing) {
  await page.evaluate(o => window.__map.jumpTo(o), { center, zoom, pitch, bearing });
  await page.evaluate(() => window.__settle());
  await page.waitForTimeout(700);
}
async function shot(page, name) {
  if (!SHOTS) return;
  const f = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: f }); await page.waitForTimeout(250); await page.screenshot({ path: f });
  console.log('   shot', f);
}
const scr = (page, x, y, z) => page.evaluate(([x, y, z]) => { const p = window.slopes.project(x, y, z); return p && [Math.round(p.x), Math.round(p.y)]; }, [x, y, z]);
const sample = (page, pts, R) => page.evaluate(([pts, R]) => window.__sample(pts, R), [pts, R]);
const setOn = (page, on) => page.evaluate(on => { window.SLOPES.on = on; window.__map.triggerRepaint(); }, on).then(() => page.waitForTimeout(500));

// ═══════════════════════════════════════════════════════════════════════
// 1. The debug scene: everything that needs a mesh to measure.
// ═══════════════════════════════════════════════════════════════════════
const page = await open(`${SERVER}/index.html?intro=0&drift=0&slopesdebug=1`);
const booted = await page.waitForFunction(() => window.slopes && window.slopes.frames > 0 && window.slopes.debugGroup, null, { timeout: 90000 }).then(() => true).catch(() => false);
check('the layer boots and renders a frame', booted, booted ? 'slopes.frames > 0 with the debug scene present' : 'no frame after 90 s');
if (!booted) { report(); }

const env = await page.evaluate(() => {
  const gl = window.__map.getCanvas().getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), three: window.THREE && window.THREE.REVISION, src: [...document.scripts].map(s => s.src).find(s => /three/.test(s)) };
});
console.log('GL renderer:', env.renderer);
check('three.js is the pinned unpkg build', env.three === '159' && /unpkg\.com\/three@0\.159\.0\/build\/three\.min\.js/.test(env.src || ''), `REVISION ${env.three}, ${env.src}`);

if (BREAK) {
  await page.evaluate(() => { window.__map.moveLayer('slopes-mesh'); });   // to the very end: above the fog and the sky
  // ...and download the entrances file a second time, which is exactly what
  // js/slopes-arches.js did on every load until 2026-09-04. Not awaited: the
  // `one fetch` line counts REQUESTS, and the request is made synchronously.
  page.evaluate(() => { fetch('data/entrances.geojson').catch(() => {}); });
  console.log('--break: slopes-mesh moved to the end of the style; entrances.geojson re-fetched');
}

// stack
// js/sky.js anchors the fog AFTER THE LAST layer that writes depth and before
// the trailing run of labels — not before the first symbol layer in the style
// (passes interleave symbol layers among the 3D ones; the first run of this
// gate asserted the stricter thing and went red at slopes 208 / fog 210 /
// first symbol 199). The claim that matters: the mesh is below the fog, and
// nothing below the labels sits above the fog except the sky compositor.
const order = await page.evaluate(() => {
  const m = window.__map, o = m.style._order;
  const fog = o.indexOf('aerial-fog');
  const above = o.slice(fog + 1).filter(id => id !== 'sky-overlay' && !(m.getLayer(id) && m.getLayer(id).type === 'symbol'));
  return { slopes: o.indexOf('slopes-mesh'), fog, sky: o.indexOf('sky-overlay'), aboveFogNotLabel: above, n: o.length };
});
check('slopes-mesh sits before aerial-fog, and only the sky and the labels sit above the fog',
  order.slopes >= 0 && order.slopes < order.fog && order.aboveFogNotLabel.length === 0,
  `order: slopes ${order.slopes}, fog ${order.fog}, sky ${order.sky} of ${order.n}; non-label layers above the fog: [${order.aboveFogNotLabel.join(', ')}]`);

// frame
const proj = await page.evaluate(() => {
  const m = window.__map, s = window.slopes;
  return [[-97.7393587, 30.2860098], [-97.7365, 30.2845], [-97.7404, 30.2747]].map(([lng, lat]) => {
    const l = s.toLocal(lng, lat, 0); const a = s.project(l.x, l.y, l.z); const b = m.project([lng, lat]);
    return a ? Math.hypot(a.x - b.x, a.y - b.y) : 1e9;
  });
});
check('slopes.project(slopes.toLocal(lng, lat)) is map.project(lng, lat)', Math.max(...proj) < 0.5, `worst ${Math.max(...proj).toFixed(3)} px over the Tower, Gregory Gym and the Capitol`);

// light
const light = await page.evaluate(() => {
  const s = window.slopes, p = window.__todCurrentP; const sun = window.skyBodies(p).sun; const R = Math.PI / 180;
  const want = [Math.sin(sun.az * R) * Math.cos(sun.elev * R), Math.cos(sun.az * R) * Math.cos(sun.elev * R), Math.sin(sun.elev * R)];
  const l = s.light(); const len = Math.hypot(...l.enu); const L = window.__map.getLight();
  return { diff: Math.max(...l.enu.map((v, i) => Math.abs(v / len - want[i]))), len, radial: L.position[0], az: sun.az, elev: sun.elev, p };
});
check('the mesh light is skyBodies(p).sun, at the light\'s own radial', light.diff < 1e-6 && Math.abs(light.len - light.radial) < 1e-6, `unit diff ${light.diff.toExponential(2)}, |L| ${light.len.toFixed(4)} vs radial ${light.radial}, sun az ${light.az} elev ${light.elev} at p ${light.p}`);

// hour: the parity pair on the lawn
await pose(page, [-97.7394, 30.2846], zoomFor(60, 60, 30.2846), 60, 20);
const P = await page.evaluate(() => { const s = window.slopes, S = window.SLOPES; const o = s.debugGroup.getObjectByName('parity'); return { x: o.position.x, y: o.position.y, E: S.debugCube, tw: S.debugTwinEast }; });
const faces = {
  top:   [await scr(page, P.x, P.y, P.E - 0.01),                 await scr(page, P.x + P.tw, P.y, P.E - 0.01)],
  south: [await scr(page, P.x, P.y - P.E / 2 + 0.01, P.E / 2),   await scr(page, P.x + P.tw, P.y - P.E / 2 + 0.01, P.E / 2)],
  west:  [await scr(page, P.x - P.E / 2 + 0.01, P.y, P.E / 2),   await scr(page, P.x + P.tw - P.E / 2 + 0.01, P.y, P.E / 2)],
};
const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const topLuma = {};
for (const [p, tol, label] of [[0.5, 1, 'golden'], [0.1, 3, 'morning'], [0.95, 3, 'night']]) {
  await page.evaluate(p => window.applyTimeOfDay(window.__map, p, true), p);
  await page.waitForTimeout(1800);        // the light eases over 300 ms; the atlas lands later
  const v = await sample(page, [faces.top[0], faces.top[1], faces.south[0], faces.south[1], faces.west[0], faces.west[1]], 2);
  const d = { top: maxd(v[0], v[1]), south: maxd(v[2], v[3]), west: maxd(v[4], v[5]) };
  topLuma[label] = luma(v[0]);
  check(`p=${p} (${label}): mesh cube = fill-extrusion twin on top, south and west faces within ${tol}/255`,
    d.top <= tol && d.south <= tol && d.west <= tol,
    `top ${rgb(v[0])} vs ${rgb(v[1])} | south ${rgb(v[2])} vs ${rgb(v[3])} | west ${rgb(v[4])} vs ${rgb(v[5])} — max Δ ${Math.max(d.top, d.south, d.west)}`);
  await shot(page, `lawn-${label}`);
}
check('the mesh follows the slider: top luma morning > golden > night', topLuma.morning > topLuma.golden + 5 && topLuma.golden > topLuma.night + 20, `luma ${topLuma.morning.toFixed(1)} > ${topLuma.golden.toFixed(1)} > ${topLuma.night.toFixed(1)}`);
await page.evaluate(() => window.applyTimeOfDay(window.__map, 0.5, true)); await page.waitForTimeout(1500);

// raycast
const ray = await page.evaluate(([pt, E]) => { const h = window.slopes.raycast(pt[0], pt[1]); return { hit: h && h.object.name, z: h && h.point.z, sky: window.slopes.raycast(4, 4) }; }, [faces.top[0], P.E]);
check('slopes.raycast() at the cube top hits the cube at its height; at the sky it is null', ray.hit === 'parity' && Math.abs(ray.z - P.E) < 0.05 && ray.sky === null, `hit ${ray.hit} at z ${ray.z && ray.z.toFixed(3)} (cube ${P.E}); sky → ${ray.sky}`);

// lathe: visible, and its segments follow the preset
const lathe = await page.evaluate(() => { const s = window.slopes; const o = s.debugGroup.getObjectByName('lathe'); const S = window.SLOPES; return { x: o.position.x, y: o.position.y, h: S.debugLatheH, seg: o.userData.segments, detail: s.detail(), preset: window.GFX.preset }; });
await pose(page, [-97.7395, 30.2839], zoomFor(45, 55, 30.2839), 55, 0);
const apex = await scr(page, lathe.x, lathe.y, lathe.h * 0.7);
const apexOn = (await sample(page, [apex], 2))[0]; await setOn(page, false); const apexOff = (await sample(page, [apex], 2))[0]; await setOn(page, true);
check('the debug lathe (LatheGeometry rotated to Z-up) is drawn', maxd(apexOn, apexOff) >= 20, `on ${rgb(apexOn)} vs off ${rgb(apexOff)} at its flank`);
await shot(page, 'lathe');
const pre = await page.evaluate(async () => {
  const s = window.slopes; const before = s.debugGroup.getObjectByName('lathe').userData.segments;
  window.GFX.preset = 'performance'; window.applyGraphics(); await new Promise(r => setTimeout(r, 400));
  const perf = { detail: s.detail(), seg: s.debugGroup.getObjectByName('lathe').userData.segments };
  window.GFX.preset = 'balanced'; window.applyGraphics(); await new Promise(r => setTimeout(r, 400));
  const bal = { detail: s.detail(), seg: s.debugGroup.getObjectByName('lathe').userData.segments };
  return { before, perf, bal, byPreset: window.SLOPES.byPreset };
});
check('the graphics preset drives slopes.detail() and the lathe rebuilds at that density',
  pre.perf.detail === pre.byPreset.performance && pre.bal.detail === pre.byPreset.balanced && pre.perf.seg === Math.round(pre.before * pre.byPreset.performance) && pre.bal.seg === pre.before,
  `performance → detail ${pre.perf.detail}, ${pre.perf.seg} segments; balanced → ${pre.bal.detail}, ${pre.bal.seg} (was ${pre.before})`);

// depth: the Tower from the south, then from the north
await pose(page, TOWER, zoomFor(70, 75, TOWER[1]), 75, 0);
const B = await page.evaluate(() => { const g = window.slopes.debugGroup; const b = g.getObjectByName('behind'), f = g.getObjectByName('front'); const S = window.SLOPES; return { b: [b.position.x, b.position.y, S.debugBehind.d, S.debugBehind.h], f: [f.position.x, f.position.y, S.debugFront.d, S.debugFront.h] }; });
const bC = await scr(page, B.b[0], B.b[1] - B.b[2] / 2 + 0.01, B.b[3] / 2), fC = await scr(page, B.f[0], B.f[1] - B.f[2] / 2 + 0.01, B.f[3] / 2);
let on = await sample(page, [bC, fC], 2); await setOn(page, false); let off = await sample(page, [bC, fC], 2); await setOn(page, true);
check('a slab behind the Tower is hidden by it: the Tower\'s pixel is identical with the layer on and off', maxd(on[0], off[0]) <= 1, `behind-slab centre ${rgb(on[0])} on vs ${rgb(off[0])} off`);
check('a slab in front of the Tower hides it: the pixel changes with the layer on', maxd(on[1], off[1]) >= 20, `front-slab centre ${rgb(on[1])} on vs ${rgb(off[1])} off`);
await shot(page, 'tower-south'); await setOn(page, false); await shot(page, 'tower-south-off'); await setOn(page, true);
await pose(page, TOWER, zoomFor(70, 75, TOWER[1]), 75, 180);
const bN = await scr(page, B.b[0], B.b[1] + B.b[2] / 2 - 0.01, B.b[3] / 2);
on = await sample(page, [bN], 2); await setOn(page, false); off = await sample(page, [bN], 2); await setOn(page, true);
check('...and from the north the same slab is there (so it was the Tower hiding it, not a no-draw)', maxd(on[0], off[0]) >= 20, `behind-slab north face ${rgb(on[0])} on vs ${rgb(off[0])} off`);
await shot(page, 'tower-north');

// haze: the far pair
await pose(page, [TOWER[0], 30.2900], zoomFor(120, 80, 30.29), 80, 0);
const X = await page.evaluate(() => { const o = window.slopes.debugGroup.getObjectByName('far'); const S = window.SLOPES.debugFar; return { x: o.position.x, y: o.position.y, gap: S.gap, h: S.h, d: S.d }; });
const farM = await scr(page, X.x, X.y - X.d / 2 + 0.01, X.h / 2), farT = await scr(page, X.x + X.gap, X.y - X.d / 2 + 0.01, X.h / 2);
const hOn = await sample(page, [farM, farT], 1);
await page.evaluate(() => { window.HAZE_TUNE.on = false; window.__map.triggerRepaint(); }); await page.waitForTimeout(800);
const hOff = await sample(page, [farM, farT], 1);
await page.evaluate(() => { window.HAZE_TUNE.on = true; window.__map.triggerRepaint(); }); await page.waitForTimeout(800);
check('2.5 km out, the fog ladder tints a mesh post and an extrusion post identically (within 2/255)', maxd(hOn[0], hOn[1]) <= 2 && maxd(hOff[0], hOff[1]) <= 2, `haze on: mesh ${rgb(hOn[0])} twin ${rgb(hOn[1])} | off: mesh ${rgb(hOff[0])} twin ${rgb(hOff[1])}`);
check('...and the fog is really doing something there', maxd(hOn[0], hOff[0]) >= 8, `mesh post moved by ${maxd(hOn[0], hOff[0])}/255 when the haze was switched off`);
await shot(page, 'far');

// lod: climb until the mid tier drops, and the mesh with it
const lodPose = [-97.7394, 30.2846];
await pose(page, lodPose, zoomFor(850, 60, 30.2846), 60, 0);
const lod = await page.evaluate(async () => {
  const m = window.__map, s = window.slopes;
  const alt = () => { try { const a = window.__fly && window.__fly.eye().alt; if (isFinite(a) && a > 0) return a; } catch (e) {} return m.transform.cameraToCenterDistance / m.transform.pixelsPerMeter; };
  const groups = () => { const o = {}; for (const g of s.stats().groups) o[g.name] = g.visible; return o; };
  const state = () => ({ alt: +alt().toFixed(0), roofs: m.getLayoutProperty('roofs-pitched', 'visibility') || 'visible', meshHidden: window.LOD_isHidden('slopes-mesh'), meshVisible: s.layer.isVisible(), custVis: m.getLayoutProperty('slopes-mesh', 'visibility') || 'visible', frames: s.frames, groups: groups(), domeFilter: JSON.stringify(m.getFilter('capitol-dome') || null) });
  window.GFX.renderDistance = 700; window.applyLOD(m); await new Promise(r => setTimeout(r, 500));
  const hidden = state();
  // The layer must still be RENDERING while LOD holds it down — that is the
  // whole point of the per-group contract, and a frame counter that has
  // stopped is how the dome disappeared on 2026-09-02.
  m.triggerRepaint(); await new Promise(r => setTimeout(r, 500));
  const hiddenLater = state();
  window.GFX.renderDistance = 1500; window.applyLOD(m); await new Promise(r => setTimeout(r, 500));
  const shown = state();
  window.GFX.renderDistance = 700; window.applyLOD(m); await new Promise(r => setTimeout(r, 500));
  return { hidden, hiddenLater, shown };
});
const P2 = await scr(page, P.x, P.y, P.E - 0.01);
const cubeHidden = (await sample(page, [P2], 1))[0];
await page.evaluate(async () => { window.GFX.renderDistance = 1500; window.applyLOD(window.__map); await new Promise(r => setTimeout(r, 500)); });
const cubeShown = (await sample(page, [P2], 1))[0];
// THE CONTRACT CHANGED ON 2026-09-02 and this is where it is asserted. It used
// to read `custVis === 'none'`: js/lod.js wrote layout visibility on the custom
// layer as well as calling setVisible. MapLibre 5.24 honours that by never
// calling render() again — and render() is where this layer decides PER GROUP,
// so the Capitol dome (no tier, `lod: null`) went with the roofs and there was
// no dome at all, its 18+7+4 discs still held down by the layer's own filter.
// Now lod.js tells the layer and ONLY tells the layer: visibility stays
// 'visible' at every altitude, render() keeps running, and the groups answer
// for themselves.
check('at altitude past the render distance the mesh is hidden with roofs-pitched',
  lod.hidden.alt > 700 * 1.08 && lod.hidden.roofs === 'none' && lod.hidden.meshHidden === true && lod.hidden.meshVisible === false && lod.hidden.custVis === 'visible',
  `alt ${lod.hidden.alt} m, D=700: roofs-pitched ${lod.hidden.roofs}, LOD_isHidden(slopes-mesh) ${lod.hidden.meshHidden}, layer.isVisible ${lod.hidden.meshVisible}, visibility '${lod.hidden.custVis}' (must stay 'visible' — lod.js never writes it)`);
check('...and the layer is still RENDERING while it is hidden, so the per-group verdict can be given',
  lod.hiddenLater.frames > lod.hidden.frames,
  `frames ${lod.hidden.frames} -> ${lod.hiddenLater.frames} over one repaint while LOD_isHidden is true`);
check('...the roofs group goes with roofs-pitched and the DOME STAYS ON THE SKYLINE',
  lod.hidden.groups['slopes-roofs'] === false && lod.hidden.groups['slopes-dome'] === true,
  `groups at D=700: ${JSON.stringify(lod.hidden.groups)}`);
// The other half of the 2026-09-02 dome defect, and the half that made it
// INVISIBLE rather than merely wrong: while the layer was held down, the
// eighteen stacked discs it stands in for were STILL filtered out of
// capitol-dome. Neither shape was on the skyline. Whatever the layer does at
// altitude, the filter it installed must keep matching the group that is
// still drawing — so the discs stay hidden exactly as long as the dome mesh
// is there to replace them.
check('...and the stand-in discs stay filtered out while the dome group draws, so the skyline is never empty',
  lod.hidden.groups['slopes-dome'] === true && /bullock-dome/.test(lod.hidden.domeFilter),
  `at D=700 the dome group is ${lod.hidden.groups['slopes-dome']} and capitol-dome's filter is ${lod.hidden.domeFilter}`);
check('...and every group is back when the slider is at the top',
  lod.shown.groups['slopes-roofs'] === true && lod.shown.groups['slopes-dome'] === true,
  `groups at D=1500: ${JSON.stringify(lod.shown.groups)}`);
check('...and the slider top brings both back', lod.shown.roofs === 'visible' && lod.shown.meshHidden === false && lod.shown.meshVisible === true, `D=1500: roofs-pitched ${lod.shown.roofs}, LOD_isHidden ${lod.shown.meshHidden}, isVisible ${lod.shown.meshVisible}`);
check('...measured on the cube itself: its pixel is the ground while hidden and the cube when shown', maxd(cubeHidden, cubeShown) >= 15, `cube top ${rgb(cubeHidden)} hidden vs ${rgb(cubeShown)} shown`);
await shot(page, 'lod-altitude');
await page.evaluate(() => { window.GFX.renderDistance = 700; });
await pose(page, lodPose, zoomFor(60, 60, 30.2846), 60, 20);
const back = await page.evaluate(async () => { window.applyLOD(window.__map); await new Promise(r => setTimeout(r, 500)); return { roofs: window.__map.getLayoutProperty('roofs-pitched', 'visibility') || 'visible', meshHidden: window.LOD_isHidden('slopes-mesh'), vis: window.slopes.layer.isVisible() }; });
check('descending restores the mesh with the slabs', back.roofs === 'visible' && !back.meshHidden && back.vis, `roofs-pitched ${back.roofs}, LOD_isHidden ${back.meshHidden}, isVisible ${back.vis}`);

// ═══════════════════════════════════════════════════════════════════════
// 1b. The generators: real shapes, from pixels.
// ═══════════════════════════════════════════════════════════════════════
const GREGORY = { center: [-97.7365, 30.2845], zoom: 17.722, pitch: 50, bearing: 90 };
const BATTLE = { center: [-97.74095, 30.28495], zoom: 19.765, pitch: 65, bearing: 200 };
const BATTLE_DOOR = { center: [-97.74015, 30.28541], zoom: 21.17, pitch: 75, bearing: 270 };
await page.evaluate(() => window.GFX.renderDistance = 1500);
await page.waitForFunction(() => window.slopesRoofs && window.slopesRoofs.count.roofs > 0 && window.slopesArches && window.slopesArches.count.done && window.slopesDome && window.slopesDome.count.done
  && window.slopesRoofs.extras.every(x => x.ready), null, { timeout: 90000 }).catch(() => {});
const gen = await page.evaluate(() => {
  const m = window.__map;
  const names = window.slopes.root.children.map(g => g.name);
  return { roofs: window.slopesRoofs.count, arches: window.slopesArches.count, dome: window.slopesDome.count, names,
           filters: { roofs: JSON.stringify(m.getFilter('roofs-pitched') || null), portal: JSON.stringify(m.getFilter('entrances-portal') || null), glass: JSON.stringify(m.getFilter('entrances-glass') || null), dome: JSON.stringify(m.getFilter('capitol-dome') || null) } };
});
// Since 2026-09-03 the roofs generator also draws the Main Building's three
// hips from data/tower.geojson's rig into a fourth group, `slopes-tower`
// (SLOPES_ROOFS.extra), and most campus roofs run to their ridge
// (count.full) instead of stopping at a deck. Since round 5 (same day) the
// bake also tags the footprints that are FLAT roofs carrying tiled parts
// (count.flat, 8 on the shipped rig: Welch, the Union, Painter, Hogg
// Auditorium, Seay, the three Jesters) and writes their parts as roofs of
// their own (count.parts, 11) — so `roofs` counts the entries DRAWN (115:
// 112 + 11 parts − 8 flat) and `full` the ones to a ridge (104).
// Since round 6 (same day) every roof also carries its ridge, hip and valley
// COURSES (count.lines — 1,780 on the shipped rig, 22 more on the Main
// Building's three arms; SLOPES_ROOFS.lines).
check('the generators built: roofs + gable (most of them to a ridge, the flat ones as their parts, all of them with their courses), 24 arches, 3 dome parts, the three hips of the Main Building, each a group in the scene',
  gen.roofs.roofs >= 100 && gen.roofs.full >= 80 && gen.roofs.flat >= 4 && gen.roofs.parts >= 6 && gen.roofs.lines >= COURSES_MIN && gen.roofs.gables === 1 && gen.arches.arches === 24 && gen.dome.parts === 3
  && gen.roofs.extra && gen.roofs.extra['slopes-tower'] && gen.roofs.extra['slopes-tower'].roofs === 3 && gen.roofs.extra['slopes-tower'].lines >= 12
  && WANT_GROUPS.every(n => gen.names.includes(n)),
  `${gen.roofs.roofs} roofs (${gen.roofs.full} to their ridge; ${gen.roofs.flat} flat, drawn as ${gen.roofs.parts} parts; ${gen.roofs.lines} courses) + ${gen.roofs.gables} gable (${gen.roofs.triangles} tris, ${gen.roofs.ms} ms), ${gen.arches.arches} arches (${gen.arches.triangles} tris), ${gen.dome.parts} dome parts (${gen.dome.triangles} tris), tower ${JSON.stringify(gen.roofs.extra && gen.roofs.extra['slopes-tower'])}; groups ${gen.names.join(', ')}`);
// ONE FETCH. data/entrances.geojson is 6.4 MB on the wire and TWO passes want
// it: js/entrances.js draws the doors from it, js/slopes-arches.js lathes the
// arched heads from its `arches` member. Until 2026-09-04 they each downloaded
// it — the arches pass tried to recover the parsed object from
// `map.getSource('austin-entrances')._data.arches` and fell back to its own
// fetch, and the fallback fired EVERY time, because MapLibre 5.24.0 stores
// `_data = { geojson: <your object> }` rather than the object itself. An ON
// page was 25.04 MB against ?slopes=0's 18.67 MB, and that 6.4 MB was the
// whole of the layer's page delta (CDP encodedDataLength, cold, 2026-09-04).
// js/entrances.js now publishes what it parsed as `window.entrancesGeoJSON()`
// and the arches await it. This line is placed AFTER the built check on
// purpose: 24 arches in the scene means slopes-arches got its data, so a
// second request would already have been made by now.
const entReq = page.__requests.filter(u => /\/data\/entrances\.geojson(\?|$)/.test(u));
check('data/entrances.geojson is downloaded ONCE — the arches read the file js/entrances.js parsed and do not fetch 6.4 MB again',
  entReq.length === 1, `${entReq.length} request(s) for data/entrances.geojson on this page`);

check('the stand-ins are filtered out: roofs-pitched keeps only its f tags, entrances exclude arc, capitol-dome excludes the lathed parts',
  ROOFS_FILTER_RE.test(gen.filters.roofs.replace(/\s/g, '')) && /has","arc/.test(gen.filters.portal) && /has","arc/.test(gen.filters.glass) && /bullock-dome/.test(gen.filters.dome),
  `roofs ${gen.filters.roofs} | portal …${gen.filters.portal.slice(-40)} | dome ${gen.filters.dome}`);
const restored = await page.evaluate(async () => {
  const m = window.__map;
  window.SLOPES.on = false; await new Promise(r => setTimeout(r, 300));
  const off = { roofs: m.getFilter('roofs-pitched') || null, portal: JSON.stringify(m.getFilter('entrances-portal') || null), glass: JSON.stringify(m.getFilter('entrances-glass') || null), dome: m.getFilter('capitol-dome') || null, groups: window.slopes.root.children.map(g => g.name),
                tower: JSON.stringify(m.getFilter('tower-solid') || null), cap: JSON.stringify(m.getPaintProperty('buildings-roof', 'fill-extrusion-color') || null) };
  window.SLOPES.on = true; await new Promise(r => setTimeout(r, 300));
  return off;
});
check('SLOPES.on = false puts every filter back (roofs-pitched and capitol-dome to none, the entrance layers and tower-solid to their own), the cap colour to the hour it had, and takes the groups out',
  restored.roofs === null && restored.dome === null && !/arc/.test(restored.portal) && !/arc/.test(restored.glass) && /"k"/.test(restored.portal)
  && !/"kind"\],"roof"/.test(restored.tower) && !/^\["match","\["get","id"/.test(restored.cap) && /^\["interpolate"/.test(restored.cap)
  && !restored.groups.some(n => /slopes-(roofs|arches|dome|tower)/.test(n)),
  `off: roofs ${restored.roofs}, dome ${restored.dome}, portal …${restored.portal.slice(-60)}, tower ${restored.tower}, cap ${restored.cap.slice(0, 40)}…, groups [${restored.groups.join(', ')}]`);

// ridge: the hipped roof the light separates best, near the frame's centre
await pose(page, GREGORY.center, GREGORY.zoom, GREGORY.pitch, GREGORY.bearing);
const ridge = await page.evaluate(() => {
  const S = window.slopes, R = window.slopesRoofs.data, meta = R.meta, cv = window.__map.getCanvas();
  const L = S.light().enu, Ln = Math.hypot(...L);
  const cands = [];
  for (const key of Object.keys(R.roofs)) {
    const r = R.roofs[key]; const M = r.pts.length;
    if (M !== 4 || !r.deck || r.flat) continue;              // a plain hip: four corners, a ridge or a narrow deck (a `flat` entry draws no roof of its own — round 5)
    const at = (k, d) => { const c = Math.min(d, r.caps[k]); const l = S.toLocal((r.pts[k][0] + r.rays[k][0] * c) * r.dpm[0], (r.pts[k][1] + r.rays[k][1] * c) * r.dpm[1], 0); return [l.x, l.y]; };
    const z = d => r.base + meta.lip + r.rise * d / r.d;
    const edges = r.spans.map(([a, b]) => { const p = r.pts[a], q = r.pts[b % M]; const dx = q[0] - p[0], dy = q[1] - p[1], Lw = Math.hypot(dx, dy); return { a, b: b % M, L: Lw, n: [dy / Lw, -dx / Lw] }; }).sort((x, y) => y.L - x.L);
    if (edges[0].L < 25) continue;
    const pitch = Math.atan2(r.rise, r.d);
    const lit = e => { const n = [e.n[0] * Math.sin(pitch), e.n[1] * Math.sin(pitch), Math.cos(pitch)]; return Math.max(0, Math.min(1, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]))); };
    const mid = (e, f) => { const d = r.d * f; const A = at(e.a, d), B = at(e.b, d); return { x: (A[0] + B[0]) / 2, y: (A[1] + B[1]) / 2, z: z(d) }; };
    const scr = p => { const s = S.project(p.x, p.y, p.z); return s && s.x > 40 && s.x < cv.clientWidth - 40 && s.y > 80 && s.y < cv.clientHeight - 80 ? [s.x, s.y] : null; };
    const A = mid(edges[0], 0.5), B = mid(edges[1], 0.5);
    const sa = scr(A), sb = scr(B);
    if (!sa || !sb) continue;
    const dl = Math.abs(lit(edges[0]) - lit(edges[1]));
    const along = [0.12, 0.3, 0.5, 0.7, 0.88].map(f => { const p = mid(edges[0], f); return { px: scr(p), z: p.z, d: r.d * f }; });
    if (along.some(a => !a.px)) continue;
    const c = Math.hypot(sa[0] - cv.clientWidth / 2, sa[1] - cv.clientHeight / 2);
    cands.push({ key, name: r.name, dl, sa, sb, along, pitch: r.rise / r.d, centre: c, base: r.base, rise: r.rise, dUse: r.d });
  }
  cands.sort((x, y) => (y.dl - x.dl) || (x.centre - y.centre));
  return cands[0] || null;
});
if (!ridge) check('a hipped roof is in the gregory frame', false, 'no four-corner roof with both long slopes on screen');
else {
  const pts = [ridge.sa, ridge.sb].concat(ridge.along.map(a => a.px));
  const on = await sample(page, pts, 1);
  const rc = await page.evaluate(pts => pts.map(([x, y]) => { const h = window.slopes.raycast(x, y); return h ? { o: h.object.name, z: +h.point.z.toFixed(3) } : null; }), ridge.along.map(a => a.px));
  await setOn(page, false); const off = await sample(page, pts, 1); await setOn(page, true);
  const lA = luma(on[0]), lB = luma(on[1]);
  const alongL = on.slice(2).map(luma);
  const spread = Math.max(...alongL) - Math.min(...alongL);
  check(`ridge: ${ridge.name}'s two long slopes read as two tones either side of the ridge`, Math.abs(lA - lB) >= 6,
    `slope A ${rgb(on[0])} (luma ${lA.toFixed(1)}) vs slope B ${rgb(on[1])} (luma ${lB.toFixed(1)}); predicted lit difference ${ridge.dl.toFixed(2)}; slabs read ${rgb(off[0])} / ${rgb(off[1])}`);
  check('...and one slope is one tone from the eave to the ridge (a plane, not five treads)', spread <= 8,
    `luma along the slope ${alongL.map(v => v.toFixed(0)).join(' ')} (spread ${spread.toFixed(1)}); the slabs there ${off.slice(2).map(rgb).join(' | ')}`);
  const zs = rc.map(h => h && h.z);
  const hits = rc.every(h => h && h.o === 'roofs');
  const climbs = hits && zs.every((z, i) => i === 0 || z > zs[i - 1] + 0.05);
  const want = ridge.along.map(a => a.z);
  const err = hits ? Math.max(...zs.map((z, i) => Math.abs(z - want[i]))) : 1e9;
  check('...and a raycast down the slope climbs continuously at the rig\'s own pitch', climbs && err < 0.35,
    `hits ${rc.map(h => h ? h.o + '@' + h.z : 'none').join(', ')}; expected z ${want.map(v => v.toFixed(2)).join(', ')} (base ${ridge.base}, rise ${ridge.rise} over ${ridge.dUse} m: ${(ridge.pitch * 12).toFixed(1)}:12); worst ${err.toFixed(2)} m`);
  await shot(page, 'ridge-gregory');
}

// arch: the arched door nearest the frame's centre at the battle-street pose,
// then the same door from the street.
//
// THREE ASSERTIONS, and the point of all three is to separate a curve from the
// five chords it replaces — not to describe the curve in a way the chords also
// satisfy. See ARCH_* at the top of this file for the chord's own geometry.
//
//   1. WHERE the surround is. ARCH_SAMPLES raycasts walk the head from
//      ARCH_TH0 to ARCH_TH1 degrees; each must land on the arches mesh within
//      ARCH_ON_ELLIPSE_M of the exact ellipse the bake wrote. The same samples
//      are measured against the five-chord staircase and the two numbers are
//      printed side by side: the mesh must be ARCH_CHORD_RATIO times closer.
//      A staircase cannot pass this — its half width is constant through a
//      whole tier while the ellipse's is not — so no separate plateau test is
//      needed on top of it.
//   2. PIXELS, where the two shapes disagree. ARCH_PROBES points are chosen on
//      the curve that lie at least ARCH_PROBE_CLEAR outside the chords' own
//      band at the same height: surround on the mesh, something else on the
//      chords. Swapping the mesh back for the chords must MOVE those pixels.
//   3. The head as a whole differs from the chord frame (the grid test, kept).
async function archTest(P, label, minPx) {
  await pose(page, P.center, P.zoom, P.pitch, P.bearing);
  const A = await page.evaluate(([N, TH0, TH1, TIERS, GAP, UMIN, NPROBE]) => {
    const S = window.slopes, D = window.slopesArches.data, cv = window.__map.getCanvas();
    const R = Math.PI / 180;
    let best = null;
    for (const eid of Object.keys(D)) {
      const a = D[eid]; if (!a.band) continue;
      const F = S.frame(a.o, a.t, a.n);
      const sw = a.band.sw, v = a.band.v[1] + 0.005;   // a hair proud, so the ray lands on the band's face
      // the band's MIDLINE at angle th, in the opening's own (u, v, z) frame
      const uz = th => { const w = a.half * Math.cos(th); return [w + (w >= 0 ? sw / 2 : -sw / 2), a.spring + a.rise * Math.sin(th)]; };
      // the FIVE CHORDS at the same height: half width frozen at the tier's mid t
      const chordU = z => { const t = Math.max(0, Math.min(1, (z - a.spring) / a.rise));
        const i = Math.min(TIERS - 1, Math.floor(t * TIERS)), tm = (i + 0.5) / TIERS;
        const w = a.half * Math.sqrt(Math.max(0, 1 - tm * tm)); return [w, w + sw]; };
      // the MESH's own surround at the same height: intrados to extrados.
      // SLOPES_ARCHES.radial says which extrados js/slopes-arches.js drew.
      const radial = window.SLOPES_ARCHES.radial !== false;
      const uin = z => { const t = Math.max(0, Math.min(1, (z - a.spring) / a.rise)); return a.half * Math.sqrt(Math.max(0, 1 - t * t)); };
      const uout = z => { if (!radial) return uin(z) + sw;
        const t = Math.max(0, Math.min(1, (z - a.spring) / (a.rise + sw))); return (a.half + sw) * Math.sqrt(Math.max(0, 1 - t * t)); };
      const ths = []; for (let i = 0; i < N; i++) ths.push((TH0 + (TH1 - TH0) * i / (N - 1)) * R);
      const rows = ths.map(th => {
        const uzv = uz(th), u = uzv[0], z = uzv[1];
        const p = F.at(u, v, z); const sp = S.project(p[0], p[1], p[2]);
        const cu = chordU(z), c0 = cu[0], c1 = cu[1], au = Math.abs(u);
        // how far the chord's own band midline is from the ellipse's, in metres
        const err = Math.abs(au - (c0 + c1) / 2);
        // WHERE THE TWO SHAPES DISAGREE at this height: the mesh's surround
        // runs [i0, i1]; the chords' runs [c0, c1]. Take the wider of the two
        // non-overlapping stretches, off the keystone's centreline.
        const i0 = uin(z), i1 = uout(z);
        const cand = [[i0, Math.min(i1, c0)], [Math.max(i0, c1), i1]]
          .map(g => ({ w: g[1] - g[0], u: (g[0] + g[1]) / 2 }))
          .filter(g => g.w >= GAP && g.u >= UMIN)
          .sort((x, y) => y.w - x.w)[0] || null;
        let probe = null;
        if (cand) { const pw = F.at(Math.sign(u || 1) * cand.u, v, z); const ps = S.project(pw[0], pw[1], pw[2]);
                    if (ps && ps.w > 0) probe = { px: [ps.x, ps.y], u: +cand.u.toFixed(2), gap: +cand.w.toFixed(2) }; }
        return { th: th / R, u: u, z: z, world: p, s: sp && [sp.x, sp.y], ok: !!(sp && sp.w > 0), err: err, probe: probe };
      });
      if (rows.some(r => !r.ok)) continue;
      const xs = rows.map(r => r.s[0]), ys = rows.map(r => r.s[1]);
      const cx = xs.reduce((p, q) => p + q, 0) / xs.length, cy = ys.reduce((p, q) => p + q, 0) / ys.length;
      if (cx < 60 || cx > cv.clientWidth - 60 || cy < 80 || cy > cv.clientHeight - 80) continue;
      const c = Math.hypot(cx - cv.clientWidth / 2, cy - cv.clientHeight / 2);
      if (best && c >= best.centre) continue;
      const g = F.at(0, a.tr ? a.tr.v[1] + 0.005 : v, a.spring + a.rise * 0.45); const gs = S.project(g[0], g[1], g[2]);
      const span = Math.hypot(rows[0].s[0] - rows[N - 1].s[0], rows[0].s[1] - rows[N - 1].s[1]);
      // the probes: spread EVENLY through the qualifying heights, so they are
      // not all bunched at the crown where one keystone could answer for all six
      const qual = rows.filter(r => r.probe);
      const probes = qual.length <= NPROBE ? qual
        : Array.from({ length: NPROBE }, (_, k) => qual[Math.round(k * (qual.length - 1) / (NPROBE - 1))]);
      best = { eid: eid, ref: a.ref, centre: c, span: span, half: a.half, rise: a.rise, sw: sw,
               pts: rows.map(r => r.s), world: rows.map(r => r.world),
               chordErr: rows.map(r => r.err),
               qual: qual.length,
               probes: probes.map(r => ({ px: r.probe.px, th: +r.th.toFixed(0), u: r.probe.u, gap: r.probe.gap })),
               glass: gs && [gs.x, gs.y] };
    }
    return best;
  }, [ARCH_SAMPLES, ARCH_TH0, ARCH_TH1, ARCH_TIERS, ARCH_PROBE_GAP, ARCH_PROBE_UMIN, ARCH_PROBES]);
  if (!A) { check(`an arched door is in the ${label} frame`, false, 'none on screen'); return; }

  // 1. the curve, from ARCH_SAMPLES raycasts
  const rc = await page.evaluate(([pts, world]) => pts.map(([x, y], i) => {
    const h = window.slopes.raycast(x, y); if (!h) return null; const w = world[i];
    return { o: h.object.name, d: +Math.hypot(h.point.x - w[0], h.point.y - w[1], h.point.z - w[2]).toFixed(4) };
  }), [A.pts, A.world]);
  const misses = rc.filter(h => !h || h.o !== 'arches').length;
  const meshErr = misses ? Infinity : Math.max(...rc.map(h => h.d));
  const chordErr = Math.max(...A.chordErr);
  check(`arch (${label}): ${A.ref}'s head is the ellipse and not the five chords — ${ARCH_SAMPLES} raycasts across the surround (${A.span.toFixed(0)} px across)`,
    misses === 0 && meshErr <= ARCH_ON_ELLIPSE_M && meshErr * ARCH_CHORD_RATIO <= chordErr,
    misses ? `${misses} of ${ARCH_SAMPLES} rays did not land on the arches mesh: ${rc.map(h => h ? h.o : 'none').join(' ')}`
           : `eid ${A.eid}, half ${A.half} rise ${A.rise} sw ${A.sw}: the mesh is off the ellipse by at most ${(meshErr * 100).toFixed(1)} cm over ${ARCH_TH0}°..${ARCH_TH1}°, where the ${ARCH_TIERS} chords are off by ${(chordErr * 100).toFixed(1)} cm — ${(chordErr / Math.max(1e-6, meshErr)).toFixed(0)}x closer, tolerance ${(ARCH_ON_ELLIPSE_M * 100).toFixed(0)} cm`);

  // 2. pixels, at the places the two shapes disagree about
  const probePts = A.probes.map(p => p.px);
  const onP = probePts.length ? await sample(page, probePts, 1) : [];
  await setOn(page, false);
  const offP = probePts.length ? await sample(page, probePts, 1) : [];
  // 3. the head as a whole, on vs off
  const box = (() => { const xs = A.pts.map(p => p[0]), ys = A.pts.map(p => p[1]); return [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4]; })();
  const grid = []; for (let y = box[1]; y <= box[3]; y += 2) for (let x = box[0]; x <= box[2]; x += 2) grid.push([x, y]);
  const gOff = await sample(page, grid, 0); await setOn(page, true); const gOn = await sample(page, grid, 0);
  const changed = grid.filter((_, i) => maxd(gOn[i], gOff[i]) > 10).length;

  const moved = probePts.map((_, i) => Math.abs(luma(onP[i]) - luma(offP[i])));
  const nMoved = moved.filter(d => d >= ARCH_PROBE_DELTA).length;
  check(`arch (${label}): the curve is surround where the chords are not — ${ARCH_PROBES} pixels off the staircase move when the chords come back`,
    probePts.length >= ARCH_PROBES && nMoved >= ARCH_PROBE_MIN,
    probePts.length < ARCH_PROBES ? `only ${A.qual} of ${ARCH_SAMPLES} heights disagree by ${ARCH_PROBE_GAP} m outside u=${ARCH_PROBE_UMIN} — the chords track this arch too closely to probe`
      : `${nMoved} of ${probePts.length} moved by >= ${ARCH_PROBE_DELTA}/255 luma (${A.qual} of ${ARCH_SAMPLES} heights qualified): ` + A.probes.map((p, i) => `${p.th}° u${p.u} gap${p.gap} ${rgb(onP[i])}->${rgb(offP[i])} d${moved[i].toFixed(0)}`).join(', '));

  check(`arch (${label}): the frame differs from the chord frame over the door's head`, changed >= Math.max(3, grid.length * 0.03),
    `${changed} of ${grid.length} grid points over the head differ by more than 10/255 between curve and chords${A.span < minPx ? ' — at ' + A.span.toFixed(0) + ' px the curve and the chords are within a pixel of each other over much of the band; the closer pose below is the visual proof' : ''}`);
  await shot(page, `arch-${label}`);
}
if (BREAK) {
  // The sabotage the arch lines are watched failing under: the page draws the
  // FIVE CHORDS again — the mesh gone, the entrance layers' own filters back.
  // That is exactly the regression these three assertions exist to catch, so
  // all three must go red, at both poses.
  await page.evaluate(() => { window.SLOPES_ARCHES.on = false; window.applySlopesArches(window.__map); });
  await page.waitForTimeout(800);
  console.log('--break: SLOPES_ARCHES.on = false — the arched heads are five chords again');
}
await archTest(BATTLE, 'battle-street', 120);
await archTest(BATTLE_DOOR, 'battle-door', 120);
await page.evaluate(() => window.GFX.renderDistance = 700);
await page.close();

// ═══════════════════════════════════════════════════════════════════════
// 2. The switch, on the REAL page (no debug scene): off is today.
// ═══════════════════════════════════════════════════════════════════════
const MALL = { center: [-97.7393, 30.2856], zoom: 17.48, pitch: 55, bearing: 0 };   // the pass's mall-cruise pose
const FILTERED = ['roofs-pitched', 'entrances-portal', 'entrances-glass', 'capitol-dome'];
const tmp = SHOTS || fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || '.', 'slopes-'));
const snap = async (pg, name) => {
  const f = path.join(tmp, `${name}.png`);
  await pg.screenshot({ path: f }); await pg.waitForTimeout(300); await pg.screenshot({ path: f });
  return f;
};
async function mallFrame(url, name, before) {
  const pg = await open(url);
  if (before) await before(pg);
  await pose(pg, MALL.center, MALL.zoom, MALL.pitch, MALL.bearing);
  await pg.waitForTimeout(3000); await pg.evaluate(() => window.__settle(4000));
  return { pg, f: await snap(pg, name) };
}
// Everything the page must have finished before a frame of it is worth diffing.
const settled = pg => pg.waitForFunction(() => window.slopes && window.slopes.frames > 0
  && window.slopesRoofs && window.slopesRoofs.count.roofs > 0
  && window.slopesRoofs.extras.every(x => x.ready)          // the Main Building's rig, on its own poll
  && window.slopesArches && window.slopesArches.count.done
  && window.slopesDome && window.slopesDome.count.done, null, { timeout: 120000 });
const filtersOf = pg => pg.evaluate(ids => Object.fromEntries(ids.map(id => [id, JSON.stringify(window.__map.getFilter(id) || null)])), FILTERED);

const A = await mallFrame(`${SERVER}/index.html?intro=0&drift=0`, 'switch-on', async pg => {
  await settled(pg);
  if (BREAK) {
    // the round-5 sabotage: the band-and-plate back on every flat roof, so
    // the `flat roofs` line below must go red (the plate is back at its height)
    // ...and the round-6 sabotage: no courses, so the `courses` line below
    // must go red (the raycast lands on the bare ridge, nothing pale there)
    await pg.evaluate(() => { window.SLOPES_ROOFS.flatRoofs = false; window.SLOPES_ROOFS.lines.on = false; window.slopesRoofs.rebuild(); });
    await pg.waitForTimeout(800);
    console.log('--break: SLOPES_ROOFS.flatRoofs = false — the flat roofs wear their band and plate again; SLOPES_ROOFS.lines.on = false — no ridge or hip courses');
  }
});
const fNoise = await snap(A.pg, 'switch-on-again');
const onState = await A.pg.evaluate(() => ({ layer: !!window.__map.getLayer('slopes-mesh'), frames: window.slopes.frames, renderer: !!window.slopes.renderer, groups: window.slopes.root.children.map(g => g.name), gain: window.__ae().gain }));
// THE FLAT ROOFS (round 5, 2026-09-03). "Welch Hall is one giant flat brown
// lid with a wide orange tile band running round the whole perimeter ... a
// shape the building does not have." A rig entry the bake tagged `flat`
// (scripts/bake_roofs.py RIG_ROOF_PARTS: a footprint whose middle reads
// membrane, or a tile-middle one with a flat deck beside its tile block)
// draws no band and no plate; its parts are hips of their own, and its
// parapet cap is painted the flat roof's colour. Measured on the flat
// entries whose centroid is in the mall-cruise frame: a raycast at the
// centroid must NOT land on the mesh at the PLATE's height — base + lip +
// rise, exactly where round 4's band-and-plate put its lid (a flat plane,
// so the raycast's z there is exact to the centimetre) — nothing there, or
// a part's surface at some other height, both pass; and the wrapper on
// buildings-roof's colour must carry at least one deck branch (a second
// `match` output beside the eave-shadow one). --break puts the plate back.
const flat = await A.pg.evaluate(() => {
  const S = window.slopes, R = window.slopesRoofs.data, meta = R.meta, cv = window.__map.getCanvas();
  const out = [];
  for (const key of Object.keys(R.roofs)) {
    const r = R.roofs[key]; if (!r.flat) continue;
    let cx = 0, cy = 0; for (const q of r.pts) { cx += q[0]; cy += q[1]; } cx /= r.pts.length; cy /= r.pts.length;
    const l = S.toLocal(cx * r.dpm[0], cy * r.dpm[1], 0);
    const plate = r.base + meta.lip + r.rise;
    const s = S.project(l.x, l.y, plate);
    if (!s || s.w <= 0 || s.x < 40 || s.x > cv.clientWidth - 40 || s.y < 80 || s.y > cv.clientHeight - 80) continue;
    const h = S.raycast(s.x, s.y);
    out.push({ name: r.name || key, px: [Math.round(s.x), Math.round(s.y)], plate: +plate.toFixed(2), hit: h ? { o: h.object.name, z: +h.point.z.toFixed(2) } : null });
  }
  const cap = window.__map.getPaintProperty('buildings-roof', 'fill-extrusion-color');
  const deckBranches = Array.isArray(cap) && cap[0] === 'match' ? Math.max(0, (cap.length - 5) / 2) : 0;
  return { out, count: window.slopesRoofs.count, deckBranches };
});
const FLAT_PLATE_TOL_M = 0.05;
const plated = flat.out.filter(f => f.hit && f.hit.o === 'roofs' && Math.abs(f.hit.z - f.plate) < FLAT_PLATE_TOL_M);
check('flat roofs (round 5): the bake tagged some, their parts draw as hips, no flat roof in frame wears a plate at the top of a band, and the cap wrapper paints their caps the flat roof\'s colour',
  flat.count.flat >= 4 && flat.count.parts >= 6 && flat.out.length >= 2 && plated.length === 0 && flat.deckBranches >= 1,
  `${flat.count.flat} flat roofs, ${flat.count.parts} parts drawn; in frame: ${flat.out.map(f => `${f.name} @${f.px.join(',')} plate ${f.plate} -> ${f.hit ? f.hit.o + '@' + f.hit.z : 'nothing'}`).join('; ')}; ${plated.length} plated; cap wrapper deck branches ${flat.deckBranches}`);
// THE COURSES (round 6): on every plain hip in the mall-cruise frame (four
// corners, drawn to its ridge), the longest ridge's midpoint and a point 4 m
// down each slope, from the rig's own `full` profile. See COURSES_MIN above.
const courses = await A.pg.evaluate(RIDGE_PX => {
  const S = window.slopes, R = window.slopesRoofs.data, meta = R.meta, cv = window.__map.getCanvas();
  const LN = window.SLOPES_ROOFS.lines;
  const out = [];
  for (const key of Object.keys(R.roofs)) {
    const r = R.roofs[key];
    if (r.flat || !r.full || r.full.pts.length !== 4) continue;
    const F = r.full, M = 4;
    const at = (k, d) => { const c = Math.min(d, F.caps[k]); const l = S.toLocal((F.pts[k][0] + F.rays[k][0] * c) * r.dpm[0], (F.pts[k][1] + F.rays[k][1] * c) * r.dpm[1], 0); return [l.x, l.y]; };
    const zk = (k, d) => r.base + meta.lip + F.rise * Math.min(d, F.caps[k]) / F.d;
    let best = null;
    for (let k = 0; k < M; k++) { const j = (k + 1) % M; const a = at(k, F.d), b = at(j, F.d); const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!best || L > best.L) best = { k, j, L, a, b }; }
    if (!best || best.L < 8) continue;
    const mid = [(best.a[0] + best.b[0]) / 2, (best.a[1] + best.b[1]) / 2], zm = (zk(best.k, F.d) + zk(best.j, F.d)) / 2;
    const n = [(best.b[1] - best.a[1]) / best.L, -(best.b[0] - best.a[0]) / best.L], pitch = F.rise / F.d, off = 4;
    const P = [[mid[0], mid[1], zm], [mid[0] + n[0] * off, mid[1] + n[1] * off, zm - off * pitch], [mid[0] - n[0] * off, mid[1] - n[1] * off, zm - off * pitch]];
    const prj = P.map(p => { const q = S.project(p[0], p[1], p[2]); return q && q.w > 0 && q.x > 40 && q.x < cv.clientWidth - 40 && q.y > 80 && q.y < cv.clientHeight - 80 ? [q.x, q.y] : null; });
    if (prj.some(q => !q)) continue;
    // the ridge's length on screen: a ridge a few pixels long at the top of
    // the frame carries a course a fraction of a pixel wide, and says nothing
    const ea = S.project(best.a[0], best.a[1], zk(best.k, F.d)), eb = S.project(best.b[0], best.b[1], zk(best.j, F.d));
    const ridgePx = (ea && eb) ? Math.hypot(ea.x - eb.x, ea.y - eb.y) : 0;
    if (ridgePx < RIDGE_PX) continue;
    // the raycast goes through the EXACT projected point (a pixel's rounding
    // is 0.6 m along the view at this pose — off the box's 1.0 m top and on
    // to its side); the samples below need whole pixels
    const h = S.raycast(prj[0][0], prj[0][1]);
    out.push({ name: r.name || key, px: prj.map(q => [Math.round(q[0]), Math.round(q[1])]), ridgePx: Math.round(ridgePx), zRidge: +zm.toFixed(2), hit: h ? { o: h.object.name, z: +h.point.z.toFixed(2) } : null });
  }
  return { out, h: (LN && LN.on && LN.ridge) ? LN.ridge.h : 0, on: !!(LN && LN.on), count: window.slopesRoofs.count.lines };
}, COURSE_RIDGE_PX);
{
  const pts = [];
  for (const c of courses.out) pts.push([c.px[0][0], c.px[0][1] - 1], c.px[0], [c.px[0][0], c.px[0][1] + 1], c.px[1], c.px[2]);
  const cols = pts.length ? await sample(A.pg, pts, 0) : [];
  const near = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= COURSE_SLOPE_PX;
  const rows = courses.out.map((c, i) => {
    const v = cols.slice(i * 5, i * 5 + 5).map(luma);
    const ridge = Math.max(v[0], v[1], v[2]);
    // a slope sample that projects on to the ridge's own pixels is the far
    // slope foreshortened to nothing (four rows on Biological Labs) — it is
    // the course, not the slope, and is dropped
    const sl = [3, 4].filter(k => !near(c.px[k - 2], c.px[0])).map(k => v[k]);
    const slopes = sl.length ? Math.max(...sl) : null;
    const zWant = c.zRidge + courses.h;
    // the ridge is behind something else at this pose (the raycast is a
    // metre or more from the ridge): not a verdict either way
    const occluded = !(c.hit && c.hit.o === 'roofs') || Math.abs(c.hit.z - c.zRidge) > COURSE_OCCLUDED_M;
    return { ...c, ridge, slopes, occluded, lit: slopes != null && ridge >= slopes + COURSE_LUMA,
             proud: !!(c.hit && c.hit.o === 'roofs' && c.hit.z > c.zRidge + 0.005 && c.hit.z <= zWant + COURSE_Z_TOL), zWant: +zWant.toFixed(2) };
  });
  const seen = rows.filter(r => !r.occluded && r.slopes != null);
  const nLit = seen.filter(r => r.lit).length, nProud = seen.filter(r => r.proud).length;
  check('courses (round 6): the plain hips in frame carry a ridge course — a raycast at the ridge lands on the mesh above the ridge (no more than h above it), and the ridge column reads lighter than the slopes',
    courses.count >= COURSES_MIN && seen.length >= 4 && nProud >= Math.ceil(seen.length * COURSE_FRAC) && nLit >= Math.ceil(seen.length * COURSE_FRAC),
    `${courses.count} courses (lines.on ${courses.on}, h ${courses.h}); ${rows.length} plain hips in frame with a ridge ≥ ${COURSE_RIDGE_PX} px, ${seen.length} with the ridge in view, ${nProud} with the ridge proud, ${nLit} lighter at the ridge: ` + rows.map(r => `${r.name} @${r.px[0].join(',')} (${r.ridgePx} px) ridge ${r.zRidge} -> ${r.hit ? r.hit.o + '@' + r.hit.z : 'nothing'} (want ≤ ${r.zWant})${r.occluded ? ' OCCLUDED' : ''}, luma ridge ${r.ridge.toFixed(0)} vs slopes ${r.slopes == null ? 'n/a' : r.slopes.toFixed(0)}`).join('; '));
}
// THE OLD CONTRACT WAS `root.children === 0` — written the day the layer was
// installed empty, and stale from the moment the generators landed. On the real
// page the scene is the three generator groups and nothing else (the debug
// scene only exists under ?slopesdebug=1).
// (WANT_GROUPS is declared with the gate's constants at the top of the file)
check('by default the layer is installed and the three generators are the whole of its scene',
  onState.layer && onState.frames > 0 && onState.renderer
  && onState.groups.length === WANT_GROUPS.length && WANT_GROUPS.every(n => onState.groups.includes(n)),
  `layer ${onState.layer}, frames ${onState.frames}, renderer ${onState.renderer}, groups [${onState.groups.join(', ')}]`);
check('the frames this gate diffs are metered at gain 1 (auto-exposure pinned off)', onState.gain === 1, `__ae().gain ${onState.gain}`);

await A.pg.evaluate(() => { window.SLOPES.on = false; window.__map.triggerRepaint(); }); await A.pg.waitForTimeout(1500);
const fOff = await snap(A.pg, 'switch-live-off');
const offFilters = await filtersOf(A.pg);
// THE CONTROL THAT DECIDES WHAT THE RESIDUE BELOW IS. MapLibre stops calling a
// custom layer's render() once its layout visibility is 'none' — that is the
// §204c dome bug's own mechanism, and here it is the cleanest way to ask "is
// the switched-off layer still putting anything on the screen?" without
// touching the style's layer LIST.
const inert = await A.pg.evaluate(async () => {
  const m = window.__map, before = window.slopes.frames;
  m.setLayoutProperty('slopes-mesh', 'visibility', 'none'); m.triggerRepaint();
  await new Promise(r => setTimeout(r, 1500));
  return { before, after: window.slopes.frames };
});
const fInert = await snap(A.pg, 'switch-off-render-stopped');
await A.pg.evaluate(() => { window.__map.setLayoutProperty('slopes-mesh', 'visibility', 'visible'); window.__map.triggerRepaint(); }); await A.pg.waitForTimeout(1500);
await A.pg.evaluate(() => { window.SLOPES.on = true; window.__map.triggerRepaint(); }); await A.pg.waitForTimeout(1500);
const fOn2 = await snap(A.pg, 'switch-live-on2');
await A.pg.close();

const C = await mallFrame(`${SERVER}/index.html?intro=0&drift=0&slopes=0`, 'switch-url-off');
const offState = await C.pg.evaluate(() => ({ layer: !!window.__map.getLayer('slopes-mesh'), frames: window.slopes ? window.slopes.frames : -1, renderer: !!(window.slopes && window.slopes.renderer), on: window.SLOPES.on, gain: window.__ae().gain }));
const urlFilters = await filtersOf(C.pg);
check('?slopes=0 leaves no layer, no renderer and no frame', !offState.layer && offState.frames === 0 && !offState.renderer && offState.on === false && offState.gain === 1, `layer ${offState.layer}, frames ${offState.frames}, renderer ${offState.renderer}, SLOPES.on ${offState.on}, gain ${offState.gain}`);
await C.pg.close();

// THE NOISE FLOOR, MEASURED HERE RATHER THAN ASSUMED. Every number below is
// worthless without it: two screenshots of one settled page, no camera move
// between them.
const dN = diffPNG(A.f, fNoise);
check('the harness is deterministic: one settled page shot twice is the same frame', dN.pixels === 0, `${dN.pixels} of ${dN.total} pixels differ (max channel Δ ${dN.maxChannelDiff})`);
// ...and the pose is one where the layer really draws, so nothing below can
// pass by drawing nothing anywhere.
const dLive = diffPNG(A.f, fOff);
check('...and the layer is really drawing at this pose, so the zeros below are not vacuous', dLive.pixels > 10000, `${dLive.pixels} of ${dLive.total} mall-cruise pixels change when SLOPES.on goes false (max channel Δ ${dLive.maxChannelDiff})`);

// WHAT THE SWITCH ACTUALLY PROMISES. Not "on looks like off" — the generators
// draw 108 roofs, 24 arches and a dome at this pose and they are SUPPOSED to
// differ from the slabs. The old lines compared an ON frame against an OFF one
// and were stale from the day the roofs landed.
const dBack = diffPNG(A.f, fOn2);
check('SLOPES.on = false and true again is the frame it started from, to the pixel (or the facade atlas\' own two-state residue)', zeroButAtlas(dBack), `${dBack.pixels} of ${dBack.total} pixels differ (max channel Δ ${dBack.maxChannelDiff})${residueNote(dBack)}${dBack.bbox ? ', bbox ' + dBack.bbox.join(',') : ''}`);
// The restoration contract, asserted on the DATA at exact equality: every
// filter the layer touched must come back to what a page that never had the
// layer is carrying — not merely "null" or "no arc", which is what the older
// line asked and which cannot see a filter restored to the wrong expression.
const filterDiff = FILTERED.filter(id => offFilters[id] !== urlFilters[id]);
check('SLOPES.on = false: every filter it touched is byte-identical to the ?slopes=0 page\'s',
  filterDiff.length === 0,
  filterDiff.length ? filterDiff.map(id => `${id}: ${offFilters[id]} vs ${urlFilters[id]}`).join(' | ')
                    : `${FILTERED.length} layers match exactly: ` + FILTERED.map(id => `${id}=${urlFilters[id]}`).join(', '));

// AND THE FRAME — with the number this gate could not honestly ask for at zero,
// and the reason, measured on 2026-09-02 rather than argued:
//
//   plain ?slopes=0 load vs plain ?slopes=0 load ............... 0 px (3 pairs)
//   ON -> OFF -> ON, same page ................................ 0 px
//   OFF with the layer's render() STOPPED vs render() running .. 0 px
//   OFF vs a ?slopes=0 LOAD ............................... 6,134 px, maxΔ 78 (9 pairs, ±1)
//   ...with slopes-mesh REMOVED from the style ................ 969 px, maxΔ 12
//
// So: the mesh puts NOTHING on the screen when the switch is off (line 3 — the
// `inert` control below asserts it), the filters come back byte for byte (the
// line above), and what is left is MapLibre's own doing. 5,178 px of it is the
// mere PRESENCE of one more layer in the style: MapLibre slices the depth range
// per layer, so a 224-layer style gives every layer a thinner slice than a
// 223-layer one and the depth ties between coplanar roof steps land the other
// way — 0.47 % of pixels, almost all Δ1-8, 39 of them above Δ20, isolated, no
// clusters, concentrated where distant geometry is densest. It is not the
// opaquePassCutoff (84 in every state) and it is not a filter round-trip (0 px
// on a ?slopes=0 page put through the identical round-trip). The last 969 px,
// which survive removing the layer, are NOT explained — whatever else
// js/slopes.js's boot leaves behind. So this line is a RATCHET with its
// ceiling named, the way facadegrid.mjs's sweep is, not a zero pretended into
// existence.
const SWITCH_OFF_PX = 7000;        // measured 6,134; the ceiling, not the target
const dOff = diffPNG(fOff, C.f);
check(`SLOPES.on = false at runtime is the ?slopes=0 page to within ${SWITCH_OFF_PX} px of MapLibre's own depth-slice dither`,
  dOff.pixels <= SWITCH_OFF_PX,
  `${dOff.pixels} of ${dOff.total} pixels differ (max channel Δ ${dOff.maxChannelDiff}) — ceiling ${SWITCH_OFF_PX}, measured 6,134 on 2026-09-02`);
const dInert = diffPNG(fOff, fInert);
check('...and NONE of that is the mesh: stopping the layer\'s render() altogether does not move one pixel (or the atlas residue)',
  inert.after === inert.before && zeroButAtlas(dInert),
  `slopes.frames ${inert.before} -> ${inert.after} with visibility 'none' (render() stopped: ${inert.after === inert.before}); ${dInert.pixels} of ${dInert.total} pixels differ (max channel Δ ${dInert.maxChannelDiff})${residueNote(dInert)}`);

// THE BAKE IDENTITY. scripts/bake_roofs.py adds `rig` and the `f` tags to
// data/roofs.geojson and must change nothing the slabs draw, so the branch with
// the layer switched off at LOAD has to be main. Serve `git archive main` on a
// second port and pass it as --against; 0 px is the contract, and it holds
// because neither page carries the custom layer.
if (AGAINST) {
  const D = await mallFrame(`${AGAINST}/index.html?intro=0&drift=0`, 'against');
  await D.pg.close();
  const d3 = diffPNG(C.f, D.f);
  check(`?slopes=0 is the build at ${AGAINST}, to the pixel or the atlas residue (the bake changed nothing the slabs draw)`, zeroButAtlas(d3), `${d3.pixels} of ${d3.total} pixels differ (max channel Δ ${d3.maxChannelDiff})${residueNote(d3)}${d3.bbox ? ', bbox ' + d3.bbox.join(',') : ''}`);
} else {
  console.log('   (no --against: the bake-identity line was not run)');
}
if (!SHOTS) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
report();

function report() {
  let bad = 0;
  for (const r of results) { console.log(`${r.pass ? ' PASS ' : '*FAIL '} ${r.name}\n         ${r.detail}`); if (!r.pass) bad++; }
  console.log(`\n${results.length - bad}/${results.length} passed${BREAK ? '  (--break: the stack, haze, arch, flat-roof, courses and one-fetch lines are meant to be red — 12 of them)' : ''}`);
  browser.__done();
  process.exit(bad ? 1 : 0);
}
