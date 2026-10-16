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
 *   ground      what a LIGHT sees below the level line: the lit ground (a mirror sees groundMirror there)
 *   light[17]   the light the whole sky and ground throw on a surface, by how far the surface tilts up (its normal's up part,
 *               -1 .. 1 in 17 steps): the exact sum over the sky, made again only when the hour changes
 * and GLSL (CitySky.glsl) with three functions for a fragment shader:
 *   csSkyLight(n)   light from the sky and ground on a surface with normal n (irradiance; times albedo / pi = what the eye gets)
 *   csMirror(d)     what a mirror shows in direction d
 *   csMirrorStd(d, band)  what the builders' standard glass mirrors: the plain sky above the street opposite, the street below it
 *   csDisplay(c)    linear light to the screen: the view's exposure (1 unless asked), then the sRGB curve, nothing else (Blender's "Standard")
 * No texture: 17 colours and 7 stops per hour. Nothing here costs memory, and a new hour costs a millisecond of arithmetic.
 *
 * THE GRADE. The app lays one tone table over the whole canvas (js/graphics.js: brightness, contrast, a film curve), tuned for
 * painted colours. A surface lit by this file is already a finished picture, so csDisplay() can cancel that table for its own
 * pixels (TUNE.undoGrade): what reaches the screen is then the same picture the test page shows. ?skygrade=1 leaves the grade on.
 *
 * A SECOND, NAMED LIGHT: 'soft' (TUNE.soft), the Blender builders' no-sun light. atMode(p, 'soft') and sync(uniforms, p, 'soft') give it;
 * at(p) and a sync() without a name are the hour's own light, as before.
 *
 * Public: window.CitySky = { tune, at(p), atMode(p, mode), glsl, uniforms(), sync(uniforms, p, mode) }.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? v : d; };

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11. The day sky and the gain are the first Blender scene's own numbers (proto/blender-look.html has
  //  the same ones); the sun's strength and the ground's colour are measured on site photographs (below); dusk, night and the
  //  moon are choices of this file. scripts/blender_light_rig.py carries these numbers into Blender (node scripts/city-sky-rig.mjs).
  // ══════════════════════════════════════════════════════════════════════
  // LIGHT B (owner, 2026-10-15: "B definitely"). Shade and undersides rendered far darker than his photographs, and glass that mirrors
  // the sky far darker and greyer (flyover-private rig study, sections 1-7: soffits 0.35-0.42 of the photograph, sky-mirroring glass
  // 0.60). B lifts the light that does NOT come straight from the sun and keeps sunlit walls where they were:
  //   sky     how much the sky lights a surface, times the scene's gain (A: 1)
  //   ground  the ground's colour for the bounce it throws up at walls (A: 0.16; B doubles it: it stands for sunlit pavement AND the
  //           sunlit walls across the street, which a single grey plane under-counts)
  //   sun     the measured sun, times this (A: 1; 0.84 holds a wall lit mostly by the sun where it was, against the lifted sky)
  //   mirror  the sky as a MIRROR sees it, times this (A: 1). What lights shade and what a pane mirrors are two different numbers: raising
  //           the sky that lights moved glass only 0.60 -> 0.65 of the photograph; the mirror's own sky moves it (x1.8 gave 1.08, so 1.6).
  // ?skyrig=a gives the light before 2026-10-15 (A); ?skyambient= ?skyground= ?skysun= ?skymirror= override one number each.
  // The Blender rig carries both lights (RIG = A, RIG_B = B; node scripts/city-sky-rig.mjs): builders switch with FLYOVER_RIG=B.
  const LIGHTS = { a: { sky: 1, ground: 0.16, sun: 1, mirror: 1 }, b: { sky: 1.5, ground: 0.32, sun: 0.84, mirror: 1.6 } };
  const LIGHT = LIGHTS[(q.get('skyrig') || 'b').toLowerCase()] || LIGHTS.b;
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
    ambient: num('skyambient', LIGHT.sky),       // scales all sky light (1 = as the scene; LIGHT B: 1.5)
    mirrorSky: num('skymirror', LIGHT.mirror),   // the sky as a mirror sees it, times this (glass; LIGHT B: 1.6). Lighting is not changed by it.
    // The ground's colour (linear) for the light it throws back up at walls. It stands for everything below the level line that lights a
    // wall in shade: pavement, and the sunlit walls across the street. NEUTRAL, and MEASURED (2026-10-12 night) on the five pale walls that
    // three site photographs show both in sun and in shade: with this grey their shaded pixels come out at 1.01 / 1.03 / 1.04 (red, green,
    // blue) of the photographs'. The value before, 0.1 / 0.125 / 0.07, was one Blender scene's lawn: it left the same walls at 0.83 / 0.95 /
    // 0.85, which is a green cast of about 13 % on every wall in shade (and plain green on a recessed wall with no sun at all).
    // LIGHT B doubles it (see LIGHT above): the measured 0.16 matched the five walls' shade under light A, but undersides and recesses
    // stayed at 0.35-0.46 of the photographs.
    ground: [0, 1, 2].map(() => num('skyground', LIGHT.ground)),
    groundMirror: [0.1, 0.125, 0.07],            // what a MIRROR ray sees below the level line (glass seen from above): not changed with the bounce
    groundEdge: -0.01,                           // below this sine a ray sees the ground; above it, the far land
    tree: { amp: 0.014, lift: -0.01, scale: 90 },// the far tree line as lights and mirrors see it: a little above level, ragged
    mirrorSoft: 0.004,                           // how far (in sine) a mirror's picture of the level line is spread: glass is not a perfect mirror
    // The sun high in the sky (linear; 1 = a white wall facing it returns 1 / pi). MEASURED on three site photographs taken in full sun
    // (measured 2026-10-12): the one strength per channel at which each wall material's sunlit pixels and shaded pixels give the same colour under
    // the sky above, pooled over 14 materials of three buildings (single photographs gave 8 to 34). The first value here, 1.57 / 1.53 /
    // 0.91, was one Blender scene's own sun, set for a photograph of walls in shade: under it a sunlit wall was only 1.6 times a shaded
    // one, where the photographs show 3 to 10 times (most between 4 and 7). `?skysun=` scales it.
    // one sun (LIGHT B: x0.84, so a sunlit wall stays where it was under the lifted sky).
    sunStrength: [23.65, 21.64, 18.95].map(v => v * num('skysun', LIGHT.sun)),
    sunWarmBelow: 25, sunGoneAt: -1, sunFullAt: 5,   // degrees: the sun warms below this height; it fades out between the last two
    sunWarm: [0, 0.35, 0.65],                    // how much green and blue the low sun loses
    nightLift: 3.0,                              // a city sky at night is not black: its light is multiplied by this at full night
    moon: [0.035, 0.045, 0.07],                  // the moon's strength at full night (linear)
    // The view's exposure for surfaces under this light: what the camera does, not what any building is. 1 = a photograph taken in full
    // sun. A test harness may hand in another for one picture (window.CITY_SKY_REF.exposure): the tower's site photograph was taken
    // under a veiled sun and a cloud-bright sky, and reads 4.4 on this scale (docs/gltf-layer.md).
    exposure: num('skyexp', 1),
    // THE SOFT LIGHT: a second, named light for surfaces under this file (js/gltf-layer.js `look.light`, &gltflight=soft). It is the Blender
    // builders' NO-SUN light (their light rig's weather 'overcast', the light most builds were made and scored under), by day:
    //   zenith, ground   the rig's grey sky, three times as bright overhead as at the level line (a level roof gets exactly 1 unit of light / pi,
    //                    an open wall 0.45 with the ground's bounce), and the ground under it. No sun, so no sun shadow.
    //   exposure         the rig's one exposure number. 9.86 is the MEDIAN of the exposures the builders found for their own no-sun photographs
    //                    (30 builds, 5.4 to 21.8): under it an open wall of the rig's standard white paint (0.17) is shown at 0.755 as light
    //                    (225 of 255), where those builders' renders have it. A sunlit white wall under the noon light is 243.
    //   seen, street     what a MIRROR sees under that sky: an even blue-grey sky, and the walls across the street below it (the rig's values)
    // Toward dusk and night it gives way to the hour's own light (between `dayAbove` and `duskAt` degrees of sun height), so night is unchanged.
    soft: { zenith: 9 / 7, ground: 0.108, exposure: num('skysoftexp', 9.86), seen: [0.14, 0.18, 0.22], street: [0.023, 0.025, 0.027] },
    // THE STANDARD GLASS's mirror (the builders' rig, 2026-10-12): below the street's top edge a mirror sees the far land under haze (the
    // land colour times `landHaze`); below the level line the ground in `groundSeen` (its colour for mirror rays, times the light on it).
    landHaze: [1.0, 1.15, 1.35], groundSeen: [0.024, 0.041, 0.058],
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
    const onGround = [0, 1, 2].map(i => skyOnGround[i] / wsum + sunStrength[i] * Math.max(0, sunDir[2]) / Math.PI);
    const ground = TUNE.ground.map((a, i) => a * onGround[i]), groundMirror = TUNE.groundMirror.map((a, i) => a * onGround[i]);
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
    // what the standard glass's mirror sees (no gain: a mirror sees the sky as a camera does): the street opposite, the lit ground
    const street = pts[0][1].map((v, i) => v * TUNE.landHaze[i]), groundStd = TUNE.groundSeen.map((a, i) => a * onGround[i]);
    _state = { p, elev, nightness, sunDir, sunStrength, pts, gain, ground, groundMirror, light, street, groundStd, exposure: (ref && ref.exposure) || TUNE.exposure };
    return _state;
  }

  // ── the soft light (TUNE.soft) ──────────────────────────────────────────
  // light / pi on a face under the no-sun sky, by the up part of its normal (17 steps): the same sum the builders' rig makes
  let _softTab = null, _softTabKey = '';
  function softTable() {
    const S = TUNE.soft, key = S.zenith + '|' + S.ground; if (_softTab && key === _softTabKey) return _softTab;
    const out = [], RINGS = 90, SEG = 48;
    for (let k = 0; k < 17; k++) {
      const nz = -1 + 2 * k / 16, nx = Math.sqrt(Math.max(0, 1 - nz * nz)); let e = 0;
      for (let r = 0; r < RINGS; r++) {
        const th = (r + 0.5) / RINGS * Math.PI, z = Math.cos(th), sx = Math.sin(th), L = z >= 0 ? S.zenith * (1 + 2 * z) / 3 : S.ground; let c = 0;
        for (let q2 = 0; q2 < SEG; q2++) c += Math.max(0, nx * sx * Math.cos((q2 + 0.5) / SEG * 2 * Math.PI) + nz * z);
        e += L * c * sx * (Math.PI / RINGS) * (2 * Math.PI / SEG);
      }
      out.push(e / Math.PI);
    }
    _softTabKey = key; return (_softTab = out);
  }
  let _softKey = null, _softState = null;
  /** the light named `mode` for hour p: 'soft' = TUNE.soft by day, the hour's own light toward night; anything else = at(p) */
  function atMode(p, mode) {
    const s = at(p); if (mode !== 'soft') return s;
    const S = TUNE.soft, key = _key + '|soft|' + [S.zenith, S.ground, S.exposure, S.seen, S.street].join();
    if (key === _softKey) return _softState;
    const t = clamp01((s.elev - TUNE.duskAt) / (TUNE.dayAbove - TUNE.duskAt)), k = S.exposure, tab = softTable();
    // The exposure is folded into the light (and into what a mirror sees), so that the view's own exposure stays the hour's and the two
    // lights can be mixed toward dusk. A mirror colour of the older glass is divided by the gain where it was made, hence `/ gain` nowhere:
    // csMirror() multiplies the stops by the gain, and so does the ground entry below.
    const seen = S.seen.map(v => v * k), street = S.street.map(v => v * k);
    _softKey = key;
    _softState = Object.assign({}, s, {
      mode: 'soft', share: t,
      sunStrength: s.sunStrength.map(v => v * (1 - t)),
      light: s.light.map((c, i) => c.map(v => v + (tab[i] * Math.PI * k - v) * t)),
      pts: s.pts.map(([z, c]) => [z, mix3(c, seen, t)]),
      groundMirror: mix3(s.groundMirror, street.map((v, i) => v * s.gain[i]), t),
      street: mix3(s.street, street, t), groundStd: mix3(s.groundStd, street, t),
    });
    return _softState;
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
    uniform vec3 u_csGain, u_csGround, u_csSun, u_csSunDir, u_csStreet, u_csGroundStd;
    uniform vec4 u_csTree;          // amp, lift, scale, ground edge
    uniform float u_csSoft, u_csUndoOn, u_csExposure;
    uniform vec2 u_csMirrorK;       // the sky as a mirror sees it, times: x for csMirror (its gain already holds the sky's lift), y for csMirrorStd (TUNE.mirrorSky)
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
      vec3 sky = (csRamp(z - u_csSoft) + 2.0 * csRamp(z) + csRamp(z + u_csSoft)) * 0.25 * u_csGain * u_csMirrorK.x;
      return mix(u_csGround, sky, smoothstep(u_csTree.w - u_csSoft, u_csTree.w + u_csSoft, d.z));
    }
    // what THE STANDARD GLASS mirrors in direction d: the sky as a camera sees it (no gain) above the street opposite, the street below
    // band (the sine of the street's top edge, from and to: a soft step), the lit ground below the level line
    vec3 csMirrorStd(vec3 d, vec2 band) {
      d = normalize(d);
      vec3 sky = (csRamp(d.z - u_csSoft) + 2.0 * csRamp(d.z) + csRamp(d.z + u_csSoft)) * 0.25 * u_csMirrorK.y;
      vec3 c = mix(u_csStreet, sky, smoothstep(band.x, band.y, d.z));
      return mix(u_csGroundStd, c, smoothstep(u_csTree.w - u_csSoft, u_csTree.w + u_csSoft, d.z));
    }
    // linear light to the screen: the sRGB curve (and, when asked, the value the canvas tone table will turn into it)
    vec3 csDisplay(vec3 c) {
      c = clamp(c * u_csExposure, 0.0, 1.0);
      vec3 s = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
      if (u_csUndoOn > 0.5) { vec3 k = s * (255.0 / 256.0) + 0.5 / 256.0; s = vec3(texture2D(u_csUndo, vec2(k.r, 0.5)).r, texture2D(u_csUndo, vec2(k.g, 0.5)).r, texture2D(u_csUndo, vec2(k.b, 0.5)).r); }
      return s;
    }`;

  /** a fresh set of this light's uniforms (each material keeps its own; sync() fills them) */
  function uniforms() {
    const T = window.THREE, V = () => new T.Vector3();
    return { u_csLight: { value: Array.from({ length: 17 }, V) }, u_csZ: { value: new Float32Array(7) }, u_csC: { value: Array.from({ length: 7 }, V) },
      u_csGain: { value: V() }, u_csGround: { value: V() }, u_csStreet: { value: V() }, u_csGroundStd: { value: V() }, u_csSun: { value: V() }, u_csSunDir: { value: new T.Vector3(0, 0, 1) }, u_csTree: { value: new T.Vector4() },
      u_csSoft: { value: TUNE.mirrorSoft }, u_csMirrorK: { value: new T.Vector2(1, 1) }, u_csExposure: { value: 1 }, u_csUndoOn: { value: 0 }, u_csUndo: { value: null }, _csKey: { value: '' } };
  }
  /** fill a material's uniforms for hour p under the light named `mode` ('soft', or the hour's own; cheap when nothing changed) */
  function sync(u, p, mode) {
    const s = atMode(p, mode), tex = undoTexture();
    u.u_csUndo.value = tex; u.u_csUndoOn.value = _undoOn; u.u_csExposure.value = s.exposure;
    const key = (s.mode === 'soft' ? _softKey : _key) + '|' + TUNE.ambient + '|' + TUNE.mirrorSky;
    if (u._csKey.value === key) return s;
    u._csKey.value = key;
    s.light.forEach((c, i) => u.u_csLight.value[i].set(c[0], c[1], c[2]));
    s.pts.forEach(([z, c], i) => { u.u_csZ.value[i] = z; u.u_csC.value[i].set(c[0], c[1], c[2]); });
    // a mirror's ray sees what every ray but the camera's sees: the sky WITH the light gain. (A model's mirror colour is divided by the
    // gain where it was made, so mirror colour times this is the plain sky times the glass's own tint.)
    u.u_csGain.value.set(s.gain[0], s.gain[1], s.gain[2]);
    // the mirror's own sky (LIGHT B): the hour's light only; the soft light's mirror sky is the builders' measured one and is not lifted
    const mk = 1 + (TUNE.mirrorSky - 1) * (1 - (s.mode === 'soft' ? s.share : 0));
    u.u_csMirrorK.value.set(mk / TUNE.ambient, mk);   // csMirror's gain already carries TUNE.ambient: take it out, so a mirror sees only its own sky
    u.u_csGround.value.set(s.groundMirror[0], s.groundMirror[1], s.groundMirror[2]);
    u.u_csStreet.value.set(s.street[0], s.street[1], s.street[2]); u.u_csGroundStd.value.set(s.groundStd[0], s.groundStd[1], s.groundStd[2]);
    u.u_csSun.value.set(s.sunStrength[0], s.sunStrength[1], s.sunStrength[2]);
    u.u_csSunDir.value.set(s.sunDir[0], s.sunDir[1], s.sunDir[2]);
    u.u_csTree.value.set(TUNE.tree.amp, TUNE.tree.lift, TUNE.tree.scale, TUNE.groundEdge);
    return s;
  }
  window.CitySky = { tune: TUNE, at, atMode, glsl, uniforms, sync };
})();
