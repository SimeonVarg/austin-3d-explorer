// glide.js — THE SCREEN NEVER SHOWS A RAW FRAME (prototype behind ?glide=1).
//
// Why: on the owner's Mac a frame of the city takes about 45 ms. Drawn straight to the screen that is 22 frames a second,
// and each frame is a new roll of the dice for every part thinner than a pixel (CLAUDE.md rule 15). No setting changes that:
// the cost is the city itself.
//
// So the two jobs are parted. (1) A KEY PICTURE of the city (colour and depth, multisampled) is drawn off screen, in SLICES,
// one slice a display frame, so that no display frame waits for more than a slice. A slice is a run of the frame's own draw
// calls, in the frame's own order: the first slice draws calls until its time is used, the next goes on where it stopped,
// and so on, all into the same picture. (Strips of the screen were tried first: on the owner's Mac the city's cost is half
// its triangles, and every strip paid for all the triangles again. 2026-11-12: one frame 57 to 71 ms, six strips 122 to 209.)
// The key picture is drawn for where the camera WILL be when it is shown (the camera's speed, carried on), so the move in
// step (2) is small. (2) EVERY display frame shows the last
// complete key picture, MOVED to the camera of now: for each screen pixel the shader finds the point of the key picture
// that the present camera sees there (the key's depth says where each of its pixels is in the world; three steps of a
// fixed-point search), and reads the key's colour there with a sharp filter. A turn of the camera is exact. A move is exact
// for everything the key picture saw; what it did not see (behind a near corner) is filled from beside it until the next
// key picture, a few display frames later.
//
// The display runs at the screen's rate whatever the city costs. Between two key pictures the picture is the SAME picture
// moved, so a thin part does not flicker from frame to frame.
//
// A SLOW MOVE GETS MORE SAMPLES. The display does not wait for a key picture, so in a slow move (where a thin part's flicker
// is seen) a key picture is drawn up to four times, shifted by parts of a pixel, at one camera, and added up (GLIDE.PASSES).
// Owner's Mac, a very slow orbit: the pixels that jump by over 8 of 255 from one display frame to the next fall from 2.45 %
// (today's page) to 0.23 % (a 64-sample truth: 0.24 %), at the same sharpness.
//
// At rest the clean still (rest.js) takes over as before. The canvas has no multisampling of its own here: the key picture
// has, and the shown picture is a filtered copy of it.
const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) && isFinite(+Q.get(k)) ? +Q.get(k) : d);
export const GLIDE = {
  ON: Q.get('glide') === '1',
  SLICE_MS: num('glideslice', 9),    // the time one slice of a key picture may take (ms of GPU work, by the cost model below)
  FPS: num('glidefps', 0),           // the display rate to hold (a display frame later than 1.25 x its time is a miss). 0 = found from
                                     // the screen: the fastest rate whose frame is FRAME_MIN_MS or longer and a whole number of the
                                     // screen's own frames (60 Hz: 60; 144 Hz: 72; 120 Hz: 60; 75 Hz: 75)
  FRAME_MIN_MS: 13,                  // (a display frame needs the show pass, about 4 ms on the owner's Mac, and one slice)
  GAIN: num('glidegain', 0.2),       // the cost model's scale (model ms -> real ms; measured on the owner's Mac: about 0.2)
  // The model is rough, so each thing's cost is LEARNED while running: when the display frame after a slice comes late, the
  // things that slice drew count LEARN_UP times more from then on (they move into slices of their own); when it comes in time
  // they count a little less. LEARN = 0 turns it off (a test with fixed slices).
  LEARN: num('glidelearn', 1), LEARN_UP: 1.3, LEARN_DOWN: 0.97, LEARN_MIN: 0.25, LEARN_MAX: 8, LEARN_LATE_MS: 70,   // (a display frame later than LEARN_LATE_MS is a stall of another kind, a new tile's first draw: nothing is learned from it)
  FIRST: num('glidefirst', 0.6),     // the first slice of a key picture has this share of a slice's time (it also runs the hooks that follow the camera)
  MAX_SLICES: num('glidemax', 10),   // a key picture is at most this many slices (then a slice is longer)
  TRI_MS: 1.0e-5,                    // cost model: a triangle (measured on the owner's Mac 2026-11-12: about 10 ns)
  PX_MS: 7.0e-6,                     // ...and a pixel shaded (about 7 ns)
  COVER: num('glidecover', 0.3),     // ...and the share of its bounding circle on the screen that a thing fills
  OVER_X: num('glideoverx', 0.10),   // the key picture is wider than the screen by this share on EACH side, and
  OVER_Y: num('glideovery', 0.05),   // ...higher by this share on each side: what a turn brings into view is already drawn
  LEAD: num('glidelead', 1),         // the key picture is drawn for the camera this share of the way to its showing time (0 = for the camera of now)
  SAMPLES: 4,                        // multisampling of the key picture
  // MORE SAMPLES A KEY PICTURE. The display does not wait for a key picture, so a key picture may take longer: it is drawn
  // PASSES times, each time shifted by another part of a pixel, at the SAME camera, and the passes are added up as light
  // (as the clean still does). Nothing is moved or read between pixels, so nothing softens: a thin part is a whole, faint
  // line in the key picture itself. The price: key pictures come PASSES times less often (the move in the show pass is larger).
  // HOW MANY follows the camera's speed over the screen: the picture may travel TRAVEL_PX pixels over the screen while one key
  // picture is drawn, and no more (then the key picture is too old when it is shown: the move in the show pass is too large).
  // So a slow move gets all the passes, a fast one gets one, and a small window (its passes are short) gets more than a big one.
  // Measured 2026-11-13 and 11-14 (owner's Mac, stepped orbits against a 64-sample truth). The flicker the eye sees = the
  // pixels that jump by over 8 of 255 from one display frame to the next, MORE than the truth's own (the move itself):
  //   1200 x 1195    0.24 deg/s   1.2 deg/s   3 deg/s   6 deg/s   12 deg/s   24 deg/s
  //   today's page     +1.92        +3.37      +2.72     +2.12     +1.76      +1.19   (% of the pixels)
  //   one pass         +1.15        +1.81      +2.17     +2.29     +1.83      +1.48
  //   two passes       +0.47        +0.85      +1.04     +1.53     +1.44      +1.07
  //   four passes      +0.11        -0.15      +0.08     +0.73     +0.67      +0.49
  // and the picture's error against the truth must not grow: at 9 deg/s it is 1.63 (one pass), 1.62 (two, 52 px of travel a key
  // picture), 2.04 (four, 103 px) at 1200 x 1195; 1.71, 1.80 (94 px), 7.09 (187 px) at 2560 x 1300. Hence 80 pixels.
  PASSES: num('glidepasses', 4),     // the most passes a key picture (1 = always one)
  TRAVEL_PX: num('glidetravel', 80), // the picture's travel over the screen during one key picture, at most (pixels)
  UPLOADS_X: num('glideuploads', 3),  // the hooks that follow the camera run once a KEY PICTURE, not once a display frame: what they send to the
                                     // graphics card a call (the photograph on the ground's tiles) is this many times more (main.js)
  // A TRIAL THAT DID NOT PAY, kept behind ?glideadd=1: key pictures of DIFFERENT cameras added up. The mean so far is moved
  // to the new key picture's camera (each pixel by its depth) and mixed with the new key picture. With the camera still it
  // works (0.5 of 255 from the truth). In a move the mean is read between its pixels once a key picture, and that softens it
  // each time: slow orbit, error / sharpness against a 64-sample truth (no adding: 1.71 / 1.20): on the screen's own grid 2.75
  // / 0.40 (a mean of 8) and 1.86 / 0.69 (a mean of 1); on a 1.5 x finer grid (GRID) 3.42 / 0.68 and 2.52 / 0.75 (a mean of
  // 3, the sharp read). What DOES pay is PASSES above: more samples at ONE camera, nothing moved. (2026-11-12 and 11-13.)
  ADD: num('glideadd', 0),           // 1 = add up; 0 = each key picture alone
  GRID: num('glidegrid', 1),         // (the trial) the mean's grid is this many times finer than the screen's, each way
  ADD_R: num('glideaddr', 0.34), ADD_FLOOR: num('glideaddfloor', 0.03),   // a new sample counts fully AT a grid point and ADD_FLOOR at ADD_R pixels from it and beyond
  FINE_SHOW: num('glidefineshow', 0),   // how the mean is read for the screen: 0 = one smooth read, 1 = the pixel's four quarter points, 2 = the sharp filter       // the mean's grid is this many times finer than the screen's (each way): moving the mean then costs less sharpness
  ADD_MAX: num('glideaddmax', 8),    // the mean so far counts as at most this many pictures (more = calmer, and softer in a move)
  ADD_TOL: num('glideaddtol', 0.02), // the same surface: the depth differs by under this share
  STEPS: num('glidesteps', 3),       // steps of the search for where the key picture shows a screen pixel's point
  CUBIC: num('glidecubic', 1),       // 1 = the key picture is read with a sharp (Catmull-Rom) filter; 0 = plain
};

