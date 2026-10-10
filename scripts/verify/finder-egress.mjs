/**
 * finder-egress.mjs — what the finder's live bus line SENDS, checked at run time. No browser, no network.
 *
 * finder-static.mjs reads the source and says no file can send the schedule. This runs the code: it loads
 * js/finder-live.js (with js/transit-route.js) and js/transit-live.js into a vm with a fake page, selects a home for a
 * fixture schedule full of CANARY strings (class titles, building codes, door coordinates, the home's coordinates), calls
 * watch(), and records EVERY way a page can reach the network: fetch, XMLHttpRequest, navigator.sendBeacon, Image,
 * WebSocket, and injected script / link / iframe elements. Then:
 *   - no address or body holds a canary or the class building's or the home's coordinates,
 *   - the only hosts are the page's own origin and data.texas.gov, every request a body-less GET,
 *   - the one injected script is the page's own js/transit-live.js,
 *   - the requests really happen (a poll chain of 5 minutes), so a silent check cannot pass,
 *   - after the returned stop function is called no further request is made, 5 more minutes of fake timers later.
 *
 * The pathfinder pass (2026-10-10) added four more paths, each run here the same way:
 *   - THE RANKING and the trip drawn on the map (js/finder-bus.js): pure arithmetic. It is run with the canary home and door
 *     and must make no request, set no timer, and add no listener at all.
 *   - THE LIVE BUSES switch (liveBuses): no poll while it has no route; with a route it polls only the two public feeds,
 *     draws the vehicles layer ONLY (no stops, no lines), only the routes of the trip (not the whole city); an empty list,
 *     stop() and a hidden finder end the poll and remove the layer; it shares ONE poll with the live line (the last one out stops it).
 *   - THE PATHFINDER ROW (watchRow): shown only when a bus beats the walk; when none does it makes no request to the bus feeds
 *     and shows nothing; stop() ends it.
 *   - js/wayfind.js's side of the row is checked in finder-static.mjs (it is 16,000 lines of browser code; this file runs the part
 *     that talks to the network).
 *
 * Usage: node scripts/verify/finder-egress.mjs [--break | --break=stop | --break=rank | --break=live | --break=row]
 *   --break        makes the page beacon the class building's door to data.texas.gov on every update: it must fail
 *   --break=stop   makes the returned stop function do nothing: it must fail
 *   --break=rank   makes the ranking's bus search beacon the door: it must fail
 *   --break=live   makes the live-buses handle's stop() leave the poll and the layer running: it must fail
 *   --break=row    makes the quiet row poll the feeds even when no bus beats the walk: it must fail
 * VERIFY_ROOT=<dir> runs the same file against another checkout (used to show it fails on a tree without the feature).
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = (p) => new URL(p, import.meta.url);
const ROOTDIR = process.env.VERIFY_ROOT ? process.env.VERIFY_ROOT.replace(/\/?$/, '/') : null;
const read = (p) => fs.readFileSync(ROOTDIR && p.startsWith('../../') ? ROOTDIR + p.slice(6) : here(p), 'utf8');
const fx = (n) => fs.readFileSync(here('./fixtures/transit/' + n));      // fixtures always come from this checkout
const sched = JSON.parse(read('./fixtures/finder-egress/schedule.json'));
const BREAK = process.argv.find((a) => a.startsWith('--break'));
const ORIGIN = 'https://austin3d.example', PAGE_HOSTS = new Set(['austin3d.example', 'data.texas.gov']);

// ---- the code under test, as one script: finder-live.js on top of transit-route.js (their imports/exports removed) ----
let live = read('../../js/finder-live.js').replace(/^\s*import\s+[^;]*from\s+'\.\/transit-route\.js';\s*$/m, '').replace(/^export /gm, '');
const route = read('../../js/transit-route.js').replace(/^export /gm, '');
let bus = read('../../js/finder-bus.js').replace(/^\s*import\s+[^;]*from\s+'\.\/transit-route\.js';\s*$/m, '').replace(/^export /gm, '');
if (BREAK === '--break=rank') bus = bus.replace('const walkAll = ctx.walkAll || null;', "const walkAll = ctx.walkAll || null; navigator.sendBeacon('https://data.texas.gov/log', JSON.stringify(to));");
if (BREAK === '--break') live = live.replace("box.append(opts.el('p', 'fd-live-credit', TL.credit));", "box.append(opts.el('p', 'fd-live-credit', TL.credit)); navigator.sendBeacon('https://data.texas.gov/log', JSON.stringify(to));");
// A break that matches nothing would pass for the wrong reason: every patch below must change the text.
const patch = (src, from, to) => { assert.ok(src.includes(from), 'the --break patch no longer matches the source: ' + from); return src.replace(from, to); };
if (BREAK === '--break=stop') live = patch(live, 'return () => { stopped = true; if (off) off(); off = null; if (held) held(); held = null; clearTimeout(timer); timer = 0; };', 'return () => { stopped = true; /* broken: never stops */ };');
if (BREAK === '--break=live') live = patch(live, 'stop() { stopped = true; routes = []; if (held) {', 'stop() { stopped = true; routes = []; if (false) {');
if (BREAK === '--break=row') live = patch(live, 'if (!first.options.length) {', 'if (false) {');
const transit = read('../../js/transit-live.js');

