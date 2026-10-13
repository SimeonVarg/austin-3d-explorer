/**
 * gltf-look.js — a Blender-built building drawn with THE APP'S LIGHT (js/city-sky.js). Fetched only with ?gltf=1, for table rows
 * of js/gltf-layer.js that name a `look` file (a glTF WITH its Blender materials, written by scripts/blender_export_look.py).
 *
 * WHAT IT DRAWS. One mesh per building (and one more for see-through glass), in the city's own three.js scene, so it shares the
 * depth buffer, the fog and the hour. Its shader is this file's own:
 *   walls   colour times (light from the whole sky, less in recesses by the map baked in Blender, plus the sun through the app's own
 *           shadow maps) — no painted "lit colour", no light gain per building
 *   glass   a dark pane plus a mirror of the same sky, in the mirror colour the Blender material has
 *   night   rooms lit by the city's own rules (CityNight.room by floor and column), the sign lit, the city's lamps
 * Nothing in it is tuned per building: every number comes from the file or from js/city-sky.js.
 *
 * WHAT IT NEEDS FROM A FILE (checked, a wrong file is refused): positions, normals and one UV set as float32; per material the base
 * colour, and for glass the `extras` the export writes (look_kind, look_glossy, look_transparent); beside it `<name>-sky.png`, the
 * sky-light map the UV set points into. Frame: glTF's (Y up), the model's X along its street face and its ground at 0.
 */
