// Behavioral contract for the actual idle driver, with deterministic camera
// completion and input events. Full-city motion remains a separate gate.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
const start = source.indexOf('  const DRIFT = {');
const end = source.indexOf('  // ── Landmark orbit', start);
assert(start >= 0 && end > start, 'actual idle driver must be found');
let code = source.slice(start, end);
if (process.argv.includes('--break')) {
  const condition = 'if (up < band + 1 - DRIFT.zoomMargin)';
  assert(code.includes(condition), 'negative control targets the actual zoom guard');
  code = code.replace(condition, 'if (true)');
}
function emitter() {
  const handlers = new Map();
  return {
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
    addEventListener(name, fn) { this.on(name, fn); },
    emit(name, event = {}) { for (const fn of handlers.get(name) || []) fn(event); },
  };
}
function fixture({ zoom = 17.5, bearing = 0, reduced = false, sync = false, search = '', band, pStep } = {}) {
  const timers = new Map(), frames = new Map(), calls = [], hours = [];
  let serial = 0, easing = false, active = null;
  const media = Object.assign(emitter(), { matches: reduced });
  const slider = { value: '0.3' };
  const play = { playing: false, classList: { contains: () => play.playing } };
  const document = Object.assign(emitter(), {
    visibilityState: 'visible',
    getElementById(id) { return id === 'tod-slider' ? slider : id === 'tod-play' ? play : null; },
  });
  const window = Object.assign(emitter(), {
    location: { search }, __todCurrentP: 0.3,
    matchMedia: () => media,
  });
  const map = Object.assign(emitter(), {
    transform: { tileZoom: band ?? Math.floor(zoom) },
    getZoom: () => zoom, getBearing: () => bearing, isEasing: () => easing,
    easeTo(options, data) {
      assert(calls.length < 100, 'synchronous completion must not recurse');
      active = { options, data }; calls.push(active); easing = true;
      this.emit('movestart', data);
      if (sync) complete();
    },
    stop() { easing = false; if (active) this.emit('moveend', active.data); },
  });
  function complete({ interrupted = false } = {}) {
    assert(active, 'an ease must exist');
    if (!interrupted) {
      zoom = active.options.zoom;
      bearing = ((active.options.bearing + 180) % 360 + 360) % 360 - 180;
      map.transform.tileZoom = Math.floor(zoom);
    }
    easing = false;
    map.emit('moveend', active.data);
  }
  const context = {
    window, document, map, URLSearchParams, DEFAULT_P: 0.3,
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    applyTimeOfDay(m, p) { hours.push(p); window.__todCurrentP = p; },
  };
  const effectiveStep = process.argv.includes('--break-clock') && pStep === undefined ? 0.01 : pStep;
  const override = effectiveStep === undefined ? '' : `\nDRIFT.pStep = ${Number(effectiveStep)};`;
  vm.runInNewContext(code + override + '\ninitIdleCinema();', context);
  function timer() {
    assert.equal(timers.size, 1, 'exactly one idle countdown');
    const [id, task] = timers.entries().next().value;
    assert.equal(task.ms, 25000, 'idle delay retained');
    timers.delete(id); task.fn();
  }
  function frame() {
    const pending = [...frames.values()]; frames.clear();
    for (const fn of pending) fn();
  }
  return { timer, frame, complete, timers, frames, calls, hours, window, document, media, map, play, slider };
}

for (const zoom of [17, 17.5, 17.98, 17.9999]) {
  const f = fixture({ zoom, bearing: -179 }); f.timer();
  for (let i = 0; i < 8; i++) {
    assert.equal(f.calls.length, i + 1);
    assert.equal(Math.floor(f.calls.at(-1).options.zoom), 17, 'breathing never crosses atlas band');
    assert.equal(f.calls.at(-1).options.easing(0.4), 0.4, 'rotation remains linear');
    f.complete();
    assert.equal(f.timers.size, 0, 'no leg-end timeout gap');
    assert.equal(f.frames.size, 1, 'completion queues one continuation frame');
    f.frame();
  }
  assert.equal(f.calls[1].options.zoom, zoom, 'breath returns to original zoom');
  assert.equal(f.hours.length, 0, 'default idle rotation does not repaint time');
  assert.equal(f.window.__todCurrentP, 0.3, 'selected lighting is preserved');
  assert.equal(f.slider.value, '0.3', 'idle rotation does not move the time slider');
}
for (const input of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
  const f = fixture(); f.timer();
  const stale = f.calls[0].data;
  f.window.emit(input); f.map.emit('moveend', stale); f.frame();
  assert.equal(f.calls.length, 1, input + ' stops without restarting');
  assert.equal(f.frames.size, 0);
  f.timer();
  f.map.emit('moveend', stale); f.frame();
  assert.equal(f.calls.length, 2, 'previous generation cannot complete new leg');
}
{
  const f = fixture(); f.timer(); f.complete();
  const stale = [...f.frames.values()][0];
  f.window.emit('pointerdown'); stale();
  assert.equal(f.calls.length, 1, 'already-dequeued callback cannot restart after input');
}
{
  const f = fixture(); f.timer(); f.complete();
  f.map.emit('moveend', f.calls[0].data);
  assert.equal(f.frames.size, 1, 'duplicate completion queues only one continuation');
  f.frame();
  assert.equal(f.calls.length, 2, 'duplicate completion cannot start overlapping legs');
}
{
  const f = fixture(); f.timer(); f.complete({ interrupted: true }); f.frame();
  assert.equal(f.calls.length, 1, 'interrupted endpoint must not chain');
  assert.equal(f.timers.size, 1);
}
for (const mode of ['hidden', 'reduced']) {
  const f = fixture(); f.timer(); f.complete();
  if (mode === 'hidden') { f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange'); }
  else { f.media.matches = true; f.media.emit('change'); }
  f.frame(); f.timer();
  assert.equal(f.calls.length, 1, mode + ' stops and prevents new legs');
}
{
  const f = fixture({ sync: true }); f.timer();
  assert.equal(f.calls.length, 1, 'synchronous completion yields');
  for (let i = 0; i < 5; i++) f.frame();
  assert.equal(f.calls.length, 6, 'at most one leg per frame under synchronous completion');
}
{
  const f = fixture({ zoom: 17.5, band: 18 }); f.timer();
  assert.equal(f.calls[0].options.zoom, 17.5, 'unknown tile-zoom convention holds zoom');
}
for (const search of ['?drift=0', '?livehere=1']) {
  const f = fixture({ search }); assert.equal(f.timers.size, 0, 'disabled route stays inactive');
}
{
  const f = fixture({ reduced: true }); f.timer(); assert.equal(f.calls.length, 0);
}
{
  const f = fixture(); f.window.__intro = { flight: { state: 'primed' } };
  f.timer(); assert.equal(f.calls.length, 0, 'intro retains camera ownership');
}
{
  const f = fixture({ pStep: 0.01 }); f.timer(); f.complete(); f.frame();
  assert.equal(f.hours.length, 2, 'optional clock creep remains available');
  assert(Math.abs(f.hours[1] - 0.32) < 1e-12);
}
{
  const f = fixture({ pStep: 0.01 }); f.play.playing = true;
  f.timer(); f.complete(); f.frame();
  assert.equal(f.hours.length, 0, 'explicit day playback owns the clock without a second idle update');
  assert.equal(f.calls.length, 2, 'day playback does not suppress camera rotation');
}
console.log('PASS idle cinema: continuous handoff, cancellation, stale events, zoom bands, bearing wrap, visibility and reduced motion');