// ---- the fake page ----
const T0 = 1791606130000;                                   // Fri 2026-10-09 23:22:10 Austin, 14 s after the saved feeds
let clock = T0;
const timers = []; let timerId = 0;
const sent = [];                                            // every attempt to reach the network, whatever the channel
const record = (kind, url, body) => sent.push({ kind, url: String(url), body: body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body) });

const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } };
const blobs = { 'eiei-9rpf': 0, 'rmk2-acnw': 0 };
// The saved bake plus a copy of route 20 as route 670, so the saved vehicle feed (two buses on route 10, one on 670, one with
// no trip) has buses of TWO baked routes and a route filter has something to filter.
const bakeJson = () => { const b = JSON.parse(fx('bake-mini.json')); b.routes['670'] = { ...JSON.parse(JSON.stringify(b.routes['20'])), short: '670', name: 'Copy of 20' }; return b; };
const buf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body });
const ctx = {
  console, Promise, Uint8Array, DataView, URL, Intl, Map, Set, WeakMap, Math, Number, String, Array, Object, JSON, Error, encodeURIComponent, Date: FakeDate,
  setTimeout: (fn, ms) => { timers.push({ id: ++timerId, at: clock + (ms || 0), fn }); return timerId; },
  clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  setInterval: (fn) => { record('setInterval', 'timer'); return 0; }, clearInterval: () => {},
  location: { origin: ORIGIN, href: ORIGIN + '/', protocol: 'https:', host: 'austin3d.example' },
  fetch: (url, init) => {
    record('fetch', url, init && init.body);
    if (init && init.method && init.method !== 'GET') record('fetch-method:' + init.method, url);
    const u = new URL(url, ORIGIN);
    if (u.pathname === '/data/transit-live.json') return ok(bakeJson());
    let m = u.pathname.match(/\/api\/views\/([a-z0-9-]+)\.json$/);
    if (m) { blobs[m[1]]++; return ok({ blobId: m[1] + '-b' + blobs[m[1]], blobFilename: m[1] === 'eiei-9rpf' ? 'v.pb' : 't.pb' }); }
    m = u.pathname.match(/\/api\/views\/([a-z0-9-]+)\/files\//);
    if (m) return ok(buf(fx(m[1] === 'eiei-9rpf' ? 'vehiclepositions.pb' : 'tripupdates.pb')));
    return Promise.resolve({ ok: false, status: 404 });
  },
  XMLHttpRequest: class { open(method, url) { this.u = url; this.m = method; } send(body) { record('xhr', this.u, body); } setRequestHeader() {} },
  Image: class { set src(v) { record('image', v); } },
  WebSocket: class { constructor(url) { record('websocket', url); } },
  navigator: { sendBeacon: (url, data) => { record('beacon', url, data); return true; } },
};
ctx.window = ctx; ctx.globalThis = ctx;
const listeners = [];
const track = (el) => { if (el && (el.src || el.href || el.action)) record('element:' + el.tagName, el.src || el.href || el.action); };
ctx.document = {
  visibilityState: 'visible', scripts: [{ getAttribute: (a) => (a === 'src' ? 'js/finder.js?v=1' : null) }],
  addEventListener: (t, f) => listeners.push(f), removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
  createElement: (tag) => ({ tagName: tag }),
  body: { append: (el) => { track(el); if (el.tagName === 'script') { vm.runInContext(transit, ctx); el.onload && el.onload(); } }, appendChild(el) { this.append(el); } },
  head: { append: track, appendChild: track },
};
vm.createContext(ctx);
vm.runInContext(live + '\n' + route + '\n' + bus + '\n;Object.assign(globalThis, { __watch: watch, __watchRow: watchRow, __liveBuses: liveBuses, __pollUsers: pollUsers, __busLeg: busLeg, __busLegs: busLegs, __trip: tripFeatures });', ctx);

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {                                // run the fake timers due in the next `ms`, in order
  const end = clock + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    if (!timers.length || timers[0].at > end) break;
    const t = timers.shift(); clock = Math.max(clock, t.at); t.fn(); await flush();
  }
  clock = end; await flush();
}

