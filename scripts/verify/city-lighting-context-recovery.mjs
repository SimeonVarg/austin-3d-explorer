// CPU regression for the complete CityLighting adapter, with a GL double that
// invalidates every resource when its context is lost. No browser or network.
// MapLibre 5.24 replaces Painter before emitting webglcontextrestored; the GL
// JavaScript object survives. Mirror that order, including program creation:
// https://github.com/maplibre/maplibre-gl-js/blob/v5.24.0/src/ui/map.ts
// --break omits recovery listeners (the original bug) and must fail.
// --break-painter omits new-painter hooks; --break-frame republishes lost handles.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const THREE = createRequire(new URL('../buildings/runtime.mjs', import.meta.url))('three');
let source = (await fs.readFile(new URL('../../js/city-lighting.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
function replace(needle, replacement) {
  assert(source.includes(needle), 'negative control must alter the production recovery contract');
  source = source.replace(needle, replacement);
}
if (process.argv.includes('--break')) {
  replace("    map.on('webglcontextlost',onContextLost);", '');
  replace("    map.on('webglcontextrestored',onContextRestored);", '');
}
if (process.argv.includes('--break-painter')) {
  replace('      createFallbackShadow();\n      bindPainter();', '      createFallbackShadow();');
}
if (process.argv.includes('--break-frame')) {
  replace('frame=fallbackShadow?{U,inverse,textures:textures||[fallbackShadow,fallbackShadow]}:null;',
    'frame={U,inverse,textures:textures||[fallbackShadow,fallbackShadow]};');
}

class TestGL {
  constructor() {
    Object.assign(this, {
      TEXTURE_2D: 3553, TEXTURE0: 33984, ACTIVE_TEXTURE: 34016, TEXTURE_BINDING_2D: 32873,
      MAX_TEXTURE_IMAGE_UNITS: 34930, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
      RGBA: 6408, UNSIGNED_BYTE: 5121, NEAREST: 9728, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    });
    this.epoch = 1; this.lost = false; this.active = this.TEXTURE0;
    this.bindings = new Map(); this.textures = []; this.deleted = [];
    this.draws = []; this.nativeProgram = null; this.uniformCalls = 0;
  }
  isContextLost() { return this.lost; }
  valid(resource, operation) {
    if (resource && (resource.epoch !== this.epoch || resource.deleted)) {
      throw new Error('INVALID_OPERATION: ' + operation + ': object does not belong to this context');
    }
  }
  getParameter(name) {
    if (name === this.MAX_TEXTURE_IMAGE_UNITS) return 16;
    if (name === this.ACTIVE_TEXTURE) return this.active;
    if (name === this.TEXTURE_BINDING_2D) return this.bindings.get(this.active) || null;
    throw new Error('unexpected GL parameter ' + name);
  }
  createTexture() {
    assert(!this.lost, 'do not allocate a texture while the context is lost');
    const texture = { epoch: this.epoch, filters: new Map() };
    this.textures.push(texture); return texture;
  }
  bindTexture(target, texture) {
    assert.equal(target, this.TEXTURE_2D);
    if (this.lost) return;
    this.valid(texture, 'bindTexture'); this.bindings.set(this.active, texture || null);
  }
  activeTexture(unit) { this.active = unit; }
  texImage2D(target, level, internal, width, height, border, format, type, pixels) {
    const texture = this.getParameter(this.TEXTURE_BINDING_2D);
    assert(texture, 'allocate fallback pixels on a real texture');
    Object.assign(texture, { width, height, pixels: [...pixels] });
    assert.equal(internal, this.RGBA); assert.equal(format, this.RGBA); assert.equal(type, this.UNSIGNED_BYTE);
  }
  texParameteri(target, name, value) { this.getParameter(this.TEXTURE_BINDING_2D).filters.set(name, value); }
  deleteTexture(texture) {
    if (!texture) return;
    assert(!this.lost, 'discard lost handles without trying to delete them');
    this.valid(texture, 'deleteTexture'); texture.deleted = true; this.deleted.push(texture);
  }
  shaderSource(shader, text) { shader.source = text; }
  compileShader() {}
  getShaderParameter() { return true; }
  getShaderInfoLog() { return ''; }
  linkProgram() {}
  getAttachedShaders(program) { return program.shaders; }
  getProgramParameter() { return true; }
  getProgramInfoLog() { return ''; }
  getUniformLocation(program, name) {
    if (!program.locations.has(name)) program.locations.set(name, { epoch: this.epoch, program, name });
    return program.locations.get(name);
  }
  useProgram(program) { if (!this.lost) { this.valid(program, 'useProgram'); this.nativeProgram = program; } }
  uniform(location, value) {
    if (this.lost || !location) return;
    this.valid(location, 'uniform'); location.program.values.set(location.name, value); this.uniformCalls++;
  }
  uniform1f(location, value) { this.uniform(location, value); }
  uniform1i(location, value) { this.uniform(location, value); }
  uniform2fv(location, value) { this.uniform(location, [...value]); }
  uniform3fv(location, value) { this.uniform(location, [...value]); }
  uniform4fv(location, value) { this.uniform(location, [...value]); }
  uniformMatrix4fv(location, transpose, value) { this.uniform(location, [...value]); }
  drawElements() {
    if (this.lost) return;
    this.draws.push({
      textures: [14, 15].map(unit => this.bindings.get(this.TEXTURE0 + unit) || null),
      surface: this.nativeProgram?.values.get('u_citySolidSurface'),
      poolLift: this.nativeProgram?.values.get('u_cityPoolLift'),
    });
  }
  drawArrays() { TestGL.prototype.drawElements.call(this); }
  lose() { this.lost = true; this.bindings.clear(); this.nativeProgram = null; }
  restore() { this.epoch++; this.lost = false; this.active = this.TEXTURE0; }
}

// Let the production adapter detect and instrument its pinned shader signatures.
// This fixture checks resource/layer lifetime, not GLSL compilation or pixels.
function program(gl, pool = false) {
  const vertex = {}, fragment = {};
  gl.shaderSource(vertex, pool
    ? 'uniform bool u_pitch_with_map; void main(){float ele=get_elevation(circle_center);}'
    : 'in vec4 a_normal_ed; void main(){vec2 posInTile=a_pos+u_fill_translate;}');
  gl.shaderSource(fragment, pool ? 'void main(){}' : 'in vec4 v_color; void main(){fragColor=v_color;}');
  gl.compileShader(vertex); gl.compileShader(fragment);
  const result = { epoch: gl.epoch, shaders: [vertex, fragment], locations: new Map(), values: new Map() };
  gl.linkProgram(result); gl.useProgram(result);
  return result;
}

class TestMap extends EventEmitter {
  constructor(gl) {
    super(); this.gl = gl; this.imageCalls = []; this.painters = [];
    this.painter = this.makePainter();
  }
  makePainter() {
    const gl = this.gl;
    const painter = {
      context: { gl }, id: '',
      getDepthModeForSublayer() { return { source: '2d', mask: true }; },
      getDepthModeFor3D() { return { source: '3d', mask: true }; },
      drawFunctions: {
        fillExtrusion() { gl.drawElements(); },
        circle(p) { p.lastDepth = p.getDepthModeForSublayer(); gl.drawArrays(); },
      },
    };
    painter.originalDrawFunctions = painter.drawFunctions;
    this.painters.push(painter); return painter;
  }
  addImage(...args) { this.imageCalls.push(['addImage', ...args]); }
  updateImage(...args) { this.imageCalls.push(['updateImage', ...args]); }
  lose() { this.gl.lose(); this.emit('webglcontextlost'); }
  restore() {
    this.gl.restore(); this.painter = this.makePainter();
    // Programs may be compiled while the replacement painter is initialized,
    // before MapLibre emits its restoration event. Do not discard these records.
    const restoredProgram = program(this.gl);
    this.emit('webglcontextrestored'); return restoredProgram;
  }
  draw(layer = { id: 'ordinary-building' }) {
    this.painter.id = layer.id;
    this.painter.drawFunctions.fillExtrusion(this.painter, null, layer);
    return this.gl.draws.at(-1);
  }
  circle(id) {
    this.painter.id = id; this.painter.drawFunctions.circle(this.painter, null, { id });
    return this.gl.draws.at(-1);
  }
}

function fixture() {
  const errors = [], gl = new TestGL(), map = new TestMap(gl);
  const context = vm.createContext({
    THREE, console: { error: (...args) => errors.push(args.join(' ')) },
    CityNight: { tune: { on: true, downlightCone: [-.05, .25] }, crown: { ambient: .4, direction: [.3, -.6, .7] }, lamps: () => 1, nearest: () => [] },
    NIGHT_TUNE: { DEPTH_POOLS: true, POOL_ELEVATION_M: .42 },
    PLACES_T: { MULL: 4 }, PatternLowpass: { blurWrap() {} },
  });
  context.window = context;
  vm.runInContext(source, context, { filename: 'js/city-lighting.js' });
  const lighting = context.CityLighting;
  const U = { u_eye: { value: new THREE.Vector3() }, u_shadowSettings: { value: new THREE.Vector4(0, 0, 0, 0) } };
  const frame = textures => lighting.frame(U, new THREE.Matrix4(), textures);
  const methods = Object.fromEntries(['shaderSource', 'compileShader', 'linkProgram', 'getUniformLocation', 'useProgram', 'uniformMatrix4fv', 'drawElements', 'drawArrays'].map(name => [name, gl[name]]));
  const imageMethods = { addImage: map.addImage, updateImage: map.updateImage };
  const compiledGlass = { id: 'compiled-gdc-glass-42', metadata: { 'flyover:hero-layer': 'heroes-gdc-glass' } };
  const complete = texture => {
    assert(texture && texture.epoch === gl.epoch && !texture.deleted, 'fallback belongs to the live context');
    assert.equal(texture.width, 1); assert.equal(texture.height, 1);
    assert.deepEqual(texture.pixels, [255, 255, 255, 255]);
    assert.equal(texture.filters.get(gl.TEXTURE_MIN_FILTER), gl.NEAREST);
    assert.equal(texture.filters.get(gl.TEXTURE_MAG_FILTER), gl.NEAREST);
  };
  const fallbackDraw = () => {
    frame(); const draw = map.draw(compiledGlass);
    complete(draw.textures[0]); assert.equal(draw.textures[0], draw.textures[1]);
    assert.equal(draw.surface, 3, 'compiled GDC retains the authored glass material on the live painter');
    assert.equal(map.draw().surface, 0, 'the next ordinary layer resets the material semantic');
    assert.equal(U.u_cityNight.value.x, 1, 'exercise a cold night frame with shadow sampling disabled');
    return draw.textures[0];
  };
  const verifyRemoval = () => {
    map.emit('remove');
    assert.equal(map.listenerCount('webglcontextlost'), 0);
    assert.equal(map.listenerCount('webglcontextrestored'), 0);
    assert.equal(map.listenerCount('remove'), 0);
    for (const [name, fn] of Object.entries(methods)) assert.equal(gl[name], fn, 'restore GL method ' + name);
    for (const [name, fn] of Object.entries(imageMethods)) assert.equal(map[name], fn, 'restore image method ' + name);
    for (const painter of map.painters) assert.equal(painter.drawFunctions, painter.originalDrawFunctions, 'release painter hooks');
    assert(!gl.__cityLighting, 'a removed adapter must not leave an installation latch');
    const allocated = gl.textures.length;
    map.emit('webglcontextrestored'); map.emit('webglcontextlost'); map.emit('remove');
    assert.equal(gl.textures.length, allocated, 'late events cannot revive a removed adapter');
    assert.deepEqual(errors, [], 'production shader instrumentation reports no failures');
  };
  return { gl, map, lighting, frame, fallbackDraw, verifyRemoval, errors };
}

const f = fixture(), { gl, map, lighting, frame, fallbackDraw } = f;
const sentinel = gl.createTexture();
gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, sentinel);
lighting.install(map);
assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), sentinel, 'fallback allocation preserves the existing binding');
assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE), gl.TEXTURE0 + 3);
const wrappedDraw = gl.drawElements, wrappedImage = map.addImage;
lighting.install(map);
assert.equal(gl.drawElements, wrappedDraw); assert.equal(map.addImage, wrappedImage);
assert.equal(gl.textures.length, 2, 'install is idempotent');
program(gl);
const initialFallback = fallbackDraw();
assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), sentinel, 'extrusion draws restore the active texture unit');
assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE), gl.TEXTURE0 + 3);

