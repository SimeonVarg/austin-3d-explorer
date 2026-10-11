/**
 * game.js — Air Race, wired up. js/app.js builds the map and the city, then calls the global
 * `initControls(map, scene)` at its 'controls' step; this file defines that function (index.html
 * loads js/controls.js there instead), so the shared city code is untouched and the fly camera is
 * replaced by the race.
 *
 *   assets   data/air/courses.json, heights.json + heights.u8, house.json   (all under data/air/, none on index.html)
 *   loop     requestAnimationFrame -> Sim.Game.advance (fixed 120 Hz sim) -> camera.update (one jumpTo) -> layer.frame
 *   link     #g=<ghost> in the URL fragment = the sender's run as a ghost craft and a time to beat
 *
 * URL flags (all optional):  ?auto=1 the autopilot flies (the recorded clip), ?countdown=N seconds,
 *   ?hud=0 a clean frame, ?fps=1 a frame-time readout, ?manual=1 no rAF: window.__air.advance(dt) steps it
 *   (deterministic capture), ?p=0.12 the hour (0 day, 0.5 golden hour, 1 night), ?ghost=house|none.
 *
 * Debug / capture hooks on window.__air.
 */
(function () {
  'use strict';
  const AIR = window.AIR, G = window.AirGeo;
  const q = new URLSearchParams(location.search);
  const BASE = 'data/air/';
  const DAY_P = 0.12, NIGHT_P = 1.0;
  const BEST_KEY = 'air.best.skyline';

  window.__flyRebuildCollision = function () {};

  window.initControls = function (map, scene) {
    const S = {};            // everything, exposed as __air
    let raf = 0, last = 0, started = false, disposed = false;
    const manual = q.get('manual') === '1';
    const auto = q.get('auto') === '1';
    const countdownS = q.has('countdown') ? Math.max(0, +q.get('countdown')) : AIR.countdownS;
    const night = { on: false };
    S.manual = manual; S.auto = auto;      // S.auto may be flipped live (the perf run starts the autopilot by hand)

    const readBest = () => { try { const v = +localStorage.getItem(BEST_KEY); return v > 0 ? v : null; } catch (e) { return null; } };
    const writeBest = t => { try { localStorage.setItem(BEST_KEY, String(t)); } catch (e) {} };

    // ── assets ────────────────────────────────────────────────────────
    const get = (f, type) => fetch(BASE + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return type === 'buf' ? r.arrayBuffer() : r.json(); });
    Promise.all([get('courses.json'), get('heights.json'), get('heights.u8', 'buf'), get('house.json')]).then(([course, hm, hb, house]) => {
      if (disposed) return;
      S.course = course; S.house = house;
      S.field = new window.AirHeights.HeightField(hm, new Uint8Array(hb));
      boot();
    }).catch(e => { console.error('[air] could not load the course', e); try { window.loaderDone && window.loaderDone({ reason: 'air-assets' }); } catch (er) {} });

    const camera = window.AirCamera.create(map);
    const input = window.AirInput.create({
      restart: () => restart(), night: () => toggleNight(), hud: () => S.ui && S.ui.hudToggle(),
      start: () => { if (S.game && S.game.state === 'ready') begin(); }, isReady: () => !!S.game && S.game.state === 'ready', tapStarts: true,
      invert: on => S.ui && S.ui.toast(on ? 'Pitch inverted (drag up = climb)' : 'Pitch normal (drag up = dive)'),
    });
    S.camera = camera; S.input = input;

    // __fly: the few things the shared modules ask the fly camera (lod.js, night.js, city-lighting.js ...).
    window.__fly = {
      eye() { const e = camera.state, ll = G.toLngLat(e.ex, e.ey); return { lng: ll.lng, lat: ll.lat, alt: e.ez, altUser: e.ez, altFloor: 0, vE: 0, vN: 0, bearing: map.getBearing(), pitch: map.getPitch(), driving: true }; },
      roofAt(lng, lat, r) { if (!S.field) return 0; const p = G.toLocal(lng, lat); return S.field.maxHeight(p.x, p.y, r || 8); },
      groundAt: () => 0, indexed: () => !!S.field, tune: {}, home: () => null, fence: () => null,
    };
    try { window.dispatchEvent(new Event('flycam:takeover')); } catch (e) {}

    // ── boot ──────────────────────────────────────────────────────────
    function boot() {
      const course = S.course;
      S.game = new window.AirSim.Game(course, S.field);
      S.gates = S.game.gates;
      S.ui = window.AirUI.create({ bindHold: input.bindHold, restart: () => restart(), copyLink });
      S.layer = window.AirLayer.create(map);
      S.layer.setCourse(S.gates);
      if (q.get('hud') === '0') document.documentElement.classList.add('air-clean');
      if (q.get('fps') === '1') fpsBox();
      // the reference to beat: the link's ghost, else the house run
      const hash = (location.hash.match(/g=([A-Za-z0-9_-]+)/) || [])[1];
      let ref = null, refLabel = null;
      try { if (hash && q.get('ghost') !== 'house') { ref = window.AirGhost.decode(hash); refLabel = 'Ghost'; } } catch (e) { console.warn('[air] bad ghost link', e); S.ui.toast('That ghost link did not decode; racing the house run.'); }
      if (!ref && q.get('ghost') !== 'none') { ref = window.AirGhost.decode(S.house.ghost); refLabel = 'House run'; }
      setRef(ref, refLabel);
      S.fromLink = !!hash && refLabel === 'Ghost';
      const p = parseFloat(q.get('p')); setHour(isFinite(p) ? p : DAY_P);
      map.once('idle', () => {});
      S.layer.add(); keepOnTop();
      restart(true);
      // fixed clock/ready screen
      ready();
      if (!manual) { last = performance.now(); raf = requestAnimationFrame(frame); }
      S.booted = true;
      document.documentElement.dataset.airReady = '1';
    }
    function keepOnTop() {
      const top = () => { try { const L = map.getStyle().layers; if (L.length && L[L.length - 1].id !== 'air-race' && map.getLayer('air-race')) map.moveLayer('air-race'); } catch (e) {} };
      map.on('idle', top); top();
    }
    function setRef(ref, label) {
      S.ref = ref; S.refLabel = label; S.refSplits = null;
      if (!ref) return;
      const pts = []; const end = ref.pts[ref.pts.length - 1].t;
      for (let t = 0; t <= end; t += 0.05) { const s = window.AirGhost.sampleAt(ref, t); pts.push({ t, x: s.x, y: s.y, z: s.z }); }
      const r = window.AirRace.scorePath(S.gates, pts);
      S.refSplits = r.results.map(x => x && x.split);
      S.refTime = ref.meta.time;
    }
    function setHour(p) {
      const sl = document.getElementById('tod-slider');
      if (sl) { sl.value = p; sl.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (window.applyTimeOfDay) window.applyTimeOfDay(map, p);
      night.on = p > 0.8; S.hour = p;
    }
    function toggleNight() { setHour(night.on ? DAY_P : NIGHT_P); }

    // ── the flow: ready -> countdown -> running -> finished ───────────
    function ready() {
      const g = S.game, ui = S.ui;
      ui.centre(`<small>${S.fromLink ? 'A ghost link: beat their time' : 'Skyline: ' + S.gates.length + ' rings, UT Tower to Darrell K Royal Stadium'}</small>`
        + `Press <b>Enter</b> or tap to start<small>${S.ref ? S.refLabel + ' to beat: ' + window.AirRace.fmt(S.refTime) : ''}</small>`, 'small');
      ui.setClock(0); ui.setGate(0, S.gates.length, S.gates[0].name); ui.setDelta(null);
      if (S.auto || q.get('start') === '1') begin();
    }
    function begin() {
      if (S.game.state !== 'ready') return;
      S.ui.centre(''); S.game.startCountdown(countdownS);
      S.ui.hintHide();
    }
    function restart(first) {
      const g = S.game; if (!g) return;
      g.reset(); camera.reset(); S.ui.hideFinish(); S.ui.setDelta(null); S.ui.centre(''); S.finishShown = false; S.lastCount = null; S.runStart = null;
      if (!first) begin(); else { poseCamera(0.016); }
    }
    S.restart = restart; S.begin = begin;

    function inputNow() {
      if (S.auto && S.game && S.game.state !== 'ready') {
        const P = Object.assign({}, AIR, { autopilot: Object.assign({}, AIR.autopilot, { skill: S.autoSkill == null ? 1.0 : S.autoSkill }) });
        return window.AirAutopilot.control(S.game.craft, S.gates, Math.min(S.game.race.next, S.gates.length - 1), P);
      }
      return input.read();
    }

    // ── per-frame ─────────────────────────────────────────────────────
    function poseCamera(dt) { camera.update(S.game.craft, dt); }
    function tick(dt) {
      const g = S.game; if (!g || !S.booted) return;
      const inp = inputNow();
      g.advance(dt, () => inp);
      poseCamera(dt);
      handleEvents();
      hud(dt);
      drawFrame();
      perfSample(dt);
    }
    function handleEvents() {
      const g = S.game, ui = S.ui, ev = g.events.splice(0);
      for (const e of ev) {
        if (e.type === 'go') { ui.centre('GO', 'go'); setTimeout(() => ui.centre(''), 700); }
        else if (e.type === 'hit' || e.type === 'miss') {
          const ref = S.refSplits && S.refSplits[e.i], d = ref != null ? e.split - ref : null;
          ui.setGate(g.race.next, S.gates.length, S.gates[Math.min(g.race.next, S.gates.length - 1)].name);
          if (e.type === 'miss') ui.flash('MISSED  +' + AIR.penaltyS.toFixed(1) + ' s', 'miss');
          else ui.flash(d == null ? window.AirRace.fmt(e.split) : window.AirRace.fmtDelta(d), d == null ? 'hit' : d <= 0 ? 'ahead' : 'miss');
          if (d != null) ui.setDelta(d);
        } else if (e.type === 'finish') finish(e);
      }
    }
    function hud(dt) {
      const g = S.game, ui = S.ui, c = g.craft;
      if (g.state === 'countdown') {
        const n = Math.ceil(g.cd); if (n !== S.lastCount) { S.lastCount = n; ui.centre(n > 0 ? String(n) : ''); }
      }
      ui.setClock(g.state === 'running' || g.state === 'finishing' || g.state === 'finished' ? g.clock() : 0);
      ui.setGauge(c.v, c.z);
      ui.stick(input.anchor());
    }
    function drawFrame() {
      const g = S.game, c = g.craft, t = g.state === 'running' || g.state === 'finishing' || g.state === 'finished' ? g.t : 0;
      let ghost = null;
      if (S.ref && q.get('ghost') !== 'none' && (g.state === 'running' || g.state === 'finishing')) {
        const end = S.ref.pts[S.ref.pts.length - 1].t;
        if (t <= end) { const s = window.AirGhost.sampleAt(S.ref, t); ghost = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, roll: window.AirGhost.bankAt(S.ref, t) }; }
      }
      const states = S.gates.map((_, i) => { const r = g.race.results[i]; return r ? r.status : null; });
      S.layer.frame({ craft: c, ghost, states, next: g.race.next, clock: performance.now() / 1000, speedFrac: Math.max(0, Math.min(1, (c.v - AIR.flight.vCruise * 0.6) / (AIR.flight.vBoost - AIR.flight.vCruise * 0.6))),
        eye: { x: camera.state.ex, y: camera.state.ey, z: camera.state.ez }, showTrail: g.state === 'running' && AIR.look.lineToNext, showStreaks: AIR.look.windStreaks && window.AIR_BUDGET && window.AIR_BUDGET.layer.windStreaks, showCraft: true });
      map.triggerRepaint();
    }
    function frame(now) {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, AIR.maxFrameS); last = now;
      tick(dt);
      raf = requestAnimationFrame(frame);
    }

    // ── finish, link, best ────────────────────────────────────────────
    function finish(e) {
      if (S.finishShown) return; S.finishShown = true;
      const g = S.game, time = e.time, prevBest = readBest();
      if (prevBest == null || time < prevBest) writeBest(time);
      const rows = S.gates.map((gt, i) => { const r = g.race.results[i]; const ref = S.refSplits && S.refSplits[i];
        return { i, name: gt.name, status: r ? r.status : 'miss', split: r ? r.split : null, d: r && ref != null ? r.split - ref : null }; });
      S.result = { time, misses: e.misses, rows };
      // finish a beat late so the last gate's flash is seen first
      setTimeout(() => { S.ui.showFinish({ time, misses: e.misses, rows, best: prevBest, refLabel: S.ref ? S.refLabel : null, refTime: S.refTime }); S.ui.setLink(linkText().slice(0, 140) + '…'); }, S.auto ? 50 : 900);
    }
    function linkText() {
      const g = S.game, str = window.AirGhost.encode(g.samples(), { course: 1, time: S.result ? S.result.time : g.clock(), misses: g.race.misses });
      S.lastGhost = str;
      return location.origin + location.pathname.replace(/[^/]*$/, '') + 'air.html#g=' + str;
    }
    function copyLink(btn) {
      const url = linkText();
      const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = t, 1400); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => fallback(url, done)); else fallback(url, done);
    }
    function fallback(url, done) { const ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { S.ui.toast('Select the link under the buttons and copy it', 4000); } ta.remove(); }
    S.linkText = linkText;

    // ── frame-time meter ──────────────────────────────────────────────
    const perf = { on: false, dts: [] };
    function perfSample(dt) { if (!perf.on) return; perf.dts.push(dt * 1000); if (perf.dts.length % 6 === 0) { perf.n = (perf.n || 0) + 1; if (!map.areTilesLoaded()) perf.loading = (perf.loading || 0) + 1; } }
    S.perfStart = () => { perf.dts = []; perf.n = 0; perf.loading = 0; perf.on = true; };
    S.perfStop = () => { perf.on = false; const a = perf.dts.slice().sort((x, y) => x - y), n = a.length;
      if (!n) return null; const pc = p => a[Math.min(n - 1, Math.floor(p * n))], mean = a.reduce((s, v) => s + v, 0) / n;
      return { frames: n, fpsMean: +(1000 / mean).toFixed(1), p50ms: +pc(0.5).toFixed(1), p95ms: +pc(0.95).toFixed(1), p99ms: +pc(0.99).toFixed(1), worstMs: +a[n - 1].toFixed(1), fpsP5low: +(1000 / pc(0.95)).toFixed(1), tilesPendingShare: perf.n ? +(perf.loading / perf.n).toFixed(2) : null }; };
    function fpsBox() {
      const b = document.createElement('div'); b.style.cssText = 'position:fixed;right:10px;top:10px;z-index:99;font:12px ui-monospace,monospace;color:#7df9ff;background:rgba(0,0,0,.5);padding:4px 8px;border-radius:6px'; document.body.appendChild(b);
      let n = 0, t0 = performance.now(), worst = 0; const loop = () => { n++; const t = performance.now(); if (t - t0 >= 500) { b.textContent = Math.round(n * 1000 / (t - t0)) + ' fps'; n = 0; t0 = t; } requestAnimationFrame(loop); }; loop();
    }

    // ── hooks ─────────────────────────────────────────────────────────
    /** Step the sim (no drawing) with the autopilot until sim time t; for captures that start mid-course. */
    S.seek = function (t) {
      const g = S.game; if (g.state === 'ready') { g.startCountdown(0); g.stepOnce(); }
      const n = Math.round(t * AIR.stepHz) - g.steps;
      for (let i = 0; i < n && g.state !== 'finished'; i++) g.stepOnce(inputNow());
      g.events.length = 0; camera.reset(); poseCamera(0.016); handleEventsQuiet();
    };
    function handleEventsQuiet() { const g = S.game; S.ui.setGate(g.race.next, S.gates.length, S.gates[Math.min(g.race.next, S.gates.length - 1)].name); S.ui.centre(''); }
    /** Gate crossing times of a full-skill autopilot run, in sim seconds (to aim a capture at a gate). */
    S.timeline = function (skill) { const r = window.AirSim.runAutopilot(S.course, S.field, { skill: skill == null ? 1 : skill }); return { time: r.time, gates: r.results.map((x, i) => ({ i, name: S.gates[i].name, t: x && x.t })) }; };
    S.advance = (dt) => tick(dt);             // manual stepping for deterministic capture
    S.map = map; S.setHour = setHour; S.setRef = setRef;
    S.state = () => S.game && { state: S.game.state, t: S.game.t, clock: S.game.clock(), next: S.game.race.next, misses: S.game.race.misses, craft: Object.assign({}, S.game.craft) };
    window.__air = S;

    return function cleanup() {
      disposed = true; cancelAnimationFrame(raf); input.dispose(); camera.release();
      if (S.layer) S.layer.remove();
      delete window.__fly; delete window.__flyRebuildCollision;
    };
  };
})();