export function installGlide({ THREE, renderer, scene, camera, atKeyStart }) {
  const reversed = !!renderer.capabilities.reversedDepthBuffer, gl = renderer.getContext();
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const VS = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), oscene = new THREE.Scene();
  const showMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, vertexShader: VS,
    uniforms: { tKey: { value: null }, tKeyDepth: { value: null }, uRow: { value: new THREE.Vector4() }, uGround: { value: new THREE.Vector3() }, uKR: { value: new THREE.Vector3() }, uKU: { value: new THREE.Vector3() },
      uKF: { value: new THREE.Vector3() }, uNowFromKey: { value: new THREE.Matrix4() }, uFull: { value: new THREE.Vector2() }, uReversed: { value: reversed ? 1 : 0 }, uFarW: { value: 1 }, uCubic: { value: GLIDE.CUBIC }, uSteps: { value: GLIDE.STEPS }, uLight: { value: 0 }, uFineShow: { value: 0 }, uCol: { value: new THREE.Vector2() }, uOver: { value: new THREE.Vector2(1, 1) }, uDebug: { value: num('glidedebug', 0) } },
    fragmentShader: `
    precision highp float;
    uniform sampler2D tKey, tKeyDepth; uniform vec4 uRow; uniform vec3 uGround, uKR, uKU, uKF; uniform mat4 uNowFromKey; uniform vec2 uFull; uniform float uReversed, uFarW, uCubic, uDebug, uSteps, uLight, uFineShow; uniform vec2 uOver, uCol;
    // the mean (kept on a grid finer than the screen's): the four quarter points of the screen pixel, each read smoothly
    vec3 fine(vec2 uv) { vec2 o = 0.25 / uFull; return 0.25 * (texture2D(tKey, uv + vec2(-o.x, -o.y)).rgb + texture2D(tKey, uv + vec2(o.x, -o.y)).rgb + texture2D(tKey, uv + vec2(-o.x, o.y)).rgb + texture2D(tKey, uv + o).rgb); }
    varying vec2 vUv;
    vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    // metres along the key camera's axis of what the key picture shows at k (-1 .. 1)
    float keyDepth(vec2 k) {
      float d = texelFetch(tKeyDepth, ivec2(clamp((k * 0.5 + 0.5) * uFull, vec2(0.0), uFull - 1.0)), 0).r;
      // nothing wrote a depth here: the sky, or the GROUND (its layers have no depth of their own; the world's ground is the plane y = 0)
      if (d == 1.0 - uReversed) { float ig = dot(uGround, vec3(k, 1.0)); return ig * uFarW > 1.0 ? 1.0 / ig : uFarW; }
      return 1.0 / max(dot(uRow.zw, vec2(mix(d * 2.0 - 1.0, d, uReversed), 1.0)), 1e-9);
    }
    vec3 sharp(vec2 uv) {   // Catmull-Rom over 4 x 4 key pixels, as 9 filtered reads
      vec2 p = uv * uCol, tc = floor(p - 0.5) + 0.5, f = p - tc;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2, t0 = (tc - 1.0) / uCol, t3 = (tc + 2.0) / uCol, t12 = (tc + w2 / w12) / uCol;
      vec3 c = texture2D(tKey, vec2(t0.x, t0.y)).rgb * w0.x * w0.y + texture2D(tKey, vec2(t12.x, t0.y)).rgb * w12.x * w0.y + texture2D(tKey, vec2(t3.x, t0.y)).rgb * w3.x * w0.y
        + texture2D(tKey, vec2(t0.x, t12.y)).rgb * w0.x * w12.y + texture2D(tKey, vec2(t12.x, t12.y)).rgb * w12.x * w12.y + texture2D(tKey, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
        + texture2D(tKey, vec2(t0.x, t3.y)).rgb * w0.x * w3.y + texture2D(tKey, vec2(t12.x, t3.y)).rgb * w12.x * w3.y + texture2D(tKey, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
      // (the filter's negative lobes may not leave the range of the four pixels around the point: no bright or dark rim at an edge)
      vec3 c00 = texture2D(tKey, tc / uCol).rgb, c10 = texture2D(tKey, (tc + vec2(1.0, 0.0)) / uCol).rgb, c01 = texture2D(tKey, (tc + vec2(0.0, 1.0)) / uCol).rgb, c11 = texture2D(tKey, (tc + 1.0) / uCol).rgb;
      return clamp(c, min(min(c00, c10), min(c01, c11)), max(max(c00, c10), max(c01, c11)));
    }
    void main() {
      // want: the screen pixel (-1 .. 1 over the SCREEN); k: a point of the key picture (-1 .. 1 over the key picture, which is
      // uOver times wider and higher than the screen)
      vec2 want = vUv * 2.0 - 1.0, k = want / uOver; float miss = 0.0;
      for (int i = 0; i < 4; i++) {
        if (float(i) >= uSteps) break;
        float w = keyDepth(k);
        vec4 c = uNowFromKey * vec4(w * (uKF + k.x * uKR + k.y * uKU), 1.0);
        vec2 e = want - c.xy / c.w; k += e / uOver; miss = length(e * uFull / uOver);
      }
      vec2 uv = k * 0.5 + 0.5; uv = clamp(2.0 * clamp(uv, vec2(0.0), vec2(1.0)) - uv, vec2(0.0), vec2(1.0));   // (past the key picture's edge: its mirror image, not a smear)
      vec3 col = uLight > 0.5 ? (uFineShow > 1.5 ? sharp(uv) : uFineShow > 0.5 ? fine(uv) : texture2D(tKey, uv).rgb) : uCubic > 0.5 ? sharp(uv) : texture2D(tKey, uv).rgb;
      if (uDebug > 0.5) col = mix(col, vec3(1.0, 0.0, 1.0), clamp(miss * 0.5, 0.0, 1.0));   // (magenta: the search did not settle = a place the key picture did not see)
      gl_FragColor = vec4(uLight > 0.5 ? enc(col) : col, 1.0);   // (the mean is kept as light; a key picture alone is a display value already)
    }` });
  // the mean so far (moved to the new key picture's camera) and the new key picture -> the new mean. rgb = light, a = how many
  // pictures the mean counts as
  const addMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, vertexShader: VS,
    uniforms: { tNew: { value: null }, tNewDepth: { value: null }, tOld: { value: null }, tOldDepth: { value: null }, uRowN: { value: new THREE.Vector4() }, uRowO: { value: new THREE.Vector4() },
      uGroundN: { value: new THREE.Vector3() }, uGroundO: { value: new THREE.Vector3() }, uKR: { value: new THREE.Vector3() }, uKU: { value: new THREE.Vector3() }, uKF: { value: new THREE.Vector3() },
      uOldFromNew: { value: new THREE.Matrix4() }, uFull: { value: new THREE.Vector2() }, uFine: { value: new THREE.Vector2() }, uJit: { value: new THREE.Vector2() }, uReversed: { value: reversed ? 1 : 0 }, uFarN: { value: 1 }, uFarO: { value: 1 }, uMax: { value: 8 }, uTol: { value: 0.02 }, uFirst: { value: 1 }, uR: { value: 0.34 }, uFloor: { value: 0.03 } },
    fragmentShader: `
    precision highp float;
    uniform sampler2D tNew, tNewDepth, tOld, tOldDepth; uniform vec4 uRowN, uRowO; uniform vec3 uGroundN, uGroundO, uKR, uKU, uKF; uniform mat4 uOldFromNew; uniform vec2 uFull, uFine, uJit;
    uniform float uReversed, uFarN, uFarO, uMax, uTol, uFirst, uR, uFloor;
    vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    float depthOf(sampler2D t, vec4 row, vec3 ground, float farW, vec2 k, ivec2 p) {
      float d = texelFetch(t, clamp(p, ivec2(0), ivec2(uFull) - 1), 0).r;
      if (d == 1.0 - uReversed) { float ig = dot(ground, vec3(k, 1.0)); return ig * farW > 1.0 ? 1.0 / ig : farW; }
      return 1.0 / max(dot(row.zw, vec2(mix(d * 2.0 - 1.0, d, uReversed), 1.0)), 1e-9);
    }
    vec3 sharp(vec2 uv) {   // Catmull-Rom over 4 x 4 pixels of the mean, held to the range of the four pixels around the point
      vec2 p = uv * uFine, tc = floor(p - 0.5) + 0.5, f = p - tc;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2, t0 = (tc - 1.0) / uFine, t3 = (tc + 2.0) / uFine, t12 = (tc + w2 / w12) / uFine;
      vec3 c = texture2D(tOld, vec2(t0.x, t0.y)).rgb * w0.x * w0.y + texture2D(tOld, vec2(t12.x, t0.y)).rgb * w12.x * w0.y + texture2D(tOld, vec2(t3.x, t0.y)).rgb * w3.x * w0.y
        + texture2D(tOld, vec2(t0.x, t12.y)).rgb * w0.x * w12.y + texture2D(tOld, vec2(t12.x, t12.y)).rgb * w12.x * w12.y + texture2D(tOld, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
        + texture2D(tOld, vec2(t0.x, t3.y)).rgb * w0.x * w3.y + texture2D(tOld, vec2(t12.x, t3.y)).rgb * w12.x * w3.y + texture2D(tOld, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
      vec3 c00 = texture2D(tOld, tc / uFine).rgb, c10 = texture2D(tOld, (tc + vec2(1.0, 0.0)) / uFine).rgb, c01 = texture2D(tOld, (tc + vec2(0.0, 1.0)) / uFine).rgb, c11 = texture2D(tOld, (tc + 1.0) / uFine).rgb;
      return clamp(c, min(min(c00, c10), min(c01, c11)), max(max(c00, c10), max(c01, c11)));
    }
    void main() {
      // this point of the mean's grid, in the key picture's pixels and over the key picture (-1 .. 1)
      vec2 pf = gl_FragCoord.xy / uFine * uFull, k = pf / uFull * 2.0 - 1.0;
      // the new key picture's sample NEAREST to this point. The picture was drawn shifted by uJit pixels, so its pixel c is the
      // scene at c + uJit of the grid: the nearer that is to this point, the more it counts here
      ivec2 ip = ivec2(clamp(floor(pf - uJit), vec2(0.0), uFull - 1.0));
      vec2 d = abs(pf - (vec2(ip) + 0.5 + uJit));
      vec3 now = lin(texelFetch(tNew, ip, 0).rgb); float wn = mix(uFloor, 1.0, max(0.0, 1.0 - d.x / uR) * max(0.0, 1.0 - d.y / uR));
      vec3 mean = now; float n = 0.0;
      if (uFirst < 0.5) {
        float w = depthOf(tNewDepth, uRowN, uGroundN, uFarN, k, ivec2(pf));
        vec4 c = uOldFromNew * vec4(w * (uKF + k.x * uKR + k.y * uKU), 1.0);       // this point of the world, in the old key picture
        vec2 ko = c.xy / c.w, uv = ko * 0.5 + 0.5;
        if (c.w > 0.0 && uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
          // the same surface there? the old picture's depth AT the point. (Beside the point does not count: next to a tower's
          // edge the roof behind it has the right depth, and the mean there is the tower: it left trails, seen 2026-11-12.)
          float best = abs(depthOf(tOldDepth, uRowO, uGroundO, uFarO, ko, ivec2(uv * uFull)) - c.w);
          if (best < uTol * c.w) { mean = sharp(uv); n = min(texture2D(tOld, uv).a, uMax); }
        }
      }
      gl_FragColor = vec4((mean * n + now * wn) / (n + wn), n + wn);
    }` });
  // one more pass of a key picture into its mean (light)
  const passMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, vertexShader: VS,
    uniforms: { tNew: { value: null }, tAcc: { value: null }, uShare: { value: 1 } },
    fragmentShader: `precision highp float; uniform sampler2D tNew, tAcc; uniform float uShare;
      vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      void main() { ivec2 p = ivec2(gl_FragCoord.xy); gl_FragColor = vec4(mix(texelFetch(tAcc, p, 0).rgb, lin(texelFetch(tNew, p, 0).rgb), uShare), 1.0); }` });
  const mesh = new THREE.Mesh(tri, showMat); mesh.frustumCulled = false; oscene.add(mesh);
  const size = new THREE.Vector2(), kcam = camera.clone(), vp = new THREE.Matrix4(), inv = new THREE.Matrix4(), tr = new THREE.Matrix4(), v3 = new THREE.Vector3();
  const key = { eye: new THREE.Vector3(), row: new THREE.Vector4(), ground: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3(), F: new THREE.Vector3(), far: 1, have: false,
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vp: new THREE.Matrix4() };
  const old = { row: new THREE.Vector4(), ground: new THREE.Vector3(), far: 1, vp: new THREE.Matrix4() };   // the key picture before: for the adding pass
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  let acc = [null, null], accCur = 0, accHave = false, jx = 0, jy = 0, keyN = 0;
  let pacc = [null, null], pCur = 0, pass = 0, pShown = -1, keyPasses = 1, shownMany = false, passT0 = 0;       // the passes of a key picture: their mean (two, in turn); the one that is shown
  const stats = { stalls: [], late: 0, keys: 0, slices: 0, shows: 0, size: [0, 0], keyMs: 0, keySlices: 0, draws: 0, modelMs: 0 };

  // ── the key picture's own framebuffers (plain WebGL: three.js resolves a multisampled target after EVERY draw of the scene, a
  // full-size copy a slice; here it is resolved once, when the picture is complete) ──
  // While a slice is drawn, "the screen" is the key picture: three.js draws the scene exactly as it draws it to the canvas (the
  // same programs, tone mapping and colour space, the hooks that run for the screen), and every bind of the screen lands here.
  const bind = gl.bindFramebuffer.bind(gl);
  let redirect = null;
  gl.bindFramebuffer = (t, f) => bind(t, f === null && redirect !== null ? redirect : f);
  let ms = null, res = [null, null], cur = 0;
  function targets(SW, SH) {
    // the key picture's size: the screen's, and the overscan on each side (the same pixels a degree as the screen)
    const W = Math.round(SW * (1 + 2 * GLIDE.OVER_X)), H = Math.round(SH * (1 + 2 * GLIDE.OVER_Y));
    if (ms && ms.W === W && ms.H === H) return;
    if (ms) { gl.deleteFramebuffer(ms.fbo); gl.deleteRenderbuffer(ms.c); gl.deleteRenderbuffer(ms.d); for (const r of res) { gl.deleteFramebuffer(r.fbo); gl.deleteTexture(r.c); gl.deleteTexture(r.d); r.tc.dispose(); r.td.dispose(); } }
    const samples = Math.min(GLIDE.SAMPLES, gl.getParameter(gl.MAX_SAMPLES));
    ms = { W, H, SW, SH, ox: W / SW, oy: H / SH, fbo: gl.createFramebuffer(), c: gl.createRenderbuffer(), d: gl.createRenderbuffer() };
    gl.bindRenderbuffer(gl.RENDERBUFFER, ms.c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, ms.d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT32F, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    bind(gl.FRAMEBUFFER, ms.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, ms.c); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, ms.d);
    stats.fbo = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    res = [0, 1].map(() => {
      const r = { fbo: gl.createFramebuffer(), c: gl.createTexture(), d: gl.createTexture() };
      const tex = (t, fmt, filter) => { renderer.state.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, W, H);   // (bound through three.js, so its record of what is bound stays true)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); };
      tex(r.c, gl.RGBA8, gl.LINEAR); tex(r.d, gl.DEPTH_COMPONENT32F, gl.NEAREST); renderer.state.unbindTexture();
      bind(gl.FRAMEBUFFER, r.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.c, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, r.d, 0);
      stats.fbo = stats.fbo && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      r.tc = new THREE.ExternalTexture(r.c); r.td = new THREE.ExternalTexture(r.d);
      return r; });
    const FW = Math.round(W * GLIDE.GRID), FH = Math.round(H * GLIDE.GRID); ms.FW = FW; ms.FH = FH; fineVp.set(0, 0, FW / renderer.getPixelRatio(), FH / renderer.getPixelRatio());
    if (acc[0]) for (const a of acc) { gl.deleteFramebuffer(a.fbo); gl.deleteTexture(a.c); a.tc.dispose(); }
    acc = [0, 1].map(() => { const a = { fbo: gl.createFramebuffer(), c: gl.createTexture() };
      renderer.state.bindTexture(gl.TEXTURE_2D, a.c); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, FW, FH);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); renderer.state.unbindTexture();
      bind(gl.FRAMEBUFFER, a.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a.c, 0);
      stats.fbo = stats.fbo && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      a.tc = new THREE.ExternalTexture(a.c); return a; });
    accHave = false;
    if (pacc[0]) for (const a of pacc) { gl.deleteFramebuffer(a.fbo); gl.deleteTexture(a.c); a.tc.dispose(); }
    pacc = [0, 1, 2].map(() => { const a = { fbo: gl.createFramebuffer(), c: gl.createTexture() };
      renderer.state.bindTexture(gl.TEXTURE_2D, a.c); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, W, H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); renderer.state.unbindTexture();
      bind(gl.FRAMEBUFFER, a.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a.c, 0);
      a.tc = new THREE.ExternalTexture(a.c); return a; });
    pShown = -1; pass = 0;
    // back to the screen, and three.js told so. (NOT renderer.resetState(): that also switches the renderer's reversed depth
    // off for good, and every depth after it is read the wrong way round: found 2026-11-12, the moved picture was far off.)
    bind(gl.FRAMEBUFFER, null); renderer.setRenderTarget(null);
    key.have = false; slice = -1; wantKey = true; stats.size = [W, H];
    keyVp.set(0, 0, W / renderer.getPixelRatio(), H / renderer.getPixelRatio());
  }

  // ── a key picture in slices ──
  // the cost of one draw call by the model (ms): its triangles, and the pixels it can fill
  function cost(geometry, object, group) {
    const n = group ? group.count : geometry.index ? geometry.index.count : geometry.attributes.position ? geometry.attributes.position.count : 0;
    const tris = n / 3 * (object.isInstancedMesh ? object.count : 1);
    let px = ms.W * ms.H;                                             // (a thing with no bounding sphere is one that is never culled: the ground, the sky)
    const bs = object.boundingSphere || geometry.boundingSphere;
    if (bs && object.frustumCulled !== false) {
      const d = v3.copy(bs.center).applyMatrix4(object.matrixWorld).distanceTo(kcam.position), r = bs.radius * object.matrixWorld.getMaxScaleOnAxis();
      const rpx = r / Math.max(d, r) * (ms.SH / 2) / Math.tan(kcam.fov * Math.PI / 360);
      px = Math.min(px, Math.PI * rpx * rpx);
    }
    return tris * GLIDE.TRI_MS + px * GLIDE.COVER * GLIDE.PX_MS;
  }
  const drawDirect = renderer.renderBufferDirect;
  let win = null;                                                     // while a slice is drawn: which of the frame's draw calls are its own
  renderer.renderBufferDirect = function (cam, sc, geometry, material, object, group) {
    if (win === null || cam !== camera) return drawDirect.call(this, cam, sc, geometry, material, object, group);   // (not a key picture; or its shadow map)
    const k = win.k++;
    if (win.first) {
      const w = cost(geometry, object, group) * gain * (learned.get(object) || 1); win.w.push(w);
      if (win.stop < 0 && (win.acc < win.budget || k === 0)) { win.acc += w; stats.draws++; win.objs.push(object); return drawDirect.call(this, cam, sc, geometry, material, object, group); }
      if (win.stop < 0) win.stop = k;
      return;
    }
    if (k >= win.from && k < win.to) { stats.draws++; win.objs.push(object); return drawDirect.call(this, cam, sc, geometry, material, object, group); }
  };
  const noHook = () => {}, livePos = new THREE.Vector3(), liveQuat = new THREE.Quaternion(), keyVp = new THREE.Vector4(), fineVp = new THREE.Vector4(), liveVp = new THREE.Vector4(), keyProj = new THREE.Matrix4();
  let slice = -1, bounds = [], wantKey = true, contentStale = false, keyT0 = 0, keyDraws = 0, misses = 0, drew = null, lastSlice = -1, lastCpu = 0;
  const learned = new WeakMap(), gain = GLIDE.GAIN;                // a thing -> how many times dearer than the model says
  // the camera's motion, a display frame to the next (for the key picture's lead)
  const mo = { t: 0, dt: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), have: false, px: 1e9 };
  // the display frame to hold (ms): a whole number of the SCREEN'S own frames. The screen's frame time is measured once, at the
  // start, with frames that draw nothing (later every frame carries a slice, and its time says how long the work took, not
  // how fast the screen is): the shortest gap of 90.
  let frameMs = GLIDE.FPS ? 1000 / GLIDE.FPS : 1000 / 60;
  if (!GLIDE.FPS) { let n = 0, last = 0, best = Infinity;
    const probe = (t) => { if (last && t - last > 3) best = Math.min(best, t - last); last = t;
      if (++n < 90) requestAnimationFrame(probe); else if (best < 50) { frameMs = best * Math.max(1, Math.ceil(GLIDE.FRAME_MIN_MS / best - 0.02)); stats.screenMs = best; stats.frameMs = frameMs; } };
    requestAnimationFrame(probe); }
  // the passes a key picture may have at the camera's present speed over the screen (pixels a second)
  let passMs = 100;                                                  // how long one pass takes (learned)
  const passesFor = () => { const mx = Math.max(1, Math.round(GLIDE.PASSES)); if (mx < 2 || mo.px > 1e8) return 1;
    return Math.max(1, Math.min(mx, Math.floor(GLIDE.TRAVEL_PX / Math.max(1e-3, mo.px * passMs / 1000)))); };
  const samePose = () => key.pos.distanceToSquared(camera.position) < 1e-8 && Math.abs(key.quat.dot(camera.quaternion)) > 1 - 1e-10;
  function startKey(now) {
    camera.updateMatrixWorld();
    kcam.position.copy(camera.position); kcam.quaternion.copy(camera.quaternion); kcam.fov = camera.fov; kcam.aspect = camera.aspect; kcam.near = camera.near; kcam.far = camera.far; kcam.layers.mask = camera.layers.mask;
    // for where the camera will be when this picture is shown: it is complete after about the last one's time, and shown for as long again
    const lead = key.have && mo.have && mo.dt > 0 && mo.dt < 100 ? GLIDE.LEAD * Math.min(400, 1.5 * stats.keyMs) : 0;
    if (lead > 0) { kcam.position.addScaledVector(mo.vel, lead); kcam.quaternion.slerpQuaternions(mo.quat, camera.quaternion, 1 + lead / mo.dt).normalize(); }
    kcam.clearViewOffset(); kcam.updateProjectionMatrix(); kcam.updateMatrixWorld();
    if (atKeyStart) atKeyStart(kcam);                                 // (the shadow box and the sky's dome follow the key picture's camera, once a key picture)
    keyN++; jx = GLIDE.ADD ? halton(keyN % 64 + 1, 2) - 0.5 : 0; jy = GLIDE.ADD ? halton(keyN % 64 + 1, 3) - 0.5 : 0;   // (a part of a pixel, another one each key picture)
    pass = 0; keyPasses = passesFor(); if (keyPasses > 1) { jx = 0; jy = 0; }   // (the first pass of a key picture is not shifted: its depth is the key picture's)
    slice = 0; wantKey = false; contentStale = false; keyT0 = now; passT0 = now; stats.draws = 0; stats.lead = lead;
  }
  function drawSlice(now) {
    const first = slice === 0 && pass === 0, auto = renderer.autoClear, hook = scene.onBeforeRender;
    renderer.setRenderTarget(null);
    redirect = ms.fbo; bind(gl.FRAMEBUFFER, ms.fbo);
    renderer.autoClear = slice === 0;                                 // a pass's first slice clears the picture; the rest draw on
    if (first) win = { first: true, k: 0, acc: 0, budget: key.have ? GLIDE.SLICE_MS * GLIDE.FIRST : Infinity, stop: -1, w: [], objs: [] };
    else { win = { first: false, k: 0, from: bounds[slice], to: bounds[slice + 1], objs: [] }; scene.onBeforeRender = noHook; }   // (the hooks that follow the camera ran with the first slice)
    // The scene is drawn with the app's OWN camera, put at the key picture's pose for the length of the draw: the hooks that
    // follow the camera (the photograph on the ground, the lamps) act for that camera only.
    livePos.copy(camera.position); liveQuat.copy(camera.quaternion);
    camera.position.copy(kcam.position); camera.quaternion.copy(kcam.quaternion); camera.updateMatrixWorld(true);
    // ...and its view made wider and higher by the overscan (a view offset larger than the full view), into the key picture's size
    // (the key picture's NUMBERS are those of the view without its shift: the mean lives on one fixed grid, and a shifted
    // picture added to it as it is IS the finer sampling. Taking the shift out by reading the mean between its pixels blurred
    // the mean a little more with every key picture: sharpness 0.25 of the truth's, measured 2026-11-12.)
    if (first) { camera.setViewOffset(ms.SW, ms.SH, -(ms.W - ms.SW) / 2, -(ms.H - ms.SH) / 2, ms.W, ms.H); camera.updateProjectionMatrix(); keyProj.copy(camera.projectionMatrix); camera.clearViewOffset(); }
    camera.setViewOffset(ms.SW, ms.SH, -(ms.W - ms.SW) / 2 + jx, -(ms.H - ms.SH) / 2 + jy, ms.W, ms.H); camera.updateProjectionMatrix();
    renderer.getViewport(liveVp); renderer.setViewport(keyVp);
    const c0 = performance.now(); lastSlice = slice;
    try { renderer.render(scene, camera); }
    finally { lastCpu = performance.now() - c0; scene.onBeforeRender = hook; renderer.autoClear = auto; redirect = null; bind(gl.FRAMEBUFFER, null);
      renderer.setViewport(liveVp); camera.clearViewOffset(); camera.updateProjectionMatrix();
      camera.position.copy(livePos); camera.quaternion.copy(liveQuat); camera.updateMatrixWorld(true); }
    if (first) {
      // the rest of the frame's draw calls, cut where the model says a slice's time is used
      const w = win.w, M = w.length, from = win.stop < 0 ? M : win.stop; bounds = [0, from];
      let restMs = 0; for (let k = from; k < M; k++) restMs += w[k];
      const n = from < M ? Math.min(GLIDE.MAX_SLICES - 1, Math.max(1, Math.ceil(restMs / GLIDE.SLICE_MS))) : 0, per = restMs / Math.max(1, n);
      let acc = 0, k = from; for (let i = 1; i < n; i++) { while (k < M && acc + w[k] <= per * i) acc += w[k++]; if (k === bounds[bounds.length - 1] && k < M) acc += w[k++]; bounds.push(k); }
      if (n > 0) bounds.push(M);
      stats.modelMs = win.acc + restMs; keyDraws = M;
    }
    drew = key.have ? win.objs : null;                               // (what this display frame's slice drew: judged when the next frame comes)
    win = null; slice++; stats.slices++;
    if (slice >= bounds.length - 1) { if (keyPasses > 1) endPass(now); else finishKey(now); }
  }
  // a pass of a key picture is complete: into the key picture's mean; after the last pass the key picture is complete
  function endPass(now) {
    stats.keySlices = slice;
    bind(gl.READ_FRAMEBUFFER, ms.fbo); bind(gl.DRAW_FRAMEBUFFER, res[1 - cur].fbo);                 // (the depth is the first pass's)
    gl.blitFramebuffer(0, 0, ms.W, ms.H, 0, 0, ms.W, ms.H, gl.COLOR_BUFFER_BIT | (pass === 0 ? gl.DEPTH_BUFFER_BIT : 0), gl.NEAREST);
    bind(gl.READ_FRAMEBUFFER, null); bind(gl.DRAW_FRAMEBUFFER, null);
    // the mean is built in the two targets that are NOT the shown one
    const free = [0, 1, 2].filter((i) => i !== pShown), from = pass === 0 ? free[0] : pCur, to = free.find((i) => i !== from);
    const u = passMat.uniforms; u.tNew.value = res[1 - cur].tc; u.tAcc.value = pacc[from].tc; u.uShare.value = 1 / (pass + 1);
    passMat.uniformsNeedUpdate = true; mesh.material = passMat;
    const auto = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(null); renderer.getViewport(liveVp); renderer.setViewport(keyVp);
    redirect = pacc[to].fbo; bind(gl.FRAMEBUFFER, redirect);
    try { renderer.render(oscene, ocam); } finally { redirect = null; bind(gl.FRAMEBUFFER, null); renderer.setViewport(liveVp); renderer.autoClear = auto; }
    pCur = to; pass++; passMs += ((now - passT0) - passMs) * 0.3; passT0 = now;
    if (pass < Math.min(keyPasses, passesFor())) { slice = 0; jx = halton(pass, 2) - 0.5; jy = halton(pass, 3) - 0.5; return; }   // the next pass, shifted (not when the camera has sped up meanwhile)
    pShown = pCur; finishKey(now, true);
  }
  function finishKey(now, resolved = false) {
    stats.keySlices = slice; slice = -1; shownMany = resolved; stats.passes = resolved ? pass : 1;
    // the complete picture, resolved once: colour and depth
    if (!resolved) {
      bind(gl.READ_FRAMEBUFFER, ms.fbo); bind(gl.DRAW_FRAMEBUFFER, res[1 - cur].fbo);
      gl.blitFramebuffer(0, 0, ms.W, ms.H, 0, 0, ms.W, ms.H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      bind(gl.READ_FRAMEBUFFER, null); bind(gl.DRAW_FRAMEBUFFER, null);
    }
    cur = 1 - cur;
    // where each pixel of this key picture is in the world: its camera, kept (the one before goes to `old`)
    old.row.copy(key.row); old.ground.copy(key.ground); old.far = key.far; old.vp.copy(key.vp);
    // The projection is the one the slices were drawn with: the app's own camera's (three.js builds it for its depth buffer's
    // direction on the cameras it draws with), with the overscan, WITHOUT this key picture's shift (see drawSlice).
    key.vp.multiplyMatrices(keyProj, kcam.matrixWorldInverse); inv.copy(key.vp).invert();
    const e = inv.elements, m = kcam.matrixWorld.elements, pm = keyProj.elements, cy = m[13];
    key.row.set(e[3], e[7], e[11], e[15]); key.far = kcam.far; key.eye.set(m[12], m[13], m[14]);
    key.R.set(m[0], m[1], m[2]).multiplyScalar(1 / pm[0]); key.U.set(m[4], m[5], m[6]).multiplyScalar(1 / pm[5]);
    // the line of sight through the picture's centre: forward, and the shift of the projection (pm[8], pm[9])
    key.F.set(-m[8], -m[9], -m[10]).addScaledVector(key.R, pm[8]).addScaledVector(key.U, pm[9]);
    // the ground plane y = 0 as 1 / (view depth) over the picture: eye.y + w (F + x R + y U).y = 0
    if (cy > 1e-3) key.ground.set(-key.R.y / cy, -key.U.y / cy, -key.F.y / cy); else key.ground.set(0, 0, 0);
    if (GLIDE.ADD) {
      const u = addMat.uniforms, n = res[cur], o = res[1 - cur];   // (cur was just switched: res[cur] is the new key picture, res[1 - cur] the one before)
      u.tNew.value = n.tc; u.tNewDepth.value = n.td; u.tOld.value = acc[accCur].tc; u.tOldDepth.value = o.td;
      u.uRowN.value.copy(key.row); u.uGroundN.value.copy(key.ground); u.uFarN.value = key.far; u.uRowO.value.copy(old.row); u.uGroundO.value.copy(old.ground); u.uFarO.value = old.far;
      u.uKR.value.copy(key.R); u.uKU.value.copy(key.U); u.uKF.value.copy(key.F); u.uOldFromNew.value.multiplyMatrices(old.vp, tr.makeTranslation(key.eye.x, key.eye.y, key.eye.z));
      u.uFull.value.set(ms.W, ms.H); u.uFine.value.set(ms.FW, ms.FH); u.uJit.value.set(jx, -jy); u.uR.value = GLIDE.ADD_R; u.uFloor.value = GLIDE.ADD_FLOOR; u.uMax.value = GLIDE.ADD_MAX; u.uTol.value = GLIDE.ADD_TOL; u.uFirst.value = accHave ? 0 : 1;
      addMat.uniformsNeedUpdate = true; mesh.material = addMat;
      const auto = renderer.autoClear; renderer.autoClear = false;
      renderer.setRenderTarget(null); renderer.getViewport(liveVp); renderer.setViewport(fineVp);
      redirect = acc[1 - accCur].fbo; bind(gl.FRAMEBUFFER, redirect);
      try { renderer.render(oscene, ocam); } finally { redirect = null; bind(gl.FRAMEBUFFER, null); renderer.setViewport(liveVp); renderer.autoClear = auto; }
      accCur = 1 - accCur; accHave = true;
    }
    key.pos.copy(kcam.position); key.quat.copy(kcam.quaternion); key.have = true;
    stats.keys++; stats.keyMs = now - keyT0; stats.keyDraws = keyDraws; if (!resolved) passMs += ((now - passT0) - passMs) * 0.3; stats.passMs = passMs;
    stats.gain = gain; stats.misses = misses; misses = 0;
    if (contentStale || !samePose()) wantKey = true;                 // the camera or the city went on while this one was drawn
  }
  function show(W, H) {
    camera.updateMatrixWorld();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const u = showMat.uniforms, r = res[cur];
    u.uNowFromKey.value.multiplyMatrices(vp, tr.makeTranslation(key.eye.x, key.eye.y, key.eye.z));
    const mean = GLIDE.ADD && accHave, many = shownMany && pShown >= 0;
    u.tKey.value = many ? pacc[pShown].tc : mean ? acc[accCur].tc : r.tc; u.uLight.value = many || mean ? 1 : 0; u.uFineShow.value = many ? 2 : GLIDE.FINE_SHOW;
    if (mean && !many) u.uCol.value.set(ms.FW, ms.FH); else u.uCol.value.set(ms.W, ms.H); u.tKeyDepth.value = r.td; u.uRow.value.copy(key.row); u.uGround.value.copy(key.ground);
    u.uKR.value.copy(key.R); u.uKU.value.copy(key.U); u.uKF.value.copy(key.F); u.uFarW.value = key.far; u.uFull.value.set(ms.W, ms.H); u.uOver.value.set(ms.ox, ms.oy); u.uCubic.value = GLIDE.CUBIC; u.uSteps.value = GLIDE.STEPS;
    showMat.uniformsNeedUpdate = true;                              // (three.js does not send a material's uniforms again when the same material draws twice in a row)
    mesh.material = showMat; renderer.setRenderTarget(null); renderer.render(oscene, ocam);
    stats.shows++;
  }
  return {
    stats, GLIDE,
    drawing: () => slice >= 0,
    // give up the key picture that is being drawn (the film starts: nothing is drawn for a while, and tiles may come and go)
    drop() { slice = -1; win = null; wantKey = true; drew = null; },
    // (a test) the cost of showing the key picture: n shows, then a wait for the GPU; ms a show
    bench(n = 30) { const px = new Uint8Array(4), W = ms.W, H = ms.H; renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now(); for (let i = 0; i < n; i++) show(W, H); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; },
    busy: () => slice >= 0 || wantKey || !key.have,
    // one display frame. stale = the camera moved or the city changed since the last call; moved = it was the camera
    frame(stale, moved, now = performance.now()) {
      renderer.getDrawingBufferSize(size);
      const W = size.x, H = size.y; targets(W, H);
      const auto = renderer.info.autoReset; renderer.info.autoReset = false; renderer.info.reset();
      // the camera's speed (metres a ms) and its turn since the last display frame
      camera.updateMatrixWorld();
      const dt = now - mo.t;
      if (mo.have && dt > 0 && dt < 100) { v3.copy(camera.position).sub(mo.pos).multiplyScalar(1 / dt); mo.vel.lerp(v3, 0.5); mo.dt = dt;
        // its speed over the screen, pixels a second: its turn, and its travel against its height
        const f = (ms.SH / 2) / Math.tan(camera.fov * Math.PI / 360), turn = 2 * Math.acos(Math.min(1, Math.abs(mo.quat.dot(camera.quaternion))));
        const px = (turn / dt * 1000 + v3.length() * 1000 / Math.max(30, camera.position.y)) * f; mo.px = mo.px > 1e8 ? px : mo.px + (px - mo.px) * 0.3;
      } else { mo.vel.set(0, 0, 0); mo.dt = 0; }
      const late = mo.have && dt > 1.25 * frameMs;
      if (late) { stats.late++; misses++; }
      if (mo.have && dt > 100) { stats.stalls.push({ ms: Math.round(dt), slice: lastSlice, cpu: Math.round(lastCpu), programs: renderer.info.programs ? renderer.info.programs.length : 0, tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries }); if (stats.stalls.length > 12) stats.stalls.shift(); }
      if (drew && GLIDE.LEARN && mo.have && dt < GLIDE.LEARN_LATE_MS) {   // the slice the last display frame drew: too long, or short enough
        const f = late ? GLIDE.LEARN_UP : dt < 1.05 * frameMs ? GLIDE.LEARN_DOWN : 1;
        if (f !== 1) for (const o of drew) learned.set(o, Math.min(GLIDE.LEARN_MAX, Math.max(GLIDE.LEARN_MIN, (learned.get(o) || 1) * f)));
      }
      drew = null;
      if (stale) { wantKey = true; if (!moved) contentStale = true; }
      if (key.have && !samePose()) wantKey = true;                   // (the camera is not where the key picture was taken)
      if (!key.have) { startKey(now); while (slice >= 0) drawSlice(now); }   // the first key picture: all of it now
      else { if (slice < 0 && wantKey && !GLIDE.FREEZE) startKey(now); if (slice >= 0) drawSlice(now); }   // (FREEZE: a test holds the key picture)
      mo.pos.copy(camera.position); mo.quat.copy(camera.quaternion); mo.t = now; mo.have = true;   // (kept AFTER the key picture's start: its turn is from the last frame to this one)
      show(W, H);
      renderer.info.autoReset = auto;
    },
  };
}
