// CPU-only byte contract for the paced facade repaint (js/facades.js, PACE).
// No browser, no server. The paint worker is assembled from js/facades.js's
// own function text exactly the way `pacePool` assembles it, run in a sandbox
// with the real js/pattern-lowpass.js, and its images must equal, byte for
// byte, what `tileData` makes on the main thread for the same drawing — for
// every tier, template and measured sizes, with and without mottle. Its
// premultiplied copies must equal MapLibre 5.24.0's own `El`.
// --break makes the worker blur one texel wider, --break-border switches off the
// wrap-border rewrite; either must exit 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../../js/facades.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const lowpass = fs.readFileSync(new URL('../../js/pattern-lowpass.js', import.meta.url), 'utf8');

/** The text of `function name(...) {...}` in facades.js, as toString() returns it. */
function fnText(name) {
  const at = src.indexOf('  function ' + name + '(');
  assert(at >= 0, name + ' exists in js/facades.js');
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at + 2, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
/** `const NAME = ...;` literal block (object or array), up to its closing `};`/`];`. */
function constText(name) {
  const at = src.indexOf('  const ' + name + ' = ');
  assert(at >= 0, name + ' exists');
  const open = at + ('  const ' + name + ' = ').length;
  const close = src[open] === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(at + 2, i + 2);
  }
  throw new Error('unbalanced ' + name);
}

// ── the main-thread path: tileData over a known drawing ────────────────
const SCALE = 2, TILE = 64, RES = TILE * SCALE;
const main = vm.createContext({ window: {} });
vm.runInContext(lowpass, main);
vm.runInContext([
  'const SCALE = ' + SCALE + ', RES = ' + RES + ';',
  constText('TIERS'), constText('SOFTEN'),
  'const tierRes = t => RES / t.div;',
  'let __mul = 1, __raw = null; const mulOf = () => __mul; const rawTile = () => __raw;',
  fnText('applyMottle'), fnText('decimate'), fnText('softenParams'), fnText('softenTile'), fnText('tileData'),
  'this.api = { TIERS, softenParams, applyMottle, tileData, set(m, r) { __mul = m; __raw = r; } };',
].join('\n'), main);
const M = main.api;

// ── the worker, assembled like pacePool assembles it ───────────────────
function makeWorker(extra) {
  // A worker's global object IS `self`, so the sandbox's global is too.
  const posted = [];
  const box = vm.createContext({ postMessage: (msg) => posted.push(msg) });
  box.self = box;
  box.importScripts = () => vm.runInContext(lowpass, box);
  const parts = [
    'self.window = self;',
    'importScripts("js/pattern-lowpass.js");',
    fnText('applyMottle'), fnText('decimate'),
    'const PM_LUT = (' + fnText('buildPremultiplyLut') + ')();',
    'const PM_LITTLE_ENDIAN = true;',
    fnText('premultiplyInto'),
    '(' + fnText('facadePaintWorkerMain') + ')();',
  ];
  // pacePool must still assemble the worker from exactly these pieces.
  for (const piece of ['applyMottle.toString()', 'decimate.toString()', 'buildPremultiplyLut.toString()',
    'premultiplyInto.toString()', 'facadePaintWorkerMain.toString()', "importScripts("]) {
    assert(fnText('pacePool').includes(piece), 'pacePool ships ' + piece);
  }
  vm.runInContext(parts.join('\n') + (extra || ''), box);
  return { send: (msg) => { box.onmessage({ data: msg }); return posted.pop(); } };
}
const BREAK = process.argv.includes('--break');
const worker = makeWorker(BREAK ? `
  { const real = self.PatternLowpass.blurWrap; self.PatternLowpass.blurWrap = (d, res, r, a) => real(d, res, r + 1, a); }` : '');

function El(t) { const e = new Uint8Array(t.length); for (let n = 0; n < t.length; n += 4) { const r = t[n + 3]; e[n] = Math.round(t[n] * r / 255); e[n + 1] = Math.round(t[n + 1] * r / 255); e[n + 2] = Math.round(t[n + 2] * r / 255); e[n + 3] = r; } return e; }

