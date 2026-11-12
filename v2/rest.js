// v2/rest.js - the clean still: when the camera rests, shifted full-size frames are added up, and the picture becomes the mean
// of many samples a pixel (2026-11-12).
//
// For the path that draws every frame at full size with the canvas's own multisampling (the owner's monitor: one canvas pixel per
// CSS pixel, where the steady picture of steady.js is off). Four samples a pixel cannot hold a part thinner than a pixel: a window
// bar 0.1 m wide is a row of dashes from about 200 m on, an edge is a stair. In motion that cannot be had for free on this GPU
// (16 samples a pixel cost twice the frame time: measured 2026-10-10). But at REST it costs nothing that anyone waits for: the
// camera stands still, so the same picture can be drawn again, moved by a part of a pixel each time, and the frames added up as
// light. After REST.FRAMES of them every pixel is the mean of 4 x REST.FRAMES samples: bars are whole lines, edges are smooth.
// The first frame added is the unshifted one (the still as it was), so nothing jumps; each later frame counts for 1 / (frames so
// far), so the picture only ever moves toward its mean, by less each time.
//
// main.js draws a rest frame on each animation frame while nothing else needs drawing (REST_ON, frame()); any motion or change
// of content draws a plain frame and starts the count again. Off for the verify scripts (a page under a test driver), which
// read stills at moments of their own: ?rest=1 turns it on for a test of this file (scripts/verify/v2-rest.mjs).
export const REST = {
  FRAMES: 16,     // shifted frames added up (x 4 samples of the canvas each)
  SPREAD: 1.0,    // the shifts span this share of a pixel (1 = the whole pixel: the exact mean over the pixel; less = sharper, edges less smooth)
  WAIT_MS: 150,   // the camera has been still for this long before the first one (a drag that pauses does not start it)
  SAMPLES: 4,     // multisampling of each frame (the canvas's own count)
};

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export function installRest({ THREE, renderer, scene, camera }) {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const VS = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const pass = (uniforms, fragmentShader) => new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, uniforms, vertexShader: VS, fragmentShader });
  const LIN = 'vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }';
  const ENC = 'vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }';
  // the mean so far (light) and the new frame (a display value) -> the new mean
  const mixMat = pass({ tNew: { value: null }, tAcc: { value: null }, uShare: { value: 1 } },
    `precision highp float; uniform sampler2D tNew, tAcc; uniform float uShare; varying vec2 vUv; ${LIN}
     void main() { ivec2 p = ivec2(gl_FragCoord.xy); gl_FragColor = vec4(mix(texelFetch(tAcc, p, 0).rgb, lin(texelFetch(tNew, p, 0).rgb), uShare), 1.0); }`);
  const showMat = pass({ tAcc: { value: null } },
    `precision highp float; uniform sampler2D tAcc; varying vec2 vUv; ${ENC}
     void main() { gl_FragColor = vec4(enc(texelFetch(tAcc, ivec2(gl_FragCoord.xy), 0).rgb), 1.0); }`);
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), oscene = new THREE.Scene();
  const mesh = new THREE.Mesh(tri, mixMat); mesh.frustumCulled = false; oscene.add(mesh);
  const size = new THREE.Vector2();
  let frameRT = null, acc = [null, null], cur = 0, n = 0;
  function targets(W, H) {
    if (frameRT && frameRT.width === W && frameRT.height === H) return;
    if (frameRT) { frameRT.dispose(); acc[0].dispose(); acc[1].dispose(); }
    frameRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, samples: REST.SAMPLES });
    // its storage is made first; only then is it named a screen in the output colour space, so the scene's shaders write display
    // values into it exactly as into the canvas (steady.js: a multisampled target named before its first use cannot be resolved)
    renderer.setRenderTarget(frameRT); renderer.setRenderTarget(null);
    frameRT.isXRRenderTarget = true; frameRT.texture.colorSpace = renderer.outputColorSpace;
    acc = [0, 1].map(() => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false }));
    n = 0;
  }
  return {
    stats: { frames: 0, runs: 0 },
    reset() { n = 0; },                                   // the next rest frame starts a new mean
    more() { return n < REST.FRAMES; },                   // the still is not yet complete
    count: () => n,
    // the mean so far, drawn on the canvas again (a test reads the canvas in the same step it was drawn in)
    show() { if (!n) return; showMat.uniforms.tAcc.value = acc[cur].texture; mesh.material = showMat; renderer.setRenderTarget(null); renderer.render(oscene, ocam); },
    // one more frame of the still: drawn shifted, added to the mean, the mean shown on the canvas
    render() {
      renderer.getDrawingBufferSize(size);
      const W = size.x, H = size.y; targets(W, H);
      const k = n, jx = k ? (halton(k, 2) - 0.5) * REST.SPREAD : 0, jy = k ? (halton(k, 3) - 0.5) * REST.SPREAD : 0;
      // the hooks that follow the camera run for a draw to the screen only: give them their turn (the camera has not moved)
      scene.onBeforeRender(renderer, scene, camera, null);
      camera.setViewOffset(W, H, jx, jy, W, H); camera.updateProjectionMatrix();
      const auto = renderer.info.autoReset; renderer.info.autoReset = false; renderer.info.reset();
      renderer.setRenderTarget(frameRT); renderer.clear(); renderer.render(scene, camera);
      camera.clearViewOffset(); camera.updateProjectionMatrix();
      mixMat.uniforms.tNew.value = frameRT.texture; mixMat.uniforms.tAcc.value = acc[cur].texture; mixMat.uniforms.uShare.value = 1 / (k + 1);
      mesh.material = mixMat; renderer.setRenderTarget(acc[1 - cur]); renderer.render(oscene, ocam);
      cur = 1 - cur; n++;
      showMat.uniforms.tAcc.value = acc[cur].texture; mesh.material = showMat; renderer.setRenderTarget(null); renderer.render(oscene, ocam);
      renderer.info.autoReset = auto;
      this.stats.frames++; if (k === 0) this.stats.runs++;
    },
  };
}
