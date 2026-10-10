// CPU-only contract for WALL TIERS (js/facades.js): a wall image is painted when a tile first asks for it, not
// when it is registered; a repaint touches only images that exist; `?walltiers=0` is the old eager path.
// No browser, no server. The functions are taken from js/facades.js's own text and run against a fake map that
// behaves as MapLibre 5.24.0 does for the one thing this relies on: `_getImagesForIds` fires `styleimagemissing`
// for an id it does not hold and looks the id up again straight after.
// --break paints every tier of a combo on a request for one (the shape a "simple" version would take);
// --break-repaint lets a repaint create the images nobody asked for; either must exit 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let src = fs.readFileSync(new URL('../../js/facades.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const BREAK = process.argv.includes('--break');
const BREAK_REPAINT = process.argv.includes('--break-repaint');
// Negative controls: break the shipped text in the one way a plausible edit would, and the checks below must fail.
const mutate = (from, to) => { assert(src.includes(from), '--break found the text to break'); src = src.replace(from, to); };
if (BREAK) mutate('lazyWallImage(map, e.id, info);', 'for (const tt of TIERS) lazyWallImage(map, info.id + tt.id, { id: info.id, tier: tt });');
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
  const sandbox = {
    window: { ImageMemory: { release: (m, key, input) => { released.push(key); return input ? 1 : 0; } } }, location: { search: on ? '' : '?walltiers=0' }, performance: { now: () => Date.now() },
    queueMicrotask: (f) => f(), console,
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
    'const _burst = { ms: 0, n: 0, open: false };',
    fnText('parseId'), fnText('wallKeyInfo'), fnText('lazyWallImage'), fnText('armWallTiers'),
    fnText('ensureImages'), fnText('paintCombo'), fnText('comboCurrent'), fnText('presentTiers'),
    'this.api = { ensureImages, paintCombo, comboCurrent, presentTiers, WT, WALLTIERS, TIERS, wallKeyInfo, imgSig: _imgSig,',
    '  setAnchor(z) { _zAnchor = z; } };',
  ].join('\n'), ctx);
  ctx.__painted = painted;
  const api = ctx.api;
  // The fake map. `ask` is MapLibre's _getImagesForIds for one id.
  const images = new Map(), handlers = {}, calls = [];
  const map = {
    hasImage: (k) => images.has(k),
    addImage: (k, img, o) => { if (images.has(k)) throw new Error('exists'); images.set(k, { img, o, v: 1 }); calls.push(['add', k]); },
    updateImage: (k, img) => { if (!images.has(k)) throw new Error('missing'); images.get(k).v++; calls.push(['update', k]); },
    on: (ev, f) => { (handlers[ev] = handlers[ev] || []).push(f); },
  };
  const ask = (k) => {
    if (!images.has(k)) for (const f of handlers.styleimagemissing || []) f({ id: k });
    return images.get(k) || null;
  };
  return { api, map, ask, images, painted, calls, handlers, released };
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
