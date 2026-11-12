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
// grows on the screen the kept picture cannot gather detail, so there the new frame counts for more (FAST_PX, GROWN).
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
  FAST_PX: [8, 24],   // motion: a point that moved this many full-size pixels since the last frame (from, to) goes over to...
  HIT_FAST: 0.7,      // ...this share of a new sample in its own pixel...
  MISS_FAST: 0.25,    // ...and this share in a pixel it is far from
  GROWN: [0.6, 0.9],  // the same where the kept picture is stretched: one kept pixel for this share of a pixel (to, from) or less
  KERNEL: 8.0,        // how fast the share falls with the distance to the sample (exponent a small pixel squared)
  CUBIC: 0.75,        // how sharp the kept picture is read between its pixels (0.5 = Catmull-Rom; more = sharper, with more overshoot)
  TOL: 0.02,          // a kept sample is good when its depth is the depth its surface had, give or take this share...
  SLOPE: 1.5,         // ...and this many small pixels of the surface's own slope (a ground seen flat changes depth fast from pixel to pixel)
  JITTER: 16,         // length of the shift sequence in motion
  SPREAD: 1,          // 1: inside its quarter of the small pixel the sample moves from run to run (smooth edges); 0: always the quarter's middle
  REST_FRAMES: 12,    // shifted full-size frames added after the camera stops (a running mean)
  REST_KEPT: 3.0,     // the kept picture counts as this many frames when that mean begins
  // The content changed with the camera at rest (a tile came in, a route was drawn): the next SETTLE frames each take REST_BLEND
  // of the kept picture's place (what was there fades out to under 2 %, and edges stay smooth meanwhile: no frame is shown alone);
  // then the running mean. While tiles stream in after the opening flight this runs without a break.
  SETTLE: 8, REST_BLEND: 0.4,
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

  // range: view depth (metres along the camera's axis) of each small pixel, and the least and the most among it and its 8 neighbours
  const rangeMat = pass({ tDepth: { value: null }, uRow: { value: new THREE.Vector4() }, uSmall: { value: new THREE.Vector2() }, uReversed: { value: reversed ? 1 : 0 }, uFar: { value: STEADY.FAR_M },
    uInv: { value: new THREE.Matrix4() }, uCamY: { value: 0 }, uShift: { value: new THREE.Vector2() } }, `
    precision highp float;
    uniform sampler2D tDepth; uniform vec4 uRow; uniform vec2 uSmall, uShift; uniform float uReversed, uFar, uCamY; uniform mat4 uInv;
    float viewDepth(ivec2 p) {
      float d = texelFetch(tDepth, p, 0).r;
      vec2 ndc = (vec2(p) + 0.5) / uSmall * 2.0 - 1.0;
      float z = mix(d * 2.0 - 1.0, d, uReversed), w = 1.0 / max(dot(uRow, vec4(ndc, z, 1.0)), 1e-9);
      // Nothing wrote a depth here: the sky, or the GROUND. The ground and all that lies flat on it (the aerial photograph, the
      // streets, the markings) are drawn as layers with no depth of their own. The world's ground is the plane y = 0, so its
      // depth is known: where this pixel's line of sight goes down, it meets the ground at the share camY / (camY - farY) of the
      // way to the far plane, and depth along the camera's axis grows evenly along a line of sight.
      if (d == 1.0 - uReversed) {
        vec4 far = uInv * vec4(ndc - uShift, z, 1.0);
        float fy = far.y / far.w;
        if (fy < 0.0) w *= uCamY / (uCamY - fy);
      }
      return w;
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
      // the surface's own slope: its depth change over one small pixel, on the smoother side of each axis (the other side may be an edge)
      float slope = min(abs(c - l), abs(c - r)) + min(abs(c - u), abs(c - d));
      gl_FragColor = vec4(min(vec3(mn, mx, c), vec3(uFar)), slope / c);
    }`);

  const resolveMat = pass({
    tNow: { value: null }, tRange: { value: null }, tHist: { value: null },
    uCarry: { value: new THREE.Matrix4() }, uRow: { value: new THREE.Vector4() }, uHitBox: { value: 0.25 }, uSlope: { value: 1 }, uFast: { value: new THREE.Vector2() }, uGrown: { value: new THREE.Vector2() }, uLoose: { value: new THREE.Vector2() },
    uJitter: { value: new THREE.Vector2() }, uSmall: { value: new THREE.Vector2() }, uFull: { value: new THREE.Vector2() },
    uFirst: { value: 1 }, uHit: { value: 0 }, uMiss: { value: 0 }, uKernel: { value: 0 }, uTol: { value: 0 }, uFar: { value: 0 }, uDebug: { value: 0 }, uCubic: { value: 0.5 },
  }, `
    precision highp float;
    uniform sampler2D tNow, tRange, tHist; uniform mat4 uCarry; uniform vec4 uRow;
    uniform vec2 uJitter, uSmall, uFull; uniform float uFirst, uHit, uMiss, uKernel, uTol, uFar, uDebug, uCubic, uHitBox, uSlope; uniform vec2 uFast, uGrown, uLoose; varying vec2 vUv;
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
      vec4 rng = texelFetch(tRange, ip, 0);                     // least, most, own view depth of the sample and its 8 neighbours; a = the surface's slope (share of its depth a small pixel)
      bool hit = max(abs(f.x), abs(f.y)) < uHitBox;             // the sample lies inside this full-size pixel
      // WHICH surface does this pixel show, and is the kept picture of it still good? The pixel asks the kept picture: under the
      // sample's depth, was there a surface of that depth at the place this point comes from? If yes, that kept pixel shows the
      // same surface: it is good. If not (next to an edge the nearest sample can be of the other surface: a crown beside the
      // ground under it), the same question for the farthest and the nearest depth among the sample's neighbours. A depth that
      // fits names this pixel's surface. No depth fits where something came into view: there the kept picture is dropped.
      // (Before, a kept depth anywhere between the neighbours' depths counted as good: at speed that left a trail of every
      // building on the ground it uncovered. And the nearest sample's depth alone smeared the ground around every tree.)
      vec4 q0 = uCarry * vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
      float own = rng.b, tol = uTol + uSlope * rng.a;
      vec3 p = past(q0, own);
      // how far this point moved on the screen since the last frame (full-size pixels), and whether the kept picture is being
      // stretched here (a wall that turns toward the camera grows on the screen: one kept pixel must fill several)
      vec2 was = p.xy * uFull;
      float moved = length(was - vUv * uFull), grown = min(length(dFdx(was)), length(dFdy(was)));
      vec4 h = kept(p.xy);
      float bad = miss(h.a, p.z);
      if (bad > tol && rng.g - rng.r > rng.b * uTol) {
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
      // Where the picture moves fast, or the kept picture is stretched, it cannot gather detail: there the new frame counts
      // for more, and a sample also feeds the pixels around it (a smooth small picture, as the canvas showed in motion before).
      float loose = max(smoothstep(uFast.x, uFast.y, moved), 1.0 - smoothstep(uGrown.x, uGrown.y, grown));
      float near = exp(-uKernel * dot(f, f));
      float share = (hit || abs(own - rng.b) <= rng.b * uTol) ? mix(mix(uMiss, uHit, near), mix(uLoose.y, uLoose.x, near), loose) : 0.0;
      // samples are added up as LIGHT (display value squared), the kept picture holds display values
      vec3 outc = ok > 0.5 ? sqrt(mix(h.rgb * h.rgb, cNew * cNew, share)) : texture2D(tNow, uvN).rgb;
      if (uDebug > 1.5) outc = vec3(clamp(bad * 5.0, 0.0, 1.0), clamp(tol * 5.0, 0.0, 1.0), abs(own - rng.b) > rng.b * uTol ? 1.0 : 0.0);   // (tests: red = how badly the kept depth fits (1 = 20 %), green = the room it has, blue = another surface than the sample's)
      else if (uDebug > 0.5) outc = mix(outc, vec3(1.0, 0.0, 0.0), 0.6 * (1.0 - ok));
      // .a = this pixel's depth, never under 1: the kept picture is copied to the canvas as it is, and the canvas reads .a as
      // its alpha (a wall half a metre from the eye must not make the page see-through)
      gl_FragColor = vec4(outc, clamp(ok > 0.5 && !hit ? own : rng.b, 1.0, uFar));
    }`);
  const showMat = pass({ tHist: { value: null } },
    'precision highp float; uniform sampler2D tHist; void main() { gl_FragColor = vec4(texelFetch(tHist, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }');
  const mesh = new THREE.Mesh(tri, rangeMat); mesh.frustumCulled = false; oscene.add(mesh);

  let blitBroken = false;
  let small = null, range = null, hist = [null, null], cur = 0, first = true, frame = 0, rest = 0, settle = 0, restShift = 0, wasMoving = true;
  const prevVP = new THREE.Matrix4(), vp = new THREE.Matrix4(), inv = new THREE.Matrix4(), size = new THREE.Vector2();
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
      else if (hard) { rest = 0; settle = STEADY.SETTLE; stats.resets++; }
      else if (wasMoving) rest = 0;
      const blend = !moving && settle > 0, alone = first;   // (alone: there is no kept picture yet)
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
      else if (!alone) { restShift = restShift % 64 + 1; jx = halton(restShift, 2) - 0.5; jy = halton(restShift, 3) - 0.5; }   // (a still that starts from nothing starts unshifted)
      camera.updateMatrixWorld();
      vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);      // the camera without the shift
      inv.copy(vp).invert();
      const e = inv.elements, auto = renderer.info.autoReset;
      renderer.info.autoReset = false; renderer.info.reset();                         // (one frame's counts = all its passes)
      camera.setViewOffset(w, h, jx, jy, w, h); camera.updateProjectionMatrix();
      PX.d = STEADY.RULES_FULL * (w / W - 1);
      renderer.setRenderTarget(small); renderer.clear(); renderer.render(scene, camera);
      PX.d = 0;
      camera.clearViewOffset(); camera.updateProjectionMatrix();
      const jit = [-jx / w, jy / h], stop = STEADY.STOP_AFTER || 9;   // (STOP_AFTER: a test's knob, to time the passes one by one)
      let u = rangeMat.uniforms;
      u.tDepth.value = small.depthTexture; u.uRow.value.set(e[3], e[7], e[11], e[15]); u.uSmall.value.set(w, h); u.uFar.value = STEADY.FAR_M;
      u.uInv.value.copy(inv); u.uCamY.value = camera.matrixWorld.elements[13]; u.uShift.value.set(2 * jit[0], 2 * jit[1]);   // (the small frame is shifted: its pixel p looks along the unshifted camera's direction (p - shift))
      if (stop >= 2) { mesh.material = rangeMat; renderer.setRenderTarget(range); renderer.render(oscene, ocam); }
      const next = 1 - cur; u = resolveMat.uniforms;
      u.tNow.value = small.texture; u.tRange.value = range.texture; u.tHist.value = hist[cur].texture;
      u.uCarry.value.multiplyMatrices(first || !moving ? vp : prevVP, inv); u.uRow.value.set(e[3], e[7], e[11], e[15]); u.uHitBox.value = 0.5 * w / W;
      u.uJitter.value.set(jit[0], jit[1]); u.uSmall.value.set(w, h); u.uFull.value.set(W, H); u.uFirst.value = first ? 1 : 0;
      const still = blend ? STEADY.REST_BLEND : 1 / (rest + 1 + (alone ? 0 : STEADY.REST_KEPT));
      u.uHit.value = moving ? STEADY.HIT : still; u.uMiss.value = moving ? STEADY.MISS : still; u.uKernel.value = STEADY.KERNEL;
      u.uTol.value = STEADY.TOL; u.uSlope.value = STEADY.SLOPE; u.uFast.value.fromArray(moving ? STEADY.FAST_PX : [1e6, 2e6]); u.uGrown.value.fromArray(moving ? STEADY.GROWN : [-2, -1]); u.uLoose.value.set(STEADY.HIT_FAST, STEADY.MISS_FAST); u.uFar.value = STEADY.FAR_M; u.uCubic.value = STEADY.CUBIC; u.uDebug.value = STEADY.DEBUG || 0;
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
      if (!moving) { if (blend) settle--; else rest++; stats.rest = rest; stats.settle = settle; }
    },
  };
  return api;
}
