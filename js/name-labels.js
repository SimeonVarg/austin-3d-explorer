/* One place-name system, drawn the way the map has always drawn names.
 *
 * LOOK. Warm near-white text with a thin near-black outline, straight on the
 * map: the same ink, outline and outline-to-size ratio as the live building
 * names (js/app.js LABEL_LOOK) and curated signs (js/signs.js). No box, no dot.
 * A name's size comes from its building, on the live layers' own zoom curves:
 * curated heroes and big buildings are bigger and bold, ordinary buildings are
 * smaller, shops smallest. The size tier is baked into data/labels.json by
 * scripts/bake_labels.mjs with the live volume rule. Every taste value is one
 * line in NAME_LABELS below.
 *
 * SYSTEM. One catalog and one collision pass, so no name is drawn twice or on
 * top of another. Each name is tested once, at its world anchor, against
 * MapLibre's GPU depth (a GPU-only depth copy): a foreground building hides a
 * whole name instead of slicing its letters. Names stay inside the frame and
 * off the controls, and together never cover more than `maxCoverage` of the
 * screen. No depth readback, raycast, per-frame glyph-atlas upload or per-label
 * DOM node: one glyph atlas, one draw call.
 * ?namelabels=0 retains the original layers for repeatable before/after tests.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const TUNE = window.NAME_LABELS = {
    on: q.get('namelabels') !== '0',
    // ── Look: the live labels' values ───────────────────────────────────
    fontFamily: 'Arial, Helvetica, sans-serif',
    boldWeight: 700, regularWeight: 400,
    ink: '#fffaf0',                  // warm near-white text (live LABEL_LOOK.ink)
    halo: 'rgba(10,7,2,0.97)',       // near-black outline (live LABEL_LOOK.halo)
    nightHalo: 'rgba(6,5,14,0.98)',  // outline after dark (live signs.js)
    haloRatio: 0.17,                 // outline width / text size (live)
    lineHeight: 1.2,                 // ems between wrapped lines
    maxWidthEm: 9,                   // wrap width in ems (live building names)
    liftPx: 3,                       // gap from the roof point up to the name
    showCodes: true,                 // "Gates Dell Complex · GDC"
    // Size tiers. `size`: [map zoom, px] stops, the live curves. `bold`: the
    // live font weight (live's smallest building names start at 9.5 px, but
    // only from zoom 17.9; these are drawn from further out, so 10 px is their
    // floor). `pad`: the live collision padding, px, around a name.
    // `nightDim`: how far a name recedes after dark (live dims its smallest
    // building names 45%). `priority`: a small collision bonus, so a big
    // building's name is not lost to a small neighbour's.
    tiers: {
      hero:  { size: [[13, 12], [16, 16], [19, 21]],          bold: true,  pad: 16, nightDim: 0,    priority: 0.6 },
      major: { size: [[15.3, 13.5], [18, 19.5]],              bold: true,  pad: 17, nightDim: 0,    priority: 0.4 },
      sign:  { size: [[13, 10], [16, 12], [19, 15]],          bold: true,  pad: 16, nightDim: 0,    priority: 0.3 },
      mid:   { size: [[16.6, 11], [19.3, 14.5]],              bold: false, pad: 13, nightDim: 0,    priority: 0.15 },
      minor: { size: [[17.9, 10], [20.6, 12]],                bold: false, pad: 10, nightDim: 0.45, priority: 0 },
      small: { size: [[17.3, 8.5], [18.4, 11], [19.5, 12.5]], bold: true,  pad: 3,  nightDim: 0.45, priority: 0 },
    },
    maxCoverage: 0.08,               // all names together cover at most this share of the screen
    // Distances are metres from the eye, not map zoom (phones share this rule).
    ranges: { apartment: [820, 1350], campus: [1000, 1650], landmark: [1500, 2500], place: [100, 200] },
    priority: { apartment: 3, campus: 3, landmark: 3.4, place: 1 },
    roofLift: 3, placeLift: 3, edgePx: 8, controlGapPx: 8,
    maxDesktop: 40, maxPhone: 16, phoneWidth: 600,
    fadeMs: 220, retainBonus: 0.12, retireAlpha: 0.025,
    // ── Engineering, not taste ──────────────────────────────────────────
    atlasWidth: 1024, rasterScale: 2, cellGapPx: 6, mipBias: -0.35,
    depthBias: 0.000002, depthRefreshMs: 1000, candidateRefreshMetres: 60,
  };
  const LEGACY = new Set(['signs-label', 'buildings-labels-major', 'buildings-labels-mid',
    'buildings-labels', 'places-label', 'props-art-label', 'entrances-inscription', 'entrances-wordmark']);
  const ID = 'city-name-labels';
  const FLOATS = 7, QUAD = 6 * FLOATS;        // pos2 uv2 label tier role
  const ROLE_HALO = 0, ROLE_INK = 1, ROLE_HIT = 2;
  let map, rows = [], pages = [], gpu, ready = false, busy = false, disposed = false;
  let lastTime = 0, drawn = [], lastMs = 0, maxMs = 0, frameCount = 0, totalMs = 0;
  let failed = null, only = null, pendingTap = null;
  const legacyVisibility = new Map();
  // Immutable local glyph geometry is repacked only when submitted membership changes.
  const vertices = new Float32Array(QUAD * 12000);
  const packedRows = []; let packedFloats = 0;
  let depthTimer, depthDirty = true, depthModelCount = -1;
  let anchors; const anchorWidth = 256;
  const corners = [0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1];
  let glyphs = new Map(), tierList = [], tierFont = [], fontPx = [];
  const tierScale = new Float32Array(8), tierDim = new Float32Array(8);
  let nearby = [], nearbyEye = null, night = -1, coverage = 0;
  const fadingRows = new Set(), fadeOrder = [];
  const candidates = [], admitted = [], viewport = [0, 0];
  const byScore = (a, b) => b.score - a.score || a.index - b.index;
  const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  // Padded boxes overlap: the same rule as MapLibre's text-padding.
  const clash = (a, b) => a.box[0] - a.pad < b.box[2] + b.pad && a.box[2] + a.pad > b.box[0] - b.pad &&
    a.box[1] - a.pad < b.box[3] + b.pad && a.box[3] + a.pad > b.box[1] - b.pad;
  let markerBoxes = [];
  let fixedControlBoxes = [];
  const hiddenMarkers = new Map();
  function restoreMarkers() {
    for(const [el,visibility] of hiddenMarkers)el.style.visibility=visibility;
    hiddenMarkers.clear();
  }
  let canvasWidth = 0, canvasHeight = 0;
  let controlBoxes = [], boundsDirty = true, controlObserver, controlClassObserver;
  let layoutDirty = true, layoutFading = true, uploadDirty = true;
  const lastMatrix = new Float64Array(16);
  const controlSelector = '#tod-panel, .maplibregl-ctrl, #hud, #controls-hint, #gfx-button, #fb-button, #explore, #live-here, #lh-toggle, #finder-tray, #compare-tray, #joy-boost, #joystick-zone, #gfx-panel, #fb-panel, .lh-map-label';
  function cacheControlBounds() {
    const canvas = map.getCanvas(), c = canvas.getBoundingClientRect();
    if (!c.width || !c.height) return;
    canvasWidth=canvas.clientWidth; canvasHeight=canvas.clientHeight;
    const sx = canvasWidth / c.width, sy = canvasHeight / c.height;
    controlBoxes = []; markerBoxes = []; fixedControlBoxes = [];
    for (const el of document.querySelectorAll(controlSelector)) {
      const p = el.getBoundingClientRect(), style = getComputedStyle(el);
      if (!p.width || !p.height || (style.visibility === 'hidden' && !hiddenMarkers.has(el)) || style.display === 'none') continue;
      const box=[(p.left-c.left)*sx, (p.top-c.top)*sy, (p.right-c.left)*sx, (p.bottom-c.top)*sy];
      controlBoxes.push(box);
      if(el.matches?.('.lh-map-label')) {
        const home=window.LIVE_HERE?.homes?.find(h=>h.name===el.textContent);
        if(home)markerBoxes.push({el,box,point:home.point,w:p.width*sx,h:p.height*sy});
      } else fixedControlBoxes.push(box);
    }
    boundsDirty = false; layoutDirty = true;
  }
  const movingControls = new Set();
  function watchControlBounds() {
    const dirty = () => { boundsDirty = true; map.triggerRepaint(); };
    controlObserver = new ResizeObserver(dirty);
    controlObserver.observe(map.getCanvas());
    for (const el of document.querySelectorAll(controlSelector)) controlObserver.observe(el);
    controlClassObserver = new MutationObserver(records => {
      for(const r of records) for(const node of r.addedNodes || []) {
        if(node.matches?.(controlSelector)) {controlObserver.observe(node);dirty();}
        for(const el of node.querySelectorAll?.(controlSelector) || []) {controlObserver.observe(el);dirty();}
      }
      if (records.some(r => r.target === document.body || r.target.matches?.(controlSelector))) dirty();
    });
    controlClassObserver.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['class','style','hidden','open']});
    const transition = event => {
      if(!event.target.matches?.(controlSelector))return;
      if(event.type==='transitionrun')movingControls.add(event.target);else movingControls.delete(event.target);
      dirty();
    };
    for(const event of ['transitionrun','transitionend','transitioncancel'])document.addEventListener(event,transition);
    map.on('resize', dirty);
    map.once?.('remove', () => { controlObserver.disconnect(); controlClassObserver.disconnect(); for(const event of ['transitionrun','transitionend','transitioncancel'])document.removeEventListener(event,transition); });
  }
  function behindControl(box) {
    const gap = TUNE.controlGapPx;
    return controlBoxes.some(p => box[0]<p[2]+gap && box[2]+gap>p[0] && box[1]<p[3]+gap && box[3]+gap>p[1]);
  }

  const fontCss = (bold, px) => `${bold ? TUNE.boldWeight : TUNE.regularWeight} ${px}px ${TUNE.fontFamily}`;
  // The size stops as a zoom curve: flat outside the stops, linear between.
  function sizeAt(stops, zoom) {
    if (zoom <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (zoom <= stops[i][0]) {
      const [z0, s0] = stops[i - 1], [z1, s1] = stops[i];
      return s0 + (s1 - s0) * (zoom - z0) / (z1 - z0);
    }
    return stops[stops.length - 1][1];
  }
  function tierOf(label) {
    if (TUNE.tiers[label.tier]) return label.tier;
    // A catalog baked before size tiers: shops small, towers big, the rest mid.
    return label.kind === 'place' ? 'small' : label.kind === 'landmark' ? 'major' : 'mid';
  }
  // Glyphs are rasterised once per weight, at the largest size any tier draws
  // that weight; tiers scale them down on the GPU. One two-channel texel per
  // glyph cell: red is the letter, green the letter plus its outline. Mipmaps
  // keep the small sizes from shimmering.
  function atlas(data) {
    const scale = TUNE.rasterScale, width = TUNE.atlasWidth & ~1, gap = TUNE.cellGapPx;
    tierList = Object.keys(TUNE.tiers);
    if (tierList.length > tierScale.length) throw new Error('Too many name-label tiers');
    fontPx = [false, true].map(bold => Math.max(1, ...tierList.filter(t => !!TUNE.tiers[t].bold === bold)
      .flatMap(t => TUNE.tiers[t].size.map(s => s[1]))));
    tierFont = tierList.map(t => TUNE.tiers[t].bold ? 1 : 0);
    const texts = data.labels.map(label => TUNE.showCodes && label.code && !label.name.includes(label.code) ? label.name + ' · ' + label.code : label.name);
    const chars = Array.from(new Set(Array.from(texts.join(''))));
    const measure = document.createElement('canvas').getContext('2d');
    const cells = [];
    glyphs = new Map();
    for (const bold of [0, 1]) {
      const px = fontPx[bold], margin = Math.ceil(TUNE.haloRatio * px) + 1, lineH = TUNE.lineHeight * px;
      measure.font = fontCss(bold, px);
      for (const char of chars) {
        const advance = measure.measureText(char).width;
        const g = { advance, margin, lineH, w: Math.ceil(advance) + 2 * margin, h: Math.ceil(lineH) + 2 * margin };
        glyphs.set(bold + char, g); cells.push({ g, char, bold });
      }
    }
    // Shelf-pack in texels; the page is as tall as it needs to be.
    let x = gap, y = gap, rowH = 0;
    for (const cell of cells) {
      const tw = cell.g.w * scale, th = cell.g.h * scale;
      if (x + tw + gap > width) { x = gap; y += rowH + gap; rowH = 0; }
      cell.x = x; cell.y = y; x += tw + gap; rowH = Math.max(rowH, th);
    }
    const height = Math.ceil((y + rowH + gap) / 4) * 4;
    const draw = halo => {
      const page = document.createElement('canvas'); page.width = width; page.height = height;
      const ctx = page.getContext('2d', { willReadFrequently: true });
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round';
      for (const { g, char, bold, x, y } of cells) {
        const px = fontPx[bold], tx = x + g.margin * scale, ty = y + (g.margin + g.lineH / 2) * scale;
        ctx.font = fontCss(bold, px * scale);
        if (halo) { ctx.lineWidth = 2 * TUNE.haloRatio * px * scale; ctx.strokeText(char, tx, ty); }
        ctx.fillText(char, tx, ty);
      }
      return ctx.getImageData(0, 0, width, height).data;
    };
    const ink = draw(false), outline = draw(true), texels = new Uint8Array(width * height * 2);
    for (let i = 0, n = width * height; i < n; i++) { texels[2 * i] = ink[4 * i + 3]; texels[2 * i + 1] = outline[4 * i + 3]; }
    pages = [{ width, height, texels }];
    for (const { g, x, y } of cells) g.uv = [x / width, y / height, (x + g.w * scale) / width, (y + g.h * scale) / height];
    rows = data.labels.map((label, index) => {
      const tier = tierOf(label), tierIndex = tierList.indexOf(tier), bold = tierFont[tierIndex];
      const px = fontPx[bold], lineH = TUNE.lineHeight * px, maxWidth = TUNE.maxWidthEm * px;
      const widthOf = s => { let w = 0; for (const c of s) w += glyphs.get(bold + c).advance; return w; };
      const lines = []; let line = '';
      for (const word of texts[index].split(/\s+/)) {
        const trial = line ? line + ' ' + word : word;
        if (line && widthOf(trial) > maxWidth) { lines.push(line); line = word; } else line = trial;
      }
      if (line) lines.push(line);
      const widths = lines.map(widthOf), w = Math.ceil(Math.max(...widths)), h = lines.length * lineH;
      // Local units are px at the weight's raster size; origin at the bottom
      // centre of the name, y up. Each line is centred, like the live layers.
      const runs = [];
      lines.forEach((s, i) => {
        let pen = -widths[i] / 2; const top = h - i * lineH;
        for (const c of s) { const g = glyphs.get(bold + c); runs.push({ g, x: pen - g.margin, top: top + g.margin }); pen += g.advance; }
      });
      const altitude = Math.max(0, label.height || 0) + (label.kind === 'place' ? TUNE.placeLift : TUNE.roofLift);
      const merc = maplibregl.MercatorCoordinate.fromLngLat([label.lng, label.lat], altitude);
      return { ...label, index, merc, altitude, w, h, runs, tier, tierIndex, pad: TUNE.tiers[tier].pad, alpha: 0, admitted: false,
        box: [0, 0, 0, 0], ndc: [0, 0, 0], target: 0, projected: false, distance: 0, strength: 0, score: 0 };
    });
  }
  function rgba(css) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data, n => n / 255);
  }
  function compile(gl, type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(message); }
    return s;
  }
  function initGL(gl) {
    const vs = compile(gl, gl.VERTEX_SHADER, `#version 300 es
      precision highp float; precision highp int;
      in vec2 a_pos; in vec2 a_uv; in float a_label; in float a_tier; in float a_role;
      uniform highp sampler2D u_anchors; uniform highp sampler2D u_depth; uniform vec2 u_pixelScale; uniform vec2 u_depthRange; uniform float u_depthBias;
      uniform float u_scale[8]; uniform float u_lift;
      out vec2 v_uv; out float v_alpha; out float v_role;
      void main(){int label=int(a_label);vec4 anchor=texelFetch(u_anchors,ivec2(label%256,label/256),0);
        vec2 px=a_pos*u_scale[int(a_tier)]+vec2(0.,u_lift);
        gl_Position=vec4(anchor.xy+px*u_pixelScale,anchor.z,1.);
        // Test the world anchor once per vertex, then draw the complete name.
        // Foreground geometry can hide a name, but cannot slice its letters.
        float scene=texture(u_depth,anchor.xy*0.5+0.5).r;
        float depth=mix(u_depthRange.x,u_depthRange.y,anchor.z*0.5+0.5);
        v_uv=a_uv;v_alpha=depth<=scene+u_depthBias?anchor.w:0.;v_role=a_role;}`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; uniform sampler2D u_atlas;
      uniform vec4 u_ink; uniform vec4 u_halo; uniform float u_hit; uniform float u_mipBias;
      in vec2 v_uv; in float v_alpha; in float v_role; out vec4 color;
      void main(){
        // The hit rectangle is only ever coloured by a tap's occlusion query.
        vec2 glyph=texture(u_atlas,v_uv,u_mipBias).rg;
        float cover=v_role>1.5?u_hit:v_role>0.5?glyph.r:glyph.g;
        vec4 t=v_role<0.5?u_halo:u_ink;
        float a=t.a*cover*v_alpha;
        if(a<0.005)discard;color=vec4(t.rgb*a,a);}`);
    const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const vao = gl.createVertexArray(), buffer = gl.createBuffer(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
    for (const [name, n, offset] of [['a_pos', 2, 0], ['a_uv', 2, 8], ['a_label', 1, 16], ['a_tier', 1, 20], ['a_role', 1, 24]]) {
      const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, FLOATS * 4, offset);
    }
    gl.activeTexture(gl.TEXTURE0); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const textures = pages.map(page => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Rows are width*2 bytes, a multiple of 4 for any even width, so the
      // upload is correct under MapLibre's unpack alignment without touching it.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, page.width, page.height, 0, gl.RG, gl.UNSIGNED_BYTE, page.texels);
      gl.generateMipmap(gl.TEXTURE_2D); return t;
    });
    // RGBA32F sampling requires no float render-target extension. Only a small
    // per-label anchor/alpha texture changes every frame; glyph geometry stays put.
    anchors = new Float32Array(anchorWidth * Math.max(1, Math.ceil(rows.length / anchorWidth)) * 4);
    const anchorTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, anchorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, anchorWidth, anchors.length / 4 / anchorWidth, 0, gl.RGBA, gl.FLOAT, anchors);
    gl.activeTexture(gl.TEXTURE0); packedRows.length = 0; packedFloats = 0;
    gl.bindVertexArray(null);
    const u = name => gl.getUniformLocation(program, name);
    return { program, vao, buffer, textures, anchorTexture,
      depthSampler: u('u_depth'), depthRange: u('u_depthRange'), depthBias: u('u_depthBias'),
      anchorSampler: u('u_anchors'), pixelScale: u('u_pixelScale'), sampler: u('u_atlas'),
      scale: u('u_scale'), lift: u('u_lift'), ink: u('u_ink'), halo: u('u_halo'), hit: u('u_hit'), mipBias: u('u_mipBias'),
      inkColor: rgba(TUNE.ink), dayHalo: rgba(TUNE.halo), nightHalo: rgba(TUNE.nightHalo), haloColor: new Float32Array(4) };
  }
  function release(gl) {
    restoreMarkers();
    clearTimeout(depthTimer);
    if (!gpu) return;
    if (!gl.isContextLost()) {
      if (gpu.depthTexture) gl.deleteTexture(gpu.depthTexture); if (gpu.depthFbo) gl.deleteFramebuffer(gpu.depthFbo);
      gpu.textures.forEach(t => gl.deleteTexture(t)); gl.deleteTexture(gpu.anchorTexture); gl.deleteBuffer(gpu.buffer);
      gl.deleteVertexArray(gpu.vao); gl.deleteProgram(gpu.program);
    }
    gpu = null;
  }
  function labelsOn() {
    const cap = window.__capture?.();
    return TUNE.on && ready && !failed && (cap?.labelsUrl == null ? !cap?.clip : cap.labelsUrl);
  }
  // Hidden layers remain as layout anchors for the independently loaded bakes.
  function sync() {
    if (!map || busy || disposed || !ready || failed) return;
    busy = true;
    try {
      if (!map.getLayer(ID)) map.addLayer(layer);
      for (const id of LEGACY) {
        if (!map.getLayer(id)) continue;
        const visibility = map.getLayoutProperty(id, 'visibility') || 'visible';
        if (!legacyVisibility.has(id)) legacyVisibility.set(id, visibility);
        if (TUNE.on && visibility !== 'none') map.setLayoutProperty(id, 'visibility', 'none');
        else if (!TUNE.on && visibility === 'none' && legacyVisibility.get(id) !== 'none') map.setLayoutProperty(id, 'visibility', legacyVisibility.get(id));
      }
      // Sky owns the position immediately before the symbol stack. Use the
      // actual order (getStyle omits custom layers), without fighting that hook.
      const order = map.style?._order;
      if (map.getLayer(ID) && order && order[order.length - 1] !== ID) map.moveLayer(ID);
    } finally { busy = false; }
  }
  function eyePosition() {
    // The controller synchronizes its eye after jumpTo/easeTo as well as flight.
    const e = window.__fly?.eye();
    return e || { lng: map.getCenter().lng, lat: map.getCenter().lat, alt: 300 };
  }
  // 0 by day, 1 at night: the same clock the live layers dim by.
  function nightAmount() {
    try { const p = window.__todCurrentP; return typeof p === 'number' && window.skyBodies ? Math.max(0, Math.min(1, window.skyBodies(p).night || 0)) : 0; }
    catch (e) { return 0; }
  }
  function layout(M, now) {
    if (boundsDirty || movingControls.size) cacheControlBounds();
    const W=canvasWidth,H=canvasHeight;
    let changed = layoutDirty || viewport[0] !== W || viewport[1] !== H;
    for (let i=0;i<16;i++) { if (lastMatrix[i] !== M[i]) changed = true; lastMatrix[i]=M[i]; }
    const n = nightAmount();
    if (Math.abs(n - night) > 0.001) {
      night = n; changed = true;
      for (let i = 0; i < tierList.length; i++) tierDim[i] = 1 - (TUNE.tiers[tierList[i]].nightDim || 0) * n;
    }
    // MapLibre moves DOM markers after custom layers render. Project their centers
    // now, so exclusions use this frame rather than the preceding DOM transform.
    if(changed) for(const marker of markerBoxes) {
      const p=map.project(marker.point),b=marker.box;
      b[0]=p.x-marker.w/2;b[1]=p.y-marker.h/2;b[2]=p.x+marker.w/2;b[3]=p.y+marker.h/2;
      const gap=TUNE.controlGapPx,edge=TUNE.edgePx,el=marker.el;
      const hidden=b[0]<edge || b[1]<edge || b[2]>W-edge || b[3]>H-edge ||
        fixedControlBoxes.some(r=>b[0]<r[2]+gap && b[2]+gap>r[0] && b[1]<r[3]+gap && b[3]+gap>r[1]);
      if(hidden && !hiddenMarkers.has(el)){hiddenMarkers.set(el,el.style.visibility);el.style.visibility='hidden';}
      else if(!hidden && hiddenMarkers.has(el)){el.style.visibility=hiddenMarkers.get(el);hiddenMarkers.delete(el);}
    }
    uploadDirty = changed || layoutFading;
    if (!uploadDirty) { lastTime=now; return viewport; }
    layoutDirty=false;
    // Text size follows map zoom on the live curves, per tier.
    const zoom = map.getZoom();
    for (let i = 0; i < tierList.length; i++) tierScale[i] = sizeAt(TUNE.tiers[tierList[i]].size, zoom) / fontPx[tierFont[i]];
    const eye = eyePosition(), limit = W < TUNE.phoneWidth ? TUNE.maxPhone : TUNE.maxDesktop;
    const dt = Math.min(80, lastTime ? now - lastTime : 16); lastTime = now;
    const blend = 1 - Math.exp(-dt / TUNE.fadeMs), lift = TUNE.liftPx;
    for (const r of drawn) { r.projected=false; r.target=0; }
    if (!nearbyEye || ((eye.lng-nearbyEye.lng)*96300)**2+((eye.lat-nearbyEye.lat)*111320)**2+(eye.alt-nearbyEye.alt)**2>TUNE.candidateRefreshMetres**2) {
      // Include dim names that have not entered drawn yet: a camera jump
      // must not resurrect their previous screen positions for one frame.
      for(const r of nearby){r.projected=false;r.target=0;}
      nearbyEye={...eye};
      nearby=rows.filter(r=>((r.lng-eye.lng)*96300)**2+((r.lat-eye.lat)*111320)**2+(r.altitude-eye.alt)**2<(TUNE.ranges[r.kind][1]+TUNE.candidateRefreshMetres*2)**2);
    }
    candidates.length = 0;
    for (const r of nearby) {
      r.target = 0; r.projected = false;
      if (only && !only.has(r.id)) continue;
      const dx = (r.lng - eye.lng) * 96300, dy = (r.lat - eye.lat) * 111320;
      const dz = r.altitude - eye.alt, range = TUNE.ranges[r.kind];
      // Most catalog entries are distant small places. An axis outside the
      // sphere proves rejection without a hypot; fading entries still project.
      if (r.alpha < TUNE.retireAlpha && (Math.abs(dx) >= range[1] || Math.abs(dy) >= range[1] || Math.abs(dz) >= range[1])) continue;
      const distanceSquared = dx*dx + dy*dy + dz*dz;
      if (distanceSquared >= range[1]*range[1] && r.alpha < TUNE.retireAlpha) continue;
      const distance = Math.sqrt(distanceSquared);
      const { x, y, z } = r.merc;
      const cw = M[3] * x + M[7] * y + M[11] * z + M[15]; if (cw <= 0) continue;
      const nx = (M[0] * x + M[4] * y + M[8] * z + M[12]) / cw;
      const ny = (M[1] * x + M[5] * y + M[9] * z + M[13]) / cw;
      const nz = (M[2] * x + M[6] * y + M[10] * z + M[14]) / cw;
      if (nz < -1 || nz > 1) continue;
      const sx = (nx + 1) * W / 2, sy = (1 - ny) * H / 2;
      const s = tierScale[r.tierIndex], w = r.w * s, h = r.h * s;
      if (sx < -w || sx > W + w || sy < 0 || sy > H + h + lift) continue;
      const box = r.box || (r.box = [0, 0, 0, 0]), ndc = r.ndc || (r.ndc = [0, 0, 0]);
      box[0] = sx - w / 2; box[1] = sy - lift - h; box[2] = sx + w / 2; box[3] = sy - lift;
      ndc[0] = nx; ndc[1] = ny; ndc[2] = nz; r.projected = true;
      r.distance = distance;
      r.strength = 1 - smooth((distance - range[0]) / (range[1] - range[0]));
      const edge = Math.min(box[0], W - box[2], box[1], H - box[3]);
      // Hard safety boundaries also apply to retiring names, during motion.
      if (edge < TUNE.edgePx || behindControl(box)) { r.alpha=0; r.projected=false; continue; }
      r.strength *= smooth(edge / TUNE.edgePx);
      if (r.strength <= 0) continue;
      r.score = TUNE.priority[r.kind] + (TUNE.tiers[r.tier].priority || 0) + 1 - distance / range[1] + (r.admitted ? TUNE.retainBonus : 0);
      candidates.push(r);
    }
    candidates.sort(byScore);
    admitted.length = 0;
    // Names never cover more than this much of the screen, whatever the zoom.
    const budget = TUNE.maxCoverage * W * H;
    let covered = 0;
    for (const r of candidates) {
      if (admitted.length >= limit) break;
      const b = r.box, area = (b[2] - b[0]) * (b[3] - b[1]);
      if (covered + area > budget) continue;
      let blocked = false;
      for (let i = 0; i < admitted.length; i++) if (clash(r, admitted[i])) { blocked = true; break; }
      if (blocked) continue;
      r.target = r.strength; admitted.push(r); fadingRows.add(r); covered += area;
    }
    coverage = W * H ? covered / (W * H) : 0;
    drawn.length = 0;
    let fading = false;
    // Only admitted or still-fading names have alpha work. Keep catalog order
    // so retiring-name collision decisions and packed glyph order stay stable.
    fadeOrder.length=0;
    for(const r of fadingRows)fadeOrder.push(r);
    fadeOrder.sort((a,b)=>a.index-b.index);
    for (const r of fadeOrder) {
      r.admitted = r.target > 0;
      if (!r.target && !r.alpha) {fadingRows.delete(r);continue;}
      r.alpha += (r.target - r.alpha) * blend;
      if (Math.abs(r.alpha - r.target) > 0.002) fading = true;
      if (r.alpha < TUNE.retireAlpha && !r.target) { r.alpha = 0; fadingRows.delete(r); continue; }
      // Never reuse a stale projected box when a point goes behind the eye.
      if (r.projected && r.alpha > TUNE.retireAlpha) {
        if (!r.admitted && (admitted.some(other=>other!==r && clash(r, other)) || drawn.some(other=>other!==r && clash(r, other)))) {r.alpha=0;fadingRows.delete(r);continue;}
        drawn.push(r);
      }
    }
    // Conflicting retiring names disappear whole; positions follow the camera.
    layoutFading = fading;
    if (fading) map.triggerRepaint();
    viewport[0] = W; viewport[1] = H;
    return viewport;
  }
  let geometryDirty = false;
  // Hit rectangle first (a tap's occlusion query draws exactly these six
  // vertices), then every outline, then every letter on top of the outlines.
  function localGeometry(r) {
    if (r.geometry) return r.geometry;
    const data = new Float32Array((1 + 2 * r.runs.length) * QUAD); let cursor = 0;
    const quad = (left, top, w, h, uv, role) => {
      for (let i = 0; i < 12; i += 2) {
        const rightSide = corners[i], bottomSide = corners[i + 1];
        data[cursor++] = rightSide ? left + w : left;
        data[cursor++] = bottomSide ? top - h : top;
        data[cursor++] = uv[rightSide ? 2 : 0]; data[cursor++] = uv[bottomSide ? 3 : 1];
        data[cursor++] = r.index; data[cursor++] = r.tierIndex; data[cursor++] = role;
      }
    };
    quad(-r.w / 2, r.h, r.w, r.h, [0, 0, 0, 0], ROLE_HIT);
    for (const run of r.runs) quad(run.x, run.top, run.g.w, run.g.h, run.g.uv, ROLE_HALO);
    for (const run of r.runs) quad(run.x, run.top, run.g.w, run.g.h, run.g.uv, ROLE_INK);
    r.geometry = data; return data;
  }
  function packGeometry() {
    geometryDirty = packedRows.length !== drawn.length;
    for (let i = 0; !geometryDirty && i < drawn.length; i++) geometryDirty = packedRows[i] !== drawn[i];
    if (!geometryDirty) return packedFloats;
    packedRows.length = 0; let cursor = 0;
    for (const r of drawn) {
      r.firstVertex = cursor / FLOATS;
      const data = localGeometry(r), count = Math.min(data.length, Math.floor((vertices.length - cursor) / QUAD) * QUAD);
      vertices.set(count === data.length ? data : data.subarray(0, count), cursor);
      cursor += count; packedRows.push(r);
    }
    packedFloats = cursor; return cursor;
  }
  function copyDepth(gl) {
    const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;
    const count=window.slopesApartments?.count?.done || 0;
    if(count!==depthModelCount){depthModelCount=count;depthDirty=true;}
    const refresh=depthDirty || uploadDirty || !gpu.depthTexture || performance.now()-(gpu.depthTime||0)>TUNE.depthRefreshMs;
    if (!refresh) {
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,gpu.depthTexture);gl.uniform1i(gpu.depthSampler,2);return;
    }
    gpu.depthTime=performance.now();depthDirty=false;
    clearTimeout(depthTimer);depthTimer=setTimeout(()=>{depthDirty=true;map?.triggerRepaint();},TUNE.depthRefreshMs);
    // MapLibre tracks these bindings before invoking custom layers. Reading
    // its cache avoids synchronous driver queries on every moving frame.
    const context=map.painter?.context;
    const source=context?.bindFramebuffer ? context.bindFramebuffer.current : gl.getParameter(gl.FRAMEBUFFER_BINDING);
    if (!gpu.depthTexture || gpu.depthW!==W || gpu.depthH!==H) {
      if(gpu.depthTexture)gl.deleteTexture(gpu.depthTexture);
      if(gpu.depthFbo)gl.deleteFramebuffer(gpu.depthFbo);
      gpu.depthW=W;gpu.depthH=H;gpu.depthTexture=gl.createTexture();gpu.depthFbo=gl.createFramebuffer();
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,gpu.depthTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH24_STENCIL8,W,H,0,gl.DEPTH_STENCIL,gl.UNSIGNED_INT_24_8,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,gpu.depthFbo);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,gpu.depthTexture,0);
      gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
      if(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Label depth framebuffer incomplete');
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,source);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,gpu.depthFbo);
    gl.disable(gl.SCISSOR_TEST);
    // The shader samples only name anchors. Copy their enclosing rectangle
    // at native resolution; the rest of the depth texture is never sampled.
    // Clamp like CLAMP_TO_EDGE and include a pixel guard for GPU rounding.
    if (drawn.length) {
      let x0=W,y0=H,x1=0,y1=0;
      for (const r of drawn) {
        const x=Math.max(0,Math.min(W-1,Math.floor((r.ndc[0]*.5+.5)*W)));
        const y=Math.max(0,Math.min(H-1,Math.floor((r.ndc[1]*.5+.5)*H)));
        x0=Math.min(x0,x-1);y0=Math.min(y0,y-1);
        x1=Math.max(x1,x+2);y1=Math.max(y1,y+2);
      }
      x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(W,x1);y1=Math.min(H,y1);
      gl.blitFramebuffer(x0,y0,x1,y1,x0,y0,x1,y1,gl.DEPTH_BUFFER_BIT,gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,source);
    if(!gpu.depthChecked){const error=gl.getError();if(error)throw Error('Label depth copy failed: GL '+error);gpu.depthChecked=true;}
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,gpu.depthTexture);
    gl.uniform1i(gpu.depthSampler,2);gl.uniform2fv(gpu.depthRange,context?.depthRange?.current || gl.getParameter(gl.DEPTH_RANGE));gl.uniform1f(gpu.depthBias,TUNE.depthBias);
  }
  const layer = {
    id: ID, type: 'custom', renderingMode: '3d',
    onAdd() { disposed = false; lastTime = 0; },
    onRemove(_map, gl) { release(gl); },
    render(gl, args) {
      if (!labelsOn() || gl.isContextLost()) {if(hiddenMarkers.size)restoreMarkers();return;}
      try {
        if (!gpu) gpu = initGL(gl);
        const M = args.defaultProjectionData?.mainMatrix; if (!M) return;
        const started = performance.now(), [W, H] = layout(M, started);
        gl.useProgram(gpu.program); gl.bindVertexArray(gpu.vao); gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
        copyDepth(gl);
        gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
        // Keep the depth range MapLibre supplies. Resetting it to [0,1]
        // would compare labels with a different depth scale than the city.
        gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.colorMask(true, true, true, true); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(gpu.sampler, 0);
        const halo = gpu.haloColor;
        for (let i = 0; i < 4; i++) halo[i] = gpu.dayHalo[i] + (gpu.nightHalo[i] - gpu.dayHalo[i]) * Math.max(0, night);
        gl.uniform4fv(gpu.ink, gpu.inkColor); gl.uniform4fv(gpu.halo, halo);
        gl.uniform1fv(gpu.scale, tierScale); gl.uniform1f(gpu.lift, TUNE.liftPx);
        gl.uniform1f(gpu.hit, 0); gl.uniform1f(gpu.mipBias, TUNE.mipBias);
        const cursor = packGeometry();
        for (const r of drawn) {
          const offset = r.index * 4;
          anchors[offset] = r.ndc[0]; anchors[offset + 1] = r.ndc[1];
          anchors[offset + 2] = r.ndc[2]; anchors[offset + 3] = r.alpha * tierDim[r.tierIndex];
        }
        if (cursor) {
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gpu.anchorTexture);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          if (uploadDirty || geometryDirty) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, anchorWidth, anchors.length / 4 / anchorWidth, gl.RGBA, gl.FLOAT, anchors);
          gl.uniform1i(gpu.anchorSampler, 1); gl.uniform2f(gpu.pixelScale, 2 / W, 2 / H);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gpu.textures[0]);
          if (geometryDirty) gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, cursor));
          gl.drawArrays(gl.TRIANGLES, 0, cursor / FLOATS);
        }
        if (pendingTap) {
          const tap = pendingTap; pendingTap = null;
          const r = drawn.find(r => r.id === tap.id && r.alpha > 0.8);
          if (!r) tap.resolve(null);
          else {
            // Only on a tap: asynchronously test this exact screen pixel
            // against the same depth buffer and name rectangle as rendering.
            const query = gl.createQuery();
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(Math.floor(tap.x * gl.drawingBufferWidth / W), gl.drawingBufferHeight - 1 - Math.floor(tap.y * gl.drawingBufferHeight / H), 1, 1);
            gl.colorMask(false, false, false, false); gl.uniform1f(gpu.hit, 1);
            gl.beginQuery(gl.ANY_SAMPLES_PASSED, query); gl.drawArrays(gl.TRIANGLES, r.firstVertex, 6); gl.endQuery(gl.ANY_SAMPLES_PASSED);
            gl.uniform1f(gpu.hit, 0); gl.colorMask(true, true, true, true); gl.disable(gl.SCISSOR_TEST);
            const poll = () => {
              if (gl.isContextLost() || performance.now() > tap.deadline) { gl.deleteQuery(query); tap.resolve(null); return; }
              if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { setTimeout(poll, 16); return; }
              const visible = gl.getQueryParameter(query, gl.QUERY_RESULT); gl.deleteQuery(query);
              tap.resolve(visible ? { type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: { name: r.name, label: r.name } } : null);
            };
            setTimeout(poll, 0);
          }
        }
        gl.bindVertexArray(null);
        lastMs = performance.now() - started; maxMs = Math.max(maxMs, lastMs); totalMs += lastMs; frameCount++;
      } catch (error) {
        failed = String(error); console.error('[name labels]', error);
        setTimeout(() => { for (const [id, visibility] of legacyVisibility) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility); }, 0);
      }
    },
  };
  window.nameLabels = {
    replaces: id => ready && !failed && TUNE.on && LEGACY.has(id),
    sync,
    stats: () => ({ ready, failed, total: rows.length, pages: pages.length,
      atlas: pages[0] ? [pages[0].width, pages[0].height] : null,
      textureMiB: pages.reduce((s, p) => s + p.width * p.height * 2 * 4 / 3, 0) / 1048576,
      anchorTextureBytes: anchors?.byteLength || 0, controlBoxes: controlBoxes.map(b=>b.slice()),
      depthTextureBytes: (gpu?.depthW||0)*(gpu?.depthH||0)*4,
      submitted: drawn.length, coverage, night: Math.max(0, night), sizes: Object.fromEntries(tierList.map((t, i) => [t, +(tierScale[i] * fontPx[tierFont[i]]).toFixed(2)])),
      cpuMs: lastMs, cpuMeanMs: frameCount ? totalMs / frameCount : 0, cpuMaxMs: maxMs,
      renderTime: lastTime, renderCount: frameCount,
      // Stats are snapshots: the render loop reuses each row's projection box.
      drawn: drawn.map(r => ({ id: r.id, name: r.name, kind: r.kind, tier: r.tier, alpha: +r.alpha.toFixed(3), distance: Math.round(r.distance), box: r.box.slice() })) }),
    // Verification can isolate a real label for the depth-mask control.
    isolate: ids => { only = ids ? new Set(ids) : null; layoutDirty=true; nearbyEye=null; rows.forEach(r => { r.alpha = 0; r.admitted = false; }); map?.triggerRepaint(); },
    hitTest: (x, y) => {
      if (!labelsOn()) return null;
      const r = drawn.find(r => r.alpha > 0.8 && x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3]);
      if (!r) return null;
      pendingTap?.resolve(null);
      return new Promise(resolve => {
        pendingTap = { id: r.id, x, y, resolve, deadline: performance.now() + 750 };
        setTimeout(() => resolve(null), 800); map.triggerRepaint();
      });
    },
  };
  window.initNameLabels = async function (m) {
    if (!TUNE.on || map) return;
    map = m;
    map.on('sourcedata',()=>{depthDirty=true;});
    map.on('styledata',()=>{depthDirty=true;});
    watchControlBounds();
    try {
      const response = await fetch('data/labels.json'); if (!response.ok) throw new Error('label catalog HTTP ' + response.status);
      atlas(await response.json()); ready = true;
      map.on('styledata', sync);
      map.getCanvas().addEventListener('webglcontextlost', () => { gpu = null; });
      map.getCanvas().addEventListener('webglcontextrestored', () => { gpu = null; map.triggerRepaint(); });
      sync(); map.triggerRepaint();
    } catch (error) { failed = String(error); console.error('[name labels]', error); }
  };
})();
