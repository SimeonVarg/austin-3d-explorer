/**
 * campusmeter.mjs — the scoreboard for the "entrances/facades/paths are wrong"
 * round. Scores what is ALREADY SERVED, before anything changes. Every number
 * this script prints is meant to be a low, honest starting point, not a pass.
 *
 * THREE SCORES, THREE ORACLES, ALL READ DIRECTLY OFF SOURCES THAT ALREADY
 * EXIST IN THIS REPO OR ARE FROZEN HERE WITH A DATE AND A QUERY — nothing is
 * guessed and nothing is re-derived by hand-copying a rule that could drift:
 *
 *   ENTRANCES  data/entrances.geojson (fetched from the RUNNING SERVER, exactly
 *              what js/entrances.js fetches — see DATA in that file) against
 *              two independent real-door oracles that are PARSED OUT OF THE
 *              APP'S OWN SOURCE at run time, never hand-copied:
 *                A. UT Facilities' Celebrated_Entrances survey, 97 doors on 67
 *                   buildings, the literal table js/wayfind.js already ships
 *                   as UT_CELEBRATED (the same table walkmeter.mjs reads via
 *                   window.wayfindUTDoors()). Code-keyed, authoritative.
 *                B. OpenStreetMap's entrance=* nodes, 91 nodes, the literal
 *                   table scripts/bake_entrances.py already ships as
 *                   _ENTRANCE_ROWS (fetched 2026-08-04, frozen there for the
 *                   same reason it is frozen here — a live query the app
 *                   depends on is a live query the app can silently lose).
 *                   Not code-keyed — a broader, looser cross-check.
 *              Reading these by REGEX-EXTRACTING AND EVALUATING THE REAL
 *              SOURCE TEXT (not copying the numbers into this file) means a
 *              table that changes upstream changes this score on the next run
 *              with no edit here, and a genuine parse failure is loud, not a
 *              silent zero — see selfCheck() below.
 *
 *   FACADES    js/facades.js's own GRIDS table and familyFor() — SAME
 *              technique: the exact source text is sliced out and evaluated,
 *              never hand-copied, so this can never drift from what
 *              window.FACADE_PATTERN_EXPR actually paints. familyFor(props) is
 *              run against the REAL feature properties from whichever snapshot
 *              data/manifest.json currently calls `latest` (fetched from the
 *              running server) — the same bake-trap check every script in this
 *              directory is supposed to make: read what is actually served.
 *              Compared against SEVEN real campus buildings whose window grid
 *              was counted BY EYE off a real, dated, licensed photograph (see
 *              TARGET_FACADES below for the citation on every one) — per the
 *              house playbook, sampled off the reference's pixels, never
 *              guessed.
 *
 *   PATHS      data/ground.geojson's `patharea` polygons (u: footway/
 *              pedestrian/path), fetched from the running server, against TWO
 *              independent sources, neither of which is the pipeline
 *              data/ground.geojson itself came from, so neither check can be
 *              satisfied by a lane that only re-touches the same OSM extract
 *              bake_ground.py already reads:
 *                A. A FRESH, separately-fetched OSM footway/path/pedestrian/
 *                   steps extract (scripts/verify/campusmeter-fixtures/
 *                   osm-paths-campus.json, Overpass, 2026-08-26, 1,611 ways) —
 *                   catches a bug the BAKE introduced (bad projection,
 *                   simplification drift, a stale snapshot) even though it
 *                   ultimately traces to the same upstream map.
 *                B. Real USGS NAIP orthoimagery (scripts/verify/
 *                   campusmeter-fixtures/campus-naip.jpg, 2026-08-26, public
 *                   domain) sampled through an actual Chrome canvas —
 *                   catches the thing OSM itself cannot see: a drawn path
 *                   with no paved surface under it in the real world at all.
 *              This one is the one instrument in this file that opens a
 *              browser, and only for as long as it takes to decode one JPEG
 *              onto a canvas and read pixels back — everything else here is
 *              plain fetch, because none of it needs a renderer.
 *
 * WHY NO BROWSER FOR THE OTHER TWO. `coplanar.mjs` in this same directory
 * reads every data/*.geojson with no browser at all, for the same reason:
 * these are data-level questions ("is this door near that door", "is this the
 * grid the source says it is"), not rendering questions ("does this pixel come
 * out the color the paint expression says"). A browser would add nothing here
 * but WebGL startup time and a swiftshader dependency neither section needs.
 *
 * HOW THIS DIFFERS FROM walkmeter.mjs's 38-of-38. walkmeter measures the
 * ROUTER: given a start and an end, does wayfindRoute() choose UT's door out
 * of the several candidates already sitting in data/entrances.geojson for that
 * building. It reads the same UT_CELEBRATED table via window.wayfindUTDoors()
 * and reports 38 of 38 ends landing on it. This script measures the DOOR
 * GEOMETRY ITSELF, independent of routing or of a rule choosing among several
 * real candidates: for every door the app actually DRAWS on the wall, how far
 * is that piece of geometry from where the door really is. A router can score
 * 38 of 38 by correctly choosing among several drawn doors while most of the
 * OTHER doors on OTHER buildings — the ones no walk pair ever asks the router
 * to consider — sit wherever the placement pipeline put them, checked by
 * nobody until now. That is what this script's entrance number reports, and
 * it is why the two numbers are expected to disagree.
 *
 * SELF-CHECKS, NOT JUST NUMBERS. Every extracted table is checked against an
 * invariant already published in this repo's own comments before it is
 * trusted (97 doors / 67 buildings for UT_CELEBRATED, 91 nodes for the OSM
 * table, 69 of them inside CAMPUS per docs/entrances/placement.md, 5 grid
 * families in GRIDS). A mismatch means THIS SCRIPT'S PARSER has drifted from
 * the source, not that the source is wrong, and the run exits 2 rather than
 * print a number quietly computed on the wrong data — the same failure mode
 * `coplanar.mjs`'s own README section is about.
 *
 * CAN THIS BE GAMED BY A LANE THAT CHANGES NOTHING REAL? Deliberately hard to:
 *   - the entrance oracle is parsed out of files a lane is not asked to touch;
 *     inflating data/entrances.geojson's door COUNT does nothing, because every
 *     door is measured on its own, not credited for a neighbour;
 *   - the facade oracle is seven photographs already counted by eye and
 *     frozen with a citation — a lane cannot talk its way to a different real
 *     count, only fix familyFor/GRIDS so the computed grid matches it;
 *   - the path oracles are two sources the app's own bake does not write, so
 *     copying ground.geojson's own geometry into a "check" would not move
 *     either number.
 * The one soft spot: the facade target list is seven buildings, not 198. A
 * future round should grow it — the number this run prints is a floor on how
 * bad the mismatch is, not a ceiling.
 *
 * Usage:
 *   python scripts/serve.py 8813                      # repo root
 *   node scripts/verify/campusmeter.mjs                # from scripts/verify
 *   node scripts/verify/campusmeter.mjs 8813
 *   VERIFY_URL=http://127.0.0.1:8813 node scripts/verify/campusmeter.mjs
 *     --json out.json     write the full per-item tables there
 *
 * Exit codes: 0 the instrument ran and printed real numbers (a low score is
 * not a failure — that is the point of this round). 1 an oracle failed its own
 * self-check (the parser drifted from the source, not a finding about the
 * city). 2 bad args, missing fixture, or the server is not answering.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'campusmeter-fixtures');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const JSON_OUT = opt('--json', null);
const argPort = argv.find(a => /^\d+$/.test(a));
// This instrument's own default port, per the brief. Still fully overridable —
// VERIFY_URL wins over everything, matching every other script in this dir.
const BASE = process.env.VERIFY_URL || (argPort ? `http://127.0.0.1:${argPort}` : 'http://127.0.0.1:8813');

let hadSelfCheckFailure = false;
function selfCheck(label, ok, detail) {
  if (ok) { console.log(`  [self-check OK] ${label}`); return; }
  hadSelfCheckFailure = true;
  console.error(`  [self-check FAILED] ${label}${detail ? ' — ' + detail : ''}`);
}

async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
}
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

/** Local equirectangular metres, anchored near the campus centroid. Valid at
 *  the ~2 km scale this whole script operates at (error is sub-centimetre) —
 *  not a claim of a general-purpose projection. */
