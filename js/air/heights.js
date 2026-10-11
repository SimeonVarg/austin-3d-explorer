/**
 * heights.js — the height raster the soft floor and the gate tests read.
 *
 * `data/air/heights.u8` (scripts/air/bake-heights.mjs): one byte per 4 m cell,
 * top of the tallest solid there in 1.25 m steps, rounded UP. This class is the
 * same code in the page and in node, so a test that says "the craft feels a
 * roof here" is talking about the roof the page feels.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AirHeights = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  class HeightField {
    constructor(meta, bytes) {
      this.x0 = meta.x0; this.y0 = meta.y0; this.cell = meta.cell; this.nx = meta.nx; this.ny = meta.ny;
      this.unit = meta.unit; this.cells = bytes;
    }
    /** Height (m) of the cell holding (x, y); 0 outside the raster. */
    at(x, y) {
      const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((y - this.y0) / this.cell);
      if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return 0;
      return this.cells[j * this.nx + i] * this.unit;
    }
    /** Tallest solid within r metres (cell squares touched by the disc). */
    maxHeight(x, y, r) {
      const c = this.cell;
      const i0 = Math.floor((x - r - this.x0) / c), i1 = Math.floor((x + r - this.x0) / c);
      const j0 = Math.floor((y - r - this.y0) / c), j1 = Math.floor((y + r - this.y0) / c);
      let best = 0;
      for (let j = Math.max(0, j0); j <= Math.min(this.ny - 1, j1); j++) {
        const cy0 = this.y0 + j * c, dy = y < cy0 ? cy0 - y : y > cy0 + c ? y - cy0 - c : 0;
        for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
          const v = this.cells[j * this.nx + i]; if (v <= best / this.unit) continue;
          const cx0 = this.x0 + i * c, dx = x < cx0 ? cx0 - x : x > cx0 + c ? x - cx0 - c : 0;
          if (dx * dx + dy * dy <= r * r) best = v * this.unit;
        }
      }
      return best;
    }
    /** Shortest 3D distance from a point to any solid column (cells are treated as boxes 0..H). */
    clearance(x, y, z, limit) {
      const c = this.cell, r = limit;
      const i0 = Math.floor((x - r - this.x0) / c), i1 = Math.floor((x + r - this.x0) / c);
      const j0 = Math.floor((y - r - this.y0) / c), j1 = Math.floor((y + r - this.y0) / c);
      let best = limit;
      for (let j = Math.max(0, j0); j <= Math.min(this.ny - 1, j1); j++) {
        const cy0 = this.y0 + j * c, dy = y < cy0 ? cy0 - y : y > cy0 + c ? y - cy0 - c : 0;
        for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
          const v = this.cells[j * this.nx + i]; if (!v) continue;
          const cx0 = this.x0 + i * c, dx = x < cx0 ? cx0 - x : x > cx0 + c ? x - cx0 - c : 0;
          const dz = Math.max(0, z - v * this.unit), d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < best) best = d;
        }
      }
      return best;
    }
  }
  /** Browser: fetch + build. Node callers build from fs themselves. */
  async function load(base) {
    const [m, b] = await Promise.all([fetch(base + 'heights.json').then(r => r.json()), fetch(base + 'heights.u8').then(r => r.arrayBuffer())]);
    return new HeightField(m, new Uint8Array(b));
  }
  return { HeightField, load };
});
