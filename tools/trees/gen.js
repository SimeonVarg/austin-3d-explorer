// Offline tree-library generator (EZ-Tree, MIT, https://github.com/dgreenheck/ez-tree): runs in a page driven by gen.mjs.
// Per species: 3 variants of trunk + branches + leaf cards, exported as one GLB (near and mid leaf sets), a neutral leaf-clump card
// texture, and a multi-angle impostor atlas (8 azimuths x 4 elevations x 2 variants). Colours are NOT baked from guesses: the manifest
// carries the photo-sampled colours (photo_colours.json) and the atlas is neutral shading x trunk/leaf ratio.
import * as THREE from 'three';
import { Tree, TreePreset } from '@dgreenheck/ez-tree';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const Q = new URLSearchParams(location.search);
const PREVIEW = Q.get('preview') === '1';
const only = (Q.get('only') || '').split(',').filter(Boolean);
const mulberry = (s) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const deep = (t, p) => { for (const k in p) { if (p[k] && typeof p[k] === 'object') { t[k] = t[k] || {}; deep(t[k], p[k]); } else t[k] = p[k]; } return t; };

// ── species forms: a preset of EZ-Tree plus the patch that makes it an Austin tree ─────────────────────────────────────
const SPECIES = {
  live_oak: {   // wide, low, irregular, evergreen-dense crown; heavy limbs leaving a short trunk
    base: 'Oak Medium', leaf: 'broad', seeds: [11, 207, 4421],
    patch: { type: 'deciduous', branch: { levels: 3, angle: { 1: 80, 2: 58, 3: 40 }, children: { 0: 7, 1: 5, 2: 3 },
      force: { strength: -0.012 }, gnarliness: { 0: 0.16, 1: 0.2, 2: 0.16, 3: 0.1 }, length: { 0: 15, 1: 24, 2: 15, 3: 8 },
      radius: { 0: 2.0, 1: 0.8, 2: 0.7, 3: 0.6 }, sections: { 0: 6, 1: 5, 2: 3, 3: 2 }, segments: { 0: 6, 1: 4, 2: 3, 3: 3 }, start: { 1: 0.30, 2: 0.2, 3: 0.1 } },
      leaves: { count: 5, size: 8.6, sizeVariance: 0.45, angle: 40, start: 0.05, billboard: 'double' } },
  },
  cedar_elm: {  // vase-shaped, medium height, small leaves
    base: 'Ash Medium', leaf: 'broad', seeds: [5, 318, 9001],
    patch: { branch: { angle: { 1: 40, 2: 52, 3: 60 }, children: { 0: 7, 1: 4, 2: 3 }, length: { 0: 30, 1: 22, 2: 11, 3: 6 }, radius: { 0: 1.2, 1: 0.6, 2: 0.7, 3: 0.6 }, force: { strength: -0.03 },
      gnarliness: { 0: 0.05, 1: 0.2, 2: 0.2, 3: 0.09 }, sections: { 0: 6, 1: 5, 2: 3, 3: 2 }, segments: { 0: 6, 1: 4, 2: 3, 3: 3 } },
      leaves: { count: 5, size: 6.2, sizeVariance: 0.5, angle: 50, start: 0.02 } },
  },
  pecan: {      // tall, broad rounded crown on a long trunk
    base: 'Ash Large', leaf: 'broad', seeds: [77, 1234, 56],
    patch: { branch: { angle: { 1: 50, 2: 58, 3: 60 }, children: { 0: 6, 1: 4, 2: 3 }, radius: { 0: 1.5 }, length: { 0: 44, 1: 28, 2: 12, 3: 6 }, force: { strength: -0.045 }, sections: { 0: 6, 1: 5, 2: 3, 3: 2 }, segments: { 0: 6, 1: 4, 2: 3, 3: 3 } },
      leaves: { count: 5, size: 6.6, sizeVariance: 0.5, angle: 50, start: 0.02 } },
  },
  crape_myrtle: { // small, multi-stem, vase, fine leaves
    base: 'Bush 1', leaf: 'broad', seeds: [3, 88],
    patch: { branch: { levels: 3, angle: { 1: 22, 2: 55, 3: 50 }, children: { 0: 6, 1: 4, 2: 3 }, length: { 0: 11, 1: 18, 2: 8, 3: 4 }, radius: { 0: 1.0, 1: 0.7, 2: 0.6, 3: 0.6 },
      sections: { 0: 5, 1: 5, 2: 3, 3: 2 }, segments: { 0: 5, 1: 4, 2: 3, 3: 3 }, start: { 1: 0.15, 2: 0.3, 3: 0.1 }, force: { strength: -0.01 }, gnarliness: { 0: 0.08, 1: 0.14, 2: 0.12, 3: 0.09 } },
      leaves: { count: 6, size: 4.4, sizeVariance: 0.45, angle: 50, start: 0.05 } },
  },
  bald_cypress: { // conical, feathery
    base: 'Pine Medium', leaf: 'spray', seeds: [19, 400],
    patch: { type: 'evergreen', branch: { children: { 0: 90 }, angle: { 1: 100 }, length: { 0: 52, 1: 20 }, radius: { 0: 1.1, 1: 0.3 }, force: { strength: -0.004 }, sections: { 0: 8, 1: 4 }, segments: { 0: 5, 1: 3 } },
      leaves: { count: 10, size: 3.6, sizeVariance: 0.3, angle: 35, start: 0.1 } },
  },
  ashe_juniper: { // short, dense, bushy dark evergreen
    base: 'Pine Small', leaf: 'spray', seeds: [8, 303],
    patch: { type: 'evergreen', branch: { children: { 0: 100 }, angle: { 1: 80 }, length: { 0: 26, 1: 17 }, radius: { 0: 1.5, 1: 0.4 }, gnarliness: { 0: 0.14, 1: 0.12 }, force: { strength: -0.004 }, sections: { 0: 6, 1: 4 }, segments: { 0: 6, 1: 3 } },
      leaves: { count: 9, size: 4.3, sizeVariance: 0.35, angle: 40, start: 0.05 } },
  },
};

