// The v2 ground: the City of Austin 2025 aerial (6 inch), streamed by distance and laid flat under the city.
//
//   near the camera  z17-z20 from the City's own tile server (live; 0.13 m a pixel at z20)
//   everywhere else  z13 / z15 / z16 baked into the repo (v2/data/aerial, scripts/v2/street_aerial.py), so the far ground and the
//                    demo never depend on the City's server; if even the baked files fail, the plain ground and the drawn roads stay.
//
// Placement: a Web Mercator tile's corners go through v2/geo.js toLocal(), the same function every other layer uses. Inside one
// tile the Mercator rows are spaced linearly (the error that leaves is under 0.2 m on a z13 tile and under 1 cm on z17+).
//
// Rule 15 (no shimmer, no blur): every tile has full mipmaps and anisotropic filtering, and the level is chosen so a texel is about
// one screen pixel where the tile is nearest (GROUND_LOOK.LOD_FACTOR): sharp near the camera, a coarser level far away.
//
// The photograph is January: long shadows and leaning roofs are in its pixels. The shader lifts the shadows where a baked mask
// (mask.png: R = the photograph's building shadows, G = round tall buildings) agrees, and only on dark pixels.
//
// Hook (main.js): installGround({ THREE, scene, camera, renderer, city, redraw, phone }). Everything else lives in this file.
import { toLocal } from './geo.js';
import { GROUND_LOOK as G } from './street-look.js';

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/aerial/', import.meta.url).href;