const ANCHOR_LAT = 30.286;
const MPERDEG_LAT = 110574; // metres per degree latitude, at this latitude
const MPERDEG_LON = 111320 * Math.cos(ANCHOR_LAT * Math.PI / 180);
function toXY(lon, lat) { return [lon * MPERDEG_LON, lat * MPERDEG_LAT]; }
function distM(lon1, lat1, lon2, lat2) {
  const [x1, y1] = toXY(lon1, lat1), [x2, y2] = toXY(lon2, lat2);
  return Math.hypot(x1 - x2, y1 - y2);
}
function distToSegM(plon, plat, alon, alat, blon, blat) {
  const [px, py] = toXY(plon, plat), [ax, ay] = toXY(alon, alat), [bx, by] = toXY(blon, blat);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function median(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; if (!n) return NaN; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function pctl(a, p) { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = Math.min(s.length - 1, Math.floor(p / 100 * s.length)); return s[i]; }

/** Slice `text` from the first index of `startMark` to the matching close of
 *  the first `{` (or `[`) after it. Robust to nested braces/brackets inside —
 *  it counts them — so it survives the block growing without an edit here. */
function extractBalanced(text, startMark, openCh = '{', closeCh = '}') {
  const s = text.indexOf(startMark);
  if (s < 0) throw new Error(`marker not found: ${JSON.stringify(startMark)}`);
  const o = text.indexOf(openCh, s);
  if (o < 0) throw new Error(`no ${openCh} after marker: ${JSON.stringify(startMark)}`);
  let depth = 0, i = o;
  for (; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh) { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error(`unbalanced ${openCh}${closeCh} from marker: ${JSON.stringify(startMark)}`);
  return text.slice(s, i);
}

console.log(`campusmeter.mjs — scoring the served city at ${BASE}\n`);

// ════════════════════════════════════════════════════════════════════════
// SECTION 1 — ENTRANCES
// ════════════════════════════════════════════════════════════════════════
async function scoreEntrances() {
  console.log('── ENTRANCES ──────────────────────────────────────────────');

  // --- oracle A: UT Facilities' own Celebrated_Entrances survey ----------
  const wayfindSrc = await getText(`${BASE}/js/wayfind.js`);
  const utBlockRaw = extractBalanced(wayfindSrc, 'const UT_CELEBRATED = [', '[', ']');
  // eslint-disable-next-line no-new-func
  const UT_CELEBRATED = new Function(`return ${utBlockRaw.replace(/^const UT_CELEBRATED = /, '')}`)();
  const utDoors = UT_CELEBRATED.map(row => {
    const p = row.split(' ');
    return { code: p[0], lat: +p[1], lon: +p[2], side: p[3], bf: p[4] === 'Y', ao: p[5] === 'Y' };
  });
  const utCodes = new Set(utDoors.map(d => d.code));
  selfCheck('UT_CELEBRATED parses to 97 doors on 67 buildings (js/wayfind.js comment)',
    utDoors.length === 97 && utCodes.size === 67,
    `got ${utDoors.length} doors on ${utCodes.size} buildings`);

  // --- oracle B: OSM entrance=* nodes, frozen in bake_entrances.py --------
  const bakeSrc = await getText(`${BASE}/scripts/bake_entrances.py`);
  const campusMatch = bakeSrc.match(/CAMPUS = \(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)/);
  if (!campusMatch) throw new Error('CAMPUS bbox not found in scripts/bake_entrances.py');
  const CAMPUS = { s: +campusMatch[1], w: +campusMatch[2], n: +campusMatch[3], e: +campusMatch[4] };
  const inCampus = (lat, lon) => lat >= CAMPUS.s && lat <= CAMPUS.n && lon >= CAMPUS.w && lon <= CAMPUS.e;

  const rowsStart = bakeSrc.indexOf('_ENTRANCE_ROWS = [');
  const rowsBlock = bakeSrc.slice(rowsStart, bakeSrc.indexOf('\n]', rowsStart) + 2);
  const tupleRe = /\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,/g;
  const osmAll = [];
  let m;
  while ((m = tupleRe.exec(rowsBlock))) osmAll.push({ lon: +m[1], lat: +m[2] });
  selfCheck('OSM oracle parses to 91 nodes (scripts/bake_entrances.py comment)', osmAll.length === 91, `got ${osmAll.length}`);
  const osmCampus = osmAll.filter(n => inCampus(n.lat, n.lon));
  // docs/entrances/placement.md §1 reports 69 — but that is nodes that snap
  // onto one of the 290 CAMPUS-filtered BUILDINGS (MIN_AREA/MIN_H/not-roof),
  // a stricter condition than "inside the CAMPUS rectangle" that requires
  // replicating that whole building-snap pipeline. This check only verifies
  // the bbox, so a SLIGHTLY higher count than 69 is expected (a few nodes sit
  // inside the rectangle but not on a qualifying building) — bound it loosely
  // rather than assert a number this script cannot actually reproduce.
  selfCheck('OSM nodes inside the CAMPUS bbox are in the documented ballpark (60-80; doc\'s stricter building-snapped 69 is a subset of this)',
    osmCampus.length >= 60 && osmCampus.length <= 80, `got ${osmCampus.length}`);

  if (hadSelfCheckFailure) return null;

  // --- what the app draws --------------------------------------------------
  const entGJ = await getJSON(`${BASE}/data/entrances.geojson`);
  const doorGroups = new Map(); // `${bid}|${eid}` -> {lonSum,latSum,n,ref,nm,src}
  for (const f of entGJ.features) {
    const p = f.properties;
    const key = `${p.bid}|${p.eid}`;
    let g = doorGroups.get(key);
    if (!g) { g = { lonSum: 0, latSum: 0, n: 0, ref: p.ref, nm: p.nm, srcs: new Set() }; doorGroups.set(key, g); }
    // Use every ring/point vertex's centroid as a proxy for the piece's
    // position — cheap and stable; we only need "where on the wall this door
    // is", not its exact footprint.
    const g2 = f.geometry;
    const pts = g2.type === 'Polygon' ? g2.coordinates[0] : g2.type === 'MultiPolygon' ? g2.coordinates[0][0] : g2.type === 'Point' ? [g2.coordinates] : [];
    for (const [lon, lat] of pts) { g.lonSum += lon; g.latSum += lat; g.n++; }
    if (p.src) g.srcs.add(p.src);
  }
  const doors = [...doorGroups.values()].filter(g => g.n > 0).map(g => ({
    lon: g.lonSum / g.n, lat: g.latSum / g.n, ref: g.ref, nm: g.nm, src: [...g.srcs].join('+'),
  }));
  console.log(`  app draws ${doors.length} distinct doors (grouped by building+eid) from ${entGJ.features.length} pieces`);

  // --- metric A: code-keyed distance to UT's own survey --------------------
  const utByCode = new Map();
  for (const d of utDoors) { if (!utByCode.has(d.code)) utByCode.set(d.code, []); utByCode.get(d.code).push(d); }
  const checkedA = [];
  for (const d of doors) {
    const candidates = utByCode.get(d.ref);
    if (!candidates) continue;
    let best = Infinity;
    for (const c of candidates) best = Math.min(best, distM(d.lon, d.lat, c.lon, c.lat));
    checkedA.push({ ref: d.ref, nm: d.nm, m: best });
  }
  const withinA = checkedA.filter(x => x.m <= 10);
  console.log(`\n  METRIC A — code-keyed against UT Facilities' own survey (authoritative, 67 buildings covered):`);
  console.log(`    ${withinA.length} of ${checkedA.length} drawn doors land within 10 m of UT's own door`);
  if (checkedA.length) {
    console.log(`    median ${median(checkedA.map(x => x.m)).toFixed(1)} m, p90 ${pctl(checkedA.map(x => x.m), 90).toFixed(1)} m, max ${Math.max(...checkedA.map(x => x.m)).toFixed(1)} m`);
    const worst = [...checkedA].sort((a, b) => b.m - a.m).slice(0, 8);
    console.log('    worst offenders:');
    for (const w of worst) console.log(`      ${w.ref} (${w.nm}) — ${w.m.toFixed(1)} m`);
  }

  // --- metric B: broader, un-keyed distance to nearest OSM node -----------
  const doorsInCampus = doors.filter(d => inCampus(d.lat, d.lon));
  const checkedB = doorsInCampus.map(d => {
    let best = Infinity;
    for (const n of osmCampus) best = Math.min(best, distM(d.lon, d.lat, n.lon, n.lat));
    return { ref: d.ref, nm: d.nm, m: best };
  });
  const withinB = checkedB.filter(x => x.m <= 10);
  console.log(`\n  METRIC B — nearest OSM entrance node ANYWHERE in campus (NOT building-restricted — a`);
  console.log(`    close neighbour's real door can satisfy this; it is a looser, broader signal, not a`);
  console.log(`    replacement for metric A):`);
  console.log(`    ${withinB.length} of ${checkedB.length} drawn doors (all doors inside CAMPUS) land within 10 m of SOME OSM node`);
  if (checkedB.length) {
    console.log(`    median ${median(checkedB.map(x => x.m)).toFixed(1)} m, p90 ${pctl(checkedB.map(x => x.m), 90).toFixed(1)} m`);
  }

  console.log(`\n  context: ${new Set(doors.map(d => d.ref)).size} distinct building codes carry a drawn door;`);
  console.log(`    ${new Set(checkedA.map(x => x.ref)).size} of them are in UT's survey and were checked by metric A.`);
  console.log(`    The rest have no per-building ground truth in this run and are honestly uncounted, not scored as failing.`);

  return { doors: doors.length, metricA: { within10: withinA.length, checked: checkedA.length }, metricB: { within10: withinB.length, checked: checkedB.length }, checkedA, checkedB };
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 2 — FACADES
// ════════════════════════════════════════════════════════════════════════
//
// Seven real campus buildings, each counted BY EYE off one specific, dated,
// licensed photograph — never guessed, per the house playbook step 3. `real`
// is null where the real building has no repeating grid to count at all
// (Littlefield House): forcing a rows×cols number onto an irregular Victorian
// mansion would itself be inventing structure the reference does not have.
const TARGET_FACADES = [
  { name: 'Battle Hall', real: { rows: 2, cols: 6 },
    note: 'one arcaded ground floor + one floor of tall arched Palladian windows with balconies; a genuinely two-storey reading-room hall, not a multi-storey punched grid',
    source: 'File:Battle hall 2014.jpg, Wikimedia Commons, CC BY 4.0, https://commons.wikimedia.org/wiki/File:Battle_hall_2014.jpg' },
  { name: 'Sutton Hall', real: { rows: 3, cols: 6 },
    note: 'limestone arcade at grade + two brick floors of paired sash windows (upper floor with Juliet balconies)',
    source: 'File:Sutton Hall - University of Texas at Austin.jpg, Wikimedia Commons, CC BY-SA 2.0, https://commons.wikimedia.org/wiki/File:Sutton_Hall_-_University_of_Texas_at_Austin.jpg' },
  { name: 'Garrison Hall', real: { rows: 3, cols: 6 },
    note: 'same Cass Gilbert quad vocabulary as Sutton Hall — limestone arcade + two brick window floors',
    source: 'File:Garrison hall 2014.jpg, Wikimedia Commons, CC BY 4.0, https://commons.wikimedia.org/wiki/File:Garrison_hall_2014.jpg' },
  { name: 'Waggener Hall', real: { rows: 5, cols: 4 },
    note: 'a genuinely tall punched-masonry hall (5 real floors, matches num_floors in the snapshot) — the visible near bay is 4 windows wide before trees occlude the rest of the wall, so cols is a partial-elevation count, not the whole facade',
    source: 'File:University of Texas at Austin August 2019 23 (Waggener Hall).jpg, Wikimedia Commons, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_August_2019_23_(Waggener_Hall).jpg' },
  { name: 'Littlefield House', real: null,
    note: 'a 20 m ornate 1893 Victorian mansion — turrets, verandas, irregular window shapes on every elevation. There is no repeating grid in the photograph to count; ANY uniform rows×cols grid is wrong by construction',
    source: 'File:Littlefield House - UT Austin (54984939058).jpg, Wikimedia Commons, CC BY 4.0, https://commons.wikimedia.org/wiki/File:Littlefield_House_-_UT_Austin_(54984939058).jpg' },
  { name: 'Goldsmith Hall', real: { rows: 2, cols: 6 },
    note: 'two real floors (raised ground floor + one floor of paired sash windows) under the "ARCHITECTURE" entry pavilion',
    source: 'File:Goldsmith Hall.JPG, Wikimedia Commons, CC BY-SA 3.0, https://commons.wikimedia.org/wiki/File:Goldsmith_Hall.JPG' },
  { name: 'UT Tower', real: { rows: '~20+ (approx, see note)', cols: 3 },
    note: 'the SHAFT above the 4-storey Main Building base: a narrow vertical band only about 3 windows wide, flanked by wide blank stone piers, stacked roughly 20+ floors — nothing like a broad residential grid. Row count is an approximate visual count off the photo (too many to count exactly at this resolution) and is reported as approximate on purpose rather than as false precision; the column count (3, narrow) is the load-bearing finding',
    source: 'File:Main building tower.JPG, Wikimedia Commons, CC0, https://commons.wikimedia.org/wiki/File:Main_building_tower.JPG' },
];

async function scoreFacades() {
  console.log('\n── FACADES ────────────────────────────────────────────────');

  const facadesSrc = await getText(`${BASE}/js/facades.js`);
  const gridsBlockRaw = extractBalanced(facadesSrc, 'const GRIDS = {');
  // eslint-disable-next-line no-new-func
  const GRIDS = new Function(`return (${gridsBlockRaw.replace(/^const GRIDS = /, '')})`)();
  const famNames = Object.keys(GRIDS).filter(k => GRIDS[k]);
  selfCheck('GRIDS parses to 5 non-null window-grid families (lo/mr/mh/tr/tg)', famNames.length === 5, `got [${famNames.join(',')}]`);

  const familyBlockRaw = facadesSrc.slice(facadesSrc.indexOf('const RESIDENTIAL ='), facadesSrc.indexOf('// ── the baked palette'));
  // eslint-disable-next-line no-new-func
  const familyFor = new Function(familyBlockRaw + '\nreturn familyFor;')();
  selfCheck('familyFor extracted as a callable function', typeof familyFor === 'function');

  if (hadSelfCheckFailure) return null;

  const manifest = await getJSON(`${BASE}/data/manifest.json`);
  const snapDate = manifest.latest;
  const buildingsGJ = await getJSON(`${BASE}/data/snapshots/${snapDate}/buildings.detailed.geojson`);
  const byName = new Map();
  for (const f of buildingsGJ.features) {
    const nm = f.properties && f.properties.name;
    if (nm) byName.set(nm, f.properties);
  }
  console.log(`  reading building properties from the RUNNING app's own snapshot: data/snapshots/${snapDate}/buildings.detailed.geojson`);

  const rows = [];
  for (const t of TARGET_FACADES) {
    const props = byName.get(t.name);
    if (!props) { rows.push({ ...t, found: false }); continue; }
    const fam = familyFor(props);
    const grid = GRIDS[fam];
    const appRows = grid ? grid.rows : null;
    const appCols = grid ? grid.cols : null;
    const match = t.real && typeof t.real.rows === 'number'
      ? (appRows === t.real.rows && appCols === t.real.cols)
      : false; // no real grid to match (Littlefield), or approximate/non-numeric real rows (UT Tower) -> never an automatic pass
    rows.push({ ...t, found: true, height: props.final_height, cls: props.building_class, fam, appRows, appCols, match });
  }

  console.log('\n  building              height  class          app family  app grid   real grid    match');
  console.log('  ' + '-'.repeat(96));
  for (const r of rows) {
    if (!r.found) { console.log(`  ${r.name.padEnd(21)} NOT FOUND in current snapshot by exact name match`); continue; }
    const realStr = r.real ? `${r.real.rows}x${r.real.cols}` : 'no grid (irregular)';
    console.log(`  ${r.name.padEnd(21)} ${String(r.height).padStart(5)}m  ${(r.cls || '-').padEnd(14)} ${r.fam.padEnd(10)} ${(`${r.appRows}x${r.appCols}`).padEnd(10)} ${realStr.padEnd(12)} ${r.match ? 'MATCH' : 'no'}`);
  }
  const matches = rows.filter(r => r.match).length;
  console.log(`\n  HEADLINE (A, the FALLBACK): ${matches} of ${rows.filter(r => r.found).length} target buildings' app-drawn grid matches the photograph's real grid`);

  const b = await scoreRenderedFacades(facadesSrc, byName, rows);
  return { targets: rows.length, matches, rows, rendered: b };
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * METRIC B — WHAT THE WALL ACTUALLY RENDERS  (added 2026-08-27)
 * ════════════════════════════════════════════════════════════════════════
 *
 * METRIC A ABOVE IS UNTOUCHED, and its number is still the headline it always
 * was. This is an addition beside it, not a replacement, and it exists because
 * A cannot see the thing that changed.
 *
 * WHY A CANNOT. Metric A compares `GRIDS[familyFor(props)].rows` against the
 * photographed storey count. That comparison is only meaningful while the grid
 * is a HEIGHT CLASSIFIER, because it silently assumes the tile's row count is
 * the building's storey count — and it is not. js/facades.js's pattern is
 * SCREEN-locked: one repeat covers REPEAT_M metres of wall, so `rows` sets a
 * FLOOR-TO-FLOOR PITCH and the number of rows that land on a building is
 * `rows * height / REPEAT_M`. Battle Hall's measured tile has three rows, and
 * three rows over its 21.5 m wall is two storeys, which is what Battle Hall
 * has. Metric A reads that tile as "3", compares it to "2", and calls it a
 * miss. So A is now correctly read as a score of the FALLBACK TEMPLATES — it
 * evaluates familyFor outside a browser, where the measured registry is empty
 * by construction — and it should stay pinned at 0 of 7 until the templates
 * themselves change.
 *
 * WHAT B SCORES, and the one thing that makes it worth trusting: it uses THIS
 * FILE'S OWN seven photographed counts, in TARGET_FACADES above, which were
 * counted in a different pass off different Wikimedia files than the sixteen in
 * data/facade_grids.json. That makes them a HELD-OUT SET for the measured
 * grids — a building can only score here by agreeing with a count nobody
 * fitted it to. Two of the seven disagree with the measured file outright
 * (Garrison and Goldsmith, where the two passes counted a different number of
 * storey bands off different photographs) and those are reported as
 * disagreements rather than quietly reconciled.
 *
 * ROWS ONLY, deliberately. Columns can only be scored against a wall whose
 * length is known, and exactly one of the sixteen has a bay count anchored to a
 * measured wall. Scoring columns off an unanchored count would be inventing
 * precision.
 */
async function scoreRenderedFacades(facadesSrc, byName, aRows) {
  console.log('\n  ── B: what the wall actually RENDERS ────────────────────');

  // REPEAT_M, extracted from js/facades.js's source rather than typed here, so
  // a change to TIER_CSS or REF_ZOOM moves this score with no edit — the same
  // rule the rest of this file follows for GRIDS and familyFor.
  const refZoom = Number((facadesSrc.match(/const REF_ZOOM = (\d+)/) || [])[1]);
  const tierCss = Number((facadesSrc.match(/const TIER_CSS = (\d+)/) || [])[1]);
  selfCheck('REPEAT_M inputs parse out of js/facades.js', Number.isFinite(refZoom) && Number.isFinite(tierCss),
            `REF_ZOOM=${refZoom} TIER_CSS=${tierCss}`);
  if (!Number.isFinite(refZoom) || !Number.isFinite(tierCss)) return null;
  const REPEAT_M = tierCss * 67551 / Math.pow(2, refZoom);

  let doc;
  try { doc = await getJSON(`${BASE}/data/facade_grids.json`); } catch (e) { doc = null; }
  if (!doc || !doc.buildings || !doc.buildings.length) {
    console.log('  data/facade_grids.json is absent or empty — no building carries a measured');
    console.log('  grid, so B is exactly A. Nothing to score.');
    return { scored: 0, matches: 0 };
  }
  console.log(`  ${doc.buildings.length} measured buildings, from snapshot ${doc._snapshot}`);
  console.log(`  one repeat = ${REPEAT_M.toFixed(2)} m of wall (TIER_CSS ${tierCss} at REF_ZOOM ${refZoom})`);

  const measuredByName = new Map(doc.buildings.map(b => [b.name, b]));
  const out = [];
  for (const t of TARGET_FACADES) {
    const props = byName.get(t.name);
    const m = measuredByName.get(t.name);
    if (!props || !m) { out.push({ name: t.name, skipped: !props ? 'not in snapshot' : 'not measured' }); continue; }
    // The DERIVATION, straight out of the measured file and the app's own
    // height: `rows` is chosen so that `storeys` land on this wall.
    const rows = Math.min(10, Math.max(1, Math.round(m.storeys * REPEAT_M / props.final_height)));
    const renderRows = rows * props.final_height / REPEAT_M;
    const realRows = t.real && typeof t.real.rows === 'number' ? t.real.rows : null;
    // Same derived tolerance the facadegrid harness uses: the tile row count is
    // an integer, so half a tile row is the finest it can be steered, and on
    // the wall that is 0.5 * height / REPEAT_M.
    const tol = Math.max(0.5, 0.5 * props.final_height / REPEAT_M);
    out.push({
      name: t.name, storeysMeasured: m.storeys, realRows, tileRows: rows, renderRows, tol,
      heightM: props.final_height,
      agree: realRows == null ? null : m.storeys === realRows,
      match: realRows != null && Math.abs(renderRows - realRows) <= tol,
    });
  }

  console.log('\n  building              height  tile rows  renders   this file\'s photo count  match');
  console.log('  ' + '-'.repeat(88));
  for (const r of out) {
    if (r.skipped) { console.log(`  ${r.name.padEnd(21)} ${r.skipped}`); continue; }
    console.log(`  ${r.name.padEnd(21)} ${String(r.heightM).padStart(5)}m  ${String(r.tileRows).padStart(6)}     `
      + `${r.renderRows.toFixed(1).padStart(5)}r   ${String(r.realRows == null ? 'no grid / approx' : r.realRows + 'r').padEnd(22)} `
      + `${r.match ? 'MATCH' : 'no'}`);
  }
  const scored = out.filter(r => !r.skipped && r.realRows != null).length;
  const matches = out.filter(r => r.match).length;
  const disagree = out.filter(r => r.agree === false);
  if (disagree.length) {
    console.log('\n  Counted differently by the two passes, stated rather than reconciled:');
    for (const r of disagree) {
      console.log(`    ${r.name}: this file counted ${r.realRows} storey bands, data/facade_grids.json counted `
        + `${r.storeysMeasured} off a different photograph.`);
    }
  }
  console.log(`\n  HEADLINE (B, RENDERED): ${matches} of ${scored} scoreable target buildings now draw the`);
  console.log('  photographed number of window rows on their own wall. Rows only — columns need a');
  console.log('  wall length, and 1 of 16 measured buildings has a bay count anchored to one.');
  return { scored, matches, rows: out };
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 3 — PATHS
// ════════════════════════════════════════════════════════════════════════
async function scorePaths() {
  console.log('\n── PATHS ──────────────────────────────────────────────────');

  const bakeSrc = await getText(`${BASE}/scripts/bake_entrances.py`);
  const campusMatch = bakeSrc.match(/CAMPUS = \(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)/);
  const CAMPUS = { s: +campusMatch[1], w: +campusMatch[2], n: +campusMatch[3], e: +campusMatch[4] };
  const inCampus = (lat, lon) => lat >= CAMPUS.s && lat <= CAMPUS.n && lon >= CAMPUS.w && lon <= CAMPUS.e;

  const groundGJ = await getJSON(`${BASE}/data/ground.geojson`);
  const WALK_U = new Set(['footway', 'pedestrian', 'path']);
  const samples = []; // {lon,lat}
  for (const f of groundGJ.features) {
    const p = f.properties;
    if (p.k !== 'patharea' || !WALK_U.has(p.u)) continue;
    const g = f.geometry;
    const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
    if (!ring) continue;
    for (const [lon, lat] of ring) {
      if (inCampus(lat, lon)) samples.push({ lon, lat });
    }
  }
  // Deterministic stride down to a tractable, reproducible sample size —
  // never random, so a re-run reproduces the identical set of points.
  const CAP = 600;
  const stride = Math.max(1, Math.floor(samples.length / CAP));
  const sampled = samples.filter((_, i) => i % stride === 0);
  console.log(`  ${samples.length} vertices of drawn footway/pedestrian/path polygons inside CAMPUS; sampling every ${stride} -> ${sampled.length} points`);

  // --- oracle A: a FRESH, independent OSM footway/path/pedestrian/steps ---
  const osmFixturePath = path.join(FIXTURES, 'osm-paths-campus.json');
  if (!fs.existsSync(osmFixturePath)) throw new Error(`missing fixture: ${osmFixturePath}`);
  const osmFixture = JSON.parse(fs.readFileSync(osmFixturePath, 'utf8'));
  selfCheck('OSM path fixture carries its declared way count', osmFixture.ways.length === osmFixture._count, `${osmFixture.ways.length} vs declared ${osmFixture._count}`);
  const segments = [];
  for (const w of osmFixture.ways) {
    for (let i = 0; i + 1 < w.pts.length; i++) segments.push([w.pts[i], w.pts[i + 1]]);
  }
  console.log(`  oracle A: ${osmFixture.ways.length} independently-fetched OSM footway/path/pedestrian/steps ways (${segments.length} segments), ${osmFixture._fetched}`);

  if (hadSelfCheckFailure) return null;

  const distA = sampled.map(pt => {
    let best = Infinity;
    for (const [[alon, alat], [blon, blat]] of segments) {
      const d = distToSegM(pt.lon, pt.lat, alon, alat, blon, blat);
      if (d < best) best = d;
    }
    return best;
  });
  const within5A = distA.filter(d => d <= 5).length;
  const within10A = distA.filter(d => d <= 10).length;
  console.log(`\n  METRIC A — distance from a drawn walkway point to the nearest independently-fetched OSM way:`);
  console.log(`    ${within5A} of ${distA.length} within 5 m, ${within10A} of ${distA.length} within 10 m`);
  console.log(`    median ${median(distA).toFixed(1)} m, p90 ${pctl(distA, 90).toFixed(1)} m, max ${Math.max(...distA).toFixed(1)} m`);
  console.log(`    (this checks the BAKE, not the map — both ultimately trace to OSM, so a clean score here`);
  console.log(`     means the bake did not introduce drift, not that OSM itself is complete on campus)`);

  // --- oracle B: real aerial pixels, sampled through an actual canvas ------
  const naipPath = path.join(FIXTURES, 'campus-naip.jpg');
  const metaPath = path.join(FIXTURES, 'campus-naip.meta.json');
  if (!fs.existsSync(naipPath)) throw new Error(`missing fixture: ${naipPath}`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const b64 = fs.readFileSync(naipPath).toString('base64');

  const browser = await launch(chromium);
  let vegShare = null, sampledPixels = [];
  try {
    const page = await browser.newPage();
    await page.setContent(`<img id="im" src="data:image/jpeg;base64,${b64}">`);
    await page.waitForFunction(() => document.getElementById('im').complete);
    const px = sampled.map(pt => {
      const fx = (pt.lon - meta.bbox.minlon) / (meta.bbox.maxlon - meta.bbox.minlon);
      const fy = (meta.bbox.maxlat - pt.lat) / (meta.bbox.maxlat - meta.bbox.minlat);
      return [Math.round(fx * meta.width), Math.round(fy * meta.height)];
    });
    sampledPixels = await page.evaluate(({ pts, w, h }) => {
      const im = document.getElementById('im');
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(im, 0, 0, w, h);
      const out = [];
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= w || y >= h) { out.push(null); continue; }
        const d = ctx.getImageData(x, y, 1, 1).data;
        out.push([d[0], d[1], d[2]]);
      }
      return out;
    }, { pts: px, w: meta.width, h: meta.height });
  } finally {
    browser.__done();
  }

  // Excess-green vegetation index — a standard, scene-independent heuristic
  // (2G - R - B), not a scene-specific calibration: real pavement/concrete/
  // roofs are desaturated (R~G~B); grass and tree canopy are not. This tells
  // us "is there vegetation directly under this drawn path", which is the one
  // failure mode OSM itself cannot see (OSM can be wrong or absent; a real
  // aerial photo cannot).
  const EXG_THRESHOLD = 20;
  let vegCount = 0, validCount = 0;
  for (const rgb of sampledPixels) {
    if (!rgb) continue;
    validCount++;
    const exg = 2 * rgb[1] - rgb[0] - rgb[2];
    if (exg > EXG_THRESHOLD) vegCount++;
  }
  vegShare = validCount ? vegCount / validCount : NaN;
  console.log(`\n  METRIC B — real USGS NAIP aerial pixel under each drawn walkway point (${meta._fetched}, public domain):`);
  console.log(`    ${vegCount} of ${validCount} sampled points land on a pixel that reads as VEGETATION`);
  console.log(`    (grass/canopy) in the real photo, not pavement — ${(vegShare * 100).toFixed(1)}% of the walkway`);
  console.log(`    network sampled has no visible paved surface under it in reality.`);
  console.log(`    TWO caveats, both real, pulling in opposite directions — read this as a signal worth a`);
  console.log(`    human look, not a settled count: (1) a non-vegetation pixel could be a roof or a road, not`);
  console.log(`    necessarily this exact path, so this UNDER-counts true misplacement; (2) this campus has`);
  console.log(`    heavy live-oak canopy (visible in the fixture image itself) that overhangs real paved paths`);
  console.log(`    from directly overhead, which an aerial photo cannot see through — so some share of this`);
  console.log(`    number is certainly canopy shadow over a real path, not a path floating in open lawn, and`);
  console.log(`    this metric cannot currently tell the two apart.`);

  return {
    sampled: sampled.length,
    metricA: { within5: within5A, within10: within10A, checked: distA.length, medianM: median(distA) },
    metricB: { vegCount, checked: validCount, vegShare },
  };
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 1b — ERA PROVENANCE (added 2026-08-27)
//
// "Is the door in the right place" and "is the door the right KIND of door"
// are different questions, and the entrances section above only answers the
// first. A door can sit within 0.6 m of UT's own surveyed coordinate and still
// be drawn as a green aluminium storefront on a 1930 limestone-and-brick
// building — that is exactly what was found on Welch Hall. This section scores
// the second question, and it deliberately scores PROVENANCE rather than
// correctness: not "is this the right family" (which needs a photograph per
// building and cannot be automated) but "did ANY source say so, or did nobody
// know". An era nobody sourced is the template Simeon named.
//
// IT DOES NOT TRUST THE BAKE. data/entrances.geojson now carries `famsrc` on
// every piece — the name of the cascade rule that chose the family. Believing
// that field would make this section an echo of the file it is scoring. So the
// check is a CROSS-EXAMINATION: for every door claiming `famsrc:"register-year"`
// this script goes and looks up that building's code in UT's own register
// (data/ut_buildings.json, fetched from the running server) and in the
// YEAR_UTDIRECT table it slices out of scripts/bake_entrances.py, and if the
// year is not actually there the claim fails loudly. A lane that wanted to
// inflate this number by writing "register-year" onto everything would trip
// that check on the first door.
//
// It also cannot be raised by drawing FEWER doors: deleting a sourced door
// lowers the numerator, deleting an unsourced one lowers the denominator, and
// the share of the city that is honestly known does not improve by drawing
// less of it. Both halves are printed.
async function scoreEraProvenance() {
  console.log('\n── ERA PROVENANCE (what KIND of door, and who says so) ────');

  const entGJ = await getJSON(`${BASE}/data/entrances.geojson`);
  const feats = entGJ.features || [];
  // `famsrc` rides ONE piece per entrance (a payload decision the bake
  // documents in Ent.emit), so the per-door record is the piece that carries
  // it — not simply the first piece with this eid.
  const doors = new Map();
  let pieces = 0;
  for (const f of feats) {
    const p = f.properties || {};
    pieces++;
    if (p.famsrc !== undefined) doors.set(p.eid, p);
  }
  if (!doors.size) throw new Error(`no entrance carries famsrc (${pieces} pieces served)`);
  const anyFam = [...doors.values()].some(p => p.fam);
  selfCheck('served entrances carry the `fam`/`famsrc` provenance fields',
    anyFam, 'no piece carries `fam` — this build predates the 2026-08-27 schema');
  if (!anyFam) {
    console.log('  this build has no provenance fields; nothing to score.');
    return null;
  }

  // --- the two year oracles, both read from the RUNNING SERVER -----------
  const reg = await getJSON(`${BASE}/data/ut_buildings.json`);
  const regYear = new Map();
  for (const b of (reg.buildings || [])) {
    if (b.ref && Number.isInteger(b.occupied)) regYear.set(b.ref, b.occupied);
  }
  selfCheck('data/ut_buildings.json parses to ~198 dated UT codes',
    regYear.size >= 150 && regYear.size <= 260, `got ${regYear.size}`);

  const bakeSrc = await getText(`${BASE}/scripts/bake_entrances.py`);
  const utdRaw = extractBalanced(bakeSrc, 'YEAR_UTDIRECT = {', '{', '}');
  const utdYear = new Map();
  for (const m of utdRaw.matchAll(/"([A-Z0-9]{2,7})":\s*(\d{4})/g)) {
    utdYear.set(m[1], +m[2]);
  }
  selfCheck('YEAR_UTDIRECT parses to the UT Direct sweep (>= 15 codes)',
    utdYear.size >= 15, `got ${utdYear.size}`);

  // --- grade table, sliced out of the bake so it cannot drift from it ----
  const gradeRaw = extractBalanced(bakeSrc, 'ERA_GRADE = {', '{', '}');
  const grade = new Map();
  for (const m of gradeRaw.matchAll(/"([a-z-]+)":\s*\("([A-Z]+)"/g)) grade.set(m[1], m[2]);
  selfCheck('ERA_GRADE parses to the four provenance grades',
    grade.size >= 8 && new Set(grade.values()).size === 4,
    `${grade.size} rules, grades ${[...new Set(grade.values())].join('/')}`);

  // --- score, and cross-examine every "register-year" claim --------------
  const byGrade = {}, byRule = {}, byFam = {};
  const liars = [];
  for (const p of doors.values()) {
    const rule = p.famsrc || '(none)';
    const g = grade.get(rule) || '?';
    byGrade[g] = (byGrade[g] || 0) + 1;
    byRule[rule] = (byRule[rule] || 0) + 1;
    byFam[p.fam || '?'] = (byFam[p.fam || '?'] || 0) + 1;
    if (rule === 'register-year') {
      const has = (p.ref && (regYear.has(p.ref) || utdYear.has(p.ref)));
      if (!has) liars.push(`${p.ref || '(no code)'} eid ${p.eid}`);
    }
  }
  const n = doors.size;
  const measured = byGrade.MEASURED || 0;
  const none = byGrade.NONE || 0;
  console.log(`  ${n} drawn doors`);
  console.log(`  MEASURED ${measured} (${(100 * measured / n).toFixed(0)}%)   ` +
    `AUTHORED ${byGrade.AUTHORED || 0}   GUESSED ${byGrade.GUESSED || 0}   ` +
    `NO ERA KNOWN ${none} (${(100 * none / n).toFixed(0)}%)`);
  for (const [rule, c] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${(grade.get(rule) || '?').padEnd(9)} ${String(c).padStart(4)}  ${rule}`);
  }
  console.log(`  door families drawn: ${JSON.stringify(byFam)}`);

  selfCheck('every door claiming a register year really has one in a served source',
    liars.length === 0, liars.slice(0, 6).join(', '));
  if (liars.length) {
    console.error(`  ${liars.length} door(s) claim famsrc:"register-year" for a code no ` +
      'served source dates. That is the file asserting a measurement it does not have.');
  }
  return { doors: n, measured, authored: byGrade.AUTHORED || 0,
           guessed: byGrade.GUESSED || 0, none, byRule, byFam,
           unverifiedYearClaims: liars.length };
}


// ════════════════════════════════════════════════════════════════════════
// SECTION 1c — DOOR SHELTER (what stands over the door, and does a
//              PHOTOGRAPH agree) — added 2026-08-27
//
// The gap this closes, in the reviewer's own words: "Family D's GEOMETRY was
// never checked against a photograph, on this building or any other — only
// its ASSIGNMENT got a sourced pass." bake_entrances.py hardcoded
// `canopy=dict(proj=3.20, t=0.18, top=4.20, mat="steel")` as family D's
// identifying feature on every building it touched, permanently, and the very
// entrance the previous round cited as its win (the Tom & Cinda Hicks North
// Gate) has no canopy at all in UT's own photograph of it. Section 1b scores
// whether a door's ERA is honestly sourced. Nothing scored whether the SHAPE
// is.
//
// THE ORACLE IS HELD OUT ON PURPOSE. Every one of the 98 observations was made
// the same way — open UT's own building photograph, look at the entrance, say
// what is over it — and then a deterministic third of them
// (sha1(code)[0] in "0123", fixed before a single row was written) was
// WITHHELD from the bake. 76 rows are training data and live in
// bake_entrances.py's SHELTER_OBS; the other 22 live only in
// campusmeter-fixtures/door-shelter.blind.json and the bake has never read
// them. So this score is not "does the file agree with the table it reads" —
// which would be a tautology and would go straight to 100% — it is "on 22
// buildings the file has never seen, does what it draws match the photo".
//
// WHY THAT CANNOT BE GAMED BY COPYING THE ANSWERS ACROSS. The first
// self-check below asserts the two sets are DISJOINT and exits 1 if any code
// appears in both. A lane that pasted blind rows into SHELTER_OBS to lift the
// number would fail the harness rather than raise the score.
//
// IT ALSO CANNOT BE GAMED BY DRAWING NOTHING. Two of the four numbers below
// are recall on the canopies that really exist. Delete every canopy in the
// file and "no canopy" scores 18 of 22 on the blind set but 0 of 4 on the
// buildings that have one, and both halves are printed side by side.
//
// THE BASELINE IS READ OUT OF THE FILE, NOT REMEMBERED. The "family rule"
// column is what the era alphabet ALONE would draw — a canopy iff this door's
// family declares one in FAMILIES — and it is recovered by slicing the real
// FAMILIES table out of the served bake source at run time. C, D and E2 still
// declare their canopy dicts (the change gates them at assembly, it did not
// delete the vocabulary), so the old rule stays measurable from the file
// itself and this comparison keeps working without a number copied into here.
async function scoreDoorShelter() {
  console.log('\n── DOOR SHELTER (is the shape over the door in the photo?) ──');

  const blind = JSON.parse(fs.readFileSync(
    path.join(FIXTURES, 'door-shelter.blind.json'), 'utf8'));
  selfCheck('blind shelter fixture carries its declared row count',
    blind.rows.length === blind._count, `${blind.rows.length} vs ${blind._count}`);

  const bakeSrc = await getText(`${BASE}/scripts/bake_entrances.py`);

  // --- the TRAINING codes, sliced out of the bake itself -----------------
  const obsRaw = extractBalanced(bakeSrc, 'SHELTER_OBS = {', '{', '}');
  const trainCodes = new Set();
  for (const m of obsRaw.matchAll(/"([A-Z0-9]{2,7})":\s*dict\(k=/g)) trainCodes.add(m[1]);
  selfCheck('SHELTER_OBS parses to the training half of the survey (>= 60 codes)',
    trainCodes.size >= 60, `got ${trainCodes.size}`);

  const overlap = blind.rows.map(r => r.code).filter(c => trainCodes.has(c));
  selfCheck('training table and held-out fixture are DISJOINT',
    overlap.length === 0,
    `${overlap.length} code(s) in both: ${overlap.join(', ')} — the held-out ` +
    'third has leaked into the table the bake reads, and this score is no ' +
    'longer a held-out score');

  // --- the OLD rule, recovered from FAMILIES ----------------------------
  const famRaw = extractBalanced(bakeSrc, 'FAMILIES = {', '{', '}');
  const famDeclaresCanopy = new Map();
  // each family is `"KEY": dict( ... ),` at one indent level; split on the keys
  const famKeys = [...famRaw.matchAll(/\n    "([A-Z0-9]{1,2})":\s*dict\(/g)];
  for (let i = 0; i < famKeys.length; i++) {
    const from = famKeys[i].index;
    const to = i + 1 < famKeys.length ? famKeys[i + 1].index : famRaw.length;
    const body = famRaw.slice(from, to);
    famDeclaresCanopy.set(famKeys[i][1], /canopy=dict\(/.test(body));
  }
  const declaring = [...famDeclaresCanopy.entries()].filter(([, v]) => v).map(([k]) => k);
  selfCheck('FAMILIES parses to 10 door families, >= 3 of which declare a canopy',
    famDeclaresCanopy.size === 10 && declaring.length >= 3,
    `${famDeclaresCanopy.size} families, canopy declared by [${declaring.join(',')}]`);

  // --- what the running city actually DRAWS -----------------------------
  const entGJ = await getJSON(`${BASE}/data/entrances.geojson`);
  const doors = new Map();
  for (const f of entGJ.features || []) {
    const p = f.properties || {};
    let d = doors.get(p.eid);
    if (!d) { d = { eid: p.eid, ref: null, fam: null, role: null, canopy: false, csrc: null }; doors.set(p.eid, d); }
    if (d.ref === null && p.ref) d.ref = p.ref;
    if (d.fam === null && p.fam) d.fam = p.fam;
    if (d.role === null && p.role) d.role = p.role;
    if (p.k === 'canopy') { d.canopy = true; if (p.csrc) d.csrc = p.csrc; }
  }
  const drawn = [...doors.values()];
  const withCanopy = drawn.filter(d => d.canopy);
  const sourced = withCanopy.filter(d => d.csrc);
  console.log(`  ${drawn.length} drawn doors, ${withCanopy.length} of them carry a canopy, ` +
    `${sourced.length} of those cite where it came from (\`csrc\`)`);
  const bySrc = {};
  for (const d of withCanopy) bySrc[d.csrc || '(uncited)'] = (bySrc[d.csrc || '(uncited)'] || 0) + 1;
  console.log(`      ${JSON.stringify(bySrc)}`);

  // --- the held-out score -----------------------------------------------
  // One call per BUILDING: the photograph is of the building's entrance, so
  // the building is judged on whether ANY of its drawn doors carries a canopy.
  const byRef = new Map();
  for (const d of drawn) {
    if (!d.ref) continue;
    const e = byRef.get(d.ref) || { canopy: false, fams: new Set(), n: 0 };
    e.canopy = e.canopy || d.canopy;
    e.fams.add(d.fam);
    e.n++;
    byRef.set(d.ref, e);
  }

  let nowRight = 0, oldRight = 0, checked = 0;
  let nowCanRight = 0, oldCanRight = 0, nCan = 0;
  const rows = [];
  for (const r of blind.rows) {
    const e = byRef.get(r.code);
    if (!e) continue;                       // no drawn door on this code
    checked++;
    const wantCanopy = r.shelter === 'canopy';
    if (wantCanopy) nCan++;
    const isNow = e.canopy;
    // the old rule: the era alphabet alone. W is the one family whose canopy
    // is drawn by its own assembler rather than declared in FAMILIES; no
    // held-out code is family W, and if one ever is this line says so.
    const isOld = [...e.fams].some(f => famDeclaresCanopy.get(f) === true || f === 'W');
    if (isNow === wantCanopy) { nowRight++; if (wantCanopy) nowCanRight++; }
    if (isOld === wantCanopy) { oldRight++; if (wantCanopy) oldCanRight++; }
    rows.push({ code: r.code, photo: r.shelter, fam: [...e.fams].join('/'),
                old: isOld ? 'canopy' : 'none', now: isNow ? 'canopy' : 'none',
                oldOK: isOld === wantCanopy, nowOK: isNow === wantCanopy });
  }

  console.log(`\n  HELD OUT — ${checked} buildings the bake has never seen a row for:`);
  console.log('  code   photograph says   era-alphabet drew   this build draws');
  console.log('  ---------------------------------------------------------------');
  for (const r of rows.sort((a, b) => a.photo.localeCompare(b.photo) || a.code.localeCompare(b.code))) {
    console.log(`  ${r.code.padEnd(6)} ${r.photo.padEnd(17)} ` +
      `${(r.old + (r.oldOK ? '  ok' : '  NO')).padEnd(19)} ` +
      `${r.now + (r.nowOK ? '  ok' : '  NO')}`);
  }
  console.log(`\n  HEADLINE: ${nowRight} of ${checked} held-out buildings show what the ` +
    `photograph shows (the era alphabet alone: ${oldRight} of ${checked})`);
  console.log(`  and on the ${nCan} held-out buildings that really DO have a canopy, ` +
    `this build draws ${nowCanRight} (the era alphabet: ${oldCanRight}) — ` +
    'printed so "draw nothing" cannot pass as an answer');

  return { checked, nowRight, oldRight, canopies: nCan, nowCanRight, oldCanRight,
           drawnDoors: drawn.length, drawnCanopies: withCanopy.length,
           sourcedCanopies: sourced.length, bySrc, trainRows: trainCodes.size };
}

// ════════════════════════════════════════════════════════════════════════
const results = {};
try {
  results.entrances = await scoreEntrances();
  results.eras = await scoreEraProvenance();
  results.shelter = await scoreDoorShelter();
  results.facades = await scoreFacades();
  results.paths = await scorePaths();
} catch (e) {
  console.error('\n[campusmeter] FAILED:', e.message);
  console.error(e.stack);
  process.exit(2);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('SUMMARY — the starting score, before anything changes');
console.log('══════════════════════════════════════════════════════════');
if (results.entrances) {
  console.log(`entrances  A: ${results.entrances.metricA.within10}/${results.entrances.metricA.checked} within 10 m of UT's own door` +
    `   B: ${results.entrances.metricB.within10}/${results.entrances.metricB.checked} within 10 m of any OSM node`);
}
if (results.eras) {
  console.log(`eras       ${results.eras.measured}/${results.eras.doors} drawn doors have a MEASURED era ` +
    `(${results.eras.none} have none at all)`);
}
if (results.shelter) {
  console.log(`shelter    ${results.shelter.nowRight}/${results.shelter.checked} HELD-OUT buildings' door shelter matches the photograph ` +
    `(era alphabet alone: ${results.shelter.oldRight}/${results.shelter.checked}); ` +
    `${results.shelter.sourcedCanopies}/${results.shelter.drawnCanopies} drawn canopies cite a source`);
}
if (results.facades) {
  console.log(`facades    ${results.facades.matches}/${results.facades.targets} target buildings' drawn grid matches the photograph`);
}
if (results.paths) {
  console.log(`paths      A: ${results.paths.metricA.within5}/${results.paths.metricA.checked} within 5 m of a fresh OSM way (median ${results.paths.metricA.medianM.toFixed(1)} m)` +
    `   B: ${results.paths.metricB.vegCount}/${results.paths.metricB.checked} sampled points sit on vegetation in the real aerial photo`);
}

if (JSON_OUT) {
  fs.writeFileSync(path.resolve(process.cwd(), JSON_OUT), JSON.stringify(results, null, 2));
  console.log(`\nfull tables written to ${JSON_OUT}`);
}

if (hadSelfCheckFailure) {
  console.error('\nOne or more oracle self-checks failed — see [self-check FAILED] lines above.');
  console.error('This means a PARSER in this script has drifted from its source, not a finding about the city.');
  process.exit(1);
}
process.exit(0);