// ── leaf-clump card textures (neutral grey, alpha): the card holds a CLUSTER, so a few cards make a crown ──────────────────
function leafCanvas(kind, seed) {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); const R = mulberry(seed);
  const grey = (lo, hi) => { const v = Math.round(lo + R() * (hi - lo)); return `rgb(${v},${v},${v})`; };
  if (kind === 'broad') {
    for (let i = 0; i < 52; i++) {
      const a = R() * 6.283, r = Math.sqrt(R()) * 96, x = N / 2 + Math.cos(a) * r, y = N / 2 + Math.sin(a) * r * 0.92;
      const L = 24 + R() * 22, W = 10 + R() * 8, rot = R() * 6.283;
      g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = grey(150, 255);
      g.beginPath(); g.ellipse(0, 0, L / 2, W / 2, 0, 0, 6.283); g.fill(); g.restore();
    }
  } else {   // feathery sprays of scale leaves / needles
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (R() - 0.5) * 2.6, len = 70 + R() * 55, x0 = N / 2 + (R() - 0.5) * 30, y0 = N * (0.55 + R() * 0.35);
      const curv = (R() - 0.5) * 0.9;
      g.strokeStyle = grey(140, 230); g.lineWidth = 3 + R() * 2.5;
      let x = x0, y = y0, ang = a;
      for (let s = 0; s < 14; s++) {
        const nx = x + Math.cos(ang) * len / 14, ny = y + Math.sin(ang) * len / 14;
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        for (const side of [-1, 1]) {   // little side sprays
          g.lineWidth = 2 + R() * 1.6; g.strokeStyle = grey(150, 255);
          const sl = (10 + R() * 14) * (1 - s / 18);
          g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + Math.cos(ang + side * (0.8 + R() * 0.5)) * sl, ny + Math.sin(ang + side * (0.8 + R() * 0.5)) * sl); g.stroke();
        }
        x = nx; y = ny; ang += curv / 14;
      }
    }
  }
  return c;
}

