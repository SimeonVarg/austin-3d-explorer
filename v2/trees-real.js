// SOLID CROWNS (2026-10-25, the default; ?treesolid=0 for the cards below): the owner's photographs show dense, near-black crowns, and
// the layered see-through cards were both too pale and most of the trees' cost. Each crown is now the tree's own leaf clusters (k-means of
// its cards) drawn as opaque round clumps: near 44 clumps + the full trunk, mid 18 clumps + a plain trunk, far the impostor quads with
// their atlas drawn at load from the mid clumps. Opaque: no alpha test, no layers, nothing to sparkle; the leaf mottling on the surface
// is faded out below ~2 pixels a cycle (rule 15). Look values: street-look.js TREE_REAL_LOOK (SOLID_*, CLUMP_*, AO_*, LEAF_NOISE*).
//
// The tree library (default; ?trees=balls for v2's old balls) (v2/data/trees-real/, made offline by tools/trees/gen with EZ-Tree, MIT) in place of v2's one ball or
// cone per tree. Same tree list (City inventories + the aerial's crowns, positions/size/group from trees.js), each tree drawn by
// distance:
//   near  (< ~55 m)   trunk + branches + leaf-clump cards, alpha-to-coverage (alpha test smoothed over the pixel's own slope)
//   mid   (~55-190 m) the same trunk with its twigs dropped, 36 % of the cards grown to hold the crown's mass
//   far   (beyond)    ONE camera-facing quad per tree, picked from a 8 azimuth x 4 elevation x 2 variant impostor atlas (so an
//                     overhead flight sees the crown from above, not an upright cutout), the 4 nearest views blended
// The bands overlap and cross-fade with a per-instance fade (dithered: coverage, not blending, so nothing sorts or flickers).
// Rule 15: card and atlas alpha mips keep their coverage (the crown does not thin out with distance), the alpha edge is smoothed by
// the pixel's own derivative (no hard threshold crawling), nothing is blurred.
// Species: the safe tree file keeps only a GROUP (oak, broadleaf, small, conifer, palm), not the inventory's species, so a group maps
// to forms by the tree's height and a hash of its position (see FORMS). Colour: data/trees-real/manifest.json, from the photographs.
import { TREE_REAL_LOOK as L } from './street-look.js';

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/trees-real/', import.meta.url).href;
// tuning from the address bar (the verify sheets use them): ?treegain=0.3 &trunkgain=0.3 &treenear=55,14 &treefar=190,45
if (params.get('treegain')) L.LEAF_GAIN = +params.get('treegain');
if (params.get('treelod')) L.ALPHA_LOD = params.get('treelod').split(',').map(Number);
if (params.get('treeshadow')) L.RECEIVE_SHADOW = params.get('treeshadow') !== '0';
if (params.get('treemid')) L.MID_CARD_DOWN = +params.get('treemid');
if (params.get('treeimp')) L.IMPOSTOR_MIN_LOD = +params.get('treeimp');
if (params.get('treespec')) L.SPECULAR = +params.get('treespec');
if (params.get('trunkgain')) L.TRUNK_GAIN = +params.get('trunkgain');
if (params.get('treenear')) L.NEAR_TO_MID_M = params.get('treenear').split(',').map(Number);
if (params.get('treefar')) L.MID_TO_FAR_M = params.get('treefar').split(',').map(Number);
if (params.get('treetrim')) L.TRIM_CARDS = params.get('treetrim') !== '0';   // A/B of the trimmed cards (speed only)
if (params.get('impsphere')) L.IMPOSTOR_SPHERE = +params.get('impsphere');            // 0: the far crowns' old flat normal (A/B)
if (params.get('impshadow')) L.IMPOSTOR_SHADOW = params.get('impshadow') !== '0';
if (params.get('treesolid')) L.SOLID = params.get('treesolid') !== '0';             // 0: the old see-through leaf cards (A/B)
for (const k of ['SOLID_GAIN', 'SOLID_MIX', 'SOLID_SAT', 'LEAF_NOISE', 'AO_INNER', 'CLUMP_GROW']) { const v = params.get('tree_' + k.toLowerCase()); if (v) L[k] = +v; }
if (params.get('impmin')) L.IMPOSTOR_MIN_PX = +params.get('impmin');
if (params.get('impel')) L.IMPOSTOR_EL_BLEND = params.get('impel') !== '0';
if (params.get('treeclumps')) L.CLUMPS = params.get('treeclumps').split(',').map(Number);
const HASH =(a) => { let h = Math.imul(a | 0, 0x9E3779B1); h ^= h >>> 15; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// group -> forms. Each entry: [form, share]; broadleaf trees taller than TALL_M lean to pecan.
const FORMS = {
  oak: (h, u) => 'live_oak',
  broadleaf: (h, u) => (h >= 14 ? (u < 0.6 ? 'pecan' : 'cedar_elm') : (u < 0.12 ? 'pecan' : 'cedar_elm')),
  small: () => 'crape_myrtle',
  conifer: (h, u) => (h >= 11 && u < 0.3 ? 'bald_cypress' : 'ashe_juniper'),
  palm: () => 'crape_myrtle',
};

// mip chain whose alpha keeps the level-0 coverage (share of texels over the cut): a card or atlas far away keeps its mass
function coverageTexture(THREE, img, cut, anisotropy) {
  const w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.translate(0, h); g.scale(1, -1); g.drawImage(img, 0, 0);   // rows bottom-up: the GLB's v = 0 is the image's bottom row
  let data = g.getImageData(0, 0, w, h).data;
  const cover = (d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] >= cut * 255) n++; return n / (d.length / 4); };
  const target = cover(data), mips = [{ data: new Uint8Array(data.buffer.slice(0)), width: w, height: h }];
  let cw = w, ch = h;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1), out = new Uint8ClampedArray(nw * nh * 4), prev = mips[mips.length - 1].data;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let r = 0, gg = 0, b = 0, a = 0, wsum = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(cw - 1, x * 2 + dx), sy = Math.min(ch - 1, y * 2 + dy), i = (sy * cw + sx) * 4, al = prev[i + 3] / 255;
        r += prev[i] * al; gg += prev[i + 1] * al; b += prev[i + 2] * al; a += al; wsum += al;
      }
      const o = (y * nw + x) * 4;
      if (wsum > 0) { out[o] = r / wsum; out[o + 1] = gg / wsum; out[o + 2] = b / wsum; } else { out[o] = prev[((y * 2) * cw + x * 2) * 4]; out[o + 1] = prev[((y * 2) * cw + x * 2) * 4 + 1]; out[o + 2] = prev[((y * 2) * cw + x * 2) * 4 + 2]; }
      out[o + 3] = Math.min(255, (a / 4) * 255);
    }
    // scale alpha so the share over the cut stays what level 0 had (binary search the gain)
    let lo = 1, hi = 6;
    for (let k = 0; k < 12; k++) {
      const gm = (lo + hi) / 2; let n = 0; for (let i = 3; i < out.length; i += 4) if (out[i] * gm >= cut * 255) n++;
      if (n / (out.length / 4) < target) lo = gm; else hi = gm;
    }
    for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, out[i] * hi);
    mips.push({ data: new Uint8Array(out.buffer), width: nw, height: nh }); cw = nw; ch = nh;
  }
  const t = new THREE.DataTexture(mips[0].data, w, h, THREE.RGBAFormat); t.mipmaps = mips; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = anisotropy; t.flipY = false; t.needsUpdate = true;
  t.userData.trim = trimOctagon(mips);
  return t;
}

