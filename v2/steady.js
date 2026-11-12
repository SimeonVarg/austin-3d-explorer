// v2/steady.js - the steady picture: a full-size picture that is KEPT, and small frames that are added into it (2026-11-11).
//
// The owner's Mac cannot shade the city at the canvas's full size 30 times a second (measured: 52 to 58 ms a frame at full size
// with no multisampling; the fragment shaders are the cost, not the triangles). So in motion the canvas ran at a quarter of its
// pixels and the browser scaled it up: soft, and it popped back to sharp at every stop.
//
// But the city stands still and so does the sun; only the camera moves. A point seen in this frame can be found again in the
// picture of the last frame EXACTLY, from its depth and the two cameras. So:
//
//   scene, drawn SMALL, shifted by a different part of a pixel each frame (no multisampling)
//     -> range (small): for each small pixel its depth, the nearest and the farthest depth among it and its neighbours, and its
//        surface's slope. The GROUND gets its depth here: no ground layer of the app writes depth, and the ground is the plane y = 0
//     -> resolve (full size): which surface does this pixel show, and where was that point one frame ago? Take the kept picture
//        there; mix the new small sample in, most where the sample lies inside this full-size pixel
//     -> the kept picture is copied to the canvas
//
// After a few frames every full-size pixel has been sampled at several places inside itself: more detail than one small frame
// holds, and smooth edges without multisampling. When the camera stops, the same loop adds a few shifted FULL-size frames and
// the still converges to a supersampled picture, with no canvas resize (a resize was a stop of 150 to 350 ms).
//
// What makes the kept picture "still good" at a pixel is depth, not colour: a kept sample is used when its depth is the depth
// this pixel's surface had one frame ago. It is dropped where something came into view. Nothing else moves in this world, so
// there is no clamp of colours and no ghost of a moving thing. Three things were learned the first night (2026-11-11), each from
// a picture that was wrong, and each is a rule here: the ground needs a depth (above); a pixel beside an edge must find its OWN
// surface, not take the nearest sample's (the ground around every tree smeared); and where the picture moves fast or a wall
// grows on the screen the kept picture cannot gather detail (FAST_PX, GROWN).
//
// The fast part of the opening flight taught three more (2026-11-12). There the camera moves 40 to 80 m a FRAME: the view of a
// surface changes so much in a few frames that a kept picture older than that is of little worth, and each carry reads it
// between its pixels (thin lines go pale). (1) Giving the new sample more weight in its own pixel than around it then drew a
// dot pattern on every fine thing (hit pixels fresh, the rest pale) and stair steps on every edge: so in fast parts the small
// frame is read smoothly and mixed in evenly (FAST_SHARE); the shifts from frame to frame still smooth the edges. It is softer
// than a slow part, and clean. (2) The depth test must be tight (TOL), and for that (3) each pixel needs its OWN depth, not the
// nearest sample's (see the resolve pass).
//
// The small frame is drawn into a target that three.js treats as a screen (tone mapping, sRGB), so every material patch in the
// app behaves as on the canvas and the target holds display values. The kept picture holds display values too, but each new
// sample is mixed in as LIGHT (display value squared): the screen clips bright light, and clip(mix) is not mix(clip) (CLAUDE.md
// rule 10). In the small frame every pixel-size rule and mip level acts as for the FULL-size pixel (PX, main.js v2PxD): without
// that the small frames hold no fine detail to add up (measured: no window rows, sharpness 0.81 of the truth's against 0.93).
// The check is scripts/verify/v2-steady.mjs (the carry test found two of the three faults above).
// Every value in STEADY is a tuning or taste value (rule 11).
export const STEADY = {
  HIT: 0.40,          // motion: the share of a new sample in the full-size pixel it lies in the middle of
  MISS: 0.0,          // motion: its share in a full-size pixel it is far from
  FAST_PX: [8, 24],   // motion: where a point moved this many full-size pixels since the last frame (from, to), the picture goes over to...
  FAST_SHARE: 0.6,    // ...the small frame read SMOOTHLY at the pixel's own place, mixed in at this share in every pixel alike
  GROWN: [0.6, 0.9],  // the same where the kept picture is stretched: one kept pixel for this share of a pixel (to, from) or less
  KERNEL: 8.0,        // how fast the share falls with the distance to the sample (exponent a small pixel squared)
  CUBIC: 0.75,        // how sharp the kept picture is read between its pixels (0.5 = Catmull-Rom; more = sharper, with more overshoot)
  TOL: 0.005,         // a kept sample is good when its depth is the depth its surface had, give or take this share (it was 0.02: at the
                      // flight's speed a crown and the ground behind it are nearer than that, and every crown left a trail)...
  SLOPE: 1.5,         // ...and this many small pixels of the surface's own slope (a ground seen flat changes depth fast from pixel to pixel)
  JITTER: 16,         // length of the shift sequence in motion
  SPREAD: 1,          // 1: inside its quarter of the small pixel the sample moves from run to run (smooth edges); 0: always the quarter's middle
  // AT REST the picture must not flicker (rule 15). One shifted full-size frame alone is a jagged picture, far from the mean of
  // many; mixed in at a large share it makes the still shimmer while it settles (measured 2026-11-11: 1.5 to 2.6 of 255 from
  // frame to frame at a share of 0.4, with a still camera). So a rest frame gets a SMALL share: 1 / (1 + what the kept picture
  // is worth in frames: REST_KEPT after a motion, more with each rest frame), for REST_FRAMES frames; the picture then changes
  // by under 0.5 of 255 a frame and less with each.
  // the shifts of the rest frames span this share of a pixel (1 = the whole pixel: the softest; less = sharper, edges less smooth).
  // 0.6 gives the still the sharpness the multisampled still had before (1.05 against 1.06 of a 16-sample truth's; 1.0 gives 1.01)
  REST_SPREAD: 0.6,
  REST_FRAMES: 30,    // shifted full-size frames added after the camera stops
  REST_KEPT: 10,      // the kept picture counts as this many frames in that mean
  // ...except in a pixel whose CONTENT changed (a tile came in, a route was drawn): there the kept value lies outside all that
  // the new frame holds in the 3 x 3 pixels around it (give or take REST_PAD: a share of their range, and a fixed step of the
  // display value). Such a pixel takes REST_BLEND of each new frame, and SETTLE more frames are drawn after the change.
  REST_BLEND: 0.4, SETTLE: 8, REST_PAD: [0.125, 0.02],
  FAR_M: 6.0e4,       // depths are kept up to this many metres (a half-float's range)
  BLIT: 1,            // the kept picture goes to the canvas by a framebuffer copy (0: by a drawn pass)
  RULES_FULL: 1,      // 1: the small frame's pixel-size rules and mip levels act as for the full-size pixel; 0: as for its own pixel; between: between
};

