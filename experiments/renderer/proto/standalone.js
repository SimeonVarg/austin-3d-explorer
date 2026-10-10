/**
 * proto/standalone.js - the prototype with NO MapLibre and NO three.js on the page.
 * Loads the packed buildings, builds the renderer, and exposes window.__proto for the harness:
 *   __proto.ready            promise: resolves with the timeline when the first frame is out
 *   __proto.drawFrame(f)     draw one frame { matrix: [16], u: {...uniforms}, size: [w, h] }
 * Query: ?data=<url prefix of the packed pair>  &break=light|quant|facet  &multidraw=0
 */
import { loadPacked, loadPackedMeshopt, createRenderer } from './renderer.js';

const q = new URLSearchParams(location.search);
const T = { scriptStart: performance.now() };
const canvas = document.getElementById('c');
const BREAK = q.get('break') || '';
let renderer = null, packed = null, gl = null;

function breakData(p) {
  if (BREAK === 'quant') {                    // drop the low 10 bits of every int16 position: ~3% of the range
    const v = new Int16Array(p.vertices.buffer, p.vertices.byteOffset, p.vertices.byteLength >> 1);
    for (let i = 0; i < v.length; i += p.meta.stride / 2) { v[i] &= ~0x3ff; v[i + 1] &= ~0x3ff; v[i + 2] &= ~0x3ff; }
  }
}
function breakFrame(f) {
  const u = { ...f.u };
  if (BREAK === 'light') u.u_lightpos = [-u.u_lightpos[0], -u.u_lightpos[1], u.u_lightpos[2]];   // the sun on the wrong side
  if (BREAK === 'facet') u.u_facet_on = 0;                                                          // a feature silently dropped
  return { ...f, u };
}

window.__proto = {
  timeline: T,
  async init(size, aa) {
    canvas.width = size[0]; canvas.height = size[1];
    gl = canvas.getContext('webgl2', { antialias: !!aa, depth: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    T.contextReady = performance.now();
    const base = q.get('data') || '/data/apartments.packed';
    packed = q.get('format') === 'meshopt' ? await loadPackedMeshopt(base, '/exp/node_modules/meshoptimizer/meshopt_decoder.module.js') : await loadPacked(base);
    T.fetched = performance.now(); T.fetch = packed.timings;
    breakData(packed);
    renderer = createRenderer(gl, packed, { multiDraw: q.get('multidraw') !== '0' });
    gl.finish(); T.uploaded = performance.now();
    return T;
  },
  drawFrame(f) {
    if (!renderer) throw new Error('init first');
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1, 0, 1, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const t = performance.now();
    const s = renderer.draw(breakFrame({ matrix: Float32Array.from(f.matrix), u: f.u }));
    if (T.firstDrawn == null) { T.firstDrawn = performance.now(); gl.finish(); T.firstFinished = performance.now(); }
    return { ...s, submitMs: performance.now() - t };
  },
  get renderer() { return renderer; },
  get info() { return renderer ? { bytes: renderer.bytes, glRenderer: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() } : null; },
};