// Speed (2026-10-25): a leaf card's texture is 80 % empty (alpha under the cut), and the empty part still rasterises and runs the
// shader before it is thrown away; the cards' fill was most of the trees' cost (65 to 120 ms of a street frame on the Mac). So each
// card is cut down to the octagon that holds every texel with ANY alpha at mip levels 0..TRIM_LEVELS (each texel taken whole, plus
// one texel for the bilinear filter): nothing the card can draw at those levels is cut, so the picture is the same. (Deeper levels
// are used only where a card is a few pixels wide.) Returns 8 [u, v] corners, counter-clockwise, in the GLB's uv frame.
function trimOctagon(mips) {
  const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([x, y]) => { const l = Math.hypot(x, y); return [x / l, y / l]; });
  const s = D.map(() => -Infinity);
  for (let k = 0; k <= Math.min(L.TRIM_LEVELS, mips.length - 1); k++) {
    const { data, width: W, height: H } = mips[k];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] <= 0) continue;
      for (const [cx, cy] of [[x - 1, y - 1], [x + 2, y - 1], [x - 1, y + 2], [x + 2, y + 2]]) {
        const u = cx / W, v = cy / H;
        for (let d = 0; d < 8; d++) { const p = D[d][0] * u + D[d][1] * v; if (p > s[d]) s[d] = p; }
      }
    }
  }
  // the octagon = the 8 half-planes' corners (consecutive supporting lines meet), clamped to the card
  const out = [];
  for (let d = 0; d < 8; d++) {
    const a = D[d], b = D[(d + 1) % 8], det = a[0] * b[1] - a[1] * b[0];
    const u = (s[d] * b[1] - s[(d + 1) % 8] * a[1]) / det, v = (a[0] * s[(d + 1) % 8] - b[0] * s[d]) / det;
    out.push([Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))]);
  }
  return out;
}
// one card (4 corners at uv (0,0) (1,0) (1,1) (0,1), any order) -> the octagon, every attribute interpolated over the card (bilinear)
function trimCards(THREE, geo, oct) {
  const pos = geo.attributes.position, uv = geo.attributes.uv, col = geo.attributes.color, n = pos.count, idx = geo.index.array;
  const quads = idx.length / 6;
  for (let q = 0; q < quads; q++) {   // the GLB's cards are 4 vertices each, indexed v, v+1, v+2, v, v+2, v+3 (tools/trees/gen.js)
    const v = idx[q * 6]; if (idx[q * 6 + 1] !== v + 1 || idx[q * 6 + 2] !== v + 2 || idx[q * 6 + 5] !== v + 3) return null;
  }
  const P = new Float32Array(quads * 8 * 3), U = new Float32Array(quads * 8 * 2), C = col ? new Float32Array(quads * 8 * col.itemSize) : null, I = new Uint32Array(quads * 18);
  for (let q = 0; q < quads; q++) {
    const v0 = idx[q * 6], corner = {};   // corner['00'] = vertex at uv (0,0), ...
    for (let k = 0; k < 4; k++) corner[Math.round(uv.getX(v0 + k)) + '' + Math.round(uv.getY(v0 + k))] = v0 + k;
    const c00 = corner['00'], c10 = corner['10'], c11 = corner['11'], c01 = corner['01'];
    if ([c00, c10, c11, c01].some((x) => x === undefined)) return null;
    const lerp = (attr, comp, u, w) => { const g = (i) => attr.getComponent(i, comp); return (g(c00) * (1 - u) + g(c10) * u) * (1 - w) + (g(c01) * (1 - u) + g(c11) * u) * w; };
    for (let k = 0; k < 8; k++) {
      const [u, w] = oct[k], o = q * 8 + k;
      for (let c = 0; c < 3; c++) P[o * 3 + c] = lerp(pos, c, u, w);
      U[o * 2] = u; U[o * 2 + 1] = w;
      if (C) for (let c = 0; c < col.itemSize; c++) C[o * col.itemSize + c] = lerp(col, c, u, w);
    }
    for (let k = 0; k < 6; k++) { I[q * 18 + k * 3] = q * 8; I[q * 18 + k * 3 + 1] = q * 8 + k + 1; I[q * 18 + k * 3 + 2] = q * 8 + k + 2; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) g.setAttribute('color', new THREE.BufferAttribute(C, col.itemSize));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  return g;
}

// ── solid crowns: the tree's leaf cards (4 vertices each, tools/trees/gen.js) grouped into K clusters (k-means, deterministic), each
// drawn as one opaque round clump. The crown keeps the tree's own shape and mass; nothing in it is see-through, nothing alpha-tested.
// Per vertex: a normal between the clump's own and the crown's outward one, and the crown's inner darkness as the vertex colour.
function clumpGeometry(THREE, cards, info, K, detail, grow) {
  const pos = cards.attributes.position, nc = Math.floor(pos.count / 4), P = new Float32Array(nc * 3), E = new Float32Array(nc);
  for (let q = 0; q < nc; q++) {
    let x = 0, y = 0, z = 0; for (let k = 0; k < 4; k++) { x += pos.getX(q * 4 + k); y += pos.getY(q * 4 + k); z += pos.getZ(q * 4 + k); }
    x /= 4; y /= 4; z /= 4; P[q * 3] = x; P[q * 3 + 1] = y; P[q * 3 + 2] = z;
    let e = 0; for (let k = 0; k < 4; k++) e = Math.max(e, Math.hypot(pos.getX(q * 4 + k) - x, pos.getY(q * 4 + k) - y, pos.getZ(q * 4 + k) - z)); E[q] = e;
  }
  K = Math.max(1, Math.min(K, nc));
  // farthest-point start (deterministic), then Lloyd iterations
  const M = new Float32Array(K * 3), A = new Int32Array(nc), d2 = new Float32Array(nc).fill(Infinity);
  let pick = 0; for (let q = 1; q < nc; q++) if (P[q * 3 + 1] > P[pick * 3 + 1]) pick = q;
  for (let k = 0; k < K; k++) {
    M[k * 3] = P[pick * 3]; M[k * 3 + 1] = P[pick * 3 + 1]; M[k * 3 + 2] = P[pick * 3 + 2];
    let best = -1, bd = -1;
    for (let q = 0; q < nc; q++) { const d = (P[q * 3] - M[k * 3]) ** 2 + (P[q * 3 + 1] - M[k * 3 + 1]) ** 2 + (P[q * 3 + 2] - M[k * 3 + 2]) ** 2; if (d < d2[q]) d2[q] = d; if (d2[q] > bd) { bd = d2[q]; best = q; } }
    pick = best;
  }
  for (let it = 0; it < 10; it++) {
    for (let q = 0; q < nc; q++) { let bk = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = (P[q * 3] - M[k * 3]) ** 2 + (P[q * 3 + 1] - M[k * 3 + 1]) ** 2 + (P[q * 3 + 2] - M[k * 3 + 2]) ** 2; if (d < bd) { bd = d; bk = k; } } A[q] = bk; }
    const S = new Float32Array(K * 4);
    for (let q = 0; q < nc; q++) { const k = A[q]; S[k * 4] += P[q * 3]; S[k * 4 + 1] += P[q * 3 + 1]; S[k * 4 + 2] += P[q * 3 + 2]; S[k * 4 + 3]++; }
    for (let k = 0; k < K; k++) if (S[k * 4 + 3]) { M[k * 3] = S[k * 4] / S[k * 4 + 3]; M[k * 3 + 1] = S[k * 4 + 1] / S[k * 4 + 3]; M[k * 3 + 2] = S[k * 4 + 2] / S[k * 4 + 3]; }
  }
  // each clump's radius: the rms spread of its cards' centres + their mean half size
  const SS = new Float32Array(K), EE = new Float32Array(K), NN = new Float32Array(K);
  for (let q = 0; q < nc; q++) { const k = A[q]; SS[k] += (P[q * 3] - M[k * 3]) ** 2 + (P[q * 3 + 1] - M[k * 3 + 1]) ** 2 + (P[q * 3 + 2] - M[k * 3 + 2]) ** 2; EE[k] += E[q]; NN[k]++; }
  // the clump: an icosahedron with its vertices welded (three's is one vertex per face corner: 5x the vertex work)
  const ico = new THREE.IcosahedronGeometry(1, detail), ipr = ico.attributes.position, wmap = new Map(), U = [], TI = [];
  for (let v = 0; v < ipr.count; v++) {
    const key = ipr.getX(v).toFixed(4) + ',' + ipr.getY(v).toFixed(4) + ',' + ipr.getZ(v).toFixed(4);
    let j = wmap.get(key); if (j === undefined) { j = U.length / 3; wmap.set(key, j); U.push(ipr.getX(v), ipr.getY(v), ipr.getZ(v)); } TI.push(j);
  }
  const nv = U.length / 3, ip = { getX: (v) => U[v * 3], getY: (v) => U[v * 3 + 1], getZ: (v) => U[v * 3 + 2] }, outI = [];
  const c = info.centre, rs = info.rs, outP = [], outN = [], outC = [];
  const [a0, a1] = L.AO_RANGE;
  for (let k = 0; k < K; k++) {
    if (!NN[k]) continue;
    const base = outP.length / 3; for (const t of TI) outI.push(base + t);
    const r = (Math.sqrt(SS[k] / NN[k]) + EE[k] / NN[k] * 0.8) * grow * L.CLUMP_GROW;
    for (let v = 0; v < nv; v++) {
      const sx = ip.getX(v), sy = ip.getY(v), sz = ip.getZ(v);
      const x = M[k * 3] + sx * r, y = M[k * 3 + 1] + sy * r * L.CLUMP_FLAT, z = M[k * 3 + 2] + sz * r;
      let ox = x - c[0], oy = y - c[1], oz = z - c[2]; const ol = Math.hypot(ox, oy, oz) || 1;
      ox /= ol; oy = oy / ol + L.CROWN_UP_BIAS; oz /= ol; const ol2 = Math.hypot(ox, oy, oz); ox /= ol2; oy /= ol2; oz /= ol2;
      const b = L.CLUMP_NORMAL_CROWN; let nx = sx * (1 - b) + ox * b, ny = sy * (1 - b) + oy * b, nz = sz * (1 - b) + oz * b; const nl = Math.hypot(nx, ny, nz) || 1;
      outP.push(x, y, z); outN.push(nx / nl, ny / nl, nz / nl);
      const t = Math.min(1, Math.max(0, (Math.hypot(x - c[0], (y - c[1]) * 0.8, z - c[2]) / rs - a0) / (a1 - a0))), ao = L.AO_INNER + (1 - L.AO_INNER) * t * t * (3 - 2 * t);
      outC.push(ao, ao, ao);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(outC, 3));
  g.setIndex(outI); g.computeBoundingSphere();
  // where the crown starts (unit height): the lowest clump's bottom; the mid band's trunk ends a little above it
  let lo = Infinity; for (let i = 1; i < outP.length; i += 3) lo = Math.min(lo, outP[i]); g.userData.crownBase = lo;
  return g;
}

// the mid band's trunk under an opaque crown: a plain tapered cylinder (the tree's branches are inside the crown there, unseen)
function trunkCylinder(THREE, trunkGeo, top) {
  const p = trunkGeo.attributes.position; let r0 = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.02) r0 = Math.max(r0, Math.hypot(p.getX(i), p.getZ(i)));
  r0 = Math.max(0.008, Math.min(0.05, r0 || 0.02));
  const g = new THREE.CylinderGeometry(r0 * 0.6, r0, top, 7, 1, true).translate(0, top / 2, 0); g.deleteAttribute('uv');
  return g;
}
const cards0 = (byName) => byName['v0_leaves_near'].geometry;
const imageOf = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + url)); i.src = url; });

