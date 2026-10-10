// js/transit-live.js with no browser and no network: a fake fetch serves saved feeds
// (scripts/verify/fixtures/transit/, trimmed copies of the real CapMetro files) and a fake
// clock. Checks: nothing happens before start(); the two-step fetch (meta file first, then
// the file it names, a fresh name each time); the protobuf decoder; departures() live versus
// scheduled and their labels; yesterday's trips after midnight; Saturday service; the back-off
// after an error; the visibility pause; stop(); and the map layers. --break damages the module.
//   node scripts/verify/transit-live.mjs [--break]
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = p => new URL(p, import.meta.url);
const fx = n => fs.readFileSync(here('./fixtures/transit/' + n));
let source = fs.readFileSync(here('../../js/transit-live.js'), 'utf8');
if (process.argv.includes('--break')) source = source.replace("'?filename=' + encodeURIComponent(m.blobFilename)", "'?filename=x'").replace('m.blobId', "'stale'");

const MINI = JSON.parse(fx('bake-mini.json'));
const T0 = 1791606130000;            // Fri 2026-10-09 23:22:10 Austin time, 14 s after the saved feeds
const SAT_0010 = 1791609000000, SAT_0550 = 1791629400000;
const VEH = 'eiei-9rpf', TRP = 'rmk2-acnw';

function boot({ now = T0, trips = true, vehicles = true, hidden = false, bake = null, trpBytes = null, vehBytes = null } = {}) {
  const log = [], timers = [], listeners = [], seen = { vehBlobs: 0 };
  const doc = { visibilityState: hidden ? 'hidden' : 'visible', addEventListener: (t, f) => listeners.push(f), removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } };
  const ctx = { console, Promise, Uint8Array, DataView, document: doc, URL, encodeURIComponent };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  ctx.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
  const res = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body, arrayBuffer: async () => body });
  const buf = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const st = { vehOk: vehicles, trpOk: trips, blob: { [VEH]: 0, [TRP]: 0 } };
  ctx.fetch = (url) => {
    log.push(url);
    if (url === 'data/transit-live.json') return res(bake || MINI);
    let m = url.match(/\/api\/views\/([a-z0-9-]+)\.json$/);
    if (m) {
      const id = m[1], ok = id === VEH ? st.vehOk : st.trpOk;
      if (!ok) return res({}, false, 503);
      st.blob[id]++;                                              // a new blobId at every read
      return res({ blobId: id + '-blob-' + st.blob[id], blobFilename: id === VEH ? 'vehiclepositions.pb' : 'tripupdates.pb' });
    }
    m = url.match(/\/api\/views\/([a-z0-9-]+)\/files\/([^?]+)\?filename=(.+)$/);
    if (m) {
      if (m[2] !== m[1] + '-blob-' + st.blob[m[1]]) return res({}, false, 404);   // only the CURRENT blob exists
      const custom = m[1] === VEH ? vehBytes : trpBytes;
      return res(buf(custom || fx(m[1] === VEH ? 'vehiclepositions.pb' : 'tripupdates.pb')));
    }
    return res({}, false, 404);
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, T: ctx.TransitLive, log, timers, listeners, st, doc, opts: n => ({ now: () => (typeof now === 'function' ? now() : now), ...n }) };
}
// arrays made inside the vm have another Array prototype: compare as JSON
const deq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
let pass = 0;
const ok = (name, fn) => Promise.resolve(fn()).then(() => { pass++; console.log('PASS: ' + name); });

// 1. nothing before start()
await ok('nothing is fetched, timed or drawn before start()', async () => {
  const b = boot();
  deq(b.T.state().vehicles, []);
  deq(b.T.departures('1042', 3), []);
  b.T.on(() => {}); await flush();
  assert.equal(b.log.length, 0, 'fetched at load: ' + b.log);
  assert.equal(b.timers.length, 0);
  assert.equal(b.listeners.length, 0);
  assert.ok(/CapMetro/.test(b.T.credit) && /Not affiliated/.test(b.T.credit));
});

