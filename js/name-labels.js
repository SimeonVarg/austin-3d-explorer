/* One place-name system. Streets and architectural sign geometry are unchanged.
 * Colours are categories, never unsourced brand colours: mint = homes,
 * amber = campus buildings, blue = landmarks, neutral = small places.
 * UT entries include their verified building codes. All text is white.
 *
 * Whole cards use their world anchor against MapLibre's GPU depth, including authored meshes.
 * A GPU-only depth copy prevents foreground geometry slicing card text. No
 * depth readback, raycast, geometry rebuild, per-frame glyph-atlas upload, or
 * per-label DOM node. One shared glyph atlas and one draw call for all names.
 * ?namelabels=0 retains the original layers for repeatable before/after tests.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const TUNE = window.NAME_LABELS = {
    on: q.get('namelabels') !== '0',
    fontFamily: 'Arial, sans-serif', fontWeight: 600, fontPx: 14, linePx: 17,
    maxTextWidth: 188, padX: 10, padY: 6, dotGap: 9,
    ink: '#f7f9fc', background: 'rgba(15,22,32,0.91)',
    border: 'rgba(232,240,250,0.22)', radius: 6,
    colors: { apartment: '#93dfc6', campus: '#ffc27d', landmark: '#afceff', place: '#cdd3de' },
    // Distances are metres from the eye, not map zoom (phones share this rule).
    ranges: { apartment: [820, 1350], campus: [1000, 1650], landmark: [1500, 2500], place: [100, 200] },
    priority: { apartment: 3, campus: 3, landmark: 3.4, place: 1 },
    roofLift: 3, placeLift: 3, stemPx: 7, gapPx: 9, edgePx: 8, controlGapPx: 8,
    maxDesktop: 40, maxPhone: 16, phoneWidth: 600,
    fadeMs: 220, retainBonus: 0.12, retireAlpha: 0.025,
    atlasSize: 1024, rasterScale: 2,
    depthBias: 0.000002, depthRefreshMs: 1000, candidateRefreshMetres: 60,
  };
  const LEGACY = new Set(['signs-label', 'buildings-labels-major', 'buildings-labels-mid',
    'buildings-labels', 'places-label', 'props-art-label', 'entrances-inscription', 'entrances-wordmark']);
  const ID = 'city-name-labels';
  let map, rows = [], pages = [], gpu, ready = false, busy = false, disposed = false;
  let lastTime = 0, drawn = [], lastMs = 0, maxMs = 0, frameCount = 0, totalMs = 0;
  let failed = null, only = null, pendingTap = null;
  const legacyVisibility = new Map();
  // Immutable local glyph geometry is repacked only when submitted membership changes.
  const vertices = new Float32Array(6 * 11 * 5000);
  const packedRows = []; let packedFloats = 0, geometryKey = '';
  let depthTimer, depthDirty = true, depthModelCount = -1;
  let anchors; const anchorWidth = 256;
  const corners = [0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1];
  let glyphs = new Map();
  let nearby = [], nearbyEye = null;
  const fadingRows = new Set(), fadeOrder = [];
  const candidates = [], admitted = [], viewport = [0, 0], solidUV = [0, 0, 1, 1];
  const byScore = (a, b) => b.score - a.score || a.index - b.index;
  const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
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

  function linesFor(ctx, name) {
    const words = name.split(/\s+/), lines = []; let line = '';
    for (const word of words) {
      const trial = line ? line + ' ' + word : word;
      if (line && ctx.measureText(trial).width > TUNE.maxTextWidth) { lines.push(line); line = word; }
      else line = trial;
    }
    if (line) lines.push(line);
    return lines;
  }
  function atlas(data) {
    const scale = TUNE.rasterScale, size = TUNE.atlasSize;
    const font = px => `${TUNE.fontWeight} ${px}px ${TUNE.fontFamily}`;
    const measure = document.createElement('canvas').getContext('2d'); measure.font = font(TUNE.fontPx); measure.fontKerning = 'none';
    const tints = Object.fromEntries(Object.entries(TUNE.colors).map(([kind, color]) => [kind, rgba(color)]));
    const page = document.createElement('canvas'); page.width = page.height = size;
    pages = [page]; glyphs = new Map();
    const ctx = page.getContext('2d');
    ctx.font = font(TUNE.fontPx * scale);
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
    let x = 2, y = 2, rowH = 0;
    const chars = new Set(Array.from('●' + data.labels.map(r => r.name + (r.code ? ' · ' + r.code : '')).join('')));
    for (const char of chars) {
      const advance = measure.measureText(char).width;
      const w = Math.ceil(advance + 4), h = TUNE.linePx + 4;
      const tw = w * scale, th = h * scale;
      if (x + tw + 2 > size) { x = 2; y += rowH + 2; rowH = 0; }
      if (y + th + 2 > size) throw new Error('Name-label glyph atlas is full');
      ctx.fillText(char, x + 2 * scale, y + h * scale / 2);
      glyphs.set(char, { advance, w, h, uv: [x / size, y / size, (x + tw) / size, (y + th) / size] });
      x += tw + 2; rowH = Math.max(rowH, th);
    }
    rows = data.labels.map((label, index) => {
      const text = label.code && !label.name.includes(label.code) ? label.name + ' · ' + label.code : label.name;
      const lines = linesFor(measure, text);
      const w = Math.ceil(Math.max(...lines.map(s => measure.measureText(s).width)) + TUNE.padX * 2 + TUNE.dotGap);
      const h = TUNE.padY * 2 + lines.length * TUNE.linePx;
      const runs = [];
      lines.forEach((line, i) => {
        let pen = TUNE.padX + TUNE.dotGap - 2;
        for (const char of line) {
          const g = glyphs.get(char); runs.push({ g, x: pen, y: TUNE.padY + i * TUNE.linePx - 2 }); pen += g.advance;
        }
      });
      const altitude = Math.max(0, label.height || 0) + (label.kind === 'place' ? TUNE.placeLift : TUNE.roofLift);
      const merc = maplibregl.MercatorCoordinate.fromLngLat([label.lng, label.lat], altitude);
      return { ...label, index, merc, altitude, w, h: h + TUNE.stemPx, runs, tint: tints[label.kind], alpha: 0, admitted: false,
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
      in vec2 a_pos; in vec2 a_uv; in float a_label; in vec4 a_tint; in vec2 a_size;
      uniform highp sampler2D u_anchors; uniform highp sampler2D u_depth; uniform vec2 u_pixelScale; uniform vec2 u_depthRange; uniform float u_depthBias;
      out vec2 v_uv; out float v_alpha; out vec4 v_tint; out vec2 v_size;
      void main(){int label=int(a_label);vec4 anchor=texelFetch(u_anchors,ivec2(label%256,label/256),0);
        gl_Position=vec4(anchor.xy+a_pos*u_pixelScale,anchor.z,1.);
        // Test the world anchor once per vertex, then draw a complete overlay card.
        // Foreground geometry can hide a name, but cannot slice its letters.
        float scene=texture(u_depth,anchor.xy*0.5+0.5).r;
        float depth=mix(u_depthRange.x,u_depthRange.y,anchor.z*0.5+0.5);
        v_uv=a_uv;v_alpha=depth<=scene+u_depthBias?anchor.w:0.;v_tint=a_tint;v_size=a_size;}`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; uniform sampler2D u_atlas;
      uniform float u_radius; uniform vec4 u_border;
      in vec2 v_uv; in float v_alpha; in vec4 v_tint; in vec2 v_size; out vec4 color;
      void main(){vec4 t=v_tint;
        if(v_size.x>0.){
          float radius=min(u_radius,min(v_size.x,v_size.y)*0.5);
          vec2 d=abs((v_uv-0.5)*v_size)-(v_size*0.5-vec2(radius));
          float sd=length(max(d,0.))+min(max(d.x,d.y),0.)-radius;
          t=mix(t,u_border,smoothstep(-1.5,-0.5,sd));t.a*=1.-smoothstep(-0.5,0.5,sd);
        }else{t.a*=texture(u_atlas,v_uv).a;}
        float a=t.a*v_alpha;
        if(a<0.005)discard;color=vec4(t.rgb*a,a);}`);
    const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const vao = gl.createVertexArray(), buffer = gl.createBuffer(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
    for (const [name, n, offset] of [['a_pos', 2, 0], ['a_uv', 2, 8], ['a_label', 1, 16], ['a_tint', 4, 20], ['a_size', 2, 36]]) {
      const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 44, offset);
    }
    gl.activeTexture(gl.TEXTURE0); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const textures = pages.map(page => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page); return t;
    });
    // RGBA32F sampling requires no float render-target extension. Only a small
    // per-label anchor/alpha texture changes every frame; glyph UV/tint stays put.
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
    return { program, vao, buffer, textures, anchorTexture,
      depthSampler: gl.getUniformLocation(program,'u_depth'), depthRange: gl.getUniformLocation(program,'u_depthRange'), depthBias: gl.getUniformLocation(program,'u_depthBias'),
      anchorSampler: gl.getUniformLocation(program, 'u_anchors'), pixelScale: gl.getUniformLocation(program, 'u_pixelScale'), sampler: gl.getUniformLocation(program, 'u_atlas'), radius: gl.getUniformLocation(program, 'u_radius'), border: gl.getUniformLocation(program, 'u_border'), ink: rgba(TUNE.ink), background: rgba(TUNE.background), borderColor: rgba(TUNE.border) };
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
  function layout(M, now) {
    if (boundsDirty || movingControls.size) cacheControlBounds();
    const W=canvasWidth,H=canvasHeight;
    let changed = layoutDirty || viewport[0] !== W || viewport[1] !== H;
    for (let i=0;i<16;i++) { if (lastMatrix[i] !== M[i]) changed = true; lastMatrix[i]=M[i]; }
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
    const eye = eyePosition(), limit = W < TUNE.phoneWidth ? TUNE.maxPhone : TUNE.maxDesktop;
    const dt = Math.min(80, lastTime ? now - lastTime : 16); lastTime = now;
    const blend = 1 - Math.exp(-dt / TUNE.fadeMs);
    for (const r of drawn) { r.projected=false; r.target=0; }
    if (!nearbyEye || ((eye.lng-nearbyEye.lng)*96300)**2+((eye.lat-nearbyEye.lat)*111320)**2+(eye.alt-nearbyEye.alt)**2>TUNE.candidateRefreshMetres**2) {
      // Include dim cards that have not entered drawn yet: a camera jump
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
      if (sx < -r.w || sx > W + r.w || sy < 0 || sy > H + r.h) continue;
      const box = r.box || (r.box = [0, 0, 0, 0]), ndc = r.ndc || (r.ndc = [0, 0, 0]);
      box[0] = sx - r.w / 2; box[1] = sy - r.h; box[2] = sx + r.w / 2; box[3] = sy;
      ndc[0] = nx; ndc[1] = ny; ndc[2] = nz; r.projected = true;
      r.distance = distance;
      r.strength = 1 - smooth((distance - range[0]) / (range[1] - range[0]));
      const edge = Math.min(r.box[0], W - r.box[2], r.box[1], H - sy);
      // Hard safety boundaries also apply to retiring cards, during motion.
      if (edge < TUNE.edgePx || behindControl(r.box)) { r.alpha=0; r.projected=false; continue; }
      r.strength *= smooth(edge / TUNE.edgePx);
      if (r.strength <= 0) continue;
      r.score = TUNE.priority[r.kind] + 1 - distance / range[1] + (r.admitted ? TUNE.retainBonus : 0);
      candidates.push(r);
    }
    candidates.sort(byScore);
    admitted.length = 0;
    const gap = TUNE.gapPx;
    for (const r of candidates) {
      const b = r.box;
      if (admitted.length >= limit) break;
      let blocked = false;
      for (let i = 0; i < admitted.length; i++) {
        const c = admitted[i].box;
        if (b[0] < c[2] + gap && b[2] + gap > c[0] && b[1] < c[3] + gap && b[3] + gap > c[1]) { blocked = true; break; }
      }
      if (blocked) continue;
      r.target = r.strength; admitted.push(r); fadingRows.add(r);
    }
    drawn.length = 0;
    let fading = false;
    // Only admitted or still-fading cards have alpha work. Keep catalog order
    // so retiring-card collision decisions and packed glyph order stay stable.
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
        const b=r.box;
        if (!r.admitted && admitted.concat(drawn).some(other=>other!==r && b[0]<other.box[2]+gap && b[2]+gap>other.box[0] && b[1]<other.box[3]+gap && b[3]+gap>other.box[1])) {r.alpha=0;fadingRows.delete(r);continue;}
        drawn.push(r);
      }
    }
    // Conflicting retiring cards disappear whole; positions follow the camera.
    layoutFading = fading;
    if (fading) map.triggerRepaint();
    viewport[0] = W; viewport[1] = H;
    return viewport;
  }
  let geometryDirty = false;
  function localGeometry(r, key) {
    if (r.geometry && r.geometryKey === key) return r.geometry;
    const data = new Float32Array((r.runs.length + 3) * 6 * 11); let cursor = 0;
    const quad = (bx, by, w, h, uv, tint, solid) => {
      const left = -r.w / 2 + bx, right = left + w;
      const top = r.h - by, bottom = top - h;
      for (let i = 0; i < 12; i += 2) {
        const rightSide = corners[i], bottomSide = corners[i + 1];
        data[cursor++] = rightSide ? right : left;
        data[cursor++] = bottomSide ? bottom : top;
        data[cursor++] = uv[rightSide ? 2 : 0]; data[cursor++] = uv[bottomSide ? 3 : 1];
        data[cursor++] = r.index;
        data[cursor++] = tint[0]; data[cursor++] = tint[1]; data[cursor++] = tint[2]; data[cursor++] = tint[3];
        data[cursor++] = solid ? w : 0; data[cursor++] = solid ? h : 0;
      }
    };
    const dot = glyphs.get('●');
    quad(0, 0, r.w, r.h - TUNE.stemPx, solidUV, gpu.background, true);
    quad(r.w / 2 - 0.5, r.h - TUNE.stemPx, 1, TUNE.stemPx, solidUV, r.tint, true);
    quad(TUNE.padX - dot.w / 2, TUNE.padY - 2, dot.w, dot.h, dot.uv, r.tint, false);
    for (const run of r.runs) quad(run.x, run.y, run.g.w, run.g.h, run.g.uv, gpu.ink, false);
    r.geometryKey = key; r.geometry = data; return data;
  }
  function packGeometry() {
    const key = TUNE.stemPx + '/' + TUNE.padX + '/' + TUNE.padY;
    geometryDirty = geometryKey !== key || packedRows.length !== drawn.length;
    for (let i = 0; !geometryDirty && i < drawn.length; i++) geometryDirty = packedRows[i] !== drawn[i];
    if (!geometryDirty) return packedFloats;
    geometryKey = key; packedRows.length = 0; let cursor = 0;
    for (const r of drawn) {
      r.firstVertex = cursor / 11;
      const data = localGeometry(r, key), count = Math.min(data.length, Math.floor((vertices.length - cursor) / 66) * 66);
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
    // The shader samples only card anchors. Copy their enclosing rectangle
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
        gl.uniform1f(gpu.radius, TUNE.radius); gl.uniform4fv(gpu.border, gpu.borderColor);
        const cursor = packGeometry();
        for (const r of drawn) {
          const offset = r.index * 4;
          anchors[offset] = r.ndc[0]; anchors[offset + 1] = r.ndc[1];
          anchors[offset + 2] = r.ndc[2]; anchors[offset + 3] = r.alpha;
        }
        if (cursor) {
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gpu.anchorTexture);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          if (uploadDirty || geometryDirty) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, anchorWidth, anchors.length / 4 / anchorWidth, gl.RGBA, gl.FLOAT, anchors);
          gl.uniform1i(gpu.anchorSampler, 1); gl.uniform2f(gpu.pixelScale, 2 / W, 2 / H);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gpu.textures[0]);
          if (geometryDirty) gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, cursor));
          gl.drawArrays(gl.TRIANGLES, 0, cursor / 11);
        }
        if (pendingTap) {
          const tap = pendingTap; pendingTap = null;
          const r = drawn.find(r => r.id === tap.id && r.alpha > 0.8);
          if (!r) tap.resolve(null);
          else {
            // Only on a tap: asynchronously test this exact screen pixel
            // against the same depth buffer and rounded panel as rendering.
            const query = gl.createQuery();
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(Math.floor(tap.x * gl.drawingBufferWidth / W), gl.drawingBufferHeight - 1 - Math.floor(tap.y * gl.drawingBufferHeight / H), 1, 1);
            gl.colorMask(false, false, false, false);
            gl.beginQuery(gl.ANY_SAMPLES_PASSED, query); gl.drawArrays(gl.TRIANGLES, r.firstVertex, 6); gl.endQuery(gl.ANY_SAMPLES_PASSED);
            gl.colorMask(true, true, true, true); gl.disable(gl.SCISSOR_TEST);
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
    stats: () => ({ ready, failed, total: rows.length, pages: pages.length, textureMiB: pages.length * TUNE.atlasSize ** 2 * 4 / 1048576,
      anchorTextureBytes: anchors?.byteLength || 0, controlBoxes: controlBoxes.map(b=>b.slice()),
      depthTextureBytes: (gpu?.depthW||0)*(gpu?.depthH||0)*4,
      submitted: drawn.length, cpuMs: lastMs, cpuMeanMs: frameCount ? totalMs / frameCount : 0, cpuMaxMs: maxMs,
      renderTime: lastTime, renderCount: frameCount,
      // Stats are snapshots: the render loop reuses each row's projection box.
      drawn: drawn.map(r => ({ id: r.id, name: r.name, kind: r.kind, alpha: +r.alpha.toFixed(3), distance: Math.round(r.distance), box: r.box.slice() })) }),
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
