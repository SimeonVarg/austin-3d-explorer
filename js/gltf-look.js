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
        out.push({ material: (m.name || 'default').replace(/\.\d+$/, ''), base: (pbr.baseColorFactor || [0.5, 0.5, 0.5, 1]).slice(0, 3), glass: ex.look_kind === 'glass',
          mirror: ex.look_kind === 'glass' ? ex.look_glossy : [0, 0, 0], seeThrough: ex.look_transparent || 0, transmit: ex.look_transmit || [1, 1, 1],
          paint: p.attributes.COLOR_0 != null && ex.look_painted ? colours(p.attributes.COLOR_0) : null,
          pos: f32(p.attributes.POSITION, 3), nrm: f32(p.attributes.NORMAL, 3), uv: f32(p.attributes.TEXCOORD_0, 2), idx: ints(p.indices) });
      }
    }
    return out;
  }

  // ── the shader ──────────────────────────────────────────────────────────
  const VERT = `
    attribute vec3 aBase; attribute vec3 aMirror; attribute vec3 aNight; attribute float aGlass;
    varying vec3 v_pos, v_normal, v_base, v_mirror, v_night; varying vec2 v_uv; varying float v_glass;
    void main() {
      v_pos = position; v_normal = normal; v_base = aBase; v_mirror = aMirror; v_night = aNight; v_uv = uv; v_glass = aGlass;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const FRAG = () => `
    ${window.CityLighting.uniforms}
    #include <packing>
    ${window.CityLighting.glsl}
    ${window.CitySky.glsl}
    uniform sampler2D u_skyMap; uniform float u_skyMapStrength, u_nightWallAmbient, u_lookPass, u_lookThrough; uniform vec3 u_lookTransmit;
    varying vec3 v_pos, v_normal, v_base, v_mirror, v_night; varying vec2 v_uv; varying float v_glass;
    void main() {
      // see-through glass is drawn twice: first it dims what is behind it by its colour (this pass multiplies the picture), then it adds its own light
      if (u_lookPass > 0.5 && u_lookPass < 1.5) { gl_FragColor = vec4(pow(u_lookThrough * u_lookTransmit, vec3(1.0 / 2.2)), 1.0); return; }
      vec3 n = normalize(v_normal); if (!gl_FrontFacing) n = -n;
      vec3 view = normalize(u_eye - v_pos);
      float open = mix(1.0, texture2D(u_skyMap, v_uv).r, u_skyMapStrength);               // how much of the sky this spot sees (baked in Blender)
      float facing = max(dot(n, u_csSunDir), 0.0);
      float sunSeen = facing > 0.0 ? sunlightVisibility(v_pos, n) : 1.0;                   // the app's own two shadow maps
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
      gl_FragColor = vec4(col, 1.0);
    }`;

  /** pass 0: an ordinary surface. pass 1 and 2: see-through glass (multiply what is behind, then add its own light) */
  function material(S, skyMap, pass, through, transmit) {
    const T = window.THREE, U = S.uniforms();
    const mat = new T.ShaderMaterial({
      uniforms: Object.assign({}, U, window.CitySky.uniforms(), { u_skyMap: { value: skyMap }, u_skyMapStrength: { value: skyMap ? GLTF.look.skyMapStrength : 0 },
        u_lookPass: { value: pass }, u_lookThrough: { value: through || 0 }, u_lookTransmit: { value: new T.Vector3(...(transmit || [1, 1, 1])) } }),
      vertexShader: VERT, fragmentShader: FRAG(), side: T.DoubleSide, depthTest: true, depthWrite: pass === 0, transparent: pass > 0, blending: pass === 0 ? T.NoBlending : T.CustomBlending,
    });
    if (pass === 1) { mat.blendEquation = T.AddEquation; mat.blendSrc = T.ZeroFactor; mat.blendDst = T.SrcColorFactor; mat.blendSrcAlpha = T.ZeroFactor; mat.blendDstAlpha = T.OneFactor; }
    if (pass === 2) { mat.blendEquation = T.AddEquation; mat.blendSrc = T.OneFactor; mat.blendDst = T.OneFactor; mat.blendSrcAlpha = T.ZeroFactor; mat.blendDstAlpha = T.OneFactor; }
    return mat;
  }

  // ── one building ────────────────────────────────────────────────────────
  function build(S, row, prims, skyMap) {
    const T = window.THREE, h = row.headingDeg * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), O = S.toLocal(row.lng, row.lat, row.groundM || 0), og = row.lookOrigin || [0, 0, 0];
    // glTF (x, y, z) is the model's (x, -z, y): X along the street face, Y into the building, Z up. Then the compass heading of +Y.
    const world = (x, y, z) => [O.x + x * c + y * s, O.y - x * s + y * c, O.z + z], turn = (x, y, z) => [x * c + y * s, -x * s + y * c, z];
    const CN = window.CityNight, rules = !!(CN && CN.tune.on && row.replaces), mats = cf(row, 'materials') || {};
    if (rules) { CN.register({ id: row.replaces, name: row.name, category: 'apartment', night: row.night }); if (row.night && row.night.fixtures) CN.registerFixtures({ id: row.replaces, night: row.night }, { at: world }); }
    const I = GLTF.internals, parts = { solid: null, glass: null };
    const acc = () => ({ pos: [], nrm: [], uv: [], base: [], mirror: [], night: [], glass: [], idx: [] });
    let lit = 0, tris = 0;
    for (const p of prims) {
      const cfg = mats[p.material] || {}, A = p.seeThrough > 0 ? (parts.glass = parts.glass || Object.assign(acc(), { through: p.seeThrough, transmit: p.transmit })) : (parts.solid = parts.solid || acc());
      const base = A.pos.length / 3, nv = p.pos.length / 3, night = new Float32Array(nv * 3);
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
      for (let i = 0; i < nv; i++) {
        const w = world(P[i * 3], -P[i * 3 + 2], P[i * 3 + 1]), n = turn(p.nrm[i * 3], -p.nrm[i * 3 + 2], p.nrm[i * 3 + 1]);
        A.pos.push(w[0], w[1], w[2]); A.nrm.push(n[0], n[1], n[2]); A.uv.push(p.uv[i * 2], p.uv[i * 2 + 1]);
        if (p.paint) A.base.push(p.base[0] * p.paint[i * 3], p.base[1] * p.paint[i * 3 + 1], p.base[2] * p.paint[i * 3 + 2]); else A.base.push(p.base[0], p.base[1], p.base[2]);
        A.mirror.push(p.mirror[0], p.mirror[1], p.mirror[2]); A.glass.push(p.glass ? 1 : 0);
        A.night.push(night[i * 3], night[i * 3 + 1], night[i * 3 + 2]);
      }
      for (const v of p.idx) A.idx.push(base + v); tris += p.idx.length / 3;
    }
    const g = new T.Group(); g.name = 'gltf-look-' + row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); g.userData.lod = GLTF.lod; g.userData.minzoom = GLTF.minzoom;
    let bytes = 0;
    for (const [name, A] of Object.entries(parts)) {
      if (!A) continue;
      const geom = new T.BufferGeometry(), F = (a, n) => new T.BufferAttribute(Float32Array.from(a), n);
      geom.setAttribute('position', F(A.pos, 3)); geom.setAttribute('normal', F(A.nrm, 3)); geom.setAttribute('uv', F(A.uv, 2));
      geom.setAttribute('aBase', F(A.base, 3)); geom.setAttribute('aMirror', F(A.mirror, 3)); geom.setAttribute('aNight', F(A.night, 3)); geom.setAttribute('aGlass', F(A.glass, 1));
      geom.setIndex(new T.BufferAttribute(Uint32Array.from(A.idx), 1)); geom.computeBoundingSphere();
      for (const pass of (A.through ? [1, 2] : [0])) {
        const mat = material(S, skyMap, pass, A.through, A.transmit), mesh = new T.Mesh(geom, mat);
        mesh.name = g.name + '-' + name + (pass ? pass : ''); mesh.renderOrder = pass; if (pass) mesh.layers.set(1);   // see-through glass casts no shadow (the shadow cameras see layer 0 only)
        // the light for the hour, once per frame: the sky and sun from js/city-sky.js at the app's own clock
        mesh.onBeforeRender = () => { const U = S.uniforms(); window.CitySky.sync(mat.uniforms, U.u_p ? U.u_p.value : 0.3); };
        g.add(mesh);
      }
      bytes += A.pos.length / 3 * 60 + A.idx.length * 4;
    }
    return { group: g, triangles: tris, lit, bytes };
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
        const buf = await fetchBuf(row.look), map = await loadMap(row.look.replace(/\.glb$/, '-sky.png'));
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
        try { const b = build(S, p.row, p.prims, p.map); g.add(b.group); L.triangles += b.triangles; L.litTriangles += b.lit; L.drawCalls += b.group.children.length; L.loaded.push(p.row.name); }
        catch (e) { L.errors.push(p.row.name + ': ' + e.message); console.error('[gltf-look]', p.row.name, e); }
      }
      _group = g; S.add(g); if (S.camera && S.camera.layers) S.camera.layers.enable(1);
      console.log('[gltf-look]', L.loaded.join(', ') || 'nothing', '—', L.triangles, 'triangles,', L.drawCalls, 'draw call(s),', L.bytes, 'bytes');
    } else if (!want && _group) { S.remove(_group); _group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); _group = null; }
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
