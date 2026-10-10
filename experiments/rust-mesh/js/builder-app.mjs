// The JS builder exactly as it ships: build() is cut out of js/slopes.js at load time (not retyped), so
// this twin cannot drift from the app. It is driven from a recorded stream the way the generator drives it:
// one fresh [x,y,z] array per point, per call.
import { REC } from './common.mjs';
const assert = { ok(c, m) { if (!c) throw new Error(m); } };   // no node:assert, so the same file runs in a browser

class BufferAttribute { constructor(array, itemSize, normalized = false) { Object.assign(this, { array, itemSize, normalized, count: array.length / itemSize }); } }
class BufferGeometry {
  attributes = {}; userData = {};
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  setIndex(i) { this.index = i; return this; }
  computeBoundingSphere() {}   // three's Box3 loop: not part of the builder, left out of every variant
}
// three.js, reduced to what the builder touches. polygon() needs ShapeUtils.triangulateShape: a fan is enough here because BOTH
// builders get the same triangulation (the point of the test is the vertex store, not earcut).
class Vector2 { constructor(x, y) { this.x = x; this.y = y; } }
export const THREE_STUB = { BufferAttribute, BufferGeometry, Vector2, ShapeUtils: { triangulateShape(pts) { const out = []; for (let i = 1; i + 1 < pts.length; i++) out.push([0, i, i + 1]); return out; } } };
const hexToRgb01 = hex => { const h = String(hex).replace('#', ''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; };
export { hexToRgb01 };
/** the text of js/slopes.js from shapeOps() to the end of build(), or throw if it moved */
function cut(slopesSource) {
  const source = slopesSource.replaceAll('\r\n', '\n');
  const a = source.indexOf('  function shapeOps('), b = source.indexOf('\n  /**\n   * A wall frame', a);
  assert.ok(a >= 0 && b > a, 'js/slopes.js moved: shapeOps()/build() markers');
  return source.slice(a, b);
}
/** `slopesSource` is the text of js/slopes.js (the caller reads or fetches it). Returns the app's own build(initialCapacity, opts). */
export function makeBuild(slopesSource) {
  // `_rustBuild` is a closure variable of the page's IIFE; here it is null, so build() is always the JS vertex store
  return new Function('window', 'hexToRgb01', '_rustBuild', cut(slopesSource) + '\nreturn build;')({ THREE: THREE_STUB }, hexToRgb01, null);
}
/** the app's own shapeOps(tri, triN, quad) -> { polygon, extrude }, for the Rust adapter to be handed exactly as the page hands it */
export function makeShapeOps(slopesSource) {
  return new Function('window', 'hexToRgb01', '_rustBuild', cut(slopesSource) + '\nreturn shapeOps;')({ THREE: THREE_STUB }, hexToRgb01, null);
}

/** palette ids -> the [day, golden, night] arrays (with .surface) the generator hands to the builder */
export function toneObjects(palette) {
  return palette.map(p => { const c = p.hex.slice(); if (p.surface) c.surface = p.surface; return c; });
}

export function runApp(build, tones, stream, records, initialCapacity) {
  const B = build(initialCapacity);
  for (let i = 0, o = 0; i < records; i++, o += REC) {
    const op = stream[o];
    if (op === 3) { B.facet(stream[o + 27] !== 0); continue; }
    const col = tones[stream[o + 1]];
    if (op === 0) {
      B.tri([stream[o + 6], stream[o + 7], stream[o + 8]], [stream[o + 9], stream[o + 10], stream[o + 11]], [stream[o + 12], stream[o + 13], stream[o + 14]], col,
        stream[o + 2] ? [stream[o + 3], stream[o + 4], stream[o + 5]] : undefined);
    } else if (op === 1) {
      B.quad([stream[o + 6], stream[o + 7], stream[o + 8]], [stream[o + 9], stream[o + 10], stream[o + 11]], [stream[o + 12], stream[o + 13], stream[o + 14]], [stream[o + 15], stream[o + 16], stream[o + 17]], col,
        stream[o + 2] ? [stream[o + 3], stream[o + 4], stream[o + 5]] : undefined);
    } else {
      B.triN([stream[o + 6], stream[o + 7], stream[o + 8]], [stream[o + 9], stream[o + 10], stream[o + 11]], [stream[o + 12], stream[o + 13], stream[o + 14]],
        [stream[o + 18], stream[o + 19], stream[o + 20]], [stream[o + 21], stream[o + 22], stream[o + 23]], [stream[o + 24], stream[o + 25], stream[o + 26]], col);
    }
  }
  const g = B.geometry();
  return { position: g.attributes.position.array, normal: g.attributes.normal.array, cDay: g.attributes.cDay.array, cGold: g.attributes.cGold.array, cNight: g.attributes.cNight.array,
    aFacet: g.attributes.aFacet.array, aSurface: g.attributes.aSurface.array, index: g.index.array, triangles: B.triangles };
}

/** the cost of just making the per-call arrays (no builder), so it can be reported and subtracted */
export function materializeOnly(stream, records) {
  let acc = 0;
  for (let i = 0, o = 0; i < records; i++, o += REC) {
    const a = [stream[o + 6], stream[o + 7], stream[o + 8]], b = [stream[o + 9], stream[o + 10], stream[o + 11]], c = [stream[o + 12], stream[o + 13], stream[o + 14]], d = [stream[o + 15], stream[o + 16], stream[o + 17]];
    const w = stream[o + 2] ? [stream[o + 3], stream[o + 4], stream[o + 5]] : undefined;
    acc += a[0] + b[1] + c[2] + d[0] + (w ? w[1] : 0);
  }
  return acc;
}