// ---- the flow finder.js runs: heaviest class building of the schedule, its door, the selected home ----
const heaviest = [...sched.classes].sort((a, b) => b.meetings - a.meetings)[0];
const to = sched.buildings[heaviest.code].door, from = sched.home;
const box = { textContent: '', isConnected: true, append() {} };
let lines = 0;
const el = (tag, cls, text) => { if (/fd-live-line/.test(cls || '')) lines++; return { tag, cls, text }; };
const stop = ctx.__watch(box, from, to, { code: heaviest.code, el });
await flush(); await advance(5 * 60000);

let pass = 0; const check = (c, m) => { assert.ok(c, m); pass++; };
const canaries = [];
for (const c of sched.classes) canaries.push(c.title, c.code, c.title.split(' ')[0], c.title.toLowerCase());
for (const b of Object.values(sched.buildings)) for (const v of b.door) canaries.push(String(v), v.toFixed(4));
for (const v of from) canaries.push(String(v), v.toFixed(4));
canaries.push('ZZCANARY', 'ZQX', 'QQV');
const seen = (r) => decodeURIComponent(r.url) + '\n' + r.url + '\n' + r.body;

check(lines >= 10, `the live line was written and refreshed (${lines} times)`);
check(sent.length >= 20, `the page really talks to the network during 5 minutes (${sent.length} requests); a silent run proves nothing`);
check(sent.some((r) => /transit-live\.json/.test(r.url)) && sent.some((r) => /eiei-9rpf/.test(r.url)) && sent.some((r) => /rmk2-acnw/.test(r.url)), 'it fetched the baked slice, the vehicle feed and the trip feed');
for (const r of sent) {
  for (const c of canaries) assert.ok(!seen(r).includes(c), `${r.kind} ${r.url} carries a canary: ${c}`);
}
pass++;
const hosts = new Set(sent.filter((r) => /^(fetch|xhr|beacon|image|websocket|element:)/.test(r.kind)).map((r) => new URL(r.url, ORIGIN).host));
check([...hosts].every((h) => PAGE_HOSTS.has(h)), `the only hosts are the page's own origin and data.texas.gov (saw ${[...hosts].join(', ')})`);
check(sent.every((r) => r.kind === 'fetch' || r.kind.startsWith('element:script')), 'the only channels used are fetch and the one injected script (' + [...new Set(sent.map((r) => r.kind))].join(', ') + ')');
check(sent.every((r) => !r.body), 'no request carries a body');
check(sent.every((r) => !r.kind.startsWith('fetch-method')), 'every fetch is a plain GET');
const scripts = sent.filter((r) => r.kind === 'element:script');
check(scripts.length === 1 && scripts[0].url === 'js/transit-live.js?v=1', 'the one injected script is the page\'s own js/transit-live.js: ' + scripts.map((s) => s.url));
check(sent.filter((r) => r.kind === 'fetch' && /data\.texas\.gov/.test(r.url)).every((r) => /^https:\/\/data\.texas\.gov\/api\/views\/(eiei-9rpf|rmk2-acnw)(\.json$|\/files\/[a-z0-9-]+\?filename=[a-z.]+$)/.test(r.url)),
  'every data.texas.gov address is one of the two public feeds, with a name taken from the feed\'s own answer');