// A daylight frame can retain real renderer shadow handles immediately before
// loss. Re-publishing it while lost must not carry those handles into recovery.
const oldShadows = [gl.createTexture(), gl.createTexture()];
frame(oldShadows); assert.deepEqual(map.draw().textures, oldShadows);
const fallbacks = [initialFallback];
for (let cycle = 0; cycle < 2; cycle++) {
  const oldPainter = map.painter;
  map.lose(); frame(oldShadows);
  const restoredProgram = map.restore();
  const beforeFrame = map.draw();
  assert.deepEqual(beforeFrame.textures, [null, null], 'a restored painter cannot consume a stale lighting frame');
  const fallback = fallbackDraw(); fallbacks.push(fallback);
  assert.notEqual(fallback, fallbacks.at(-2), 'each restoration allocates a fresh complete fallback');
  assert.equal(map.painter.context.gl, gl, 'exercise the same context JavaScript object');
  assert.equal(oldPainter.drawFunctions, oldPainter.originalDrawFunctions, 'release superseded painter hooks');
  assert.equal(gl.drawElements, wrappedDraw, 'restoration does not stack GL hooks');
  assert.equal(map.addImage, wrappedImage, 'restoration does not stack image hooks');
  assert.equal(map.listenerCount('webglcontextlost'), 1);
  assert.equal(map.listenerCount('webglcontextrestored'), 1);

  program(gl, true);
  const originalDepth = map.painter.getDepthModeForSublayer;
  assert.equal(map.circle('night-streetlight-pool').poolLift, .42, 'ground lights use the replacement painter id');
  assert.equal(map.painter.lastDepth.source, '3d'); assert.equal(map.painter.lastDepth.mask, false);
  assert.equal(map.painter.getDepthModeForSublayer, originalDepth, 'restore the depth override after each draw');
  assert.equal(map.circle('ordinary-circle').poolLift, 0);
  assert.equal(map.painter.lastDepth.source, '2d'); assert.equal(map.painter.lastDepth.mask, true);
  gl.useProgram(restoredProgram);

  const imageCount = lighting.stats.glassImages;
  const pixels = { width: 4, height: 4, data: new Uint8Array(64).fill(255) };
  map.addImage('pl-glass', pixels); map.updateImage('pl-glass', pixels);
  assert.equal(lighting.stats.glassImages - imageCount, 2, 'each image receives one semantic mask');
  assert.equal(pixels.data[7], 255, 'the caller retains its original image pixels');
}
assert.equal(lighting.stats.programs, 3, 'programs compiled before each restoration event remain instrumented once');
assert.equal(lighting.stats.vertexShaders, 3); assert.equal(lighting.stats.fragmentShaders, 3);
assert.equal(lighting.stats.poolPrograms, 2);
assert.equal(gl.textures.length, 6, 'each live context owns exactly one fallback texture');
f.verifyRemoval();
assert.deepEqual(gl.deleted, [fallbacks.at(-1)], 'delete only the current context fallback');

// Removing a map while its context is lost also releases every listener and
// wrapper, without trying to delete an already-invalid GPU handle.
const lost = fixture();
lost.lighting.install(lost.map); program(lost.gl); lost.fallbackDraw();
lost.map.lose(); lost.verifyRemoval(); assert.equal(lost.gl.deleted.length, 0);
console.log('PASS CityLighting cold-night fallback, two context losses, painter materials/depth, non-stacking hooks and removal cleanup');