(function () {
  'use strict';
  const GLTF = window.GLTF_LAYER, info = GLTF.info;
  const cf = (row, k) => (row && row[k] !== undefined ? row[k] : GLTF[k]);
  const hex3 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

  // ── the file ────────────────────────────────────────────────────────────
  function parseLook(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67 || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2.0 binary');
    const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
    const bo = 20 + jl, bin = new Uint8Array(buf, bo + 8, dv.getUint32(bo, true));
    if (json.images && json.images.length) throw new Error('the file carries images');
    const f32 = (i, n) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; if (a.componentType !== 5126 || bv.byteStride) throw new Error('float32, tightly packed, expected'); return new Float32Array(bin.buffer.slice(bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0) + a.count * n * 4)); };
    const ints = i => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView], o = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), C = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType]; return Uint32Array.from(new C(bin.buffer.slice(o, o + a.count * C.BYTES_PER_ELEMENT))); };
    // a colour per vertex (painted panes): floats, or bytes / shorts meaning 0..1; three or four numbers each
    const colours = i => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = a.type === 'VEC4' ? 4 : 3, C = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType], k = { 5126: 1, 5123: 1 / 65535, 5121: 1 / 255 }[a.componentType];
      const o = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * C.BYTES_PER_ELEMENT, view = new DataView(bin.buffer, o), get = { 5126: 'getFloat32', 5123: 'getUint16', 5121: 'getUint8' }[a.componentType], res = new Float32Array(a.count * 3);
      for (let v = 0; v < a.count; v++) for (let c = 0; c < 3; c++) res[v * 3 + c] = view[get](v * stride + c * C.BYTES_PER_ELEMENT, true) * k;
      return res; };
    const out = [];
    for (const node of json.nodes || []) {
      if (node.mesh == null) continue;
      if (node.matrix || node.translation || node.rotation || node.scale) throw new Error('node transforms are not supported (apply them in Blender)');
      for (const p of json.meshes[node.mesh].primitives) {
        const m = json.materials[p.material] || {}, pbr = m.pbrMetallicRoughness || {}, ex = m.extras || {};
        if (p.attributes.NORMAL == null || p.attributes.TEXCOORD_0 == null) throw new Error('normals and a UV set are needed');
        out.push({ material: (m.name || 'default').replace(/\.\d+$/, ''), base: (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3), glass: ex.look_kind === 'glass',
          mirror: ex.look_kind === 'glass' ? ex.look_glossy : [0, 0, 0], seeThrough: ex.look_transparent || 0, transmit: ex.look_transmit || [1, 1, 1],
          paint: p.attributes.COLOR_0 != null && ex.look_painted ? colours(p.attributes.COLOR_0) : null,
          pos: f32(p.attributes.POSITION, 3), nrm: f32(p.attributes.NORMAL, 3), uv: f32(p.attributes.TEXCOORD_1 != null ? p.attributes.TEXCOORD_1 : p.attributes.TEXCOORD_0, 2), idx: ints(p.indices) });   // the sky-light set is the mesh's last UV set (a mesh made from text brings one of its own first)
      }
    }
    return out;
  }

  // ── the shader ──────────────────────────────────────────────────────────
  const VERT = `
    attribute vec3 aBase; attribute vec3 aMirror; attribute vec3 aNight; attribute float aGlass; attribute vec4 aThin;
    uniform vec3 u_eye; uniform float u_lookFar, u_lookPx, u_lookPass;
    varying vec3 v_pos, v_normal, v_base, v_mirror, v_night; varying vec2 v_uv; varying float v_glass, v_cover;
    void main() {
      vec3 pos = position; v_cover = 1.0;
      // FAR (GLTF.look.far): a part thinner than a pixel is drawn one pixel wide and counts for the share of that pixel it really
      // covers. aThin = the vertex's offset from its part's middle line (or middle point), and the part's width in metres (negative
      // for a part that is small in every direction). Nearer than the distance at which it is a pixel wide, nothing changes.
      if (u_lookPass > 2.5 && aThin.w != 0.0 && u_lookFar != 0.0) {
        float k = max(1.0, distance(u_eye, position) * u_lookPx / abs(aThin.w));
        pos += aThin.xyz * (k - 1.0);
        v_cover = aThin.w > 0.0 ? 1.0 / k : 1.0 / (k * k);
        if (u_lookFar < 0.0) v_cover = -1.0;                       // a test switch: thin parts not drawn at all
      }
      v_pos = pos; v_normal = normal; v_base = aBase; v_mirror = aMirror; v_night = aNight; v_uv = uv; v_glass = aGlass;
      gl_Position = v_cover < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }`;
  const FRAG = () => `
    ${window.CityLighting.uniforms}
    #include <packing>
    ${window.CityLighting.glsl}
    ${window.CitySky.glsl}
    uniform sampler2D u_skyMap; uniform float u_skyMapStrength, u_nightWallAmbient, u_lookPass, u_lookThrough, u_lookShadowLift; uniform vec3 u_lookTransmit;
    varying vec3 v_pos, v_normal, v_base, v_mirror, v_night; varying vec2 v_uv; varying float v_glass, v_cover;
    void main() {
      // nothing under the city's ground plane is drawn. The ground is a flat picture with no depth, so the part of a model that reaches
      // below it (a builder who modelled a sloping street) would be painted OVER the ground instead of being hidden by it
      if (v_pos.z < -0.02) discard;
      // see-through glass is drawn twice: first it dims what is behind it by its colour (this pass multiplies the picture), then it adds its own light
      if (u_lookPass > 0.5 && u_lookPass < 1.5) { gl_FragColor = vec4(pow(u_lookThrough * u_lookTransmit, vec3(1.0 / 2.2)), 1.0); return; }
      vec3 n = normalize(v_normal); if (!gl_FrontFacing) n = -n;
      vec3 view = normalize(u_eye - v_pos);
      float open = mix(1.0, texture2D(u_skyMap, v_uv).r, u_skyMapStrength);               // how much of the sky this spot sees (baked in Blender)
      float facing = max(dot(n, u_csSunDir), 0.0);
      // the app's own two shadow maps. They are read a little in front of the face: read on the face, a lit wall that stands at an
      // angle to the sun shadows itself by a fifth (the app's own note: js/city-lighting.js), and under a strong sun that is a fifth of its light
      float sunSeen = facing > 0.0 ? sunlightVisibility(v_pos + n * u_lookShadowLift, n) : 1.0;
      vec3 light = csSkyLight(n) * open + u_csSun * facing * sunSeen;
      vec3 lit = v_base * light * 0.31830989;
      if (v_glass > 0.5) {
        // a mirror of the same sky; a recess mirrors less of it (the rule three.js uses for a smooth surface)
        float nv = clamp(dot(n, view), 0.0, 1.0), seen = clamp(pow(nv + open, 0.36) - 1.0 + open, 0.0, 1.0);
        lit += v_mirror * csMirror(reflect(-view, n)) * seen;
      }
      vec3 col = csDisplay(lit);
      // night, by the city's own rules: a floor of light on walls, the building's lamps, lit rooms and the sign as light sources
      vec3 flat_ = pow(clamp(v_base, 0.0, 1.0), vec3(1.0 / 2.2));
      col = mix(col, max(col, flat_ * u_nightWallAmbient), u_cityNight.x * (1.0 - v_glass));
      col = cityLocalLight(col, flat_, v_pos, n, v_glass);
      col = cityEmission(col, v_night, step(0.004, max(v_night.r, max(v_night.g, v_night.b))));
      // the second pass of see-through glass adds the pane's own picture in the share the first pass took away (screen values, as the first pass multiplied)
      if (u_lookPass > 1.5) col *= vec3(1.0) - pow(u_lookThrough * u_lookTransmit, vec3(1.0 / 2.2));
      // a thin part far away: its colour times the share of the pixel it covers (pass 3 lays it over what is behind in that share)
      gl_FragColor = u_lookPass > 2.5 ? vec4(col * v_cover, v_cover) : vec4(col, 1.0);
    }`;

  // ══════════════════════════════════════════════════════════════════════
  //  FAR: THIN PARTS (GLTF.look.far) — rule 15, from the model's own parts
  // ══════════════════════════════════════════════════════════════════════
  // A rail 4 cm wide is a fifth of a pixel at 300 m. Drawn as it is, it is there in one frame and gone in the next. So every part of the
  // model that is thin BY ITS OWN SHAPE is found once, at load: the pieces of each material that hang together (a bar, a post, a
  // mullion, a bolt), measured along their own three directions. A piece is THIN when it is a bar (its second size is under `thinM`
  // and it is `long` times as long as that) or small in every direction (its largest size is under `thinM`). The shader then draws a thin
  // piece never narrower than `minPx` pixels and gives it the share of the pixel it truly covers (VERT). Nothing else is touched: walls,
  // panes and every edge wider than a pixel are drawn exactly as before, at every distance. There is no switch distance and no second file.
  function eig3(a) {   // a symmetric 3 x 3 (xx, xy, xz, yy, yz, zz): its three directions (rows of V), by cyclic Jacobi turns
    const A = [[a[0], a[1], a[2]], [a[1], a[3], a[4]], [a[2], a[4], a[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 8; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-12) continue;
      const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) { const x = A[k][p], y = A[k][q]; A[k][p] = c * x - s * y; A[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = A[p][k], y = A[q][k]; A[p][k] = c * x - s * y; A[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
    return [[V[0][0], V[1][0], V[2][0]], [V[0][1], V[1][1], V[2][1]], [V[0][2], V[1][2], V[2][2]]];
  }
  /** for each vertex of one material's mesh: (its offset from its piece's middle line or point, the piece's width; 0 = not thin). null = none */
  function thinOf(P, idx, F) {
    const nv = P.length / 3, id = new Int32Array(nv), seen = new Map(), wp = []; let nw = 0;
    for (let i = 0; i < nv; i++) {   // vertices at one place are one (a file splits them where two faces meet at an edge)
      const k = Math.round(P[i * 3] * 500) + '_' + Math.round(P[i * 3 + 1] * 500) + '_' + Math.round(P[i * 3 + 2] * 500); let w = seen.get(k);
      if (w === undefined) { w = nw++; seen.set(k, w); wp.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); } id[i] = w;
    }
    const par = new Int32Array(nw); for (let i = 0; i < nw; i++) par[i] = i;
    const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < idx.length; t += 3) { const a = find(id[idx[t]]), b = find(id[idx[t + 1]]), c = find(id[idx[t + 2]]); if (a !== b) par[b] = a; const a2 = find(a), c2 = find(c); if (a2 !== c2) par[c2] = a2; }
    const comp = new Map(), of = new Int32Array(nw);
    for (let i = 0; i < nw; i++) { const r = find(i); let c = comp.get(r); if (!c) { c = { n: 0, m: [0, 0, 0], q: [0, 0, 0, 0, 0, 0], v: [] }; comp.set(r, c); } c.n++; c.v.push(i); for (let k = 0; k < 3; k++) c.m[k] += wp[i * 3 + k]; }
    let any = false;
    for (const c of comp.values()) {
      for (let k = 0; k < 3; k++) c.m[k] /= c.n;
      for (const i of c.v) { const x = wp[i * 3] - c.m[0], y = wp[i * 3 + 1] - c.m[1], z = wp[i * 3 + 2] - c.m[2]; c.q[0] += x * x; c.q[1] += x * y; c.q[2] += x * z; c.q[3] += y * y; c.q[4] += y * z; c.q[5] += z * z; }
      const ax = eig3(c.q), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const i of c.v) for (let a = 0; a < 3; a++) { const d = (wp[i * 3] - c.m[0]) * ax[a][0] + (wp[i * 3 + 1] - c.m[1]) * ax[a][1] + (wp[i * 3 + 2] - c.m[2]) * ax[a][2]; if (d < lo[a]) lo[a] = d; if (d > hi[a]) hi[a] = d; }
      const o = [0, 1, 2].sort((a, b) => (hi[b] - lo[b]) - (hi[a] - lo[a])), e = o.map(a => hi[a] - lo[a]);
      // the middle of the piece's box in its own directions (not the mean of its corners)
      const mid = [0, 1, 2].map(k => c.m[k] + [0, 1, 2].reduce((s, a) => s + ax[a][k] * (lo[a] + hi[a]) / 2, 0));
      if (e[0] <= F.thinM) { c.kind = 2; c.w = Math.max(e[0], 0.005); }
      else if (e[1] <= F.thinM && e[0] >= F.long * e[1]) { c.kind = 1; c.w = Math.max(e[1], 0.005); c.u = ax[o[0]]; }
      c.mid = mid; if (c.kind) any = true;
    }
    if (!any) return null;
    const out = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) {
      const c = comp.get(find(id[i])); if (!c.kind) continue;
      let x = P[i * 3] - c.mid[0], y = P[i * 3 + 1] - c.mid[1], z = P[i * 3 + 2] - c.mid[2];
      if (c.kind === 1) { const d = x * c.u[0] + y * c.u[1] + z * c.u[2]; x -= d * c.u[0]; y -= d * c.u[1]; z -= d * c.u[2]; }
      out[i * 4] = x; out[i * 4 + 1] = y; out[i * 4 + 2] = z; out[i * 4 + 3] = c.kind === 1 ? c.w : -c.w;
    }
    return out;
  }
  // how wide one pixel of the canvas is, as an angle (metres at one metre): from the camera's own matrix, at a point in front of it
  function pxAngle(S, renderer, at) {
    const gl = renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, E = S.uniforms().u_eye.value, m = S.camera.projectionMatrix.elements;
    const clip = (x, y, z) => { const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return w > 1e-6 ? [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w * W / 2, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * H / 2] : null; };
    const c0 = clip(at.x, at.y, at.z); if (!c0) return pxAngle.last || 0;
    let s = 0; for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { const c = clip(at.x + dx, at.y + dy, at.z + dz); if (!c) return pxAngle.last || 0; s += (c[0] - c0[0]) ** 2 + (c[1] - c0[1]) ** 2; }
    const d = Math.hypot(E.x - at.x, E.y - at.y, E.z - at.z), ppm = Math.sqrt(s / 2);
    return (pxAngle.last = ppm > 0 && d > 0 ? 1 / (ppm * d) : 0);
  }

  /** pass 0: an ordinary surface. pass 1 and 2: see-through glass (multiply what is behind, then add its own light). pass 3: thin parts (laid over by the share they cover) */
  function material(S, skyMap, pass, through, transmit) {
    const T = window.THREE, U = S.uniforms();
    const mat = new T.ShaderMaterial({
      uniforms: Object.assign({}, U, window.CitySky.uniforms(), { u_skyMap: { value: skyMap }, u_skyMapStrength: { value: skyMap ? GLTF.look.skyMapStrength : 0 }, u_lookShadowLift: { value: GLTF.look.shadowLiftM }, u_lookFar: { value: 0 }, u_lookPx: { value: 0 },
        u_lookPass: { value: pass }, u_lookThrough: { value: through || 0 }, u_lookTransmit: { value: new T.Vector3(...(transmit || [1, 1, 1])) } }),
      vertexShader: VERT, fragmentShader: FRAG(), side: T.DoubleSide, depthTest: true, depthWrite: pass === 0 || pass === 3, transparent: pass > 0, blending: pass === 0 ? T.NoBlending : T.CustomBlending,
    });
    if (pass === 3) { mat.blendEquation = T.AddEquation; mat.blendSrc = T.OneFactor; mat.blendDst = T.OneMinusSrcAlphaFactor; mat.blendSrcAlpha = T.OneFactor; mat.blendDstAlpha = T.OneMinusSrcAlphaFactor; }
    if (pass === 1) { mat.blendEquation = T.AddEquation; mat.blendSrc = T.ZeroFactor; mat.blendDst = T.SrcColorFactor; mat.blendSrcAlpha = T.ZeroFactor; mat.blendDstAlpha = T.OneFactor; }
    if (pass === 2) { mat.blendEquation = T.AddEquation; mat.blendSrc = T.OneFactor; mat.blendDst = T.OneFactor; mat.blendSrcAlpha = T.ZeroFactor; mat.blendDstAlpha = T.OneFactor; }
    return mat;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  SMOOTH EDGES OF ITS OWN (GLTF.look.own)
  // ══════════════════════════════════════════════════════════════════════
  // The model's thin lines (joint lines 4 cm wide, mullions 7 cm) and its edges need several samples a pixel. Giving the whole canvas four
  // samples costs an integrated chip about 140 ms a frame at a laptop's full density with the city drawn. So, after the city is drawn:
  //   1. the building alone is drawn into a target of its own, four samples a pixel, covering only the part of the screen it stands on;
  //   2. its depth is written into the canvas (the city in front still hides it; the fog and the labels see it);
  //   3. the smoothed picture is laid onto the canvas wherever the building is the front-most thing; then its see-through glass.
  // In the city's own scene the building is a mesh that draws nothing: it is there to cast its shadow into the app's shadow maps.
  // `pool`: the smoothing targets are SHARED by all buildings (one per sample count): the buildings are drawn one after another, so one
  // target the size of the biggest box does for all of them. (A target per building held 411 MB with fourteen buildings.)
  const OWN = { list: [], hooked: false, frames: 0, bytes: 0, pixels: 0, ms: 0, pool: {}, need: {}, slack: {} };
  const ownWanted = S => { const O = GLTF.look.own; if (!O || !O.on || !S.renderer || !S.renderer.capabilities.isWebGL2) return false; const gl = S.renderer.getContext(); return !(gl.getParameter(gl.SAMPLES) > 0); };
  function ownParts() {
    const T = window.THREE;
    const nothing = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: T.DoubleSide });
    // the depth pass and the lay pass share one vertex program text, so the two give the same depth at every pixel
    const VS = 'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; }';
    const depthOnly = new T.ShaderMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: T.DoubleSide, vertexShader: VS, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }' });
    const lay = new T.ShaderMaterial({ side: T.DoubleSide, depthTest: true, depthWrite: false, depthFunc: T.LessEqualDepth, transparent: true, blending: T.CustomBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor,
      uniforms: { u_picture: { value: null }, u_at: { value: new T.Vector4(0, 0, 1, 1) }, u_ss: { value: 1 } },
      vertexShader: VS,
      // the smoothed picture at this very pixel (its colours are already times how much of the pixel the building covers)
      // (a picture drawn at u_ss times the pixels: the mean of this pixel's own block of it)
      fragmentShader: 'uniform sampler2D u_picture; uniform vec4 u_at; uniform float u_ss; void main(){ vec2 b = (gl_FragCoord.xy - u_at.xy - 0.5) * u_ss; vec4 s = vec4(0.0); '
        + 'for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) { if (float(i) < u_ss && float(j) < u_ss) s += texture2D(u_picture, (b + vec2(float(i), float(j)) + 0.5) / u_at.zw); } gl_FragColor = s / (u_ss * u_ss); }' });
    return { picture: new T.Scene(), depth: new T.Scene(), fill: new T.Scene(), glass: new T.Scene(), nothing, depthOnly, lay, box: new T.Box3(), target: null, cam: new T.Camera(), group: null };
  }
  function ownFrame(S, renderer, camera) {
    const T = window.THREE, O = GLTF.look.own, gl = renderer.getContext(), t0 = performance.now();
    // Back on the canvas the view is the whole drawing buffer with no scissor: that is what MapLibre draws a custom layer with. (Asking the
    // context for its viewport instead is a round trip to the GPU process that stalls the frame: 42 ms a frame here when I measured it.)
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const v = new T.Vector4(), restore = () => { renderer.setRenderTarget(null); renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.setScissorTest(false); };
    OWN.pixels = 0; OWN.bytes = 0; OWN.need = {};
    for (const b of OWN.list) {
      if (!b.group || !b.group.visible || (b.group.parent && !b.group.parent.visible) || b.box.isEmpty()) continue;   // the app hides the layer's group by zoom and tier
      // the part of the screen the building stands on: its box's corners through the camera
      let x0 = 1, y0 = 1, x1 = -1, y1 = -1, behind = 0;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? b.box.max.x : b.box.min.x, i & 2 ? b.box.max.y : b.box.min.y, i & 4 ? b.box.max.z : b.box.min.z, 1).applyMatrix4(camera.projectionMatrix);
        if (v.w <= 1e-6) { behind++; continue; }
        x0 = Math.min(x0, v.x / v.w); x1 = Math.max(x1, v.x / v.w); y0 = Math.min(y0, v.y / v.w); y1 = Math.max(y1, v.y / v.w);
      }
      if (behind === 8) continue;                                  // the whole building is behind the camera
      if (behind) { x0 = y0 = -1; x1 = y1 = 1; }                   // the camera stands inside its box: the whole screen
      let px0 = Math.max(0, Math.floor((x0 * 0.5 + 0.5) * W) - O.pad), px1 = Math.min(W, Math.ceil((x1 * 0.5 + 0.5) * W) + O.pad), py0 = Math.max(0, Math.floor((y0 * 0.5 + 0.5) * H) - O.pad), py1 = Math.min(H, Math.ceil((y1 * 0.5 + 0.5) * H) + O.pad);
      const w = px1 - px0, h = py1 - py0; if (w < 2 || h < 2) continue;
      // FAR: a building that is small on the screen takes more samples a pixel. Its windows are then a few pixels wide, and with four
      // samples a dark pane's edge on a pale wall steps by a quarter of that contrast as the camera moves; sixteen samples step by a
      // sixteenth. The target is small when the building is small, so the extra samples cost little memory.
      const FARS = GLTF.look.far, cap = renderer.capabilities.maxSamples || 4;
      let samples = w * h > O.bigPixels ? O.bigSamples : O.samples;
      // ... and the smallest are drawn at `smallScale` times the pixels as well, each pixel of the canvas then taking the mean of its own
      // block (that is more samples, not a blur: nothing is taken from a neighbouring pixel). Its picture is never larger than a
      // middle-sized building's, so no building costs more than one at middle distance does.
      let ss = 1;
      if (FARS && FARS.on) { if (w * h <= FARS.smallPixels) { samples = Math.min(cap, FARS.smallSamples); ss = Math.max(1, Math.min(4, Math.round(FARS.smallScale))); } else if (w * h <= FARS.midPixels) samples = Math.min(cap, FARS.midSamples); }
      const tw0 = w * ss, th0 = h * ss, need = OWN.need[samples] || (OWN.need[samples] = [0, 0]); need[0] = Math.max(need[0], tw0); need[1] = Math.max(need[1], th0);
      b.target = OWN.pool[samples];
      if (!b.target || b.target.width < tw0 || b.target.height < th0) {
        const tw = Math.min(Math.max(W, tw0), Math.ceil(tw0 / O.growBy) * O.growBy), th = Math.min(Math.max(H, th0), Math.ceil(th0 / O.growBy) * O.growBy);
        const ow = b.target ? b.target.width : 0, oh = b.target ? b.target.height : 0;
        if (b.target) b.target.dispose();
        b.target = OWN.pool[samples] = new T.WebGLRenderTarget(Math.max(tw, ow), Math.max(th, oh), { samples, depthBuffer: true, stencilBuffer: false, magFilter: T.NearestFilter, minFilter: T.NearestFilter, generateMipmaps: false });
        if ('colorSpace' in b.target.texture && T.NoColorSpace !== undefined) b.target.texture.colorSpace = T.NoColorSpace;
      }
      // the same camera, looking only at that part of the screen
      const nx0 = px0 / W * 2 - 1, nx1 = px1 / W * 2 - 1, ny0 = py0 / H * 2 - 1, ny1 = py1 / H * 2 - 1, sx = 2 / (nx1 - nx0), sy = 2 / (ny1 - ny0);
      b.cam.projectionMatrix.set(sx, 0, 0, -sx * (nx0 + nx1) / 2, 0, sy, 0, -sy * (ny0 + ny1) / 2, 0, 0, 1, 0, 0, 0, 0, 1).multiply(camera.projectionMatrix);
      b.cam.projectionMatrixInverse.copy(b.cam.projectionMatrix).invert();
      b.target.viewport.set(0, 0, tw0, th0); b.target.scissor.set(0, 0, tw0, th0); b.target.scissorTest = true;
      const clear = renderer.getClearColor(new T.Color()), alpha = renderer.getClearAlpha();
      try {
        renderer.setRenderTarget(b.target); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false);
        renderer.render(b.picture, b.cam);                         // 1. the building alone, four samples a pixel
        restore();
        renderer.render(b.depth, camera);                          // 2. its depth into the canvas
        b.lay.uniforms.u_picture.value = b.target.texture; b.lay.uniforms.u_at.value.set(px0, py0, b.target.width, b.target.height); b.lay.uniforms.u_ss.value = ss;
        renderer.render(b.fill, camera);                           // 3. the smoothed picture, where the building is in front
        if (b.glass.children.length) renderer.render(b.glass, camera);
      } finally { restore(); renderer.setClearColor(clear, alpha); }
      OWN.pixels += tw0 * th0; b.samples = samples; b.scale = ss;
    }
    // what the shared targets hold; one that has been four times too big for two seconds of frames is let go (it is made again at the size needed)
    for (const k of Object.keys(OWN.pool)) {
      const t = OWN.pool[k], n = OWN.need[k]; if (!t) continue;
      OWN.slack[k] = (!n || n[0] * n[1] * 4 < t.width * t.height) ? (OWN.slack[k] || 0) + 1 : 0;
      if (OWN.slack[k] > 120) { t.dispose(); OWN.pool[k] = null; OWN.slack[k] = 0; continue; }
      OWN.bytes += t.width * t.height * (4 + 8 * Number(k));
    }
    OWN.frames++; OWN.ms = +(performance.now() - t0).toFixed(2);
  }
  function ownHook(S) {
    if (OWN.hooked || !S.scene) return; OWN.hooked = true;
    const prev = S.scene.onAfterRender;
    S.scene.onAfterRender = function (renderer, scene, camera) {
      if (prev) prev.apply(this, arguments);
      // only after the city's own picture (not after a shadow map, not inside another target)
      if (!OWN.list.length || camera !== S.camera || scene.overrideMaterial || renderer.getRenderTarget()) return;
      try { ownFrame(S, renderer, camera); } catch (e) { if (!OWN.failed) { OWN.failed = String(e && e.message || e); L.errors.push('own edges: ' + OWN.failed); console.error('[gltf-look] own edges', e); } }
    };
  }
  GLTF.lookOwn = OWN;

  // ── one building ────────────────────────────────────────────────────────
  function build(S, row, prims, skyMap) {
    const T = window.THREE, h = row.headingDeg * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), O = S.toLocal(row.lng, row.lat, row.groundM || 0), og = row.lookOrigin || [0, 0, 0];
    // glTF (x, y, z) is the model's (x, -z, y): X along the street face, Y into the building, Z up. Then the compass heading of +Y.
    const world = (x, y, z) => [O.x + x * c + y * s, O.y - x * s + y * c, O.z + z], turn = (x, y, z) => [x * c + y * s, -x * s + y * c, z];
    const CN = window.CityNight, rules = !!(CN && CN.tune.on && row.replaces), mats = cf(row, 'materials') || {};
    if (rules) { CN.register({ id: row.replaces, name: row.name, category: 'apartment', night: row.night }); if (row.night && row.night.fixtures) CN.registerFixtures({ id: row.replaces, night: row.night }, { at: world }); }
    const I = GLTF.internals, parts = { solid: null, glass: null, thin: null }, FAR = GLTF.look.far;
    const acc = () => ({ pos: [], nrm: [], uv: [], base: [], mirror: [], night: [], glass: [], thin: [], idx: [] });
    let lit = 0, tris = 0, thinTris = 0;
    for (const p of prims) {
      // a material the row does not list is known by its name (the builders' rule: glass is named glass_*, signs sign_*)
      const cfg = mats[p.material] || (/^glass/i.test(p.material) ? { lit: true } : /^sign/i.test(p.material) ? { sign: true } : {}), A = p.seeThrough > 0 ? (parts.glass = parts.glass || Object.assign(acc(), { through: p.seeThrough, transmit: p.transmit })) : (parts.solid = parts.solid || acc());
      const nv = p.pos.length / 3, night = new Float32Array(nv * 3);
      // model-frame positions for the pane rules (the same code the flat-colour path uses): shift the file's origin onto the row's
      const P = Float32Array.from(p.pos); for (let i = 0; i < nv; i++) { P[i * 3] -= og[0]; P[i * 3 + 1] -= og[2]; P[i * 3 + 2] += og[1]; }
      if (cfg.lit && rules && I && I.paneAddress) {
        const addr = I.paneAddress(P, p.idx, row);
        for (let t = 0; t < p.idx.length / 3; t++) {
          if (addr.wide[t]) continue;
          const room = CN.room(row.replaces + '|' + addr.wall[t], addr.floor[t], addr.col[t], 0); if (!room.lit) continue;
          const tone = hex3(room.nightTone); lit++;
          for (let j = 0; j < 3; j++) { const v = p.idx[t * 3 + j]; night[v * 3] = tone[0]; night[v * 3 + 1] = tone[1]; night[v * 3 + 2] = tone[2]; }
        }
      } else if (cfg.sign) { const tone = hex3(cfg.night || GLTF.litTone); for (let i = 0; i < nv; i++) { night[i * 3] = tone[0]; night[i * 3 + 1] = tone[1]; night[i * 3 + 2] = tone[2]; } }
      // FAR: the pieces of this material that are thin by their own shape go to a mesh of their own (see thinOf)
      const thin = FAR && FAR.build && !(p.seeThrough > 0) ? thinOf(P, p.idx, FAR) : null;
      if (thin && !parts.thin) parts.thin = acc();
      const mapA = new Int32Array(nv).fill(-1), mapT = thin ? new Int32Array(nv).fill(-1) : null;
      const put = (B, map, i) => {
        if (map[i] >= 0) return map[i];
        const w = world(P[i * 3], -P[i * 3 + 2], P[i * 3 + 1]), n = turn(p.nrm[i * 3], -p.nrm[i * 3 + 2], p.nrm[i * 3 + 1]);
        map[i] = B.pos.length / 3;
        B.pos.push(w[0], w[1], w[2]); B.nrm.push(n[0], n[1], n[2]); B.uv.push(p.uv[i * 2], p.uv[i * 2 + 1]);
        if (p.paint) B.base.push(p.base[0] * p.paint[i * 3], p.base[1] * p.paint[i * 3 + 1], p.base[2] * p.paint[i * 3 + 2]); else B.base.push(p.base[0], p.base[1], p.base[2]);
        B.mirror.push(p.mirror[0], p.mirror[1], p.mirror[2]); B.glass.push(p.glass ? 1 : 0);
        B.night.push(night[i * 3], night[i * 3 + 1], night[i * 3 + 2]);
        if (B === parts.thin) { const r = turn(thin[i * 4], -thin[i * 4 + 2], thin[i * 4 + 1]); B.thin.push(r[0], r[1], r[2], thin[i * 4 + 3]); }
        return map[i];
      };
      for (let k = 0; k < p.idx.length; k += 3) {
        const isThin = !!(thin && thin[p.idx[k] * 4 + 3] !== 0), B = isThin ? parts.thin : A, map = isThin ? mapT : mapA;
        B.idx.push(put(B, map, p.idx[k]), put(B, map, p.idx[k + 1]), put(B, map, p.idx[k + 2])); if (isThin) thinTris++;
      }
      tris += p.idx.length / 3;
    }
    const g = new T.Group(); g.name = 'gltf-look-' + row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); g.userData.lod = GLTF.lod; g.userData.minzoom = GLTF.minzoom;
    const own = ownWanted(S) && row.own !== false ? ownParts() : null;
    let bytes = 0;
    for (const [name, A] of Object.entries(parts)) {
      if (!A) continue;
      const geom = new T.BufferGeometry(), F = (a, n) => new T.BufferAttribute(Float32Array.from(a), n);
      geom.setAttribute('position', F(A.pos, 3)); geom.setAttribute('normal', F(A.nrm, 3)); geom.setAttribute('uv', F(A.uv, 2));
      geom.setAttribute('aBase', F(A.base, 3)); geom.setAttribute('aMirror', F(A.mirror, 3)); geom.setAttribute('aNight', F(A.night, 3)); geom.setAttribute('aGlass', F(A.glass, 1));
      if (name === 'thin') geom.setAttribute('aThin', F(A.thin, 4));
      geom.setIndex(new T.BufferAttribute(Uint32Array.from(A.idx), 1)); geom.computeBoundingSphere();
      for (const pass of (A.through ? [1, 2] : name === 'thin' ? [3] : [0])) {
        const mat = material(S, skyMap, pass, A.through, A.transmit), mesh = new T.Mesh(geom, mat);
        mesh.name = g.name + '-' + name + (pass ? pass : ''); mesh.renderOrder = pass; if (pass === 1 || pass === 2) mesh.layers.set(1);   // see-through glass casts no shadow (the shadow cameras see layer 0 only)
        // the light for the hour, once per frame: the sky and sun from js/city-sky.js at the app's own clock
        mesh.onBeforeRender = renderer => {
          const U = S.uniforms(); window.CitySky.sync(mat.uniforms, U.u_p ? U.u_p.value : 0.3);
          // FAR, each frame: on / off (GLTF.look.far.on may be flipped while the page runs), and how wide a pixel is
          if (pass === 3) { mat.uniforms.u_lookFar.value = FAR.on ? (FAR.hide ? -1 : 1) : 0; mat.uniforms.u_lookPx.value = pxAngle(S, renderer, geom.boundingSphere.center) * FAR.minPx; }
        };
        if (!own) { g.add(mesh); continue; }
        // smooth edges of its own: the real mesh is drawn by ownFrame(); the city's scene keeps a mesh that draws nothing and casts the shadow
        mesh.frustumCulled = false; mesh.layers.set(0);
        if (pass === 1 || pass === 2) own.glass.add(mesh);
        else {
          own.picture.add(mesh);
          const caster = new T.Mesh(geom, own.nothing); caster.name = mesh.name + '-shadow'; g.add(caster);
          const dm = new T.Mesh(geom, own.depthOnly); dm.frustumCulled = false; own.depth.add(dm);
          const fm = new T.Mesh(geom, own.lay); fm.frustumCulled = false; own.fill.add(fm);
          geom.computeBoundingBox(); own.box.union(geom.boundingBox);
        }
      }
      bytes += A.pos.length / 3 * 60 + A.idx.length * 4;
    }
    if (own) { own.group = g; OWN.list.push(own); }
    return { group: g, triangles: tris, thinTriangles: thinTris, lit, bytes };
  }

  // ── boot ────────────────────────────────────────────────────────────────
  async function fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.arrayBuffer(); }
  const loadMap = url => new Promise(res => new window.THREE.TextureLoader().load(url, t => {
    const T = window.THREE; t.flipY = false; t.magFilter = t.minFilter = T.LinearFilter; t.generateMipmaps = false; if ('colorSpace' in t && T.NoColorSpace !== undefined) t.colorSpace = T.NoColorSpace; res(t); }, undefined, () => res(null)));
  let _loaded = null, _group = null;
  const L = info.look = { loaded: [], triangles: 0, litTriangles: 0, drawCalls: 0, bytes: 0, mapBytes: 0, ms: 0, errors: [] };
  async function load() {
    const t0 = performance.now(), rows = GLTF.buildings.filter(b => b.look);
    _loaded = await Promise.all(rows.map(async row => {
      try {
        const file = (GLTF.look.oneWeather && row.lookClearDay) || row.look;      // see GLTF.look.oneWeather (js/gltf-layer.js)
        const buf = await fetchBuf(file), map = await loadMap(file.replace(/\.glb$/, '-sky.png'));
        L.bytes += buf.byteLength; if (map && map.image) L.mapBytes += map.image.width * map.image.height * 4; else L.errors.push(row.name + ': no sky-light map');
        return { row, prims: parseLook(buf), map };
      } catch (e) { L.errors.push(row.look + ': ' + e.message); console.error('[gltf-look]', row.look, e); return null; }
    }));
    L.ms = +(performance.now() - t0).toFixed(1);
  }
  function attach(S) {
    const want = !!(window.SLOPES && window.SLOPES.on && GLTF.on && GLTF.look.on);
    if (want && !_group && _loaded) {
      const g = new window.THREE.Group(); g.name = 'gltf-look'; L.triangles = L.litTriangles = L.drawCalls = 0; L.loaded = [];
      for (const p of _loaded) {
        if (!p) continue;
        try { const b = build(S, p.row, p.prims, p.map); g.add(b.group); L.triangles += b.triangles; L.litTriangles += b.lit; L.drawCalls += b.group.children.length; L.loaded.push(p.row.name); (L.thin = L.thin || {})[p.row.name] = [b.thinTriangles, b.triangles]; }
        catch (e) { L.errors.push(p.row.name + ': ' + e.message); console.error('[gltf-look]', p.row.name, e); }
      }
      _group = g; S.add(g); if (S.camera && S.camera.layers) S.camera.layers.enable(1);
      if (OWN.list.length) ownHook(S);
      console.log('[gltf-look]', L.loaded.join(', ') || 'nothing', '—', L.triangles, 'triangles,', L.drawCalls, 'draw call(s),', L.bytes, 'bytes');
    } else if (!want && _group) { for (const k of Object.keys(OWN.pool)) { if (OWN.pool[k]) OWN.pool[k].dispose(); OWN.pool[k] = null; } OWN.list.length = 0; S.remove(_group); _group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); _group = null; }
    GLTF.lookReady = !!_group;
    if (window.__map && window.__map.triggerRepaint) window.__map.triggerRepaint();
  }
  let n = 0, busy = false;
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const S = window.slopes;
      if (S && S.root && window.THREE && S.uniforms && S.uniforms() && window.CitySky && window.CityLighting && GLTF.internals) {
        clearInterval(timer);
        await load(); S.onSwitch(() => attach(S)); attach(S);
      } else if (++n > 900) clearInterval(timer);
    } catch (e) { L.errors.push(String(e && e.message || e)); console.error('[gltf-look]', e); clearInterval(timer); }
    busy = false;
  }, 200);
})();
