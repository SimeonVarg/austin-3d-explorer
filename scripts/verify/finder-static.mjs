/**
 * finder-static.mjs — the apartment finder, checked without a browser.
 *
 *   1. DATA: the three tables in data/finder/ have the shape js/finder.js
 *      reads, agree with each other and with the walking graph, and stay small.
 *   2. PRIVACY: nothing in the finder can send anything over the network except
 *      GETs of its own four static files. Read off the source, the way the
 *      egress audit reads wayfind.js: every network primitive is counted, and
 *      the one `fetch` must only ever be handed a FINDER.data.* path.
 *   3. THE SWITCHES: WAYFIND.on is still false, the finder's import-only door
 *      still installs the egress guard and still obeys `?walk=0`, and both
 *      pages load the finder.
 *
 * Usage: node scripts/verify/finder-static.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// VERIFY_ROOT=<dir> checks another checkout (used to show these checks fail on a deliberately broken copy).
const ROOT = process.env.VERIFY_ROOT ? path.resolve(process.env.VERIFY_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJSON = (rel) => JSON.parse(read(rel));

// ── limits (one line each) ──
const MAX_FILE_BYTES = 32 * 1024;     // any one finder table
const MAX_TOTAL_BYTES = 64 * 1024;    // all three together
const AUSTIN = { w: -97.80, e: -97.65, s: 30.20, n: 30.42 };
const AREAS = new Set(['West Campus', 'North Campus', 'Campus', 'Downtown', 'East Riverside']);

const fails = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

// ══════════════════════════════════════════════════════════════════════════
// 1. DATA
// ══════════════════════════════════════════════════════════════════════════
const graph = readJSON('data/walk_graph.json');
const homesDoc = readJSON('data/finder/homes.json');
const majorsDoc = readJSON('data/finder/major-buildings.json');
const transit = readJSON('data/finder/transit.json');

let total = 0;
for (const f of ['homes.json', 'major-buildings.json', 'transit.json']) {
  const n = fs.statSync(path.join(ROOT, 'data', 'finder', f)).size;
  total += n;
  ok(n <= MAX_FILE_BYTES, `data/finder/${f} is ${n} bytes (limit ${MAX_FILE_BYTES})`);
}
ok(total <= MAX_TOTAL_BYTES, `data/finder/ totals ${total} bytes (limit ${MAX_TOTAL_BYTES})`);

// homes
ok(homesDoc.v === 1 && Array.isArray(homesDoc.homes) && homesDoc.homes.length >= 40, 'homes.json: v1 with 40+ homes');
const ids = new Set(), names = new Set();
for (const h of homesDoc.homes) {
  const tag = `homes.json ${h.id}`;
  ok(/^[a-z0-9-]+$/.test(h.id) && !ids.has(h.id), `${tag}: id is a unique slug`); ids.add(h.id);
  ok(typeof h.name === 'string' && h.name && !names.has(h.name.toLowerCase()), `${tag}: name present and not duplicated`);
  names.add(h.name.toLowerCase());
  ok(AREAS.has(h.area), `${tag}: area "${h.area}" is a known label`);
  ok(h.kind === 'apartment' || h.kind === 'dorm', `${tag}: kind`);
  ok(Array.isArray(h.p) && h.p.length === 2 && h.p[0] > AUSTIN.w && h.p[0] < AUSTIN.e && h.p[1] > AUSTIN.s && h.p[1] < AUSTIN.n,
    `${tag}: p is [lon, lat] in Austin`);
  if (h.wc) ok(!!graph.wc[h.wc], `${tag}: wc "${h.wc}" exists in the walking graph`);
  if (h.model) ok(fs.existsSync(path.join(ROOT, 'data', 'apartments', h.model + '.json')), `${tag}: model file exists`);
  if (h.bus) ok(!!transit.homes[h.id], `${tag}: bus home has a transit row`);
}
for (const wc of Object.keys(graph.wc)) ok(homesDoc.homes.some(h => h.wc === wc), `every walking-graph home is listed (${wc})`);
ok(homesDoc.homes.filter(h => h.area === 'East Riverside').length === 4, 'the four East Riverside complexes are listed');

// majors
const majors = majorsDoc.majors;
ok(majorsDoc.v === 1 && Array.isArray(majors) && majors.length >= 40, `major-buildings.json: v1 with 40+ majors (${majors.length})`);
const mids = new Set();
for (const m of majors) {
  const tag = `major-buildings.json ${m.id}`;
  ok(/^[a-z0-9-]+$/.test(m.id) && !mids.has(m.id), `${tag}: id is a unique slug`); mids.add(m.id);
  ok(m.name && typeof m.name === 'string', `${tag}: name`);
  ok(m.conf === 'solid' || m.conf === 'estimated', `${tag}: conf`);
  ok(m.spec >= 0 && m.spec <= 1 && m.free >= 0 && m.free <= 1, `${tag}: spec/free are shares`);
  const s = m.b.reduce((a, [, w]) => a + w, 0);
  ok(Math.abs(s - 1) < 0.002, `${tag}: weights sum to 1 (${s.toFixed(4)})`);
  ok(m.b.every(([c, w]) => /^[A-Z0-9]{2,4}$/.test(c) && w > 0), `${tag}: codes and weights`);
  ok(m.b.every(([c]) => graph.code[c] && graph.code[c].length), `${tag}: every building has a door in the walking graph`);
}
ok(majors.some(m => m.conf === 'estimated') && majors.some(m => m.conf === 'solid'), 'both confidence levels occur');

// transit
ok(transit.v === 1 && Array.isArray(transit.anchors) && transit.anchors.length === 4, 'transit.json: v1 with 4 anchors');
for (const a of transit.anchors) ok(!!transit.stops[a.stop], `transit anchor ${a.id}: its stop is listed`);
for (const [hid, row] of Object.entries(transit.homes)) {
  ok(ids.has(hid), `transit home ${hid} is a home`);
  for (const [aid, t] of Object.entries(row)) {
    const tag = `transit ${hid}->${aid}`;
    ok(transit.anchors.some(a => a.id === aid), `${tag}: anchor exists`);
    ok(t.min > t.wait && t.wait >= 0 && t.ride > 0, `${tag}: min > wait >= 0, ride > 0`);
    ok(Math.abs(t.walk_to_stop + t.wait + t.ride + t.walk_to_anchor - t.min) < 0.3, `${tag}: parts add up to min`);
    ok(!!transit.routes[t.route] && !!transit.stops[t.board] && !!transit.stops[t.alight], `${tag}: route and stops listed`);
    ok(Number.isInteger(t.shape) && Array.isArray(transit.shapes[t.shape]) && transit.shapes[t.shape].length >= 2, `${tag}: shape`);
  }
}
const width = 2 + 2 * transit.anchors.length;
ok(transit.grid.cells.length > 100 && transit.grid.cells.every(c => c.length === width), `transit grid: ${transit.grid.cells.length} cells of ${width}`);

// ══════════════════════════════════════════════════════════════════════════
// 2. PRIVACY — read off the source
// ══════════════════════════════════════════════════════════════════════════
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const finder = strip(read('js/finder.js')), fcore = strip(read('js/finder-core.js'));
const count = (s, re) => (s.match(re) || []).length;
const BANNED = [
  ['XMLHttpRequest', /XMLHttpRequest/g], ['sendBeacon', /sendBeacon/g], ['WebSocket', /WebSocket/g],
  ['EventSource', /EventSource/g], ['RTCPeerConnection', /RTCPeerConnection/g], ['postMessage', /postMessage/g],
  ['new Image / img src', /new Image\b|\.src\s*=\s*['"`]?https?:/g], ['form submit', /\.submit\s*\(|<form/g],
  ['window.open', /window\.open\s*\(/g], ['history write', /history\.(push|replace)State/g],
  ['location write', /location(\.href)?\s*=[^=]/g], ['absolute URL', /['"`]https?:\/\//g],
  // Dynamic import stays banned EXCEPT the two literal, same-origin specifiers below:
  // finder.js loads its own arithmetic and the router's graph code when the panel first
  // loads, so a visit that never opens it fetches neither (img-import.mjs gate 1).
  // finder-live.js (2026-10-09) is the third: the live bus line, loaded when a home is first selected. Section 2b
  // below checks that file and the two it uses. finder-bus.js (2026-10-10) is the fourth: the bus in the ranking and on the
  // map, loaded when the mode first allows a bus. Section 2c checks it.
  ['dynamic import', /\bimport\s*\((?!\s*'\.\/(?:finder-core|walkgraph|finder-live|finder-bus)\.js'\s*\))/g], ['navigator', /navigator\./g], ['serviceWorker', /serviceWorker/g],
];
for (const [name, re] of BANNED) {
  ok(count(finder, re) === 0, `js/finder.js uses ${name}`);
  ok(count(fcore, re) === 0, `js/finder-core.js uses ${name}`);
}
ok(count(fcore, /\bfetch\s*\(/g) === 0, 'js/finder-core.js never fetches');
ok(count(finder, /\bimport\s*\(\s*'\.\/finder-core\.js'\s*\)/g) === 1 && count(finder, /\bimport\s*\(\s*'\.\/walkgraph\.js'\s*\)/g) === 1,
  'js/finder.js lazily imports exactly finder-core.js and walkgraph.js');
ok(count(finder, /^\s*import\s+(?!\()/gm) === 0, 'js/finder.js has no static import: nothing of the router loads at page load');
ok(count(fcore, /\b(window|document|localStorage|sessionStorage|indexedDB)\b/g) === 0, 'js/finder-core.js touches no browser state');
ok(count(finder, /\bfetch\s*\(/g) === 1, 'js/finder.js has exactly one fetch (inside getJSON)');
ok(/function getJSON\(url\)\s*\{\s*return fetch\(url,/.test(finder), 'the one fetch is getJSON(url)');
const gets = [...finder.matchAll(/getJSON\(([^)]*)\)/g)].map(m => m[1].trim()).filter(a => a !== 'url');
ok(gets.length === 4 && gets.every(a => /^FINDER\.data\.(homes|majors|transit|graph)$/.test(a)), `getJSON is only handed FINDER.data.* (${gets.join(', ')})`);
const dataBlock = read('js/finder.js').match(/data:\s*\{([\s\S]*?)\}/)[1];
ok([...dataBlock.matchAll(/'([^']+)'/g)].every(m => /^data\/[a-z0-9_/-]+\.json$/.test(m[1])), 'FINDER.data holds only same-origin data/*.json paths');
// Storage: one write, the prefs key, which is not in the schedule's namespace.
ok(count(finder, /localStorage\.setItem/g) === 1, 'one localStorage write');
ok(/localStorage\.setItem\(FINDER\.prefsKey,/.test(finder), 'the write is the prefs key');
ok(/prefsKey:\s*'austin3d\.finder\.ui'/.test(read('js/finder.js')), 'prefs key is austin3d.finder.ui');
ok(/const p = \{ major: S\.majorId \|\| null, mode: S\.mode, heat: S\.heat, closed: !!prefs\.closed, preferMajor: !!S\.preferMajor \};/.test(finder),
  'prefs hold major, mode, heat, closed and the use-a-major choice (a yes/no) only');
// The one injected script is the page's own wayfind.js.
ok(count(finder, /createElement\('script'\)/g) === 1, 'one script element created');
ok(/js\\\/wayfind\\\.js/.test(finder) && /s\.src = own;/.test(finder), 'it is the page\'s own js/wayfind.js');

// 2b. THE LIVE BUS LINE (js/finder-live.js -> js/transit-route.js, js/transit-live.js)
// The class building's door goes into finder-live.js. It may reach transit-route.js (no network code at all) and
// nothing else. transit-live.js downloads the same public files for everyone: none of its addresses may depend on
// anything a caller passes in.
{
  const flive = strip(read('js/finder-live.js')), troute = strip(read('js/transit-route.js')), tlive = strip(read('js/transit-live.js'));
  // finder.js loads finder-live.js in three places: the live line under a home, the bus in the ranking (only its loader), and the
  // live-buses switch. Each is literal and same-origin; the checks below say what the file may do once loaded.
  ok(count(finder, /\bimport\s*\(\s*'\.\/finder-live\.js'\s*\)/g) === 3, 'js/finder.js imports finder-live.js in exactly three places (the line, the ranking\'s loader, the live-buses switch)');
  ok(count(finder, /\bimport\s*\(\s*'\.\/finder-bus\.js'\s*\)/g) === 2, 'js/finder.js imports finder-bus.js in exactly two places (the ranking, the live line\'s trip)');
  for (const [name, re] of BANNED) {
    if (name === 'dynamic import') { ok(count(flive, /\bimport\s*\(/g) === 0 && count(troute, /\bimport\s*\(/g) === 0, 'no dynamic import in finder-live.js or transit-route.js'); continue; }
    ok(count(flive, re) === 0, `js/finder-live.js uses ${name}`);
    ok(count(troute, re) === 0, `js/transit-route.js uses ${name}`);
  }
  ok(count(flive, /\bfetch\s*\(/g) === 0 && count(troute, /\bfetch\s*\(/g) === 0, 'finder-live.js and transit-route.js never fetch');
  ok(count(troute, /\b(window|document|localStorage|sessionStorage|indexedDB|globalThis)\b/g) === 0, 'js/transit-route.js touches no browser state');
  ok(count(flive, /\b(localStorage|sessionStorage|indexedDB)\b/g) === 0, 'js/finder-live.js stores nothing');
  const imports = [...flive.matchAll(/^\s*import\s+[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  ok(imports.length === 1 && imports[0] === './transit-route.js', `finder-live.js statically imports only transit-route.js (${imports.join(', ')})`);
  ok(count(flive, /createElement\('script'\)/g) === 1 && /transit-live\.js/.test(flive), 'finder-live.js injects one script: the page\'s own js/transit-live.js');
  // transit-live.js: what it knows and where it may go.
  // ("schedule" is not in this list: the file uses that word for the BUS timetable.)
  ok(count(tlive, /\b(localStorage|sessionStorage|indexedDB|wayfind\w*|finder\w*|__wayfind\w*)\b/gi) === 0, 'js/transit-live.js never names storage, the finder or the walking feature');
  const abs = [...tlive.matchAll(/['"`](https?:\/\/[^'"`]*)['"`]/g)].map((m) => m[1]);
  ok(abs.length >= 1 && abs.every((u) => u.startsWith('https://data.texas.gov/')), `every address in transit-live.js is on data.texas.gov (${[...new Set(abs)].join(', ')})`);
  for (const [name, re] of BANNED) {
    if (['absolute URL', 'dynamic import'].includes(name)) continue;
    ok(count(tlive, re) === 0, `js/transit-live.js uses ${name}`);
  }
  // departures(stopId, ...) must not start a download: the stop is the one argument that could carry a class building.
  const dep = tlive.match(/function departures\([\s\S]*?\n  \}/);
  ok(dep && !/\bfetch\s*\(|\bkick\s*\(|\bpoll\w*\s*\(|\bload\w*\s*\(|\bstart\s*\(/.test(dep[0]), 'TransitLive.departures() reads what is already downloaded and starts no request');
}

// 2c. THE PATHFINDER PASS (2026-10-10): the bus in the ranking, on the map, as live vehicles, and in the walking pathfinder.
// Four new ways for a home, a route or a class building to be near code that could talk to the network. Each is read here.
{
  const fbus = strip(read('js/finder-bus.js')), flive = strip(read('js/finder-live.js')), tlive = strip(read('js/transit-live.js'));
  const wfRaw = read('js/wayfind.js').replace(/\r\n/g, '\n');

  // ── the ranking and the trip drawn on the map: arithmetic, no network at all ──
  for (const [name, re] of BANNED) {
    if (name === 'dynamic import') { ok(count(fbus, /\bimport\s*\(/g) === 0, 'no dynamic import in finder-bus.js'); continue; }
    ok(count(fbus, re) === 0, `js/finder-bus.js uses ${name}`);
  }
  ok(count(fbus, /\bfetch\s*\(/g) === 0, 'js/finder-bus.js never fetches');
  ok(count(fbus, /\b(window|document|localStorage|sessionStorage|indexedDB|globalThis|setTimeout|setInterval)\b/g) === 0, 'js/finder-bus.js touches no browser state and sets no timer');
  const bimports = [...fbus.matchAll(/^\s*import\s+[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  ok(bimports.length === 1 && bimports[0] === './transit-route.js', `finder-bus.js statically imports only transit-route.js (${bimports.join(', ')})`);
  ok(count(fbus, /\bcreateElement\b|\.appendChild\b|\.append\s*\(/g) === 0, 'js/finder-bus.js builds no DOM');
  // The ranking is by the timetable, never live: it must not be handed a live callback.
  ok(!/\blive\s*:/.test(fbus.slice(fbus.indexOf('export function busLeg('), fbus.indexOf('export function busLegs('))), 'busLeg() gives plan() no live callback: the ranking is the timetable');
  // finder.js: the ranking is skipped in Walk mode and for a switched-off ranking; the East Riverside homes keep their baked table.
  ok(/if \(!FINDER\.bus\.rank \|\| S\.busLoad \|\| S\.mode === 'walk' \|\| !S\.loaded\) return;/.test(finder), 'the bus module and slice are not loaded in Walk mode, or with ?busrank=0');
  ok(/skip: \(hi\) => !!S\.transit\.homes\[items\[hi\]\.home\.id\],/.test(finder), 'the four East Riverside homes keep their baked bus table (the ranking skips them)');
  ok(/if \(!S\.busData \|\| !S\.fb \|\| S\.mode === 'walk'\) return null;/.test(finder), 'no timetable bus is added to a Walk ranking');
  ok(/bus: q\.get\('busrank'\) !== '0'|rank: q\.get\('busrank'\) !== '0'/.test(read('js/finder.js')), 'FINDER.bus.rank is on unless ?busrank=0');
  ok(/trip: \{\s*on: q\.get\('tripmap'\) !== '0',/.test(read('js/finder.js')), 'FINDER.trip.on is on unless ?tripmap=0');
  ok(/liveBuses: \{[^}]*available: q\.get\('livebuses'\) !== '0',\s*on: q\.get\('livebuses'\) === '1',/.test(read('js/finder.js')), 'FINDER.liveBuses is OFF by default (?livebuses=1 turns it on, ?livebuses=0 removes the switch)');

  // ── the row's words: evaluated, not just read ──
  const via = read('js/finder.js').match(/via: (\{ walk:[^\n]*\}),\n/);
  ok(!!via, 'FINDER.copy.via is there');
  if (via) {
    const V = new Function('return ' + via[1])();
    ok(V.walk('14–18') === 'walk 14–18 min' && V.bus('12–17') === 'bus about 12–17 min on class days' && V.mixed('9–15') === 'walk + bus about 9–15 min on class days',
      'a row says "walk 14–18 min" or "bus about 12–17 min on class days": ' + [V.walk('14–18'), V.bus('12–17'), V.mixed('9–15')].join(' | '));
    ok(!/class days|bus/.test(V.walk('1–2')) && /on class days$/.test(V.bus('1–2')) && /on class days$/.test(V.mixed('1–2')), 'every row that uses a bus says which days it means; a walk does not need to');
    ok(Object.values(V).every((f) => !/\d{1,2}:\d{2}|you will|guarantee|on time|live/i.test(f('1–2'))), 'a ranking row is the timetable: no clock time, no promise, never the word "live"');
  }
  const copyBlock = read('js/finder.js').match(/liveBusesToggle:[\s\S]*?liveBusesOn:[^\n]*\n/);
  ok(copyBlock && !/you will|guarantee|on time/i.test(copyBlock[0]), 'the live-buses copy makes no promise');

  // ── the whole trip in view: once per selection, never on a live poll, stopped by the visitor's own move ──
  ok(/tripFit: \{ on: true, pitch: 40, maxZoom: 16\.2, minZoom: 12\.5, ms: 1400 \},/.test(read('js/finder.js')), 'the trip view is a named parameter block (FINDER.fly.tripFit)');
  ok(count(finder, /\bflyToHome\(/g) === 2, 'flyToHome is defined once and called once (from select): never from a live poll');
  ok(/function onTrip\([\s\S]*?\n  \}/.test(finder) && !/flyToHome|glide\(/.test(finder.match(/function onTrip\([\s\S]*?\n  \}/)[0]), 'onTrip (every live poll) never moves the camera');
  ok(/if \(Math\.abs\(c\.lng - last\.lng\) > 1e-5 \|\| Math\.abs\(c\.lat - last\.lat\) > 1e-5 \|\| Math\.abs\(m\.getZoom\(\) - last\.zoom\) > 0\.01\) return;/.test(finder), 'the glide stops when anything else has moved the camera');
  ok(/if \(id !== S\.glideId \|\| S\.view === 'pill'\) return;/.test(finder) && /S\.selected = id; S\.glideId\+\+;/.test(finder), 'a new selection or a hidden finder ends a glide in progress');

  // ── "Show live buses": one shared poll, buses only, the trip's routes only, nothing polls while it is off ──
  ok(count(flive, /\.start\s*\(/g) === 1 && count(flive, /\bTL\.stop\s*\(/g) === 1, 'finder-live.js starts the poll in exactly one place and stops it in exactly one (acquire(), the shared count)');
  ok(count(flive, /\.attach\s*\(/g) === 2 && count(flive, /\.attach\s*\(map, \{ layers: \['vehicles'\], routes: routes\.slice\(\) \}\)/g) === 2, 'liveBuses attaches only the vehicles layer, and only the trip\'s routes, both times');
  ok(count(flive, /\.wantTrips\s*\(\s*true\s*\)/g) === 1, 'the 260 KB trip feed is wanted in one place only (the live line / the row), never by the buses on the map');
  ok(/acquire\(L\.TL, false\)/.test(flive), 'the buses on the map hold the poll without the trip feed');
  ok(/else if \(held\) \{ L\.TL\.detach\(\); held\(\); held = null; \}/.test(flive), 'an empty route list detaches the layer and lets go of the poll');
  ok(/stop\(\) \{ stopped = true; routes = \[\]; if \(held\) \{ if \(TLref\) TLref\.detach\(\); held\(\); held = null; \} \}/.test(flive), 'stop() detaches the layer and lets go of the poll');
  ok(/function renderList\(\) \{\s*const R = S\.result, list = \$\('\.fd-list'\);\s*list\.replaceChildren\(\);\s*if \(S\.liveStop\) \{ S\.liveStop\(\); S\.liveStop = null; \}/.test(finder), 'rebuilding the list stops the live line at once (a deselected home leaves nothing polling)');
  ok(/if \(v === 'pill'\) \{ S\.trip = null; S\.glideId\+\+; stopLiveBuses\(\); \}/.test(finder), 'hiding the finder stops the live buses');
  ok(/if \(!S\.liveOn \|\| !FINDER\.liveBuses\.available \|\| S\.view === 'pill' \|\| !S\.loaded\) \{ stopLiveBuses\(\); return; \}/.test(finder), 'with the switch off (or the finder hidden) the live buses are stopped, not paused');
  ok(/\$\('\.fd-livebuses input'\)\.onchange = \(e\) => \{ S\.liveOn = e\.target\.checked; syncLiveBuses\(\); \};/.test(finder), 'the switch is the only thing that turns the live buses on');
  // transit-live.js: the new calls add no address, and a route filter cannot become one
  ok(count(tlive, /\bsetRoutes\b/g) >= 2 && !/fetch\s*\([^)]*(only|routes|S\.layers)/.test(tlive), 'TransitLive.setRoutes / attach(routes) are filters on what is drawn; no fetch is built from them');

  // ── the pathfinder row (js/wayfind.js) ──
  const a = wfRaw.indexOf('function busRowClear()'), b = wfRaw.indexOf('function renderLive()');
  const row = strip(wfRaw.slice(a, b));
  ok(a > 0 && b > a, 'wayfind.js has the bus row block');
  for (const [name, re] of BANNED) {
    if (name === 'dynamic import') continue;
    ok(count(row, re) === 0, `the wayfind bus row block uses ${name}`);
  }
  ok(count(row, /\bfetch\s*\(/g) === 0, 'the wayfind bus row block never fetches');
  ok(count(row, /\bimport\s*\(/g) === 1 && /import\(WAYFIND\.busRowModule\)/.test(row), 'it imports one module, named by WAYFIND.busRowModule');
  ok(/busRowModule: '\.\/finder-live\.js',/.test(wfRaw), 'and that module is ./finder-live.js, relative to the script');
  ok(count(strip(wfRaw), /\bimport\(/g) === 2, 'wayfind.js has exactly two dynamic imports: the schedule-picture reader and the bus row');
  ok(/m\.watchRow\(el\.busRow, \[a\[1\], a\[0\]\], \[b\[1\], b\[0\]\], \{\s*code, el: h, walkS: \[r\.time\.lo \* 60, r\.time\.hi \* 60\], beatsWalkS: WAYFIND\.busRowBeatsWalkS,\s*\}\);/.test(row),
    'the row is handed the two DOORS of this route, the walk\'s own time and the margin, and nothing else (no schedule, no class list)');
  ok(/const a = doorLL\(G, r\.fromDoor\), b = doorLL\(G, r\.toDoor\);/.test(row), 'the two points are the route\'s own doors');
  ok(!/\b(schedSt|schedWatch|SCHEDULE_STORE|impState|events|classes)\b/.test(row), 'the row code never touches the stored schedule');
  ok(/if \(!WAYFIND\.busRowOn \|\| !r \|\| !r\.ok \|\| !r\.time \|\| r\.fromDoor == null \|\| r\.toDoor == null\) \{ busRowClear\(\); return; \}/.test(row), 'no route, a failed route or a switched-off row: nothing is imported or asked');
  ok(/if \(!\(mid >= WAYFIND\.busRowMinWalkMin\)\) \{ busRowClear\(\); return; \}/.test(row), 'a walk shorter than WAYFIND.busRowMinWalkMin never looks for a bus (the module is not even imported)');
  ok(/busRowOn: q\.get\('busrow'\) !== '0'/.test(wfRaw), 'WAYFIND.busRowOn is on unless ?busrow=0');
  ok(count(wfRaw, /\bbusRowClear\(\);/g) >= 4 && count(wfRaw, /\bbusRowSync\(r\);/g) === 1, 'the row is cleared when the route fails, is cleared, or changes, and synced once per render');
  ok(/function clear\(\) \{\n    busRowClear\(\);/.test(wfRaw), 'clear() (the route removed) stops the row\'s downloads first');
}

// ══════════════════════════════════════════════════════════════════════════
// 3. THE SWITCHES
// ══════════════════════════════════════════════════════════════════════════
const wf = read('js/wayfind.js').replace(/\r\n/g, '\n');   // the checkout may be CRLF
ok(/const WAYFIND = \{[\s\S]{0,600}?\n\s*on: false,/.test(wf), 'WAYFIND.on is false');
ok(/const IMPORT_ONLY = !ENABLED && urlWalk !== '0' && window\.__wayfindImportOnly === true;/.test(wf), 'import-only obeys ?walk=0 and needs the finder\'s flag');
ok(/if \(!ENABLED && !IMPORT_ONLY\) return;/.test(wf), 'nothing past the gate runs unless enabled or import-only');
const tail = wf.slice(wf.indexOf('// ── install, and the public seam the import lanes call'));
ok(/\n  installEgressGuard\(\);\n/.test(tail), 'the egress guard is installed unconditionally past the gate');
ok(/if \(!IMPORT_ONLY\) \{\n    boot\(\);\n    dayBoot\(\);\n  \}/.test(wf), 'import-only builds no router button and no day view');
ok(/if \(IMPORT_ONLY\) return;\n    el\.sheet\.classList\.remove\('hidden'\);/.test(wf.replace(/\n\s*\/\/[^\n]*/g, '')),
  'import-only closes after saving instead of opening the router sheet');
for (const page of ['index.html', '_harness.html']) {
  const h = read(page);
  ok(h.includes('<script src="js/finder.js" type="module"></script>'), `${page} loads js/finder.js as a module`);
  ok(h.includes('<link rel="stylesheet" href="finder.css" />'), `${page} links finder.css`);
}

if (fails.length) {
  console.error(`FAIL  ${fails.length} of ${checks} checks:\n  ` + fails.join('\n  '));
  process.exitCode = 1;
} else {
  console.log(`PASS  finder data, privacy and switches (${checks} checks; data/finder/ ${total} bytes)`);
}
