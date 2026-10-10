/**
 * outer-trees.js — the outer city's tree cover.
 *
 * THE PROBLEM. The 2021 laser scan has 38 % of the outer city under vegetation
 * 3 m or taller. The app drew crowns over 2.4 % of it: the street and park
 * trees of the City's inventory and nothing in a back yard, because a tree in
 * data/trees.geojson is two to six stacked octagons in a tile and 200,000 more
 * of them would be 15 MB. Tarrytown is half canopy and was drawn bare.
 *
 * WHAT THIS DRAWS. One tree per 10 m cell the scan found under canopy, as tall
 * as the canopy there and wide enough to meet its neighbours: 196,000 trees
 * from a 138 KB grid, 0.7 bytes a tree (scripts/bake_outer_trees.py writes
 * data/outer_trees.bin; docs/outer-homes.md has the numbers). Nobody knows one
 * back-yard oak from the next. What a resident knows is where the canopy is.
 *
 * HOW. Like js/outer-homes.js: one template tree, GPU instancing, inside the
 * js/slopes.js scene, through slopes.material() with a vertex prelude and no
 * new attribute name. Three templates per 700 m chunk share one set of
 * instance buffers, and which one a chunk draws is its distance from the eye:
 *
 *   near     a trunk and a full crown, every tree
 *   far      a crown, every fourth tree, twice as wide
 *   horizon  the far crown, every sixteenth tree, four times as wide
 *
 * so the ground covered is the same at every distance and the triangles fall
 * by about ten times a step. The whole layer is in the LOD tier `trees-canopy`
 * is in, so the outer trees leave at the altitude the campus trees leave.
 *
 * TWO LOOKS, one switch (OUTER_TREES.style, ?outertreestyle=campus|plain):
 *
 *   campus  the campus trees' shape language as far as one instance a tree
 *           allows: js/campus-landscape.js's crown (a ball with lobes pushed
 *           out of it in the vertex shader from the tree's own seed, each ring
 *           of it one flat tone) and its table of four leaf colours. A campus
 *           tree is six such crowns on limbs; this is one, with deeper lobes.
 *   plain   a smooth crown of four hexagonal rings in js/timeofday.js's
 *           canopy colours.
 *
 * Public (window) API:
 *   OUTER_TREES              the taste block (below)
 *   outerTrees.stats()       counts, chunks near / far in the last update
 *   applyOuterTrees(map)     re-read the knobs
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11.
  // ══════════════════════════════════════════════════════════════════════
  const OUTER_TREES = {
    // ?outertrees=0 leaves the layer out at load.
    on: q.get('outertrees') !== '0',
    url: 'data/outer_trees.bin',
    minZoom: 14,              // where `trees-canopy` starts
    lod: 'mid',               // and the tier it leaves in (js/lod.js)
    // Which look. The owner's call; both are kept.
    style: q.get('outertreestyle') === 'plain' ? 'plain' : 'campus',
    // The campus look. `leaf`, `bark`, `lobes`, `wave` and `shade` are
    // js/campus-landscape.js's own numbers (copied, not read: that file may
    // not be loaded, a phone runs without it). `lobeDepth` is deeper than the
    // campus's 0.12 because one crown stands for six.
    campus: {
      segments: 10, rings: 4, farSegments: 6, farRings: 3,
      lobes: 5, lobeDepth: 0.20, wave: 0.05, shade: 0.86,
      leaf: [['#54704b', '#72704b', '#10201a'], ['#607c50', '#7b784b', '#13221a'], ['#465f43', '#666849', '#101d18'], ['#6b8057', '#827e54', '#17251c']],
      bark: ['#6d6250', '#806a50', '#171a19'],
      // crown shapes by seed: [share of trees, spread, share of the height the crown takes]
      forms: [[0.50, 1.03, 0.58], [0.20, 0.91, 0.70], [0.15, 0.92, 0.76], [0.15, 0.78, 0.86]],
      trunkRadius: 0.055, trunkMin: 0.22, trunkMax: 0.48, trunkTop: 0.7,
    },
    // Crown radius as a share of the 10 m cell: 0.5 would just touch the
    // neighbour's; a real canopy is closed, so the crowns overlap.
    radius: 0.62,
    radiusJitter: 0.18,       // each tree this much wider or narrower
    heightJitter: 0.12,
    // How far off the cell's centre a tree may stand, as a share of the cell.
    offset: 0.30,
    // The crown's profile: [height share, radius share], foot to top.
    crown: [[0.30, 0.45], [0.52, 1.00], [0.78, 0.82], [1.00, 0.28]],
    trunkTop: 0.34, trunkRadius: 0.07,
    // Far trees: this share of them, this much wider. Horizon trees likewise.
    farShare: 0.25, farScale: 2.0,
    horizonShare: 0.0625, horizonScale: 4.0,
    farCrown: [[0.30, 1.00], [0.85, 0.70]],
    nearMetres: 900,          // eye to chunk; beyond it the far template
    farMetres: 3000,          // and beyond this the horizon one
    hysteresis: 120,
    // PHONES (js/mobile.js LITE.budget.outerTrees, read below). false or 0 =
    // no outer trees and no fetch. A number = the share of each chunk's trees
    // a phone builds; at or under farShare it builds no near template at all.
    phoneShare: null,
    walkPitch: 80, walkRadius: 650,   // as js/outer-homes.js
    // Share of trees drawn. null = follow GFX.treeDensity.
    density: null,
    // Canopy colours by the hour: js/timeofday.js's own canopyLo / canopyHi
    // keyframes, so these trees and the campus trees are one green.
    day: ['#93ad70', '#5f7d4a'], golden: ['#a3a468', '#6a7343'], night: ['#1e3a24', '#162a1a'],
    trunk: ['#6b4f38', '#5f4632', '#221a15'],
    // Warm and cool poles each tree leans toward a little (TREE_SHADE.jitter's idea).
    warm: [232, 196, 96], cool: [96, 158, 132], hueJitter: 0.10,
    // The foot of a crown is in its own shade.
    shadeFoot: 0.80, shadeTop: 1.08,
    chunk: 700,
    fetchAfterMs: 90000,
  };
  window.OUTER_TREES = OUTER_TREES;
  (function phoneGate() {
    const L = window.LITE_PROFILE;
    if (!L || !L.on) return;
    const share = (L.budget || {}).outerTrees;
    OUTER_TREES.phoneShare = (share === undefined || share === true) ? 1 : (+share || 0);
    if (!OUTER_TREES.phoneShare) OUTER_TREES.on = false;
  })();

  const count = { done: false, trees: 0, built: 0, chunks: 0, near: 0, far: 0, horizon: 0, drawn: 0, triangles: 0, bytes: 0, gpuBytes: 0, ms: 0, error: null };
  let _map = null, _data = null, _group = null, _mat = null, _lastKey = null;

  // ── the file ────────────────────────────────────────────────────────────
  //
  // data/outer_trees.bin, little-endian, stored as it is (the host compresses it on
  // the wire; js/outer-homes.js has the measurement). A gzip file is still read:
  //   0   4  'OTR1'
  //   4   4  u32 rows      8  4  u32 columns     (row 0 is the north edge)
  //  12   4  f32 cell, metres            16  4  f32 metres per height level
  //  20  48  six f64: longitude = a + b*column + c*row, latitude = d + e*column + f*row
  //          (cell centres are at column + 0.5, row + 0.5)
  //  68      rows * columns / 2 bytes: two cells a byte, the first in the high
  //          four bits. 0 = no tree, else the canopy's height in levels.
  async function fetchBin(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': ' + r.status);
    let buf = await r.arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof DecompressionStream !== 'function') throw new Error('no DecompressionStream in this browser');
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    return buf;
  }
  function decode(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'OTR1') throw new Error('outer_trees.bin: bad magic ' + magic);
    const d = { rows: dv.getUint32(4, true), cols: dv.getUint32(8, true), cell: dv.getFloat32(12, true), hStep: dv.getFloat32(16, true), k: [] };
    for (let i = 0; i < 6; i++) d.k.push(dv.getFloat64(20 + i * 8, true));
    d.cells = new Uint8Array(buf, 68);
    if (d.cells.length * 2 !== d.rows * d.cols) throw new Error('outer_trees.bin: ' + d.cells.length + ' bytes for ' + d.rows + ' x ' + d.cols + ' cells');
    return d;
  }
  const level = (d, i) => (i & 1) ? (d.cells[i >> 1] & 15) : (d.cells[i >> 1] >> 4);

  // A stable number in 0..1 from a cell and a salt (no Math.random: a reload must plant the same city).
  function hash(i, salt) {
    let h = Math.imul(i ^ (salt * 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const hex3 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ── the templates ───────────────────────────────────────────────────────
  //
  // PLAIN
  //   position  cos, sin of the vertex's angle round the tree, height share
  //   uv        radius share (the far and horizon scale is already in it), 0
  //   normal    0, 0 crown / 1 trunk, 0
  //   aFacet    the z of the vertex's outward direction
  // CAMPUS
  //   position  the vertex on the unit ball (trunk: cos, sin, 0 foot / 1 top)
  //   uv        its two angles, which the lobes need
  //   normal    the far / horizon scale, 0 crown / 1 trunk, the ring row
  const pack = (pos, uv, nrm, nz, idx) => ({ position: new Float32Array(pos), uv: new Float32Array(uv), normal: new Float32Array(nrm),
    nz: new Float32Array(nz), index: new Uint16Array(idx), triangles: idx.length / 3 });
  function plainTemplate(profile, withTrunk, scale) {
    const H = OUTER_TREES, pos = [], uv = [], nrm = [], nz = [], idx = [];
    const SIDES = 6;
    const ring = (z, r, tilt) => {
      const start = pos.length / 3;
      for (let k = 0; k < SIDES; k++) {
        const a = 2 * Math.PI * k / SIDES;
        pos.push(Math.cos(a), Math.sin(a), z); uv.push(r * scale, 0); nrm.push(0, 0, 0); nz.push(tilt);
      }
      return start;
    };
    const rings = [];
    for (let i = 0; i < profile.length; i++) {
      // the tilt of the crown's skin at this ring: from the rings either side
      const a = profile[Math.max(0, i - 1)], b = profile[Math.min(profile.length - 1, i + 1)];
      const dz = b[0] - a[0], dr = b[1] - a[1];
      let tilt = -dr / Math.max(0.05, Math.abs(dz)) * 0.6;
      if (i === 0) tilt = -0.9;
      if (i === profile.length - 1) tilt = 1.4;
      rings.push(ring(profile[i][0], profile[i][1], tilt));
    }
    for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < SIDES; k++) {
      const a = rings[i] + k, b = rings[i] + (k + 1) % SIDES, c = rings[i + 1] + (k + 1) % SIDES, e = rings[i + 1] + k;
      idx.push(a, b, c, a, c, e);
    }
    const top = rings[rings.length - 1];
    for (let k = 1; k + 1 < SIDES; k++) idx.push(top, top + k, top + k + 1);
    if (withTrunk) {
      const foot = rings[0];
      for (let k = 1; k + 1 < SIDES; k++) idx.push(foot, foot + k + 1, foot + k);   // the crown's underside
      const s = pos.length / 3;
      for (const z of [0, H.trunkTop]) for (let k = 0; k < 4; k++) {
        const a = 2 * Math.PI * (k + 0.5) / 4;
        pos.push(Math.cos(a), Math.sin(a), z); uv.push(0, 0); nrm.push(0, 1, 0); nz.push(0);
      }
      for (let k = 0; k < 4; k++) {
        const a = s + k, b = s + (k + 1) % 4, c = s + 4 + (k + 1) % 4, e = s + 4 + k;
        idx.push(a, b, c, a, c, e);
      }
    }
    return pack(pos, uv, nrm, nz, idx);
  }
  function campusTemplate(n, m, withTrunk, scale) {
    // js/campus-landscape.js crownTemplate(): every ring row has its own two rings of vertices, because a row is
    // one flat tone and a vertex shared by two rows would have two colours.
    const pos = [], uv = [], nrm = [], nz = [], idx = [];
    const v = (r, e, i) => (r * 2 + e) * n + (i % n);
    for (let r = 0; r < m; r++) for (let e = 0; e < 2; e++) for (let i = 0; i < n; i++) {
      const theta = i / n * Math.PI * 2, phi = (r + e) / m * Math.PI, sp = Math.sin(phi);
      pos.push(Math.cos(theta) * sp, Math.sin(theta) * sp, Math.cos(phi)); uv.push(theta, phi); nrm.push(scale, 0, r); nz.push(0);
    }
    for (let r = 0; r < m; r++) for (let i = 0; i < n; i++) {
      // phi runs from the top down, so going round by theta the outward side is a, d, b
      const a = v(r, 0, i), b = v(r, 0, i + 1), c = v(r, 1, i + 1), d = v(r, 1, i);
      if (r > 0) idx.push(a, d, b);           // the top row's upper ring is one point
      if (r < m - 1) idx.push(b, d, c);       // and the bottom row's lower ring
    }
    if (withTrunk) {
      const s = pos.length / 3, SIDES = 5;
      for (const t of [0, 1]) for (let k = 0; k < SIDES; k++) {
        const a = 2 * Math.PI * k / SIDES;
        pos.push(Math.cos(a), Math.sin(a), t); uv.push(0, 0); nrm.push(1, 1, 0); nz.push(0);
      }
      for (let k = 0; k < SIDES; k++) {
        const a = s + k, b = s + (k + 1) % SIDES, c = s + SIDES + (k + 1) % SIDES, e = s + SIDES + k;
        idx.push(a, b, c, a, c, e);
      }
    }
    return pack(pos, uv, nrm, nz, idx);
  }
  function templates() {
    const H = OUTER_TREES, C = H.campus;
    if (H.style === 'plain') return { near: plainTemplate(H.crown, true, 1), far: plainTemplate(H.farCrown, false, H.farScale), horizon: plainTemplate(H.farCrown, false, H.horizonScale) };
    return { near: campusTemplate(C.segments, C.rings, true, 1), far: campusTemplate(C.farSegments, C.farRings, false, H.farScale),
             horizon: campusTemplate(C.farSegments, C.farRings, false, H.horizonScale) };
  }

  // ── the material: slopes.material() and a prelude (see js/outer-homes.js) ─
  //
  //   aSurface  (instance)  x, y in local metres, crown radius, height
  //   aGrad     (instance)  the tree's seed (an angle), the share of its height its crown takes
  //   cDay, cGold, cNight (instance)  the crown's colour at the three hours
  //
  // No new attribute name: js/outer-homes.js's header has the reason.
  const f1 = x => (+x).toFixed(4);
  const v3 = a => 'vec3(' + a.map(x => (+x / 255).toFixed(4)).join(', ') + ')';
  const DEFINES = `
    #define position hP
    #define normal hN
    #define cDay hCd
    #define cGold hCg
    #define cNight hCn
    #define aGrad hGrad
    #define aFacet hFacet
    #define aSurface hSurf
  `;
  function prelude() {
    const H = OUTER_TREES, C = H.campus;
    if (H.style === 'plain') {
      const t = H.trunk.map(hex3);
      return `
    vec3 hP; vec3 hN; vec3 hCd; vec3 hCg; vec3 hCn; vec2 hGrad; float hFacet; vec4 hSurf;
    void treesPrelude() {
      float R = aSurface.z, Ht = aSurface.w;
      bool trunk = normal.y > 0.5;
      float r = trunk ? max(0.12, ${f1(H.trunkRadius)} * R) : R * uv.x;
      hP = vec3(aSurface.x + position.x * r, aSurface.y + position.y * r, position.z * Ht);
      hN = normalize(vec3(position.x, position.y, trunk ? 0.0 : aFacet));
      float shade = trunk ? 1.0 : mix(${f1(H.shadeFoot)}, ${f1(H.shadeTop)}, smoothstep(0.3, 1.0, position.z));
      hCd = trunk ? ${v3(t[0])} : cDay * shade;
      hCg = trunk ? ${v3(t[1])} : cGold * shade;
      hCn = trunk ? ${v3(t[2])} : cNight * shade;
      hGrad = vec2(0.0); hFacet = 0.0; hSurf = vec4(0.0);
    }` + DEFINES;
    }
    const bark = C.bark.map(hex3), rows = C.rings;
    return `
    vec3 hP; vec3 hN; vec3 hCd; vec3 hCg; vec3 hCn; vec2 hGrad; float hFacet; vec4 hSurf;
    void treesPrelude() {
      float R = aSurface.z, Ht = aSurface.w, seed = aGrad.x;
      float scale = normal.x, row = normal.z;
      bool trunk = normal.y > 0.5;
      float crownHalf = Ht * aGrad.y * 0.5;            // the crown half height (the word half alone is reserved in GLSL)
      float mid = Ht - crownHalf;
      if (trunk) {
        float thick = clamp(R * ${f1(C.trunkRadius)}, ${f1(C.trunkMin)}, ${f1(C.trunkMax)}) * mix(1.0, ${f1(C.trunkTop)}, position.z);
        hP = vec3(aSurface.x + position.x * thick, aSurface.y + position.y * thick, position.z * mid);
        hN = normalize(vec3(position.xy, 0.12));
        hCd = ${v3(bark[0])}; hCg = ${v3(bark[1])}; hCn = ${v3(bark[2])};
      } else {
        // js/campus-landscape.js's crown: the lobes of a unit ball, from the tree's own seed
        float sp = length(position.xy);
        float rip = 1.0 + ${f1(C.lobeDepth)} * sin(${f1(C.lobes)} * uv.x + seed) * sp + ${f1(C.wave)} * sin(3.0 * uv.y + uv.x + seed);
        vec3 rad = vec3(R * scale, R * scale, crownHalf);
        vec3 l = vec3(position.x * rip, position.y * rip, position.z * (1.0 + ${f1(C.wave)} * sin(uv.x + seed) * sp));
        hP = vec3(aSurface.x, aSurface.y, mid) + rad * l;
        hN = normalize(position / rad);
        float tone = ${f1(C.shade)} + ${f1(1 - C.shade)} * (1.0 - row / ${f1(rows)});
        hCd = cDay * tone; hCg = cGold * tone; hCn = cNight * tone;
      }
      hGrad = vec2(0.0); hFacet = 0.0; hSurf = vec4(0.0);
    }` + DEFINES;
  }
  function patchMaterial(S) {
    const mat = S.material();
    const src = mat.vertexShader;
    const at = src.lastIndexOf('void main() {');
    const names = ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aGrad', 'aFacet', 'aSurface'];
    if (at < 0 || names.some(k => src.indexOf(k, at) < 0)) {
      throw new Error('js/slopes.js vertex shader changed shape; the tree prelude no longer fits');
    }
    mat.vertexShader = src.slice(0, at) + prelude() + '\nvoid main() {\n      treesPrelude();' + src.slice(at + 'void main() {'.length);
    delete mat.defaultAttributeValues.aGrad;         // a real attribute here
    mat.needsUpdate = true;
    return mat;
  }

  function densityNow() {
    if (typeof OUTER_TREES.density === 'number') return OUTER_TREES.density;
    const g = window.GFX && window.GFX.treeDensity;
    return typeof g === 'number' ? g : 1;
  }

  // ── build ───────────────────────────────────────────────────────────────
  function build() {
    const S = window.slopes, T = window.THREE, d = _data, H = OUTER_TREES;
    const t0 = performance.now();
    const g = new T.Group();
    g.name = 'outer-trees';
    g.userData.lod = H.lod;
    g.userData.minzoom = H.minZoom;
    if (!_mat) _mat = patchMaterial(S);
    const tpl = templates(), C = H.campus;

    // local metres of the grid: exact at a 9 x 9 lattice, bilinear between (within 2 cm over 8 km)
    const G = 9, gx = [], gy = [];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const c = d.cols * i / (G - 1), r = d.rows * j / (G - 1);
      const p = S.toLocal(d.k[0] + d.k[1] * c + d.k[2] * r, d.k[3] + d.k[4] * c + d.k[5] * r, 0);
      gx.push(p.x); gy.push(p.y);
    }
    const local = (c, r) => {
      const fx = c / d.cols * (G - 1), fy = r / d.rows * (G - 1);
      const i = Math.min(G - 2, fx | 0), j = Math.min(G - 2, fy | 0), tx = fx - i, ty = fy - j;
      const a = j * G + i, b = a + 1, e = a + G, f = e + 1;
      return [(gx[a] * (1 - tx) + gx[b] * tx) * (1 - ty) + (gx[e] * (1 - tx) + gx[f] * tx) * ty,
              (gy[a] * (1 - tx) + gy[b] * tx) * (1 - ty) + (gy[e] * (1 - tx) + gy[f] * tx) * ty];
    };

    // chunks of cells; inside a chunk the far trees come first, then the rest, each in a stable shuffle
    const per = Math.max(1, Math.round(H.chunk / d.cell));
    const chunks = new Map();
    let trees = 0;
    for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
      const i = r * d.cols + c;
      if (!level(d, i)) continue;
      const key = Math.floor(r / per) * 4096 + Math.floor(c / per);
      let list = chunks.get(key);
      if (!list) chunks.set(key, list = []);
      list.push(i);
      trees++;
    }
    const day = H.day.map(hex3), gold = H.golden.map(hex3), night = H.night.map(hex3);
    const leaf = C.leaf.map(t => t.map(hex3));
    const attr = (t) => ({ position: new T.BufferAttribute(t.position, 3), uv: new T.BufferAttribute(t.uv, 2), normal: new T.BufferAttribute(t.normal, 3),
      nz: new T.BufferAttribute(t.nz, 1), index: new T.BufferAttribute(t.index, 1), triangles: t.triangles });
    const A = { near: attr(tpl.near), far: attr(tpl.far), horizon: attr(tpl.horizon) };
    let gpu = 0, built = 0;
    for (const k of ['near', 'far', 'horizon']) gpu += tpl[k].position.byteLength + tpl[k].uv.byteLength + tpl[k].normal.byteLength + tpl[k].nz.byteLength + tpl[k].index.byteLength;
    // the order inside a chunk: the horizon trees, then the rest of the far trees, then all the others; each a
    // stable shuffle. So every template draws a PREFIX of one buffer, and so does a density below 1.
    const tier = i => { const h = hash(i, 1); return h < H.horizonShare ? 0 : h < H.farShare ? 1 : 2; };
    for (const list of chunks.values()) {
      list.sort((a, b) => tier(a) - tier(b) || hash(a, 2) - hash(b, 2));
      let nHor = 0, nFar = 0;
      for (const i of list) { const t = tier(i); if (t === 0) nHor++; if (t <= 1) nFar++; }
      // a phone builds a share of the chunk (OUTER_TREES.phoneShare); at or under the far share, no near tree at all
      const m = H.phoneShare == null ? list.length : Math.max(1, Math.min(list.length, Math.ceil(list.length * H.phoneShare)));
      const nearOK = H.phoneShare == null || H.phoneShare > H.farShare;
      nFar = Math.max(1, Math.min(nFar, m)); nHor = Math.max(1, Math.min(nHor, m));
      const inst = new Float32Array(m * 4), sd = new Float32Array(m * 2), cd = new Uint8Array(m * 3), cg = new Uint8Array(m * 3), cn = new Uint8Array(m * 3);
      let sx = 0, sy = 0, top = 0;
      for (let j = 0; j < m; j++) {
        const i = list[j], r = (i / d.cols) | 0, c = i - r * d.cols;
        const p = local(c + 0.5 + (hash(i, 3) - 0.5) * 2 * H.offset, r + 0.5 + (hash(i, 4) - 0.5) * 2 * H.offset);
        let R = d.cell * H.radius * (1 + (hash(i, 5) - 0.5) * 2 * H.radiusJitter);
        const Ht = level(d, i) * d.hStep * (1 + (hash(i, 6) - 0.5) * 2 * H.heightJitter);
        let cols, crownShare = 0.7;
        if (H.style === 'plain') {
          // tall trees are the darker, older green; then a small lean warm or cool
          const depth = Math.max(0, Math.min(1, (Ht - 6) / 9));
          const lean = hash(i, 7), pole = lean < 0.5 ? H.warm : H.cool, amt = Math.abs(lean - 0.5) * 2 * H.hueJitter;
          cols = [mix3(mix3(day[0], day[1], depth), pole, amt), mix3(mix3(gold[0], gold[1], depth), pole, amt * 0.7), mix3(night[0], night[1], depth)];
        } else {
          // one of the campus's four leaf colours, and one of its crown shapes, by the tree's own numbers
          cols = leaf[Math.min(leaf.length - 1, Math.floor(hash(i, 7) * leaf.length))];
          let acc = 0; const pick = hash(i, 9);
          for (let f = 0; f < C.forms.length; f++) {
            acc += C.forms[f][0];
            if (pick < acc || f === C.forms.length - 1) { R *= C.forms[f][1]; crownShare = C.forms[f][2]; break; }
          }
        }
        inst[j * 4] = p[0]; inst[j * 4 + 1] = p[1]; inst[j * 4 + 2] = R; inst[j * 4 + 3] = Ht;
        sd[j * 2] = hash(i, 8) * Math.PI * 2; sd[j * 2 + 1] = crownShare;
        for (let ch = 0; ch < 3; ch++) { cd[j * 3 + ch] = cols[0][ch]; cg[j * 3 + ch] = cols[1][ch]; cn[j * 3 + ch] = cols[2][ch]; }
        sx += p[0]; sy += p[1]; top = Math.max(top, Ht);
      }
      const cx = sx / m, cy = sy / m;
      let rad = 0;
      for (let j = 0; j < m; j++) rad = Math.max(rad, Math.hypot(inst[j * 4] - cx, inst[j * 4 + 1] - cy) + inst[j * 4 + 2] * H.horizonScale * 1.3);
      const iA = new T.InstancedBufferAttribute(inst, 4), iS = new T.InstancedBufferAttribute(sd, 2);
      const iD = new T.InstancedBufferAttribute(cd, 3, true), iG = new T.InstancedBufferAttribute(cg, 3, true), iN = new T.InstancedBufferAttribute(cn, 3, true);
      gpu += inst.byteLength + sd.byteLength + cd.byteLength * 3; built += m;
      const sphere = new T.Sphere(new T.Vector3(cx, cy, top / 2), Math.hypot(rad, top / 2));
      const mk = (which, n) => {
        const geom = new T.InstancedBufferGeometry();
        geom.setAttribute('position', A[which].position);
        geom.setAttribute('uv', A[which].uv);
        geom.setAttribute('normal', A[which].normal);
        geom.setAttribute('aFacet', A[which].nz);
        geom.setIndex(A[which].index);
        geom.setAttribute('aSurface', iA); geom.setAttribute('aGrad', iS);
        geom.setAttribute('cDay', iD); geom.setAttribute('cGold', iG); geom.setAttribute('cNight', iN);
        geom.instanceCount = n;
        geom.boundingSphere = sphere;
        const mesh = new T.Mesh(geom, _mat);
        mesh.name = 'trees-' + which;
        mesh.userData = { total: n, centre: [cx, cy], radius: rad, which, triangles: A[which].triangles };
        mesh.layers.set(1);            // not in the sun-shadow pass: js/outer-homes.js has the reason
        mesh.visible = false;
        g.add(mesh);
        return mesh;
      };
      const set = { near: nearOK ? mk('near', m) : null, far: mk('far', nFar), horizon: mk('horizon', nHor) };
      set.far.userData.set = set;       // the far mesh is the chunk's handle
    }
    count.gpuBytes = gpu; count.built = built;
    if (S.camera && S.camera.layers) S.camera.layers.enable(1);
    count.trees = trees; count.chunks = chunks.size; count.ms = +(performance.now() - t0).toFixed(1);
    count.nearTriangles = tpl.near.triangles; count.farTriangles = tpl.far.triangles;
    return g;
  }

  /** Which template each chunk draws, and how many trees of it. */
  function update(force) {
    if (!_group || !_map) return;
    const H = OUTER_TREES, S = window.slopes;
    const dens = Math.max(0, Math.min(1, densityNow()));
    const eyeU = _mat && _mat.uniforms && _mat.uniforms.u_eye && _mat.uniforms.u_eye.value;
    const c = _map.getCenter(), ctr = S.toLocal(c.lng, c.lat, 0);
    const eye = (eyeU && isFinite(eyeU.x) && (eyeU.x || eyeU.y || eyeU.z)) ? eyeU : { x: ctr.x, y: ctr.y, z: 300 };
    const walking = _map.getPitch() > H.walkPitch;
    const key = [Math.round(eye.x / 40), Math.round(eye.y / 40), Math.round(eye.z / 40), walking, dens].join(',');
    if (!force && key === _lastKey) return;
    _lastKey = key;
    const n = { near: 0, far: 0, horizon: 0 };
    let drawn = 0, tris = 0;
    for (const far of _group.children) {
      const set = far.userData.set;
      if (!set) continue;
      const u = far.userData;
      const flat = Math.hypot(u.centre[0] - eye.x, u.centre[1] - eye.y) - u.radius;
      const dist = Math.hypot(Math.max(0, flat), eye.z);
      const was = set.near && set.near.visible ? 'near' : set.horizon.visible ? 'horizon' : 'far';
      let pick = dist < H.nearMetres + (was === 'near' ? H.hysteresis : 0) ? 'near'
               : dist < H.farMetres + (was !== 'horizon' ? H.hysteresis : 0) ? 'far' : 'horizon';
      if (pick === 'near' && !set.near) pick = 'far';
      if (walking && Math.hypot(u.centre[0] - ctr.x, u.centre[1] - ctr.y) - u.radius > H.walkRadius) pick = null;
      for (const k of ['near', 'far', 'horizon']) {
        const mesh = set[k];
        if (!mesh) continue;
        mesh.visible = k === pick;
        if (mesh.visible) {
          mesh.geometry.instanceCount = Math.max(1, Math.round(mesh.userData.total * dens));
          n[k]++; drawn += mesh.geometry.instanceCount; tris += mesh.geometry.instanceCount * mesh.userData.triangles;
        }
      }
    }
    count.near = n.near; count.far = n.far; count.horizon = n.horizon; count.drawn = drawn; count.triangles = tris; count.density = dens;
  }

  window.applyOuterTrees = function applyOuterTrees(map) {
    map = map || _map;
    const S = window.slopes;
    if (!map || !S || !_data) return;
    const want = !!(OUTER_TREES.on && window.SLOPES && window.SLOPES.on && (!window.OUTER || window.OUTER.on));
    try {
      if (want && !_group) { _group = build(); S.add(_group); }
      else if (!want && _group) { S.remove(_group); for (const m of _group.children) { try { m.geometry.dispose(); } catch (e) {} } _group = null; }
    } catch (e) {
      count.error = String(e && e.message || e);
      console.warn('[outer-trees]', count.error, '- trees not drawn');
      OUTER_TREES.on = false;
      return;
    }
    update(true);
    map.triggerRepaint();
  };

  window.outerTrees = {
    stats() { return { ...count, group: !!_group }; },
    get group() { return _group; },
    get data() { return _data; },
    decode, templates, level,
  };

  // ── boot ────────────────────────────────────────────────────────────────
  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!OUTER_TREES.on) { count.done = true; return true; }
    if (!map || !S || !S.root || !window.THREE) return false;
    if (!map.getLayer('outer-3d') && !(window.OUTER && window.OUTER.on === false)) return false;
    // After the city has appeared, as the houses do.
    if (document.getElementById('veil') && performance.now() < OUTER_TREES.fetchAfterMs) return false;
    _map = map;
    try {
      const buf = await fetchBin(OUTER_TREES.url);
      count.bytes = buf.byteLength;
      _data = decode(buf);
    } catch (e) {
      count.error = String(e && e.message || e);
      console.warn('[outer-trees]', count.error, '- trees not drawn');
      count.done = true;
      return true;
    }
    S.onSwitch(() => window.applyOuterTrees(map));
    const orig = window.applySlopesSettings;
    if (typeof orig === 'function' && !orig.__outerTreesHooked) {
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applyOuterTrees(m); } catch (e) {} return r; };
      wrapped.__outerTreesHooked = true;
      window.applySlopesSettings = wrapped;
    }
    map.on('move', () => update(false));
    window.applyOuterTrees(map);
    count.done = true;
    console.log('[outer-trees]', count.trees, 'trees in', count.chunks, 'chunks,', count.ms, 'ms');
    return true;
  }
  (function wait(tries) {
    boot().then(ok => { if (!ok && tries < 600) setTimeout(() => wait(tries + 1), 200); })
      .catch(e => { count.error = String(e && e.message || e); count.done = true; console.warn('[outer-trees]', e); });
  })(0);
})();
