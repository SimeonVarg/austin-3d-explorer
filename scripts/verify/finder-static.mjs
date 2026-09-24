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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
  ['dynamic import', /\bimport\s*\(/g], ['navigator', /navigator\./g], ['serviceWorker', /serviceWorker/g],
];
for (const [name, re] of BANNED) {
  ok(count(finder, re) === 0, `js/finder.js uses ${name}`);
  ok(count(fcore, re) === 0, `js/finder-core.js uses ${name}`);
}
ok(count(fcore, /\bfetch\s*\(/g) === 0, 'js/finder-core.js never fetches');
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
ok(/const p = \{ major: S\.majorId \|\| null, mode: S\.mode, heat: S\.heat, closed: !!prefs\.closed \};/.test(finder),
  'prefs hold major, mode, heat and closed only');
// The one injected script is the page's own wayfind.js.
ok(count(finder, /createElement\('script'\)/g) === 1, 'one script element created');
ok(/js\\\/wayfind\\\.js/.test(finder) && /s\.src = own;/.test(finder), 'it is the page\'s own js/wayfind.js');

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
