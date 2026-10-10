/* transit-live.js -- live CapMetro buses for the map, with a scheduled fallback.

   One global, window.TransitLive. NOTHING happens at load: no fetch, no timer, no map
   change. Everything starts with start(). Read docs/transit-live.md for the source, the
   terms, the credit line and how to wire it. Only DOWNLOADS public feeds; nothing about
   the user (class buildings, schedule, position) is ever sent anywhere.

   The feed is on data.texas.gov, which answers a browser CORS only on two addresses:
   GET /api/views/<id>.json (3 KB, names the current file as blobId + blobFilename) and
   GET /api/views/<id>/files/<blobId>?filename=<blobFilename>. blobId changes at every
   update (15 to 30 s), so the first call is made before every read of the second. */
(function () {
  'use strict';

  /* ---- parameters: every colour, size and interval lives here ---- */
  const P = {
    api: 'https://data.texas.gov/api/views/',
    feedVehicles: 'eiei-9rpf',      // GTFS-realtime vehicle positions, protobuf (about 20 KB)
    feedTrips: 'rmk2-acnw',         // GTFS-realtime trip updates, protobuf (about 260 KB)
    bakeUrl: 'data/transit-live.json',
    credit: 'Bus data: Capital Metropolitan Transportation Authority (CapMetro), via data.texas.gov. Not affiliated with or endorsed by CapMetro. Provided as is.',
    intervalMs: 20000,              // vehicle poll
    tripsIntervalMs: 30000,         // trip-update poll (only while trips are wanted)
    trips: false,                   // poll trip updates? (260 KB each time; turn on with a stop panel open)
    timeoutMs: 15000,               // one request
    backoffFactor: 2,               // after an error the wait is interval * factor^failures
    backoffMaxMs: 300000,
    vehicleStaleS: 90,              // state().ok is false when the vehicle file is older than this
    tripsStaleS: 120,               // older trip updates are ignored by departures()
    timezone: 'America/Chicago',
    horizonMin: 120,                // departures() looks this far ahead
    graceS: 30,                     // a bus this far past still counts as "now"
    matchMin: 20,                   // a live time and a baked time this close are the same trip
    includeNoTrip: false,           // buses with no trip (out of service) have no route: leave them out
    // map drawing
    prefix: 'transit-live',
    vehicleRadius: [[11, 3], [14, 6], [17, 9]],      // zoom -> circle radius px
    vehicleHaloRadiusAdd: 2,
    vehicleHaloColor: '#0b1020',
    vehicleOpacity: 0.95,
    vehicleDefaultColor: '#bf5700',
    stopRadius: [[13, 1.5], [16, 3.5], [18, 5]],
    stopColor: '#ffffff',
    stopStrokeColor: '#0b1020',
    stopStrokeWidth: 1,
    stopMinZoom: 14,
    showLines: false,               // draw the baked route lines
    lineWidth: 2,
    lineOpacity: 0.7,
    beforeLayer: null                // draw under this layer id; null = on top
  };

  const root = typeof window !== 'undefined' ? window : globalThis;
  const STATUS = ['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO'];

  /* ---- protobuf: just the few GTFS-realtime fields we read ---- */
  let lo = 0, hi = 0;               // last varint read: low 32 bits, high bits
  function varint(b, i) {
    lo = 0; hi = 0;
    for (let s = 0; ; s += 7) {
      const c = b[i++];
      if (s < 28) lo |= (c & 127) << s;
      else if (s === 28) { lo |= (c & 15) << 28; hi = (c & 127) >> 4; }
      else hi |= (c & 127) << (s - 32);
      if (c < 128) break;
      if (s > 63) throw new Error('bad varint');
    }
    lo >>>= 0;
    return i;
  }
  const num = () => hi * 4294967296 + lo;
  function str(b, i, e) { let s = ''; for (; i < e; i++) s += String.fromCharCode(b[i]); return s; }
  // calls fn(field, wire, a, e): wire 0 -> a = value; wire 2 -> a..e is the payload; wire 5 -> a = offset
  function walk(b, i, end, fn) {
    while (i < end) {
      i = varint(b, i);
      const f = Math.floor(lo / 8) + hi * 536870912, w = lo & 7;
      if (w === 0) { i = varint(b, i); fn(f, 0, num(), 0); }
      else if (w === 2) { i = varint(b, i); const n = lo; fn(f, 2, i, i + n); i += n; }
      else if (w === 5) { fn(f, 5, i, 0); i += 4; }
      else if (w === 1) i += 8;
      else throw new Error('bad wire type ' + w);
    }
  }
  function trip(b, a, e) {
    const t = { tripId: null, routeId: null, dir: null, cancelled: false };
    walk(b, a, e, (f, w, x, y) => {
      if (f === 1) t.tripId = str(b, x, y);
      else if (f === 4) t.cancelled = x === 3;
      else if (f === 5) t.routeId = str(b, x, y);
      else if (f === 6) t.dir = x;
    });
    return t;
  }
  function vehicle(b, a, e, dv) {
    const v = { id: null, route: null, direction: null, lat: 0, lon: 0, bearing: null, speed: null, tripId: null, stopId: null, status: null, ts: 0 };
    walk(b, a, e, (f, w, x, y) => {
      if (f === 1) { const t = trip(b, x, y); v.tripId = t.tripId; v.route = t.routeId; v.direction = t.dir; }
      else if (f === 2) walk(b, x, y, (g, ww, p) => {
        if (ww !== 5) return;
        const val = dv.getFloat32(p, true);
        if (g === 1) v.lat = val; else if (g === 2) v.lon = val; else if (g === 3) v.bearing = val; else if (g === 5) v.speed = val;
      });
      else if (f === 4) v.status = STATUS[x] || null;
      else if (f === 5) v.ts = x;
      else if (f === 7) v.stopId = str(b, x, y);
      else if (f === 8) walk(b, x, y, (g, ww, p, q) => { if (g === 1) v.id = str(b, p, q); });
    });
    return v;
  }
  function tripUpdate(b, a, e) {
    const u = { tripId: null, route: null, direction: null, cancelled: false, stops: [] };
    walk(b, a, e, (f, w, x, y) => {
      if (f === 1) { const t = trip(b, x, y); u.tripId = t.tripId; u.route = t.routeId; u.direction = t.dir; u.cancelled = t.cancelled; }
      else if (f === 2) {
        const s = { stopId: null, time: 0, skipped: false };
        walk(b, x, y, (g, ww, p, q) => {
          if (g === 4) s.stopId = str(b, p, q);
          else if (g === 5) s.skipped = p === 1;
          else if ((g === 2 || g === 3) && ww === 2) {      // arrival, departure: StopTimeEvent.time = field 2
            let tm = 0;
            walk(b, p, q, (h, w3, z) => { if (h === 2) tm = z; });
            if (g === 3 || !s.time) s.time = tm || s.time;   // a departure wins over an arrival
          }
        });
        u.stops.push(s);
      }
    });
    return u;
  }
  /* decode(bytes) -> {timestamp, vehicles: [...], trips: [...]} for either feed */
  function decode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out = { timestamp: 0, vehicles: [], trips: [] };
    walk(b, 0, b.length, (f, w, x, y) => {
      if (f === 1) walk(b, x, y, (g, ww, v) => { if (g === 3 && ww === 0) out.timestamp = v; });
      else if (f === 2) walk(b, x, y, (g, ww, p, q) => {
        if (g === 3) out.trips.push(tripUpdate(b, p, q));
        else if (g === 4) out.vehicles.push(vehicle(b, p, q, dv));
      });
    });
    return out;
  }

  /* ---- state ---- */
  const S = {
    started: false, opts: null, gen: 0,
    bake: null, bakeP: null, idx: null,
    veh: { feed: null, fetchedAt: 0, ok: false, error: null, fails: 0, timer: 0, busy: false, list: [] },
    trp: { feed: null, fetchedAt: 0, ok: false, error: null, fails: 0, timer: 0, busy: false, byStop: new Map() },
    listeners: [], map: null, mapSt: null, visFn: null
  };
  const now = () => (S.opts && S.opts.now ? S.opts.now() : Date.now());
  const cfg = () => Object.assign({}, P, S.opts || {});

  /* ---- fetching ---- */
  function timedFetch(url) {
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), cfg().timeoutMs) : 0;
    return fetch(url, { cache: 'no-store', signal: c ? c.signal : undefined })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r; })
      .finally(() => clearTimeout(t));
  }
  function readFeed(id) {
    const p = cfg();
    return timedFetch(p.api + id + '.json').then(r => r.json()).then(m => {
      if (!m || !m.blobId || !m.blobFilename) throw new Error('no blobId for ' + id);
      return timedFetch(p.api + id + '/files/' + m.blobId + '?filename=' + encodeURIComponent(m.blobFilename));
    }).then(r => r.arrayBuffer()).then(buf => new Uint8Array(buf));
  }
  function loadBake(url) {
    if (S.bake) return Promise.resolve(S.bake);
    if (!S.bakeP) S.bakeP = timedFetch(url || cfg().bakeUrl).then(r => r.json()).then(d => { S.bake = d; S.idx = null; return d; })
      .catch(e => { S.bakeP = null; throw e; });
    return S.bakeP;
  }
  const emit = () => S.listeners.slice().forEach(fn => { try { fn(state()); } catch (e) { /* a listener must not stop the poll */ } });
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  function inBake(v) {
    const d = S.bake;
    if (!d) return true;
    if (!v.route) return cfg().includeNoTrip;
    if (!d.routes[v.route]) return false;
    const bb = d.bbox;
    return v.lon >= bb[0] && v.lon <= bb[2] && v.lat >= bb[1] && v.lat <= bb[3];
  }
  function apply(kind, bytes) {
    const f = decode(bytes), at = now();
    const L = S[kind];
    L.feed = f; L.fetchedAt = at; L.ok = true; L.error = null; L.fails = 0;
    if (kind === 'veh') {
      L.list = f.vehicles.map(v => ({ id: v.id, route: v.route, direction: v.direction, lat: v.lat, lon: v.lon, bearing: v.bearing,
        speed: v.speed, tripId: v.tripId, stopId: v.stopId, status: v.status })).filter(inBake);
    } else {
      const m = new Map(), stops = S.bake && S.bake.stops;
      for (const u of f.trips) {
        if (u.cancelled || !u.route) continue;
        for (const s of u.stops) {
          if (s.skipped || !s.time || (stops && !stops[s.stopId])) continue;
          let a = m.get(s.stopId); if (!a) m.set(s.stopId, a = []);
          a.push({ route: u.route, dir: u.direction, tripId: u.tripId, t: s.time });
        }
      }
      L.byStop = m;
    }
  }
  function poll(kind) {
    const L = S[kind], gen = S.gen, p = cfg();
    L.timer = 0;
    if (!S.started || L.busy) return;
    if (kind === 'trp' && !p.trips) return;
    if (hidden()) return;                       // the visibilitychange handler restarts it
    L.busy = true;
    readFeed(kind === 'veh' ? p.feedVehicles : p.feedTrips).then(bytes => {
      if (gen !== S.gen) return;
      apply(kind, bytes);
    }).catch(e => {
      if (gen !== S.gen) return;
      L.ok = false; L.error = String((e && e.message) || e); L.fails++;
    }).then(() => {
      L.busy = false;
      if (gen !== S.gen) return;
      emit(); draw();
      const base = kind === 'veh' ? p.intervalMs : p.tripsIntervalMs;
      const wait = Math.min(p.backoffMaxMs, base * Math.pow(p.backoffFactor, L.fails));
      if (S.started && !hidden()) L.timer = setTimeout(() => poll(kind), wait);
    });
  }
  function kick() {
    ['veh', 'trp'].forEach(k => { if (!S[k].timer && !S[k].busy) poll(k); });
  }

  /* ---- public: start / stop / state / on ---- */
  function start(opts) {
    try {
      if (S.started) { S.opts = Object.assign(S.opts || {}, opts || {}); kick(); return; }
      S.opts = Object.assign({}, opts || {});
      S.started = true; S.gen++;
      if (typeof document !== 'undefined' && document.addEventListener) {
        S.visFn = () => { if (!hidden() && S.started) kick(); };
        document.addEventListener('visibilitychange', S.visFn);
      }
      // the schedule first (it filters the vehicles); a missing file is reported, not fatal
      loadBake().catch(e => { S.veh.error = 'schedule: ' + String((e && e.message) || e); }).then(() => { if (S.started) kick(); });
    } catch (e) { S.veh.error = String(e && e.message || e); }
  }
  function stop() {
    S.started = false; S.gen++;
    ['veh', 'trp'].forEach(k => { clearTimeout(S[k].timer); S[k].timer = 0; S[k].busy = false; });
    if (S.visFn && typeof document !== 'undefined') document.removeEventListener('visibilitychange', S.visFn);
    S.visFn = null;
  }
  function wantTrips(on) { S.opts = Object.assign(S.opts || {}, { trips: !!on }); if (S.started && on) kick(); }
  function config(o) { Object.assign(P, o || {}); }
  function state() {
    const L = S.veh, ts = L.feed && L.feed.timestamp;
    const age = ts ? Math.max(0, Math.round((now() - ts * 1000) / 1000)) : null;
    return { ok: L.ok && age !== null && age <= cfg().vehicleStaleS, ageSec: age, fetchedAt: L.fetchedAt || null,
      vehicles: L.list.slice(), error: L.error };
  }
  function on(fn) {
    S.listeners.push(fn);
    return () => { const i = S.listeners.indexOf(fn); if (i >= 0) S.listeners.splice(i, 1); };
  }
  function data() { return loadBake(); }

  /* ---- time ---- */
  let fmt = null;
  function local(ms) {
    if (!fmt) fmt = new Intl.DateTimeFormat('en-US', { timeZone: cfg().timezone, hourCycle: 'h23', weekday: 'short',
      hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const o = {};
    fmt.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
    return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday),
      sec: (+o.hour % 24) * 3600 + (+o.minute) * 60 + (+o.second) };
  }
  const dayKey = wd => (wd === 0 ? 'su' : wd === 6 ? 'sa' : 'wk');
  const hhmm = sec => { const m = Math.round(sec / 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  /* ---- scheduled departures from the bake ---- */
  function decodeTT(d) {
    if (d._dec) return d._dec;
    const o = {};
    for (const k in d.tt) {
      o[k] = {};
      for (const row of d.tt[k]) {
        let t = 0; const a = [];
        for (const tok of row[1].split(' ')) { const q = tok.split('/'); t += +q[0]; a.push([t, +q[1] || 0]); }
        o[k][row[0]] = a;
      }
    }
    return (d._dec = o);
  }
  function stopIndex() {
    if (S.idx) return S.idx;
    const m = new Map();
    for (const rid in S.bake.routes) for (const d of S.bake.routes[rid].dirs) {
      d.pats.forEach((p, pi) => {
        (p.s || d.stops).forEach((sid, i) => {
          let a = m.get(sid); if (!a) m.set(sid, a = []);
          a.push({ rid, d, pi, i });
        });
      });
    }
    return (S.idx = m);
  }
  function scheduled(stopId, f, nowMs) {
    if (!S.bake) return [];
    const occ = stopIndex().get(stopId) || [], p = cfg();
    const lt = local(nowMs), mid = nowMs - lt.sec * 1000;    // local midnight, to the second
    const out = [], from = nowMs - p.matchMin * 60000, to = nowMs + p.horizonMin * 60000;
    for (const { rid, d, pi, i } of occ) {
      if (f.route != null && String(f.route) !== rid) continue;
      if (f.dir != null && f.dir !== d.dir) continue;
      const pat = d.pats[pi], offs = pat.o, span = offs[offs.length - 1], dec = decodeTT(d);
      for (const back of [0, 1]) {     // today's service, and yesterday's trips that run past midnight
        const dk = dayKey((lt.wd + 7 - back) % 7), rows = dec[dk] && dec[dk][pi];
        if (!rows) continue;
        const base = mid - back * 86400000;
        for (const [st, dev] of rows) {
          const k = span > 0 ? (span + dev) / span : 1;
          const t = base + (st + offs[i] * k) * 60000;
          if (t >= from && t <= to) out.push({ rid, d, t: Math.round(t / 1000) * 1000, head: pat.h });
        }
      }
    }
    return out;
  }

  /* departures(stopId, n, {route, dir}) -> [{route, short, color, dir, headsign, minutes, live, scheduled, tripId?}] */
  function departures(stopId, n, filter) {
    try {
      n = n || 3; const f = filter || {}, at = now(), p = cfg();
      const R = S.bake ? S.bake.routes : {};
      const sch = scheduled(String(stopId), f, at);
      const liveOk = S.trp.ok && S.trp.fetchedAt && (at - S.trp.feed.timestamp * 1000) / 1000 <= p.tripsStaleS;
      const live = [], last = {};
      if (liveOk) {
        for (const u of S.trp.byStop.get(String(stopId)) || []) {
          if ((f.route != null && String(f.route) !== u.route) || (f.dir != null && u.dir != null && f.dir !== u.dir)) continue;
          if (u.t * 1000 < at - p.graceS * 1000 || u.t * 1000 > at + p.horizonMin * 60000) continue;
          live.push(u);
          const key = u.route + '|' + (u.dir == null ? '*' : u.dir);
          last[key] = Math.max(last[key] || 0, u.t * 1000);
        }
      }
      const res = [];
      const mk = (rid, dir, t, head, isLive, schedT, tripId) => {
        const r = R[rid] || {};
        const dd = (r.dirs || []).find(x => x.dir === dir) || (r.dirs || [])[0] || {};
        const o = { route: rid, short: r.short || rid, color: r.color || p.vehicleDefaultColor, dir, headsign: head || dd.headsign || '',
          minutes: Math.max(0, Math.round((t - at) / 60000)), live: isLive,
          scheduled: schedT == null ? null : hhmm(local(schedT).sec) };
        if (isLive) o.tripId = tripId;
        o.at = t;
        return o;
      };
      live.sort((a, b) => a.t - b.t);
      for (const u of live) {         // each live bus takes the nearest still-unused baked time of its route and direction
        let near = null;
        for (const s of sch) {
          if (s.used || s.rid !== u.route || (u.dir != null && s.d.dir !== u.dir)) continue;
          const g = Math.abs(s.t - u.t * 1000);
          if (g <= p.matchMin * 60000 && (!near || g < Math.abs(near.t - u.t * 1000))) near = s;
        }
        if (near) near.used = true;
        res.push(mk(u.route, u.dir, u.t * 1000, near && near.head, true, near && near.t, u.tripId));
      }
      for (const s of sch) {
        if (s.t < at - p.graceS * 1000) continue;
        const l = last[s.rid + '|' + s.d.dir] || last[s.rid + '|*'];
        if (l && s.t <= l + 60000) continue;      // live data covers this route and direction up to here
        res.push(mk(s.rid, s.d.dir, s.t, s.head, false, s.t));
      }
      res.sort((a, b) => a.at - b.at);
      return res.slice(0, n).map(o => { delete o.at; return o; });
    } catch (e) { return []; }
  }

  /* ---- map layers ---- */
  const id = s => cfg().prefix + '-' + s;
  const zoomStops = a => ['interpolate', ['linear'], ['zoom']].concat([].concat.apply([], a));
  function fc(features) { return { type: 'FeatureCollection', features }; }
  function stopsGeo() {
    const st = S.bake && S.bake.stops || {};
    return fc(Object.keys(st).map(k => ({ type: 'Feature', properties: { id: k, name: st[k][0] },
      geometry: { type: 'Point', coordinates: [st[k][2], st[k][1]] } })));
  }
  function linesGeo() {
    const out = [];
    const R = S.bake && S.bake.routes || {};
    for (const rid in R) for (const d of R[rid].dirs) if (d.shape.length > 1)
      out.push({ type: 'Feature', properties: { route: R[rid].short, color: R[rid].color }, geometry: { type: 'LineString', coordinates: d.shape } });
    return fc(out);
  }
  function vehiclesGeo() {
    const R = S.bake && S.bake.routes || {};
    return fc(S.veh.list.map(v => ({ type: 'Feature', properties: { id: v.id, route: R[v.route] ? R[v.route].short : v.route || '',
      color: (R[v.route] && R[v.route].color) || cfg().vehicleDefaultColor, bearing: v.bearing == null ? 0 : v.bearing },
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] } })));
  }
  function draw() {
    const m = S.map; if (!m || !S.mapSt) return;
    try {
      const a = m.getSource(id('vehicles')); if (a) a.setData(vehiclesGeo());
    } catch (e) { /* the style may be reloading */ }
  }
  function addLayers(map) {
    const p = cfg(), b = p.beforeLayer && map.getLayer(p.beforeLayer) ? p.beforeLayer : undefined;
    const add = (l) => { if (!map.getLayer(l.id)) map.addLayer(l, b); };
    ['stops', 'lines', 'vehicles'].forEach(k => { if (!map.getSource(id(k))) map.addSource(id(k), { type: 'geojson', data: fc([]) }); });
    map.getSource(id('stops')).setData(stopsGeo());
    map.getSource(id('lines')).setData(linesGeo());
    add({ id: id('lines'), type: 'line', source: id('lines'), layout: { visibility: p.showLines ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': p.lineWidth, 'line-opacity': p.lineOpacity } });
    add({ id: id('stops'), type: 'circle', source: id('stops'), minzoom: p.stopMinZoom,
      paint: { 'circle-radius': zoomStops(p.stopRadius), 'circle-color': p.stopColor, 'circle-stroke-color': p.stopStrokeColor, 'circle-stroke-width': p.stopStrokeWidth } });
    add({ id: id('vehicle-halo'), type: 'circle', source: id('vehicles'),
      paint: { 'circle-radius': zoomStops(p.vehicleRadius.map(r => [r[0], r[1] + p.vehicleHaloRadiusAdd])), 'circle-color': p.vehicleHaloColor, 'circle-opacity': p.vehicleOpacity } });
    add({ id: id('vehicles'), type: 'circle', source: id('vehicles'),
      paint: { 'circle-radius': zoomStops(p.vehicleRadius), 'circle-color': ['get', 'color'], 'circle-opacity': p.vehicleOpacity } });
    S.mapSt = true;
    draw();
  }
  function attach(map) {
    try {
      detach();
      S.map = map;
      loadBake().then(() => {
        if (S.map !== map) return;
        if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('load', () => { if (S.map === map) addLayers(map); });
        else addLayers(map);
      }).catch(e => { S.veh.error = 'schedule: ' + String((e && e.message) || e); });
    } catch (e) { S.veh.error = String(e && e.message || e); }
  }
  function detach() {
    const m = S.map; S.map = null; S.mapSt = null;
    if (!m) return;
    try {
      ['vehicles', 'vehicle-halo', 'stops', 'lines'].forEach(k => { if (m.getLayer(id(k))) m.removeLayer(id(k)); });
      ['vehicles', 'stops', 'lines'].forEach(k => { if (m.getSource(id(k))) m.removeSource(id(k)); });
    } catch (e) { /* map already gone */ }
  }

  root.TransitLive = { start, stop, state, departures, on, attach, detach, data, config, wantTrips, decode,
    get credit() { return cfg().credit; }, params: P };
})();
