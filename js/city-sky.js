/**
 * city-sky.js — THE APP'S LIGHT, in one place: the sky and the sun for the hour, and the shader code that lights a surface with them.
 *
 * WHY. The app's shader lights a shaded wall with one flat colour and paints "lit colours" on faces. A building made in Blender and
 * rendered there looks far better than the same model drawn that way. proto/blender-look.html showed what the difference is: light
 * from the WHOLE sky in the sky's own colours, the ground's bounce, a sun, real materials, glass that mirrors that same sky. This
 * file is that light, written for the app's own shader (not three.js's built-in one: the three.js release the app ships gets the
 * sky's light on a wall 6 to 8 % wrong, and only the app's own shader can read the app's shadow maps and packed city).
 *
 * WHO USES IT. Today the Blender-built buildings (js/gltf-look.js, behind ?gltf=1). It is written so that the recipes' shader
 * (js/slopes.js) can take the same three functions later: nothing in it knows about any building.
 *
 * WHAT IT GIVES, for an hour p (0..1, the app's own clock) — CitySky.at(p):
 *   sunDir      the direction to the one light with a direction (the sun by day, the moon at night), east / north / up
 *   sunStrength its strength, linear red / green / blue (0 when neither is up)
 *   stops       the sky's colour by the sine of the height above the level line (linear), before the gain
 *   gain        what the sky is multiplied by when it LIGHTS something (see TUNE.skyGain)
 *   ground      what a ray below the level line sees: the lit ground
 *   light[17]   the light the whole sky and ground throw on a surface, by how far the surface tilts up (its normal's up part,
 *               -1 .. 1 in 17 steps): the exact sum over the sky, made again only when the hour changes
 * and GLSL (CitySky.glsl) with three functions for a fragment shader:
 *   csSkyLight(n)   light from the sky and ground on a surface with normal n (irradiance; times albedo / pi = what the eye gets)
 *   csMirror(d)     what a mirror shows in direction d
 *   csDisplay(c)    linear light to the screen: the sRGB curve, nothing else (Blender's "Standard" view transform)
 * No texture: 17 colours and 7 stops per hour. Nothing here costs memory, and a new hour costs a millisecond of arithmetic.
 *
 * THE GRADE. The app lays one tone table over the whole canvas (js/graphics.js: brightness, contrast, a film curve), tuned for
 * painted colours. A surface lit by this file is already a finished picture, so csDisplay() can cancel that table for its own
 * pixels (TUNE.undoGrade): what reaches the screen is then the same picture the test page shows. ?skygrade=1 leaves the grade on.
 *
 * Public: window.CitySky = { tune, at(p), glsl, uniforms(), sync(uniforms, p) }.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? v : d; };

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11. The day sky, the gain, the ground and the sun's strength are the Blender scene's own
  //  numbers (proto/blender-look.html has the same ones); dusk, night and the moon are choices of this file.
  // ══════════════════════════════════════════════════════════════════════
  const TUNE = {
    // the sky by the sine of the height above the level line, sRGB 0..255: far land up to `landTop`, the horizon colour just above it, then the stops
    day:   { land: [108, 128, 138], horizon: [190, 210, 226], stops: [[0.045, [181, 203, 222]], [0.153, [119, 170, 224]], [0.26, [88, 139, 202]], [0.6, [55, 100, 180]]] },
    dusk:  { land: [92, 78, 84],    horizon: [255, 176, 110], stops: [[0.045, [244, 170, 120]], [0.153, [170, 150, 170]], [0.26, [96, 112, 168]], [0.6, [44, 64, 128]]] },
    night: { land: [10, 13, 20],    horizon: [18, 24, 40],    stops: [[0.045, [15, 20, 36]], [0.153, [10, 14, 28]], [0.26, [7, 10, 22]], [0.6, [4, 6, 14]]] },
    landTop: 0.004,
    dayAbove: 25, duskAt: 4, nightBelow: -8,     // sun height (degrees) at which the sky is fully day, fully dusk, fully night
    // What the sky is multiplied by when it lights a surface (red, green, blue). The Blender scene lifts its shade light this way; a
    // mirror shows the sky without it (the glass's mirror colour in the model is already divided by it).
    skyGain: [6.226384530578516, 4.0023751489194686, 2.449166880354],
    ambient: num('skyambient', 1),               // scales all sky light (1 = as the scene)
    ground: [0.1, 0.125, 0.07],                  // the ground's colour (linear) for the bounce and for mirrors
    groundEdge: -0.01,                           // below this sine a ray sees the ground; above it, the far land
    tree: { amp: 0.014, lift: -0.01, scale: 90 },// the far tree line as lights and mirrors see it: a little above level, ragged
    mirrorSoft: 0.004,                           // how far (in sine) a mirror's picture of the level line is spread: glass is not a perfect mirror
    sunStrength: [1.5653356029720626, 1.5273819360186915, 0.9085198081828816],   // the sun high in the sky (linear; 1 = a white wall facing it returns 1 / pi)
    sunWarmBelow: 25, sunGoneAt: -1, sunFullAt: 5,   // degrees: the sun warms below this height; it fades out between the last two
    sunWarm: [0, 0.35, 0.65],                    // how much green and blue the low sun loses
    nightLift: 3.0,                              // a city sky at night is not black: its light is multiplied by this at full night
    moon: [0.035, 0.045, 0.07],                  // the moon's strength at full night (linear)
    undoGrade: q.get('skygrade') !== '1',        // cancel the app's canvas tone table for surfaces under this light (see the header)
  };

  const lin = c => c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const LIN = {}; for (const k of ['day', 'dusk', 'night']) LIN[k] = { land: lin(TUNE[k].land), horizon: lin(TUNE[k].horizon), stops: TUNE[k].stops.map(([z, c]) => [z, lin(c)]) };
  const blend = (A, B, t) => ({ land: mix3(A.land, B.land, t), horizon: mix3(A.horizon, B.horizon, t), stops: A.stops.map(([z, c], i) => [z, mix3(c, B.stops[i][1], t)]) });
  function skyFor(elev) {
    if (elev >= TUNE.dayAbove) return LIN.day;
    if (elev >= TUNE.duskAt) return blend(LIN.dusk, LIN.day, (elev - TUNE.duskAt) / (TUNE.dayAbove - TUNE.duskAt));
    if (elev >= TUNE.nightBelow) return blend(LIN.night, LIN.dusk, (elev - TUNE.nightBelow) / (TUNE.duskAt - TUNE.nightBelow));
    return LIN.night;
  }
  const rampPoints = sky => [[-0.02, sky.land], [TUNE.landTop, sky.land], [TUNE.landTop + 0.002, sky.horizon], ...sky.stops];
  function rampAt(pts, z) {
    if (z <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (z <= pts[i][0]) return mix3(pts[i - 1][1], pts[i][1], (z - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
    return pts[pts.length - 1][1];
  }
  const dirOf = b => { const az = b.az * Math.PI / 180, el = b.elev * Math.PI / 180; return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)]; };

  let _key = null, _state = null;
  /** the sky and the sun for hour p (0..1). `ref` (a test harness may hand one in as window.CITY_SKY_REF) replaces the sun: { sunDir, sunStrength } */
  function at(p) {
    const ref = window.CITY_SKY_REF || null, key = p.toFixed(4) + (ref ? 'r' : '');
    if (key === _key) return _state;
    const bodies = window.skyBodies ? window.skyBodies(p) : { sun: { az: 180, elev: 55 }, moon: { az: 140, elev: -10 } };
    const elev = ref ? 90 : bodies.sun.elev, sky = skyFor(elev), pts = rampPoints(sky), nightness = clamp01((TUNE.duskAt - elev) / (TUNE.duskAt - TUNE.nightBelow + 2));
    // the one light with a direction
    let sunDir = dirOf(bodies.sun), sunStrength;
    const up = clamp01((elev - TUNE.sunGoneAt) / (TUNE.sunFullAt - TUNE.sunGoneAt)), warm = clamp01((TUNE.sunWarmBelow - elev) / (TUNE.sunWarmBelow - TUNE.duskAt));
    sunStrength = TUNE.sunStrength.map((v, i) => v * up * (1 - TUNE.sunWarm[i] * warm));
    if (up <= 0 && bodies.moon && bodies.moon.elev > 2) { sunDir = dirOf(bodies.moon); sunStrength = TUNE.moon.map(v => v * nightness); }
    if (ref) { sunDir = ref.sunDir; sunStrength = ref.sunStrength; }
    const gain = TUNE.skyGain.map(v => v * TUNE.ambient * (1 + (TUNE.nightLift - 1) * nightness));
    // the lit ground: what the sky alone and the sun put on it, times its colour
    let skyOnGround = [0, 0, 0], wsum = 0;
    for (let k = 0; k < 64; k++) { const z = (k + 0.5) / 64, c = rampAt(pts, z); for (let i = 0; i < 3; i++) skyOnGround[i] += c[i] * gain[i] * z; wsum += z; }
    const ground = TUNE.ground.map((a, i) => a * (skyOnGround[i] / wsum + sunStrength[i] * Math.max(0, sunDir[2]) / Math.PI));
    // what a light sees in a direction of sine z (the tree line at its mean height)
    const shift = 0.5 * TUNE.tree.amp + TUNE.tree.lift;
    const seen = z => { if (z < TUNE.groundEdge) return ground; const c = rampAt(pts, z - shift); return [c[0] * gain[0], c[1] * gain[1], c[2] * gain[2]]; };
    // the light on a surface, by the up part of its normal: the sum over the whole sphere of what is seen times the cosine
    const N = 17, light = [], RINGS = 180, SEG = 48;
    const ringZ = [], ringW = [], ringC = [];
    for (let r = 0; r < RINGS; r++) { const th = (r + 0.5) / RINGS * Math.PI, z = Math.cos(th); ringZ.push(z); ringW.push(Math.sin(th) * (Math.PI / RINGS) * (2 * Math.PI / SEG)); ringC.push(seen(z)); }
    const cosPhi = Array.from({ length: SEG }, (_, s) => Math.cos((s + 0.5) / SEG * 2 * Math.PI));
    for (let k = 0; k < N; k++) {
      const nz = -1 + 2 * k / (N - 1), nx = Math.sqrt(Math.max(0, 1 - nz * nz)), E = [0, 0, 0];
      for (let r = 0; r < RINGS; r++) {
        const z = ringZ[r], sx = Math.sqrt(Math.max(0, 1 - z * z)); let c = 0;
        for (let s = 0; s < SEG; s++) c += Math.max(0, nx * sx * cosPhi[s] + nz * z);
        for (let i = 0; i < 3; i++) E[i] += ringC[r][i] * c * ringW[r];
      }
      light.push(E);
    }
    _key = key;
    _state = { p, elev, nightness, sunDir, sunStrength, pts, gain, ground, light };
    return _state;
  }

  // ── the canvas tone table, turned round (TUNE.undoGrade) ────────────────
  // js/graphics.js writes one table for red, green and blue into an SVG filter on the map. Its inverse, as a 256-step texture, lets a
  // shader write the value that the table will turn into the value it wants. Made again only when the table's text changes.
  let _undoText = null, _undoTex = null, _undoOn = 0;
  function undoTexture() {
    const T = window.THREE; if (!T) return null;
    let text = '';
    if (TUNE.undoGrade) { const el = document.querySelector('#a3d-tone feFuncR'), map = document.getElementById('map'); if (el && map && /a3d-tone/.test(map.style.filter || '')) text = el.getAttribute('tableValues') || ''; }
    if (text === _undoText && _undoTex) return _undoTex;
    _undoText = text;
    const tab = text ? text.trim().split(/\s+/).map(Number) : [0, 1], n = tab.length - 1, data = new Uint8Array(256 * 4);
    const fwd = x => { const f = clamp01(x) * n, i = Math.min(n - 1, Math.floor(f)); return tab[i] + (tab[i + 1] - tab[i]) * (f - i); };
    for (let k = 0; k < 256; k++) {
      const y = k / 255; let lo = 0, hi = 1;
      for (let it = 0; it < 22; it++) { const m = (lo + hi) / 2; if (fwd(m) < y) lo = m; else hi = m; }
      const v = Math.round(255 * (lo + hi) / 2); data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = v; data[k * 4 + 3] = 255;
    }
    if (_undoTex) _undoTex.dispose();
    _undoTex = new T.DataTexture(data, 256, 1, T.RGBAFormat, T.UnsignedByteType);
    _undoTex.magFilter = _undoTex.minFilter = T.LinearFilter; _undoTex.generateMipmaps = false; _undoTex.wrapS = _undoTex.wrapT = T.ClampToEdgeWrapping;
    if ('colorSpace' in _undoTex && T.NoColorSpace !== undefined) _undoTex.colorSpace = T.NoColorSpace;
    _undoTex.needsUpdate = true; _undoOn = text ? 1 : 0;
    return _undoTex;
  }

  const glsl = `
    uniform vec3 u_csLight[17];
    uniform float u_csZ[7];
    uniform vec3 u_csC[7];
    uniform vec3 u_csGain, u_csGround, u_csSun, u_csSunDir;
    uniform vec4 u_csTree;          // amp, lift, scale, ground edge
    uniform float u_csSoft, u_csUndoOn;
    uniform sampler2D u_csUndo;
    // light from the whole sky and the ground on a surface with normal n (east, north, up)
    vec3 csSkyLight(vec3 n) {
      float t = clamp(n.z * 0.5 + 0.5, 0.0, 1.0) * 16.0; int i = int(min(floor(t), 15.0));
      return mix(u_csLight[i], u_csLight[i + 1], t - float(i));
    }
    vec3 csRamp(float z) {
      vec3 c = u_csC[0];
      for (int i = 1; i < 7; i++) c = mix(c, u_csC[i], clamp((z - u_csZ[i - 1]) / max(u_csZ[i] - u_csZ[i - 1], 1e-6), 0.0, 1.0));
      return c;
    }
    float csHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
    float csNoise(float x) { float i = floor(x), f = x - i, u = f * f * (3.0 - 2.0 * f); return mix(csHash(i), csHash(i + 1.0), u); }
    // what a mirror's ray sees in direction d: the lit sky, a ragged far tree line, the lit ground below
    vec3 csMirror(vec3 d) {
      d = normalize(d);
      float a = (atan(d.y, d.x) / 6.2831853 + 0.5) * u_csTree.z * 6.2831853;
      float rag = (csNoise(a) * 0.5 + csNoise(a * 2.03 + 17.0) * 0.25 + csNoise(a * 4.01 + 31.0) * 0.15 + csNoise(a * 8.1 + 47.0) * 0.1) * u_csTree.x + u_csTree.y;
      float z = d.z - rag;
      vec3 sky = (csRamp(z - u_csSoft) + 2.0 * csRamp(z) + csRamp(z + u_csSoft)) * 0.25 * u_csGain;
      return mix(u_csGround, sky, smoothstep(u_csTree.w - u_csSoft, u_csTree.w + u_csSoft, d.z));
    }
    // linear light to the screen: the sRGB curve (and, when asked, the value the canvas tone table will turn into it)
    vec3 csDisplay(vec3 c) {
      c = clamp(c, 0.0, 1.0);
      vec3 s = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
      if (u_csUndoOn > 0.5) { vec3 k = s * (255.0 / 256.0) + 0.5 / 256.0; s = vec3(texture2D(u_csUndo, vec2(k.r, 0.5)).r, texture2D(u_csUndo, vec2(k.g, 0.5)).r, texture2D(u_csUndo, vec2(k.b, 0.5)).r); }
      return s;
    }`;

  /** a fresh set of this light's uniforms (each material keeps its own; sync() fills them) */
  function uniforms() {
    const T = window.THREE, V = () => new T.Vector3();
    return { u_csLight: { value: Array.from({ length: 17 }, V) }, u_csZ: { value: new Float32Array(7) }, u_csC: { value: Array.from({ length: 7 }, V) },
      u_csGain: { value: V() }, u_csGround: { value: V() }, u_csSun: { value: V() }, u_csSunDir: { value: new T.Vector3(0, 0, 1) }, u_csTree: { value: new T.Vector4() },
      u_csSoft: { value: TUNE.mirrorSoft }, u_csUndoOn: { value: 0 }, u_csUndo: { value: null }, _csKey: { value: '' } };
  }
  /** fill a material's uniforms for hour p (cheap when nothing changed) */
  function sync(u, p) {
    const s = at(p), tex = undoTexture();
    u.u_csUndo.value = tex; u.u_csUndoOn.value = _undoOn;
    const key = _key + '|' + TUNE.ambient;
    if (u._csKey.value === key) return s;
    u._csKey.value = key;
    s.light.forEach((c, i) => u.u_csLight.value[i].set(c[0], c[1], c[2]));
    s.pts.forEach(([z, c], i) => { u.u_csZ.value[i] = z; u.u_csC.value[i].set(c[0], c[1], c[2]); });
    // a mirror's ray sees what every ray but the camera's sees: the sky WITH the light gain. (A model's mirror colour is divided by the
    // gain where it was made, so mirror colour times this is the plain sky times the glass's own tint.)
    u.u_csGain.value.set(s.gain[0], s.gain[1], s.gain[2]);
    u.u_csGround.value.set(s.ground[0], s.ground[1], s.ground[2]);
    u.u_csSun.value.set(s.sunStrength[0], s.sunStrength[1], s.sunStrength[2]);
    u.u_csSunDir.value.set(s.sunDir[0], s.sunDir[1], s.sunDir[2]);
    u.u_csTree.value.set(TUNE.tree.amp, TUNE.tree.lift, TUNE.tree.scale, TUNE.groundEdge);
    return s;
  }
  window.CitySky = { tune: TUNE, at, glsl, uniforms, sync };
})();
