// ?trees=real: the tree library (v2/data/trees-real/, made offline by tools/trees/gen with EZ-Tree, MIT) in place of v2's one ball or
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
  return t;
}

const imageOf = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + url)); i.src = url; });

export async function installRealTrees({ THREE, scene, group, redraw, rows, groups, phone = false, renderer }) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const manifest = await fetch(DATA + 'manifest.json').then((r) => r.json());
  const msaa = !!(renderer && renderer.capabilities && renderer.getContext().getContextAttributes().antialias);
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  const [D1, W1] = phone ? L.NEAR_TO_MID_M_PHONE : L.NEAR_TO_MID_M, [D2, W2] = phone ? L.MID_TO_FAR_M_PHONE : L.MID_TO_FAR_M;

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
  for (const kind of new Set(Object.values(manifest.species).map((s) => s.leafCard))) leafTexes[kind] = coverageTexture(THREE, await imageOf(DATA + kind), L.ALPHA_CUT, aniso);
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
  const leafMaterial = (sp, kind, mid = false) => {
    const col = leafTint(sp);
    const m = new THREE.MeshPhysicalMaterial({ specularIntensity: L.SPECULAR, map: (mid ? leafTexesMid : leafTexes)[kind], color: col, vertexColors: true, side: THREE.DoubleSide, alphaTest: L.ALPHA_CUT, alphaToCoverage: msaa, roughness: L.LEAF_ROUGHNESS, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      fadeShader(sh, false, mid ? 'vMapUv * 512.0' : 'vMapUv * 512.0', mid ? [-99, -98] : undefined);
      // the cards' normals are the crown's own (outward + up): do not flip them on the back face
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    };
    m.customProgramCacheKey = () => 'v2-treecard' + msaa + mid; return m;
  };
  const trunkMaterial = (sp) => {
    const m = new THREE.MeshPhysicalMaterial({ specularIntensity: L.SPECULAR, color: new THREE.Color(manifest.species[sp].trunk).multiplyScalar(L.TRUNK_GAIN), roughness: 1, metalness: 0, alphaToCoverage: msaa });
    m.onBeforeCompile = (sh) => fadeShader(sh, false);
    m.customProgramCacheKey = () => 'v2-treetrunk' + msaa; return m;
  };

  // impostor quad + material
  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const EL = manifest.el, AZ = manifest.az, VFAR = L.FAR_VARIANTS, ROWS = VFAR * EL.length;
  const impostorMaterial = (sp, atlas) => {
    const U = { uAtlas: { value: atlas }, uUpN: { value: L.IMPOSTOR_UP_NORMAL }, uEl: { value: new Float32Array(EL.map((e) => e * Math.PI / 180)) } };
    const m = new THREE.MeshPhysicalMaterial({ specularIntensity: L.SPECULAR, color: leafTint(sp), roughness: L.LEAF_ROUGHNESS, metalness: 0, alphaTest: L.ALPHA_CUT, alphaToCoverage: msaa });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 aImp; varying float vFadeV; varying vec3 vToCam; varying vec2 vQ; varying float vVar; uniform float uUpN;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFadeV = aImp.x; vVar = aImp.y; vQ = position.xy * 0.5 + 0.5;
        { vec3 cw = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xyz; vec3 tc = cameraPosition - cw; float az = atan(tc.x, tc.z) - aImp.z;
          float el = asin(clamp(tc.y / max(length(tc), 1e-3), -1., 1.)); vToCam = vec3(az, el, 0.); }`)
        .replace('#include <defaultnormal_vertex>', `vec3 transformedNormal = normalize(mix(vec3(0.,0.,1.), normalize(mat3(viewMatrix) * vec3(0.,1.,0.)), uUpN));`)
        .replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.);
        mvPosition.xy += position.xy * length(instanceMatrix[0].xyz); gl_Position = projectionMatrix * mvPosition;`);
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
          vec4 c00 = cell(a0, e0, dx, dy), c10 = cell(a0 + 1.0, e0, dx, dy), c01 = cell(a0, e0 + 1.0, dx, dy), c11 = cell(a0 + 1.0, e0 + 1.0, dx, dy);
          vec4 sampledDiffuseColor = mix(mix(c00, c10, ta), mix(c01, c11, ta), te);
          diffuseColor *= sampledDiffuseColor;
        }`)
        .replace('#include <alphatest_fragment>', alphaChunk('vQ * 96.0', L.ALPHA_LOD_FAR));
    };
    m.customProgramCacheKey = () => 'v2-treeimp' + msaa; return m;
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
    const leafM = leafMaterial(sp, info.leafCard), leafMMid = leafMaterial(sp, info.leafCard, true), trunkM = trunkMaterial(sp);
    buckets[si] = info.variants.map((vinfo, vi) => {
      const c = vinfo.centre, cap = capVar[si][vi];
      const prep = (o, leaf) => {
        const geo = o.geometry.clone();     // clone: each InstancedMesh gets its own instanced fade attribute
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
      const mk = (leafName, trunkName, lm) => ({ leaf: mkInst(prep(byName[`v${vi}_${leafName}`], true), lm, cap, 'aFade'), trunk: mkInst(prep(byName[`v${vi}_${trunkName}`], false), trunkM, cap, 'aFade') });
      return { near: mk('leaves_near', 'trunk', leafM), mid: mk('leaves_mid', 'trunk_mid', leafMMid), info: vinfo };
    });
    // far: the atlas
    const atlasImg = await imageOf(DATA + info.atlas);
    const at = new THREE.Texture(atlasImg); at.colorSpace = THREE.SRGBColorSpace; at.generateMipmaps = true; at.minFilter = THREE.LinearMipmapLinearFilter; at.magFilter = THREE.LinearFilter; at.anisotropy = aniso; at.flipY = true; at.needsUpdate = true;
    const imp = new THREE.InstancedMesh(quad.clone(), impostorMaterial(sp, at), Math.max(1, capSp[si]));
    imp.count = 0; imp.frustumCulled = false; imp.castShadow = false; imp.receiveShadow = false; imp.visible = false; imp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
  function update(camera) {
    const t0 = performance.now();
    camera.updateMatrixWorld();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm, camera.coordinateSystem, camera.reversedDepth);
    const cp = camera.position;
    for (const vs of buckets) for (const b of vs) { b.near.leaf.count = b.near.trunk.count = b.mid.leaf.count = b.mid.trunk.count = 0; }
    for (const f of far) f.count = 0;
    let nN = 0, nM = 0, nF = 0;
    const cx = cp.x, cy = cp.y, cz = cp.z;
    for (let i = 0; i < N; i++) {
      const h = H[i], x = X[i], z = Z[i];
      const dx = x - cx, dz = z - cz, dy = h * 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rad = Math.max(R[i] * 1.4, h * 0.6) + d * L.FRUSTUM_MARGIN;
      let out = false;
      for (let p = 0; p < 6; p++) { const pl = planes[p]; if (pl.normal.x * x + pl.normal.y * h * 0.5 + pl.normal.z * z + pl.constant < -rad) { out = true; break; } }
      if (out) continue;
      const a = d <= D1 - W1 ? 0 : (d >= D1 + W1 ? 1 : smooth(D1 - W1, D1 + W1, d));
      const b = d <= D2 - W2 ? 0 : (d >= D2 + W2 ? 1 : smooth(D2 - W2, D2 + W2, d));
      const fn = 1 - a, fm = a * (1 - b), ff = b;
      const si = SP[i], vi = VAR[i], yaw = YAW[i], c = Math.cos(yaw), s = Math.sin(yaw);
      const info = buckets[si][vi].info, kx = Math.min(L.CROWN_STRETCH[1], Math.max(L.CROWN_STRETCH[0], R[i] / (h * info.crownR))), shade = 1 + (V[i] - 0.5) * 2 * JIT;
      if (fn > 0.004 || fm > 0.004) {
        const bk = buckets[si][vi];
        if (fn > 0.004) {
          const j = nearN[si][vi]++, ml = bk.near.leaf, mt = bk.near.trunk;
          writeM(ml.instanceMatrix.array, j * 16, x, 0, z, c, s, h * kx, h, h * kx); writeM(mt.instanceMatrix.array, j * 16, x, 0, z, c, s, h * kx, h, h * kx);
          ml.fadeAttr.array[j] = mt.fadeAttr.array[j] = fn;
          ml.instanceColor.array[j * 3] = ml.instanceColor.array[j * 3 + 1] = ml.instanceColor.array[j * 3 + 2] = mt.instanceColor.array[j * 3] = mt.instanceColor.array[j * 3 + 1] = mt.instanceColor.array[j * 3 + 2] = shade;
          nN++;
        }
        if (fm > 0.004) {
          const j = midN[si][vi]++, ml = bk.mid.leaf, mt = bk.mid.trunk;
          writeM(ml.instanceMatrix.array, j * 16, x, 0, z, c, s, h * kx, h, h * kx); writeM(mt.instanceMatrix.array, j * 16, x, 0, z, c, s, h * kx, h, h * kx);
          ml.fadeAttr.array[j] = mt.fadeAttr.array[j] = fm;
          ml.instanceColor.array[j * 3] = ml.instanceColor.array[j * 3 + 1] = ml.instanceColor.array[j * 3 + 2] = mt.instanceColor.array[j * 3] = mt.instanceColor.array[j * 3 + 1] = mt.instanceColor.array[j * 3 + 2] = shade;
          nM++;
        }
      }
      if (ff > 0.004) {
        const f = far[si], j = farN[si]++, sz = info.rs * 1.03 * h * (1 + kx) * 0.5;
        writeM(f.instanceMatrix.array, j * 16, x, info.centre[1] * h, z, 1, 0, sz, sz, sz);
        const ia = f.impAttr.array; ia[j * 4] = ff; ia[j * 4 + 1] = vi % VFAR; ia[j * 4 + 2] = yaw; ia[j * 4 + 3] = 0;
        f.instanceColor.array[j * 3] = f.instanceColor.array[j * 3 + 1] = f.instanceColor.array[j * 3 + 2] = shade;
        nF++;
      }
    }
    for (let si = 0; si < buckets.length; si++) {
      for (let vi = 0; vi < buckets[si].length; vi++) {
        const bk = buckets[si][vi];
        for (const [meshes, cnt] of [[bk.near, nearN[si][vi]], [bk.mid, midN[si][vi]]]) {
          for (const m of [meshes.leaf, meshes.trunk]) { m.count = cnt; m.visible = cnt > 0; if (cnt) { up(m.instanceMatrix, cnt); up(m.instanceColor, cnt); up(m.fadeAttr, cnt); } }
        }
        nearN[si][vi] = 0; midN[si][vi] = 0;
      }
      const f = far[si]; f.count = farN[si]; f.visible = f.count > 0; if (f.count) { up(f.instanceMatrix, f.count); up(f.instanceColor, f.count); up(f.impAttr, f.count); } farN[si] = 0;
    }
    stats.near = nN; stats.mid = nM; stats.far = nF; stats.updates++; stats.ms = performance.now() - t0;
  }
  // the ticker: an invisible one-triangle mesh drawn first; its onBeforeRender runs the update with the camera that is drawing
  const ticker = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.001, 0, 0.001, 0, 0], 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false; ticker.renderOrder = -1e6; ticker.name = 'tree ticker';
  let lastKey = '';
  ticker.onBeforeRender = (r, sc, camera) => {
    const e = camera.matrixWorld.elements, key = e[12].toFixed(2) + e[13].toFixed(2) + e[14].toFixed(2) + e[0].toFixed(4) + e[2].toFixed(4) + e[6].toFixed(4) + camera.fov + camera.aspect;
    if (key === lastKey && !dirty) return;
    lastKey = key; dirty = false; update(camera);
  };
  group.add(ticker);
  Object.assign(stats, { ready: true, species: speciesNames, bands: { D1, W1, D2, W2 } });
  window.__v2treesReal = { stats: () => ({ ...stats }), update, root, proxy, buckets, far, force: () => { dirty = true; } };
  redraw();
  return window.__v2treesReal;
}
