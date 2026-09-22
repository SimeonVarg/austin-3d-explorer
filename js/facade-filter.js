/** Experimental, area-filtered facade colours derived from authored cells. */
(function () {
  'use strict';

  const tune = { texelMetres: 0.25, maxDimension: 512, anisotropy: 4,
    maxBytes: 16 * 1024 * 1024, coverageTolerance: 0.002 };
  const live = new Set();
  const batches = new WeakMap();
  let liveBytes = 0;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function dimensions(len, height, options) {
    // The experimental path has a hard allocation ceiling even if a caller
    // supplies an accidentally unbounded texture dimension.
    const cap = 2 ** Math.floor(Math.log2(Math.min(512, options.maxDimension)));
    if (!(len > 0 && height > 0 && options.texelMetres > 0 && cap >= 1) ||
        !Number.isFinite(len + height + options.texelMetres + cap)) return null;
    const level = options.resolutionLevel ?? 0;
    if (!Number.isInteger(level) || level < 0 || level > 9) return null;
    const size = m => Math.max(1, Math.min(cap,
      2 ** Math.ceil(Math.log2(Math.max(1, m / options.texelMetres)))) / 2 ** level);
    return { width: size(len), height: size(height) };
  }
  function textureBytes(width, height) {
    let bytes = 0;
    while (true) {
      bytes += width * height * 4 * 3;
      if (width === 1 && height === 1) return bytes;
      width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
    }
  }
  function rgb(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Plan the whole candidate set before allocating any textures. Every face
   * gets the same additional downsample level, independent of input order.
   * Each level halves both POT axes (minimum 1); area integration still uses
   * the original rectangles. This is opt-in: existing createFace is unchanged.
   * The plan does not reserve memory; consume it synchronously before other
   * allocations. Existing live arrays retain their full budget charge.
   */
  function planFaces({ faces, options = {} }) {
    const config = Object.assign({}, tune, options);
    if (!Array.isArray(faces) || !Number.isFinite(config.maxBytes) || config.maxBytes < 0) return null;
    const availableBytes = config.maxBytes - liveBytes;
    if (availableBytes < faces.length * 12) return null;
    const configs = faces.map(face => Object.assign({}, config, face?.options,
      { maxBytes: config.maxBytes }));
    if (faces.some((face, i) => !face || !Number.isFinite(face.z0 + face.z1) ||
        !dimensions(face.len, face.z1 - face.z0, configs[i]))) return null;
    for (let resolutionLevel = 0; resolutionLevel <= 9; resolutionLevel++) {
      const planned = faces.map((face, i) => {
        const selected = Object.assign({}, configs[i], {
          resolutionLevel: Math.min(9, (configs[i].resolutionLevel ?? 0) + resolutionLevel)
        });
        const dim = dimensions(face.len, face.z1 - face.z0, selected);
        return { face, ...dim, bytes: textureBytes(dim.width, dim.height), options: selected };
      });
      const bytes = planned.reduce((sum, entry) => sum + entry.bytes, 0);
      if (bytes <= availableBytes) return { faces: planned, bytes, availableBytes, resolutionLevel };
    }
    return null;
  }

  /** Rectangles must partition the face. No geometry, lighting or camera state.
   * Rows run from z0 upward; texture UV = (s / len, (z - z0) / (z1 - z0)).
   * Each rect is [s0,s1,z0,z1,colourTriple]; colourTriple.surface is optional.
   * Fractional texels integrate exact rectangle overlap, avoiding canvas gaps.
   */
  function rasterizeFace({ rects, len, z0, z1, options = {} }) {
    const config = Object.assign({}, tune, options);
    const dim = dimensions(len, z1 - z0, config);
    if (!dim || !Number.isFinite(z0 + z1) || !Array.isArray(rects) || !rects.length ||
        !Number.isFinite(config.coverageTolerance) || config.coverageTolerance < 0 ||
        config.coverageTolerance >= 1) return null;
    const { width, height } = dim, pixels = width * height;
    // 9 colour channels, response, glass coverage, geometric coverage.
    const sums = new Float32Array(pixels * 12);
    const sx = width / len, sy = height / (z1 - z0);
    const palette = new Map();
    for (const rect of rects) {
      if (!Array.isArray(rect) || rect.length < 5) return null;
      const [sa, sb, za, zb, col] = rect;
      if (![sa, sb, za, zb].every(Number.isFinite) || sb <= sa || zb <= za || !col) return null;
      let values = palette.get(col);
      if (!values) {
        const colours = [rgb(col[0]), rgb(col[1]), rgb(col[2])];
        if (colours.some(c => !c)) return null;
        const kind = col.surface?.[0], glass = kind === 4 || kind === 6 ? 1 : 0;
        const response = kind === 6 ? 1 : kind === 4 ? clamp(col.surface[3] ?? 1, 0, 1) : 0;
        if (!Number.isFinite(response)) return null;
        values = [...colours[0], ...colours[1], ...colours[2], response * 255, glass * 255, 1];
        palette.set(col, values);
      }
      const x0 = clamp(sa * sx, 0, width), x1 = clamp(sb * sx, 0, width);
      const y0 = clamp((za - z0) * sy, 0, height), y1 = clamp((zb - z0) * sy, 0, height);
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const dy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const area = dy * (Math.min(x + 1, x1) - Math.max(x, x0));
          if (area <= 0) continue;
          const at = (y * width + x) * 12;
          for (let k = 0; k < 12; k++) sums[at + k] += values[k] * area;
        }
      }
    }
    const day = new Uint8Array(pixels * 4), gold = new Uint8Array(pixels * 4), night = new Uint8Array(pixels * 4);
    let coverageError = 0;
    for (let i = 0; i < pixels; i++) {
      const at = i * 12, out = i * 4, coverage = sums[at + 11];
      coverageError = Math.max(coverageError, Math.abs(coverage - 1));
      // Clipped/arched or overlapping faces need their real geometry instead.
      if (Math.abs(coverage - 1) > config.coverageTolerance) return null;
      for (let k = 0; k < 3; k++) {
        day[out + k] = Math.round(sums[at + k] / coverage);
        gold[out + k] = Math.round(sums[at + 3 + k] / coverage);
        night[out + k] = Math.round(sums[at + 6 + k] / coverage);
      }
      day[out + 3] = Math.round(sums[at + 9] / coverage);
      gold[out + 3] = Math.round(sums[at + 10] / coverage);
    }
    return { width, height, day, gold, night, coverageError, rectangleCount: rects.length,
      bytes: textureBytes(width, height) };
  }

  /** A bounded texture allocation only; callers own proxy geometry/materials. */
  function createFace({ THREE, W, len, z0, z1, rects, options = {} }) {
    const config = Object.assign({}, tune, options), dim = dimensions(len, z1 - z0, config);
    if (!THREE || !dim) return null;
    const bytes = textureBytes(dim.width, dim.height);
    if (!Number.isFinite(config.maxBytes) || config.maxBytes < 0 || liveBytes + bytes > config.maxBytes) return null;
    const data = rasterizeFace({ rects, len, z0, z1, options });
    if (!data) return null;
    const textures = {};
    try {
      for (const name of ['day', 'gold', 'night']) {
        const texture = new THREE.DataTexture(data[name], data.width, data.height, THREE.RGBAFormat, THREE.UnsignedByteType);
        textures[name] = texture;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.generateMipmaps = true;
        texture.flipY = false;
        texture.anisotropy = config.anisotropy;
        // Numeric hex channels match existing vertex colours, not sRGB decode.
        if ('colorSpace' in texture && THREE.NoColorSpace !== undefined) texture.colorSpace = THREE.NoColorSpace;
        else if (THREE.LinearEncoding !== undefined) texture.encoding = THREE.LinearEncoding;
        texture.needsUpdate = true;
      }
    } catch (error) {
      Object.values(textures).forEach(texture => texture.dispose());
      throw error;
    }
    const face = { W, len, z0, z1, data, textures, bytes, dispose() {
      if (batches.has(face)) { batches.get(face).release(face); return; }
      if (!live.delete(face)) return;
      Object.values(textures).forEach(texture => texture.dispose());
      liveBytes -= bytes;
    } };
    live.add(face); liveBytes += bytes;
    return face;
  }
  /** Pack live faces into independent texture-array layers, bucketed by size.
   * Call before rendering the new group. Array allocation is transactional:
   * failure preserves the original faces/textures. Layer order follows input.
   * The caller must replace old per-face materials with an array-sampler
   * material and merge geometry with the corresponding layer attribute.
   */
  function createBatch({ THREE, faces }) {
    if (!THREE?.DataArrayTexture) throw new Error('Facade arrays require DataArrayTexture');
    if (!Array.isArray(faces) || new Set(faces).size !== faces.length ||
        faces.some(face => !live.has(face) || batches.has(face))) {
      throw new Error('Facade batch requires distinct, live, unbatched faces');
    }
    const buckets = new Map(), groups = [];
    for (const face of faces) {
      const key = face.data.width + 'x' + face.data.height;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(face);
    }
    try {
      for (const bucket of buckets.values()) {
        // WebGL2 guarantees at least 256 array layers.
        for (let start = 0; start < bucket.length; start += 256) {
          const members = bucket.slice(start, start + 256);
          const { width, height } = members[0].data;
          const group = { faces: members, width, height, textures: {},
            bytes: members.reduce((sum, face) => sum + face.bytes, 0) };
          groups.push(group);
          for (const name of ['day', 'gold', 'night']) {
            const layerSize = width * height * 4;
            const packed = new Uint8Array(layerSize * members.length);
            members.forEach((face, layer) => packed.set(face.data[name], layer * layerSize));
            const texture = new THREE.DataArrayTexture(packed, width, height, members.length);
            group.textures[name] = texture;
            const original = members[0].textures[name];
            texture.format = THREE.RGBAFormat; texture.type = THREE.UnsignedByteType;
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.generateMipmaps = true; texture.flipY = false;
            texture.anisotropy = original.anisotropy;
            if ('colorSpace' in texture && THREE.NoColorSpace !== undefined) texture.colorSpace = THREE.NoColorSpace;
            else if (THREE.LinearEncoding !== undefined) texture.encoding = THREE.LinearEncoding;
            texture.needsUpdate = true;
          }
        }
      }
    } catch (error) {
      for (const group of groups) Object.values(group.textures).forEach(texture => texture.dispose());
      throw error;
    }
    for (const group of groups) {
      const remaining = new Set(group.faces);
      const release = face => {
        if (!remaining.delete(face)) return;
        live.delete(face); batches.delete(face);
        // An array cannot release individual layers. Keep its entire byte
        // charge until the final layer is released, even after partial drops.
        if (!remaining.size) {
          Object.values(group.textures).forEach(texture => texture.dispose());
          liveBytes -= group.bytes;
        }
      };
      group.dispose = () => { for (const face of [...remaining]) release(face); };
      group.faces.forEach((face, layer) => {
        const oldTextures = face.textures, layerSize = group.width * group.height * 4;
        face.textures = group.textures;
        for (const name of ['day', 'gold', 'night']) {
          face.data[name] = group.textures[name].image.data.subarray(layer * layerSize, (layer + 1) * layerSize);
        }
        batches.set(face, { release });
        Object.values(oldTextures).forEach(texture => {
          texture.dispose();
          // createFace's disposal closure retains these texture objects. Drop
          // their obsolete CPU buffers after ownership moved to packed views.
          texture.image.data = null;
        });
      });
    }
    return groups;
  }
  function reset() { for (const face of [...live]) face.dispose(); }
  window.FacadeFilter = { tune, planFaces, rasterizeFace, createFace, createBatch, reset,
    get bytes() { return liveBytes; }, get count() { return live.size; } };
}());
