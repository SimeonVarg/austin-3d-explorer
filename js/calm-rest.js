/**
 * frame-target.js - the last step of every frame. Two jobs, both against shimmer on EDGES (outlines, fins, rails, trees):
 *
 * 1. SMOOTH EDGES WITHOUT A RELOAD. `antialias` is fixed when a WebGL context is made, so the setting used to need a
 *    reload. Here the map's frame is drawn into OUR multisampled framebuffer and resolved onto the canvas: while
 *    MapLibre paints (painter.render), "bind the default framebuffer" binds ours. On or off is then a live switch,
 *    and off costs nothing (no redirect, the page draws straight to the canvas as before).
 *
 * 2. A STILL CAMERA CONVERGES TO A SUPERSAMPLED PICTURE, THEN THE PAGE STOPS DRAWING. Once the camera and the
 *    content have been quiet for REST.delayMs, each frame is drawn with the lens shifted by a fraction of a pixel
 *    (map padding: an exact translation at every depth; the same 16 shifts scripts/verify/moire-bar.mjs builds its
 *    truth from), the frames are averaged in a float buffer, and the running mean is what the canvas shows. After
 *    the last shift nothing more is asked for. The shift exists only while MapLibre paints: outside a frame the
 *    map's camera and padding are the real ones.
 *
 *    THE RESET RULE (Rest below; no browser needed, scripts/verify/rest-rule.mjs holds it):
 *      - a frame at another camera, canvas size or padding, or while the map moves, loads or fades labels: PLAIN
 *        (drawn and shown as before), the mean is void, and the wait starts again;
 *      - a frame somebody else asked for (map.triggerRepaint / redraw: data arrived, the hour changed, a layer
 *        animates): the same. MapLibre's own "check the labels again" repaints are not a change and do not reset;
 *      - a cycle broken REST.maxBreaks times in a row at one camera stops trying until the camera moves;
 *      - an animation that redraws a parked page (window twinkle) calls FrameTarget.soft() before its
 *        triggerRepaint: that frame keeps the shifts cycling and enters the mean with weight REST.softAlpha once
 *        converged, so edges stay converged while the content moves. Without the call it is an ordinary reset.
 *    `idle` is held back while a cycle is waiting or running, so "idle" still means "this is the final picture".
 *
 * Switches: ?smooth=1|0 (js/graphics.js), ?smoothfb=0 (Smooth edges as the context's own antialias, with a reload,
 * as before), ?restaccum=1|0, ?restn=4|8|16. Everything tunable is in SMOOTH and REST. window.FrameTarget.stats
 * counts frames by kind.
 */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  const Q = new URLSearchParams((G.location && G.location.search) || '');
  const flag = k => Q.get(k) === '1' ? true : Q.get(k) === '0' ? false : null;

  // ---- everything you may want to change -----------------------------------
  const SMOOTH = {
    ownTarget: flag('smoothfb') !== false,   // false: the context's own antialias (reload to change), as before
    samples: 4,                              // samples a pixel in our framebuffer (capped by the GPU's MAX_SAMPLES)
  };
  const REST = {
    on: false,                   // null = decide by device (restDefault below)
    // The lens shifts, in pixels, as cells of a 4x4 grid: (cell + 0.5) / 4 - 0.5. Opposite cells follow each
    // other, so every even prefix is centred (the picture never drifts), and the first 4 and 8 are well spread:
    // a slow device stops there (count below).
    grid: 4,
    order: [[0, 1], [3, 2], [1, 3], [2, 0], [1, 1], [2, 2], [0, 3], [3, 0], [0, 2], [3, 1], [1, 0], [2, 3], [1, 2], [2, 1], [0, 0], [3, 3]],
    count: +Q.get('restn') || 16,            // shifts averaged (a prefix of `order`)
    slowMs: [Infinity, Infinity],                      // frames slower than this take 8, slower than the second take 4
    delayMs: 250,                            // quiet time before the first shifted frame
    maxBreaks: 5,                            // cycles broken in a row at one camera before giving up there
    softAlpha: 0.25,                         // weight of a soft frame once converged
    pollMax: 150,                            // waits on a map that stays busy without drawing, then stop asking
    // no accumulation on a software rasteriser: a frame costs seconds there (and CI's exact pixels stay as they are)
    software: /swiftshader|llvmpipe|software|basic render/i,
  };
  // ----------------------------------------------------------------------------

  // THE RESET RULE, as plain state. begin() before a frame is painted, end() after; start() when the wait is over.
  function makeRest(P) {
    const S = { phase: 'plain', key: null, cam: null, n: 0, idx: 0, breaks: 0, asked: 0, soft: 0, kind: 'plain', hard: true, count: P.count };
    const off = k => { const c = P.order[k % S.count]; return [(c[0] + 0.5) / P.grid - 0.5, (c[1] + 0.5) / P.grid - 0.5]; };
    return {
      S, offset: off,
      asked() { S.asked++; },                // somebody outside asked for a frame
      why: null,                             // set by begin(): 'cam', 'asked', or null (quiet is the caller's)
      soft() { S.soft++; },                  // ... and said it is an animation of the content, not a new picture
      begin(cam, quiet, on) {
        const soft = S.soft > 0 && S.asked <= S.soft;
        S.hard = !quiet || cam !== S.key || (S.asked > 0 && !soft);
        this.why = cam !== S.key ? 'cam' : S.asked > 0 && !soft ? 'asked' : null;
        S.asked = S.soft = 0; S.cam = cam; S.softOnly = soft && !S.hard;
        S.kind = 'plain';
        if (on && quiet && cam === S.key) {
          if (S.phase === 'cycle' && (S.n === 0 || !S.hard)) S.kind = 'sample';
          else if (S.phase === 'done' && !S.hard) S.kind = soft ? 'soft' : 'hold';
        }
        return S.kind === 'sample' || S.kind === 'soft' ? off(S.idx) : null;
      },
      // -> { weight: share of this frame in the mean (0 = not added), mean: show the mean (else the frame itself),
      //      again: ask for the next frame now, wait: ms to wait before start() (0 none, -1 keep the running wait) }
      end(on) {
        const k = S.kind;
        if (k === 'sample') {
          S.n++; S.idx++;
          const done = S.n >= S.count;
          if (done) { S.phase = 'done'; S.breaks = 0; }
          return { weight: 1 / S.n, mean: true, again: !done, wait: 0 };
        }
        if (k === 'soft') { S.idx++; return { weight: P.softAlpha, mean: true, again: false, wait: 0 }; }
        if (k === 'hold') return { weight: 0, mean: true, again: false, wait: 0 };
        const same = S.cam === S.key, was = S.phase;
        if (!same) S.breaks = 0; else if (was === 'cycle' && S.n > 0) S.breaks++;
        S.key = S.cam; S.n = 0; S.phase = 'plain';
        if (!on || S.breaks >= P.maxBreaks) return { weight: 0, mean: false, again: false, wait: 0 };
        S.phase = 'wait';
        // only a real change restarts the wait: MapLibre's label re-checks and soft frames leave it running
        return { weight: 0, mean: false, again: false, wait: was === 'wait' && !S.hard ? -1 : P.delayMs * Math.pow(2, S.breaks) };
      },
      start(count) { if (S.phase !== 'wait') return false; S.phase = 'cycle'; S.n = 0; S.count = Math.min(P.order.length, count || P.count); return true; },
      stop() { S.phase = 'plain'; S.n = 0; S.key = null; },
    };
  }

  // frames by kind; `why` counts what made a frame plain (cam, asked, moving, loading, veil, fading); `who` (with
  // FrameTarget.trace = true) counts the callers that asked for a frame
  const stats = { frames: 0, plain: 0, sample: 0, soft: 0, hold: 0, cycles: 0, done: 0, breaks: 0, sinceDone: 0, msaa: 0, frameMs: 0, why: {}, who: {} };
  const FT = G.FrameTarget = { SMOOTH, REST, makeRest, stats, smooth: false, attached: false,
    shifted: false,                          // true while a lens-shifted frame is being painted: same camera, do not treat the matrix as a move
    own: () => SMOOTH.ownTarget && typeof WebGL2RenderingContext !== 'undefined',
    soft() { if (rule) rule.soft(); }, state: () => rule ? rule.S.phase : 'off', smoothOn: () => !!(FT.smooth && ms),
    setSmooth(on) { if (!FT.own()) return; on = !!on; if (on === FT.smooth) return; FT.smooth = on; if (!on) dropMs(); if (rule) rule.asked(); if (map && native) native.trigger.call(map); },
    setRest(on) { on = !!on; if (on === REST.on) return; REST.on = on; if (rule) { rule.asked(); if (!on) { rule.stop(); clearTimeout(timer); timer = null; } } if (map && native) native.trigger.call(map); },
  };
  let map = null, gl = null, native = null, rule = null, timer = null, polls = 0;
  let redirect = null, ms = null, tex = null, acc = null, prog = null, vao = null, uTex = null, accBad = false;
  let tail = false, base = null, lastBegin = 0, restOK = null, backToBack = false;

  function restDefault() {
    if (REST.on != null) return REST.on;
    if (restOK == null) {
      const lite = G.LITE_PROFILE || {};
      let r = '';
      try { const e = gl.getExtension('WEBGL_debug_renderer_info'); r = String((e && gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ''); } catch (e) {}
      restOK = !REST.software.test(r) && (!lite.on || !!(lite.budget && lite.budget.restAccum));
    }
    return restOK;
  }

  // ---- GL objects ----------------------------------------------------------
  function dropMs() {
    if (!ms || !gl) { ms = null; return; }
    gl.deleteFramebuffer(ms.fbo); gl.deleteRenderbuffer(ms.color); gl.deleteRenderbuffer(ms.depth); ms = null;
  }
  function ensureMs(W, H) {
    if (ms && ms.w === W && ms.h === H) return true;
    if (ms && ms.bad) return false;
    dropMs();
    const n = Math.min(SMOOTH.samples, gl.getParameter(gl.MAX_SAMPLES) || 0);
    if (n < 2) { ms = { bad: true }; return false; }
    const color = gl.createRenderbuffer(), depth = gl.createRenderbuffer(), fbo = gl.createFramebuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.RGBA8, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.DEPTH24_STENCIL8, W, H);
    native.bind.call(gl, gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    native.bind.call(gl, gl.FRAMEBUFFER, null);
    dirty();
    if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); ms = { bad: true }; return false; }
    ms = { fbo, color, depth, w: W, h: H, n };
    return true;
  }
  function target(old, W, H, internal) {
    if (old && old.w === W && old.h === H) return old;
    if (old) { gl.deleteFramebuffer(old.fbo); gl.deleteTexture(old.t); }
    const t = gl.createTexture(), fbo = gl.createFramebuffer();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, W, H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    native.bind.call(gl, gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(t); return null; }
    return { fbo, t, w: W, h: H };
  }
  function ensureAcc(W, H) {
    if (accBad) return false;
    if (!prog) {
      if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) { accBad = true; return false; }
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.-1.,float(gl_VertexID&2)*2.-1.,0.,1.);}'));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;uniform highp sampler2D t;out vec4 o;void main(){o=texelFetch(t,ivec2(gl_FragCoord.xy),0);}'));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { accBad = true; prog = null; return false; }
      uTex = gl.getUniformLocation(prog, 't'); vao = gl.createVertexArray();
    }
    tex = target(tex, W, H, gl.RGBA8); acc = tex && target(acc, W, H, gl.RGBA16F);
    if (!tex || !acc) accBad = true;
    return !accBad;
  }
  // our passes leave MapLibre's cached GL state wrong: tell it, as it does itself after a custom layer
  function dirty() { try { map.painter.context.setDirty(); } catch (e) {} }

  function camKey(W, H) {
    const c = map.getCenter(), p = base;
    return [c.lng, c.lat, map.getZoom(), map.getPitch(), map.getBearing(), map.getVerticalFieldOfView ? map.getVerticalFieldOfView() : 0,
      map.getRoll ? map.getRoll() : 0, W, H, p.top, p.bottom, p.left, p.right].join(',');
  }
  let unquiet = null;
  function quiet() {
    const pl = map.style && map.style.placement;                 // labels fading in or out are a change of the picture
    unquiet = map.isMoving() ? 'moving' : !map.loaded() ? 'loading' : document.getElementById('veil') || document.hidden ? 'veil'
      : pl && pl.fadeDuration && performance.now() - pl.lastPlacementChangeTime < pl.fadeDuration ? 'fading' : null;
    return !unquiet;
  }
  function wait(ms_) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!rule || rule.S.phase !== 'wait') return;
      if (!quiet()) {                                              // busy without drawing: look again, and in the end let go
        if (++polls <= REST.pollMax) wait(REST.delayMs * 2);
        else { rule.S.phase = 'plain'; if (map.loaded() && !map.isMoving()) native.fire.call(map, 'idle'); }
        return;
      }
      const f = stats.frameMs;
      if (rule.start(f > REST.slowMs[1] ? 4 : f > REST.slowMs[0] ? 8 : REST.count)) { stats.cycles++; native.trigger.call(map); }
    }, ms_);
  }

  // ---- the frame -----------------------------------------------------------
  let useMs = false, shifted = false, edge = null;
  function begin() {
    useMs = shifted = false;
    if (!gl || gl.isContextLost()) return;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, now = performance.now();
    // a frame's cost: the gap between frames drawn back to back (our own cycle, or the map in motion)
    if (lastBegin && (backToBack || map.isMoving()) && now - lastBegin < 1000) stats.frameMs = stats.frameMs ? stats.frameMs * 0.7 + (now - lastBegin) * 0.3 : now - lastBegin;
    lastBegin = now;
    const tr = map.transform;
    base = tr.padding;
    const on = restDefault() && !accBad, q = quiet(), j = rule.begin(camKey(W, H), on && q, on);
    if (on && rule.S.kind === 'plain') { const w = rule.why || unquiet || 'wait'; stats.why[w] = (stats.why[w] || 0) + 1; }
    if (j) {
      const r = map.getPixelRatio(), dx = 2 * j[0] / r, dy = 2 * j[1] / r;
      tr.setPadding({ left: base.left + Math.max(0, dx), right: base.right + Math.max(0, -dx), top: base.top + Math.max(0, dy), bottom: base.bottom + Math.max(0, -dy) });
      shifted = FT.shifted = true;
    }
    if (FT.smooth && !document.getElementById('veil') && ensureMs(W, H)) {
      useMs = true; redirect = ms.fbo; native.bind.call(gl, gl.FRAMEBUFFER, ms.fbo);
    }
  }
  function end() {
    if (!gl || gl.isContextLost()) { redirect = null; return; }
    if (shifted) { map.transform.setPadding(base); FT.shifted = false; }
    redirect = null;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, on = restDefault() && !accBad;
    const a = rule.end(on), k = rule.S.kind;
    stats.frames++; stats[k]++; if (useMs) stats.msaa++;
    stats.sinceDone = rule.S.phase === 'done' ? (k === 'sample' ? 0 : stats.sinceDone + 1) : 0;
    if (k === 'sample' && rule.S.phase === 'done') stats.done++;
    if (k === 'plain' && rule.S.breaks) stats.breaks = rule.S.breaks;
    if(!a.mean&&!useMs&&G.Calm?.TUNE.edge&&G.CalmEdge){
      edge=edge||G.CalmEdge.create(gl,native.bind,dirty);edge.draw(W,H);FT.edgeStats=edge.stats;
    }
    // No edge filter: native moving path does not query/change GPU state.
    if (!a.mean && !useMs) {
      backToBack=false;
      if(a.wait>0){polls=0;wait(a.wait);}else if(a.wait===0){clearTimeout(timer);timer=null;}
      return;
    }
    const sc = gl.isEnabled(gl.SCISSOR_TEST);
    if (sc) gl.disable(gl.SCISSOR_TEST);
    if (a.mean && ensureAcc(W, H)) {
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE); gl.colorMask(true, true, true, true);
      gl.viewport(0, 0, W, H); gl.useProgram(prog); gl.bindVertexArray(vao); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(uTex, 0);
      if (a.weight > 0) {
        // the frame -> a texture (resolving our multisampled buffer, or copying the canvas's), then into the mean
        native.bind.call(gl, gl.READ_FRAMEBUFFER, useMs ? ms.fbo : null); native.bind.call(gl, gl.DRAW_FRAMEBUFFER, tex.fbo);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        native.bind.call(gl, gl.FRAMEBUFFER, acc.fbo);
        gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendColor(0, 0, 0, a.weight); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      native.bind.call(gl, gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND); gl.bindTexture(gl.TEXTURE_2D, acc.t); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, null); gl.bindVertexArray(null);
      dirty();
    } else if (useMs) {
      native.bind.call(gl, gl.READ_FRAMEBUFFER, ms.fbo); native.bind.call(gl, gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      native.bind.call(gl, gl.FRAMEBUFFER, null);
    }
    if (sc) gl.enable(gl.SCISSOR_TEST);
    backToBack = a.again;
    if (a.again) native.trigger.call(map);
    if (a.wait > 0) { polls = 0; wait(a.wait); } else if (a.wait === 0) { clearTimeout(timer); timer = null; }
  }
  const busy = () => timer != null || (rule && rule.S.phase === 'cycle');

  FT.attach = function (m) {
    try {
      const g = m.painter.context.gl, tr = m.transform;
      if (!(typeof WebGL2RenderingContext !== 'undefined' && g instanceof WebGL2RenderingContext) || typeof m.painter.render !== 'function' ||
          typeof tr.setPadding !== 'function' || !tr.padding) return false;
      map = m; gl = g; rule = makeRest(REST);
      native = { bind: g.bindFramebuffer, drawBuffers: g.drawBuffers, readBuffer: g.readBuffer, render: m.painter.render, trigger: m.triggerRepaint, redraw: m.redraw, fire: m.fire };
      // inside a frame the default framebuffer is ours; BACK is then our colour attachment
      g.bindFramebuffer = function (t, fb) { return native.bind.call(this, t, fb || redirect); };
      g.drawBuffers = function (b) { return native.drawBuffers.call(this, redirect && b && b.length === 1 && b[0] === g.BACK ? [g.COLOR_ATTACHMENT0] : b); };
      g.readBuffer = function (s) { return native.readBuffer.call(this, redirect && s === g.BACK ? g.COLOR_ATTACHMENT0 : s); };
      m.painter.render = function () { begin(); try { return native.render.apply(this, arguments); } finally { end(); } };
      // Who asked for the next frame? MapLibre's own request at the end of a frame that only wants to check the
      // labels again (nothing dirty but the placement) is not a change of the picture; everything else is.
      m.triggerRepaint = function () {
        if (!(tail && !this._sourcesDirty && !this._styleDirty && !this._repaint)) {
          rule.asked();
          if (FT.trace) { const w = tail ? 'maplibre:' + (this._sourcesDirty ? 'sources' : this._styleDirty ? 'style' : 'repaint') : String(new Error().stack).split('\n').slice(2, 4).map(l => l.replace(/^.*\/|\)$/g, '')).join(' < '); stats.who[w] = (stats.who[w] || 0) + 1; }
        }
        tail = false; return native.trigger.call(this);
      };
      m.redraw = function () { rule.asked(); return native.redraw.apply(this, arguments); };
      m.fire = function (e) {
        const type = typeof e === 'string' ? e : e && e.type;
        if (type === 'idle' && busy()) return this;
        const r = native.fire.apply(this, arguments);
        if (type === 'render') { tail = true; Promise.resolve().then(() => { tail = false; }); }
        return r;
      };
      g.canvas.addEventListener('webglcontextlost', () => { ms = tex = acc = prog = vao = null; edge?.lost();redirect = null; rule.stop(); clearTimeout(timer); timer = null; });
      FT.attached = true;
    } catch (e) { map = gl = null; return false; }
    return true;
  };
})();
