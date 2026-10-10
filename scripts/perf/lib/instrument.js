/* Injected before any page script (Page.addScriptToEvaluateOnNewDocument). Changes nothing in js/.
   Records on window.__perf: marks (first map render, idle, reveal, apartments done), long tasks, paints,
   console lines with times, per-source first-loaded times, timed wrappers for the init/apply passes, a
   frame log, and WebGL accounting (draw calls, triangles, live texture/buffer bytes by allocating file).
   Wrapping a function costs one performance.now() pair per call; the frame log costs one rAF callback. */
(() => {
  if (window.top !== window || window.__perf) return;
  const cfg = window.__PERF_CFG || {};
  const P = window.__perf = {
    t0: performance.now(), marks: {}, calls: [], log: [], long: [], paints: [], src: {}, frames: [], fetches: [],
    gl: { draws: 0, tris: 0, frameDraws: 0, frameTris: 0, perFrame: [], texBytes: 0, bufBytes: 0, rbBytes: 0, peak: { tex: 0, buf: 0, rb: 0 }, own: {}, calls: {} },
  };
  const now = () => +(performance.now()).toFixed(1);
  const mark = (k) => { if (P.marks[k] == null) P.marks[k] = now(); };

  // --- graphics auto-detect: cancel it (CLAUDE.md rule 10) unless the run wants the app's own behaviour
  if (!cfg.autodetect) {
    const iv = setInterval(() => { if (window.cancelGraphicsAutoDetect) { try { window.cancelGraphicsAutoDetect(); P.marks.autodetectCancelled = now(); } catch (e) {} clearInterval(iv); } }, 10);
    setTimeout(() => clearInterval(iv), 30000);
  }

  // --- console lines with times (the app logs its own build phases)
  for (const lvl of ['log', 'warn', 'error']) {
    const real = console[lvl].bind(console);
    console[lvl] = function () {
      try { if (P.log.length < 600) P.log.push([now(), lvl, Array.from(arguments).map(a => typeof a === 'string' ? a : (a && a.message) || String(a)).join(' ').slice(0, 400)]); } catch (e) {}
      return real.apply(null, arguments);
    };
  }

  // --- observers
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.long.push([+e.startTime.toFixed(1), +e.duration.toFixed(1)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.paints.push([e.name, +e.startTime.toFixed(1)]); }).observe({ type: 'paint', buffered: true }); } catch (e) {}

  // --- timed wrappers on the app's init/apply passes (setter trick from scripts/verify/boot.mjs)
  const NAMES = cfg.wrap || [];
  for (const name of NAMES) {
    let real;
    try {
      Object.defineProperty(window, name, { configurable: true, get() { return real; }, set(fn) {
        if (typeof fn !== 'function') { real = fn; return; }
        real = function () {
          const s = performance.now(); let out;
          try { out = fn.apply(this, arguments); } finally { P.calls.push([name, +s.toFixed(1), +(performance.now() - s).toFixed(1)]); }
          return out;
        };
      } });
    } catch (e) {}
  }

  // --- the map: first render, idle, per-source first loaded
  let _m;
  Object.defineProperty(window, '__map', { configurable: true, get() { return _m; }, set(v) {
    _m = v;
    try {
      mark('mapCreated');
      v.once('render', () => mark('mapFirstRender'));
      v.once('idle', () => mark('mapFirstIdle'));
      v.on('sourcedata', e => { if (e.sourceId && e.isSourceLoaded && P.src[e.sourceId] == null) P.src[e.sourceId] = now(); });
      v.once('load', () => mark('mapLoad'));
    } catch (e) {}
  } });

  // --- state poller: reveal, apartments, veil
  const poll = setInterval(() => {
    try {
      if (window.__intro && window.__intro.reason) mark('introReveal');
      if (window.slopesApartments && window.slopesApartments.count.done) mark('apartmentsDone');
      if (window.slopesApartments && window.slopesApartments.readyToReveal && window.slopesApartments.readyToReveal()) mark('apartmentsReady');
      if (P.marks.introReveal && !document.getElementById('veil')) mark('veilGone');
      if (window.__loading && window.__loading.complete) mark('loaderComplete');
    } catch (e) {}
  }, 25);
  P.stopPoll = () => clearInterval(poll);

  // --- fetch times (page side only; workers are seen by the CDP Network domain)
  const realFetch = window.fetch;
  window.fetch = function (input) {
    const url = String((input && input.url) || input), s = performance.now();
    return realFetch.apply(this, arguments).then(r => { P.fetches.push([url.slice(-80), +s.toFixed(0), +(performance.now() - s).toFixed(0)]); return r; });
  };

  // --- frame log
  let last = 0;
  const raf = (ts) => {
    if (last && P.frames.length < 200000) P.frames.push(+(ts - last).toFixed(1));
    last = ts;
    if (P.gl) { P.gl.perFrame.length < 200000 && P.gl.perFrame.push([P.gl.frameDraws, P.gl.frameTris]); P.gl.frameDraws = 0; P.gl.frameTris = 0; }
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  // --- WebGL accounting (counts calls; sizes are what the page asked for, not what a driver rounds to)
  const GLP = [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean);
  const G = P.gl;
  const owner = () => {
    const st = (new Error().stack || '').split('\n');
    for (const l of st) { const m = l.match(/\/(js\/[\w.-]+\.js)/); if (m) return m[1]; }
    for (const l of st) { if (/maplibre/.test(l)) return 'maplibre'; if (/three/.test(l)) return 'three'; }
    return 'other';
  };
  const CH = { 6408: 4, 6407: 3, 6406: 1, 6409: 1, 6410: 2, 33319: 2, 36244: 1, 36248: 3, 36249: 4, 6402: 1, 34041: 1, 33320: 2 };
  const own = (o, kind, bytes) => { const e = G.own[o] || (G.own[o] = { tex: 0, buf: 0, rb: 0 }); e[kind] += bytes; };
  const tex = new WeakMap(), buf = new WeakMap(), rb = new WeakMap();
  const cnt = (n) => { G.calls[n] = (G.calls[n] || 0) + 1; };
  const tris = (mode, n) => mode === 4 ? n / 3 : (mode === 5 || mode === 6) ? Math.max(0, n - 2) : 0;
  for (const proto of GLP.map(c => c.prototype)) {
    const w = (name, fn) => { const real = proto[name]; if (!real || real.__perf) return; const f = function () { return fn.call(this, real, arguments); }; f.__perf = 1; proto[name] = f; };
    w('drawElements', function (real, a) { G.draws++; G.frameDraws++; const t = tris(a[0], a[1]); G.tris += t; G.frameTris += t; return real.apply(this, a); });
    w('drawArrays', function (real, a) { G.draws++; G.frameDraws++; const t = tris(a[0], a[2]); G.tris += t; G.frameTris += t; return real.apply(this, a); });
    w('drawElementsInstanced', function (real, a) { G.draws++; G.frameDraws++; const t = tris(a[0], a[1]) * a[4]; G.tris += t; G.frameTris += t; return real.apply(this, a); });
    w('drawArraysInstanced', function (real, a) { G.draws++; G.frameDraws++; const t = tris(a[0], a[2]) * a[3]; G.tris += t; G.frameTris += t; return real.apply(this, a); });
    w('texImage2D', function (real, a) {
      const level = a[1];
      if (level === 0) {
        let wd, ht, fmt, type;
        if (a.length >= 9) { wd = a[3]; ht = a[4]; fmt = a[6]; type = a[7]; }
        else { const s = a[5]; wd = s && (s.width || s.videoWidth); ht = s && (s.height || s.videoHeight); fmt = a[3]; type = a[4]; }
        const ch = CH[fmt] || 4, tb = type === 5126 ? 4 : (type === 5131 || type === 36193 || type === 5123) ? 2 : (type === 5125 || type === 34042) ? 4 : 1;
        const bytes = Math.round((wd || 0) * (ht || 0) * ch * (type === 5121 || type == null ? 1 : tb) * 1.333);   // x1.333: mip chain, when one is built
        const target = a[0], t = this.getParameter(target === 34067 || (target >= 34069 && target <= 34074) ? 34068 : 32873);
        const prev = t && tex.get(t); const o = owner();
        if (prev) { G.texBytes -= prev.bytes; own(prev.o, 'tex', -prev.bytes); }
        if (t) tex.set(t, { bytes, o });
        G.texBytes += bytes; own(o, 'tex', bytes); G.peak.tex = Math.max(G.peak.tex, G.texBytes); cnt('texImage2D');
      }
      return real.apply(this, a);
    });
    w('texStorage2D', function (real, a) {
      const bytes = Math.round(a[3] * a[4] * 4 * (a[1] > 1 ? 1.333 : 1)), o = owner();   // 4 bytes a pixel assumed
      const t = this.getParameter(a[0] === 34067 ? 34068 : 32873); if (t) tex.set(t, { bytes, o });
      G.texBytes += bytes; own(o, 'tex', bytes); G.peak.tex = Math.max(G.peak.tex, G.texBytes); cnt('texStorage2D');
      return real.apply(this, a);
    });
    w('deleteTexture', function (real, a) { const e = tex.get(a[0]); if (e) { G.texBytes -= e.bytes; own(e.o, 'tex', -e.bytes); tex.delete(a[0]); } return real.apply(this, a); });
    w('bufferData', function (real, a) {
      const target = a[0], size = typeof a[1] === 'number' ? a[1] : (a[1] && a[1].byteLength) || 0;
      const b = this.getParameter(target === 34962 ? 34964 : target === 34963 ? 34965 : 34964);
      const o = owner();
      if (b) { const prev = buf.get(b); if (prev) { G.bufBytes -= prev.bytes; own(prev.o, 'buf', -prev.bytes); } buf.set(b, { bytes: size, o }); }
      G.bufBytes += size; own(o, 'buf', size); G.peak.buf = Math.max(G.peak.buf, G.bufBytes); cnt('bufferData');
      return real.apply(this, a);
    });
    w('deleteBuffer', function (real, a) { const e = buf.get(a[0]); if (e) { G.bufBytes -= e.bytes; own(e.o, 'buf', -e.bytes); buf.delete(a[0]); } return real.apply(this, a); });
  }
})();