export function installGround({ THREE, scene, camera, renderer, city, redraw, phone = false }) {
  addCredits();
  if (!G.ON || params.get('aerial') === '0') return null;

  const LOD = +(params.get('aeriallod') || (phone ? G.LOD_FACTOR_PHONE : G.LOD_FACTOR));
  const MAXZ = Math.min(+(params.get('aerialmaxz') || (phone ? G.MAX_ZOOM_PHONE : G.MAX_ZOOM)), 20);
  const CACHE = phone ? G.CACHE_TILES_PHONE : G.CACHE_TILES;
  const ANISO = Math.min(G.ANISOTROPY, renderer.capabilities.getMaxAnisotropy());
  const LIVE_OFF = params.get('aeriallive') === '0';      // the "City server is down" case, on demand

  const state = {
    index: null, levels: [], roots: [], nodes: new Map(), selected: [], shown: new Set(),
    loading: 0, liveLoading: 0, localLoading: 0, queue: [], ready: [],
    liveOk: 0, liveFail: 0, localOk: 0, localFail: 0, failRun: 0, livePausedUntil: 0,
    lastKey: '', baseReady: false, failed: false, frame: 0,
  };

  // ── shared pieces ────────────────────────────────────────────────────
  // a unit quad on the ground: x east 0..1, z south 0..1; uv = (x, z) because the tiles are uploaded without a flip (row 0 = north)
  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], 3));
  quad.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  quad.setIndex([0, 2, 1, 1, 2, 3]);     // counter-clockwise seen from above: the face points up
  const lin = (hex) => new THREE.Color(hex);  // three converts sRGB hex to linear
  const sat = G.SATURATION, gain = G.GAIN;
  const U = {
    gGain: { value: new THREE.Vector3(...G.TINT.map((t) => t * gain)) },
    gSat: { value: sat },
    gSatNear: { value: G.SATURATION_NEAR },
    gMask: { value: null },
    gMaskBox: { value: new THREE.Vector4(0, 0, 0, 0) },
    gLift: { value: G.SHADOW_LIFT },
    gWarm: { value: new THREE.Vector3(...G.SHADOW_WARM) },
    gDark: { value: new THREE.Vector2(...G.SHADOW_DARK_LIN) },
    gPaving: { value: lin(G.LEAN_PAVING) },
    gLean: { value: G.LEAN_STRENGTH },
  };
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  U.gMask.value = blank;
  function patch(shader) {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGroundXZ;
        uniform vec3 gGain, gWarm, gPaving; uniform float gSat, gSatNear, gLift, gLean; uniform vec2 gDark;
        uniform sampler2D gMask; uniform vec4 gMaskBox;`)
      .replace('#include <map_fragment>', `
        vec3 aer = texture2D(map, vMapUv).rgb;                    // linear (the tiles are sRGB textures)
        vec2 muv = (vGroundXZ - gMaskBox.xy) * gMaskBox.zw;
        vec2 mk = (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) ? texture2D(gMask, muv).rg : vec2(0.0);
        float lum = dot(aer, vec3(0.2126, 0.7152, 0.0722));
        float sh = mk.r * (1.0 - smoothstep(gDark.x, gDark.y, lum));
        aer *= mix(vec3(1.0), gWarm * gLift, sh);
        lum = dot(aer, vec3(0.2126, 0.7152, 0.0722));
        // close up a photograph pixel covers many screen pixels and its JPEG colour fringes show: take most colour out there
        float tpp = length(fwidth(vMapUv * 256.0));                // photograph pixels per screen pixel
        aer = mix(vec3(lum), aer, mix(gSatNear, gSat, smoothstep(0.12, 0.6, tpp))) * gGain;
        aer = mix(aer, gPaving, mk.g * gLean);
        diffuseColor.rgb *= aer;`);
  }

  // ── tile maths ───────────────────────────────────────────────────────
  const lonOf = (x, z) => (x / 2 ** z) * 360 - 180;
  const latOf = (y, z) => { const n = Math.PI * (1 - (2 * y) / 2 ** z); return (180 / Math.PI) * Math.atan(Math.sinh(n)); };
  function nodeOf(z, x, y) {
    const key = z + '/' + x + '/' + y;
    let n = state.nodes.get(key);
    if (n) return n;
    const [x0, z0] = toLocal(lonOf(x, z), latOf(y, z));
    const [x1, z1] = toLocal(lonOf(x + 1, z), latOf(y + 1, z));
    n = { key, z, x, y, x0, x1, z0, z1, w: x1 - x0, state: 'none', mesh: null, used: 0, d: 0 };
    state.nodes.set(key, n);
    return n;
  }
  const baked = (z, x, y) => { const r = state.index.levels[z]; return r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; };
  // The live tiles. The City's CDN (Imperva) caches a tile WITHOUT its CORS header, so a tile someone else asked for recently cannot
  // be used by a browser (measured 2026-10-18: "0CNN" cached answers have no Access-Control-Allow-Origin, origin answers do). Two ways
  // round it: on the Vercel site, a same-origin rewrite in vercel.json (/v2/aerial-live/z/y/x, no CORS at all); anywhere else, or if
  // that rewrite answers nothing, the City's URL with a query that is new for every page load, which always reaches the origin.
  const TOKEN = Math.random().toString(36).slice(2, 10);
  let proxy = /vercel\.app$/.test(location.hostname) && params.get('aerialproxy') !== '0';
  const liveUrl = (n) => (proxy ? new URL(`../../aerial-live/${n.z}/${n.y}/${n.x}`, DATA).href
    : state.index.live.replace('{z}', n.z).replace('{y}', n.y).replace('{x}', n.x) + '?v2=' + TOKEN + (++asks).toString(36));   // new for every ask: a second ask of the same URL would get the cached, header-less copy
  let asks = 0;
  const urlOf = (n) => (baked(n.z, n.x, n.y) ? `${DATA}${n.z}/${n.y}/${n.x}.jpg` : liveUrl(n));
  const nextLevel = (z) => state.levels.find((l) => l > z) ?? null;
  const prevLevel = (z) => [...state.levels].reverse().find((l) => l < z) ?? null;
  function children(n) {
    const c = nextLevel(n.z);
    if (c == null || c > MAXZ) return null;
    const k = 2 ** (c - n.z), out = [];
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) out.push(nodeOf(c, n.x * k + i, n.y * k + j));
    return out;
  }
  function parentOf(n) {
    const p = prevLevel(n.z);
    if (p == null) return null;
    const k = 2 ** (n.z - p);
    return nodeOf(p, Math.floor(n.x / k), Math.floor(n.y / k));
  }

  // ── loading ──────────────────────────────────────────────────────────
  async function decode(url) {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = r.headers.get('content-type') || '';
    if (!/image\//.test(ct)) throw new Error('not an image: ' + ct);
    const blob = await r.blob();
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode(); return img;
  }
  function pump() {
    const now = performance.now();
    state.queue.sort((a, b) => a.d - b.d || a.z - b.z);
    let i = 0;
    while (i < state.queue.length) {
      const n = state.queue[i];
      const live = !baked(n.z, n.x, n.y);
      if (live && (LIVE_OFF || now < state.livePausedUntil)) { n.state = 'fail-soft'; n.failAt = now; state.queue.splice(i, 1); continue; }
      if (live ? state.liveLoading >= G.LIVE_CONCURRENCY : state.localLoading >= G.LOCAL_CONCURRENCY) { i++; continue; }
      state.queue.splice(i, 1);
      n.state = 'loading';
      live ? state.liveLoading++ : state.localLoading++;
      decode(urlOf(n)).then((img) => {
        live ? state.liveOk++ : state.localOk++;
        if (live) state.failRun = 0;
        state.ready.push([n, img]);
      }, () => {
        n.state = live ? 'fail-soft' : 'fail'; n.failAt = performance.now();
        if (live && (n.tries = (n.tries || 0) + 1) < 3) { state.liveFail++; n.state = 'none'; return; }   // ask again soon, with a new URL
        if (live && proxy && state.liveOk === 0 && state.liveFail >= 2) { proxy = false; state.liveFail++; n.state = 'none'; return; }   // no rewrite here
        if (live) { state.liveFail++; if (++state.failRun >= G.LIVE_FAILS_TO_PAUSE) { state.livePausedUntil = performance.now() + G.LIVE_PAUSE_MS; state.failRun = 0; } }
        else state.localFail++;
      }).finally(() => { live ? state.liveLoading-- : state.localLoading--; state.lastKey = ''; redraw(); });
    }
  }
  function upload(n, img) {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = ANISO;
    t.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 1, metalness: 0, depthWrite: false });
    m.onBeforeCompile = patch;
    m.customProgramCacheKey = () => 'v2-aerial-1';
    const mesh = new THREE.Mesh(quad, m);
    mesh.position.set(n.x0, 0, n.z0);
    mesh.scale.set(n.x1 - n.x0, 1, n.z1 - n.z0);
    mesh.renderOrder = 0.5 + n.z * 0.01;     // above the plain ground (0), finer levels over coarser, under the roads (1)
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.visible = false;
    mesh.name = 'aerial ' + n.key;
    group.add(mesh);
    n.mesh = mesh; n.img = img; n.state = 'ready';
  }
  function evict() {
    const ready = [...state.nodes.values()].filter((n) => n.state === 'ready' && !state.shown.has(n) && n.z !== state.levels[0]);
    const over = ready.length + state.shown.size - CACHE;
    if (over <= 0) return;
    ready.sort((a, b) => a.used - b.used);
    for (const n of ready.slice(0, over)) {
      group.remove(n.mesh); n.mesh.material.map.dispose(); n.mesh.material.dispose();
      if (n.img && n.img.close) n.img.close();
      n.mesh = null; n.img = null; n.state = 'none';
    }
  }

  // ── choosing the tiles: split while a texel is bigger than LOD screen pixels at the tile's nearest point ──
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), box = new THREE.Box3();
  function select() {
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm, THREE.WebGLCoordinateSystem, camera.reversedDepth);
    const H = renderer.domElement.height || 1;
    const pixAngle = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / H;
    const c = camera.position;
    let lod = LOD, out;
    for (let tries = 0; tries < 4; tries++) {
      out = [];
      const stack = [...state.roots];
      while (stack.length) {
        const n = stack.pop();
        box.min.set(n.x0, -1, n.z0); box.max.set(n.x1, 2, n.z1);
        if (!frustum.intersectsBox(box)) continue;
        const dx = Math.max(n.x0 - c.x, 0, c.x - n.x1), dz = Math.max(n.z0 - c.z, 0, c.z - n.z1);
        n.d = Math.hypot(dx, c.y, dz);
        const texel = n.w / 256;
        const kids = texel > lod * n.d * pixAngle ? children(n) : null;
        if (kids) stack.push(...kids); else out.push(n);
      }
      if (out.length <= G.MAX_TILES) break;
      lod *= 1.5;
    }
    state.selected = out;
  }
  function show() {
    const want = new Set(), keep = new Set();
    const now = performance.now();
    for (const n of state.selected) {
      if (n.state === 'fail-soft' && !LIVE_OFF && now - n.failAt > G.LIVE_PAUSE_MS) n.state = 'none';   // the City's server gets another try
      if (n.state === 'none') { n.state = 'queued'; state.queue.push(n); }
      // draw it if it is in; otherwise its nearest ancestor that is (finer levels draw over coarser ones)
      let a = n;
      while (a && a.state !== 'ready') {
        // a baked ancestor (z16, z15) is asked for too: it covers the wait for the live tiles, and it is the picture when the City's
        // server is down (without this the floor was the z13 root, 16 m a pixel: measured with ?aeriallive=0, 2026-10-18)
        if (a !== n && baked(a.z, a.x, a.y) && (a.state === 'none' || a.state === 'queued')) {
          if (a.state === 'none') { a.state = 'queued'; state.queue.push(a); }
          a.d = Math.min(a.d || Infinity, n.d); keep.add(a);
        }
        a = parentOf(a);
      }
      if (a) want.add(a);
    }
    for (const n of state.shown) if (!want.has(n) && n.mesh) n.mesh.visible = false;
    const t = performance.now();
    for (const n of want) { n.mesh.visible = true; n.used = t; }
    state.shown = want;
    // queued tiles no longer wanted are dropped from the queue (they are asked for again when they are)
    const sel = new Set(state.selected);
    const root0 = state.levels[0];
    state.queue = state.queue.filter((n) => { if (sel.has(n) || keep.has(n) || n.z === root0) return true; n.state = 'none'; return false; });
  }

  // ── per frame: scene.onBeforeRender runs at the start of every render of the city, after the camera's matrices are updated and
  //    before three.js builds its draw list, so main.js needs no per-frame hook and what update() shows is drawn in the same frame ──
  const group = new THREE.Group(); group.name = 'aerial ground';
  scene.add(group);
  const prevHook = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, cam, target) { prevHook.call(this, r, s, cam, target); if (cam === camera && !target) update(); };

  function update() {
    if (!state.index) return;
    state.frame++;
    let up = 0;
    while (state.ready.length && up < G.UPLOADS_PER_FRAME) { const [n, img] = state.ready.shift(); if (n.state === 'loading') { upload(n, img); up++; } else if (img.close) img.close(); }
    const e = camera.matrixWorld.elements, key = e.map((v) => v.toFixed(2)).join(',') + '|' + renderer.domElement.height;
    if (up || key !== state.lastKey) { state.lastKey = key; select(); show(); }
    pump();
    if (!state.baseReady && state.roots.length && state.roots.every((n) => n.state === 'ready' || n.state === 'fail')) {
      state.baseReady = state.roots.some((n) => n.state === 'ready');
      if (state.baseReady && G.HIDE_RIBBONS) hideRibbons = true;
    }
    if (hideRibbons) for (const m of [...city.roads, ...city.sidewalks]) m.visible = false;
    if (up) evict();
    if (state.ready.length) redraw();      // more uploads wait: draw again next frame
  }
  let hideRibbons = false;

  // ── start: the index of baked levels, the mask, the root tiles ───────
  (async () => {
    try {
      const r = await fetch(DATA + 'index.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state.index = await r.json();
    } catch (e) {
      state.failed = true;
      console.warn('[v2 ground] no aerial index, the plain ground stays:', e.message);
      return;
    }
    const baked = Object.keys(state.index.levels).map(Number);
    state.levels = [...new Set([...baked, 17, 18, 19, 20])].filter((z) => z <= MAXZ).sort((a, b) => a - b);
    const r0 = state.index.levels[state.levels[0]];
    for (let y = r0.y0; y <= r0.y1; y++) for (let x = r0.x0; x <= r0.x1; x++) state.roots.push(nodeOf(state.levels[0], x, y));
    // the roots load first and are never evicted: they are the floor under everything
    for (const n of state.roots) { n.state = 'queued'; n.d = 0; state.queue.push(n); }
    loadMask();
    redraw();
  })();
  async function loadMask() {
    try {
      const m = state.index.mask;           // { file, x0, z0, x1, z1 } in v2 metres (scripts/v2/street_mask.py)
      if (!m) return;
      const tex = await new THREE.TextureLoader().loadAsync(DATA + m.file);
      tex.colorSpace = THREE.NoColorSpace; tex.flipY = false;
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
      U.gMask.value = tex;
      U.gMaskBox.value.set(m.x0, m.z0, 1 / (m.x1 - m.x0), 1 / (m.z1 - m.z0));
      redraw();
    } catch (e) { console.info('[v2 ground] no shadow mask:', e.message); }
  }

  const api = {
    stats: () => ({
      index: !!state.index, failed: state.failed, baseReady: state.baseReady, levels: state.levels,
      selected: state.selected.length, shown: state.shown.size, queued: state.queue.length,
      loading: state.liveLoading + state.localLoading, waitingUpload: state.ready.length,
      missing: state.selected.filter((n) => n.state !== 'ready' && n.state !== 'fail' && n.state !== 'fail-soft').length,
      byZoom: state.selected.reduce((o, n) => ((o[n.z] = (o[n.z] || 0) + 1), o), {}),
      liveOk: state.liveOk, liveFail: state.liveFail, localOk: state.localOk, localFail: state.localFail,
      livePaused: performance.now() < state.livePausedUntil, lod: LOD, maxZoom: MAXZ, anisotropy: ANISO,
      gpuTiles: [...state.nodes.values()].filter((n) => n.state === 'ready').length,
    }),
    uniforms: U,
    // what is drawn, nearest first: [key, state, distance m] (for the verify scripts)
    shownList: () => [...state.shown].sort((a, b) => a.d - b.d).map((n) => [n.key, n.state, +n.d.toFixed(1)]),
    selectedList: () => [...state.selected].sort((a, b) => a.d - b.d).map((n) => [n.key, n.state, +n.d.toFixed(1)]),
  };
  window.__v2ground = api;
  return api;
}

// ── credits: a corner link on the map (OSM's guideline: "in a corner of the map"), the long text on credits.html ──
// index.html carries the credits line (#credits); this only adds one if a page has none.
function addCredits() {
  if (document.getElementById('v2-credits') || document.getElementById('credits')) return;
  const css = document.createElement('style');
  css.textContent = `
    #v2-credits { position: fixed; right: 0; bottom: 0; z-index: 5; font: 11px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #2a323c; background: rgba(255,255,255,0.72); padding: 2px 6px; border-top-left-radius: 6px; }
    #v2-credits a { color: inherit; text-decoration: none; }
    #v2-credits a:hover { text-decoration: underline; }
    @media (max-width: 600px) { #v2-credits { right: auto; left: 0; bottom: auto; top: env(safe-area-inset-top); border-radius: 0 0 6px 0; } }
    @media (prefers-color-scheme: dark) { #v2-credits { color: #e6ebf0; background: rgba(22,28,36,0.7); } }`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.id = 'v2-credits';
  el.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · '
    + '<a href="./credits.html">City of Austin</a> · <a href="./credits.html">Credits</a>';
  document.body.appendChild(el);
}