// ---- stop ----
stop();
const n = sent.length, pending = timers.length;
await advance(5 * 60000);
check(sent.length === n, `after stop() no request is made in 5 more minutes (${sent.length - n} new; ${pending} timers were pending at stop)`);
check(timers.length === 0, 'after stop() no timer is left (' + timers.length + ')');
check(listeners.length === 0, 'after stop() the visibilitychange listener is gone');


// ═══════════════════════════════════════════════════════════════════════════
// THE PATHFINDER PASS: the ranking, the map, the live-buses switch, the pathfinder row
// ═══════════════════════════════════════════════════════════════════════════
const WED_0830 = Date.parse('2026-10-14T13:30:00Z');         // Wednesday 08:30 in Austin: the buses run
const phase1 = sent.length;
const slice = bakeJson();
const quiet = async (ms) => { const n0 = sent.length; await advance(ms); return sent.length - n0; };
const map = () => {                                           // the parts of a MapLibre map that TransitLive.attach touches
  const m = { layers: new Map(), sources: new Map(), calls: [] };
  m.isStyleLoaded = () => true;
  m.getLayer = (id) => m.layers.get(id); m.getSource = (id) => m.sources.get(id);
  m.addSource = (id, spec) => { m.calls.push('addSource ' + id); m.sources.set(id, { spec, data: null, setData(d) { this.data = d; } }); };
  m.addLayer = (l) => { m.calls.push('addLayer ' + l.id); m.layers.set(l.id, l); };
  m.removeLayer = (id) => { m.calls.push('removeLayer ' + id); m.layers.delete(id); };
  m.removeSource = (id) => { m.calls.push('removeSource ' + id); m.sources.delete(id); };
  return m;
};
const vehiclesOn = (m) => { const src = m.sources.get('transit-live-vehicles'); return src && src.data ? src.data.features : []; };

