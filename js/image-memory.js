(function () {
  'use strict';
  const tune = { on: !/[?&]imagememory=0(?:&|$)/.test(window.location?.search || ''), version: '5.24.0', methods: ['initFacades', 'registerFacadeBuckets'] };
  const maps = new WeakMap();
  function supported() {
    return !window.LITE_PROFILE?.on && window.maplibregl?.getVersion?.() === tune.version;
  }
  function inputBytes(input, image) {
    if (!input || !image?.data || typeof input !== 'object') return 0;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return 0;
    if ('render' in input || 'onAdd' in input || 'onRemove' in input) return 0;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 3 || !['width', 'height', 'data'].every(key => keys.includes(key))) return 0;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (!['width', 'height', 'data'].every(key => Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) return 0;
    const pixels = descriptors.data.value, rgba = image.data;
    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) ||
        !(pixels.buffer instanceof ArrayBuffer) || !pixels.byteLength ||
        pixels.byteOffset !== 0 || pixels.byteLength !== pixels.buffer.byteLength ||
        descriptors.width.value !== rgba.width || descriptors.height.value !== rgba.height ||
        pixels.byteLength !== rgba.width * rgba.height * 4 ||
        !(rgba.data instanceof Uint8Array) || rgba.data.buffer === pixels.buffer) return 0;
    return pixels.byteLength;
  }
  function manager(map) { return map?.style?.imageManager; }
  function reclaim(map) {
    const state = maps.get(map), images = manager(map)?.images;
    if (!state || !images || !supported() || !tune.on) return 0;
    let bytes = 0;
    for (const [id, candidate] of state.candidates) {
      const image = candidate.image.deref(), input = candidate.input.deref();
      if (!image || !input || images[id] !== image || image.userImage !== input) { state.candidates.delete(id); continue; }
      const size = inputBytes(input, image);
      if (!size) { state.candidates.delete(id); continue; }
      image.userImage = undefined;
      bytes += size;
      state.releasedBytes += size;
      state.releasedImages++;
      state.candidates.delete(id);
    }
    return bytes;
  }
  function arm(map) {
    let state = maps.get(map);
    if (state) return state;
    if (!map || typeof map.addImage !== 'function' || typeof WeakRef !== 'function') return null;
    state = { depth: 0, addDepth: 0, candidates: new Map(), releasedBytes: 0, releasedImages: 0 };
    maps.set(map, state);
    const add = map.addImage;
    map.addImage = function (id, input) {
      const ownedCall = state.depth > 0 && state.addDepth === 0 && this === map;
      state.addDepth++;
      let result;
      try { result = add.apply(this, arguments); }
      finally { state.addDepth--; }
      if (ownedCall && supported()) {
        const image = manager(map)?.images?.[id];
        if (image?.userImage === input && inputBytes(input, image)) {
          state.candidates.set(id, { image: new WeakRef(image), input: new WeakRef(input) });
          reclaim(map);
        }
      }
      return result;
    };
    return state;
  }
  function install() {
    for (const name of tune.methods) {
      const original = window[name];
      if (typeof original !== 'function') continue;
      window[name] = function (map) {
        const state = arm(map);
        if (!state) return original.apply(this, arguments);
        state.depth++;
        try { return original.apply(this, arguments); }
        finally { state.depth--; reclaim(map); }
      };
    }
  }
  window.ImageMemory = { tune, reclaim, stats(map) {
    const state = maps.get(map);
    return { supported: supported(), pendingImages: state?.candidates.size || 0,
      releasedImages: state?.releasedImages || 0, releasedBytes: state?.releasedBytes || 0 };
  } };
  install();
}());