// ── generation ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function generate(name, seed) {
  const sp = SPECIES[name];
  const opts = clone(TreePreset[sp.base]); deep(opts, clone(sp.patch)); opts.seed = seed; opts.bark.textured = false;
  const tree = new Tree(); tree.options.copy(opts); tree.generate();
  const bg = tree.branchesMesh.geometry, lg = tree.leavesMesh.geometry;
  return { tree, trunk: { pos: Array.from(bg.attributes.position.array), idx: Array.from(bg.index.array) }, leaves: { pos: Array.from(lg.attributes.position.array), uv: Array.from(lg.attributes.uv.array), idx: Array.from(lg.index.array) } };
}

// normalise to height 1 on the ground, build near/mid leaf sets with outward normals and an inside-dark colour gradient
function process(raw, speciesSeed) {
  const R = mulberry(speciesSeed);
  const all = raw.trunk.pos.concat(raw.leaves.pos);
  let minY = 1e9, maxY = -1e9;
  for (let i = 1; i < all.length; i += 3) { minY = Math.min(minY, all[i]); maxY = Math.max(maxY, all[i]); }
  const H = maxY - minY, s = 1 / H;
  const fix = (p) => { const o = new Array(p.length); for (let i = 0; i < p.length; i += 3) { o[i] = p[i] * s; o[i + 1] = (p[i + 1] - minY) * s; o[i + 2] = p[i + 2] * s; } return o; };
  const tpos = fix(raw.trunk.pos), lpos = fix(raw.leaves.pos);
  // crown centre = mean of leaf vertices; radius = 95th percentile of the distance from the trunk axis (horizontal)
  let cx = 0, cy = 0, cz = 0; const nv = lpos.length / 3;
  for (let i = 0; i < lpos.length; i += 3) { cx += lpos[i]; cy += lpos[i + 1]; cz += lpos[i + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  const hr = []; for (let i = 0; i < lpos.length; i += 3) hr.push(Math.hypot(lpos[i] - cx, lpos[i + 2] - cz));
  hr.sort((a, b) => a - b); const crownR = hr[Math.floor(hr.length * 0.95)];
  let rs = 0; for (let i = 0; i < lpos.length; i += 3) rs = Math.max(rs, Math.hypot(lpos[i] - cx, lpos[i + 1] - cy, lpos[i + 2] - cz));
  for (let i = 0; i < tpos.length; i += 3) rs = Math.max(rs, Math.hypot(tpos[i] - cx, tpos[i + 1] - cy, tpos[i + 2] - cz));
  // leaf quads: groups of 4 verts. gradient: inner = dark, outer = lit; per-quad jitter
  const nq = nv / 4, colFlat = new Array(lpos.length), col = new Array(lpos.length);
  const crownRad = Math.max(crownR, 0.05);
  const normals = new Array(lpos.length);
  for (let q = 0; q < nq; q++) {
    const jitter = 0.94 + R() * 0.12;   // per-card brightness: small (cards that swap depth order in motion would flicker by this much)
    for (let k = 0; k < 4; k++) {
      const i = (q * 4 + k) * 3;
      let dx = lpos[i] - cx, dy = lpos[i + 1] - cy, dz = lpos[i + 2] - cz; let l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l; dy += 0.28; l = Math.hypot(dx, dy, dz); normals[i] = dx / l; normals[i + 1] = dy / l; normals[i + 2] = dz / l;
      const t = Math.min(1, Math.hypot(lpos[i] - cx, (lpos[i + 1] - cy) * 0.8, lpos[i + 2] - cz) / (rs * 0.95));
      const up = Math.min(1, Math.max(0, (lpos[i + 1] - 0.15) / 0.8));
      const ao = (0.34 + 0.66 * Math.pow(t, 0.8)) * (0.78 + 0.22 * up) * jitter;
      col[i] = col[i + 1] = col[i + 2] = Math.min(1, ao); colFlat[i] = colFlat[i + 1] = colFlat[i + 2] = Math.min(1, ao / jitter);
    }
  }
  const lidx = raw.leaves.idx, luv = raw.leaves.uv;
  // mid LOD: keep ~42 % of the quads (whole double-cards stay together: pairs), grown about their centres to hold the crown mass
  const KEEP = 0.36, grow = 1 / Math.sqrt(KEEP);
  const mid = { pos: [], uv: [], col: [], nor: [], idx: [] };
  const pairs = Math.floor(nq / 2);
  let mv = 0;
  for (let p = 0; p < pairs; p++) {
    if (R() > KEEP) continue;
    for (let qq = 0; qq < 2; qq++) {
      const q = p * 2 + qq; let mx = 0, my = 0, mz = 0;
      for (let k = 0; k < 4; k++) { const i = (q * 4 + k) * 3; mx += lpos[i] / 4; my += lpos[i + 1] / 4; mz += lpos[i + 2] / 4; }
      for (let k = 0; k < 4; k++) {
        const i = (q * 4 + k) * 3;
        mid.pos.push(mx + (lpos[i] - mx) * grow, my + (lpos[i + 1] - my) * grow, mz + (lpos[i + 2] - mz) * grow);
        mid.nor.push(normals[i], normals[i + 1], normals[i + 2]); mid.col.push(colFlat[i], colFlat[i + 1], colFlat[i + 2]);   // mid cards: no per-card jitter
        mid.uv.push(luv[(q * 4 + k) * 2], luv[(q * 4 + k) * 2 + 1]);
      }
      mid.idx.push(mv, mv + 1, mv + 2, mv, mv + 2, mv + 3); mv += 4;
    }
  }
  // mid trunk: the same mesh with the small triangles (twigs, hidden under leaves at that range) dropped
  const ti = raw.trunk.idx, areas = [];
  for (let t = 0; t < ti.length; t += 3) {
    const a = ti[t] * 3, b2 = ti[t + 1] * 3, c = ti[t + 2] * 3;
    const ux = tpos[b2] - tpos[a], uy = tpos[b2 + 1] - tpos[a + 1], uz = tpos[b2 + 2] - tpos[a + 2], vx = tpos[c] - tpos[a], vy = tpos[c + 1] - tpos[a + 1], vz = tpos[c + 2] - tpos[a + 2];
    areas.push(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx));
  }
  const sortedA = areas.slice().sort((p, q) => p - q), cut = sortedA[Math.floor(sortedA.length * 0.62)];
  const midIdx = []; for (let t = 0; t < areas.length; t++) if (areas[t] >= cut) midIdx.push(ti[t * 3], ti[t * 3 + 1], ti[t * 3 + 2]);
  return {
    trunk: { pos: tpos, idx: raw.trunk.idx }, trunkMid: { pos: tpos, idx: midIdx },
    near: { pos: lpos, uv: luv, col, nor: normals, idx: lidx }, mid,
    crownR, centre: [cx, cy, cz], rs, H,
    tri: { trunk: raw.trunk.idx.length / 3, trunkMid: midIdx.length / 3, near: lidx.length / 3, mid: mid.idx.length / 3 },
  };
}

const geo = (d, withCol, withUV) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  if (d.nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
  if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  if (withCol) g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
  g.setIndex(d.idx);
  if (!d.nor) g.computeVertexNormals();
  return g;
};

// compact geometry for the GLB: positions float32, uv uint16 normalised, colour uint8 RGBA; no normals (the app computes them)
const geoGlb = (d, withLeaf, shareAttr) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', shareAttr ? shareAttr.position : new THREE.Float32BufferAttribute(d.pos, 3));
  if (withLeaf) {
    const n = d.pos.length / 3, uv = new Uint16Array(n * 2), c = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { uv[i * 2] = Math.round(d.uv[i * 2] * 65535); uv[i * 2 + 1] = Math.round(d.uv[i * 2 + 1] * 65535); c[i * 4] = c[i * 4 + 1] = c[i * 4 + 2] = Math.round(d.col[i * 3] * 255); c[i * 4 + 3] = 255; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2, true)); g.setAttribute('color', new THREE.BufferAttribute(c, 4, true));
  }
  g.setIndex(d.idx); return g;
};
async function post(path, body) { const r = await fetch('/save/' + path, { method: 'POST', body }); if (!r.ok) throw new Error('save ' + path); }
const canvasBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));