// what the pixel-size rules of every material multiply a pixel by, less 1 (main.js v2PxD): 0 = the pixel that is drawn
export const PX = { d: 0 };

const QUARTERS = [[0, 0], [1, 1], [1, 0], [0, 1]];
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export function installSteady({ THREE, renderer, scene, camera }) {
  const reversed = !!renderer.capabilities.reversedDepthBuffer;
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const VS = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), oscene = new THREE.Scene();
  const pass = (uniforms, fragmentShader) => new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, uniforms, vertexShader: VS, fragmentShader });

  // range: for each small pixel the least and the most view depth (metres along the camera's axis) among it and its 8
  // neighbours, and its own surface's slope
  const rangeMat = pass({ tDepth: { value: null }, uRow: { value: new THREE.Vector4() }, uSmall: { value: new THREE.Vector2() }, uReversed: { value: reversed ? 1 : 0 }, uFar: { value: STEADY.FAR_M },
    uGround: { value: new THREE.Vector3() }, uFarW: { value: 1 }, uShift: { value: new THREE.Vector2() } }, `
    precision highp float;
    uniform sampler2D tDepth; uniform vec4 uRow; uniform vec3 uGround; uniform vec2 uSmall, uShift; uniform float uReversed, uFar, uFarW;
    float viewDepth(ivec2 p) {
      float d = texelFetch(tDepth, p, 0).r;
      // Nothing wrote a depth here: the sky, or the GROUND. The ground and all that lies flat on it (the aerial photograph, the
      // streets, the markings) are drawn as layers with no depth of their own. The world's ground is the plane y = 0, so its
      // depth is known: 1 / depth of the plane changes evenly over the screen (uGround, see render()).
      if (d == 1.0 - uReversed) {
        float ig = dot(uGround, vec3((vec2(p) + 0.5) / uSmall * 2.0 - 1.0 - uShift, 1.0));
        return ig * uFarW > 1.0 ? 1.0 / ig : uFarW;
      }
      return 1.0 / max(dot(uRow.zw, vec2(mix(d * 2.0 - 1.0, d, uReversed), 1.0)), 1e-9);
    }
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy), hi = ivec2(uSmall) - 1;
      float c = viewDepth(p), mn = c, mx = c, l = c, r = c, u = c, d = c;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) continue;
        float v = viewDepth(clamp(p + ivec2(i, j), ivec2(0), hi)); mn = min(mn, v); mx = max(mx, v);
        if (j == 0) { if (i < 0) l = v; else r = v; }
        if (i == 0) { if (j < 0) d = v; else u = v; }
      }
      // the surface's own slope, as the change of 1 / depth over one small pixel along each axis (a share of 1 / depth). Across a
      // flat surface 1 / depth changes EVENLY over the screen, so with this the depth of any point inside the small pixel is known
      // exactly (the resolve pass needs that: at the flight's speed a depth 0.1 % off puts a kept sample a quarter pixel off).
      // The smoother side of each axis is taken: the other side may be an edge.
      float ic = 1.0 / c;
      vec2 a = vec2(1.0 / r - ic, 1.0 / u - ic), b = vec2(ic - 1.0 / l, ic - 1.0 / d);
      vec2 g = mix(a, b, step(abs(b), abs(a))) * c;
      gl_FragColor = vec4(min(vec2(mn, mx), vec2(uFar)), g);
    }`);

  const resolveMat = pass({
    tNow: { value: null }, tRange: { value: null }, tHist: { value: null }, tDepth: { value: null },
    uGround: { value: new THREE.Vector3() }, uFarW: { value: 1 }, uReversed: { value: reversed ? 1 : 0 },
    uCarry: { value: new THREE.Matrix4() }, uRow: { value: new THREE.Vector4() }, uHitBox: { value: 0.25 }, uSlope: { value: 1 }, uFast: { value: new THREE.Vector2() }, uGrown: { value: new THREE.Vector2() }, uFastShare: { value: 0 }, uRest: { value: new THREE.Vector3(-1, 0, 0) },
    uJitter: { value: new THREE.Vector2() }, uSmall: { value: new THREE.Vector2() }, uFull: { value: new THREE.Vector2() },
    uFirst: { value: 1 }, uHit: { value: 0 }, uMiss: { value: 0 }, uKernel: { value: 0 }, uTol: { value: 0 }, uFar: { value: 0 }, uDebug: { value: 0 }, uCubic: { value: 0.5 },
  }, `
    precision highp float;
    uniform sampler2D tNow, tRange, tHist, tDepth; uniform mat4 uCarry; uniform vec4 uRow; uniform vec3 uGround; uniform float uFarW, uReversed;
    uniform vec2 uJitter, uSmall, uFull; uniform float uFirst, uHit, uMiss, uKernel, uTol, uFar, uDebug, uCubic, uHitBox, uSlope; uniform vec2 uFast, uGrown; uniform float uFastShare; uniform vec3 uRest; varying vec2 vUv;
    // the kept picture between its pixels: Catmull-Rom from five taps (the four corner taps of the nine are left out). It gives
    // the colour held to the range of the five (no ringing that could feed on itself), and in .a the kept depth near the centre
    vec4 kept(vec2 uv) {
      vec2 pos = uv * uFull, cen = floor(pos - 0.5) + 0.5, f = pos - cen, f2 = f * f, f3 = f * f2;
      vec2 w0 = -uCubic * f3 + 2.0 * uCubic * f2 - uCubic * f, w1 = (2.0 - uCubic) * f3 - (3.0 - uCubic) * f2 + 1.0, w2 = -(2.0 - uCubic) * f3 + (3.0 - 2.0 * uCubic) * f2 + uCubic * f, w3 = uCubic * f3 - uCubic * f2;
      vec2 w12 = w1 + w2, t12 = (cen + w2 / w12) / uFull, t0 = (cen - 1.0) / uFull, t3 = (cen + 2.0) / uFull;
      vec4 m = texture2D(tHist, t12);
      vec3 a = texture2D(tHist, vec2(t12.x, t0.y)).rgb, b = texture2D(tHist, vec2(t0.x, t12.y)).rgb, c = texture2D(tHist, vec2(t3.x, t12.y)).rgb, d = texture2D(tHist, vec2(t12.x, t3.y)).rgb;
      float wa = w12.x * w0.y, wb = w0.x * w12.y, wm = w12.x * w12.y, wc = w3.x * w12.y, wd = w12.x * w3.y;
      vec3 v = (a * wa + b * wb + m.rgb * wm + c * wc + d * wd) / (wa + wb + wm + wc + wd);
      return vec4(clamp(v, min(m.rgb, min(min(a, b), min(c, d))), max(m.rgb, max(max(a, b), max(c, d)))), m.a);
    }
    // A point on this pixel's line of sight, viewDepth metres along the camera's axis: where it was in the last frame (xy, as uv)
    // and how far away it was then (z). q0 = uCarry x (this pixel, depth 0); uCarry = last frame's camera x the inverse of this one.
    vec3 past(vec4 q0, float viewDepth) {
      vec4 q = q0 + ((1.0 / viewDepth - uRow.w) / uRow.z) * uCarry[2];
      return vec3(q.xy / q.w * 0.5 + 0.5, q.w * viewDepth);
    }
    // how badly the kept depth d disagrees with the depth e a surface would have had (a share of e)
    float miss(float d, float e) { e = clamp(e, 1.0, uFar); return abs(d - e) / e; }   // (kept depths are held to 1 .. uFar, see the last line of main)
    void main() {
      // this full-size pixel's centre in the small, shifted frame, and the small sample nearest to it
      vec2 uvN = vUv + uJitter, sp = uvN * uSmall;
      ivec2 ip = ivec2(clamp(sp, vec2(0.5), uSmall - 0.5));
      vec2 f = sp - (vec2(ip) + 0.5);
      vec3 cNew = texelFetch(tNow, ip, 0).rgb;                   // a display value
      vec4 rng = texelFetch(tRange, ip, 0);                     // least and most view depth of the sample and its 8 neighbours; ba = its surface's slope (see the range pass)
      bool hit = max(abs(f.x), abs(f.y)) < uHitBox;             // the sample lies inside this full-size pixel
      // THIS pixel's own depth, exactly. The flight moves the camera 40 to 80 m a frame: a point 900 m away then moves 240
      // full-size pixels against the far ground, so a depth that is 0.1 % wrong puts the kept sample a quarter of a pixel off,
      // each frame another way, and the kept picture goes pale and dotted (measured 2026-11-12: that was the whole fault of the
      // fast part of the flight). So the depth is not the nearest sample's. Where nothing wrote a depth the pixel shows the
      // ground or the sky, and the ground is the plane y = 0: its depth along this pixel's own line of sight is known. Elsewhere
      // it is the sample's depth carried along the sample's surface to this pixel's centre (1 / depth changes evenly over the
      // screen on a flat surface), from the depth buffer itself: a half-float copy of a depth is only good to 0.05 %.
      float dRaw = texelFetch(tDepth, ip, 0).r, sample0, mine;
      vec2 ndc = vUv * 2.0 - 1.0;
      if (dRaw == 1.0 - uReversed) {
        float ig = dot(uGround, vec3(ndc, 1.0));
        mine = ig * uFarW > 1.0 ? 1.0 / ig : uFarW;
        sample0 = mine;
      } else {
        float iw = max(dot(uRow.zw, vec2(mix(dRaw * 2.0 - 1.0, dRaw, uReversed), 1.0)), 1e-9);
        sample0 = 1.0 / iw;
        mine = clamp(1.0 / max(iw * (1.0 + dot(rng.ba, f)), 1e-9), rng.r, rng.g);
      }
      mine = min(mine, uFar); sample0 = min(sample0, uFar);
      // WHICH surface does this pixel show, and is the kept picture of it still good? The pixel asks the kept picture: under the
      // sample's surface, was there a surface of that depth at the place this point comes from? If yes, that kept pixel shows the
      // same surface: it is good. If not (next to an edge the nearest sample can be of the other surface: a crown beside the
      // ground under it), the same question for the farthest and the nearest depth among the sample's neighbours. A depth that
      // fits names this pixel's surface. No depth fits where something came into view: there the kept picture is dropped.
      // (Before, a kept depth anywhere between the neighbours' depths counted as good: at speed that left a trail of every
      // building on the ground it uncovered. And the nearest sample's depth alone smeared the ground around every tree.)
      vec4 q0 = uCarry * vec4(ndc, 0.0, 1.0);
      float own = mine, tol = uTol + uSlope * (abs(rng.b) + abs(rng.a));
      vec3 p = past(q0, own);
      // how far this point moved on the screen since the last frame (full-size pixels), and whether the kept picture is being
      // stretched here (a wall that turns toward the camera grows on the screen: one kept pixel must fill several)
      vec2 was = p.xy * uFull;
      float moved = length(was - vUv * uFull), grown = min(length(dFdx(was)), length(dFdy(was)));
      vec4 h = kept(p.xy);
      float bad = miss(h.a, p.z);
      if (bad > tol && rng.g - rng.r > sample0 * uTol) {
        vec3 pf = past(q0, rng.g), pn = past(q0, rng.r);
        float bf = miss(texture2D(tHist, pf.xy).a, pf.z), bn = miss(texture2D(tHist, pn.xy).a, pn.z);
        if (bf < bad || bn < bad) {
          if (bf <= bn) { p = pf; own = rng.g; bad = bf; } else { p = pn; own = rng.r; bad = bn; }
          h = kept(p.xy);
        }
      }
      float ok = (p.z > 0.0 && p.x > 0.0 && p.y > 0.0 && p.x < 1.0 && p.y < 1.0 && bad <= tol) ? 1.0 - uFirst : 0.0;
      // the new sample is mixed in where it lies (always: on an edge that is what smooths it), and in the pixels around it only
      // when they show the same surface
      // Where the picture moves fast, or the kept picture is stretched, it cannot gather detail. There the small frame is read
      // smoothly at this pixel's own place and mixed in at one share in every pixel (see the top of the file).
      float loose = max(smoothstep(uFast.x, uFast.y, moved), 1.0 - smoothstep(uGrown.x, uGrown.y, grown));
      float near = exp(-uKernel * dot(f, f));
      float share = (hit || own == mine) ? mix(uMiss, uHit, near) : 0.0;
      vec3 cSoft = (loose > 0.0 || ok < 0.5) ? textureLod(tNow, uvN, 0.0).rgb : cNew;
      // at rest: did this pixel's content change? Then the kept value lies outside all that the new frame holds around the pixel
      // (a shifted sample of an edge or of a fine pattern that did NOT change always has the kept mean inside that range)
      if (uRest.x >= 0.0 && ok > 0.5) {
        vec3 lo = cNew, hi = cNew; ivec2 top = ivec2(uSmall) - 1;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          if (i == 0 && j == 0) continue;
          vec3 t = texelFetch(tNow, clamp(ip + ivec2(i, j), ivec2(0), top), 0).rgb; lo = min(lo, t); hi = max(hi, t);
        }
        vec3 pad = (hi - lo) * uRest.y + uRest.z;
        if (any(lessThan(h.rgb, lo - pad)) || any(greaterThan(h.rgb, hi + pad))) share = uRest.x;
      }
      // samples are added up as LIGHT (display value squared), the kept picture holds display values
      vec3 cIn = mix(cNew, cSoft, loose);
      vec3 outc = ok > 0.5 ? sqrt(mix(h.rgb * h.rgb, cIn * cIn, mix(share, uFastShare, loose))) : cSoft;
      if (uDebug > 1.5) outc = vec3(clamp(bad * 5.0, 0.0, 1.0), clamp(tol * 5.0, 0.0, 1.0), own != mine ? 1.0 : 0.0);   // (tests: red = how badly the kept depth fits (1 = 20 %), green = the room it has, blue = another surface than the sample's)
      else if (uDebug > 0.5) outc = mix(outc, vec3(1.0, 0.0, 0.0), 0.6 * (1.0 - ok));
      // .a = this pixel's depth, never under 1: the kept picture is copied to the canvas as it is, and the canvas reads .a as
      // its alpha (a wall half a metre from the eye must not make the page see-through)
      gl_FragColor = vec4(outc, clamp(ok > 0.5 && !hit ? own : mine, 1.0, uFar));
    }`);
  const showMat = pass({ tHist: { value: null } },
    'precision highp float; uniform sampler2D tHist; void main() { gl_FragColor = vec4(texelFetch(tHist, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }');
  const mesh = new THREE.Mesh(tri, rangeMat); mesh.frustumCulled = false; oscene.add(mesh);

  let blitBroken = false;
  let small = null, range = null, hist = [null, null], cur = 0, first = true, frame = 0, rest = 0, settle = 0, restShift = 0, worth = 0, wasMoving = true;
  const prevVP = new THREE.Matrix4(), vp = new THREE.Matrix4(), inv = new THREE.Matrix4(), size = new THREE.Vector2(), ground = new THREE.Vector3();
  const stats = { frames: 0, resets: 0, small: [0, 0], full: [0, 0], rest: 0 };
  function targets(w, h, W, H) {
    if (!small || small.width !== w || small.height !== h) {
      if (small) { small.depthTexture.dispose(); small.dispose(); range.dispose(); }
      small = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false, samples: 0 });
      small.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType); small.depthTexture.minFilter = small.depthTexture.magFilter = THREE.NearestFilter;
      // its storage is made first, as plain RGBA8; only then is it named a screen in the output colour space, so the scene's
      // shaders write display values into it exactly as they do into the canvas (see the top of the file)
      renderer.setRenderTarget(small); renderer.setRenderTarget(null);
      small.isXRRenderTarget = true; small.texture.colorSpace = renderer.outputColorSpace;
      range = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
      stats.small = [w, h];
    }
    if (!hist[0] || hist[0].width !== W || hist[0].height !== H) {
      for (const t of hist) if (t) t.dispose();
      hist = [0, 1].map(() => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }));
      first = true; stats.full = [W, H];
    }
  }
  const api = {
    stats,
    // the next frame starts the kept picture again from nothing
    reset() { first = true; rest = 0; settle = 0; },
    // true while the still is not yet converged: the caller draws another frame
    more() { return !wasMoving && (settle > 0 || rest < STEADY.REST_FRAMES); },
    target() { return small; },
    // one frame. scale = the small frame's size as a share of the canvas's (linear); moving = the camera moves (or the small
    // frame is still below full size); hard = the content changed with the camera at rest: start the still again
    render(scale, moving, hard) {
      renderer.getDrawingBufferSize(size);
      const W = size.x, H = size.y, w = Math.max(8, Math.round(W * scale)), h = Math.max(8, Math.round(H * scale));
      targets(w, h, W, H);
      if (moving) { rest = 0; settle = 0; }
      else { if (hard) { settle = STEADY.SETTLE; stats.resets++; } if (wasMoving) { rest = 0; worth = STEADY.REST_KEPT; } }
      const alone = first;   // (there is no kept picture yet)
      if (alone) worth = 0;   // (worth: how many rest frames the kept picture counts as: REST_KEPT after a motion, the frames so far after a start from nothing)
      wasMoving = moving;
      // the hooks that follow the camera (the aerial's tiles, the near sets) run for a draw to the screen only: give them their turn
      scene.onBeforeRender(renderer, scene, camera, null);
      frame++;
      let jx = 0, jy = 0;
      if (moving) {
        // each run of four frames visits the four quarters of a small pixel (at half size: its four full-size pixels) in an
        // order that never takes two neighbours in a row; inside its quarter the sample moves by the Halton sequence
        const k = frame % STEADY.JITTER, qd = QUARTERS[frame % 4], sub = (k >> 2) + 1;
        jx = (qd[0] + (STEADY.SPREAD ? halton(sub, 2) : 0.5)) * 0.5 - 0.5; jy = (qd[1] + (STEADY.SPREAD ? halton(sub, 3) : 0.5)) * 0.5 - 0.5;
      }
      else if (!alone) { restShift = restShift % 64 + 1; jx = (halton(restShift, 2) - 0.5) * STEADY.REST_SPREAD; jy = (halton(restShift, 3) - 0.5) * STEADY.REST_SPREAD; }   // (a still that starts from nothing starts unshifted)
      camera.updateMatrixWorld();
      vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);      // the camera without the shift
      inv.copy(vp).invert();
      const e = inv.elements, auto = renderer.info.autoReset;
      // the ground plane y = 0 as 1 / (view depth) over the screen: a point on the line of sight through (x, y) (-1 .. 1), w metres
      // along the camera's axis, is eye + w (forward + x tanX right + y tanY up); its height is 0 where 1 / w = ground . (x, y, 1)
      { const m = camera.matrixWorld.elements, pm = camera.projectionMatrix.elements, cy = m[13];
        if (cy > 1e-3) ground.set(-m[1] / pm[0] / cy, -m[5] / pm[5] / cy, m[9] / cy); else ground.set(0, 0, 0); }
      renderer.info.autoReset = false; renderer.info.reset();                         // (one frame's counts = all its passes)
      camera.setViewOffset(w, h, jx, jy, w, h); camera.updateProjectionMatrix();
      PX.d = STEADY.RULES_FULL * (w / W - 1);
      renderer.setRenderTarget(small); renderer.clear(); renderer.render(scene, camera);
      PX.d = 0;
      camera.clearViewOffset(); camera.updateProjectionMatrix();
      const jit = [-jx / w, jy / h], stop = STEADY.STOP_AFTER || 9;   // (STOP_AFTER: a test's knob, to time the passes one by one)
      let u = rangeMat.uniforms;
      u.tDepth.value = small.depthTexture; u.uRow.value.set(e[3], e[7], e[11], e[15]); u.uSmall.value.set(w, h); u.uFar.value = STEADY.FAR_M;
      u.uGround.value.copy(ground); u.uFarW.value = camera.far; u.uShift.value.set(2 * jit[0], 2 * jit[1]);   // (the small frame is shifted: its pixel p looks along the unshifted camera's direction (p - shift))
      if (stop >= 2) { mesh.material = rangeMat; renderer.setRenderTarget(range); renderer.render(oscene, ocam); }
      const next = 1 - cur; u = resolveMat.uniforms;
      u.tNow.value = small.texture; u.tRange.value = range.texture; u.tHist.value = hist[cur].texture; u.tDepth.value = small.depthTexture;
      u.uGround.value.copy(ground); u.uFarW.value = camera.far;
      u.uCarry.value.multiplyMatrices(first || !moving ? vp : prevVP, inv); u.uRow.value.set(e[3], e[7], e[11], e[15]); u.uHitBox.value = 0.5 * w / W;
      u.uJitter.value.set(jit[0], jit[1]); u.uSmall.value.set(w, h); u.uFull.value.set(W, H); u.uFirst.value = first ? 1 : 0;
      const still = 1 / (worth + 1);
      u.uHit.value = moving ? STEADY.HIT : still; u.uMiss.value = moving ? STEADY.MISS : still; u.uKernel.value = STEADY.KERNEL;
      u.uRest.value.set(moving ? -1 : STEADY.REST_BLEND, STEADY.REST_PAD[0], STEADY.REST_PAD[1]);
      u.uTol.value = STEADY.TOL; u.uSlope.value = STEADY.SLOPE; u.uFast.value.fromArray(moving ? STEADY.FAST_PX : [1e6, 2e6]); u.uGrown.value.fromArray(moving ? STEADY.GROWN : [-2, -1]); u.uFastShare.value = STEADY.FAST_SHARE; u.uFar.value = STEADY.FAR_M; u.uCubic.value = STEADY.CUBIC; u.uDebug.value = STEADY.DEBUG || 0;
      if (stop >= 3) { mesh.material = resolveMat; renderer.setRenderTarget(hist[next]); renderer.render(oscene, ocam); }
      if (stop < 4) renderer.setRenderTarget(null);
      else if (STEADY.BLIT && !blitBroken) {
        const gl = renderer.getContext();
        renderer.setRenderTarget(null);
        renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.properties.get(hist[next]).__webglFramebuffer);
        renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);   // (three.js keeps the read binding apart: give it back, or its record goes stale)
        if (stats.frames < 3 && gl.getError()) blitBroken = true;
      }
      if (stop >= 4 && (!STEADY.BLIT || blitBroken)) { showMat.uniforms.tHist.value = hist[next].texture; mesh.material = showMat; renderer.setRenderTarget(null); renderer.render(oscene, ocam); }
      renderer.info.autoReset = auto;
      cur = next; first = false; prevVP.copy(vp); stats.frames++;
      if (!moving) { if (rest < STEADY.REST_FRAMES) rest++; if (settle > 0) settle--; worth = Math.min(worth + 1, STEADY.REST_KEPT + STEADY.REST_FRAMES); stats.rest = rest; stats.settle = settle; }
    },
  };
  return api;
}
