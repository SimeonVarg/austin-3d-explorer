import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let source = fs.readFileSync(new URL('../../js/timeofday.js', import.meta.url), 'utf8');
if (process.argv.includes('--break')) source = source.replace('if (!map?.style?._loaded) return;', '');
if (process.argv.includes('--break-loading')) source = source.replace('if (!map?.style?._loaded) return;', 'if (!map?.style) return;');
const callbacks = new Map(), calls = [], events = {}, classes = new Set();
let clock = 0, nextId = 0, failRetint = false;
const map = {
  style: { _loaded: true },
  // Source/tiles can still be pending after style JSON is ready.
  isStyleLoaded: () => { throw Error('must not wait for pending sources'); },
};
const slider = { value: '', addEventListener: (type, fn) => { events['slider:' + type] = fn; } };
const play = {
  textContent: '',
  classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
  addEventListener: (type, fn) => { events['play:' + type] = fn; },
};
const window = {};
const scope = vm.createContext({
  window,
  document: { getElementById: id => id === 'tod-slider' ? slider : id === 'tod-play' ? play : null },
  performance: { now: () => clock },
  requestAnimationFrame: fn => { const id = ++nextId; callbacks.set(id, fn); return id; },
  cancelAnimationFrame: id => callbacks.delete(id),
});
vm.runInContext(source, scope);
// Exercise the real public UI and its window-level wrapper dispatch.
window.applyTimeOfDay = (gotMap, p) => {
  assert.equal(gotMap, map);
  if (!map.style) throw Error('retint accessed absent style');
  if (!map.style._loaded) throw Error('Style is not done loading.');
  if (failRetint) throw Error('downstream retint failed');
  calls.push(p);
};
window.initTimeOfDayUI(map, .12);
const click = () => events['play:click']();
const frame = dt => {
  clock += dt;
  assert.equal(callbacks.size, 1, 'exactly one playback frame queued');
  const [id, fn] = callbacks.entries().next().value;
  callbacks.delete(id);
  fn(clock);
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

click(); frame(320); near(calls.at(-1), .13);
map.style = null;
frame(320); frame(320); frame(320);
assert.equal(calls.length, 1, 'style loss defers the entire wrapper chain');
near(Number(slider.value), .16);
assert.ok(classes.has('playing'));
map.style = { _loaded: false };
frame(320); frame(320);
assert.equal(calls.length, 1, 'existing style with unloaded JSON still defers retint');
near(Number(slider.value), .18);
map.style._loaded = true;
frame(320); near(calls.at(-1), .19);

// Retint errors remain visible but do not permanently kill playback.
failRetint = true;
assert.throws(() => frame(320), /downstream retint failed/);
assert.equal(callbacks.size, 1);
failRetint = false;
frame(320); near(calls.at(-1), .21);
click(); assert.equal(callbacks.size, 0); assert.ok(!classes.has('playing'));

// Slider interaction still stops playback, and normal end-stop reversal holds.
slider.value = '.99'; events['slider:input'](); near(calls.at(-1), .99);
click(); frame(640); near(calls.at(-1), 1);
frame(320); near(calls.at(-1), .99);
map.style = null;
slider.value = '.3'; events['slider:input']();
assert.equal(callbacks.size, 0, 'slider stops playback even during style loss');
assert.ok(!classes.has('playing'));
console.log('PASS: TOD defers absent/unloaded style JSON without waiting on sources; clock, RAF, slider and reversal remain intact');
