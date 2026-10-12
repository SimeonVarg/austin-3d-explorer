/**
 * gltf-layer-draw.js — the drawing half of js/gltf-layer.js (read that file's header first). Fetched only when ?gltf=1:
 * the .glb loader, the colour triples, the pane hash for night windows, the mesh built through the city's own builder, and the
 * boot that waits for js/slopes.js.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(window.location.search);
  const GLTF = window.GLTF_LAYER, info = GLTF.info;
  GLTF.parse = parseGlb;   // for scripts/verify/gltf-layer.mjs

  // ══════════════════════════════════════════════════════════════════════
  //  THE .glb LOADER — exactly what a flat-coloured Blender export contains, and a loud error for anything else
  // ══════════════════════════════════════════════════════════════════════
  const COMP = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function parseGlb(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67 || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2.0 binary');
    let json = null, bin = null, o = 12;
    while (o + 8 <= buf.byteLength) {
      const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, len)));
      else if (type === 0x004E4942 && !bin) bin = new Uint8Array(buf, o + 8, len);
      o += 8 + len;   // chunk lengths are padded to 4 bytes in the file already
    }
    if (!json || !bin) throw new Error('glTF binary without a JSON and a BIN chunk');
    if (json.images && json.images.length) throw new Error('glTF carries images; this layer draws flat colours only');
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const read = i => {
      const a = json.accessors[i];
      if (a.sparse) throw new Error('sparse accessors are not supported');
      const bv = json.bufferViews[a.bufferView], [size, get] = COMP[a.componentType], n = NCOMP[a.type];
      if (!size || !n) throw new Error('unsupported accessor ' + a.componentType + '/' + a.type);
      const stride = bv.byteStride || size * n, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
      const out = a.componentType === 5126 ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
      for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = view[get](base + k * stride + c * size, true);
      return out;
    };
    const meshes = [];
    for (const node of json.nodes || []) {
      if (node.mesh == null) continue;
      if (node.matrix || node.translation || node.rotation || node.scale) throw new Error('node transforms are not supported (apply them in Blender)');
      for (const p of json.meshes[node.mesh].primitives) {
        if (p.mode != null && p.mode !== 4) throw new Error('only triangle lists are supported');
        const m = (json.materials || [])[p.material] || {};
        const f = (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor) || [0.5, 0.5, 0.5, 1];
        const pos = read(p.attributes.POSITION);
        const idx = p.indices != null ? read(p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
        meshes.push({ material: (m.name || 'default').replace(/\.\d+$/, ''), linear: f.slice(0, 3), pos, idx });
      }
    }
    return meshes;
  }

  // ── colour ──────────────────────────────────────────────────────────────
  const clamp8 = v => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = rgb => '#' + rgb.map(v => clamp8(v).toString(16).padStart(2, '0')).join('');
  const fromHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const srgb255 = v => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function tripleFor(mesh) {
    const cfg = GLTF.materials[mesh.material] || {};
    const day = cfg.day || toHex(mesh.linear.map(srgb255)), d = fromHex(day);
    const col = [day,
      toHex(mix(d, GLTF.goldTo, GLTF.goldMix)),
      cfg.night || toHex(mix(d.map(v => v * GLTF.nightGain), GLTF.nightTint, GLTF.nightToward))];
    const kinds = (window.APARTMENTS && window.APARTMENTS.materials) || {};
    if (cfg.surface && Array.isArray(kinds[cfg.surface])) {
      col.surface = kinds[cfg.surface].slice();
      if (cfg.strength != null) col.surface[3] = cfg.strength;
    }
    return col;
  }

  // ── panes: the two triangles of a quad share its longest edge (the diagonal) ──────────────
  const q3 = v => Math.round(v * 1000);
  const edgeKey = (P, i, j) => { const a = q3(P[i * 3]) + ',' + q3(P[i * 3 + 1]) + ',' + q3(P[i * 3 + 2]), b = q3(P[j * 3]) + ',' + q3(P[j * 3 + 1]) + ',' + q3(P[j * 3 + 2]); return a < b ? a + '|' + b : b + '|' + a; };
  /** one number in 0..1 per triangle: the same for both triangles of a pane, a hash of the pane's place */
  function paneHash(P, I) {
    const T = I.length / 3, longest = new Array(T), byEdge = new Map(), out = new Float32Array(T);
    for (let t = 0; t < T; t++) {
      const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]; let best = -1, bi = 0;
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3], d = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
        if (d > best) { best = d; bi = e; }
      }
      const k = edgeKey(P, v[bi], v[(bi + 1) % 3]); longest[t] = k;
      (byEdge.get(k) || byEdge.set(k, []).get(k)).push(t);
    }
    for (let t = 0; t < T; t++) {
      const pair = byEdge.get(longest[t]), ids = pair.length === 2 ? pair : [t];
      let cx = 0, cy = 0, cz = 0;
      for (const u of ids) for (let c = 0; c < 3; c++) { const v = I[u * 3 + c]; cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
      const n = ids.length * 3, h = Math.sin(q3(cx / n) * 12.9898 + q3(cy / n) * 78.233 + q3(cz / n) * 37.719) * 43758.5453;
      out[t] = h - Math.floor(h);
    }
    return out;
  }

  // ── build the group ─────────────────────────────────────────────────────
  function buildBuilding(S, row, meshes) {
    const T = window.THREE, h = row.headingDeg * Math.PI / 180, c = Math.cos(h), s = Math.sin(h);
    const O = S.toLocal(row.lng, row.lat, row.groundM || 0);
    // glTF (x, y, z) is Blender's (x, -z, y): X along the face, Y into the building, Z up. Then the compass heading of +Y.
    const world = (x, y, z) => [O.x + x * c + y * s, O.y - x * s + y * c, O.z + z];
    const B = S.build(1 << 14);
    let tris = 0, verts = 0, litPanes = 0;
    const t0 = performance.now();
    for (const m of meshes) {
      const col = tripleFor(m), P = m.pos, I = m.idx, pt = i => world(P[i * 3], -P[i * 3 + 2], P[i * 3 + 1]);
      const cfg = GLTF.materials[m.material] || {};
      let lit = null, hash = null;
      if (cfg.lit && GLTF.nightLit > 0) { lit = col.slice(); lit[2] = GLTF.litTone; lit.surface = col.surface; hash = paneHash(P, I); }
      verts += P.length / 3;
      for (let k = 0; k + 2 < I.length; k += 3) {
        const on = lit && hash[k / 3] < GLTF.nightLit;
        if (on) litPanes++;
        B.tri(pt(I[k]), pt(I[k + 1]), pt(I[k + 2]), on ? lit : col); tris++;
      }
    }
    info.buildMs += +(performance.now() - t0).toFixed(1);
    const g = new T.Group();
    g.name = 'gltf-' + row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    g.userData.lod = GLTF.lod;
    g.userData.minzoom = GLTF.minzoom;
    const mesh = new T.Mesh(B.geometry(), S.material({ side: GLTF.twoSided ? T.DoubleSide : T.FrontSide }));
    mesh.name = g.name + '-mesh';
    g.add(mesh);
    return { group: g, triangles: B.triangles, sourceTriangles: tris, vertices: verts, litTriangles: litPanes };
  }

  async function fetchGlb(url) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), GLTF.fetchTimeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return await r.arrayBuffer();
    } finally { clearTimeout(timer); }
  }

  let _root = null, _loading = null, _parsed = null;
  async function load(S) {
    if (_parsed) return _parsed;
    const t0 = performance.now();
    _parsed = await Promise.all(GLTF.buildings.map(async row => {
      try {
        const buf = await fetchGlb(row.file);
        info.bytes += buf.byteLength;
        return { row, meshes: parseGlb(buf) };
      } catch (e) { info.errors.push(row.file + ': ' + e.message); console.warn('[gltf-layer]', row.file, e.message); return null; }
    }));
    info.ms = +(performance.now() - t0).toFixed(1);
    return _parsed;
  }
  function attach(S) {
    const want = !!(window.SLOPES && window.SLOPES.on && GLTF.on);
    if (want && !GLTF.group && _parsed) {
      const g = new window.THREE.Group(); g.name = 'gltf-layer';
      info.triangles = info.vertices = info.drawCalls = info.litTriangles = 0; info.loaded = [];
      for (const p of _parsed) {
        if (!p) continue;
        try {
          const b = buildBuilding(S, p.row, p.meshes);
          g.add(b.group); info.triangles += b.triangles; info.vertices += b.vertices; info.litTriangles += b.litTriangles; info.drawCalls += 1; info.loaded.push(p.row.name);
        } catch (e) { info.errors.push(p.row.name + ': ' + e.message); console.error('[gltf-layer]', p.row.name, e); }
      }
      // The group of groups carries no tier of its own: each building's group has its own userData.lod / minzoom.
      GLTF.group = g; S.add(g);
      console.log('[gltf-layer]', info.loaded.join(', ') || 'nothing', '—', info.triangles, 'triangles,', info.drawCalls, 'draw call(s),', info.bytes, 'bytes,', info.ms, 'ms to fetch');
    } else if (!want && GLTF.group) { S.remove(GLTF.group); GLTF.group = null; }
    GLTF.ready = !!GLTF.group;
  }

  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!map || !S || !S.root || !window.THREE || !S.material || !S.build) return false;
    if (!_loading) {
      _loading = load(S).then(() => {
        S.onSwitch(() => attach(S));
        attach(S);
        if (map.triggerRepaint) map.triggerRepaint();
      });
    }
    await _loading;
    return true;
  }
  (function poll() {
    if (q.get('slopes') === '0') return;
    let n = 0, busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      let done = false;
      try { done = await boot(); } catch (e) { console.error('[gltf-layer]', e); info.errors.push(String(e && e.message || e)); done = true; }
      busy = false;
      if (done || ++n > 900) clearInterval(t);
    }, 200);
  })();
})();