let seed = 7;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
function drawing(res) {
  const d = new Uint8ClampedArray(res * res * 4);
  for (let i = 0; i < d.length; i += 4) {
    const glass = rnd() < 0.3;
    d[i] = rnd() * 256; d[i + 1] = rnd() * 256; d[i + 2] = rnd() * 256;
    d[i + 3] = glass ? rnd() * 256 : (rnd() < 0.1 ? 0 : 255);
  }
  return d;
}
let cases = 0, tiersChecked = 0;
for (const fam of ['mh', 'tg', 'lo', 'dk', 'st', 'zz']) {
  for (const mul of [1, 4]) {
    for (const withMottle of [false, true]) {
      const RESF = RES * mul, T = TILE * mul, cellPx = 4;
      const cells = new Float32Array((T / cellPx) ** 2).map(() => (rnd() < 0.2 ? 0 : rnd() * 2 - 1));
      const mottle = withMottle ? { cells, amp: 0.037 + rnd() * 0.02, cellPx, T } : null;
      const drawn = drawing(RESF);
      // main thread: rawTile applies the mottle, tileData does the rest
      const mottled = drawn.slice();
      if (mottle) M.applyMottle(mottled, RESF, SCALE, mottle);
      M.set(mul, mottled);
      const want = M.TIERS.map(t => M.tileData(fam, 0, 0.3, t));
      // worker: the message paceDispatch sends
      const reply = worker.send({
        seq: 1, raw: drawn.slice().buffer, RESF, SCALE, mottle, pm: true,
        tiers: M.TIERS.map(t => { const sp = M.softenParams(fam, t); return { div: t.div, res: RES / t.div * mul, r: sp.r, a: sp.a }; }),
      });
      assert(!reply.error, 'worker error: ' + reply.error);
      assert.equal(reply.outs.length, want.length, 'one image per tier');
      for (let i = 0; i < want.length; i++) {
        const got = new Uint8Array(reply.outs[i]);
        assert.equal(got.length, want[i].data.length, `${fam} mul${mul} tier ${i} size`);
        assert(Buffer.compare(Buffer.from(got), Buffer.from(want[i].data)) === 0,
          `${fam} mul ${mul} mottle ${withMottle} tier ${i}: worker bytes differ from tileData`);
        assert(Buffer.compare(Buffer.from(new Uint8Array(reply.pms[i])), Buffer.from(El(got))) === 0,
          `${fam} mul ${mul} tier ${i}: worker premultiply differs from El`);
        tiersChecked++;
      }
      cases++;
    }
  }
}
// every (alpha, colour) pair through the worker's premultiply
{
  const raw = new Uint8ClampedArray(256 * 256 * 4);
  for (let a = 0; a < 256; a++) for (let c = 0; c < 256; c++) raw.set([c, 255 - c, (c * 7) & 255, a], (a * 256 + c) * 4);
  const reply = worker.send({ seq: 2, raw: raw.buffer, RESF: 256, SCALE, mottle: null, pm: true, tiers: [{ div: 1, res: 256, r: 0, a: 0 }] });
  assert(Buffer.compare(Buffer.from(new Uint8Array(reply.pms[0])), Buffer.from(El(new Uint8Array(reply.outs[0])))) === 0,
    'all 65,536 alpha/colour pairs premultiply exactly');
}
// ── the wrap border a paced patch must also rewrite (ATLAS_BORDER) ──────
// A tile built mid-job and patched later must end up with the border a fresh
// atlas has: row h-1 above, row 0 below, column w-1 left, column 0 right.
{
  const start = src.indexOf('  const ATLAS_MEMORY ='), end = src.indexOf('  const imageManagerOf =', start);
  assert(start >= 0 && end > start, 'atlas block exists');
  const win = { maplibregl: { getVersion: () => '5.24.0' } };
  const ctx = vm.createContext({ window: win });
  vm.runInContext(src.slice(start, end), ctx);
  if (process.argv.includes('--break-border')) vm.runInContext('ATLAS_BORDER.fix = false', ctx);
  const watch = vm.runInContext('watchAtlasPatches', ctx);
  const w = 3, h = 2, raw = Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * 37 + 11) & 255);
  const pm = El(raw);
  const mk = () => {
    const pos = { version: 1, tl: [10, 20] };
    const atlas = { patternPositions: { mh01: pos }, patchUpdatedImage() {} };
    const calls = [];
    const texture = { context: { gl: { RGBA: 6408 } }, format: 6408,
      update(img, opt, xy) { calls.push({ w: img.width, h: img.height, x: xy.x, y: xy.y, d: Array.from(img.data) }); } };
    return { pos, atlas, calls, texture };
  };
  const style = (mark) => ({ version: 2, data: { width: w, height: h, data: raw }, __pacedVersion: 2, __pacedMark: mark });
  const px = (x, y) => Array.from(pm.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
  // born after the retarget: interior + the four borders
  const A = mk(); watch(A.atlas);
  A.atlas.patchUpdatedImage(A.pos, style(A.atlas.__facadeSeq - 1), A.texture);
  assert.equal(A.calls.length, 5, 'interior plus four border strips');
  const [inner, top, bottom, left, right] = A.calls;
  assert.deepEqual([inner.x, inner.y, inner.w, inner.h], [10, 20, w, h]);
  assert.deepEqual(inner.d, Array.from(pm), 'interior is El(image)');
  assert.deepEqual([top.x, top.y, top.w, top.h, top.d], [10, 19, w, 1, [...px(0, 1), ...px(1, 1), ...px(2, 1)]]);
  assert.deepEqual([bottom.x, bottom.y, bottom.w, bottom.h, bottom.d], [10, 22, w, 1, [...px(0, 0), ...px(1, 0), ...px(2, 0)]]);
  assert.deepEqual([left.x, left.y, left.w, left.h, left.d], [9, 20, 1, h, [...px(2, 0), ...px(2, 1)]]);
  assert.deepEqual([right.x, right.y, right.w, right.h, right.d], [13, 20, 1, h, [...px(0, 0), ...px(0, 1)]]);
  // born before the retarget (main would have it stale too): interior only
  const B = mk(); watch(B.atlas);
  B.atlas.patchUpdatedImage(B.pos, style(B.atlas.__facadeSeq), B.texture);
  assert.equal(B.calls.length, 1, 'an atlas older than the job keeps the interior-only patch MapLibre does');
  // an image version the paced job did not write (an hour repaint): interior only
  const C = mk(); watch(C.atlas);
  C.atlas.patchUpdatedImage(C.pos, { ...style(0), __pacedVersion: 1 }, C.texture);
  assert.equal(C.calls.length, 1, 'only paced versions get the border rewrite');
}

// the knobs are where CLAUDE.md rule 11 says they are
for (const k of ['budgetMs', 'restBudgetMs', 'settleMs', 'workers', 'perWorker', 'visibleFirst', 'workerIdleMs', 'premultiply']) {
  assert(constText('PACE').includes(k + ':'), 'PACE.' + k + ' is a named knob');
}
console.log(`PASS: paced worker images byte-identical to tileData (${cases} drawings, ${tiersChecked} tier images, mottle on/off, mul 1/4), premultiply identical to El, and paced patches rewrite exactly a fresh atlas's wrap border`);