export async function installRealTrees({ THREE, scene, group, redraw, rows, groups, phone = false, renderer }) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const manifest = await fetch(DATA + 'manifest.json').then((r) => r.json());
  const msaa = !!(renderer && renderer.capabilities && renderer.getContext().getContextAttributes().antialias);
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  let [D1, W1] = phone ? L.NEAR_TO_MID_M_PHONE : L.NEAR_TO_MID_M, [D2, W2] = phone ? L.MID_TO_FAR_M_PHONE : L.MID_TO_FAR_M;

  // ── the tree list: flat arrays; species and variant are fixed per tree (a tree never changes form) ──
  let N = 0; for (const r of rows) N += r.length;
  const X = new Float32Array(N), Z = new Float32Array(N), R = new Float32Array(N), H = new Float32Array(N), V = new Float32Array(N), YAW = new Float32Array(N);
  const SP = new Uint8Array(N), VAR = new Uint8Array(N), speciesNames = Object.keys(manifest.species), spIndex = Object.fromEntries(speciesNames.map((s, i) => [s, i]));
  let k = 0;
  rows.forEach((list, gi) => {
    for (const [x, z, r, h, v] of list) {
      X[k] = x; Z[k] = z; R[k] = r; H[k] = h; V[k] = v;
      const u = HASH(Math.round(x * 10) * 7919 + Math.round(z * 10)), name = (FORMS[groups[gi]] || FORMS.broadleaf)(h, u);
      SP[k] = spIndex[name]; VAR[k] = Math.floor(HASH(Math.round(x * 10) * 31 + Math.round(z * 10) * 17 + 5) * manifest.species[name].variants.length);
      YAW[k] = HASH(Math.round(x * 10) * 13 + Math.round(z * 10) * 29 + 11) * Math.PI * 2; k++;
    }
  });

  // the leaf tint: the photograph's colour between its middle and its lit leaves (LEAF_LIT_MIX), a touch more saturated (LEAF_SAT: the app's tone map greys dark greens), times LEAF_GAIN
  const leafTint = (sp) => { const l = manifest.species[sp].leaf, c = new THREE.Color(l.mid).lerp(new THREE.Color(l.sunlit), L.LEAF_LIT_MIX), hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s * L.LEAF_SAT), hsl.l); return c.multiplyScalar(L.LEAF_GAIN); };
  // ── shared materials pieces ──
  const gltf = new GLTFLoader();
  const leafTexes = {};
  if (!L.SOLID) for (const kind of new Set(Object.values(manifest.species).map((s) => s.leafCard))) leafTexes[kind] = coverageTexture(THREE, await imageOf(DATA + kind), L.ALPHA_CUT, aniso);
  // mid cards (beyond ~60 m the leaf shapes are under a pixel): the same cards from a texture with the leaves merged into soft clumps
  // (MID_CARD_DOWN x smaller, smooth), drawn as plain coverage. A content level of detail, not a blur of the picture.
  const leafTexesMid = {};
  for (const kind of Object.keys(leafTexes)) {
    const img = await imageOf(DATA + kind), c = document.createElement('canvas'); c.width = Math.round(img.width / L.MID_CARD_DOWN); c.height = Math.round(img.height / L.MID_CARD_DOWN);
    const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    leafTexesMid[kind] = coverageTexture(THREE, c, L.ALPHA_CUT, aniso);
  }
  // The alpha test, antialiased AND mip-aware (rule 15). Near: three's alpha to coverage (smoothstep over the pixel's own alpha slope).
  // Where one pixel spans many texels of the card (log2 texels per pixel between ALPHA_LOD[0] and [1]) the card's leaf shapes are
  // below the pixel, so the sharpened edge would flip with every sub-texel of motion: the raw (mipped, coverage-preserving) alpha is used
  // as plain coverage instead - the same stipple on every frame, the crown's true density. Then the cross-fade factor multiplies it.
  const alphaChunk = (duv, lod = L.ALPHA_LOD) => `
    #ifdef USE_ALPHATEST
      float aRaw = diffuseColor.a;
      ${duv ? `vec2 duvT = ${duv}; float rhoT = max(length(dFdx(duvT)), length(dFdy(duvT))); float tLod = smoothstep(${lod[0].toFixed(2)}, ${lod[1].toFixed(2)}, log2(max(rhoT, 1.0)));` : 'float tLod = 0.0;'}
      float aSharp = smoothstep(alphaTest, alphaTest + max(fwidth(aRaw), 1e-4), aRaw);
      #ifdef ALPHA_TO_COVERAGE
        diffuseColor.a = mix(aSharp, aRaw, tLod);
        if (diffuseColor.a <= 0.0) discard;
      #else
        { float cov = mix(step(alphaTest, aRaw), aRaw, tLod); vec2 q0 = floor(gl_FragCoord.xy); float h0 = fract(52.9829189 * fract(dot(q0, vec2(0.06711056, 0.00583715)))); if (cov <= h0) discard; }
      #endif
    #endif
    #ifndef ALPHA_TO_COVERAGE
      { vec2 q = floor(gl_FragCoord.xy); float hh = fract(52.9829189 * fract(dot(q, vec2(0.06711056, 0.00583715)))); if (hh >= vFadeV) discard; }
    #endif
    diffuseColor.a *= vFadeV;`;
  const fadeShader = (sh, isImpostor, duv, lod) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + (isImpostor ? 'attribute vec4 aImp;\n' : 'attribute float aFade;\n') + 'varying float vFadeV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFadeV = ' + (isImpostor ? 'aImp.x' : 'aFade') + ';');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFadeV;')
      .replace('#include <alphatest_fragment>', alphaChunk(duv, lod));
  };
  // MeshStandardMaterial (cheaper than Physical) with Physical's specularIntensity = L.SPECULAR, exactly: at IOR 1.5 Physical's F0 is
  // 0.04 x the intensity and its F90 the intensity, so the same two numbers are set after Standard's own (F0 0.04, F90 1)
  const specShader = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
    material.specularColor *= ${L.SPECULAR.toFixed(4)}; material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor); material.specularF90 = ${L.SPECULAR.toFixed(4)};`);
  };
  const leafMaterial = (sp, kind, mid = false) => {
    const col = leafTint(sp);
    const m = new THREE.MeshStandardMaterial({ map: (mid ? leafTexesMid : leafTexes)[kind], color: col, vertexColors: true, side: THREE.DoubleSide, alphaTest: L.ALPHA_CUT, alphaToCoverage: msaa, roughness: L.LEAF_ROUGHNESS, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      fadeShader(sh, false, mid ? 'vMapUv * 512.0' : 'vMapUv * 512.0', mid ? [-99, -98] : undefined); specShader(sh);
      // the cards' normals are the crown's own (outward + up): do not flip them on the back face
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    };
    m.customProgramCacheKey = () => 'v2-treecard' + msaa + mid; return m;
  };
  // (Tried 2026-10-25 and dropped: a depth-only pre-pass of the cards, so only the front card of a pixel is lit. The pre-pass alone
  // cost about what it saved, ~50 ms at the South Mall: the cards' cost is their layers of alpha-tested coverage, not their lighting.)
  const trunkMaterial = (sp) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(manifest.species[sp].trunk).multiplyScalar(L.TRUNK_GAIN), roughness: 1, metalness: 0, alphaToCoverage: msaa });
    m.onBeforeCompile = (sh) => { fadeShader(sh, false); specShader(sh); };
    m.customProgramCacheKey = () => 'v2-treetrunk' + msaa; return m;
  };

  // solid crown material: opaque. `dither`: the cross-fade's screen-door (only the instances inside a band's fade use it; a shader that
  // can discard loses the GPU's early depth test, so the fully-in trees draw with the plain one). `far`: the far band's fade worked out
  // in the vertex shader (that band is static, written once), the instance collapsed where it has no far share.
  const solidTint = (sp) => { const l = manifest.species[sp].leaf, c = new THREE.Color(l.shaded).lerp(new THREE.Color(l.mid), L.SOLID_MIX), hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s * L.SOLID_SAT), hsl.l); return c.multiplyScalar(L.SOLID_GAIN); };
  const solidMaterial = (sp, far, dither) => {
    const m = new THREE.MeshStandardMaterial({ color: solidTint(sp), vertexColors: true, roughness: L.LEAF_ROUGHNESS, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      if (far) sh.uniforms.uFar = farU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        ${far ? 'attribute float aMidY; uniform vec2 uFar;' : 'attribute float aFade;'} varying float vFadeV; varying vec3 vLeafP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeafP = position * ${L.LEAF_NOISE_SCALE.toFixed(3)};
        ${far ? `{ vec3 cw = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz; vFadeV = smoothstep(uFar.x - uFar.y, uFar.x + uFar.y, distance(cameraPosition, vec3(cw.x, aMidY, cw.z))); }` : 'vFadeV = aFade;'}`);
      if (far) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        if (vFadeV <= 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying float vFadeV; varying vec3 vLeafP;
        float v2h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float v2vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(v2h3(i), v2h3(i + vec3(1., 0., 0.)), f.x), mix(v2h3(i + vec3(0., 1., 0.)), v2h3(i + vec3(1., 1., 0.)), f.x), f.y),
                     mix(mix(v2h3(i + vec3(0., 0., 1.)), v2h3(i + vec3(1., 0., 1.)), f.x), mix(v2h3(i + vec3(0., 1., 1.)), v2h3(i + vec3(1., 1., 1.)), f.x), f.y), f.z); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        { // leaf clusters on the crown's surface: two octaves of value noise, each faded where its cycle is under ~2 pixels (rule 15)
          float lf = 0.0;
          for (int o = 0; o < 2; o++) { float fq = o == 0 ? 1.0 : 2.31; vec3 p = vLeafP * fq; vec3 fw = fwidth(p);
            float k = 1.0 - smoothstep(${L.LEAF_NOISE_FADE[0].toFixed(3)}, ${L.LEAF_NOISE_FADE[1].toFixed(3)}, max(fw.x, max(fw.y, fw.z)));
            lf += k * (v2vn(p) - 0.5) * (o == 0 ? 1.0 : 0.6); }
          diffuseColor.rgb *= max(0.0, 1.0 + ${(2 * L.LEAF_NOISE).toFixed(3)} * lf);
        }`)
        .replace('#include <alphatest_fragment>', dither ? `{ vec2 q = floor(gl_FragCoord.xy); float hh = fract(52.9829189 * fract(dot(q, vec2(0.06711056, 0.00583715)))); if (hh >= vFadeV) discard; }` : '');
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.specularColor *= ${L.SOLID_SPECULAR.toFixed(4)}; material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor); material.specularF90 = ${L.SOLID_SPECULAR.toFixed(4)};`);
    };
    m.customProgramCacheKey = () => 'v2-treesolid' + (far ? 'F' : '') + (dither ? 'D' : ''); return m;
  };

  // impostor quad + material
  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const EL = manifest.el, AZ = manifest.az, VFAR = L.FAR_VARIANTS, ROWS = VFAR * EL.length;
  const farU = { value: new THREE.Vector2(D2, W2) };
  const viewH = { value: 1000 };   // the drawing buffer's height in pixels (the ticker keeps it current): the far crowns' minimum size   // the mid -> far band, shared by every impostor material (setBands moves it)
  const impostorMaterial = (sp, atlas, tint) => {
    // the crown's sphere inside the quad: its radius as a share of the quad's half size (the variants' mean crownR / (rs x 1.03))
    const vs = manifest.species[sp].variants, crownK = vs.reduce((a, v) => a + v.crownR / (v.rs * 1.03), 0) / vs.length;
    const U = { uAtlas: { value: atlas }, uUpN: { value: L.IMPOSTOR_UP_NORMAL }, uEl: { value: new Float32Array(EL.map((e) => e * Math.PI / 180)) },
      uCrownK: { value: crownK }, uSphere: { value: L.IMPOSTOR_SPHERE }, uFar: farU, uViewH: viewH };
    const m = new THREE.MeshStandardMaterial({ color: tint || leafTint(sp), roughness: L.LEAF_ROUGHNESS, metalness: 0, alphaTest: L.ALPHA_CUT, alphaToCoverage: msaa });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U); specShader(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 aImp; varying float vFadeV; varying vec3 vToCam; varying vec2 vQ; varying float vVar; uniform float uUpN; varying vec4 vImpC; uniform vec2 uFar; uniform float uViewH;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vVar = aImp.y; vQ = position.xy * 0.5 + 0.5;
        { vec3 cw = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xyz; vec3 tc = cameraPosition - cw; float az = atan(tc.x, tc.z) - aImp.z;
          // the far share: the same smoothstep of the same distance (to the tree's mid-height point) as the near and mid bands use on the CPU
          vFadeV = smoothstep(uFar.x - uFar.y, uFar.x + uFar.y, distance(cameraPosition, vec3(cw.x, aImp.x, cw.z)));
          float el = asin(clamp(tc.y / max(length(tc), 1e-3), -1., 1.)); vToCam = vec3(az, el, 0.); vImpC = vec4(cw, length(instanceMatrix[0].xyz)); }`)
        .replace('#include <defaultnormal_vertex>', `vec3 transformedNormal = normalize(mix(vec3(0.,0.,1.), normalize(mat3(viewMatrix) * vec3(0.,1.,0.)), uUpN));`)
        .replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.);
        mvPosition.xy += position.xy * length(instanceMatrix[0].xyz); gl_Position = projectionMatrix * mvPosition;
        // a crown under IMPOSTOR_MIN_PX pixels across draws nothing (100k trees: most of the far ones on the horizon are a pixel or two)
        if (${L.IMPOSTOR_MIN_PX.toFixed(2)} > 0.0 && length(instanceMatrix[0].xyz) * projectionMatrix[1][1] / max(-mvPosition.z, 1.0) * uViewH < ${L.IMPOSTOR_MIN_PX.toFixed(2)}) vFadeV = 0.0;
        if (vFadeV <= 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // no far share (the near / mid bands draw it): the quad collapses outside the view`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying float vFadeV; varying vec3 vToCam; varying vec2 vQ; varying float vVar; uniform sampler2D uAtlas; uniform float uEl[${EL.length}];
        const float AZN = ${AZ.toFixed(1)}; const float ROWS = ${ROWS.toFixed(1)};
        vec4 cell(float azI, float elI, vec2 dx, vec2 dy) {
          float col = mod(azI, AZN), row = vVar * ${EL.length}.0 + elI;
          vec2 uv = vec2((col + vQ.x) / AZN, 1.0 - (row + 1.0 - vQ.y) / ROWS);
          return textureGrad(uAtlas, uv, dx / AZN, dy / ROWS);
        }`)
        .replace('#include <map_fragment>', `
        {
          vec2 dx = dFdx(vQ), dy = dFdy(vQ);
          { float rho = max(length(dx), length(dy)) * 96.0; float kk = max(1.0, exp2(${L.IMPOSTOR_MIN_LOD.toFixed(2)}) / max(rho, 1e-3)); dx *= kk; dy *= kk; }
          float a = vToCam.x / 6.28318530718 * AZN; a = a - AZN * floor(a / AZN);
          float a0 = floor(a), ta = a - a0, e = vToCam.y; float e0 = 0.0, te = 0.0;
          if (e <= uEl[0]) { e0 = 0.0; te = 0.0; }
          else if (e >= uEl[${EL.length - 1}]) { e0 = ${EL.length - 2}.0; te = 1.0; }
          else { for (int i = 0; i < ${EL.length - 1}; i++) { if (e >= uEl[i] && e < uEl[i + 1]) { e0 = float(i); te = (e - uEl[i]) / (uEl[i + 1] - uEl[i]); } } }
          ${L.IMPOSTOR_EL_BLEND ? `vec4 c00 = cell(a0, e0, dx, dy), c10 = cell(a0 + 1.0, e0, dx, dy), c01 = cell(a0, e0 + 1.0, dx, dy), c11 = cell(a0 + 1.0, e0 + 1.0, dx, dy);
          vec4 sampledDiffuseColor = mix(mix(c00, c10, ta), mix(c01, c11, ta), te);` : `float eN = e0 + step(0.5, te);   // the nearest elevation row: 2 taps, not 4 (speed; a solid crown changes little between rows)
          vec4 sampledDiffuseColor = mix(cell(a0, eN, dx, dy), cell(a0 + 1.0, eN, dx, dy), ta);`}
          diffuseColor *= sampledDiffuseColor;
        }`)
        .replace('#include <alphatest_fragment>', alphaChunk('vQ * 96.0', L.ALPHA_LOD_FAR))
        // Lit like the mid crown it replaces (no pop at the hand-over, rule 15): the cards' normals point out from the crown's middle
        // (+ IMPOSTOR_UP_BIAS up), so the quad gets the normals of the crown's sphere as seen from the camera; and the cards take the
        // sun's shadow (buildings', and the crown's own proxy on its far side), so the quad looks its shadow up on that sphere's surface.
        .replace('#include <common>', `#include <common>
        varying vec4 vImpC; uniform float uCrownK, uSphere; vec3 v2ImpP; vec3 v2ImpN;`)
        .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 && !defined( V2_DSM )
        uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
        #endif`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec2 q2 = (vQ * 2.0 - 1.0) / uCrownK; float r2 = dot(q2, q2);
          vec3 nS = vec3(q2 * (r2 > 1.0 ? inversesqrt(r2) : 1.0), sqrt(max(0.0, 1.0 - r2)));
          v2ImpN = (vec4(nS, 0.0) * viewMatrix).xyz;
          v2ImpP = vImpC.xyz + v2ImpN * vImpC.w * uCrownK;
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          normal = normalize(mix(normal, normalize(nS + ${L.IMPOSTOR_UP_BIAS.toFixed(3)} * upV), uSphere));
        }`)
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('vDirectionalShadowCoord[ i ] ) : 1.0;',
          `directionalShadowMatrix[ i ] * vec4( v2ImpP + v2ImpN * directionalLightShadow.shadowNormalBias, 1.0 ) ) : 1.0;`));
    };
    m.customProgramCacheKey = () => 'v2-treeimp' + msaa; return m;
  };

  // the far crowns' atlas for the solid crowns, drawn on this GPU at load (the shipped atlas is of the see-through cards): the mid band's
  // clumps and trunk, AZ azimuths x EL elevations x VFAR variants, cells laid out as tools/trees/gen.js lays out the shipped one (row 0 at
  // the top), each cell an orthographic view of rs x 1.03 round the crown centre. Colour = the crown's inner darkness (x the tint in
  // the shader), the trunk as its ratio to the tint; alpha = coverage (4x MSAA). Linear, mipmapped.
  const solidAtlas = (THREE, renderer, info, byName, trunkCol, tint) => {
    const CELL = manifest.cell || 96, rt = new THREE.WebGLRenderTarget(AZ * CELL, ROWS * CELL, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.anisotropy = aniso;
    const ratio = new THREE.Color(Math.min(1, trunkCol.r / Math.max(1e-4, tint.r)), Math.min(1, trunkCol.g / Math.max(1e-4, tint.g)), Math.min(1, trunkCol.b / Math.max(1e-4, tint.b)));
    const cm = new THREE.MeshBasicMaterial({ vertexColors: true }), tm = new THREE.MeshBasicMaterial({ color: ratio });
    const prev = { rt: renderer.getRenderTarget(), col: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha(), auto: renderer.autoClear };
    renderer.setClearColor(0x000000, 0); renderer.autoClear = true;
    for (let vi = 0; vi < VFAR; vi++) {
      const v = info.variants[vi % info.variants.length], cards = byName[`v${vi % info.variants.length}_leaves_near`].geometry;
      const cg = clumpGeometry(THREE, cards, v, L.CLUMPS[1], 1, L.CLUMP_GROW_FAR[0]);
      const tg = trunkCylinder(THREE, byName[`v${vi % info.variants.length}_trunk`].geometry, cg.userData.crownBase + 0.06);
      const sc = new THREE.Scene(); sc.add(new THREE.Mesh(cg, cm), new THREE.Mesh(tg, tm));
      const half = v.rs * 1.03, cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 20), ctr = new THREE.Vector3(...v.centre);
      for (let ei = 0; ei < EL.length; ei++) for (let ai = 0; ai < AZ; ai++) {
        const el = EL[ei] * Math.PI / 180, az = ai / AZ * 2 * Math.PI;
        cam.position.set(ctr.x + Math.sin(az) * Math.cos(el) * 5, ctr.y + Math.sin(el) * 5, ctr.z + Math.cos(az) * Math.cos(el) * 5);
        cam.up.set(0, 1, 0); cam.lookAt(ctr); cam.updateProjectionMatrix();
        const x = ai * CELL, y = (ROWS - 1 - (vi * EL.length + ei)) * CELL;
        rt.viewport.set(x, y, CELL, CELL); rt.scissor.set(x, y, CELL, CELL); rt.scissorTest = true;
        renderer.setRenderTarget(rt); renderer.render(sc, cam);
      }
      cg.dispose(); tg.dispose();
    }
    renderer.setRenderTarget(prev.rt); renderer.setClearColor(prev.col, prev.a); renderer.autoClear = prev.auto;
    cm.dispose(); tm.dispose();
    return rt.texture;
  };

  // ── per species: the GLB's meshes, one bucket (InstancedMesh pair) per variant and band ──
  const root = new THREE.Group(); root.name = 'trees-real'; group.add(root);
  const buckets = [];   // [sp][variant] = { near: {leaf, trunk}, mid: {...} }, far[sp] = impostor mesh
  const far = [], capSp = new Int32Array(speciesNames.length), capVar = speciesNames.map((s) => new Int32Array(manifest.species[s].variants.length));
  for (let i = 0; i < N; i++) { capSp[SP[i]]++; capVar[SP[i]][VAR[i]]++; }
  const mkInst = (geo, mat, cap, fadeAttr) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cap)); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = L.RECEIVE_SHADOW; m.visible = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const fa = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap)), 1); fa.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(fadeAttr, fa);
    m.setColorAt(0, new THREE.Color(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage); m.fadeAttr = fa;
    root.add(m); return m;
  };
  for (let si = 0; si < speciesNames.length; si++) {
    const sp = speciesNames[si], info = manifest.species[sp];
    const g = await gltf.loadAsync(DATA + info.glb), byName = {}; g.scene.traverse((o) => { if (o.isMesh) byName[o.name] = o; });
    if (L.SOLID) {
      const trunkM = trunkMaterial(sp), mN = solidMaterial(sp, false, false), mD = solidMaterial(sp, false, true);
      const trunkGeo = (name) => { const geo = byName[name].geometry.clone(); geo.computeVertexNormals(); return geo; };
      buckets[si] = info.variants.map((vinfo, vi) => {
        const cap = capVar[si][vi], cards = byName[`v${vi}_leaves_near`].geometry;
        const band = (k, grow, trunk) => {
          const geo = clumpGeometry(THREE, cards, vinfo, L.CLUMPS[k], L.CLUMP_DETAIL[k], grow);
          const tg = trunk ? trunkGeo(`v${vi}_trunk`) : trunkCylinder(THREE, byName[`v${vi}_trunk`].geometry, geo.userData.crownBase + 0.06);
          return { leaf: mkInst(geo, mN, cap, 'aFade'), leafF: mkInst(geo.clone(), mD, cap, 'aFade'), trunk: mkInst(tg, trunkM, cap, 'aFade') };
        };
        const b = { near: band(0, 1, true), mid: band(1, L.CLUMP_GROW_FAR[0], false), info: vinfo };
        return b;
      });
      // far: the impostor quads, their atlas drawn here from the mid band's own clumps (so the hand-over shows the same crown)
      const atlas = solidAtlas(THREE, renderer, info, byName, trunkM.color, solidTint(sp));
      const imp = new THREE.InstancedMesh(quad.clone(), impostorMaterial(sp, atlas, solidTint(sp)), Math.max(1, capSp[si]));
      imp.count = 0; imp.frustumCulled = false; imp.castShadow = false; imp.receiveShadow = L.RECEIVE_SHADOW && L.IMPOSTOR_SHADOW; imp.visible = false; imp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ia = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capSp[si]) * 4), 4); imp.geometry.setAttribute('aImp', ia); imp.impAttr = ia;
      imp.setColorAt(0, new THREE.Color(1, 1, 1)); root.add(imp); far[si] = imp;
      continue;
    }
    const leafM = leafMaterial(sp, info.leafCard), leafMMid = leafMaterial(sp, info.leafCard, true), trunkM = trunkMaterial(sp);
    buckets[si] = info.variants.map((vinfo, vi) => {
      const c = vinfo.centre, cap = capVar[si][vi];
      const prep = (o, leaf, trim) => {
        // a copy: each InstancedMesh gets its own instanced fade attribute (leaf cards: cut down to their octagon, a new geometry)
        const geo = (leaf && trim && L.TRIM_CARDS && trimCards(THREE, o.geometry, trim)) || o.geometry.clone();
        const pos = geo.attributes.position;
        if (leaf) {   // outward + up normals from the crown's centre (the soft round shading; flat cards would flicker)
          const n = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            let dx = pos.getX(i) - c[0], dy = pos.getY(i) - c[1] + 0, dz = pos.getZ(i) - c[2]; const l = Math.hypot(dx, dy, dz) || 1;
            dx /= l; dy = dy / l + 0.28; dz /= l; const l2 = Math.hypot(dx, dy, dz); n[i * 3] = dx / l2; n[i * 3 + 1] = dy / l2; n[i * 3 + 2] = dz / l2;
          }
          geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
        } else geo.computeVertexNormals();
        return geo;
      };
      const mk = (leafName, trunkName, lm, mid) => {
        const leaf = mkInst(prep(byName[`v${vi}_${leafName}`], true, (mid ? leafTexesMid : leafTexes)[info.leafCard].userData.trim), lm, cap, 'aFade');
        return { leaf, trunk: mkInst(prep(byName[`v${vi}_${trunkName}`], false), trunkM, cap, 'aFade') };
      };
      return { near: mk('leaves_near', 'trunk', leafM, false), mid: mk('leaves_mid', 'trunk_mid', leafMMid, true), info: vinfo };
    });
    // far: the atlas
    const atlasImg = await imageOf(DATA + info.atlas);
    const at = new THREE.Texture(atlasImg); at.colorSpace = THREE.SRGBColorSpace; at.generateMipmaps = true; at.minFilter = THREE.LinearMipmapLinearFilter; at.magFilter = THREE.LinearFilter; at.anisotropy = aniso; at.flipY = true; at.needsUpdate = true;
    const imp = new THREE.InstancedMesh(quad.clone(), impostorMaterial(sp, at), Math.max(1, capSp[si]));
    imp.count = 0; imp.frustumCulled = false; imp.castShadow = false; imp.receiveShadow = L.RECEIVE_SHADOW && L.IMPOSTOR_SHADOW; imp.visible = false; imp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const ia = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capSp[si]) * 4), 4); ia.setUsage(THREE.DynamicDrawUsage); imp.geometry.setAttribute('aImp', ia); imp.impAttr = ia;
    imp.setColorAt(0, new THREE.Color(1, 1, 1)); imp.instanceColor.setUsage(THREE.DynamicDrawUsage);
    root.add(imp); far[si] = imp;
  }

  // shadow proxy: one 20-triangle crown per tree stands in for the sun's shadow (drawn into the shadow map only; no colour, no depth)
  let proxy = null;
  if (L.SHADOW_PROXY) {
    proxy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), N);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const sc = manifest.species[speciesNames[SP[i]]].variants[VAR[i]];
      const ch = H[i] * 0.62, rr = R[i] * 1.1 * L.SHADOW_PROXY_SHRINK;
      M.compose(P.set(X[i], H[i] - ch / 2, Z[i]), Q, S.set(rr, ch / 2, rr)); proxy.setMatrixAt(i, M);
    }
    proxy.castShadow = params.get("treeproxy") !== "0"; proxy.receiveShadow = false; proxy.frustumCulled = false; proxy.name = 'tree shadow proxy'; proxy.computeBoundingSphere();
    group.add(proxy);
  }

  // ── the per-frame update: distance bands, view culling, instance data (a hidden mesh in the scene calls it each time the scene draws) ──
  const stats = { N, near: 0, mid: 0, far: 0, ms: 0, updates: 0 };
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), lastPos = new THREE.Vector3(1e9, 0, 0), lastQ = new THREE.Quaternion(), qDot = { v: 0 };
  let lastFov = 0, dirty = true;
  const nearN = buckets.map((vs) => vs.map(() => 0)), midN = buckets.map((vs) => vs.map(() => 0)), farN = speciesNames.map(() => 0);
  const planes = frustum.planes;
  const writeM = (arr, o, x, y, z, c, s, sx, sy, sz) => {
    arr[o] = c * sx; arr[o + 1] = 0; arr[o + 2] = -s * sx; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = s * sz; arr[o + 9] = 0; arr[o + 10] = c * sz; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  };
  const JIT = L.SHADE_JITTER;
  // upload only the instances in use (the buffers are sized for every tree of the bucket)
  const up = (a, n) => { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; };
  const crownK = (i, info) => Math.min(L.CROWN_STRETCH[1], Math.max(L.CROWN_STRETCH[0], R[i] / (H[i] * info.crownR)));
  // The far band is STATIC: every tree's quad is written once; its fade is the same smoothstep of the same distance (the tree's
  // mid-height point, aImp.x) worked out in the vertex shader, and a quad with no far share collapses there. The per-frame update below
  // then only visits the trees near enough for the near and mid bands, found through a grid (GRID_M squares).
  {
    const n = speciesNames.map(() => 0);
    for (let i = 0; i < N; i++) {
      const si = SP[i], vi = VAR[i], info = buckets[si][vi].info, h = H[i], kx = crownK(i, info), f = far[si], j = n[si]++;
      { // the atlas cells hold variants 0..VFAR-1 drawn at rs x 1.03 round the crown centre (the mid crowns' own frame)
        const fv = vi % VFAR, finfo = buckets[si][fv].info, sz = finfo.rs * 1.03 * h * (1 + kx) * 0.5;
        writeM(f.instanceMatrix.array, j * 16, X[i], finfo.centre[1] * h, Z[i], 1, 0, sz, sz, sz);
        const ia = f.impAttr.array; ia[j * 4] = h * 0.5; ia[j * 4 + 1] = fv; ia[j * 4 + 2] = YAW[i]; ia[j * 4 + 3] = 0;
      }
      const shade = 1 + (V[i] - 0.5) * 2 * JIT; f.instanceColor.array[j * 3] = f.instanceColor.array[j * 3 + 1] = f.instanceColor.array[j * 3 + 2] = shade;
    }
    for (let si = 0; si < far.length; si++) {
      const f = far[si]; f.count = n[si]; f.visible = n[si] > 0;
      for (const a of [f.instanceMatrix, f.instanceColor, f.impAttr]) { a.setUsage(THREE.StaticDrawUsage); a.needsUpdate = true; }
    }
  }
  const G = L.GRID_M, gx0 = Math.floor(Math.min(...X) / G), gz0 = Math.floor(Math.min(...Z) / G);
  const GW = Math.floor(Math.max(...X) / G) - gx0 + 1, GH = Math.floor(Math.max(...Z) / G) - gz0 + 1;
  const cellStart = new Int32Array(GW * GH + 1), cellTrees = new Int32Array(N);
  { const cell = new Int32Array(N); for (let i = 0; i < N; i++) { cell[i] = (Math.floor(Z[i] / G) - gz0) * GW + Math.floor(X[i] / G) - gx0; cellStart[cell[i] + 1]++; }
    for (let c = 0; c < GW * GH; c++) cellStart[c + 1] += cellStart[c];
    const fill = cellStart.slice(0, GW * GH); for (let i = 0; i < N; i++) cellTrees[fill[cell[i]]++] = i; }
  let maxH = 0; for (let i = 0; i < N; i++) maxH = Math.max(maxH, H[i]);
  const cI = new Int32Array(N), cD = new Float32Array(N), cN = new Float32Array(N), cM = new Float32Array(N), cO = new Uint32Array(N);
  function update(camera) {
    const t0 = performance.now();
    camera.updateMatrixWorld();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm, camera.coordinateSystem, camera.reversedDepth);
    const cp = camera.position;
    for (const vs of buckets) for (const b of vs) for (const band of [b.near, b.mid]) for (const m of Object.values(band)) m.count = 0;
    farU.value.set(D2, W2);
    let nN = 0, nM = 0, nc = 0;
    const cx = cp.x, cy = cp.y, cz = cp.z;
    // only trees closer than the far band's end can have a near or mid share: the grid squares within that reach (in plan)
    const reach = D2 + W2, dyMin = Math.max(0, cy - maxH * 0.5);
    const cxs = Math.max(0, Math.floor((cx - reach) / G) - gx0), cxe = Math.min(GW - 1, Math.floor((cx + reach) / G) - gx0);
    const czs = Math.max(0, Math.floor((cz - reach) / G) - gz0), cze = Math.min(GH - 1, Math.floor((cz + reach) / G) - gz0);
    for (let gzI = czs; gzI <= cze && dyMin < reach; gzI++) for (let gxI = cxs; gxI <= cxe; gxI++) for (let t = cellStart[gzI * GW + gxI], te = cellStart[gzI * GW + gxI + 1]; t < te; t++) {
      const i = cellTrees[t], h = H[i], x = X[i], z = Z[i];
      const dx = x - cx, dz = z - cz, dy = h * 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rad = Math.max(R[i] * 1.4, h * 0.6) + d * L.FRUSTUM_MARGIN;
      let out = false;
      for (let p = 0; p < 6; p++) { const pl = planes[p]; if (pl.normal.x * x + pl.normal.y * h * 0.5 + pl.normal.z * z + pl.constant < -rad) { out = true; break; } }
      if (out) continue;
      const a = d <= D1 - W1 ? 0 : (d >= D1 + W1 ? 1 : smooth(D1 - W1, D1 + W1, d));
      const b = d <= D2 - W2 ? 0 : (d >= D2 + W2 ? 1 : smooth(D2 - W2, D2 + W2, d));
      const fn = 1 - a, fm = a * (1 - b);
      if (fn <= 0.004 && fm <= 0.004) continue;
      cI[nc] = i; cD[nc] = d; cN[nc] = fn; cM[nc] = fm; cO[nc] = nc; nc++;
    }
    // nearest first: an opaque crown in front hides the ones behind before they are shaded (the GPU's early depth test)
    const ord = cO.subarray(0, nc).sort((p, q) => cD[p] - cD[q]);
    for (let k = 0; k < nc; k++) {
      const o = ord[k], i = cI[o], fn = cN[o], fm = cM[o], h = H[i], x = X[i], z = Z[i];
      const si = SP[i], vi = VAR[i], yaw = YAW[i], c = Math.cos(yaw), s = Math.sin(yaw);
      const info = buckets[si][vi].info, kx = crownK(i, info), shade = 1 + (V[i] - 0.5) * 2 * JIT;
      const bk = buckets[si][vi];
      for (const [band, f] of [[bk.near, fn], [bk.mid, fm]]) {
        if (f <= 0.004) continue;
        // solid crowns: a fully-in tree draws with the plain material, one inside the fade with the dithered one
        const ms = band.leafF ? [f >= 0.996 ? band.leaf : band.leafF, band.trunk] : [band.leaf, band.trunk];
        for (const m of ms) {
          const j = m.count++;
          writeM(m.instanceMatrix.array, j * 16, x, 0, z, c, s, h * kx, h, h * kx);
          m.fadeAttr.array[j] = f; m.instanceColor.array[j * 3] = m.instanceColor.array[j * 3 + 1] = m.instanceColor.array[j * 3 + 2] = shade;
        }
        if (band === bk.near) nN++; else nM++;
      }
    }
    for (const vs of buckets) for (const bk of vs) for (const band of [bk.near, bk.mid]) for (const m of Object.values(band)) {
      const cnt = m.count; m.visible = cnt > 0; if (cnt) { up(m.instanceMatrix, cnt); up(m.instanceColor, cnt); up(m.fadeAttr, cnt); }
    }
    stats.near = nN; stats.mid = nM; stats.far = N; stats.updates++; stats.ms = performance.now() - t0;
  }
  // the ticker: an invisible one-triangle mesh drawn first; its onBeforeRender runs the update with the camera that is drawing
  const ticker = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.001, 0, 0.001, 0, 0], 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false; ticker.renderOrder = -1e6; ticker.name = 'tree ticker';
  let lastKey = ''; const _vh = new THREE.Vector2();
  ticker.onBeforeRender = (r, sc, camera) => {
    const e = camera.matrixWorld.elements, key = e[12].toFixed(2) + e[13].toFixed(2) + e[14].toFixed(2) + e[0].toFixed(4) + e[2].toFixed(4) + e[6].toFixed(4) + camera.fov + camera.aspect;
    if (key === lastKey && !dirty) return;
    viewH.value = r.getDrawingBufferSize(_vh).y * 0.5;
    lastKey = key; dirty = false; update(camera);
  };
  group.add(ticker);
  const area = (o) => o.reduce((a, p, i) => a + p[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * p[1], 0) / 2;
  Object.assign(stats, { ready: true, species: speciesNames, bands: { D1, W1, D2, W2 }, solid: L.SOLID, trim: L.TRIM_CARDS && !L.SOLID ? Object.fromEntries([...Object.entries(leafTexes).map(([k, t]) => [k, +area(t.userData.trim).toFixed(3)]), ...Object.entries(leafTexesMid).map(([k, t]) => ['mid ' + k, +area(t.userData.trim).toFixed(3)])]) : null });
  window.__v2treesReal = { stats: () => ({ ...stats }), update, root, proxy, buckets, far, leafTexes, leafTexesMid, force: () => { dirty = true; },
    // the distance bands inside the page (A/B in one load, rule 13): [near->mid centre, half-width], [mid->far centre, half-width]
    setBands: (a, b) => { if (a) [D1, W1] = a; if (b) [D2, W2] = b; stats.bands = { D1, W1, D2, W2 }; dirty = true; redraw(); } };
  redraw();
  return window.__v2treesReal;
}
