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
  const q3 = v => Math.round(v * 1000);

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
  const clamp255 = v => Math.max(0, Math.min(255, v));
  const tripleCache = new Map();
  /** the [day, golden, night] colours of a material on a face the sun does (`side` 'sun') or does not ('shade') reach at the photograph's hour */
  function tripleFor(mesh, side, variant) {
    const key = mesh.material + '|' + (side || '') + '|' + (variant || '');
    let col = tripleCache.get(key);
    if (col) return col;
    const cfg = variant === 'crown' ? Object.assign({}, GLTF.materials[mesh.material] || {}, GLTF.crownGlass) : (GLTF.materials[mesh.material] || {});
    let d = cfg.day ? fromHex(cfg.day) : mesh.linear.map(srgb255);
    const gain = side && cfg.fix && GLTF.litFix[side] && GLTF.litFix[side][cfg.fix];
    let boost = [1, 1, 1];
    if (gain) {
      const raw = d.map((v, i) => Math.max(0, v * gain[i]));
      d = raw.map(v => Math.min(255, v));
      // A colour above white cannot be stored in a byte: the excess is kept as a per-channel multiplier of the albedo (aBoost), which the
      // layer's own copy of the city's shader applies. The lit white slab in the photograph is brighter than the city's light can make white.
      boost = raw.map((v, i) => d[i] > 0 ? v / d[i] : 1);
    }
    col = [toHex(d), toHex(mix(d, GLTF.goldTo, GLTF.goldMix)),
      cfg.night || toHex(mix(d.map(v => v * GLTF.nightGain), GLTF.nightTint, GLTF.nightToward))];
    col.boost = boost;
    const kinds = (window.APARTMENTS && window.APARTMENTS.materials) || {};
    if (cfg.surface && Array.isArray(kinds[cfg.surface])) {
      col.surface = kinds[cfg.surface].slice();
      if (cfg.strength != null) col.surface[3] = cfg.strength;
      if (cfg.surface === 'glass' && GLTF.glassStrength != null && cfg.strength == null) col.surface[3] = GLTF.glassStrength;
    }
    tripleCache.set(key, col);
    return col;
  }
  /** does the sun reach a face with this normal (the model's frame, unit length) at the photograph's hour? The model turned by its heading, the app's own sun */
  function sunLit(n, headingDeg) {
    const sun = window.skyBodies ? window.skyBodies(GLTF.photoHour).sun : { az: 181, elev: 51 };
    const az = sun.az * Math.PI / 180, el = sun.elev * Math.PI / 180, L = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];   // east, north, up
    const h = headingDeg * Math.PI / 180, c = Math.cos(h), s = Math.sin(h);
    const w = [n[0] * c + n[1] * s, -n[0] * s + n[1] * c, n[2]];                                                          // the same turn as world()
    return w[0] * L[0] + w[1] * L[1] + w[2] * L[2] > GLTF.sunThreshold;
  }
  /** per triangle: 1 when the sun reaches its face */
  function sunSides(P, I, headingDeg) {
    const T = I.length / 3, out = new Uint8Array(T);
    for (let t = 0; t < T; t++) {
      const v = [0, 1, 2].map(j => { const i = I[t * 3 + j] * 3; return [P[i], -P[i + 2], P[i + 1]]; });
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], len = Math.hypot(n[0], n[1], n[2]) || 1;
      out[t] = sunLit([n[0] / len, n[1] / len, n[2] / len], headingDeg) ? 1 : 0;
    }
    return out;
  }

  const edgeKey = (P, i, j) => { const a = q3(P[i * 3]) + ',' + q3(P[i * 3 + 1]) + ',' + q3(P[i * 3 + 2]), b = q3(P[j * 3]) + ',' + q3(P[j * 3 + 1]) + ',' + q3(P[j * 3 + 2]); return a < b ? a + '|' + b : b + '|' + a; };
  /** for every triangle the triangles of its pane: a quad is two triangles sharing its longest edge (the diagonal) */
  function paneOf(P, I) {
    const T = I.length / 3, longest = new Array(T), byEdge = new Map(), out = new Array(T);
    for (let t = 0; t < T; t++) {
      const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]; let best = -1, bi = 0;
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3], d = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
        if (d > best) { best = d; bi = e; }
      }
      const k = edgeKey(P, v[bi], v[(bi + 1) % 3]); longest[t] = k;
      (byEdge.get(k) || byEdge.set(k, []).get(k)).push(t);
    }
    for (let t = 0; t < T; t++) { const pair = byEdge.get(longest[t]); out[t] = pair.length === 2 ? pair : [t]; }
    return out;
  }
  const centreOf = (P, I, ids) => { let cx = 0, cy = 0, cz = 0; for (const u of ids) for (let c = 0; c < 3; c++) { const v = I[u * 3 + c]; cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; } const n = ids.length * 3; return [cx / n, cy / n, cz / n]; };   // glTF axes
  /** one number in 0..1 per triangle: the same for both triangles of a pane, a hash of the pane's place (the fallback when the city's night rules are off) */
  function paneHash(P, I) {
    const panes = paneOf(P, I), out = new Float32Array(panes.length);
    for (let t = 0; t < panes.length; t++) {
      const c = centreOf(P, I, panes[t]), h = Math.sin(q3(c[0]) * 12.9898 + q3(c[1]) * 78.233 + q3(c[2]) * 37.719) * 43758.5453;
      out[t] = h - Math.floor(h);
    }
    return out;
  }
  /** where each pane is, for the city's night rules (CityNight.room): its wall, its floor (from its height) and its column (its place in its row on that wall) */
  function paneAddress(P, I) {
    const panes = paneOf(P, I), T = panes.length, floor = new Int16Array(T), col = new Int16Array(T), wall = new Array(T), wide = new Uint8Array(T);
    const rows = new Map(), info = new Array(T);
    for (let t = 0; t < T; t++) {
      const ids = panes[t];
      if (ids[0] !== t) { info[t] = info[ids[0]]; continue; }    // the second triangle of a pane takes the first one's address
      const a = [0, 1, 2].map(j => { const i = I[t * 3 + j] * 3; return [P[i], -P[i + 2], P[i + 1]]; });        // model frame
      const e1 = a[1].map((v, i) => v - a[0][i]), e2 = a[2].map((v, i) => v - a[0][i]);
      const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const ax = Math.abs(nn[0]) > Math.abs(nn[1]) ? 0 : 1, sgn = Math.sign(nn[ax]) || 1, c = centreOf(P, I, ids), cm = [c[0], -c[2], c[1]];
      const fl = Math.floor((cm[2] + GLTF.storeyOffsetM) / GLTF.storeyM), key = ax + '' + (sgn > 0 ? 'p' : 'm') + '|' + Math.round(sgn * cm[ax] * 2) + '|' + fl;
      let s0 = Infinity, s1 = -Infinity; for (const u of ids) for (let c2 = 0; c2 < 3; c2++) { const sv = P[I[u * 3 + c2] * 3 + (ax === 0 ? 2 : 0)] * (ax === 0 ? -1 : 1); s0 = Math.min(s0, sv); s1 = Math.max(s1, sv); }   // extent along the wall
      const rec = { t, ax, sgn, fl, s: cm[1 - ax], wide: s1 - s0 > GLTF.maxRoomWidthM, wallKey: ax + (sgn > 0 ? 'p' : 'm') + Math.round(sgn * cm[ax] * 2), key };
      info[t] = rec; (rows.get(key) || rows.set(key, []).get(key)).push(rec);
    }
    for (const list of rows.values()) { list.sort((x, y) => x.s - y.s); list.forEach((r, i) => { r.col = i; }); }
    for (let t = 0; t < T; t++) { const r = info[t]; floor[t] = r.fl; col[t] = r.col; wall[t] = r.wallKey; wide[t] = r.wide ? 1 : 0; }
    return { floor, col, wall, wide };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  FAR STEADINESS — the city's facade-filter overlay, built from the model's own quads (GLTF.facade, CLAUDE.md rule 15)
  // ══════════════════════════════════════════════════════════════════════
  // A recipe knows its wall as cells that partition it. This model knows it as quads in front of quads (panes on a wall), so the quads
  // are painted back to front into a fine grid and the grid is averaged down to the wall map's texels: the exact area average of what
  // the eye would see. Only faces with an axis-aligned normal take part (every wall of this model); roofs and slanted faces stay geometry.
  const tol = 0.002;
  const inBox = (a, b) => a[0] >= b[0] - tol && a[1] <= b[1] + tol && a[2] >= b[2] - tol && a[3] <= b[3] + tol;
  function wallTris(meshes) {
    const out = [];
    meshes.forEach((m, mi) => {
      const P = m.pos, I = m.idx;
      for (let k = 0; k + 2 < I.length; k += 3) {
        const v = [0, 1, 2].map(j => { const i = I[k + j] * 3; return [P[i], -P[i + 2], P[i + 1]]; });   // the model frame: X, Y, Z up
        const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], L = Math.hypot(n[0], n[1], n[2]);
        if (L < 1e-9) continue;
        let ax = -1;
        for (const a of [0, 1]) if (Math.abs(n[a]) / L > 0.999) ax = a;
        if (ax < 0) continue;                                   // a roof, or slanted
        const sgn = Math.sign(n[ax]), oth = 1 - ax, pts = v.map(p => [p[oth], p[2]]);
        const bb = [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))];
        out.push({ mi, ax, sgn, oth, dir: ax * 2 + (sgn > 0 ? 1 : 0), d: sgn * v[0][ax], pts, bb, area: L / 2 });
      }
    });
    return out;
  }
  /** The wall faces that get an overlay: [{ ax, sgn, oth, d, s0, s1, z0, z1, tris, details }] — d is the overlay's offset along the normal */
  function facePlan(meshes) {
    const F = GLTF.facade, T = wallTris(meshes), groups = new Map(), rects = [];
    for (const t of T) { const k = t.dir + '|' + t.mi + '|' + q3(t.d) + '|' + t.bb.map(q3).join(','); (groups.get(k) || groups.set(k, []).get(k)).push(t); }
    for (const ts of groups.values()) {
      const t = ts[0], box = (t.bb[1] - t.bb[0]) * (t.bb[3] - t.bb[2]);
      if (ts.length === 2 && Math.abs(ts[0].area + ts[1].area - box) <= 0.01 * box) { ts[0].rect = true; ts[1].skip = true; rects.push({ dir: t.dir, d: t.d, bb: t.bb, area: box, t }); }
    }
    const plan = [];
    for (let dir = 0; dir < 4; dir++) {
      const R = rects.filter(r => r.dir === dir).sort((a, b) => b.area - a.area), bases = [];
      for (const r of R) if (!bases.some(q => q.area >= r.area && inBox(r.bb, q.bb) && r.d - q.d >= -F.behind && r.d - q.d <= F.front)) bases.push(r);
      for (const b of bases) {
        if (b.area < F.minArea) continue;
        const tris = T.filter(t => t.dir === dir && inBox(t.bb, b.bb) && t.d - b.d >= -F.behind && t.d - b.d <= F.front);
        const details = tris.length - 2;
        if (details < F.minDetails) continue;
        const t0 = b.t;
        plan.push({ ax: t0.ax, sgn: t0.sgn, oth: t0.oth, d: Math.max(...tris.map(t => t.d)) + F.lift, s0: b.bb[0], s1: b.bb[1], z0: b.bb[2], z1: b.bb[3],
          baseMi: t0.mi, tris: tris.sort((a, c) => a.d - c.d || a.mi - c.mi), details });
      }
    }
    return plan;
  }
  /** one row per material: day rgb, golden rgb, night rgb, glass response, glass flag (the facade filter's own channels) */
  function paletteOf(meshes, side) {
    return meshes.map(m => {
      const c = tripleFor(m, side), kind = c.surface && c.surface[0], glass = kind === 4 || kind === 6 ? 1 : 0;
      const response = kind === 6 ? 1 : kind === 4 ? Math.max(0, Math.min(1, c.surface[3] == null ? 1 : c.surface[3])) : 0;
      const d = fromHex(c[0]), g = fromHex(c[1]);
      return Float32Array.from([...d.map((v, i) => v * c.boost[i]), ...g.map((v, i) => v * c.boost[i]), ...fromHex(c[2]), response * 255, glass * 255]);   // the boost is put back: the face carries it as one number
    });
  }
  const potSide = (m, F) => Math.max(1, Math.min(2 ** Math.floor(Math.log2(Math.min(512, F.maxDimension))), 2 ** Math.ceil(Math.log2(Math.max(1, m / F.texelMetres)))));
  /** paint the face back to front on a fine grid, then average it down: the wall map's day / golden / night texels (RGBA, rows from z0 up) */
  function paintFace(f, palette) {
    const F = GLTF.facade, SS = F.supersample, len = f.s1 - f.s0, hgt = f.z1 - f.z0;
    const width = potSide(len, F), height = potSide(hgt, F), GW = width * SS, GH = height * SS, ds = len / GW, dz = hgt / GH;
    const owner = new Int16Array(GW * GH).fill(f.baseMi);
    for (const t of f.tris) {
      if (t.skip) continue;                                     // the second triangle of a rectangle: the first one fills the whole box
      if (t.rect) {                                             // a rectangle (almost every quad here): fill its cells, no per-cell test
        const i0 = Math.max(0, Math.round((t.bb[0] - f.s0) / ds)), i1 = Math.min(GW, Math.round((t.bb[1] - f.s0) / ds));
        const j0 = Math.max(0, Math.round((t.bb[2] - f.z0) / dz)), j1 = Math.min(GH, Math.round((t.bb[3] - f.z0) / dz));
        for (let j = j0; j < j1; j++) owner.fill(t.mi, j * GW + i0, j * GW + Math.max(i0, i1));
        continue;
      }
      const [a, b, c] = t.pts, det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-12) continue;
      const i0 = Math.max(0, Math.floor((t.bb[0] - f.s0) / ds - 0.5)), i1 = Math.min(GW - 1, Math.ceil((t.bb[1] - f.s0) / ds - 0.5));
      const j0 = Math.max(0, Math.floor((t.bb[2] - f.z0) / dz - 0.5)), j1 = Math.min(GH - 1, Math.ceil((t.bb[3] - f.z0) / dz - 0.5));
      for (let j = j0; j <= j1; j++) {
        const z = f.z0 + (j + 0.5) * dz;
        for (let i = i0; i <= i1; i++) {
          const s = f.s0 + (i + 0.5) * ds;
          const l1 = ((b[1] - c[1]) * (s - c[0]) + (c[0] - b[0]) * (z - c[1])) / det, l2 = ((c[1] - a[1]) * (s - c[0]) + (a[0] - c[0]) * (z - c[1])) / det, l3 = 1 - l1 - l2;
          if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) owner[j * GW + i] = t.mi;
        }
      }
    }
    // the face's own boost: the largest a colour channel of anything painted on it goes above 255 (never below 1)
    const used = new Set(); for (let i = 0; i < owner.length; i++) used.add(owner[i]);
    const boost = [1, 1, 1]; for (const mi of used) for (let k = 0; k < 3; k++) boost[k] = Math.max(boost[k], palette[mi][k] / 255, palette[mi][3 + k] / 255);
    const pal = palette.map(p => { const q = Float32Array.from(p); for (let k = 0; k < 3; k++) { q[k] = p[k] / boost[k]; q[3 + k] = p[3 + k] / boost[k]; } return q; });
    const day = new Uint8Array(width * height * 4), gold = new Uint8Array(width * height * 4), night = new Uint8Array(width * height * 4), n = SS * SS;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let r0 = 0, g0 = 0, b0 = 0, r1 = 0, g1 = 0, b1 = 0, r2 = 0, g2 = 0, b2 = 0, resp = 0, gl = 0;
      const first = owner[y * SS * GW + x * SS];
      let same = true;
      for (let sy = 0; sy < SS && same; sy++) for (let sx = 0; sx < SS; sx++) if (owner[(y * SS + sy) * GW + x * SS + sx] !== first) { same = false; break; }
      const o = (y * width + x) * 4;
      if (same) {                                               // a texel inside one pane or one wall: no sum needed
        const p = pal[first];
        day[o] = p[0]; day[o + 1] = p[1]; day[o + 2] = p[2]; day[o + 3] = p[9]; gold[o] = p[3]; gold[o + 1] = p[4]; gold[o + 2] = p[5]; gold[o + 3] = p[10];
        night[o] = p[6]; night[o + 1] = p[7]; night[o + 2] = p[8]; night[o + 3] = 255;
        continue;
      }
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const p = pal[owner[(y * SS + sy) * GW + x * SS + sx]];
        r0 += p[0]; g0 += p[1]; b0 += p[2]; r1 += p[3]; g1 += p[4]; b1 += p[5]; r2 += p[6]; g2 += p[7]; b2 += p[8]; resp += p[9]; gl += p[10];
      }
      day[o] = Math.round(r0 / n); day[o + 1] = Math.round(g0 / n); day[o + 2] = Math.round(b0 / n); day[o + 3] = Math.round(resp / n);
      gold[o] = Math.round(r1 / n); gold[o + 1] = Math.round(g1 / n); gold[o + 2] = Math.round(b1 / n); gold[o + 3] = Math.round(gl / n);
      night[o] = Math.round(r2 / n); night[o + 1] = Math.round(g2 / n); night[o + 2] = Math.round(b2 / n); night[o + 3] = 255;
    }
    return { width, height, day, gold, night, boost };
  }
  GLTF.faces = { plan: facePlan, paint: paintFace, palette: m => paletteOf(m, 'shade') };
     // for scripts/verify/gltf-layer.mjs

  /** the overlay quad of one painted face, in the city's own scene, drawn by the city's own facade-filter material */
  function faceMesh(S, f, tex, world) {
    const T = window.THREE, F = GLTF.facade, textures = {};
    for (const name of ['day', 'gold', 'night']) {
      const t = new T.DataTexture(tex[name], tex.width, tex.height, T.RGBAFormat, T.UnsignedByteType);
      t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
      t.generateMipmaps = true; t.flipY = false; t.anisotropy = F.anisotropy;
      if ('colorSpace' in t && T.NoColorSpace !== undefined) t.colorSpace = T.NoColorSpace; else if (T.LinearEncoding !== undefined) t.encoding = T.LinearEncoding;   // hex-channel numbers, no sRGB decode
      t.needsUpdate = true; textures[name] = t;
    }
    const face = { textures, len: f.s1 - f.s0, z0: f.z0, z1: f.z1 };
    const at = (s, z) => { const v = [0, 0, z]; v[f.oth] = s; v[f.ax] = f.sgn * f.d; return world(v[0], v[1], v[2]); };
    const o0 = world(0, 0, 0), nv = [0, 0, 0]; nv[f.ax] = f.sgn;
    const want = (() => { const w = world(nv[0], nv[1], nv[2]); return [w[0] - o0[0], w[1] - o0[1], w[2] - o0[2]]; })();
    const fb = S.build(4), col = ['#808080', '#808080', '#808080'];
    fb.quad(at(f.s0, f.z0), at(f.s1, f.z0), at(f.s1, f.z1), at(f.s0, f.z1), col, want);
    const geom = fb.geometry();
    geom.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const mat = boostFacade(S.facadeMaterial(face, F), tex.boost || [1, 1, 1]);
    const mesh = new T.Mesh(geom, mat);
    mesh.name = 'gltf-facade';
    mesh.layers.set(1);   // not in the sun shadow maps (their cameras only see layer 0); the scene camera is told to see layer 1 in attach()
    mesh.userData.disposeFacade = () => { Object.values(textures).forEach(t => t.dispose()); mat.dispose(); };
    return { mesh, bytes: (tex.width * tex.height * 4 * 3 * 4) / 3 };
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function addFaces(S, group, row, meshes, world) {
    const F = GLTF.facade;
    if (!F.on || !window.THREE) return;
    const t0 = performance.now();
    const plan = facePlan(meshes), palette = { shade: paletteOf(meshes, 'shade'), sun: paletteOf(meshes, 'sun') };
    info.faces = 0; info.faceBytes = 0; info.faceWorkMs = 0;
    for (const f of plan) {
      await tick();
      if (!GLTF.group) return;                                  // the layer was switched off meanwhile
      try {
        const w0 = performance.now(), nrm = [0, 0, 0]; nrm[f.ax] = f.sgn;
        const m = faceMesh(S, f, paintFace(f, palette[sunLit(nrm, row.headingDeg) ? 'sun' : 'shade']), world);
        group.add(m.mesh); info.faces++; info.faceBytes += m.bytes; info.faceWorkMs = +(info.faceWorkMs + performance.now() - w0).toFixed(1);
      } catch (e) { info.errors.push('face: ' + e.message); console.error('[gltf-layer] face', e); }
    }
    info.faceMs = +(performance.now() - t0).toFixed(1);
    if (window.__map && window.__map.triggerRepaint) window.__map.triggerRepaint();
  }

  // ── the layer's own copy of the city's shader: the albedo may be above white ───────────────────────────────────
  // The city's shader reads the day colour from a byte attribute (0..1). `aBoost` multiplies it back up where a lit-colour correction
  // needs more than white. A material not given an aBoost attribute reads 1, so nothing else changes. Strings are edited before the
  // material's first use; if the city's shader is ever reworded so that the edit finds nothing, the layer says so and draws without it.
  function boostMaterial(mat) {
    const v0 = mat.vertexShader, v1 = v0.replace('v_albedo = cDay;', 'v_albedo = cDay * aBoost;').replace('attribute vec2 aGrad;', 'attribute vec2 aGrad;\n    attribute vec3 aBoost;');
    if (v1 === v0 || !/attribute vec3 aBoost/.test(v1)) { info.errors.push('the city\'s vertex shader no longer has the line the boost edits'); return mat; }
    mat.vertexShader = v1;
    mat.defaultAttributeValues = Object.assign({}, mat.defaultAttributeValues, { aBoost: [1, 1, 1] });
    mat.needsUpdate = true;
    return mat;
  }
  function boostFacade(mat, boost) {
    const f0 = mat.fragmentShader, f1 = f0.replace('albedo=day.rgb; night=dark.rgb;', 'albedo=day.rgb*u_gltfBoost; night=dark.rgb;').replace('varying vec4 v_color;', 'uniform vec3 u_gltfBoost;\n    varying vec4 v_color;');
    if (f1 === f0 || !/uniform vec3 u_gltfBoost/.test(f1)) { info.errors.push('the city\'s wall-map shader no longer has the line the boost edits'); return mat; }
    mat.fragmentShader = f1;
    mat.uniforms = Object.assign({}, mat.uniforms, { u_gltfBoost: { value: new window.THREE.Vector3(boost[0], boost[1], boost[2]) } });
    mat.needsUpdate = true;
    return mat;
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
    // the city's night rules: this building's profile and lamps (the recipe that is not drawn would have registered them)
    const CN = window.CityNight, rules = !!(CN && CN.tune.on && row.replaces);
    if (rules) {
      CN.register({ id: row.replaces, name: row.name, category: 'apartment', night: row.night });
      if (row.night && row.night.fixtures) CN.registerFixtures({ id: row.replaces, night: row.night }, { at: world });
    }
    const boosts = [];                                           // per vertex: the albedo multiplier above white (see tripleFor)
    const toneTriples = new Map();                               // one triple per (material, night tone): the builder caches by triple
    const withTone = (m, col, tone, side, crown) => { const k = m.material + '|' + tone + '|' + side + '|' + (crown ? 'c' : ''); let c = toneTriples.get(k); if (!c) { c = [col[0], col[1], tone]; if (col.surface) c.surface = col.surface; c.boost = col.boost; toneTriples.set(k, c); } return c; };
    for (const m of meshes) {
      const P = m.pos, I = m.idx, sides = sunSides(P, I, row.headingDeg), colS = tripleFor(m, 'shade'), colL = tripleFor(m, 'sun'), col = colS, pt = i => world(P[i * 3], -P[i * 3 + 2], P[i * 3 + 1]);
      const cfg = GLTF.materials[m.material] || {};
      let addr = null, lit = null, hash = null;
      if (cfg.lit) addr = paneAddress(P, I);
      const crownS = cfg.lit ? tripleFor(m, 'shade', 'crown') : null, crownL = cfg.lit ? tripleFor(m, 'sun', 'crown') : null;
      if (cfg.lit && rules) { /* rooms below */ }
      else if (cfg.lit && GLTF.nightLit > 0) { lit = col.slice(); lit[2] = GLTF.litTone; lit.surface = col.surface; hash = paneHash(P, I); }
      verts += P.length / 3;
      for (let k = 0; k + 2 < I.length; k += 3) {
        const t = k / 3, crown = addr && addr.wide[t], base = crown ? (sides[t] ? crownL : crownS) : (sides[t] ? colL : colS);
        let c = base;
        if (addr && rules) {
          const room = addr.wide[t] ? { lit: false } : CN.room(row.replaces + '|' + addr.wall[t], addr.floor[t], addr.col[t], 0);
          c = withTone(m, base, room.lit ? room.nightTone : CN.tune.unlitGlass, sides[t], crown);
          if (room.lit) litPanes++;
        } else if (lit && hash[t] < GLTF.nightLit) { c = lit; litPanes++; }
        const A = pt(I[k]), Bv = pt(I[k + 1]), Cv = pt(I[k + 2]);
        // the builder drops a degenerate triangle: keep the boost list in step with the vertices it actually pushes
        const ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2], vx = Cv[0] - A[0], vy = Cv[1] - A[1], vz = Cv[2] - A[2];
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) >= 1e-9) { const bs = c.boost || [1, 1, 1]; boosts.push(...bs, ...bs, ...bs); }
        B.tri(A, Bv, Cv, c); tris++;
      }
    }
    info.buildMs += +(performance.now() - t0).toFixed(1);
    const g = new T.Group();
    g.name = 'gltf-' + row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    g.userData.lod = GLTF.lod;
    g.userData.minzoom = GLTF.minzoom;
    const geom = B.geometry();
    if (boosts.length === geom.attributes.position.count * 3) geom.setAttribute('aBoost', new T.BufferAttribute(Float32Array.from(boosts), 3));
    else info.errors.push('boost list out of step with the vertices: ' + boosts.length + ' vs ' + geom.attributes.position.count * 3);
    const mat = boostMaterial(S.material({ side: GLTF.twoSided ? T.DoubleSide : T.FrontSide }));
    const mesh = new T.Mesh(geom, mat);
    mesh.name = g.name + '-mesh';
    g.add(mesh);
    return { group: g, world, triangles: B.triangles, sourceTriangles: tris, vertices: verts, litTriangles: litPanes };
  }

  GLTF.internals = { paneAddress, paneHash, sunSides, tripleFor, buildBuilding };   // for scripts/verify/gltf-layer.mjs

  async function fetchGlb(url) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), GLTF.fetchTimeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return await r.arrayBuffer();
    } finally { clearTimeout(timer); }
  }

  let _loading = null, _parsed = null;
  async function load() {
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
      info.triangles = info.vertices = info.drawCalls = info.litTriangles = info.buildMs = 0; info.loaded = [];
      for (const p of _parsed) {
        if (!p) continue;
        try {
          const b = buildBuilding(S, p.row, p.meshes);
          g.add(b.group); b.group.userData.faces = { meshes: p.meshes, world: b.world, row: p.row }; info.triangles += b.triangles; info.vertices += b.vertices; info.litTriangles += b.litTriangles; info.drawCalls += 1; info.loaded.push(p.row.name);
        } catch (e) { info.errors.push(p.row.name + ': ' + e.message); console.error('[gltf-layer]', p.row.name, e); }
      }
      // The group of groups carries no tier of its own: each building's group has its own userData.lod / minzoom.
      GLTF.group = g; S.add(g);
      if (S.camera && S.camera.layers) S.camera.layers.enable(1);   // the wall-map overlays live on layer 1 (see faceMesh)
      for (const b of g.children) { const fa = b.userData.faces; if (fa) addFaces(S, b, fa.row, fa.meshes, fa.world).catch(e => { info.errors.push(String(e && e.message || e)); console.error('[gltf-layer]', e); }); }
      console.log('[gltf-layer]', info.loaded.join(', ') || 'nothing', '—', info.triangles, 'triangles,', info.drawCalls, 'draw call(s),', info.bytes, 'bytes,', info.ms, 'ms to fetch');
    } else if (!want && GLTF.group) { S.remove(GLTF.group); GLTF.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.userData && o.userData.disposeFacade) o.userData.disposeFacade(); }); GLTF.group = null; }
    GLTF.ready = !!GLTF.group;
  }

  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!map || !S || !S.root || !window.THREE || !S.material || !S.build) return false;
    if (!_loading) {
      _loading = load().then(() => {
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
