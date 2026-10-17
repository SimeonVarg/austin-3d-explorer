/**
 * layer-cost.mjs — WHERE does the Blender-building layer's (?gltf=1) frame time go? (written 2026-10-16, branch mac/gltf-layer-cost;
 * a measurement tool, no verdict). layer-speed.mjs says HOW MUCH it costs (two page loads, layer off and on); this says WHICH PART.
 *
 * ONE page load with the layer on (CLAUDE.md rule 13: load once, test many). At each pose the parts of the layer are switched
 * off one at a time from inside the page, the variants interleaved and their order rotated round by round, and for each:
 *   free     the interval between two requestAnimationFrame callbacks, vsync off (p50 over the pass)
 *   cpu      the JS time of the city's three.js layer a frame (window.slopes.layer prerender + render, performance.now around
 *            each): the main thread's own work, the layer's smoothing pass included (WebGL calls are queued, so this is the
 *            JS and the call encoding, not the GPU)
 *   gpu      GPU time of the same two calls (EXT_disjoint_timer_query_webgl2, when the browser has it; null when not)
 *   own      the layer's smoothing pass alone, JS time (GLTF_LAYER.lookOwn.ms)
 *   calls / tris   three.js's draw calls and triangles a frame (renderer.info, summed over every render() of the frame)
 * The variants (each undone before the next):
 *   on         as loaded
 *   off        every full building and every far copy hidden: the layer's whole cost (its hidden recipe buildings stay hidden)
 *   noOwn      the smoothing pass skipped (picture, depth, lay and glass passes); the shadow casters stay
 *   noCast     the shadow casters hidden in the city's own pass (they draw nothing there; the shadow maps are not redrawn
 *              while the camera only turns, so this is their cost in the main pass)
 *   cheap      every full building's picture and glass drawn with a one-colour shader: the cost of the layer's shading
 *   shrink     the same picture draws into boxes 2 % of the size (GLTF_LAYER.lookOwn.shrink): the picture pass's pixels
 *   noPicture  the picture pass draws nothing (its target is still cleared and resolved)
 *   noLay      the depth pass and the lay pass draw nothing
 *   noGlass    the see-through glass pass draws nothing
 *   farOff     the far treatment off (4 samples a pixel at the canvas's pixels for every box)
 *   atlasBig   the atlas with targets of up to 256 MB a sample count (fewer flushes, more memory); atlas128, atlas64 likewise
 *   atlasOff   one building at a time (GLTF.look.own.atlas off: two render calls a building, as before the atlas). With the atlas ON
 *              the variants cheap, noPicture, noLay and noGlass do not reach the drawing (they swap the per-building scenes): pass
 *              --query gltfatlas=0 for them.
 *   copies     every row drawn as its far copy (GLTF.look.copy distances set to zero): the floor a level of detail could reach
 *   farNNN     (any number, 2026-10-16) the far copy alone from NNN metres on the owner's 1440 x 900 window, the full building alone
 *              from the same share of it as now (`?gltffardist=NNN`, js/gltf-layer.js); `on` is the default, about 800 m
 * Every variant change jumps each row straight to its new share of full building (the dissolve's `fadeS` is 0 for 1.2 s), so a
 * pass never times a dissolve left over from the variant before.
 * Plus, once per pose with the layer as loaded, a CPU profile of the main thread (2 s, 1 ms sampling) and the share of it in
 * the layer's own functions.
 *
 * SETTINGS (printed): --gl hardware, desktop 1280x800 DPR 1.5 or --phone (390x844 DPR 3, mobile emulation, iPhone user agent:
 * SIMULATED, the GPU is the runner's), --throttle N (CDP CPU throttle: SIMULATED), ?intro=0&drift=0, vsync off, the auto-detect
 * probe cancelled. A reading is the MINIMUM over rounds (CLAUDE.md rule 10), every round shown.
 *
 * --shots POSE[,POSE..] --shot-ab A,B[,C..]: pictures instead of timing (up to 5 variants, each against the first).
 * --motion POSE[,POSE..] --motion-ab A,B[,C..]: for each pose and variant a few seconds of the camera flying forward in REAL time,
 *   recorded as a screencast (jpeg frames, `motion-POSE-VARIANT/`), with a log a frame of how many buildings are dissolving between
 *   their full model and their far copy and the largest change of one building's share in one frame (a pop would be a share of 1 in
 *   one frame; the dissolve allows dt / fadeS).
 *
 *   node scripts/perf/layer-cost.mjs --url http://127.0.0.1:8442/ --rounds 4 --out DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { startChrome, machineLoad } from './lib/cdp.mjs';
import { analyse } from './lib/cpuprofile.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const GL = arg('--gl', 'hardware');
const PHONE = argv.includes('--phone');
const THROTTLE = +arg('--throttle', 1);
const ROUNDS = +arg('--rounds', 4);
const FRAMES = +arg('--frames', 40);
const WARM = +arg('--warm', 12);
const LABEL = arg('--label', 'layer-cost');
const OUT = arg('--out', process.env.VERIFY_OUT || path.join(process.env.TMPDIR || '/tmp', 'layer-cost'));
const SETTLE = +arg('--settle', 15000);
const MAX = +arg('--max', 600000);
const DEADLINE_MIN = +arg('--deadline-min', 0);
const EXTRA = arg('--query', '');
const VARIANTS = arg('--variants', 'on,off,noOwn,noCast,cheap,shrink,noPicture,noLay,noGlass,farOff,copies').split(',');
const T_START = Date.now();
fs.mkdirSync(OUT, { recursive: true });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the same cameras as layer-speed.mjs
const POSES = {
  'spawn':       { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
  'start-close': { center: [-97.7434, 30.2857], zoom: 18.6, pitch: 70, bearing: 250 },
  'west-campus': { center: [-97.7445, 30.2880], zoom: 16.6, pitch: 72, bearing: 300 },
  'union-close': { center: [-97.74286, 30.28333], zoom: 18.4, pitch: 68, bearing: 280 },
  // pictures only (not in the timing list): on Guadalupe at about 17 m up, looking north with West Campus on the left
  'guad-street': { center: [-97.74175, 30.28700], zoom: 19.2, pitch: 84, bearing: 356 },
};
const POSE_NAMES = arg('--poses', 'spawn,start-close,west-campus,union-close').split(',');

// ── installed once in the page: the timing wrappers and the variant switches ──
const PAGE_SETUP = `(() => {
  if (window.__LC) return window.__LC.status();
  const S = window.slopes, G = window.GLTF_LAYER, OWN = G.lookOwn, COPY = G.lookCopy, R = S.renderer, gl = R.getContext(), layer = S.layer, T = window.THREE;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const st = { cpu: 0, gpu: 0, gpuPending: [], frameGpu: [], calls: 0, tris: 0 };
  R.info.autoReset = false;
  // prerender calls this.render(gl, args, true): only the outermost call is timed
  let depth = 0;
  const wrap = (name) => { const f = layer[name]; layer[name] = function () {
    if (depth > 0) return f.apply(this, arguments);
    if (name === 'prerender') { st.cpu = 0; R.info.reset(); }
    let q = null; if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    const t0 = performance.now(); depth++;
    try { return f.apply(this, arguments); }
    finally { depth--; st.cpu += performance.now() - t0; if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); st.gpuPending.push({ q, frame: st.frame || 0 }); }
      if (name === 'render') { st.calls = R.info.render.calls; st.tris = R.info.render.triangles; } } }; };
  wrap('prerender'); wrap('render');
  // GPU results arrive a few frames late: summed by frame
  const pollGpu = () => {
    if (!ext) return; const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT); const keep = [];
    for (const p of st.gpuPending) { if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { if (!disjoint) { const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT); st.byFrame = st.byFrame || new Map(); st.byFrame.set(p.frame, (st.byFrame.get(p.frame) || 0) + ns / 1e6); } gl.deleteQuery(p.q); } else keep.push(p); }
    st.gpuPending = keep;
  };
  const rows = () => (G.info.look && G.info.look.rows) || [];
  const empty = new T.Scene();
  const cheapMat = new T.ShaderMaterial({ side: T.DoubleSide, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.55, 0.5, 0.45, 1.0); }' });
  const cheapGlass = new T.ShaderMaterial({ side: T.DoubleSide, transparent: true, depthWrite: false, blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.ZeroFactor, blendDst: T.SrcColorFactor,
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.8, 0.8, 0.8, 1.0); }' });
  G.look.own.slackFrames = 1e9;   // no target is let go while variants flip (it would be made again: a one-frame cost in the next variant)
  let undo = null;
  const swapScenes = keys => { const saved = []; for (const b of OWN.list) for (const k of keys) { saved.push([b, k, b[k]]); b[k] = empty; } return () => { for (const [b, k, v] of saved) b[k] = v; }; };
  const V = {
    on: () => () => {},
    off: () => { const hid = []; for (const e of rows()) if (e.built && e.built.group.visible) { e.built.group.visible = false; hid.push(e.built.group); } const cg = COPY.group, cv = cg && cg.visible; if (cg) cg.visible = false; return () => { for (const g of hid) g.visible = true; if (cg) cg.visible = cv; }; },
    noOwn: () => { const saved = OWN.list.splice(0); return () => { OWN.list.push(...saved); }; },
    noCast: () => { const hid = []; for (const e of rows()) if (e.built) for (const m of e.built.group.children) if (m.visible) { m.visible = false; hid.push(m); } return () => { for (const m of hid) m.visible = true; }; },
    cheap: () => { const saved = []; for (const b of OWN.list) { for (const m of b.picture.children) { saved.push([m, m.material]); m.material = cheapMat; } for (const m of b.glass.children) { saved.push([m, m.material]); m.material = cheapGlass; } } return () => { for (const [m, mat] of saved) m.material = mat; }; },
    shrink: () => { OWN.shrink = 0.02; return () => { OWN.shrink = 0; }; },
    noPicture: () => swapScenes(['picture']),
    noLay: () => swapScenes(['depth', 'fill']),
    noGlass: () => swapScenes(['glass']),
    farOff: () => { const was = G.look.far.on; G.look.far.on = false; return () => { G.look.far.on = was; }; },
    leanOff: () => { const was = G.look.own.lean; G.look.own.lean = false; return () => { G.look.own.lean = was; }; },
    atlasBig: () => { const was = G.look.own.atlasMB; G.look.own.atlasMB = 256; return () => { G.look.own.atlasMB = was; }; },
    atlas128: () => { const was = G.look.own.atlasMB; G.look.own.atlasMB = 128; return () => { G.look.own.atlasMB = was; }; },
    atlas64: () => { const was = G.look.own.atlasMB; G.look.own.atlasMB = 64; return () => { G.look.own.atlasMB = was; }; },
    atlasOff: () => { const was = G.look.own.atlas; G.look.own.atlas = false; return () => { G.look.own.atlas = was; }; },
    copies: () => { const C = G.look.copy, a = C.fullM, b = C.farM, f = C.fadeS; C.fullM = 1e-6; C.farM = 2e-6; C.fadeS = 0; return () => { C.fullM = a; C.farM = b; setTimeout(() => { C.fadeS = f; }, 1500); }; },
    // ── one material a pass (GLTF.look.own.shared, 2026-10-16) and the atlas packing (own.pack) ──
    // before   the atlas as #503 left it: a material for each building, rectangles in the list's order
    // noPack   one material a pass, rectangles in the list's order;  sharedOff  a material for each building, the new packing
    // capNN    one material a pass with targets of up to NN MB a sample count
    before: () => own({ shared: false, pack: false }),
    noPack: () => own({ pack: false }),
    sharedOff: () => own({ shared: false }),
    thinOld: () => own({ sharedThin: false }),   // one material a pass, but the thin parts keep their own building's material (two-sided, as before)
    thinShared: () => own({ sharedThin: true }), pack: () => own({ pack: true }),   // (both OFF by default since 2026-10-16: see docs/gltf-layer.md)
    cap96: () => own({ atlasMB: 96 }), cap64: () => own({ atlasMB: 64 }), cap48: () => own({ atlasMB: 48 }), cap32: () => own({ atlasMB: 32 }),
    // WHERE a draw's cost goes, on the old path (a material for each building, as #503): each switch takes one part away
    //   oldOneMat    every building's picture drawn with ONE building's material (a wrong picture): no material switch, no upload
    //   oldOneMatUp  the same, and three.js told to upload the material's whole list before every draw: the upload without the switch
    //   oldLay1      the lay pass drawn in one two-sided pass instead of back faces then front faces (a program and side change a draw)
    //   oldNoSync    the hour's sky not set on each material before its draw (CitySky.sync a no-op; the values stay what they were)
    //   oldNoDraw    every draw of the smoothing pass draws no triangle (draw range 0): what is left is the calls without the drawing
    //   noDraw       the same with one material a pass
    oldOneMat: () => oldPics(false), oldOneMatUp: () => oldPics(true),
    oldLay1: () => { const u = own({ shared: false, pack: false }); for (const b of OWN.list) b.lay.forceSinglePass = true; return () => { for (const b of OWN.list) b.lay.forceSinglePass = false; u(); }; },
    oldNoSync: () => { const u = own({ shared: false, pack: false }), C = window.CitySky, f = C.sync; C.sync = () => null; return () => { C.sync = f; u(); }; },
    oldNoDraw: () => noDraw(own({ shared: false, pack: false })),
    noDraw: () => noDraw(() => {}),
    // ── WHERE the far-copy view's time goes (2026-10-17, mac/gltf-westcampus-cost; run with ?gltffardist=400) ──
    //   noFull        every full building hidden, the far copies stay (as loaded: the far copy alone where it stands alone)
    //   noCopies      every far copy hidden (the one mesh of those that stand alone and each one under a dissolving building), full buildings stay
    //   noUnder       only the far copies under a dissolving building hidden (one mesh and draw each)
    //   noAtlasPic    the atlas's picture pass draws nothing (its target is still cleared and resolved)
    //   noAtlasCanvas the atlas's depth, lay and glass pass on the canvas draws nothing
    //   noSync        the hour's sky not set on any of the layer's materials (CitySky.sync a no-op)
    //   aa2           every box smoothed with 2 samples a pixel (the tiers' 8 and 4 too): what the samples cost
    //   scale1        no box drawn at more than the canvas's pixels (the tiers' Scale 1): what the finer far tiers cost
    noFull: () => { const hid = []; for (const e of rows()) if (e.built && e.built.group.visible) { e.built.group.visible = false; hid.push(e.built.group); } return () => { for (const g of hid) g.visible = true; }; },
    noCopies: () => { const cg = COPY.group, cv = cg && cg.visible; if (cg) cg.visible = false; return () => { if (cg) cg.visible = cv; }; },
    noUnder: () => { const hid = []; for (const m of COPY.fades.values()) if (m.visible) { m.visible = false; hid.push(m); } return () => { for (const m of hid) m.visible = true; }; },
    noAtlasPic: () => { const A = OWN.atlas, s = A && [A.spic, A.pic]; if (s) for (const x of s) x.visible = false; return () => { if (s) for (const x of s) x.visible = true; }; },
    noAtlasCanvas: () => { const A = OWN.atlas, s = A && [A.scanvas, A.canvas]; if (s) for (const x of s) x.visible = false; return () => { if (s) for (const x of s) x.visible = true; }; },
    noSync: () => { const C = window.CitySky, f = C.sync; C.sync = () => null; return () => { C.sync = f; }; },
    aa2: () => { const O = G.look.own, F = G.look.far, was = [O.samples, O.bigSamples, F.tinySamples, F.smallSamples, F.midSamples]; O.samples = O.bigSamples = F.tinySamples = F.smallSamples = F.midSamples = 2;
      return () => { [O.samples, O.bigSamples, F.tinySamples, F.smallSamples, F.midSamples] = was; }; },
    scale1: () => { const F = G.look.far, was = [F.tinyScale, F.smallScale, F.midScale]; F.tinyScale = F.smallScale = F.midScale = 1; return () => { [F.tinyScale, F.smallScale, F.midScale] = was; }; },
  };
  function own(set) { const O = G.look.own, was = {}; for (const k of Object.keys(set)) { was[k] = O[k]; O[k] = set[k]; } return () => Object.assign(O, was); }
  function oldPics(upload) {
    const u = own({ shared: false, pack: false }), saved = []; let first = null;
    for (const b of OWN.list) { if (!OWN.atlas || !b.picture) continue; const P = OWN.atlasParts(b); for (const m of P.pic.children) { if (m.material.uniforms.u_lookPass.value > 0.5) continue; first = first || m.material; saved.push([m, m.material, m.onBeforeRender]); m.material = first;
      if (upload) { const f = m.onBeforeRender; m.onBeforeRender = function (r, s, c, g, mat) { f.apply(this, arguments); mat.uniformsNeedUpdate = true; }; } } }
    return () => { for (const [m, mat, f] of saved) { m.material = mat; m.onBeforeRender = f; } u(); };
  }
  function noDraw(u) {
    const geoms = new Set(); for (const b of OWN.list) for (const sc of [b.picture, b.canvas]) if (sc) for (const m of sc.children) geoms.add(m.geometry);
    for (const g of geoms) g.setDrawRange(0, 0);
    return () => { for (const g of geoms) g.setDrawRange(0, Infinity); u(); };
  }
  const status = () => ({ timer: !!ext, own: OWN.list.length, fullShown: OWN.list.filter(b => b.group && b.group.visible).length, rows: rows().length, loaded: rows().filter(e => e.state === 2).length,
    copiesShown: COPY.shown, ownPixels: OWN.pixels, atlas: !!G.look.own.atlas, ownRenders: OWN.renders, ownFlushes: OWN.flushes, shared: !!G.look.own.shared, pack: !!G.look.own.pack, atlasMB: G.look.own.atlasMB, shPushes: OWN.sh ? OWN.sh.pushes : null, shUploads: OWN.sh ? OWN.sh.uploads : null, needMB: OWN.needMB, ownMB: Math.round((OWN.bytes || 0) / 1e6), layerTris: G.info.look ? G.info.look.triangles : null,
    shadowMapRenders: S.sunlightStats().shadowMapRenders, copyRebuilds: COPY.rebuilds, dissolving: rows().filter(e => e.farMode === 2).length, under: COPY.fades ? COPY.fades.size : 0, tiers: OWN.list.filter(b => b.group && b.group.visible).map(b => (b.samples || 0) + 'x' + (b.scale || 0)).join(' ') });
  // farNNN: the far copy alone from NNN m on the owner's 1440 x 900 window (GLTF.look.copy.perM converts; js/gltf-layer.js ?gltffardist)
  const farV = name => { const m = /^far(\\d+)$/.exec(name); if (!m) throw new Error('no variant ' + name);
    return () => { const C = G.look.copy, a = C.fullM, b = C.farM; C.farM = +m[1] * C.perM; C.fullM = C.farM * C.share; return () => { C.fullM = a; C.farM = b; }; }; };
  // every change of variant jumps each row to its new share at once (no dissolve left over into the next pass), then the dissolve is back
  const FADE0 = G.look.copy.fadeS; let fadeT = 0;
  window.__LC = {
    status, variants: Object.keys(V),
    set(name) { if (undo) { undo(); undo = null; } undo = (V[name] || farV(name))(); G.look.copy.fadeS = 0; clearTimeout(fadeT); fadeT = setTimeout(() => { G.look.copy.fadeS = FADE0; }, 1200);
      if (window.__map) window.__map.triggerRepaint(); return status(); },
    // the camera flies cfg.metres forward along its bearing over cfg.ms in real time; a log a frame of the dissolve
    async fly(cfg) {
      const m = window.__map, C = G.look.copy, R = rows(), prev = new Map(R.map(e => [e, e.fade])), log = [];
      const lat0 = cfg.pose.center[1], lng0 = cfg.pose.center[0], br = cfg.pose.bearing * Math.PI / 180;
      const dLat = Math.cos(br) / 111320, dLng = Math.sin(br) / (111320 * Math.cos(lat0 * Math.PI / 180));
      m.jumpTo(cfg.pose); const t0 = performance.now();
      await new Promise(res => { const step = () => { const t = performance.now() - t0, k = Math.min(1, t / cfg.ms), d = k * cfg.metres;
        m.jumpTo({ center: [lng0 + dLng * d, lat0 + dLat * d] });
        let n2 = 0, nFull = 0, maxStep = 0, who = null; for (const e of R) { if (e.farMode === 2) n2++; if (e.fade > 0) nFull++; const dd = Math.abs((e.fade || 0) - (prev.get(e) || 0)); if (dd > maxStep) { maxStep = dd; who = e.row && (e.row.name || e.row.id); } prev.set(e, e.fade); }
        log.push({ t: Math.round(t), d: Math.round(d), n2, nFull, maxStep: +maxStep.toFixed(3), who: maxStep > 0 ? who : null });
        if (k >= 1) return res(); requestAnimationFrame(step); }; requestAnimationFrame(step); });
      return { log, fadeS: C.fadeS, fullM: C.fullM, farM: C.farM };
    },
    async pass(cfg) {
      const m = window.__map; m.jumpTo(cfg.pose);
      const rec = []; let last = null, i = 0; st.byFrame = new Map();
      await new Promise(res => {
        const step = (ts) => {
          pollGpu();
          if (i > 2) rec.push({ dt: ts - last, cpu: st.cpu, own: OWN.ms, renders: OWN.renders, mb: OWN.needMB, calls: st.calls, tris: st.tris, frame: st.frame, rb: COPY.rebuilds, n2: rows().filter(e => e.farMode === 2).length, px: OWN.pixels, sm: S.sunlightStats().shadowMapRenders });
          last = ts; st.frame = (st.frame || 0) + 1;
          if (i++ >= cfg.n + 2) return res();
          m.jumpTo({ bearing: cfg.pose.bearing + i * 0.12 });
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      // the last frames' GPU results
      for (let k = 0; k < 20 && st.gpuPending.length; k++) { await new Promise(r => requestAnimationFrame(r)); pollGpu(); }
      // GPU time a frame: prerender and render of one map frame carry the same frame number (summed)
      return { rec, gpu: [...st.byFrame.values()] };
    },
  };
  return status();
})()`;

const pct = (a, q) => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const r2 = x => x == null ? null : +x.toFixed(2);

// --shots POSE: no timing; pictures of one pose with variant A and B in turn (A, B, A, B; the second of each is kept), in the same page,
// plus a pixel count of what differs (A against A = the page's own noise; A against B = the change). --width/--height/--dpr set the window.
const SHOTS = arg('--shots', '');
const SHOT_AB = arg('--shot-ab', 'leanOff,on').split(',');
const MOTION = arg('--motion', ''), MOTION_AB = arg('--motion-ab', 'on').split(',');
const W = +arg('--width', PHONE ? 390 : 1280), H = +arg('--height', PHONE ? 844 : 800), DPR = +arg('--dpr', PHONE ? 3 : 1.5);
const chrome = await startChrome({ gl: GL, width: W, height: H, vsync: 'off', maxMs: 3000000 });
const result = { label: LABEL, phone: PHONE, throttle: THROTTLE, poses: {}, profiles: {} };
try {
  const page = await chrome.newPage();
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: PHONE });
  if (PHONE) { await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }); }
  if (THROTTLE > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const iv=setInterval(()=>{if(window.cancelGraphicsAutoDetect){try{window.cancelGraphicsAutoDetect();window.__acCancelled=performance.now();}catch(e){}clearInterval(iv);}},10);})();` });
  const ev = async (expr) => { const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval failed'); return r.result.value; };
  const q = ['intro=0', 'drift=0', 'gltf=1', EXTRA].filter(Boolean).join('&');
  const t0 = Date.now();
  await page.send('Page.navigate', { url: URL0 + (URL0.includes('?') ? '&' : '?') + q });
  for (;;) {
    await sleep(1000);
    let s = null; try { s = JSON.parse(await ev(`JSON.stringify({map:!!(window.__map&&window.__map.isStyleLoaded()),veil:!!document.getElementById('veil'),apts:!!(window.slopesApartments&&window.slopesApartments.count&&window.slopesApartments.count.done),gltf:window.GLTF_LAYER?{on:window.GLTF_LAYER.on,ready:window.GLTF_LAYER.ready}:null,own:!!(window.GLTF_LAYER&&window.GLTF_LAYER.lookOwn)})`)); } catch (e) {}
    if (s && s.map && !s.veil && s.apts && s.gltf && s.gltf.on && s.gltf.ready && s.own) break;
    if (Date.now() - t0 > MAX) throw new Error('city not ready within ' + MAX + ' ms: ' + JSON.stringify(s));
  }
  await sleep(SETTLE);
  await ev(`window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()`);
  result.env = JSON.parse(await ev(`JSON.stringify({ preset: window.GFX && window.GFX.preset, renderScale: window.GFX && window.GFX.renderScale, msaa: window.GFX && window.GFX.msaa, shadows: window.GFX && window.GFX.shadows,
    canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], dpr: devicePixelRatio, renderer: (()=>{const g=document.createElement('canvas').getContext('webgl');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null})() })`));
  result.loadMs = Date.now() - t0; result.machine = machineLoad();
  result.setup = await ev(PAGE_SETUP);
  console.error(`[${LABEL}] loaded in ${result.loadMs} ms; ${JSON.stringify(result.env)}; ${JSON.stringify(result.setup)}`);

  if (SHOTS) {
    result.shots = [];
    // the drawing buffer read at the end of a map render (it is still whole then); kept in the page, compared there
    await ev(`(() => { window.__LCgrab = () => new Promise(res => { const m = window.__map, gl = m.painter.context.gl; const f = () => { m.off('render', f); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); res(px); }; m.on('render', f); m.triggerRepaint(); });
      window.__LCdiff = (a, b) => { let n2 = 0, n16 = 0, mx = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d > 2) n2++; if (d > 16) n16++; if (d > mx) mx = d; } return { pixels: a.length / 4, over2: n2, over16: n16, max: mx }; };
      window.__LCimg = {}; return 0; })()`);
    for (const poseName of SHOTS.split(',')) {
      const pose = POSES[poseName];
      await ev(`(async()=>{window.__LC.set('on');window.__map.jumpTo(${JSON.stringify(pose)});for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,250));if(window.GLTF_LAYER.lookTick())break;}return 0})()`);
      await sleep(8000);
      // up to five variants: each twice (all once, then all again; the second kept), each against the first; the first image of a
      // variant against its second = the page's own noise
      const VS = SHOT_AB.slice(0, 5), one = { pose: poseName, ab: VS, window: [W, H, DPR], noise: {}, change: {}, status: {} };
      await ev(`window.__LCimg = {}; 0`);
      for (const pass of [1, 2]) for (const v of VS) {
        await ev(`window.__LC.set(${JSON.stringify(v)})`); await sleep(2500);
        await ev(`window.__LCgrab().then(px => { window.__LCimg[${JSON.stringify(v + pass)}] = px; return 0; })`);
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
        if (pass === 2) {
          fs.writeFileSync(path.join(OUT, `${LABEL}-${poseName}-${v}.png`), Buffer.from(data, 'base64'));
          one.status[v] = await ev(`window.__LC.status()`);
          one.noise[v] = await ev(`window.__LCdiff(window.__LCimg[${JSON.stringify(v + 1)}], window.__LCimg[${JSON.stringify(v + 2)}])`);
          if (v !== VS[0]) {
            one.change[v] = await ev(`window.__LCdiff(window.__LCimg[${JSON.stringify(VS[0] + 2)}], window.__LCimg[${JSON.stringify(v + 2)}])`);
            await ev(`delete window.__LCimg[${JSON.stringify(v + 1)}]; delete window.__LCimg[${JSON.stringify(v + 2)}]; 0`);
          }
        }
      }
      await ev(`window.__LCimg = {}; 0`);
      result.shots.push(one);
      console.error(`[${LABEL}] shots ${JSON.stringify(one)}`);
    }
  }
  if (MOTION) {
    // the camera flies forward in real time; a screencast records it (jpeg, at most 1440 x 900) and the page logs the dissolve a frame
    result.motion = [];
    const MS = +arg('--motion-ms', 5000);
    for (const poseName of MOTION.split(',')) {
      const pose = POSES[poseName], metres = +arg('--motion-m-' + poseName, (poseName === 'west-campus' || poseName === 'spawn') ? 400 : 150);
      for (const v of MOTION_AB) {
        await ev(`(async()=>{window.__LC.set(${JSON.stringify(v)});window.__map.jumpTo(${JSON.stringify(pose)});for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,250));if(window.GLTF_LAYER.lookTick())break;}return 0})()`);
        await sleep(6000);   // the dissolve (fadeS) is back on after 1.2 s; the rows at the start pose settle
        const dir = path.join(OUT, `motion-${poseName}-${v}`); fs.mkdirSync(dir, { recursive: true });
        const frames = []; let n = 0;
        const onFrame = async ({ data, metadata, sessionId }) => { const k = n++; fs.writeFileSync(path.join(dir, `f${String(k).padStart(4, '0')}.jpg`), Buffer.from(data, 'base64')); frames.push({ k, ts: metadata && metadata.timestamp }); try { await page.send('Page.screencastFrameAck', { sessionId }); } catch (e) {} };
        page.on('Page.screencastFrame', onFrame);
        await page.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
        await sleep(300);
        const flown = await ev(`window.__LC.fly(${JSON.stringify({ pose, metres, ms: MS })})`);
        await sleep(300);
        await page.send('Page.stopScreencast');
        page.handlers.set('Page.screencastFrame', []);
        fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ pose: poseName, variant: v, metres, ms: MS, frames, ...flown }));
        const L = flown.log, one = { pose: poseName, variant: v, metres, ms: MS, screencastFrames: n, layerFrames: L.length,
          maxShareStepInOneFrame: Math.max(...L.map(x => x.maxStep)), mostDissolvingAtOnce: Math.max(...L.map(x => x.n2)), fullM: flown.fullM, farM: flown.farM, fadeS: flown.fadeS };
        result.motion.push(one); console.error(`[${LABEL}] motion ${JSON.stringify(one)}`);
      }
    }
  }
  for (const name of (SHOTS || MOTION ? [] : POSE_NAMES)) {
    if (DEADLINE_MIN && Date.now() - T_START > DEADLINE_MIN * 60000) { console.error(`deadline passed: pose ${name} not run`); continue; }
    const pose = POSES[name], cfg = n => JSON.stringify({ pose, n });
    // let the rows for this camera load (by distance), then warm
    await ev(`(async()=>{window.__LC.set('on');window.__map.jumpTo(${JSON.stringify(pose)});for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,250));if(window.GLTF_LAYER.lookTick())break;}return 0})()`);
    await ev(`window.__LC.pass(${cfg(60)}).then(()=>0)`); await sleep(1500);
    const before = await ev(`window.__LC.status()`);
    // a CPU profile with the layer as loaded
    await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 1000 }); await page.send('Profiler.start');
    await ev(`window.__LC.pass(${cfg(PHONE ? 30 : 90)}).then(()=>0)`);
    const { profile } = await page.send('Profiler.stop'); await page.send('Profiler.disable');
    const a = analyse(profile, { top: 30 });
    // inclusive time of the layer's own code and of the city's render, from the same profile
    const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const incl = new Map(); const dur = profile.timeDeltas.map((_, i) => (profile.timeDeltas[i + 1] || 0) / 1000);
    profile.samples.forEach((id, i) => { const seen = new Set(); for (let n = id; n != null; n = parent.get(n)) { const cf = nodes.get(n).callFrame; const k = `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/^.*\/(js\/)/, '$1')}:${cf.lineNumber + 1}`; if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + dur[i]); } });
    result.profiles[name] = { busyMs: a.busyMs, totalMs: a.totalMs, gcMs: a.gcMs, topSelf: a.topSelf.slice(0, 20), topFiles: a.topFiles.slice(0, 10),
      inclusive: [...incl.entries()].filter(([k]) => /js\/(gltf|slopes|city-sky|city-lighting)/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => ({ fn: k, ms: +v.toFixed(1) })) };
    const per = {};
    for (let r = 0; r < ROUNDS; r++) {
      const order = VARIANTS.slice(r % VARIANTS.length).concat(VARIANTS.slice(0, r % VARIANTS.length));
      if (r % 2) order.reverse();
      for (const v of order) {
        const s = await ev(`window.__LC.set(${JSON.stringify(v)})`);
        await sleep(v === 'copies' || v === 'off' || v === 'on' || /^far\d+$/.test(v) ? 1600 : 600);
        await ev(`window.__LC.pass(${cfg(WARM)}).then(()=>0)`);
        const { rec, gpu } = await ev(`window.__LC.pass(${cfg(FRAMES)})`);
        const agg = { free: r2(pct(rec.map(x => x.dt), 0.5)), p95: r2(pct(rec.map(x => x.dt), 0.95)), cpu: r2(pct(rec.map(x => x.cpu), 0.5)), gpu: r2(pct(gpu, 0.5)), gpuN: gpu.length, own: r2(pct(rec.map(x => x.own), 0.5)),
          calls: pct(rec.map(x => x.calls), 0.5), tris: pct(rec.map(x => x.tris), 0.5), renders: pct(rec.map(x => x.renders), 0.5), mb: pct(rec.map(x => x.mb), 0.5), fullShown: s.fullShown, ownPixels: s.ownPixels,
          rebuilds: rec.length ? rec[rec.length - 1].rb - rec[0].rb : null, dissolving: pct(rec.map(x => x.n2), 0.5), px: pct(rec.map(x => x.px), 0.5), shadowMaps: rec.length ? rec[rec.length - 1].sm - rec[0].sm : null };
        (per[v] = per[v] || []).push(agg);
      }
      await ev(`window.__LC.set('on')`);
      console.error(`  [${LABEL}] ${name} round ${r + 1}: ` + VARIANTS.map(v => `${v} ${per[v][r].free}/${per[v][r].cpu}/${per[v][r].gpu}`).join('  '));
    }
    result.poses[name] = { status: before, per };
  }
} finally { await chrome.close(); }

// ── report ──
const out = [];
const e = result.env || {};
out.push(`# layer-cost ${LABEL}  url ${URL0}  gl ${GL}  ${PHONE ? "SIMULATED phone 390x844 DPR3 (the runner's GPU)" : 'desktop 1280x800 DPR1.5'}  CPU throttle ${THROTTLE}x`);
out.push(`renderer ${e.renderer}  preset ${e.preset} renderScale ${e.renderScale} msaa ${e.msaa} shadows ${e.shadows} canvas ${(e.canvas || []).join('x')}  GPU timer ${result.setup && result.setup.timer}`);
out.push(`?intro=0&drift=0&gltf=1${EXTRA ? '&' + EXTRA : ''}  vsync off  ${ROUNDS} rounds, ${FRAMES} frames a variant (warm ${WARM})  load ${result.loadMs} ms  machine ${JSON.stringify(result.machine)}`);
out.push('Columns: min over rounds of the p50. free = frame interval; cpu = JS of the city three.js layer a frame; gpu = GPU time of the same; own = the smoothing pass JS; delta = against `off`.');
const mn = a => { const b = a.filter(x => x != null); return b.length ? Math.min(...b) : null; };
const table = {};
for (const [name, P] of Object.entries(result.poses)) {
  out.push(`\n## ${name}  (${JSON.stringify(P.status)})`);
  out.push('| variant | free ms | free delta | cpu ms | cpu delta | gpu ms | gpu delta | own ms | render calls (smoothing) | target MB | draw calls | triangles | picture px | dissolving | far-copy rebuilds a pass (max) | shadow-map draws a pass (max) | free per round |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const base = k => mn(P.per.off.map(x => x[k]));
  table[name] = {};
  for (const v of VARIANTS) {
    const rs = P.per[v]; if (!rs) continue;
    const m = k => mn(rs.map(x => x[k])), d = k => (m(k) != null && base(k) != null ? (m(k) - base(k) >= 0 ? '+' : '') + (m(k) - base(k)).toFixed(2) : '-');
    table[name][v] = { free: m('free'), cpu: m('cpu'), gpu: m('gpu'), own: m('own'), renders: m('renders'), mb: m('mb'), calls: m('calls'), tris: m('tris') };
    const mx = k => { const b = rs.map(x => x[k]).filter(x => x != null); return b.length ? Math.max(...b) : null; };
    out.push(`| ${v} | ${m('free')} | ${d('free')} | ${m('cpu')} | ${d('cpu')} | ${m('gpu')} | ${d('gpu')} | ${m('own')} | ${m('renders')} | ${m('mb')} | ${m('calls')} | ${m('tris')} | ${m('px')} | ${m('dissolving')} | ${mx('rebuilds')} | ${mx('shadowMaps')} | ${rs.map(x => x.free).join(' / ')} |`);
  }
  const p = result.profiles[name];
  if (p) {
    out.push(`\nCPU profile (layer as loaded): busy ${p.busyMs} of ${p.totalMs} ms, GC ${p.gcMs}`);
    out.push('inclusive, the layer and city code: ' + p.inclusive.slice(0, 14).map(x => `${x.fn} ${x.ms}`).join(' | '));
    out.push('top self: ' + p.topSelf.slice(0, 12).map(x => `${x.fn} ${x.selfMs}`).join(' | '));
    out.push('by file: ' + p.topFiles.map(x => `${x.file} ${x.selfMs}`).join(' | '));
  }
}
for (const s of result.shots || []) { out.push(`\n## pictures ${s.pose} at ${s.window.join(' x ')}: each against ${s.ab[0]}`); for (const v of s.ab) out.push(`${v}: full buildings ${s.status[v] && s.status[v].fullShown}, far copies ${s.status[v] && s.status[v].copiesShown}; noise ${JSON.stringify(s.noise[v])}${s.change[v] ? '; change ' + JSON.stringify(s.change[v]) : ''}`); }
for (const m of result.motion || []) out.push(`motion ${JSON.stringify(m)}`);
out.push('\nJSON_TABLE ' + JSON.stringify(table));
const text = out.join('\n');
fs.writeFileSync(path.join(OUT, `report-${LABEL}.txt`), text);
fs.writeFileSync(path.join(OUT, `raw-${LABEL}.json`), JSON.stringify(result, null, 1));
console.log(text);
process.exit(Object.keys(result.poses).length || result.shots || result.motion ? 0 : 1);