// ---- 1. the ranking and the trip on the map: arithmetic only ----
{
  const t0 = timers.length, l0 = listeners.length, n0 = sent.length;
  const leg = ctx.__busLeg(slice, from, to, { walkAll: [3000, 4200] });
  check(leg && leg.src === 'timetable' && leg.hi > leg.lo, 'the ranking finds the fixture bus for the canary home and door (' + (leg && (leg.lo.toFixed(1) + '-' + leg.hi.toFixed(1))) + ' min), so a silent run proves nothing');
  const all = ctx.__busLegs(slice, [{ id: 'h', from }], [{ code: 'ZQX', to }, { code: 'QQV', to: sched.buildings.QQV.door }], { skip: () => false, walkAll: () => [3000, 4200], endWalk: () => null }, new Map(), () => 0);
  check(all.searches === 2, 'busLegs searched both canary doors');
  const trip = ctx.__trip(slice, leg.option, from, to, { endPath: () => null });
  check(trip.feats.length >= 4 && trip.stops.length === 2, 'the trip became map features (' + trip.feats.length + ' features, ' + trip.stops.length + ' stops)');
  check(sent.length === n0 && timers.length === t0 && listeners.length === l0, 'the ranking and the map drawing made no request, set no timer and added no listener');
}
// ---- 2. "Show live buses": the routes of the trip only, one poll, gone when it ends ----
{
  clock = T0 + 5000; timers.length = 0;
  const m = map(), h = ctx.__liveBuses(m);
  check(await quiet(120000) === 0 && !ctx.__pollUsers(), 'before any route: no request in 2 minutes, nothing polling');
  h.set([]); await flush();
  check(await quiet(60000) === 0 && m.layers.size === 0, 'an empty route list: still no request, no layer');
  clock = T0 + 5000; timers.length = 0;          // the saved feed is 11 s old at T0: keep the clock near it so the buses are fresh
  h.set(['10']); await flush();
  check(ctx.__pollUsers() === 1 && h.active(), 'with a route it polls (one user)');
  const n1 = sent.length;
  await advance(45000);
  const polled = sent.slice(n1);
  check(polled.length >= 4 && polled.every((r) => r.kind === 'fetch' && /^https:\/\/data\.texas\.gov\/api\/views\/eiei-9rpf(\.json$|\/files\/)/.test(r.url)),
    `it polls ONLY the vehicle feed, nothing else (${polled.length} requests in 45 s; the 260 KB trip feed is not wanted)`);
  const ids = [...m.layers.keys()].sort();
  check(ids.join() === 'transit-live-vehicle-halo,transit-live-vehicles', 'only the buses are drawn: layers ' + ids.join(', '));
  check(![...m.sources.keys()].some((k) => /stops|lines/.test(k)), 'no stops source and no lines source');
  const mine = vehiclesOn(m), everyone = JSON.parse(JSON.stringify(ctx.TransitLive.vehiclesGeo(null))).features;
  check(mine.length === 2 && mine.every((f) => f.properties.route === '10'), `only route 10's buses (${mine.length} of ${everyone.length} in the city)`);
  check(everyone.length === 3 && new Set(everyone.map((f) => f.properties.route)).size === 2, 'the fixture has another route\'s bus too (' + everyone.map((f) => f.properties.route) + '), so the filter is really filtering');
  h.set(['670']); await flush();
  const swapped = vehiclesOn(m);
  check(swapped.length === 1 && swapped[0].properties.route === '670', `changing the trip changes the routes without a second poll chain (${swapped.length} bus, on route 670)`);
  check(ctx.__pollUsers() === 1, 'still one user');
  h.set([]); await flush();
  const n2 = sent.length, pend = timers.length;
  await advance(5 * 60000);
  check(sent.length === n2 && m.layers.size === 0 && m.sources.size === 0 && ctx.__pollUsers() === 0, `an empty list ends the poll and removes the layer: no request in 5 minutes (${pend} timers were pending)`);
  h.set(['10']); await flush(); await advance(40000);
  const n3 = sent.length; check(n3 > n2 && m.layers.size > 0, 'switched on again: it polls again');
  h.stop(); await flush();
  await advance(5 * 60000);
  check(sent.length === n3 && m.layers.size === 0 && ctx.__pollUsers() === 0 && timers.length === 0 && listeners.length === 0, 'stop() (the finder hidden): no request in 5 minutes, no layer, no timer, no listener');
  h.set(['10']); await flush();
  check(sent.length === n3 && !h.active(), 'after stop(), set() does nothing');
}
// ---- 3. one poll shared by the live line and the live buses ----
{
  clock = T0 + 5000; timers.length = 0;
  const m = map(), h = ctx.__liveBuses(m);
  const box = { textContent: '', isConnected: true, hidden: false, append() {} };
  const stopLine = ctx.__watch(box, from, to, { code: 'ZQX', el: (tag, cls, text) => ({ tag, cls, text }) });
  await flush(); h.set(['10']); await flush();
  check(ctx.__pollUsers() === 2, 'the line and the buses are two users of one poll');
  stopLine(); await flush();
  const n1 = sent.length; await advance(60000);
  const after = sent.slice(n1);
  check(ctx.__pollUsers() === 1 && after.length >= 3 && after.every((r) => !/rmk2-acnw/.test(r.url)), 'the line ends: the buses keep polling, and the 260 KB trip feed stops (' + after.length + ' requests, none for trips)');
  h.stop(); await flush();
  const n2 = sent.length; await advance(5 * 60000);
  check(sent.length === n2 && ctx.__pollUsers() === 0 && timers.length === 0, 'the last one out stops the poll');
}
// ---- 4. the pathfinder row: only when a bus beats a long walk ----
{
  clock = WED_0830; timers.length = 0;
  const mk = () => ({ textContent: '', isConnected: true, hidden: true, lines: [], append(e) { this.lines.push(e.text); } });
  const el2 = (tag, cls, text) => ({ tag, cls, text });
  // a long walk (50-70 minutes): the fixture bus wins; the row shows
  const box = mk(); box.append = function (e) { this.lines.push(e.text); };
  const stopRow = ctx.__watchRow(box, from, to, { code: 'ZQX', el: el2, walkS: [3000, 4200], beatsWalkS: 300 });
  await flush(); await advance(1000);
  check(box.hidden === false && box.lines.length >= 2 && /^Bus to ZQX now: /.test(box.lines[0]) && /\((timetable|live)\)/.test(box.lines[0]) && /door to door/.test(box.lines[0]), 'a long walk with a faster bus: one row ("' + box.lines[0] + '")');
  check(!/\d{1,2}:\d{2}|you will|guarantee/i.test(box.lines[0]), 'the row gives no clock time and no promise');
  check(ctx.__pollUsers() === 1, 'while the row shows, it polls (one user)');
  stopRow(); await flush();
  const n1 = sent.length; await advance(5 * 60000);
  check(sent.length === n1 && ctx.__pollUsers() === 0 && timers.length === 0, 'stop() (the route cleared): no request in 5 minutes, no timer');
  // a short walk (1-1.5 minutes): no bus beats it. The row is hidden and the bus feeds are never asked
  const quietBox = mk();
  const n2 = sent.length;
  const stopQ = ctx.__watchRow(quietBox, from, to, { code: 'ZQX', el: el2, walkS: [60, 90], beatsWalkS: 300 });
  await flush(); await advance(4 * 60000);
  check(quietBox.hidden === true && quietBox.textContent === '' && quietBox.lines.length === 0, 'no bus beats the walk: the row is hidden and empty');
  check(sent.slice(n2).every((r) => !/data\.texas\.gov/.test(r.url)) && ctx.__pollUsers() === 0, 'and it never asked the bus feeds anything (' + (sent.length - n2) + ' requests, none to data.texas.gov)');
  check(timers.length === 1, 'it looks at the timetable again later: one timer pending (' + timers.length + ')');
  stopQ(); await flush(); await advance(10 * 60000);
  check(timers.length === 0 && sent.length === n2 + sent.slice(n2).length, 'stop() clears that timer');
}