// 2. the decoder on the saved files
await ok('decoder reads vehicles and trip updates', async () => {
  const b = boot();
  const v = b.T.decode(fx('vehiclepositions.pb'));
  assert.equal(v.timestamp, 1791606119);
  assert.equal(v.vehicles.length, 4);
  const a = v.vehicles.find(x => x.id === '2559');
  assert.equal(a.route, '10'); assert.equal(a.direction, 1); assert.equal(a.tripId, '3015068_0636'); assert.equal(a.stopId, '6315');
  assert.equal(a.status, 'IN_TRANSIT_TO');
  assert.ok(Math.abs(a.lat - 30.268751) < 1e-5 && Math.abs(a.lon + 97.741898) < 1e-5);
  assert.ok(Math.abs(a.bearing - 111.7) < 1e-3);
  assert.equal(v.vehicles.find(x => x.id === '2551').route, null, 'a bus with no trip has no route');
  const t = b.T.decode(fx('tripupdates.pb'));
  assert.equal(t.trips.length, 3);
  const u = t.trips.find(x => x.tripId === '2997875_0078');
  assert.equal(u.route, '1'); assert.equal(u.direction, 1);
  assert.equal(u.stops.find(s => s.stopId === '1042').time, 1791606755);
  assert.ok(t.trips.some(x => x.stops.some(s => s.skipped)), 'skipped stops are marked');
});

