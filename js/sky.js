/**
 * sky.js — the sun, and everything in the sky above Austin
 *
 * Two jobs.
 *
 * 1. ONE SUN. Before this file there were two: shadows.js walked its own arc
 *    (az 150→245) while setLight used another (az 205→252), 55° apart at p=0.
 *    Shadows pointed one way and the shading came from somewhere else, which is
 *    the kind of incoherence you feel without being able to name. `skyBodies(p)`
 *    is now the single source of truth for shadow direction, MapLibre's light,
 *    and the visible disc.
 *
 * 2. THE SKY ITSELF. map.setSky() gives a two-stop gradient and nothing else —
 *    no sun, no clouds, no stars. Those are drawn here as DOM/canvas overlays
 *    composited with `mix-blend-mode: screen`.
 *
 *    Screen blending is the whole trick: it can only ADD light, so a 97 m tower
 *    crossing the horizon line is never hidden by the sky drawn "behind" it — it
 *    just picks up a little bloom, which is what a bright sky actually does to a
 *    silhouette. (The alternative, a custom WebGL layer, was tried: it does own
 *    the sky, but inserted at the bottom of the style it also painted over the
 *    ground plane. Verified by rendering it solid magenta — the roads went
 *    magenta too.)
 *
 * GEOMETRY NOTE, because it drove the whole design: MapLibre pitch is measured
 * from straight down, so the view axis sits at (pitch - 90)° relative to
 * horizontal and the top of the frame is at (pitch - 90 + fov/2)°. At the spawn
 * pitch of 64 with a 58° FOV that is +3° — you can see three degrees of sky.
 * A sun disc is therefore invisible at the default view no matter where it is,
 * so the horizon glow and the low cloud band are what carry the default frame;
 * the disc is what you get for pitching up, or for golden hour.
 *
 * Public (window) API:
 *   skyBodies(p)        — { sun:{az,elev}, moon:{az,elev}, sunUp, night }
 *   initSky(map)        — create the overlay elements
 *   updateSky(map, p)   — reposition/retint everything
 */
