// CPU-only contract for WALL TIERS (js/facades.js): a wall image is painted when a tile first asks for it, not
// when it is registered; a repaint touches only images that exist; `?walltiers=0` is the old eager path.
// No browser, no server. The functions are taken from js/facades.js's own text and run against a fake map that
// behaves as MapLibre 5.24.0 does for the one thing this relies on: `_getImagesForIds` fires `styleimagemissing`
// for an id it does not hold and looks the id up again straight after.
// --break paints every tier of a combo on a request for one (the shape a "simple" version would take);
// --break-repaint lets a repaint create the images nobody asked for; --break-cap switches the burst cap off;
// each must exit 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let src = fs.readFileSync(new URL('../../js/facades.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const BREAK = process.argv.includes('--break');
const BREAK_REPAINT = process.argv.includes('--break-repaint');
const BREAK_CAP = process.argv.includes('--break-cap');
// Negative controls: break the shipped text in the one way a plausible edit would, and the checks below must fail.
const mutate = (from, to) => { assert(src.includes(from), '--break found the text to break'); src = src.replace(from, to); };
if (BREAK) mutate('lazyWallImage(map, e.id, info);', 'for (const tt of TIERS) lazyWallImage(map, info.id + tt.id, { id: info.id, tier: tt });');
if (BREAK_CAP) mutate('const flat = WALLTIERS.cap && PACE.on', 'const flat = false && PACE.on');
if (BREAK_REPAINT) mutate('if (WALLTIERS.on && !(map.hasImage && map.hasImage(key))) continue;\n      try {', 'try {');

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
function build(on) {
  const painted = [];                 // tileData calls: [fam, idx, tier.id]
  const released = [];                // js/image-memory.js release calls: keys
  let tick = 0;                       // the clock moves 5 ms at every reading
  const queued = [], repaints = [];   // microtasks (the end of a call stack), requestAnchorRepaint calls
  const sandbox = {
    window: { ImageMemory: { release: (m, key, input) => { released.push(key); return input ? 1 : 0; } } }, location: { search: on ? '' : '?walltiers=0' }, performance: { now: () => (tick += 5) },
    queueMicrotask: (f) => queued.push(f), console,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext([
    constText('TIERS'),
    'const combos = ["mh03", "tg07", "lo01"], _atlasP = 0.3, _warnedUpdate = true;',
    'const _imgSig = new Map(); const _rawLru = new Map(), _pace = {}; let _zAnchor = 16;',
    'const tierPixelRatio = t => 2 / t.div; const SCALE = 2;',
    'const tileData = (fam, idx, p, tier) => { __painted.push([fam, idx, tier.id]); return { width: 8, height: 8, data: new Uint8Array(256) }; };',
    'const drawSig = (fam, p) => fam + "|" + p + "|" + _zAnchor;',
    constText('WALLTIERS'),
    'const ATLAS = {};',
    // WT and its burst counter exactly as written
    'const WT = {', src.slice(src.indexOf('on: WALLTIERS.on, deferred: 0'), src.indexOf('};', src.indexOf('on: WALLTIERS.on, deferred: 0')) + 2),
    'const _burst = { ms: 0, n: 0, open: false, start: 0, flat: 0, map: null };',
    'const PM_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;',
    'const PACE = { on: true }; const palette = [{}]; const lerpHexAt = () => [10, 200, 30]; const mulOf = () => 1;',
    'const tierRes = t => 8 / t.div; const requestAnchorRepaint = (m) => __repaints.push(m);',
    fnText('parseId'), fnText('veilUp'), fnText('wallPlaceholder'), fnText('flushBurst'),
    fnText('wallKeyInfo'), fnText('lazyWallImage'), fnText('armWallTiers'),
    fnText('ensureImages'), fnText('paintCombo'), fnText('comboCurrent'), fnText('presentTiers'),
    'this.api = { ensureImages, paintCombo, comboCurrent, presentTiers, WT, WALLTIERS, TIERS, wallKeyInfo, imgSig: _imgSig,',
    '  setAnchor(z) { _zAnchor = z; } };',
  ].join('\n'), ctx);
  ctx.__painted = painted; ctx.__repaints = repaints;
  const api = ctx.api;
  // The fake map. `ask` is MapLibre's _getImagesForIds for one id.
  const images = new Map(), handlers = {}, calls = [];
  const map = {
    hasImage: (k) => images.has(k),
    addImage: (k, img, o) => { if (images.has(k)) throw new Error('exists'); images.set(k, { img, o, v: 1 }); calls.push(['add', k]); },
    updateImage: (k, img) => { if (!images.has(k)) throw new Error('missing'); images.get(k).v++; calls.push(['update', k]); },
    on: (ev, f) => { (handlers[ev] = handlers[ev] || []).push(f); },
  };
  // one call of ask() is one tile request unless the caller batches them with askMany (one call stack)
  const ask1 = (k) => {
    if (!images.has(k)) for (const f of handlers.styleimagemissing || []) f({ id: k });
    return images.get(k) || null;
  };
  const ask = (k) => { const r = ask1(k); flush(); return r; };
  const askMany = (ks) => { const r = ks.map(ask1); flush(); return r; };
  const flush = () => { while (queued.length) queued.shift()(); };
  return { api, map, ask, askMany, images, painted, calls, handlers, released, repaints, flush };
}

// ── ON: nothing is painted at registration, one image per request ───────
{
  const S = build(true);
  for (const id of ['mh03', 'tg07', 'lo01']) assert.equal(S.api.ensureImages(S.map, id, 0.3), 0, 'registration adds nothing');
  assert.equal(S.images.size, 0, 'no image exists after registration');
  assert.equal(S.painted.length, 0, 'nothing was drawn at registration');
  assert.equal(S.handlers.styleimagemissing.length, 1, 'ensureImages armed the missing-image handler once');
  S.api.ensureImages(S.map, 'mh03', 0.3);
  assert.equal(S.handlers.styleimagemissing.length, 1, 'and only once');

  const far = S.ask('mh03x');
  assert(far, 'the far image exists straight after the request');
  assert.equal(JSON.stringify(S.painted), JSON.stringify([['mh', 3, 'x']]), 'one drawing, for the far tier only');
  assert.equal(S.images.has('mh03'), false, 'the near image of that combo was not made');
  assert.equal(far.o.pixelRatio, 2 / 2, 'far tier registered with its own pixel ratio');
  S.ask('mh03x');
  assert.equal(S.painted.length, 1, 'a second request for an image that exists paints nothing');
  const near = S.ask('mh03');
  assert(near && near.o.pixelRatio === 2, 'near image: registered when asked, near ratio');
  assert.equal(S.images.size, 2);
  assert.equal(S.ask('tg07x') !== null, true);
  assert.equal(S.ask('zz99x'), null, 'an id that is no combo of ours is left alone (still missing, as before)');
  assert.equal(S.ask('mh03xx'), null);
  assert.equal(S.released.length, 3, 'each lazily added image is handed to js/image-memory.js for the same release the eager ones get');
  assert.equal(S.api.WT.painted, 3);
  assert.equal(S.api.WT.paintedFar + S.api.WT.paintedNear, 3);
  assert.equal(S.api.WT.unknown, 2);
  assert.equal(S.api.WT.bursts >= 1, true, 'bursts are counted');

  // repaint touches only what exists
  S.painted.length = 0; S.calls.length = 0;
  S.api.setAnchor(17);
  S.api.paintCombo(S.map, 'mh03', S.api.TIERS, 0.4);
  assert.deepEqual(S.calls.map(c => c[0] + ' ' + c[1]).sort(), ['update mh03', 'update mh03x'], 'both held tiers repainted, in place');
  S.calls.length = 0;
  S.api.paintCombo(S.map, 'tg07', S.api.TIERS, 0.4);
  assert.deepEqual(S.calls.map(c => c[0] + ' ' + c[1]), ['update tg07x'], 'only the held tier of tg07');
  S.calls.length = 0;
  S.api.paintCombo(S.map, 'lo01', S.api.TIERS, 0.4);
  assert.deepEqual(S.calls, [], 'a combo nobody asked for is not painted into existence by a repaint');
  assert.equal(S.api.comboCurrent(S.map, 'lo01', 'anything'), true, 'a combo with no image has nothing to keep current');
  assert.equal(S.api.comboCurrent(S.map, 'mh03', 'stale|sig'), false, 'a held image at another sig is not current');
  assert.equal(JSON.stringify(S.api.presentTiers(S.map, 'tg07').map(t => t.id)), '["x"]');
  assert.equal(S.api.presentTiers(S.map, 'lo01').length, 0);
}

// ── the burst cap: after the veil, a request paints only until its budget is spent, the rest is answered flat ──
{
  const S = build(true);
  S.api.WALLTIERS.syncBudgetMs = 1;            // the clock moves 5 ms a reading: every image after the first is over budget
  for (const id of ['mh03', 'tg07', 'lo01']) S.api.ensureImages(S.map, id, 0.3);
  S.askMany(['mh03x', 'tg07x', 'lo01x', 'mh03']);
  assert.equal(S.painted.length, 1, 'only the first image of the request was drawn for real');
  assert.equal(S.api.WT.placeholders, 3, 'the other three were answered flat');
  assert.equal(S.images.size, 4, 'and all four exist at once: no tile ever sees a hole');
  const flat = S.images.get('tg07x').img;
  assert.equal(flat.width, 8 / 2, 'a flat answer has the real image size, or updateImage would refuse it');
  assert.equal(flat.data.length, flat.width * flat.height * 4);
  assert.equal(flat.data[0] + ',' + flat.data[1] + ',' + flat.data[2] + ',' + flat.data[3], '10,200,30,255', 'in the pattern colour, opaque');
  assert.equal(S.api.imgSig.has('tg07x'), false, 'a flat answer has no signature, so the paced repaint paints it');
  assert.equal(S.api.imgSig.has('mh03x'), true);
  assert.equal(S.repaints.length, 1, 'one repaint request for the whole request, after its call stack');
  assert.equal(JSON.stringify(S.api.WT.burstLog.map(b => [b[1], b[3]])), '[[4,3]]', 'the burst log says 4 images, 3 of them flat');
  // the budget is a switch: ?wtcap=0 paints everything in the request
  const T = build(true); T.api.WALLTIERS.syncBudgetMs = 1; T.api.WALLTIERS.cap = false;
  for (const id of ['mh03', 'tg07']) T.api.ensureImages(T.map, id, 0.3);
  T.askMany(['mh03x', 'tg07x', 'mh03']);
  assert.equal(T.painted.length, 3); assert.equal(T.api.WT.placeholders, 0); assert.equal(T.repaints.length, 0);
}

// ── the mean guard: when one real paint is already expected to blow the budget, even the first image is answered flat ──
{
  const S = build(true);
  for (const id of ['mh03', 'tg07']) S.api.ensureImages(S.map, id, 0.3);
  S.api.WT.syncPainted = 4; S.api.WT.syncMs = 4 * 100;      // the running mean is 100 ms a paint, the budget 16 (guard 2x = 32)
  S.askMany(['mh03x', 'tg07x']);
  assert.equal(S.painted.length, 0, 'no real paint in a request when the mean paint is far over the budget');
  assert.equal(S.api.WT.placeholders, 2);
  const U = build(true);
  U.api.ensureImages(U.map, 'mh03', 0.3);
  U.api.WT.syncPainted = 4; U.api.WT.syncMs = 4 * 5;        // mean 5 ms: the first image is painted for real
  U.askMany(['mh03x']);
  assert.equal(U.painted.length, 1);
}

// ── OFF (?walltiers=0): the old eager path, every tier at registration ──
{
  const S = build(false);
  assert.equal(S.api.WALLTIERS.on, false);
  assert.equal(S.api.ensureImages(S.map, 'mh03', 0.3), 1);
  assert.equal(S.images.size, S.api.TIERS.length, 'every tier registered at once');
  assert.equal(S.handlers.styleimagemissing, undefined, 'no handler armed');
  S.painted.length = 0;
  S.api.paintCombo(S.map, 'tg07', S.api.TIERS, 0.4);
  assert.equal(S.images.size, S.api.TIERS.length * 2, 'a repaint adds what is missing, as it always did');
  assert.equal(S.api.presentTiers(S.map, 'mh03'), S.api.TIERS);
}

// ── the knobs are named, and the switch is a URL ────────────────────────
for (const k of ['on', 'rawCache', 'slowKeep']) assert(constText('WALLTIERS').includes(k + ':'), 'WALLTIERS.' + k + ' is a named knob');
assert(constText('WALLTIERS').includes('walltiers=0'), '?walltiers=0 switches it off');
console.log('PASS: wall images are painted when asked, one tier at a time, repaints touch only what exists, and ?walltiers=0 is the eager path');