// ---- everything above, together: the same rules as the first 5 minutes ----
const rest = sent.slice(phase1);
check(rest.length >= 20, `the new paths really talk to the network (${rest.length} requests), so a silent check cannot pass`);
for (const r of rest) for (const c of canaries) assert.ok(!seen(r).includes(c), `${r.kind} ${r.url} carries a canary: ${c}`);
pass++;
check(rest.every((r) => r.kind === 'fetch' || r.kind.startsWith('element:script')) && rest.every((r) => !r.body), 'the new paths use only plain GETs (no body, no beacon, no image, no socket)');
check(rest.filter((r) => /data\.texas\.gov/.test(r.url)).every((r) => /^https:\/\/data\.texas\.gov\/api\/views\/(eiei-9rpf|rmk2-acnw)(\.json$|\/files\/[a-z0-9-]+\?filename=[a-z.]+$)/.test(r.url)), 'every address is still one of the two public feeds');
check(new Set(rest.map((r) => new URL(r.url, ORIGIN).host)).size <= 2 && [...new Set(rest.map((r) => new URL(r.url, ORIGIN).host))].every((h) => PAGE_HOSTS.has(h)), 'hosts: the page\'s own origin and data.texas.gov only');

console.log(`PASS  finder-egress: ${sent.length} requests recorded (a 5-minute poll chain, the ranking, the map trip, the live-buses switch, the pathfinder row); none carries the schedule, the home or the door (${pass} checks)`);
