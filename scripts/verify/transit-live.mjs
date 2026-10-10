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

function boot({ now = T0, trips = true, vehicles = true, hidden = false } = {}) {
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
    if (url === 'data/transit-live.json') return res(MINI);
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
      return res(buf(fx(m[1] === VEH ? 'vehiclepositions.pb' : 'tripupdates.pb')));
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
