/**
 * outer-homes.js — the houses of the outer city, with their roofs.
 *
 * THE PROBLEM. The outer ring (js/outer.js) draws 6,866 flat prisms outside
 * downtown. Measured against the City's 2023 building outlines, that is 15 %
 * of the buildings that stand there (42 % of the built area): the bake drops
 * every footprint under an area limit that grows with distance, and a house is
 * under it almost everywhere. So Hyde Park, Tarrytown, Bouldin and East Austin
 * were bare ground with a few boxes, and no roof in the ring had a slope.
 *
 * WHAT THIS DRAWS. Every building the ring left out, as one to three oriented
 * rectangles with a roof: flat, gable or hip, wall height and ridge height
 * measured from the public 2021 laser scan, roof colour sampled from the
 * City's 2025 aerial, wall colour drawn from a per-area mix (inferred, not
 * measured: an aerial does not show a wall). scripts/bake_outer_homes.py
 * writes the one file this reads, data/outer_homes.bin; docs/outer-homes.md
 * has the method, the sources and the accuracy table.
 *
 * WHY IT IS CHEAP. A house is 11 bytes in the file (position, size, angle, two
 * heights, roof kind, two palette entries), not a mesh. The browser expands
 * them into ONE shared 30-vertex template drawn with GPU instancing inside the
 * js/slopes.js scene, a few dozen draw calls for the whole city. The material
 * is slopes.material() itself, so a house takes the same sun, hour, haze and
 * shadows as every other mesh; the only addition is a short vertex prelude
 * that places the template from the instance's numbers (see patchMaterial).
 *
 * Public (window) API:
 *   OUTER_HOMES              the taste block (below)
 *   outerHomes.stats()       counts, bytes, chunks drawn in the last update
 *   outerHomes.rebuild()     drop and rebuild from the decoded file
 *   applyOuterHomes(map)     re-read the knobs (density, switch, pitch)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11.
  // ══════════════════════════════════════════════════════════════════════
  const OUTER_HOMES = {
    // ?homes=0 leaves the layer out at load (the A/B switch for the checks).
    on: q.get('homes') !== '0',
    url: 'data/outer_homes.bin',
    // Below this zoom the houses are under a pixel; matches OUTER.minZoom.
    minZoom: 12.6,
    // Roof edge past the wall, metres. Footprints are roof outlines seen from
    // the air, so the wall is drawn inside by this much instead.
    overhang: 0.3,
    // Above this pitch only houses near the camera are drawn (walking height):
    // the far ones mass edge-on into one band, as the flat ring did.
    walkPitch: 80,
    walkRadius: 650,          // metres
    // Share of houses drawn, smallest dropped first. null = follow
    // GFX.outerDensity (the "City beyond campus" slider and the presets).
    density: null,
    // Colour by the hour, the same rule scripts/bake_outer.py:tri() bakes for
    // the ring's prisms, so a house and the prism beside it move together.
    goldenTint: '#ffb26a', goldenMix: 0.16,
    roofGoldenMix: 0.22,
    nightDark: 0.24, nightCool: [17, 22, 42], nightMix: 0.5,
    roofNightDark: 0.30, roofNightCool: [16, 21, 42], roofNightMix: 0.6,
    // Draw-call grid: cells of this many metres are culled as one.
    chunk: 700,
    // The file is fetched when the loading veil has lifted, or this long after
    // the page started, whichever comes first.
    fetchAfterMs: 15000,
  };
  window.OUTER_HOMES = OUTER_HOMES;

  const KIND_FLAT = 0, KIND_GABLE = 1, KIND_HIP = 2, KIND_GABLE_ACROSS = 3;
  const count = { done: false, houses: 0, rects: 0, chunks: 0, drawn: 0, bytes: 0, ms: 0, error: null };
  let _map = null, _data = null, _group = null, _material = null, _lastDensity = null;

  // ── the file ────────────────────────────────────────────────────────────
  //
  // data/outer_homes.bin, little-endian, gzip (decoded here, so it does not
  // matter whether the host compresses .bin):
  //   0   4  'OHM1'
  //   4   4  u32 n            rectangles
  //   8   8  f64 lon0         south-west corner of the frame
  //  16   8  f64 lat0
  //  24   4  f32 stepXY       metres per unit of x and y (east, north)
  //  28   4  f32 stepSize     metres per unit of half-length / half-width
  //  32   4  f32 stepH        metres per unit of eave and rise
  //  36   2  u16 nWall        wall palette entries
  //  38   2  u16 nRoof        roof palette entries
  //  40      wall palette (3 bytes each), roof palette (3 bytes each)
  //  then twelve byte columns of n rows:
  //    x low, x high, y low, y high   (u16 east and north, in stepXY)
  //    halfLength, halfWidth          (in stepSize)
  //    angle    of the long axis from east toward north, 180 degrees / 256
  //    eave, rise                     (in stepH)
  //    kind     bits 0-1 roof (0 flat, 1 gable along the long axis, 2 hip,
  //             3 gable across it), bit 2 = first rectangle of a building
  //    wall, roof                     palette entries
  //  x, y and angle are stored as differences from the row before (mod size);
  //  eave, wall and roof as differences too, except on a building's first row.
  //  A wing repeats its building's values, so those columns are mostly zeros.
  async function fetchBin(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': ' + r.status);
    let buf = await r.arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof DecompressionStream !== 'function') throw new Error('no DecompressionStream in this browser');
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      buf = await new Response(stream).arrayBuffer();
    }
    return buf;
  }

  function decode(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'OHM1') throw new Error('outer_homes.bin: bad magic ' + magic);
    const n = dv.getUint32(4, true);
    const d = {
      n, lon0: dv.getFloat64(8, true), lat0: dv.getFloat64(16, true),
      stepXY: dv.getFloat32(24, true), stepSize: dv.getFloat32(28, true), stepH: dv.getFloat32(32, true),
    };
    const nWall = dv.getUint16(36, true), nRoof = dv.getUint16(38, true);
    let o = 40;
    d.wallPal = new Uint8Array(buf, o, nWall * 3); o += nWall * 3;
    d.roofPal = new Uint8Array(buf, o, nRoof * 3); o += nRoof * 3;
    const col = () => { const c = new Uint8Array(buf.slice(o, o + n)); o += n; return c; };
    const xl = col(), xh = col(), yl = col(), yh = col();
    d.hl = col(); d.hw = col(); d.ang = col(); d.eave = col(); d.rise = col(); d.kind = col(); d.wall = col(); d.roof = col();
    if (o !== buf.byteLength) throw new Error('outer_homes.bin: ' + (buf.byteLength - o) + ' bytes left over');
    d.x = new Uint16Array(n); d.y = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const px = i ? d.x[i - 1] : 0, py = i ? d.y[i - 1] : 0;
      d.x[i] = (px + (xl[i] | (xh[i] << 8))) & 0xffff;
      d.y[i] = (py + (yl[i] | (yh[i] << 8))) & 0xffff;
      if (i) {
        d.ang[i] = (d.ang[i] + d.ang[i - 1]) & 0xff;
        if (!(d.kind[i] & 4)) {
          d.eave[i] = (d.eave[i] + d.eave[i - 1]) & 0xff;
          d.wall[i] = (d.wall[i] + d.wall[i - 1]) & 0xff;
          d.roof[i] = (d.roof[i] + d.roof[i - 1]) & 0xff;
        }
      }
    }
    return d;
  }

  const hex3 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // ── the template: one house, in (along, across, level) units ────────────
  //
  // position.x  -1 / +1   along the ridge (the instance's u axis)
  // position.y  -1 / 0 / +1  across it (0 is the ridge line)
  // position.z  0 ground, 1 eave, 2 ridge
  // hFace       0 +u wall, 1 -u wall, 2 +v wall, 3 -v wall,
  //             4 +v roof slope, 5 -v roof slope, 6 +u end, 7 -u end
  // The end faces are the gable's wall triangle on a gable and the hip's roof
  // triangle on a hip; the vertex prelude decides from the instance's kind.
  function place(p, face, L, W, eave, rise, hip, oh) {
    // The same arithmetic as the GLSL prelude below, used once here to get the
    // triangle winding right by measurement instead of by reasoning.
    const su = p[0], sv = p[1], lvl = p[2];
    const inset = hip ? Math.min(W, L) : 0;
    const drop = oh * rise / Math.max(W, 0.1);
    if (face < 3.5) return [su * L, sv * W, lvl < 0.5 ? 0 : eave];
    if (face < 5.5) {
      if (lvl > 1.5) return [su * (hip ? L - inset : L + oh), 0, eave + rise];
      return [su * (L + oh), sv * (W + oh), eave - drop];
    }
    const o = hip ? oh : 0;
    if (lvl > 1.5) return [su * (L - inset), 0, eave + rise];
    return [su * (L + o), sv * (W + o), eave - (hip ? drop : 0)];
  }
  function faceNormal(face, W, rise, hip, L) {
    if (face === 0) return [1, 0, 0];
    if (face === 1) return [-1, 0, 0];
    if (face === 2) return [0, 1, 0];
    if (face === 3) return [0, -1, 0];
    if (face === 4) return [0, rise, W];
    if (face === 5) return [0, -rise, W];
    const inset = hip ? Math.min(W, L) : 0;
    return [(face === 6 ? 1 : -1) * (hip ? rise : 1), 0, hip ? inset : 0];
  }
  function template(T) {
    const quads = [
      [0, [1, -1, 0], [1, 1, 0], [1, 1, 1], [1, -1, 1]],
      [1, [-1, 1, 0], [-1, -1, 0], [-1, -1, 1], [-1, 1, 1]],
      [2, [1, 1, 0], [-1, 1, 0], [-1, 1, 1], [1, 1, 1]],
      [3, [-1, -1, 0], [1, -1, 0], [1, -1, 1], [-1, -1, 1]],
      [4, [1, 1, 1], [-1, 1, 1], [-1, 0, 2], [1, 0, 2]],
      [5, [-1, -1, 1], [1, -1, 1], [1, 0, 2], [-1, 0, 2]],
    ];
    const tris = [];
    for (const [f, a, b, c, d] of quads) { tris.push([f, a, b, c]); tris.push([f, a, c, d]); }
    tris.push([6, [1, -1, 1], [1, 1, 1], [1, 0, 2]]);
    tris.push([7, [-1, 1, 1], [-1, -1, 1], [-1, 0, 2]]);
    const pos = [], face = [];
    for (const [f, a, b, c] of tris) {
      // measure the winding on a sample hip house; flip if it faces inward
      const P = [a, b, c].map(v => place(v, f, 6, 4, 3, 2, true, 0.3));
      const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
      const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const w = faceNormal(f, 4, 2, true, 6);
      const order = (n[0] * w[0] + n[1] * w[1] + n[2] * w[2]) >= 0 ? [a, b, c] : [a, c, b];
      for (const v of order) { pos.push(v[0], v[1], v[2]); face.push(f); }
    }
    return { position: new Float32Array(pos), face: new Float32Array(face), vertices: face.length };
  }

  // ── the material: slopes.material(), plus a prelude that places a house ─
  //
  // js/slopes.js's vertex shader reads `position`, `normal`, the colour triple,
  // the wall gradient and the surface vector straight off the vertex. An
  // instanced house has none of those per vertex; it has a template corner and
  // the instance's numbers. So the prelude computes the values into globals and
  // eight #defines point the shader's own names at them. Nothing in
  // js/slopes.js changes, and if its `void main() {` ever disappears this
  // refuses to draw and says so.
  //
  // NO NEW ATTRIBUTE NAMES, and that is not tidiness. The first version added
  // eleven (hA, hB, hWd ...) beside the nine the shader already declares, and
  // the Mac's Intel driver refused to link it: "Too many attributes (hRd)". A
  // driver may count every DECLARED attribute against its limit of 16, used or
  // not. So the instance's numbers ride in the nine names that already exist:
  //
  //   position  (template)  along, across, level
  //   aFacet    (template)  face number 0..7
  //   aSurface  (instance)  x, y in local metres, cos, sin of the ridge axis
  //   normal    (instance)  half length along the ridge, half width, eave height
  //   aGrad     (instance)  rise, roof kind (0 flat, 1 gable, 2 hip)
  //   cDay      (instance)  wall colour by day
  //   cGold     (instance)  roof colour by day
  //
  // The golden and night colours are derived here from the day colour by the
  // rule scripts/bake_outer.py:tri() bakes into the ring's prisms, so a house
  // and the prism beside it move through the hours together.
  const v3 = a => 'vec3(' + a.map(x => (+x).toFixed(4)).join(', ') + ')';
  const f1 = x => (+x).toFixed(4);
  function prelude() {
    const H = OUTER_HOMES, tint = hex3(H.goldenTint).map(x => x / 255);
    return `
    vec3 hP; vec3 hN; vec3 hCd; vec3 hCg; vec3 hCn; vec2 hGrad; float hFacet; vec4 hSurf;
    void homesPrelude() {
      float su = position.x, sv = position.y, lvl = position.z, face = aFacet;
      float L = normal.x, W = normal.y, eave = normal.z, rise = aGrad.x, kind = aGrad.y;
      float hip = step(1.5, kind);
      float pitched = step(0.5, kind);
      float oh = ${f1(H.overhang)} * pitched;
      float inset = hip * min(W, L);
      float drop = oh * rise / max(W, 0.1);
      vec3 p; vec3 n; bool roofColour;
      if (face < 3.5) {
        p = vec3(su * L, sv * W, lvl < 0.5 ? 0.0 : eave);
        n = face < 0.5 ? vec3(1.0, 0.0, 0.0) : face < 1.5 ? vec3(-1.0, 0.0, 0.0)
          : face < 2.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0);
        roofColour = false;
        hGrad = vec2(min(lvl, 1.0), eave);
      } else if (face < 5.5) {
        p = lvl > 1.5 ? vec3(su * mix(L + oh, L - inset, hip), 0.0, eave + rise)
                      : vec3(su * (L + oh), sv * (W + oh), eave - drop);
        n = normalize(vec3(0.0, (face < 4.5 ? 1.0 : -1.0) * rise, W));
        roofColour = true;
        hGrad = vec2(0.0);
      } else {
        float o = oh * hip;
        p = lvl > 1.5 ? vec3(su * (L - inset), 0.0, eave + rise)
                      : vec3(su * (L + o), sv * (W + o), eave - drop * hip);
        float s = face < 6.5 ? 1.0 : -1.0;
        n = hip > 0.5 ? normalize(vec3(s * rise, 0.0, inset)) : vec3(s, 0.0, 0.0);
        roofColour = hip > 0.5;
        hGrad = hip > 0.5 ? vec2(0.0) : vec2(1.0, eave + rise);
      }
      float c = aSurface.z, s2 = aSurface.w;
      hP = vec3(aSurface.x + p.x * c - p.y * s2, aSurface.y + p.x * s2 + p.y * c, p.z);
      hN = vec3(n.x * c - n.y * s2, n.x * s2 + n.y * c, n.z);
      if (roofColour) {
        hCd = cGold;
        hCg = mix(hCd, ${v3(tint)}, ${f1(H.roofGoldenMix)});
        hCn = mix(hCd * ${f1(H.roofNightDark)}, ${v3(H.roofNightCool.map(x => x / 255))}, ${f1(H.roofNightMix)});
      } else {
        hCd = cDay;
        hCg = mix(hCd, ${v3(tint)}, ${f1(H.goldenMix)});
        hCn = mix(hCd * ${f1(H.nightDark)}, ${v3(H.nightCool.map(x => x / 255))}, ${f1(H.nightMix)});
      }
      hFacet = (roofColour && pitched > 0.5) ? 1.0 : 0.0;
      hSurf = vec4(0.0);
    }
    #define position hP
    #define normal hN
    #define cDay hCd
    #define cGold hCg
    #define cNight hCn
    #define aGrad hGrad
    #define aFacet hFacet
    #define aSurface hSurf
  `;
  }
  function patchMaterial(S) {
    const mat = S.material();
    const src = mat.vertexShader;
    const at = src.lastIndexOf('void main() {');
    const names = ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aGrad', 'aFacet', 'aSurface'];
    if (at < 0 || names.some(k => src.indexOf(k, at) < 0) || names.some(k => !new RegExp('attribute\\s+\\w+\\s+' + k + '\\s*;').test(src) && k !== 'position' && k !== 'normal')) {
      throw new Error('js/slopes.js vertex shader changed shape; the house prelude no longer fits');
    }
    mat.vertexShader = src.slice(0, at) + prelude()
      + '\nvoid main() {\n      homesPrelude();' + src.slice(at + 'void main() {'.length);
    // the shared material gives aGrad a constant default; here it is a real attribute
    delete mat.defaultAttributeValues.aGrad;
    mat.needsUpdate = true;
    return mat;
  }

  // ── build ───────────────────────────────────────────────────────────────
  function densityNow() {
    if (typeof OUTER_HOMES.density === 'number') return OUTER_HOMES.density;
    const g = window.GFX && window.GFX.outerDensity;
    return typeof g === 'number' ? g : 1;
  }

  function build() {
    const S = window.slopes, T = window.THREE, d = _data, H = OUTER_HOMES;
    const t0 = performance.now();
    const g = new T.Group();
    g.name = 'outer-homes';
    g.userData.lod = null;                 // the ring is not in a LOD tier either
    g.userData.minzoom = H.minZoom;
    if (!_material) _material = patchMaterial(S);
    const tpl = template(T);

    // local metres of every rectangle, through MapLibre's own projection
    const mLat = 111320, mLon = mLat * Math.cos(d.lat0 * Math.PI / 180);
    const n = d.n;
    const X = new Float32Array(n), Y = new Float32Array(n);
    // toLocal is exact but not free; the frame is 8 km, so a 9x9 grid of exact
    // points and a bilinear blend between them is within 2 cm of it.
    const G = 9, gx = [], gy = [];
    const spanX = 65535 * d.stepXY, spanY = 65535 * d.stepXY;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const p = S.toLocal(d.lon0 + (spanX * i / (G - 1)) / mLon, d.lat0 + (spanY * j / (G - 1)) / mLat, 0);
      gx.push(p.x); gy.push(p.y);
    }
    for (let k = 0; k < n; k++) {
      const fx = d.x[k] / 65535 * (G - 1), fy = d.y[k] / 65535 * (G - 1);
      const i = Math.min(G - 2, fx | 0), j = Math.min(G - 2, fy | 0), tx = fx - i, ty = fy - j;
      const a = j * G + i, b = a + 1, c = a + G, e = c + 1;
      X[k] = (gx[a] * (1 - tx) + gx[b] * tx) * (1 - ty) + (gx[c] * (1 - tx) + gx[e] * tx) * ty;
      Y[k] = (gy[a] * (1 - tx) + gy[b] * tx) * (1 - ty) + (gy[c] * (1 - tx) + gy[e] * tx) * ty;
    }

    // chunks: a grid over the frame; inside a chunk the big houses come first,
    // so a density below 1 is an instance count, not a filter
    const cell = H.chunk;
    let minX = Infinity, minY = Infinity;
    for (let k = 0; k < n; k++) { if (X[k] < minX) minX = X[k]; if (Y[k] < minY) minY = Y[k]; }
    const chunks = new Map();
    for (let k = 0; k < n; k++) {
      const key = Math.floor((X[k] - minX) / cell) * 4096 + Math.floor((Y[k] - minY) / cell);
      let c = chunks.get(key);
      if (!c) chunks.set(key, c = []);
      c.push(k);
    }
    const tplPos = new T.BufferAttribute(tpl.position, 3), tplFace = new T.BufferAttribute(tpl.face, 1);
    let rects = 0;
    for (const idx of chunks.values()) {
      // rank: the building's first rectangle carries the size; its wings follow it
      const rank = new Float32Array(idx.length);
      let lead = 0;
      for (let m = 0; m < idx.length; m++) {
        const k = idx[m];
        if (d.kind[k] & 4 || m === 0) lead = d.hl[k] * d.hw[k] * (4 + d.eave[k] * d.stepH);
        rank[m] = lead;
      }
      const order = Array.from(idx.keys()).sort((a, b) => rank[b] - rank[a] || a - b);
      const m = idx.length;
      const A = new Float32Array(m * 4), B = new Float32Array(m * 3), K = new Float32Array(m * 2);
      const wallC = new Uint8Array(m * 3), roofC = new Uint8Array(m * 3);
      let sx = 0, sy = 0, top = 0, r2 = 0;
      for (let j = 0; j < m; j++) {
        const k = idx[order[j]];
        let L = d.hl[k] * d.stepSize, W = d.hw[k] * d.stepSize;
        let ang = d.ang[k] * Math.PI / 256;
        let kind = d.kind[k] & 3;
        if (kind === KIND_GABLE_ACROSS) { const t = L; L = W; W = t; ang += Math.PI / 2; kind = KIND_GABLE; }
        const eave = d.eave[k] * d.stepH, rise = kind === KIND_FLAT ? 0 : d.rise[k] * d.stepH;
        A[j * 4] = X[k]; A[j * 4 + 1] = Y[k]; A[j * 4 + 2] = Math.cos(ang); A[j * 4 + 3] = Math.sin(ang);
        B[j * 3] = L; B[j * 3 + 1] = W; B[j * 3 + 2] = eave;
        K[j * 2] = rise; K[j * 2 + 1] = kind;
        const wi = Math.min(d.wall[k] * 3, d.wallPal.length - 3), ri = Math.min(d.roof[k] * 3, d.roofPal.length - 3);
        for (let ch = 0; ch < 3; ch++) { wallC[j * 3 + ch] = d.wallPal[wi + ch]; roofC[j * 3 + ch] = d.roofPal[ri + ch]; }
        sx += X[k]; sy += Y[k]; top = Math.max(top, eave + rise);
      }
      const cx = sx / m, cy = sy / m;
      for (let j = 0; j < m; j++) {
        const dx = A[j * 4] - cx, dy = A[j * 4 + 1] - cy, reach = Math.hypot(B[j * 3], B[j * 3 + 1]) + 1;
        r2 = Math.max(r2, Math.hypot(dx, dy) + reach);
      }
      const geom = new T.InstancedBufferGeometry();
      geom.setAttribute('position', tplPos);
      geom.setAttribute('aFacet', tplFace);
      geom.setAttribute('aSurface', new T.InstancedBufferAttribute(A, 4));
      geom.setAttribute('normal', new T.InstancedBufferAttribute(B, 3));
      geom.setAttribute('aGrad', new T.InstancedBufferAttribute(K, 2));
      geom.setAttribute('cDay', new T.InstancedBufferAttribute(wallC, 3, true));
      geom.setAttribute('cGold', new T.InstancedBufferAttribute(roofC, 3, true));
      geom.instanceCount = m;
      geom.boundingSphere = new T.Sphere(new T.Vector3(cx, cy, top / 2), Math.hypot(r2, top / 2));
      const mesh = new T.Mesh(geom, _material);
      mesh.name = 'homes-chunk';
      mesh.userData.total = m;
      mesh.userData.centre = [cx, cy];
      mesh.userData.radius = r2;
      // Layer 1: the main camera sees it, the sun-shadow cameras (layer 0 only)
      // do not. Their depth material reads `position` raw and would draw every
      // house as a one-metre box at the origin; 50,000 houses are also far more
      // than the two shadow maps were sized for.
      mesh.layers.set(1);
      g.add(mesh);
      rects += m;
    }
    if (S.camera && S.camera.layers) S.camera.layers.enable(1);
    count.rects = rects; count.chunks = chunks.size;
    count.houses = 0; for (let k = 0; k < n; k++) if (d.kind[k] & 4) count.houses++;
    count.ms = +(performance.now() - t0).toFixed(1);
    return g;
  }

  /** Density and the walking-height radius: per chunk, no rebuild. */
  function update() {
    if (!_group || !_map) return;
    const dens = Math.max(0, Math.min(1, densityNow()));
    const pitch = _map.getPitch ? _map.getPitch() : 0;
    const walking = pitch > OUTER_HOMES.walkPitch;
    let eye = null;
    if (walking) {
      const c = _map.getCenter();
      eye = window.slopes.toLocal(c.lng, c.lat, 0);
    }
    let drawn = 0;
    for (const mesh of _group.children) {
      const total = mesh.userData.total;
      let nIn = Math.max(1, Math.round(total * dens));
      if (eye) {
        const dx = mesh.userData.centre[0] - eye.x, dy = mesh.userData.centre[1] - eye.y;
        if (Math.hypot(dx, dy) - mesh.userData.radius > OUTER_HOMES.walkRadius) nIn = 0;
      }
      mesh.visible = nIn > 0;
      mesh.geometry.instanceCount = nIn;
      drawn += nIn;
    }
    count.drawn = drawn;
    _lastDensity = dens;
  }

  window.applyOuterHomes = function applyOuterHomes(map) {
    map = map || _map;
    const S = window.slopes;
    if (!map || !S || !_data) return;
    const want = !!(OUTER_HOMES.on && window.SLOPES && window.SLOPES.on && (!window.OUTER || window.OUTER.on));
    try {
      if (want && !_group) { _group = build(); S.add(_group); }
      else if (!want && _group) { S.remove(_group); disposeGroup(_group); _group = null; }
    } catch (e) {
      count.error = String(e && e.message || e);
      console.warn('[outer-homes]', count.error, '- houses not drawn');
      OUTER_HOMES.on = false;
      return;
    }
    update();
    map.triggerRepaint();
  };

  function disposeGroup(g) {
    for (const m of g.children) { try { m.geometry.dispose(); } catch (e) {} }
  }

  window.outerHomes = {
    stats() { return { ...count, density: _lastDensity, group: !!_group }; },
    rebuild() {
      if (_group) { window.slopes.remove(_group); disposeGroup(_group); _group = null; }
      window.applyOuterHomes();
    },
    get group() { return _group; },
    get data() { return _data; },
    decode, template,
  };

  // ── boot ────────────────────────────────────────────────────────────────
  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!OUTER_HOMES.on) { count.done = true; return true; }
    if (!map || !S || !S.root || !window.THREE) return false;
    // After the ring: the houses are the ring's small buildings, and the ring
    // is what tells a visitor the city has loaded. Never ahead of it.
    if (!map.getLayer('outer-3d') && !(window.OUTER && window.OUTER.on === false)) return false;
    // ... and never ahead of the city itself. The file is 0.4 MB that nothing on
    // campus needs, so it waits for the loading veil to lift (or fetchAfterMs,
    // whichever is first) instead of joining the queue of the first seconds.
    if (document.getElementById('veil') && performance.now() < OUTER_HOMES.fetchAfterMs) return false;
    _map = map;
    try {
      const buf = await fetchBin(OUTER_HOMES.url);
      count.bytes = buf.byteLength;
      _data = decode(buf);
    } catch (e) {
      count.error = String(e && e.message || e);
      console.warn('[outer-homes]', count.error, '- houses not drawn');
      count.done = true;
      return true;
    }
    S.onSwitch(() => window.applyOuterHomes(map));
    const orig = window.applySlopesSettings;
    if (typeof orig === 'function' && !orig.__homesHooked) {
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applyOuterHomes(m); } catch (e) {} return r; };
      wrapped.__homesHooked = true;
      window.applySlopesSettings = wrapped;
    }
    const origOuter = window.applyOuterSettings;
    if (typeof origOuter === 'function' && !origOuter.__homesHooked) {
      const wrapped = function (m) { const r = origOuter.apply(this, arguments); try { update(); } catch (e) {} return r; };
      wrapped.__homesHooked = true;
      window.applyOuterSettings = wrapped;
    }
    let lastWalk = null;
    const onMove = () => {
      const walking = map.getPitch() > OUTER_HOMES.walkPitch;
      if (walking || walking !== lastWalk || densityNow() !== _lastDensity) { lastWalk = walking; update(); }
    };
    map.on('move', onMove);
    window.applyOuterHomes(map);
    count.done = true;
    console.log('[outer-homes]', count.houses, 'buildings,', count.rects, 'rectangles in', count.chunks, 'chunks,', count.ms, 'ms');
    return true;
  }
  (function wait(tries) {
    boot().then(ok => { if (!ok && tries < 600) setTimeout(() => wait(tries + 1), 200); })
      .catch(e => { count.error = String(e && e.message || e); count.done = true; console.warn('[outer-homes]', e); });
  })(0);
})();