// 3. the two-step fetch and the vehicle list
await ok('two-step fetch: meta first, then the file it names; vehicles limited to the baked routes', async () => {
  const b = boot();
  b.T.start(b.opts({ intervalMs: 20000 }));
  await flush();
  const i = b.log.indexOf('https://data.texas.gov/api/views/' + VEH + '.json');
  assert.ok(i >= 0, 'meta not read: ' + b.log);
  assert.equal(b.log[i + 1], 'https://data.texas.gov/api/views/' + VEH + '/files/' + VEH + '-blob-1?filename=vehiclepositions.pb');
  assert.ok(!b.log.some(u => /\/download\//.test(u)), 'the redirecting /download/ address must never be used');
  assert.ok(!b.log.some(u => u.includes(TRP)), 'trip updates are not fetched unless asked for');
  const s = b.T.state();
  assert.equal(s.ok, true); assert.equal(s.error, null); assert.equal(s.ageSec, 11);
  deq(s.vehicles.map(v => v.id).sort(), ['2204', '2559'], 'route 670 is not baked, the bus with no trip has no route');
  assert.equal(s.vehicles[0].tripId.length > 0, true);
  // second poll: a NEW blobId must be asked for again, never reuse the old one
  b.timers[b.timers.length - 1].fn(); await flush();
  const files = b.log.filter(u => u.includes('/files/'));
  assert.equal(files.length, 2);
  assert.ok(files[1].includes('-blob-2?'), files[1]);
  b.T.stop();
});

// 4. departures: live and scheduled
await ok('departures(): live from trip updates, scheduled beyond them, each labelled', async () => {
  const b = boot();
  b.T.start(b.opts({ trips: true })); await flush();
  const d = b.T.departures('1042', 4);
  deq(d.map(x => [x.route, x.live, x.minutes]), [['1', true, 10], ['20', true, 13], ['3', true, 15], ['99', false, 32]]);
  assert.equal(d[0].tripId, '2997875_0078'); assert.equal(d[0].scheduled, '23:25'); assert.equal(d[0].headsign, 'Tech Ridge');
  assert.equal(d[2].scheduled, null, 'a live bus with no baked time has no scheduled label');
  assert.equal(d[3].scheduled, '23:54'); assert.equal('tripId' in d[3], false);
  const r1 = b.T.departures('1042', 5, { route: '1' });
  deq(r1.map(x => [x.live, x.scheduled]), [[true, '23:25'], [false, '00:00'], [false, '00:30'], [false, '01:00']]);
  deq(b.T.departures('1042', 5, { route: '20', dir: 1 }), []);
  deq(b.T.departures('nope', 3), []);
  b.T.stop();
});

await ok('departures(): trip updates down or stale -> every item scheduled', async () => {
  const b = boot({ trips: false });
  b.T.start(b.opts({ trips: true })); await flush();
  const d = b.T.departures('1042', 3);
  deq(d.map(x => [x.route, x.live, x.minutes, x.scheduled]), [['1', false, 3, '23:25'], ['99', false, 32, '23:54'], ['1', false, 38, '00:00']]);
  const c = boot();
  c.T.start(c.opts({ trips: true })); await flush();
  let late = T0 + 600000;
  c.T.config({}); c.T.start(c.opts({ trips: true, now: () => late }));
  assert.ok(c.T.departures('1042', 3).every(x => !x.live), 'trip updates 10 minutes old are not trusted');
  c.T.stop(); b.T.stop();
});

await ok('departures(): after midnight uses yesterday\'s trips; Saturday has its own timetable', async () => {
  const b = boot({ trips: false });
  b.T.start(b.opts({ now: () => SAT_0010 })); await flush();
  deq(b.T.departures('1042', 3).map(x => [x.route, x.minutes, x.scheduled]), [['1', 20, '00:30'], ['99', 24, '00:34'], ['1', 50, '01:00']]);
  b.T.start(b.opts({ now: () => SAT_0550 }));
  const s = b.T.departures('1042', 2);
  deq([s[0].route, s[0].minutes, s[0].scheduled, s[0].live], ['1', 10, '06:00', false]);
  b.T.stop();
});

// 5. back-off, visibility, stop
await ok('back-off after errors, reset after a success', async () => {
  const b = boot({ vehicles: false });
  b.T.start(b.opts({ intervalMs: 20000 })); await flush();
  assert.equal(b.T.state().ok, false); assert.match(b.T.state().error, /HTTP 503/);
  const wait = () => b.timers.filter(t => t.fn).slice(-1)[0];
  assert.equal(wait().ms, 40000);
  const t1 = wait(); t1.fn(); await flush();
  assert.equal(wait().ms, 80000);
  b.st.vehOk = true;
  wait().fn(); await flush();
  assert.equal(b.T.state().ok, true);
  assert.equal(wait().ms, 20000);
  b.T.stop();
});

await ok('pauses while the tab is hidden, resumes on visibilitychange; stop() ends everything', async () => {
  const b = boot({ hidden: true });
  b.T.start(b.opts({})); await flush();
  assert.ok(!b.log.some(u => u.includes(VEH)), 'fetched while hidden');
  assert.equal(b.listeners.length, 1);
  b.doc.visibilityState = 'visible'; b.listeners[0](); await flush();
  assert.ok(b.log.some(u => u.includes(VEH)));
  const pending = b.timers.filter(t => t.fn).slice(-1)[0];
  const n = b.log.length;
  b.T.stop();
  assert.equal(b.listeners.length, 0);
  if (pending.fn) pending.fn(); await flush();
  assert.equal(b.log.length, n, 'fetched after stop()');
});

// 6. the map layers (a fake map)
await ok('attach() draws vehicles and stops as plain layers; detach() removes them; no images', async () => {
  const b = boot();
  const sources = {}, layers = {};
  const calls = { addImage: 0, setData: 0 };
  const map = { isStyleLoaded: () => true, getLayer: i => layers[i], getSource: i => sources[i],
    addSource: (i, s) => { sources[i] = { spec: s, data: s.data, setData(d) { this.data = d; calls.setData++; } }; },
    addLayer: l => { layers[l.id] = l; }, removeLayer: i => delete layers[i], removeSource: i => delete sources[i], addImage: () => { calls.addImage++; } };
  b.T.attach(map); b.T.start(b.opts({})); await flush();
  deq(Object.keys(layers).sort(), ['transit-live-lines', 'transit-live-stops', 'transit-live-vehicle-halo', 'transit-live-vehicles']);
  assert.equal(sources['transit-live-stops'].data.features.length, 3);
  assert.equal(sources['transit-live-vehicles'].data.features.length, 2);
  assert.equal(layers['transit-live-lines'].layout.visibility, 'none');
  assert.equal(calls.addImage, 0);
  b.T.detach();
  deq(Object.keys(layers).concat(Object.keys(sources)), []);
  b.T.stop();
});

// ---- fixes from the review of 2026-10-10 (docs/transit-live.md, "Review fixes") ----
const live = b => b.timers.filter(t => t.fn);
const cloneBake = () => JSON.parse(JSON.stringify(MINI, (k, v) => k === '_dec' ? undefined : v));   // the module caches its decoded timetable on the bake object
/* Hold the first step of every feed read (the meta file) so a test decides when, and how, it ends. */
function hold(b) {
  const orig = b.ctx.fetch, pend = [];
  b.ctx.fetch = (url, o) => {
    if (!/\/api\/views\/[a-z0-9-]+\.json$/.test(url)) return orig(url, o);
    return new Promise((resolve, reject) => pend.push({ url, settled: false,
      release() { this.settled = true; resolve(orig(url, o)); }, fail() { this.settled = true; reject(new Error('network down')); } }));
  };
  return { pend, outstanding: () => pend.filter(p => !p.settled).length };
}

// 1. a stale poll touches nothing
for (const how of ['resolve', 'reject']) {
  await ok(`stop(); start() with an old poll in flight: its ${how} starts nothing and leaves no timer`, async () => {
    const b = boot(), h = hold(b);
    b.T.start(b.opts({})); await flush();
    assert.equal(h.outstanding(), 1, 'one poll in flight');
    b.T.stop();
    assert.equal(live(b).length, 0, 'stop() with a request in flight leaves no timer (the request timeout is cancelled too)');
    b.T.start(b.opts({})); await flush();
    assert.equal(h.outstanding(), 2, 'the old request is still unanswered, the new one has started');
    h.pend[0][how === 'resolve' ? 'release' : 'fail'](); await flush();
    b.listeners[0]();                                        // anything that kicks the poll (visibilitychange)
    b.T.wantTrips(true); await flush();
    assert.equal(h.pend.filter(p => !p.settled && /eiei-9rpf/.test(p.url)).length, 1, 'exactly one vehicle request is outstanding after the old one ended');
    h.pend[1].release(); await flush();
    assert.equal(b.T.state().ok, true);
    b.T.stop();
    assert.equal(live(b).length, 0, 'after stop() no timer is left');
  });
}

// 2. the timeout covers the body
await ok('a body that never arrives ends in a timeout error and a later poll', async () => {
  const b = boot();
  const orig = b.ctx.fetch;
  b.ctx.fetch = (url, o) => /\/files\//.test(url) ? Promise.resolve({ ok: true, status: 200, arrayBuffer: () => new Promise(() => {}) }) : orig(url, o);
  b.T.start(b.opts({})); await flush();
  const tm = live(b).filter(t => t.ms === 15000);
  assert.equal(tm.length, 1, 'a request timeout is still armed while the body is awaited');
  tm[0].fn(); await flush();
  assert.match(b.T.state().error, /timeout/); assert.equal(b.T.state().ok, false);
  const next = live(b).filter(t => t.ms === 40000);
  assert.equal(next.length, 1, 'the poll chain goes on, after the back-off');
  const n = b.log.filter(u => /eiei-9rpf\.json$/.test(u)).length;
  next[0].fn(); await flush();
  assert.equal(b.log.filter(u => /eiei-9rpf\.json$/.test(u)).length, n + 1, 'a later poll runs');
  b.T.stop();
});

// 3. protobuf lengths are checked against the buffer
await ok('a length past the end of the buffer is an error for that poll, fast, never a hang or a throw', async () => {
  const bad = [
    new Uint8Array([0x12, 0x0a, 0x22, 0x08, 0x0a, 0x06, 0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f]),         // entity > vehicle > trip > trip_id: 4 GB
    new Uint8Array([0x12, 0xff, 0xff, 0xff, 0xff, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0]),                  // 15 bytes claiming a 4 GB entity
    new Uint8Array([0x12, 0x80]),                                                                       // a varint that never ends
    new Uint8Array([0x0d, 0x00, 0x00]),                                                                 // a float with 2 of its 4 bytes
    new Uint8Array([0x12, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 0x00]),                                   // a length of 2^35
  ];
  const b = boot();
  b.ctx.bad = bad;
  for (let i = 0; i < bad.length; i++) {
    const t0 = Date.now();
    const r = vm.runInContext(`TransitLive.decode(bad[${i}])`, b.ctx, { timeout: 3000 });     // a hang is cut off at 3 s and fails
    assert.ok(Date.now() - t0 < 1000, 'case ' + i + ' took ' + (Date.now() - t0) + ' ms');
    assert.match(String(r.error), /bad (protobuf|varint|wire)/, 'case ' + i + ': ' + r.error);
    assert.equal(r.vehicles.length + r.trips.length, 0);
  }
  // as a poll: the vehicle file is the bad one
  const c = boot({ vehBytes: bad[0] });
  c.T.start(c.opts({})); await flush();
  assert.equal(c.T.state().ok, false); assert.match(c.T.state().error, /bad protobuf/);
  assert.equal(live(c).filter(t => t.ms === 40000).length, 1, 'the poll chain goes on after a bad file');
  c.T.stop();
});

// 4. a cancelled trip takes its baked time away
await ok('a cancelled trip is not offered and its baked time is hidden (nearest one, same route and direction)', async () => {
  const vi = n => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
  const fld = (f, w, v) => w === 0 ? [...vi(f * 8), ...vi(v)] : [...vi(f * 8 + 2), ...vi(v.length), ...v];
  const sb = x => [...Buffer.from(x)];
  const cancelled = (id, route, dir, stop, t) => fld(2, 2, [...fld(1, 2, sb(id)), ...fld(3, 2, [
    ...fld(1, 2, [...fld(1, 2, sb(id)), ...fld(4, 0, 3), ...fld(5, 2, sb(route)), ...fld(6, 0, dir)]),
    ...fld(2, 2, [...fld(2, 2, fld(2, 0, t)), ...fld(4, 2, sb(stop))])])]);
  const MIDNIGHT = 1791608400;                                   // Sat 00:00 Austin: the baked 00:00 trip of route 1
  const feed = new Uint8Array([...fld(1, 2, fld(3, 0, Math.floor(T0 / 1000) - 5)),
    ...cancelled('c1', '1', 1, '1042', MIDNIGHT + 30),           // the 00:00 trip of route 1, running 30 s late, then cancelled
    ...cancelled('c2', '20', 0, '1042', MIDNIGHT + 30),          // a different route: must not touch route 1
    ...cancelled('c3', '1', 1, '1042', MIDNIGHT + 3 * 3600)]);   // 3 hours from any baked time: hides nothing
  const plain = boot({ trips: false });
  plain.T.start(plain.opts({ trips: true })); await flush();
  deq(plain.T.departures('1042', 5, { route: '1' }).map(x => x.scheduled), ['23:25', '00:00', '00:30', '01:00'], 'baseline');
  const b = boot({ trpBytes: feed });
  b.T.start(b.opts({ trips: true })); await flush();
  assert.equal(b.T.state().error, null);
  deq(b.T.departures('1042', 5, { route: '1' }).map(x => [x.live, x.scheduled]), [[false, '23:25'], [false, '00:30'], [false, '01:00']], 'the cancelled 00:00 is gone');
  assert.ok(b.T.departures('1042', 9).every(x => x.live === false), 'a cancelled trip is never offered as a live bus');
  assert.equal(plain.T.departures('1042', 9, { route: '20' }).length, 1, 'baseline: route 20 has its 00:00 trip');
  assert.equal(b.T.departures('1042', 9, { route: '20' }).length, 0, 'route 20 lost its own cancelled 00:00 trip');
  assert.equal(b.T.departures('1042', 9, { route: '99' }).length, plain.T.departures('1042', 9, { route: '99' }).length, 'route 99 is untouched');
  b.T.stop(); plain.T.stop();
});

// 5. an old or failed vehicle feed draws no bus
function fakeMap() {
  const sources = {}, layers = {};
  return { sources, layers, isStyleLoaded: () => true, getLayer: i => layers[i], getSource: i => sources[i],
    addSource: (i, s) => { sources[i] = { spec: s, data: s.data, setData(d) { this.data = d; } }; },
    addLayer: l => { layers[l.id] = l; }, removeLayer: i => delete layers[i], removeSource: i => delete sources[i] };
}
for (const mode of ['hide', 'dim']) {
  await ok(`draw(): feed failed or stale -> staleVehicles '${mode}'`, async () => {
    let clock = T0;
    const b = boot(), map = fakeMap();
    b.T.attach(map); b.T.start(b.opts({ staleVehicles: mode, now: () => clock })); await flush();
    const feats = () => map.sources['transit-live-vehicles'].data.features;
    assert.equal(feats().length, 2); assert.ok(feats().every(f => f.properties.old === false), 'fresh buses are drawn as current');
    const poll = () => { live(b).filter(t => t.ms === 20000 || t.ms === 40000 || t.ms === 80000).slice(-1)[0].fn(); return flush(); };
    // the feed starts failing
    b.st.vehOk = false; await poll();
    assert.equal(b.T.state().ok, false);
    if (mode === 'hide') assert.equal(feats().length, 0, 'failed feed: no bus drawn');
    else { assert.equal(feats().length, 2); assert.ok(feats().every(f => f.properties.old === true), 'failed feed: old buses flagged'); }
    // it recovers, then the file stops changing while the clock runs on (stale by age)
    b.st.vehOk = true; await poll();
    assert.equal(feats().length, 2); assert.ok(feats().every(f => f.properties.old === false));
    clock = T0 + 200000; await poll();
    assert.ok(b.T.state().ageSec > 90 && b.T.state().ok === false);
    if (mode === 'hide') assert.equal(feats().length, 0, 'stale feed: no bus drawn');
    else assert.ok(feats().length === 2 && feats().every(f => f.properties.old === true));
    assert.ok(map.layers['transit-live-vehicles'].paint['circle-opacity'][0] === 'case', 'the layer fades the old ones');
    b.T.detach(); b.T.stop();
  });
}

// 5b. the buses of chosen routes only, and only the buses layer (the finder's "Show live buses")
await ok('attach(map, {layers, routes}) draws only the buses of those routes; setRoutes() changes them; vehiclesGeo() filters', async () => {
  const b = boot(), map = fakeMap();
  b.T.attach(map, { layers: ['vehicles'], routes: ['10'] }); b.T.start(b.opts({})); await flush();
  deq(Object.keys(map.layers).sort(), ['transit-live-vehicle-halo', 'transit-live-vehicles']);
  deq(Object.keys(map.sources).sort(), ['transit-live-vehicles'], 'no stops source and no lines source');
  const feats = () => map.sources['transit-live-vehicles'].data.features;
  assert.equal(feats().length, 2, 'the saved feed has two buses on route 10 and none of them is dropped');
  assert.ok(feats().every(f => f.properties.route === '10'));
  b.T.setRoutes(['99']); assert.equal(feats().length, 0, 'a route with no bus on the road draws none');
  b.T.setRoutes(['1', '10']); assert.equal(feats().length, 2);
  b.T.setRoutes(null); assert.equal(feats().length, 2, 'null = every route (the fixture\'s other baked routes have no buses)');
  assert.equal(b.T.vehiclesGeo(['10']).features.length, 2, 'vehiclesGeo(list) filters on its own');
  assert.equal(b.T.vehiclesGeo(['20']).features.length, 0);
  assert.equal(b.T.vehiclesGeo(null).features.length, 2);
  assert.equal(b.T.vehiclesGeo().features.length, 2, 'vehiclesGeo() with no argument uses what attach/setRoutes chose');
  b.T.setRoutes([]); assert.equal(feats().length, 0, 'an empty list draws no bus');
  b.T.detach();
  deq(Object.keys(map.layers).concat(Object.keys(map.sources)), []);
  // the old call still draws everything
  const all = fakeMap(); b.T.attach(all); await flush();
  deq(Object.keys(all.layers).sort(), ['transit-live-lines', 'transit-live-stops', 'transit-live-vehicle-halo', 'transit-live-vehicles'], 'attach(map) with no options is unchanged');
  b.T.detach(); b.T.stop();
});

// 5c. a map that has a style but is not 'loaded' (tiles still arriving) takes the layers now; one with no style waits for 'load'
await ok('attach() on a map whose tiles are still loading draws now; with no style yet it waits for load', async () => {
  const b = boot(), busy = fakeMap(), once = {};
  busy.isStyleLoaded = () => false; busy.getStyle = () => ({ layers: [] }); busy.once = (e, f) => { once[e] = f; };
  b.T.attach(busy, { layers: ['vehicles'], routes: ['10'] }); b.T.start(b.opts({})); await flush();
  assert.ok(busy.layers['transit-live-vehicles'] && !once.load, 'layers added at once, no wait for a load event that may never come');
  b.T.detach(); b.T.stop();
  const b2 = boot(), bare = fakeMap();
  bare.isStyleLoaded = () => false; bare.getStyle = () => undefined; bare.once = (e, f) => { once[e] = f; };
  b2.T.attach(bare); await flush();
  assert.equal(Object.keys(bare.layers).length, 0, 'no style yet: nothing added'); assert.ok(once.load, 'it waits for load');
  bare.isStyleLoaded = () => true; once.load();
  assert.ok(bare.layers['transit-live-vehicles'], 'and draws when the style loads');
  b2.T.detach(); b2.T.stop();
});

// 6. scheduled(): tomorrow's first trips
await ok('real bake: no baked trip reaches any stop before 02:00, so a look-ahead past midnight has nothing to miss; a re-bake that does is still covered', async () => {
  const d = JSON.parse(fs.readFileSync(here('../../data/transit-live.json')));
  let min = Infinity, which = '';
  for (const [rid, r] of Object.entries(d.routes)) for (const x of r.dirs) for (const k of ['wk', 'sa', 'su']) for (const row of x.tt[k] || []) {
    const o = x.pats[row[0]].o; assert.ok(Math.min(...o) >= 0, 'offsets start at or after the trip start');
    let t = 0;
    for (const tok of row[1].split(' ')) { t += +tok.split('/')[0]; if (t < min) { min = t; which = rid + ' ' + k; } }
  }
  console.log('  earliest baked trip start of any day key: minute ' + min + ' (route ' + which + '); the look-ahead is ' + 120 + ' min');
  assert.ok(min >= 120, 'a trip at ' + min + ' min after midnight would fall inside a 23:50 look-ahead');
  // a bake whose Saturday has a 00:10 trip, asked at 23:50 on Friday
  const bake = cloneBake(); bake.routes['1'].dirs[0].tt.sa = [[0, '10']];
  const b = boot({ trips: false, bake });
  b.T.start(b.opts({ now: () => T0 + 1670000 })); await flush();     // Fri 23:50:00
  deq(b.T.departures('1042', 4, { route: '1' }).map(x => [x.minutes, x.scheduled]), [[10, '00:00'], [20, '00:10'], [40, '00:30'], [70, '01:00']], 'Saturday\'s 00:10 trip is listed at 23:50 Friday');
  b.T.stop();
});

// 7. an out-of-date bake says so and offers no timetable
await ok('after bake.feed.to: state().error says so, departures() offers no baked time, live ones stay', async () => {
  assert.ok(/data\.texas\.gov/.test(boot().T.credit) && /IP address/.test(boot().T.credit) && /nothing else/.test(boot().T.credit), 'the credit line says what a poll reveals');
  const mk = to => { const bake = cloneBake(); bake.feed.to = to; return bake; };
  const lastDay = boot({ trips: false, bake: mk('2026-10-09') });        // T0 is Friday 2026-10-09 Austin time: the last day counts
  lastDay.T.start(lastDay.opts({})); await flush();
  assert.equal(lastDay.T.state().error, null); assert.equal(lastDay.T.state().timetableExpired, false);
  assert.ok(lastDay.T.departures('1042', 3).length > 0);
  const old = boot({ trips: false, bake: mk('2026-10-08') });
  old.T.start(old.opts({})); await flush();
  assert.match(old.T.state().error, /timetable out of date.*2026-10-08/); assert.equal(old.T.state().timetableExpired, true);
  deq(old.T.departures('1042', 3), [], 'no baked time is offered as the timetable');
  const mixed = boot({ bake: mk('2026-10-08') });
  mixed.T.start(mixed.opts({ trips: true })); await flush();
  const d = mixed.T.departures('1042', 5);
  assert.ok(d.length > 0 && d.every(x => x.live === true && x.scheduled === null), 'live buses are still offered, with no baked label');
  old.T.stop(); lastDay.T.stop(); mixed.T.stop();
});

// 7. the real baked file is consistent
await ok('data/transit-live.json: every reference resolves, size is bounded', async () => {
  const p = here('../../data/transit-live.json');
  const raw = fs.readFileSync(p), d = JSON.parse(raw);
  assert.ok(raw.length < 200000, 'size ' + raw.length);
  assert.equal(d.version, 1); assert.equal(d.bbox.length, 4);
  let dirs = 0;
  for (const [rid, r] of Object.entries(d.routes)) {
    assert.match(r.color, /^#[0-9a-f]{6}$/);
    for (const x of r.dirs) {
      dirs++;
      assert.equal(x.runMin.length, x.stops.length, rid);
      assert.ok(x.stops.every(s => d.stops[s]), rid + ' stop');
      assert.ok(x.pats.every(q => q.o.length === (q.s || x.stops).length && (q.s || []).every(s => d.stops[s])), rid + ' pattern');
      for (const k in x.tt) for (const row of x.tt[k]) assert.ok(x.pats[row[0]] && /^[\d\/\- ]+$/.test(row[1]), rid + ' tt');
      assert.ok(/^\d\d:\d\d$/.test(x.first) && /^\d\d:\d\d$/.test(x.last), rid);
    }
  }
  assert.ok(dirs > 40);
});

console.log(`PASS: ${pass} transit-live checks`);