// ── run ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const COLOURS = await (await fetch('/colours.json')).json();    // per species leaf/trunk hex from the photographs
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, canvas: document.getElementById('c') });
const CELL = 96, AZ = 8, EL = [8, 32, 56, 84], VFAR = 2;
const hex = (h) => new THREE.Color(h);
const log = [];
const manifest = { generator: 'EZ-Tree 1.1.0 (MIT) via tools/trees/gen', cell: CELL, az: AZ, el: EL, species: {} };

for (const name of Object.keys(SPECIES)) {
  if (only.length && !only.includes(name)) continue;
  const sp = SPECIES[name], col = COLOURS[name];
  const variants = sp.seeds.map((sd, vi) => process(generate(name, sd), sd * 31 + vi));
  const leafC = leafCanvas(sp.leaf, 900 + name.length);
  const leafTex = new THREE.CanvasTexture(leafC); leafTex.colorSpace = THREE.SRGBColorSpace; leafTex.flipY = true; leafTex.needsUpdate = true;
  // ratio colours for the atlas: trunk relative to the lit leaf (so the runtime tint = lit leaf colour x gain)
  const lin = (h) => { const c = hex(h); return [c.r, c.g, c.b]; };
  const leafLit = lin(col.leaf.sunlit), trunkL = lin(col.trunk);
  const ratio = trunkL.map((v, i) => Math.min(1, v / Math.max(leafLit[i], 1e-4)));
  const trunkAtlasColour = new THREE.Color().setRGB(ratio[0], ratio[1], ratio[2]);   // linear
  manifest.species[name] = {
    leaf: col.leaf, trunk: col.trunk, source: col.source, leafCard: sp.leaf + '.png', atlas: name + '_atlas.png', glb: name + '.glb',
    variants: variants.map((v) => ({ crownR: +v.crownR.toFixed(4), centre: v.centre.map((x) => +x.toFixed(4)), rs: +v.rs.toFixed(4), height: v.H, tri: v.tri })),
  };
  log.push(name + ' ' + JSON.stringify(variants.map((v) => v.tri)) + ' crownR ' + variants.map((v) => v.crownR.toFixed(2)).join('/'));

  // GLB: one node per mesh
  const scene = new THREE.Scene();
  const mTrunk = new THREE.MeshStandardMaterial({ name: 'bark', color: 0xffffff, roughness: 1 });
  const mLeaf = new THREE.MeshStandardMaterial({ name: 'leaf', color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.9 });
  variants.forEach((v, i) => {
    const gt = geoGlb(v.trunk, false); const t = new THREE.Mesh(gt, mTrunk); t.name = `v${i}_trunk`; scene.add(t);
    const tm2 = new THREE.Mesh(geoGlb(v.trunkMid, false, gt.attributes), mTrunk); tm2.name = `v${i}_trunk_mid`; scene.add(tm2);
    const n = new THREE.Mesh(geoGlb(v.near, true), mLeaf); n.name = `v${i}_leaves_near`; scene.add(n);
    const m = new THREE.Mesh(geoGlb(v.mid, true), mLeaf); m.name = `v${i}_leaves_mid`; scene.add(m);
  });
  if (!PREVIEW) {
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
    await post(name + '.glb', glb);
    await post(sp.leaf + '.png', await canvasBlob(leafC));
  }

  // impostor atlas
  const rows = VFAR * EL.length, W = AZ * CELL, Ht = rows * CELL;
  const atlas = document.createElement('canvas'); atlas.width = W; atlas.height = Ht; const actx = atlas.getContext('2d', { willReadFrequently: true });
  const SSA = 3; renderer.setPixelRatio(1); renderer.setSize(CELL * SSA, CELL * SSA, false);   // each cell drawn 3x and filtered down: soft, antialiased silhouettes renderer.setClearColor(0x000000, 0);
  for (let vi = 0; vi < VFAR; vi++) {
    const v = variants[vi];
    const bs = new THREE.Scene();
    const tm = new THREE.MeshBasicMaterial({ color: trunkAtlasColour });
    const lm = new THREE.MeshBasicMaterial({ map: leafTex, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
    bs.add(new THREE.Mesh(geo(v.trunk, false, false), tm)); bs.add(new THREE.Mesh(geo(v.near, true, true), lm));
    const half = v.rs * 1.03, cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 20);
    const ctr = new THREE.Vector3(...v.centre);
    for (let ei = 0; ei < EL.length; ei++) for (let ai = 0; ai < AZ; ai++) {
      const el = EL[ei] * Math.PI / 180, az = ai / AZ * 2 * Math.PI;
      cam.position.set(ctr.x + Math.sin(az) * Math.cos(el) * 5, ctr.y + Math.sin(el) * 5, ctr.z + Math.cos(az) * Math.cos(el) * 5);
      cam.up.set(0, 1, 0); cam.lookAt(ctr); cam.updateProjectionMatrix();
      renderer.render(bs, cam);
      actx.imageSmoothingEnabled = true; actx.imageSmoothingQuality = 'high';
      actx.drawImage(renderer.domElement, 0, 0, CELL * SSA, CELL * SSA, ai * CELL, (vi * EL.length + ei) * CELL, CELL, CELL);
    }
  }
  // dilate the colour into the transparent pixels (so mip levels and the sharpened alpha never pull in black)
  const img = actx.getImageData(0, 0, W, Ht), d = img.data;
  for (let pass = 0; pass < 3; pass++) {
    const copy = new Uint8ClampedArray(d);
    for (let y = 0; y < Ht; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (copy[i + 3] > 8) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= Ht) continue;
        const j = (yy * W + xx) * 4; if (copy[j + 3] > 8) { r += copy[j]; g += copy[j + 1]; b += copy[j + 2]; n++; }
      }
      if (n) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
    }
  }
  actx.putImageData(img, 0, 0);
  if (!PREVIEW) await post(name + '_atlas.png', await canvasBlob(atlas));
  if (PREVIEW) { window.__atlas = window.__atlas || {}; window.__atlas[name] = atlas.toDataURL(); }
  window.__variants = window.__variants || {}; window.__variants[name] = variants.map((v) => ({ tri: v.tri }));

  // preview sheet: side views of the three variants (leaf colour from the photo, unlit), drawn into the document
  if (PREVIEW) {
    const pc = document.createElement('canvas'); pc.width = 3 * 220; pc.height = 260; pc.style.cssText = 'display:block;margin:2px'; document.body.appendChild(pc);
    const pr = new THREE.WebGLRenderer({ antialias: true, canvas: pc, preserveDrawingBuffer: true }); pr.setSize(660, 260, false); pr.setScissorTest(true); pr.setClearColor(0xb8c8d8);
    variants.forEach((v, i) => {
      const s2 = new THREE.Scene(); s2.add(new THREE.HemisphereLight(0xffffff, 0x445544, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(2, 3, 1); s2.add(dl);
      s2.add(new THREE.Mesh(geo(v.trunk, false, false), new THREE.MeshStandardMaterial({ color: hex(col.trunk), roughness: 1 })));
      s2.add(new THREE.Mesh(geo(v.near, true, true), new THREE.MeshStandardMaterial({ map: leafTex, color: hex(col.leaf.sunlit).multiplyScalar(2.2), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 })));
      const hh = 0.62, ar = 220 / 260, cm = new THREE.OrthographicCamera(-hh * ar, hh * ar, hh * 1.02, -hh * 0.98, 0.01, 20); cm.position.set(3, 0.5, 4); cm.lookAt(0, 0.5, 0);
      pr.setViewport(i * 220, 0, 220, 260); pr.setScissor(i * 220, 0, 220, 260); pr.render(s2, cm);
    });
    pr.domElement.title = name;
  }
}
if (!PREVIEW) await post('manifest.json', JSON.stringify(manifest, null, 1));
window.__done = log;
