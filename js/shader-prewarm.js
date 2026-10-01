/**
 * shader-prewarm.js — compile every shader the city will need at second one,
 * in parallel, so that nobody waits for one later.
 *
 * WHAT WAS WAITING. On Windows, Chrome runs WebGL on ANGLE over Direct3D 11:
 * each GLSL program is translated to HLSL and compiled by Microsoft's FXC. The
 * app links 42 programs before the loading screen lifts, and every library that
 * links one asks for the result straight away (MapLibre checks LINK_STATUS on
 * the next line, js/city-lighting.js does too, three.js reads the info log on
 * first use). So the main thread sat blocked for each compile, one after the
 * other: 9.2 s in all on the AMD Radeon iGPU, cold profile, in blocks of
 * 0.25-0.9 s. The worst were the nine fill-extrusion programs that carry the
 * city-lighting code (0.25-0.91 s each, 5.5 s together) and the four big
 * slopes-mesh materials (0.50-0.59 s each).
 *
 * THE TRICK. The GPU process keeps a program cache keyed by the exact source
 * text. Measured on the same machine, linking a source it has linked before
 * costs 6-12 ms instead of 250-850 ms, and programs issued together under
 * KHR_parallel_shader_compile compile side by side on worker threads (11
 * programs whose serial cost is 3.3 s all finished in 0.9 s). So this file
 * replays the exact source of every program the app is going to link
 * (data/shader-manifest.json, recorded from a real load) the moment the map's
 * GL context exists, and never asks for a result. The compiles overlap the data
 * download and parsing; when MapLibre, three.js and the lighting adapter link
 * the same text seconds later, the cache answers.
 *
 * WHY IT CANNOT CHANGE THE PICTURE. The throwaway programs are never used for
 * drawing. The app still compiles and links its own programs from its own
 * source; the only thing this changes is whether the GPU process finds the
 * answer already in its cache. A stale manifest (a shader edited since the
 * bake) costs the old wait for that program and nothing else.
 *
 * KEEPING IT FRESH. `node scripts/verify/shader-manifest.mjs` loads the app and
 * reports which linked programs the manifest missed; `--write` re-records it.
 * Re-run it after editing any shader (city-lighting.js, slopes.js materials,
 * sky.js) or bumping MapLibre or three.js.
 *
 * It calls the WebGL2 prototype methods directly, because js/city-lighting.js
 * wraps shaderSource/compileShader/linkProgram on the map's context and would
 * otherwise rewrite the (already rewritten) recorded source a second time.
 *
 * ?prewarm=0 turns it off. Every knob is in SHADER_PREWARM below.
 */
(function () {
  'use strict';
  const P = window.SHADER_PREWARM = Object.assign({
    on: true,
    manifest: 'data/shader-manifest.json',
    // Phones were not measured (no ANGLE/FXC there, and the lite profile links
    // different programs), so the phone profile stays as it was.
    phone: false,
    // The throwaway programs are deleted once they report complete. First look
    // after this long, then every retryMs, one non-blocking status read each.
    cleanupMs: 20000,
    retryMs: 5000,
  }, window.SHADER_PREWARM || {});

  const q = new URLSearchParams(location.search);
  const stats = { state: 'idle', programs: 0, issueMs: null, startedAt: null, deleted: 0, skipped: null };
  const off = q.get('prewarm') === '0' || !P.on ||
    (!P.phone && window.LITE_PROFILE && window.LITE_PROFILE.budget);
  // Start the fetch at parse time: it only has to beat the map constructor.
  const manifest = off ? null : fetch(P.manifest).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (off) stats.skipped = 'off';

  const G = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  const COMPLETION_STATUS_KHR = 0x91B1;

  function issue(gl, m) {
    if (!m || !Array.isArray(m.progs) || !Array.isArray(m.lines)) { stats.skipped = 'no manifest'; return; }
    if (!G || !(gl instanceof WebGL2RenderingContext) || gl.isContextLost()) { stats.skipped = 'no webgl2 context'; return; }
    // Without the extension the compiles would run one by one on the GPU
    // process's main thread and hold up everything queued behind them.
    if (!gl.getExtension('KHR_parallel_shader_compile')) { stats.skipped = 'no KHR_parallel_shader_compile'; return; }
    const t0 = performance.now();
    const text = idx => idx.map(i => m.lines[i]).join('\n');
    const live = [];
    for (const p of m.progs) {
      const prog = G.createProgram.call(gl);
      const fs = G.createShader.call(gl, gl.FRAGMENT_SHADER), vs = G.createShader.call(gl, gl.VERTEX_SHADER);
      if (!prog || !fs || !vs) break;                       // context lost mid-way
      G.shaderSource.call(gl, fs, text(p.f)); G.compileShader.call(gl, fs);
      G.shaderSource.call(gl, vs, text(p.v)); G.compileShader.call(gl, vs);
      G.attachShader.call(gl, prog, fs); G.attachShader.call(gl, prog, vs);
      for (const [i, name] of p.a || []) G.bindAttribLocation.call(gl, prog, i, name);
      G.linkProgram.call(gl, prog);
      live.push([prog, vs, fs]);
    }
    stats.programs = live.length;
    stats.issueMs = Math.round((performance.now() - t0) * 10) / 10;
    stats.startedAt = Math.round(t0);
    stats.state = 'compiling';
    // Delete only what has finished: deleting a program mid-link would make the
    // GPU process wait for it. COMPLETION_STATUS_KHR never blocks on the compile.
    const sweep = () => {
      if (gl.isContextLost()) { live.length = 0; stats.state = 'context lost'; return; }
      for (let i = live.length - 1; i >= 0; i--) {
        const [prog, vs, fs] = live[i];
        if (!G.getProgramParameter.call(gl, prog, COMPLETION_STATUS_KHR)) continue;
        G.deleteProgram.call(gl, prog); G.deleteShader.call(gl, vs); G.deleteShader.call(gl, fs);
        live.splice(i, 1); stats.deleted++;
      }
      if (live.length) setTimeout(sweep, P.retryMs); else stats.state = 'done';
    };
    setTimeout(sweep, P.cleanupMs);
  }

  window.ShaderPrewarm = {
    stats,
    // Called by js/app.js right after the Map is constructed (its GL context exists then).
    start(map) {
      if (!manifest || stats.state !== 'idle') return;
      stats.state = 'waiting for manifest';
      let gl = null;
      try { gl = map.painter.context.gl; } catch (e) { stats.skipped = 'no map context'; return; }
      manifest.then(m => { try { issue(gl, m); } catch (e) { stats.skipped = 'error: ' + e.message; } });
    },
  };
})();
