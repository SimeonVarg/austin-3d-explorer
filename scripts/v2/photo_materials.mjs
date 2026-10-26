// Materials taken from photographs (CLAUDE.md rule 16, "Materials taken from photographs"), applied per building at tile build time.
// Spec: scripts/v2/photo_materials.json, per building slug:
//   materials: { <material name>: { albedo, normal?, repeat_m: [u, v], factor: [r, g, b], mean_rgb: [r, g, b] } }
//     near (lod0): the albedo (x factor) and normal map, with texture coordinates made here from position and normal: on a wall
//     (|normal.y| < wall_max_ny) u runs along the wall and v up, elsewhere plan x/z; metres / repeat_m. Mipmapped by the app (rule 15).
//     far (lod1): the plain mean colour, so the switch to the far file does not change the colour.
//   filter: { anisotropy, lod_bias }  optional: how v2/tiles.js samples this building's photo textures (absent = plain trilinear)
//   fade: { <material name>: { to: [r, g, b], size_m } }  fine parts (brackets, trim) whose colour fades into the surface behind them
//     as the pixel grows past the part's size (v2/tiles.js, coverage fade): steady in motion, never blurred.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let SPEC = null;
const spec = () => (SPEC ||= (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'photo_materials.json'), 'utf8')); } catch { return {}; } })());
// a 1 x 1 white PNG: a fade material carries it so the palette pass leaves the material (and its extras) alone
const WHITE_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8ffffff7f0009fb03fd2a86e38a0000000049454e44ae426082', 'hex');

// what the tile's hash must change with: the building's spec and its texture bytes
export function photoMaterialsKey(slug, repo) {
  const sp = spec()[slug]; if (!sp) return '';
  const h = crypto.createHash('sha256').update(JSON.stringify(sp));
  for (const m of Object.values(sp.materials || {})) for (const f of [m.albedo, m.normal]) if (f) h.update(fs.readFileSync(path.join(repo, f)));
  return h.digest('hex').slice(0, 16);
}

export function applyPhotoMaterials(doc, slug, lod, repo) {
  const sp = spec()[slug]; if (!sp) return;
  const root = doc.getRoot(); const buf = root.listBuffers()[0];
  const tex = {}, mats = {};
  const image = (file, mime) => tex[file] ||= doc.createTexture(path.basename(file)).setImage(fs.readFileSync(path.join(repo, file))).setMimeType(mime);
  const mimeOf = (f) => (/\.png$/i.test(f) ? 'image/png' : 'image/jpeg');
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const mt = prim.getMaterial(); const name = mt && mt.getName(); if (!name) continue;
    const ms = sp.materials && sp.materials[name];
    if (ms && lod !== 0) { mt.setBaseColorFactor([...(ms.mean_rgb || ms.factor), 1]); continue; }
    const fd = sp.fade && sp.fade[name];
    if (fd && lod === 0) {
      const key = 'fade:' + name;
      if (!mats[key]) {
        tex.__white ||= doc.createTexture('white').setImage(WHITE_PNG).setMimeType('image/png');
        mats[key] = mt.clone().setName(name + '_fade').setBaseColorTexture(tex.__white).setExtras({ ...(mt.getExtras() || {}), v2_fade_to: fd.to, v2_fade_m: fd.size_m });
      }
      const P = prim.getAttribute('POSITION'), n = P.getCount();
      prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(n * 2)).setBuffer(buf));
      prim.setMaterial(mats[key]);
      continue;
    }
    if (!ms || lod !== 0) continue;
    const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), n = P.getCount();
    const uv = new Float32Array(n * 2), p = [], q = [];
    const [ru, rv] = ms.repeat_m;
    for (let i = 0; i < n; i++) {
      P.getElement(i, p); N.getElement(i, q);
      const l = Math.hypot(q[0], q[1], q[2]) || 1, nx = q[0] / l, ny = q[1] / l, nz = q[2] / l;
      if (Math.abs(ny) < sp.wall_max_ny) { const h = Math.hypot(nx, nz) || 1; uv[2 * i] = (p[0] * nz / h - p[2] * nx / h) / ru; uv[2 * i + 1] = -p[1] / rv; }
      else { uv[2 * i] = p[0] / ru; uv[2 * i + 1] = p[2] / rv; }
    }
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf));
    const key = ms.albedo + ':' + ms.factor.join(',');
    if (!mats[key]) {
      const m2 = mats[key] = mt.clone().setName(name + '_photo').setBaseColorFactor([...ms.factor, 1]).setBaseColorTexture(image(ms.albedo, mimeOf(ms.albedo)));
      if (ms.normal) m2.setNormalTexture(image(ms.normal, mimeOf(ms.normal)));
      m2.setExtras({ ...(mt.getExtras() || {}), v2_kind: 'plain', photo_material: ms.source, ...(sp.filter ? { v2_photo_aniso: sp.filter.anisotropy, v2_photo_bias: sp.filter.lod_bias } : {}) });
    }
    prim.setMaterial(mats[key]);
  }
}