(function () {
  'use strict';

  const PI = Math.PI;
  const rad = d => d * PI / 180;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clamp01 = v => clamp(v, 0, 1);

  // ── The sun's arc ─────────────────────────────────────────────────
  // Morning in the east → noon in the south → golden hour low in the WSW →
  // below the horizon. Shadows swing right across the city as you drag the
  // slider, which is most of why the time-of-day control feels physical.
  const SUN_KEYS = [
    { p: 0.00, az: 98,  elev: 54 },
    { p: 0.25, az: 150, elev: 64 },
    { p: 0.42, az: 232, elev: 30 },
    { p: 0.50, az: 256, elev: 6  },
    { p: 0.60, az: 268, elev: -4 },
    { p: 1.00, az: 305, elev: -40 },
  ];
  // The moon takes over once the sun is down, rising in the east. It peaks at
  // 24° rather than overhead on purpose: at a flying pitch of 64-82 the visible
  // sky runs from the horizon to only ~+21°, so a moon high in the dome is a
  // moon nobody ever sees.
  const MOON_KEYS = [
    { p: 0.55, az: 88,  elev: -6 },
    { p: 0.72, az: 98,  elev: 10 },
    { p: 1.00, az: 118, elev: 24 },
  ];

  function track(keys, p) {
    p = clamp01(p);
    if (p <= keys[0].p) return { az: keys[0].az, elev: keys[0].elev };
    for (let i = 1; i < keys.length; i++) {
      if (p <= keys[i].p) {
        const a = keys[i - 1], b = keys[i];
        const t = (p - a.p) / (b.p - a.p);
        return { az: a.az + (b.az - a.az) * t, elev: a.elev + (b.elev - a.elev) * t };
      }
    }
    const last = keys[keys.length - 1];
    return { az: last.az, elev: last.elev };
  }

  window.skyBodies = function skyBodies(p) {
    const sun = track(SUN_KEYS, p);
    const moon = track(MOON_KEYS, p);
    return {
      sun, moon,
      sunUp: sun.elev > 0,
      night: clamp01((p - 0.55) / 0.35),        // 0 before dusk, 1 by full night
      golden: clamp01(1 - Math.abs(p - 0.5) / 0.22),
    };
  };

  // ── Celestial direction → screen pixels ───────────────────────────
  // ENU basis, z up. az is a compass bearing (0 = north, clockwise); elev is
  // degrees above the horizontal.
  function dirOf(az, elev) {
    const ce = Math.cos(rad(elev));
    return [Math.sin(rad(az)) * ce, Math.cos(rad(az)) * ce, Math.sin(rad(elev))];
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  function projector(map) {
    const cv = map.getCanvas();
    const W = cv.clientWidth, H = cv.clientHeight;
    const fov = map.getVerticalFieldOfView ? map.getVerticalFieldOfView() : 58;
    const bearing = map.getBearing(), pitch = map.getPitch();
    const f = dirOf(bearing, pitch - 90);                 // view axis
    const r = [Math.cos(rad(bearing)), -Math.sin(rad(bearing)), 0];
    const u = cross(r, f);
    const tv = Math.tan(rad(fov) / 2);
    const th = tv * (W / H);
    return function project(az, elev) {
      const t = dirOf(az, elev);
      const fd = dot(t, f);
      // `fd` is returned so callers can FADE as a body approaches the frustum
      // edge instead of hard-cutting at it. A hard cut on the largest element on
      // screen reads as broken software.
      if (fd <= 0.02) return { front: false, x: 0, y: 0, fd, fade: 0 };
      return {
        front: true,
        x: (0.5 + 0.5 * (dot(t, r) / fd) / th) * W,
        y: (0.5 - 0.5 * (dot(t, u) / fd) / tv) * H,
        fd, fade: clamp01((fd - 0.02) / 0.23),
        W, H,
      };
    };
  }

  /** Screen y of the true horizon, in CSS pixels. Same formula as atmosphere.js. */
  function horizonPx(map) {
    const H = map.getCanvas().clientHeight;
    const fov = map.getVerticalFieldOfView ? map.getVerticalFieldOfView() : 58;
    const off = Math.tan(rad(90 - map.getPitch())) / Math.tan(rad(fov) / 2);
    return (0.5 - 0.5 * off) * H;
  }

  /**
   * Halo colour as a function of solar elevation. A plain lerp on `elev/50`
   * freezes at its endpoint once the sun is below the horizon, so the afterglow
   * stopped reddening exactly when a real one starts. This keeps reddening all
   * the way down, and passes through the tuned golden value (255,133,56) at 6°
   * so the existing golden-hour look is preserved rather than re-guessed.
   */
  const SUN_COL = [
    { e: -20, c: [150, 46, 28] },
    { e: -4,  c: [214, 78, 34] },
    { e: 6,   c: [255, 133, 56] },
    { e: 20,  c: [255, 176, 110] },
    { e: 50,  c: [255, 232, 196] },
    { e: 75,  c: [255, 250, 242] },
  ];
  function sunColour(elev) {
    if (elev <= SUN_COL[0].e) return SUN_COL[0].c.slice();
    for (let i = 1; i < SUN_COL.length; i++) {
      if (elev <= SUN_COL[i].e) {
        const a = SUN_COL[i - 1], b = SUN_COL[i];
        return mix(a.c, b.c, (elev - a.e) / (b.e - a.e));
      }
    }
    return SUN_COL[SUN_COL.length - 1].c.slice();
  }

  // ── Overlay elements ──────────────────────────────────────────────
  let host = null, elGlow = null, elBloom = null, elCore = null, canvas = null, ctx = null;
  let stars = null, clouds = null, haloSprite = null;
  let _map = null, _p = 0.12;

  /**
   * One pre-rendered halo, blitted per bright star instead of building a fresh
   * radial gradient each time. Measured: the per-star createRadialGradient path
   * cost 1.62 ms/frame at night against 0.64 ms for day — the whole difference
   * was ~78 gradient objects per frame. drawImage of a cached sprite is a blit.
   */
  function buildHaloSprite() {
    const S = 32;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g2 = c.getContext('2d');
    const g = g2.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(210,228,255,1)');
    g.addColorStop(0.35, 'rgba(210,228,255,0.34)');
    g.addColorStop(1, 'rgba(210,228,255,0)');
    g2.fillStyle = g;
    g2.fillRect(0, 0, S, S);
    return c;
  }

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function buildStars() {
    const rnd = seeded(20260729);
    const out = [];
    // Biased LOW, not high. The first version weighted stars toward the zenith
    // "to keep the horizon clean" and the result was two visible stars: at a
    // flying pitch you only ever see the first ~20° above the horizon.
    for (let i = 0; i < 520; i++) {
      out.push({
        az: rnd() * 360,
        elev: 1.5 + Math.pow(rnd(), 1.5) * 62,
        mag: 0.3 + Math.pow(rnd(), 2.6) * 0.7,
      });
    }
    return out;
  }

  function buildClouds() {
    const rnd = seeded(77712);
    const out = [];
    // Each cloud is a cluster of lobes rather than one blurred ellipse — a
    // single soft blob reads as a smudge on the glass, several overlapping ones
    // read as a cloud.
    for (let i = 0; i < 22; i++) {
      const az = rnd() * 360;
      const elev = 2.2 + Math.pow(rnd(), 1.6) * 14;
      const span = 4 + rnd() * 9;
      const lobes = [];
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        lobes.push({
          dAz: (rnd() - 0.5) * span,
          dEl: (rnd() - 0.5) * 1.1,
          r: span * (0.30 + rnd() * 0.34),
          a: 0.5 + rnd() * 0.5,
        });
      }
      out.push({ az, elev, lobes, a: 0.45 + rnd() * 0.55, squash: 0.30 + rnd() * 0.22 });
    }
    return out;
  }

  window.initSky = function initSky(map) {
    _map = map;
    host = document.getElementById('sky');
    if (!host) return;

    canvas = document.createElement('canvas');
    canvas.id = 'sky-canvas';
    host.appendChild(canvas);
    ctx = canvas.getContext('2d');

    // Order matters for screen blending: each of these adds light over
    // everything painted below it.
    elGlow = document.createElement('div');  elGlow.id = 'sky-glow';   host.appendChild(elGlow);
    elBloom = document.createElement('div'); elBloom.id = 'sky-bloom'; host.appendChild(elBloom);
    elCore = document.createElement('div');  elCore.id = 'sky-core';   host.appendChild(elCore);

    stars = buildStars();
    clouds = buildClouds();
    haloSprite = buildHaloSprite();

    const redraw = () => updateSky(map, _p);
    map.on('move', redraw);
    map.on('resize', redraw);
    resize();
    redraw();
  };

  function resize() {
    if (!canvas || !_map) return;
    const cv = _map.getCanvas();
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    return dpr;
  }

  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  window.updateSky = function updateSky(map, p) {
    if (!host || !map) return;
    _p = p;
    const B = window.skyBodies(p);
    const dpr = resize() || 1;
    const project = projector(map);
    const cv = map.getCanvas();
    const W = cv.clientWidth, H = cv.clientHeight;

    // Which body is lighting the sky, and in what colour.
    const useMoon = !B.sunUp && B.moon.elev > -2;
    const body = useMoon ? B.moon : B.sun;
    const coreCol = useMoon ? [226, 234, 255] : sunColour(Math.max(B.sun.elev, 2));
    const haloCol = useMoon ? [150, 172, 226] : sunColour(B.sun.elev);
    const moonHalo = [150, 172, 226];

    // Twilight runs on TWO INDEPENDENT SCHEDULES, both always drawn.
    // The old single-body switch (`useMoon`) flipped in one frame at p=0.5925,
    // teleporting the horizon glow 176.6 deg from the western to the eastern
    // horizon and dropping its alpha 0.459 -> 0.168 — measured, and the most
    // watched moment of the 32 s auto cycle. The sun's afterglow now decays over
    // its own elevation while the moon's glow rises over its own, so they
    // cross over smoothly around p=0.685 with warm west and cool east on screen
    // at the same time, which is what dusk actually looks like.
    const wSun = B.sun.elev >= 0 ? 1 : clamp01(1 + B.sun.elev / 20);
    const wMoon = Math.pow(clamp01((B.moon.elev + 3) / 9), 1.2);

    // Fade the disc out as it approaches and crosses the horizon rather than
    // letting it pop.
    const vis = useMoon ? clamp01((B.moon.elev + 2) / 6) : clamp01((B.sun.elev + 1) / 5);

    const pos = project(body.az, Math.max(body.elev, -1.5));
    const showDisc = pos.front && vis > 0.01;
    const discFade = pos.fade;

    // Core disc — small and bright.
    const coreR = useMoon ? 15 : 20;
    place(elCore, pos, coreR * 2, showDisc ? vis * discFade : 0,
      `radial-gradient(circle, ${rgba(coreCol, 1)} 0%, ${rgba(coreCol, 0.92)} 42%, ${rgba(coreCol, 0)} 72%)`);

    // Bloom — wide, soft, the part that actually reads.
    const bloomR = useMoon ? 130 : (170 + 190 * B.golden);
    const bloomA = (useMoon ? 0.30 : 0.26 + 0.22 * B.golden) * vis * discFade;
    place(elBloom, pos, bloomR * 2, showDisc ? bloomA : 0,
      `radial-gradient(circle, ${rgba(haloCol, 0.95)} 0%, ${rgba(haloCol, 0.34)} 26%, ${rgba(haloCol, 0)} 68%)`);

    // The horizon glow now lives in the canvas rather than a fourth
    // screen-blended DOM layer, so all of it composites in one pass.
    place(elGlow, { x: 0, y: 0 }, 1, 0, 'none');

    // ── Canvas pass ──
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    const S = Math.max(W, H);
    const hzPx = horizonPx(map);

    // CLIP EVERYTHING IN THE SKY PASS TO THE SKY. The horizon washes are
    // ellipses centred on the horizon line, so without this half of each one
    // lands on the city: at dusk an 825x561 px lobe of deep red at 0.31 alpha
    // screen-blended the entire frame magenta, ground included. Light on the
    // buildings is setLight's job and the baked golden palette's job; the sky's
    // job stops at the horizon. A small margin keeps the boundary soft.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, Math.max(0, hzPx + 0.018 * H));
    ctx.clip();

    /** One elliptical glow lobe, additively composited. */
    function drawGlow(pos, rx, ry, alpha, col, stops) {
      if (!pos.front || !(alpha > 0.004) || rx < 2 || ry < 1) return;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.scale(1, ry / rx);
      // Gradient built AFTER the transform, centred on the origin — see the
      // note in the cloud pass; building it before lands it off the shape.
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      for (const [t, m] of stops) g.addColorStop(t, rgba(col, alpha * m));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // City skyglow floor: an omnidirectional warm lift at the horizon. Drawn
    // first so stars and clouds sit on top of it. This is what stops the night
    // sky being a flat near-black bar, and (being additive) it washes out the
    // faintest low stars exactly as real skyglow does.
    if (B.night > 0.02) {
      const band = 7.5 * (H / (map.getVerticalFieldOfView ? map.getVerticalFieldOfView() : 58));
      const y0 = hzPx - band, y1 = hzPx + 0.012 * H;
      if (y1 > 0 && y0 < H) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0.00, `rgba(150,160,196,0)`);
        g.addColorStop(0.45, `rgba(150,160,196,${(0.014 * B.night).toFixed(4)})`);
        g.addColorStop(0.78, `rgba(228,164,110,${(0.032 * B.night).toFixed(4)})`);
        g.addColorStop(1.00, `rgba(255,176,96,${(0.052 * B.night).toFixed(4)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, y0, W, y1 - y0);
      }
    }

    // Wide washes — one per body, anchored to its AZIMUTH at the horizon, so
    // the sky brightens in the right direction even when the disc is off-screen.
    const hzSun = project(B.sun.az, 0.5);
    const hzMoon = project(B.moon.az, 0.5);
    const kWide = 1.5 + 0.7 * B.golden;
    const WIDE = [[0, 0.9], [0.34, 0.28], [0.70, 0]];
    const glowASun = (0.26 + 0.40 * B.golden) * wSun * hzSun.fade;
    const glowAMoon = 0.17 * wMoon * hzMoon.fade;
    drawGlow(hzSun,  0.5 * S * kWide, 0.15 * S * kWide, glowASun,  haloCol,  WIDE);
    drawGlow(hzMoon, 0.5 * S * 1.5,   0.15 * S * 1.5,   glowAMoon, moonHalo, WIDE);

    // Tight hot-spot at the same anchor. The wide wash alone is structurally
    // incapable of reading at the default pitch: at ~2600 px across, its
    // gradient parameter never exceeds ~0.07 over the 48 px of visible sky, so
    // it is a flat tint with no falloff anywhere in frame. This lobe is sized so
    // a real falloff lands inside that band — the difference between "the sky is
    // orange" and "the sun is setting over there".
    const HOT = [[0, 1], [0.30, 0.45], [0.62, 0.12], [1, 0]];
    const hotASun = Math.min(0.60, (0.26 + 0.30 * B.golden) * wSun * hzSun.fade);
    const hotAMoon = Math.min(0.60, 0.13 * wMoon * hzMoon.fade);
    drawGlow(hzSun, 0.16 * S, 0.042 * S, hotASun, haloCol, HOT);
    drawGlow(hzMoon, 0.16 * S, 0.042 * S, hotAMoon, moonHalo, HOT);

    if (B.night > 0.02) {
      for (const s of stars) {
        const q = project(s.az, s.elev);
        if (!q.front || q.x < -8 || q.x > W + 8 || q.y < -8 || q.y > H) continue;
        const a = B.night * s.mag;
        const r = 0.55 + s.mag * 1.25;
        ctx.fillStyle = `rgba(238,244,255,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, PI * 2);
        ctx.fill();
        // The brightest handful get a small halo so the field has hierarchy
        // instead of reading as uniform noise. Blitted from a cached sprite.
        if (s.mag > 0.82 && haloSprite) {
          const d = r * 10;
          ctx.globalAlpha = a * 0.5;
          ctx.drawImage(haloSprite, q.x - d / 2, q.y - d / 2, d, d);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Clouds: lit from the side the body is on, so they warm up at golden hour.
    const cloudA = (0.26 + 0.50 * B.golden) * (1 - B.night * 0.88);
    if (cloudA > 0.02) {
      const lit = mix([255, 255, 255], haloCol, 0.35 + 0.45 * B.golden);
      const degPx = (() => {                    // pixels per degree, near centre
        const a = project(map.getBearing(), 0), b2 = project(map.getBearing() + 1, 0);
        return (a.front && b2.front) ? Math.max(2, Math.abs(b2.x - a.x)) : 12;
      })();
      for (const c of clouds) {
        const q = project(c.az, c.elev);
        if (!q.front || q.x < -W || q.x > W * 2) continue;
        const a0 = cloudA * c.a;
        for (const lb of c.lobes) {
          const lq = project(c.az + lb.dAz, c.elev + lb.dEl);
          if (!lq.front) continue;
          const r = lb.r * degPx;
          if (r < 3 || r > W * 1.5) continue;
          const a = a0 * lb.a;
          ctx.save();
          ctx.translate(lq.x, lq.y);
          ctx.scale(1, c.squash);
          // Build the gradient AFTER the transform, centred on the origin —
          // a gradient created in untransformed space then translated/scaled
          // lands nowhere near the shape it is meant to fill.
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
          g.addColorStop(0, rgba(lit, a));
          g.addColorStop(0.55, rgba(lit, a * 0.42));
          g.addColorStop(1, rgba(lit, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
    ctx.restore();                       // end sky clip
    ctx.globalCompositeOperation = 'source-over';
  };

  function place(el, pos, sizePx, alpha, background) {
    if (!el) return;
    if (!(alpha > 0.005)) { el.style.opacity = '0'; return; }
    el.style.opacity = String(alpha);
    el.style.width = sizePx + 'px';
    el.style.height = sizePx + 'px';
    el.style.background = background;
    el.style.transform = `translate(${(pos.x - sizePx / 2).toFixed(1)}px, ${(pos.y - sizePx / 2).toFixed(1)}px)`;
  }
})();
