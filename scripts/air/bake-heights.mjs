/**
 * bake-heights.mjs — the sky race's height raster: for every 4 m cell of the
 * course corridor, the top of the tallest solid (rounded UP to 1.25 m, so the
 * raster can only be stricter than the data). One byte a cell.
 *
 *   node scripts/air/bake-heights.mjs          writes data/air/heights.u8 + heights.json
 *   node scripts/air/bake-heights.mjs --check  re-bakes in memory and compares with the files on disk
 *
 * The game reads it for the soft floor; the placement script and the tests read
 * it to prove every ring is in clear air. It is the SAME file in all three
 * places, so "the test passed" and "the craft felt a roof" cannot disagree.
 * A map update that moves a building is picked up by re-running this (bake step
 * only; the page itself has no copy of the city's data).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadObstacles, bbox, inRings, REPO } from './lib/obstacles.mjs';
const require = createRequire(import.meta.url);
const G = require('../../js/air/geo.js');

export const GRID = {
  // the course corridor: lng -97.7545..-97.7295, lat 30.2565..30.2975
  lng: [-97.7545, -97.7295], lat: [30.2565, 30.2975], cell: 4, unit: 1.25,
};

export function bake() {
  const a = G.toLocal(GRID.lng[0], GRID.lat[0]), b = G.toLocal(GRID.lng[1], GRID.lat[1]);
  const x0 = Math.floor(a.x / GRID.cell) * GRID.cell, y0 = Math.floor(a.y / GRID.cell) * GRID.cell;
  const nx = Math.ceil((b.x - x0) / GRID.cell), ny = Math.ceil((b.y - y0) / GRID.cell);
  const cells = new Uint8Array(nx * ny);
  const { obstacles, counts } = loadObstacles();
  const stamp = (i, j, top) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    const v = Math.min(255, Math.ceil(top / GRID.unit));
    const k = j * nx + i; if (v > cells[k]) cells[k] = v;
  };
  for (const o of obstacles) {
    const [bx0, by0, bx1, by1] = bbox(o.rings);
    if (bx1 < x0 || bx0 > x0 + nx * GRID.cell || by1 < y0 || by0 > y0 + ny * GRID.cell) continue;
    const i0 = Math.floor((bx0 - x0) / GRID.cell), i1 = Math.floor((bx1 - x0) / GRID.cell);
    const j0 = Math.floor((by0 - y0) / GRID.cell), j1 = Math.floor((by1 - y0) / GRID.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // a cell is solid if its centre is inside, or any corner is: conservative on the edge
      const cx = x0 + (i + 0.5) * GRID.cell, cy = y0 + (j + 0.5) * GRID.cell, h = GRID.cell / 2;
      if (inRings(o.rings, cx, cy) || inRings(o.rings, cx - h, cy - h) || inRings(o.rings, cx + h, cy - h) ||
          inRings(o.rings, cx - h, cy + h) || inRings(o.rings, cx + h, cy + h)) stamp(i, j, o.top);
    }
    // thin parts that miss every cell centre and corner: mark the cells their edges cross
    for (const r of o.rings) for (let k = 0; k < r.length - 1; k++) {
      const p = r[k], q = r[k + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 1.5));
      for (let s = 0; s <= n; s++) {
        const x = p[0] + (q[0] - p[0]) * s / n, y = p[1] + (q[1] - p[1]) * s / n;
        stamp(Math.floor((x - x0) / GRID.cell), Math.floor((y - y0) / GRID.cell), o.top);
      }
    }
  }
  const meta = { version: 1, x0, y0, cell: GRID.cell, nx, ny, unit: GRID.unit, origin: require('../../js/air/params.js').origin,
                 note: 'u8 cells, row 0 = south, col 0 = west; metres = value * unit (rounded up). Baked by scripts/air/bake-heights.mjs.',
                 sources: counts };
  return { cells, meta };
}

const here = new URL(import.meta.url).pathname;
if (process.argv[1] === here) {
  const { cells, meta } = bake();
  const dir = path.join(REPO, 'data/air');
  fs.mkdirSync(dir, { recursive: true });
  if (process.argv.includes('--check')) {
    const disk = fs.readFileSync(path.join(dir, 'heights.u8'));
    const same = disk.length === cells.length && Buffer.compare(disk, Buffer.from(cells)) === 0;
    console.log(same ? 'heights.u8 matches a fresh bake' : 'heights.u8 is STALE: re-run scripts/air/bake-heights.mjs');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(path.join(dir, 'heights.u8'), cells);
  fs.writeFileSync(path.join(dir, 'heights.json'), JSON.stringify(meta, null, 1) + '\n');
  let filled = 0, mx = 0; for (const v of cells) { if (v) filled++; if (v > mx) mx = v; }
  console.log(`baked ${meta.nx} x ${meta.ny} cells (${cells.length} bytes), ${filled} solid, tallest ${(mx * meta.unit).toFixed(1)} m`, meta.sources);
}
