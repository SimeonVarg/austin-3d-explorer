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
    attribute vec3 aBase; attribute vec3 aMirror; attribute vec3 aNight; attribute float aGlass; attribute vec4 aThin; attribute vec4 aFarA; attribute vec4 aFarB;
    uniform vec3 u_eye; uniform float u_lookFar, u_lookPx, u_lookPass, u_lookCopy, u_lookPush; uniform vec2 u_lookBand;
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
      // THE FAR COPY (GLTF.look.copy): a wall is drawn in bands (a storey's window strip, the spandrel under it). A band that is only a
      // few pixels high would flicker, so it gives way to its wall's mean colour (aFarA, aFarB) as it gets that thin: u_lookBand = the
      // share of a band's height one pixel covers at which the giving way starts and is complete. Its sky light is a number (uv), not a map.
      if (u_lookCopy > 0.5) {
        float t = aFarA.w > 0.0 ? smoothstep(u_lookBand.x, u_lookBand.y, distance(u_eye, position) * u_lookPx / aFarA.w) : 0.0;
        v_base = mix(aBase, aFarA.rgb, t); v_mirror = mix(aMirror, aFarB.rgb, t); v_glass = mix(aGlass, aFarB.a, t); v_uv = vec2(mix(uv.x, uv.y, t), 0.0);
      }
      gl_Position = v_cover < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      // a far copy that stands UNDER its full building while the two change places is drawn at the depth of a point u_lookPush metres
      // farther along the line of sight, so the full building's own faces (a recessed window, a wall behind a balcony) are in front of it
      if (u_lookPush > 0.0) { vec4 q = projectionMatrix * modelViewMatrix * vec4(pos + normalize(pos - u_eye) * u_lookPush, 1.0); gl_Position.z = q.z / q.w * gl_Position.w; }
    }`;
  const FRAG = () => `
    ${window.CityLighting.uniforms}
    #include <packing>
    ${window.CityLighting.glsl}
    ${window.CitySky.glsl}
    uniform sampler2D u_skyMap; uniform float u_skyMapStrength, u_nightWallAmbient, u_lookPass, u_lookThrough, u_lookShadowLift, u_lookCopy, u_lookFade; uniform vec3 u_lookTransmit;
    varying vec3 v_pos, v_normal, v_base, v_mirror, v_night; varying vec2 v_uv; varying float v_glass, v_cover;
    void main() {
      // nothing under the city's ground plane is drawn. The ground is a flat picture with no depth, so the part of a model that reaches
      // below it (a builder who modelled a sloping street) would be painted OVER the ground instead of being hidden by it
      if (v_pos.z < -0.02) discard;
      // see-through glass is drawn twice: first it dims what is behind it by its colour (this pass multiplies the picture), then it adds its own light
      if (u_lookPass > 0.5 && u_lookPass < 1.5) { gl_FragColor = vec4(mix(vec3(1.0), pow(u_lookThrough * u_lookTransmit, vec3(1.0 / 2.2)), u_lookFade), 1.0); return; }   // (u_lookFade: the building is changing places with its far copy)
      vec3 n = normalize(v_normal); if (!gl_FrontFacing) n = -n;
      vec3 view = normalize(u_eye - v_pos);
      float open = u_lookCopy > 0.5 ? mix(1.0, v_uv.x, u_skyMapStrength) : mix(1.0, texture2D(u_skyMap, v_uv).r, u_skyMapStrength);               // how much of the sky this spot sees (baked in Blender)
      float facing = max(dot(n, u_csSunDir), 0.0);
      // the app's own two shadow maps. They are read a little in front of the face: read on the face, a lit wall that stands at an
      // angle to the sun shadows itself by a fifth (the app's own note: js/city-lighting.js), and under a strong sun that is a fifth of its light
      float sunSeen = facing > 0.0 ? sunlightVisibility(v_pos + n * u_lookShadowLift, n) : 1.0;
      vec3 light = csSkyLight(n) * open + u_csSun * facing * sunSeen;
      vec3 lit = v_base * light * 0.31830989;
      if (v_glass > 0.002) {                                        // (a far copy's band is glass in part: its mirror colour is already times that share)
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
      if (u_lookPass > 1.5) col *= (vec3(1.0) - pow(u_lookThrough * u_lookTransmit, vec3(1.0 / 2.2))) * u_lookFade;
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
      uniforms: Object.assign({}, U, window.CitySky.uniforms(), { u_skyMap: { value: skyMap }, u_skyMapStrength: { value: skyMap ? GLTF.look.skyMapStrength : 0 }, u_lookShadowLift: { value: GLTF.look.shadowLiftM }, u_lookFar: { value: 0 }, u_lookPx: { value: 0 }, u_lookCopy: { value: 0 }, u_lookPush: { value: 0 }, u_lookFade: { value: 1 }, u_lookBand: { value: new T.Vector2(1, 2) },
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
  const OWN = { list: [], hooked: false, frames: 0, bytes: 0, pixels: 0, ms: 0, pool: {}, need: {}, slack: {}, idle: 0 };
  const ownWanted = S => { const O = GLTF.look.own; if (!O || !O.on || !S.renderer || !S.renderer.capabilities.isWebGL2) return false; const gl = S.renderer.getContext(); return !(gl.getParameter(gl.SAMPLES) > 0); };
  function ownParts() {
    const T = window.THREE;
    const nothing = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: T.DoubleSide });
    // the depth pass and the lay pass share one vertex program text, so the two give the same depth at every pixel
    const VS = 'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; }';
    const depthOnly = new T.ShaderMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: T.DoubleSide, vertexShader: VS, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }' });
    const lay = new T.ShaderMaterial({ side: T.DoubleSide, depthTest: true, depthWrite: false, depthFunc: T.LessEqualDepth, transparent: true, blending: T.CustomBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor,
      uniforms: { u_picture: { value: null }, u_at: { value: new T.Vector4(0, 0, 1, 1) }, u_ss: { value: 1 }, u_fade: { value: 1 } },
      vertexShader: VS,
      // the smoothed picture at this very pixel (its colours are already times how much of the pixel the building covers).
      // A picture drawn at u_ss times the pixels (1, 1.5 or 2): this canvas pixel takes the mean of ITS OWN block of it, each texel by the
      // share of it that lies in the block, and nothing from a neighbouring pixel. The block starts on a texel edge and spans two texels
      // a side at most, so ONE read with linear filtering is that mean exactly: the read is placed between the two texels' middles at the
      // second one's share (1: the texel itself; 2: a quarter each of four; 1.5: two thirds and one third, turn about). 3 and 4 times: a loop.
      fragmentShader: 'uniform sampler2D u_picture; uniform vec4 u_at; uniform float u_ss, u_fade; void main(){ vec2 i = floor(gl_FragCoord.xy - u_at.xy); '
        + 'if (u_ss < 2.5) { vec2 a = i * u_ss, j = floor(a + 0.001), w1 = (a + u_ss - j - 1.0) / u_ss; gl_FragColor = texture2D(u_picture, (j + 0.5 + w1) / u_at.zw) * u_fade; return; } '
        + 'vec2 b = i * u_ss; vec4 s = vec4(0.0); for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) { if (float(x) < u_ss && float(y) < u_ss) s += texture2D(u_picture, (b + vec2(float(x), float(y)) + 0.5) / u_at.zw); } gl_FragColor = s / (u_ss * u_ss) * u_fade; }' });   // u_fade: the share of the full building while it changes places with its far copy
    return { picture: new T.Scene(), depth: new T.Scene(), fill: new T.Scene(), glass: new T.Scene(), nothing, depthOnly, lay, box: new T.Box3(), target: null, cam: new T.Camera(), group: null };
  }
  function ownFrame(S, renderer, camera) {
    const T = window.THREE, O = GLTF.look.own, gl = renderer.getContext(), t0 = performance.now();
    // Back on the canvas the view is the whole drawing buffer with no scissor: that is what MapLibre draws a custom layer with. (Asking the
    // context for its viewport instead is a round trip to the GPU process that stalls the frame: 42 ms a frame here when I measured it.)
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const v = new T.Vector4(), restore = () => { renderer.setRenderTarget(null); renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.setScissorTest(false); };
    OWN.pixels = 0; OWN.bytes = 0; OWN.need = {};
    const cssPx = W / ((renderer.domElement && renderer.domElement.clientWidth) || W / (window.devicePixelRatio || 1));   // canvas pixels to one CSS pixel, along a side
    // (a measuring switch: GLTF_LAYER.lookOwn.repeat = 3 does all of this three times a frame; the smoothing's own cost is then (T3 - T1) / 2,
    //  far above the noise of a whole-city frame time)
    for (let rep = 0, reps = Math.max(1, OWN.repeat | 0); rep < reps; rep++) for (const b of OWN.list) {
      if (rep === 0) b.samples = b.scale = 0;
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
      let w = px1 - px0, h = py1 - py0; if (w < 2 || h < 2) continue;
      // FAR: a building that is small on the screen is drawn finer. Its windows are then a few pixels wide, and with four samples a
      // pixel a dark pane's edge on a pale wall steps by a quarter of that contrast as the camera moves. WHAT IT COSTS decided the
      // settings (measured on an integrated chip, 14 buildings, a laptop's full density): four samples a pixel are nearly free, eight
      // cost as much again as the whole smoothing does (10 ms a frame), and so does drawing at twice the pixels. So:
      //   - every tier takes 4 samples a pixel, except the smallest boxes (`tinyPixels`), whose cost is small because they are small;
      //   - a small building is drawn at more than the canvas's pixels, each canvas pixel taking the mean of its own block (that is
      //     more samples, not a blur): `density` picture pixels to one CSS pixel along a side, at most the tier's `Scale`. A canvas
      //     that already has two pixels to a CSS pixel is drawn at 1.5 times, one with 1.5 at twice, a phone's with three at once: the
      //     same fineness on every screen as the eye sees it, and the dense screens do not pay for more.
      const FARS = GLTF.look.far, cap = renderer.capabilities.maxSamples || 4;
      let samples = w * h > O.bigPixels ? O.bigSamples : O.samples, ss = 1;
      if (FARS && FARS.on) {
        const tier = w * h <= FARS.tinyPixels ? 'tiny' : w * h <= FARS.smallPixels ? 'small' : w * h <= FARS.midPixels ? 'mid' : null;
        if (tier) {
          samples = Math.min(cap, FARS[tier + 'Samples']);
          const most = FARS[tier + 'Scale'], want = FARS.density > 0 ? Math.min(most, FARS.density / cssPx) : most;
          ss = want > 2.5 ? Math.min(4, Math.round(want)) : want >= 1.75 ? 2 : want >= 1.25 ? 1.5 : 1;
          // one and a half times: the box takes an even number of pixels each way, so that its picture is a whole number of texels
          if (ss === 1.5) { if ((px1 - px0) & 1) { if (px1 < W) px1++; else if (px0 > 0) px0--; else ss = 2; } if ((py1 - py0) & 1) { if (py1 < H) py1++; else if (py0 > 0) py0--; else ss = 2; } w = px1 - px0; h = py1 - py0; }
        }
      }
      const tw0 = w * ss, th0 = h * ss, need = OWN.need[samples] || (OWN.need[samples] = [0, 0]); need[0] = Math.max(need[0], tw0); need[1] = Math.max(need[1], th0);
      b.target = OWN.pool[samples];
      if (!b.target || b.target.width < tw0 || b.target.height < th0) {
        const tw = Math.min(Math.max(W, tw0), Math.ceil(tw0 / O.growBy) * O.growBy), th = Math.min(Math.max(H, th0), Math.ceil(th0 / O.growBy) * O.growBy);
        const ow = b.target ? b.target.width : 0, oh = b.target ? b.target.height : 0;
        if (b.target) b.target.dispose();
        b.target = OWN.pool[samples] = new T.WebGLRenderTarget(Math.max(tw, ow), Math.max(th, oh), { samples, depthBuffer: true, stencilBuffer: false, magFilter: T.LinearFilter, minFilter: T.LinearFilter, generateMipmaps: false });   // linear: see the lay pass
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
        b.lay.uniforms.u_picture.value = b.target.texture; b.lay.uniforms.u_at.value.set(px0, py0, b.target.width, b.target.height); b.lay.uniforms.u_ss.value = ss; b.lay.uniforms.u_fade.value = b.fade === undefined ? 1 : b.fade;
        renderer.render(b.fill, camera);                           // 3. the smoothed picture, where the building is in front
        if (b.glass.children.length) { for (const gm of b.glass.children) gm.material.uniforms.u_lookFade.value = b.fade === undefined ? 1 : b.fade; renderer.render(b.glass, camera); }
      } finally { restore(); renderer.setClearColor(clear, alpha); }
      if (rep === 0) OWN.pixels += tw0 * th0; b.samples = samples; b.scale = ss;
    }
    // what the shared targets hold; one that has been `slackTimes` too big for `slackFrames` frames is let go (it is made again at the size
    // needed). A target made for a close view of one building is the size of the canvas: 187 MB at a laptop's full density.
    for (const k of Object.keys(OWN.pool)) {
      const t = OWN.pool[k], n = OWN.need[k]; if (!t) continue;
      OWN.slack[k] = (!n || n[0] * n[1] * O.slackTimes < t.width * t.height) ? (OWN.slack[k] || 0) + 1 : 0;
      if (OWN.slack[k] > O.slackFrames) { t.dispose(); OWN.pool[k] = null; OWN.slack[k] = 0; continue; }
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
      if (camera !== S.camera || scene.overrideMaterial || renderer.getRenderTarget()) return;
      // no full building is drawn (every one is its far copy, or out): the shared smoothing targets are let go (181 MB were left once)
      if (!OWN.list.some(b => b.group && b.group.visible)) { if (++OWN.idle > GLTF.look.own.slackFrames) { for (const k of Object.keys(OWN.pool)) { if (OWN.pool[k]) OWN.pool[k].dispose(); OWN.pool[k] = null; } OWN.bytes = 0; OWN.idle = 0; } return; }
      OWN.idle = 0;
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
    if (rules && !row._night) { row._night = true; CN.register({ id: row.replaces, name: row.name, category: 'apartment', night: row.night }); if (row.night && row.night.fixtures) CN.registerFixtures({ id: row.replaces, night: row.night }, { at: world }); }   // once: a building comes and goes with distance
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
    return { group: g, own, triangles: tris, thinTriangles: thinTris, lit, bytes };
  }

  // ── boot ────────────────────────────────────────────────────────────────
  async function fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.arrayBuffer(); }
  // A look file is kept in the repo PACKED (`<name>.glb.gz`, gzip: a fifth to a sixth of its bytes, nothing lost) and unpacked by the browser's
  // own DecompressionStream: no decoder file. A server that already unpacked it on the way (Content-Encoding) hands over a plain file: both are
  // told apart by the first two bytes. Where the packed file is missing, or the browser cannot unpack, the plain `<name>.glb` is asked for.
  async function fetchLook(url) {
    if (GLTF.look.packed && typeof DecompressionStream === 'function') {
      try { const r = await fetch(url + '.gz'); if (r.ok) { const b = await r.arrayBuffer(), h = new Uint8Array(b, 0, 2);
        return h[0] === 0x1f && h[1] === 0x8b ? await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : b; } } catch (e) { /* the plain file */ }
    }
    return fetchBuf(url);
  }
  const loadMap = url => new Promise(res => new window.THREE.TextureLoader().load(url, t => {
    const T = window.THREE; t.flipY = false; t.magFilter = t.minFilter = T.LinearFilter; t.generateMipmaps = false; if ('colorSpace' in t && T.NoColorSpace !== undefined) t.colorSpace = T.NoColorSpace; res(t); }, undefined, () => res(null)));
  // ══════════════════════════════════════════════════════════════════════
  //  BY DISTANCE (GLTF.look.load): a building's file is fetched and built when the camera comes near, and let go when it is far
  // ══════════════════════════════════════════════════════════════════════
  // With fifty-eight buildings the page must not hold them all: each is one to four megabytes of file and about as much again on the
  // graphics card. Each row is OUT (nothing held), LOADING, or IN. Every `everyMs` the distance from the camera's eye to each row's
  // origin is taken: within `inM` an OUT row is fetched (nearest first, `atOnce` at a time); beyond `outM` an IN row's meshes, materials
  // and sky-light map are disposed and its file is forgotten (it comes back from the browser's cache). `outM` is larger than `inM` so a
  // camera that hovers at the edge does not load and unload in turn. ?gltfload=0: every row is loaded at the start and kept.
  // What is NOT there yet: a stand-in for a row that is OUT. Its old drawing is hidden for the whole session, so beyond `outM` the
  // building is missing from the picture (docs/gltf-layer.md).
  let _group = null, _tick = null;
  const ROWS = [], L = info.look = { loaded: [], triangles: 0, litTriangles: 0, drawCalls: 0, bytes: 0, mapBytes: 0, ms: 0, errors: [], thin: {}, loads: 0, unloads: 0 };
  // the rows themselves (meshes, vertex arrays) are reachable for tests but are not part of what stats() hands out: a script that asks the page
  // for the layer's numbers would otherwise be sent every vertex of every building
  Object.defineProperty(L, 'rows', { value: ROWS, enumerable: false });
  async function loadRow(S, e) {
    e.state = 1; const row = e.row, t0 = performance.now();
    try {
      const file = (GLTF.look.oneWeather && row.lookClearDay) || row.look;      // see GLTF.look.oneWeather (js/gltf-layer.js)
      const buf = await fetchLook(file), map = await loadMap(file.replace(/\.glb$/, '-sky.png'));
      if (!map || !map.image) L.errors.push(row.name + ': no sky-light map');
      if (!_group || e.state !== 1) { if (map) map.dispose(); if (e.state === 1) e.state = 0; return; }   // the layer was switched off while the file came
      const b = build(S, row, parseLook(buf), map);
      if (b.own) b.own.fade = e.far && GLTF.look.copy.on ? 0 : 1; b.shown = b.group.visible = !(e.far && GLTF.look.copy.on);   // with a far copy the full building dissolves in (copyFrame)
      e.built = b; e.map = map; e.fileBytes = buf.byteLength; e.mapBytes = map && map.image ? map.image.width * map.image.height * 4 : 0; e.state = 2;
      _group.add(b.group); if (OWN.list.length) ownHook(S);
      L.triangles += b.triangles; L.litTriangles += b.lit; L.drawCalls += b.group.children.length; L.bytes += e.fileBytes; L.mapBytes += e.mapBytes; L.loaded.push(row.name); L.thin[row.name] = [b.thinTriangles, b.triangles]; L.loads++;
    } catch (err) { e.state = 3; L.errors.push(row.look + ': ' + (err && err.message || err)); console.error('[gltf-look]', row.look, err); }   // 3: failed, not tried again
    L.ms += performance.now() - t0;
    if (window.__map && window.__map.triggerRepaint) window.__map.triggerRepaint();
  }
  function unloadRow(e) {
    const b = e.built; if (!b) { if (e.state === 1) e.state = 0; return; }
    if (_group) _group.remove(b.group);
    const i = OWN.list.indexOf(b.own); if (i >= 0) OWN.list.splice(i, 1);
    const seen = new Set(), drop = o => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } if (o.material && !seen.has(o.material)) { seen.add(o.material); o.material.dispose(); } };
    b.group.traverse(drop); if (b.own) for (const sc of [b.own.picture, b.own.depth, b.own.fill, b.own.glass]) sc.traverse(drop);
    if (e.map) e.map.dispose();
    L.triangles -= b.triangles; L.litTriangles -= b.lit; L.drawCalls -= b.group.children.length; L.bytes -= e.fileBytes; L.mapBytes -= e.mapBytes; L.loaded = L.loaded.filter(n => n !== e.row.name); delete L.thin[e.row.name]; L.unloads++;
    e.built = e.map = null; e.state = 0;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  THE FAR COPY (GLTF.look.copy): a few hundred triangles for every building, always there
  // ══════════════════════════════════════════════════════════════════════
  // A full building is 3,000 to 48,000 triangles, drawn five times a frame (two shadow maps, its picture, its depth, the lay pass).
  // With fifty-eight of them in view that was 49 ms a frame on an integrated chip, and a building whose file was not loaded was a
  // hole (its old drawing is hidden for the session). So every row has a FAR COPY, made by scripts/gltf_far.py from the row's own
  // look file: its outline and roof levels, its walls in bands of their area-weighted mean colour, its mirror share, its sky light.
  //   - All far copies are fetched at the start (a few kB each). Those shown are ONE mesh in the city's scene: one draw call, and
  //     one more in each shadow map. It is rebuilt when the set changes.
  //   - WHICH ONE IS DRAWN goes by how many metres of the building one CSS pixel covers (`pxM` = its distance times the angle of a
  //     CSS pixel), not by a fixed distance: the full building while that is under `fullM`, the far copy alone from `farM`, and in
  //     between both, the full building laid over its far copy in a growing share (the lay pass's u_fade). So the change is a
  //     dissolve over a stretch of the approach, never a pop. A full file that arrives late dissolves in over `fadeS` seconds.
  //   - The full file is fetched when `pxM` falls under `loadM` and let go above `unloadM`; the far copy stands in meanwhile.
  //   - A row whose far file is missing is drawn as before (its full file by distance).
  const COPY = { group: null, mesh: null, mat: null, fadeMat: null, fades: new Map(), pending: 0, rows: 0, triangles: 0, shown: 0, bytes: 0, rebuilds: 0, dirty: false, t: 0, hooked: false, failed: null };
  GLTF.lookCopy = COPY;
  const cssAngle = () => { const m = window.__map, cv = m && m.getCanvas && m.getCanvas(); if (!cv) return 0; const fov = (m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 36.87) * Math.PI / 180; return 2 * Math.tan(fov / 2) / (cv.clientHeight || 900); };
  /** one row's far copy as vertex arrays in the city's own frame (four vertices a rectangle) */
  function copyArrays(S, row, F) {
    const h = row.headingDeg * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), O = S.toLocal(row.lng, row.lat, row.groundM || 0), og = row.lookOrigin || [0, 0, 0];
    const th = F.turnDeg * Math.PI / 180, tc = Math.cos(th), ts = Math.sin(th), C = F.colours, NQ = F.roofs.length / 6 + F.walls.length / 10;
    const A = { pos: new Float32Array(NQ * 12), nrm: new Float32Array(NQ * 12), uv: new Float32Array(NQ * 8), base: new Float32Array(NQ * 12), mirror: new Float32Array(NQ * 12), night: new Float32Array(NQ * 12), glass: new Float32Array(NQ * 4),
      farA: new Float32Array(NQ * 16), farB: new Float32Array(NQ * 16), idx: new Uint32Array(NQ * 6), nv: NQ * 4, triangles: NQ * 2 };
    const tone = hex3(GLTF.litTone), occ = (row.night && row.night.occupancy !== undefined ? row.night.occupancy : GLTF.nightLit) * GLTF.look.copy.nightShare;
    let q = 0;
    // (u, v, z) of the far file -> the model's x, y (the file's grid is turned to the building's main walls) -> the row's place and heading
    const put = (k, u, v, z, n, ci, mi, bandM) => {
      const x = u * tc - v * ts - og[0], y = u * ts + v * tc - og[1], zz = z - og[2], i = q * 4 + k;
      A.pos[i * 3] = O.x + x * c + y * s; A.pos[i * 3 + 1] = O.y - x * s + y * c; A.pos[i * 3 + 2] = O.z + zz;
      const nx = n[0] * tc - n[1] * ts, ny = n[0] * ts + n[1] * tc; A.nrm[i * 3] = nx * c + ny * s; A.nrm[i * 3 + 1] = -nx * s + ny * c; A.nrm[i * 3 + 2] = n[2];
      for (let j = 0; j < 3; j++) { A.base[i * 3 + j] = C[ci * 8 + j] / 1e4; A.mirror[i * 3 + j] = C[ci * 8 + 3 + j] / 1e4; A.farA[i * 4 + j] = C[mi * 8 + j] / 1e4; A.farB[i * 4 + j] = C[mi * 8 + 3 + j] / 1e4; A.night[i * 3 + j] = tone[j] * occ * C[ci * 8 + 6] / 1e3; }
      A.glass[i] = C[ci * 8 + 6] / 1e3; A.farA[i * 4 + 3] = bandM; A.farB[i * 4 + 3] = C[mi * 8 + 6] / 1e3; A.uv[i * 2] = C[ci * 8 + 7] / 1e3; A.uv[i * 2 + 1] = C[mi * 8 + 7] / 1e3;
    };
    const quad = (P4, n, ci, mi, bandM) => {
      // the corners are put in the order that makes the face's front the side its normal points to (the shader turns a back face's normal round)
      const e1 = [P4[1][0] - P4[0][0], P4[1][1] - P4[0][1], P4[1][2] - P4[0][2]], e2 = [P4[3][0] - P4[0][0], P4[3][1] - P4[0][1], P4[3][2] - P4[0][2]];
      const gn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], flip = gn[0] * n[0] + gn[1] * n[1] + gn[2] * n[2] < 0;
      for (let k = 0; k < 4; k++) { const p = P4[flip ? (4 - k) % 4 : k]; put(k, p[0], p[1], p[2], n, ci, mi, bandM); }
      A.idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6); q++;
    };
    for (let r = 0; r < F.roofs.length; r += 6) { const u0 = F.roofs[r] / 100, u1 = F.roofs[r + 1] / 100, v0 = F.roofs[r + 2] / 100, v1 = F.roofs[r + 3] / 100, z = F.roofs[r + 4] / 100, ci = F.roofs[r + 5];
      quad([[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]], [0, 0, 1], ci, ci, 0); }
    for (let w = 0; w < F.walls.length; w += 10) { const d = F.walls[w], p = F.walls[w + 1] / 100, a0 = F.walls[w + 2] / 100, a1 = F.walls[w + 3] / 100, z0 = F.walls[w + 4] / 100, z1 = F.walls[w + 5] / 100, ci = F.walls[w + 6], mi = F.walls[w + 7];
      const P4 = d < 2 ? [[p, a0, z0], [p, a1, z0], [p, a1, z1], [p, a0, z1]] : [[a0, p, z0], [a1, p, z0], [a1, p, z1], [a0, p, z1]], face = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]][d];
      // the corners' order goes by the grid face's own direction; the light goes by the wall's true direction (a slanted wall is drawn as small steps)
      const n = [F.walls[w + 8] / 1000, F.walls[w + 9] / 1000, 0], e1 = [P4[1][0] - P4[0][0], P4[1][1] - P4[0][1], 0], gn = [e1[1] * (z1 - z0), -e1[0] * (z1 - z0), 0], flip = gn[0] * face[0] + gn[1] * face[1] < 0;
      for (let k = 0; k < 4; k++) { const c4 = P4[flip ? (4 - k) % 4 : k]; put(k, c4[0], c4[1], c4[2], n, ci, mi, ci === mi ? 0 : z1 - z0); }
      A.idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6); q++; }
    return A;
  }
  const COPY_ATTRS = [['position', 'pos', 3], ['normal', 'nrm', 3], ['uv', 'uv', 2], ['aBase', 'base', 3], ['aMirror', 'mirror', 3], ['aNight', 'night', 3], ['aGlass', 'glass', 1], ['aFarA', 'farA', 4], ['aFarB', 'farB', 4]];
  function copyGeometry(list) {
    const T = window.THREE, geom = new T.BufferGeometry(); let nv = 0, ni = 0; for (const A of list) { nv += A.nv; ni += A.idx.length; }
    for (const [name, key, n] of COPY_ATTRS) { const a = new Float32Array(nv * n); let o = 0; for (const A of list) { a.set(A[key], o); o += A[key].length; } geom.setAttribute(name, new T.BufferAttribute(a, n)); }
    const idx = new Uint32Array(ni); let o = 0, base = 0; for (const A of list) { for (let i = 0; i < A.idx.length; i++) idx[o + i] = A.idx[i] + base; o += A.idx.length; base += A.nv; }
    geom.setIndex(new T.BufferAttribute(idx, 1)); geom.computeBoundingSphere(); geom.userData.bytes = nv * 112 + ni * 4;
    return geom;
  }
  function copyMaterial(S, push) {
    const mat = material(S, null, 0); mat.uniforms.u_lookCopy.value = 1; mat.uniforms.u_lookPush.value = push; mat.uniforms.u_skyMapStrength.value = GLTF.look.skyMapStrength;
    return mat;
  }
  function copyMesh(S, geom, mat, name) {
    const mesh = new window.THREE.Mesh(geom, mat); mesh.name = name; mesh.frustumCulled = false;
    mesh.onBeforeRender = () => { const U = S.uniforms(), C = GLTF.look.copy, cv = window.__map && window.__map.getCanvas(); window.CitySky.sync(mat.uniforms, U.u_p ? U.u_p.value : 0.3);
      mat.uniforms.u_lookPx.value = cssAngle() / (cv && cv.clientWidth ? cv.width / cv.clientWidth : 1); mat.uniforms.u_lookBand.value.set(1 / C.bandPx[0], 1 / C.bandPx[1]); };
    return mesh;
  }
  /** the one mesh of the far copies that stand alone, and a mesh each for those under a full building that is changing places with it */
  function copyRebuild(S) {
    COPY.dirty = false; if (!COPY.group) return;
    if (COPY.mesh) { COPY.group.remove(COPY.mesh); COPY.mesh.geometry.dispose(); COPY.mesh = null; }
    const alone = ROWS.filter(e => e.far && e.farMode === 1);
    if (alone.length) { COPY.mesh = copyMesh(S, copyGeometry(alone.map(e => e.far)), COPY.mat, 'gltf-look-far'); COPY.group.add(COPY.mesh); }
    for (const [e, mesh] of COPY.fades) if (e.farMode !== 2) { COPY.group.remove(mesh); mesh.geometry.dispose(); COPY.fades.delete(e); }
    for (const e of ROWS) if (e.far && e.farMode === 2 && !COPY.fades.has(e)) { const mesh = copyMesh(S, copyGeometry([e.far]), COPY.fadeMat, 'gltf-look-far-under'); mesh.layers.set(1); COPY.fades.set(e, mesh); COPY.group.add(mesh); }   // layer 1: it casts no shadow (the full building does)
    COPY.shown = alone.length; COPY.triangles = alone.reduce((a, e) => a + e.far.triangles, 0); COPY.bytes = (COPY.mesh ? COPY.mesh.geometry.userData.bytes : 0); for (const m of COPY.fades.values()) COPY.bytes += m.geometry.userData.bytes;
    COPY.rebuilds++;
  }
  /** metres of this row one CSS pixel covers, from where the camera's eye is */
  function rowPx(S, e) { const U = S.uniforms(), E = U && U.u_eye && U.u_eye.value; if (!E) return 0; e.dist = Math.hypot(E.x - e.at.x, E.y - e.at.y, E.z - e.at.z); return (e.pxM = e.dist * cssAngle()); }
  /** every frame, before the city is drawn: each row's share of full building (`fade`: 0 = the far copy alone, 1 = the full building alone) */
  // the full building's group is shown or hidden only when that CHANGES (a test that hides a group itself is then left alone)
  const show = (e, on) => { if (e.built.shown !== on) { e.built.shown = on; e.built.group.visible = on; } };
  function copyFrame(S) {
    const C = GLTF.look.copy, now = performance.now(), dt = Math.min(0.25, Math.max(0, (now - (COPY.t || now)) / 1000)); COPY.t = now;
    for (const e of ROWS) {
      const full = e.state === 2 && e.built, has = !!e.far && C.on;
      if (!has) { if (e.farMode) { e.farMode = 0; COPY.dirty = true; } if (full) { show(e, true); if (e.built.own) e.built.own.fade = 1; } e.fade = full ? 1 : 0; continue; }
      const px = rowPx(S, e), want = px <= C.fullM ? 1 : px >= C.farM ? 0 : (C.farM - px) / (C.farM - C.fullM), step = C.fadeS > 0 ? dt / C.fadeS : 1;
      if (!full) e.fade = 0; else e.fade = e.fade < want ? Math.min(want, e.fade + step) : Math.max(want, e.fade - step);
      // without smooth edges of its own (a canvas that is smoothed as a whole) there is no lay pass to dissolve with: the two change places at the half
      const blend = !!(full && e.built.own), f = blend ? e.fade : e.fade >= 0.5 ? 1 : 0, mode = f <= 0 ? 1 : f < 1 ? 2 : 0;
      if (mode !== e.farMode) { e.farMode = mode; COPY.dirty = true; }
      if (full) { show(e, f > 0); if (e.built.own) e.built.own.fade = f; }
    }
    if (COPY.dirty) copyRebuild(S);
  }
  function copyHook(S) {
    if (COPY.hooked || !S.scene) return; COPY.hooked = true;
    const prev = S.scene.onBeforeRender;
    S.scene.onBeforeRender = function (renderer, scene, camera) {
      if (prev) prev.apply(this, arguments);
      if (!_group || camera !== S.camera || scene.overrideMaterial || renderer.getRenderTarget()) return;
      try { copyFrame(S); } catch (err) { if (!COPY.failed) { COPY.failed = String(err && err.message || err); L.errors.push('far copy: ' + COPY.failed); console.error('[gltf-look] far copy', err); } }
    };
  }
  async function copyLoad(S, e) {
    const file = ((GLTF.look.oneWeather && e.row.lookClearDay) || e.row.look).replace(/\.glb$/, '-far.json');
    COPY.pending++; e.farState = 0;
    try { const r = await fetch(file); if (!r.ok) throw new Error('HTTP ' + r.status); const F = await r.json(); if (F.v !== 1) throw new Error('unknown far file version');
      if (_group && ROWS.includes(e)) { e.far = copyArrays(S, e.row, F); e.farState = 1; e.farMode = -1; COPY.rows++; COPY.dirty = true; } }
    catch (err) { e.farState = 2; L.errors.push(file + ': ' + (err && err.message || err)); }
    COPY.pending--; if (window.__map && window.__map.triggerRepaint) window.__map.triggerRepaint();
  }
  /** one look at the distances. GLTF.lookReady: every row that should be in at this camera is in (the test scripts wait on it) */
  function tick(S) {
    if (!_group) return;
    const LD = GLTF.look.load, U = S.uniforms(), E = U && U.u_eye && U.u_eye.value, todo = [];
    let loading = 0, waiting = 0;
    const C = GLTF.look.copy;
    for (const e of ROWS) {
      e.dist = LD.on && E ? Math.hypot(E.x - e.at.x, E.y - e.at.y, E.z - e.at.z) : 0;
      // a row with a far copy (or one still on its way): the full file by how large the building is on the screen. Without: by distance, as before
      const copy = C.on && LD.on && E && e.farState !== 2, px = copy ? rowPx(S, e) : 0;
      if (e.state === 1) loading++;
      else if (e.state === 0 && e.dist <= LD.inM && (!copy || px < C.loadM)) todo.push(e);
      else if (e.state === 2 && (e.dist > LD.outM || (copy && e.far && px > C.unloadM))) unloadRow(e);
    }
    todo.sort((a, b) => a.dist - b.dist); waiting = todo.length;
    for (const e of todo) { if (loading >= LD.atOnce) break; loading++; loadRow(S, e); }
    GLTF.lookReady = loading === 0 && waiting === 0 && COPY.pending === 0;
    if (window.__map && window.__map.triggerRepaint && (loading || COPY.dirty)) window.__map.triggerRepaint();
  }
  GLTF.lookTick = () => { const S = window.slopes; if (S) tick(S); return GLTF.lookReady; };
  function attach(S) {
    const want = !!(window.SLOPES && window.SLOPES.on && GLTF.on && GLTF.look.on);
    if (want && !_group) {
      const g = new window.THREE.Group(); g.name = 'gltf-look';
      ROWS.length = 0; for (const row of GLTF.buildings) if (row.look) { const O = S.toLocal(row.lng, row.lat, row.groundM || 0); ROWS.push({ row, state: 0, at: { x: O.x, y: O.y, z: O.z + (row.topM || 0) / 2 }, dist: 0, built: null, map: null, far: null, farState: 2, farMode: 0, fade: 0, pxM: 0 }); }
      _group = g; S.add(g); if (S.camera && S.camera.layers) S.camera.layers.enable(1);
      if (GLTF.look.copy.on) { COPY.group = new window.THREE.Group(); COPY.group.name = 'gltf-look-far-copies'; COPY.group.userData.lod = GLTF.lod; COPY.group.userData.minzoom = GLTF.minzoom; g.add(COPY.group);
        COPY.mat = copyMaterial(S, 0); COPY.fadeMat = copyMaterial(S, GLTF.look.copy.pushM); COPY.rows = 0; for (const e of ROWS) copyLoad(S, e); copyHook(S); }
      GLTF.lookReady = false; tick(S); _tick = setInterval(() => tick(S), GLTF.look.load.everyMs);
      console.log('[gltf-look]', ROWS.length, 'rows; loaded by distance:', GLTF.look.load.on);
    } else if (!want && _group) {
      clearInterval(_tick); _tick = null;
      for (const e of ROWS) unloadRow(e);
      if (COPY.mesh) COPY.mesh.geometry.dispose(); for (const m of COPY.fades.values()) m.geometry.dispose(); COPY.fades.clear(); if (COPY.mat) COPY.mat.dispose(); if (COPY.fadeMat) COPY.fadeMat.dispose(); COPY.mesh = COPY.mat = COPY.fadeMat = COPY.group = null; COPY.pending = 0;
      for (const k of Object.keys(OWN.pool)) { if (OWN.pool[k]) OWN.pool[k].dispose(); OWN.pool[k] = null; } OWN.list.length = 0; S.remove(_group); _group = null; GLTF.lookReady = false;
    }
    if (window.__map && window.__map.triggerRepaint) window.__map.triggerRepaint();
  }
  let n = 0, busy = false;
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const S = window.slopes;
      if (S && S.root && window.THREE && S.uniforms && S.uniforms() && window.CitySky && window.CityLighting && GLTF.internals) {
        clearInterval(timer);
        S.onSwitch(() => attach(S)); attach(S);
      } else if (++n > 900) clearInterval(timer);
    } catch (e) { L.errors.push(String(e && e.message || e)); console.error('[gltf-look]', e); clearInterval(timer); }
    busy = false;
  }, 200);
})();
