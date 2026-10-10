// CPU-only contract for the sky and fog placement listener (js/sky.js `styleDataPlacer`).
// `styledata` fires for every addImage; the listener used to read the whole style (`getStyle()`) each time to find that
// nothing had moved. It must now do NOTHING while the layer order (and the sky/haze switches) are unchanged, and must
// still place when a layer IS added above the sky. The functions are taken from js/sky.js's own text and run against a
// fake map that keeps a real layer order, omits custom layers from `getStyle()` as MapLibre does, and counts reads.
// --break makes the key constant (a listener that never re-places); --break-always makes it never match (the old
// behaviour); either must exit 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let src = fs.readFileSync(new URL('../../js/sky.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function fnText(name) {
  const at = src.indexOf('  function ' + name + '(');
  assert(at >= 0, name + ' exists in js/sky.js');
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at + 2, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
if (process.argv.includes('--break')) {
  const f = "return (skyOn() ? 1 : 0) + '|' + (HAZE.on ? 1 : 0) + HAZE.MODE + (fogFailed ? 1 : 0) + '|' + order.join(',');";
  assert(src.includes(f)); src = src.replace(f, "return 'same';");
}
if (process.argv.includes('--break-always')) {
  const f = 'if (key !== null && key === last) return;';
  assert(src.includes(f)); src = src.replace(f, '');
}

const ctx = vm.createContext({ console, window: {} });
vm.runInContext([
  'const SKY_LAYER_ID = "sky-overlay", FOG_LAYER_ID = "aerial-fog";',
  'const HAZE = { on: true, MODE: "depth" }, SKY_COMP = { on: true };',
  'let skyFailed = false, skyPlacing = false, skyAnchor = null, fogFailed = false, fogPlacing = false, fogAnchor = null;',
  'const skyOn = () => SKY_COMP.on && !skyFailed;',
  'const skyLayer = { id: SKY_LAYER_ID, type: "custom" }, fogLayer = { id: FOG_LAYER_ID, type: "custom" };',
  'function showDomSky() {}',
  fnText('fogBeforeId'), fnText('placeFogLayer'), fnText('skyBeforeId'), fnText('placeSkyLayer'),
  fnText('placementKey'), fnText('styleDataPlacer'),
  'this.api = { placeSkyLayer, placeFogLayer, styleDataPlacer, placementKey, set(k, v) { ({ skyOn: () => { SKY_COMP.on = v; }, haze: () => { HAZE.on = v; } })[k](); } };',
].join('\n'), ctx);
const A = ctx.api;

function fakeMap(ids) {
  const m = {
    layers: ids.map(([id, type]) => ({ id, type })), reads: 0, adds: 0, moves: 0, listeners: [],
    get style() { return { _order: this.layers.map(l => l.id) }; },
    getLayersOrder() { return this.layers.map(l => l.id); },
    // custom layers are absent from getStyle(), like MapLibre's
    getStyle() { this.reads++; return { layers: this.layers.filter(l => l.type !== 'custom').map(l => ({ ...l })) }; },
    getLayer(id) { return this.layers.find(l => l.id === id); },
    addLayer(layer, before) { this.adds++; const i = before ? this.layers.findIndex(l => l.id === before) : this.layers.length; this.layers.splice(i < 0 ? this.layers.length : i, 0, { id: layer.id, type: layer.type }); this.fire(); },
    moveLayer(id, before) { this.moves++; const i = this.layers.findIndex(l => l.id === id); const [l] = this.layers.splice(i, 1); const j = before ? this.layers.findIndex(x => x.id === before) : this.layers.length; this.layers.splice(j < 0 ? this.layers.length : j, 0, l); this.fire(); },
    on(ev, fn) { if (ev === 'styledata') this.listeners.push(fn); },
    fire() { for (const f of this.listeners.slice()) f(); },
    order() { return this.layers.map(l => l.id); },
  };
  return m;
}
const base = [['bg', 'background'], ['ground', 'fill'], ['b3d', 'fill-extrusion'], ['parts', 'fill-extrusion'], ['labels', 'symbol'], ['places', 'symbol']];

// ── a burst of 50 addImage calls: 50 styledata events, nothing moved ────────
{
  const m = fakeMap(base);
  A.placeSkyLayer(m); A.placeFogLayer(m);                       // boot
  m.on('styledata', A.styleDataPlacer(m));
  m.fire();                                                      // the first event places once (the key is not yet known)
  const reads0 = m.reads, adds0 = m.adds, moves0 = m.moves;
  for (let i = 0; i < 50; i++) m.fire();
  assert.equal(m.reads - reads0, 0, '50 styledata events: ZERO whole-style reads (the old listener made 50)');
  assert.equal(m.adds - adds0 + m.moves - moves0, 0, 'and zero placements');
  assert.equal(JSON.stringify(m.order()), JSON.stringify(['bg', 'ground', 'b3d', 'parts', 'aerial-fog', 'sky-overlay', 'labels', 'places']),
    'sky and fog sit after the last depth-writing layer and before the labels, fog under the sky');
}
// ── the control: the old listener ──────────────────────────────────────────
{
  const m = fakeMap(base);
  A.placeSkyLayer(m); A.placeFogLayer(m);
  const r0 = m.reads;
  for (let i = 0; i < 50; i++) { A.placeSkyLayer(m); A.placeFogLayer(m); }
  assert.equal(m.reads - r0, 50, 'control: placing on every event reads the whole style once each time (the fog anchors to the sky)');
}
// ── a layer added ABOVE the sky is still handled ───────────────────────────
{
  const m = fakeMap(base);
  A.placeSkyLayer(m); A.placeFogLayer(m);
  m.on('styledata', A.styleDataPlacer(m));
  m.fire();
  m.addLayer({ id: 'late-b3d', type: 'fill-extrusion' });          // appended past the labels, so past the sky
  const after = m.order();
  assert(after.indexOf('late-b3d') < after.indexOf('aerial-fog') && after.indexOf('aerial-fog') < after.indexOf('sky-overlay'),
    'a fill-extrusion added above the sky is re-placed under the fog and the sky');
  const moves = m.moves;
  for (let i = 0; i < 20; i++) m.fire();
  assert.equal(m.moves, moves, 'and then it is quiet again');
  // a layer REMOVED, and the switches
  m.layers.splice(m.layers.findIndex(l => l.id === 'late-b3d'), 1); m.fire();
  const r1 = m.reads;
  A.set('skyOn', false); m.fire();
  assert(m.reads > r1, 'switching the sky off is a change the listener notices');
}
// ── a map that cannot say its order falls back to placing every time ───────
{
  const m = fakeMap(base);
  m.getLayersOrder = undefined; Object.defineProperty(m, 'style', { get() { return {}; } });
  const f = A.styleDataPlacer(m);
  f(); const r = m.reads; f(); f();
  assert(m.reads > r, 'no readable order, no skipping');
}
console.log('PASS: sky/fog placement does nothing for 50 styledata events that moved nothing (0 style reads, 0 placements against 50 reads before), and still re-places when a layer is added above the sky');
