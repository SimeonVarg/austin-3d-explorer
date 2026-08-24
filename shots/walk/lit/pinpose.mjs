/**
 * pinpose.mjs — the colour that had never been in a matrix, and the pose that
 * had never been used.
 *
 * ROUND 6. TWO GAPS, AND THEY ARE THE SAME MEASUREMENT.
 *
 * 1. THE VIOLET COLUMN HAS NEVER BEEN AUDITED. The card's strip has three
 *    colours. Round 3 audited COOL at 43 sites, round 4 the 25-60 m band at 18,
 *    round 5 finally audited AMBER at 12 and called it "the column that had
 *    never been sampled". The third colour — a violet tick where a resident
 *    reported the spot too dark — has been checked at exactly TWO of 182 pins,
 *    in round 2, both picked by hand as the extremes. A violet tick standing in
 *    a burning pool of lamplight is this feature being visibly wrong in the one
 *    direction it has spent five rounds refusing to be wrong in, and nobody had
 *    counted how often that happens.
 *
 * 2. EVERY MATRIX IN THIS DOCUMENT WAS SHOT FROM DIRECTLY OVERHEAD.
 *    `litaudit.mjs`, `boundary.mjs` and `stretchscene.mjs` all pose at
 *    `pitch: 0` — a plan view, in which nothing can stand in front of anything.
 *    This is a walking app. Round 5 already found that pose changes the answer
 *    (straight down, a live oak hides the receipt ring completely) and then
 *    measured the whole matrix from straight down anyway.
 *
 * ── THE EYE POSE, AND WHY IT IS NOT `jumpTo({pitch: 78})` ──────────────────
 *
 * The first cut of this script posed `jumpTo({center: site, pitch: 78})` and
 * reported that half the counted amber lamps vanish at walking pose. That
 * number was false and the frame said so in one look: at pitch 78 the CENTRE is
 * the point the camera is AIMED at and the camera itself is ~40 m behind it at
 * ground level — which at site `lit 03` put the eye inside a live oak, filling
 * the frame with leaves. A buried camera reporting "the lamp is gone" is the
 * exact defect the house rule about proving the subject is on screen exists for.
 *
 * So the eye is PLACED, not implied. `transform.getCameraLngLat()` (MapLibre's
 * own value — `getFreeCameraOptions` does not exist here, js/entrances.js §751)
 * says where the eye actually is; the centre is solved so that value lands ON
 * the site, and the zoom is solved so `getCameraAltitude()` lands on the app's
 * own walking height, 1.7 m, the altitude `scripts/verify/walk.mjs` gates. Both
 * are asserted per site and the error in metres is in the JSON. A site whose eye
 * misses is dropped, loudly, rather than scored.
 *
 * ── AND WHY THE EYE COLUMN DOES NOT USE THE DISC ──────────────────────────
 *
 * Every previous script measured "is there a lamp here" as pool pixels inside
 * the projected disc. At a grazing pitch that test is meaningless: the far half
 * of a 35 m ground circle compresses into a few pixels, so a lamp 200 m beyond
 * it lands within a hair of the boundary and its pool spills inside. That is
 * how the first cut of this script scored 522 "lamp" pixels inside the disc of
 * a pin whose nearest mapped lamp is 209.8 m away — confirmed by reading
 * data/props.geojson directly, where the nearest warm prop to that pin is
 * 209.8 m, and by re-shooting the pose, where the glow in frame is js/night.js
 * decoration and the masked diff correctly scores it zero.
 *
 * So: the PLAN column keeps the disc test, unchanged and comparable with rounds
 * 3-5. The EYE column asks the two questions a pitched frame can honestly
 * answer — is a surveyed lamp RENDERED in this view at all (queryRenderedFeatures,
 * with the true ground distance to the nearest one computed in node), and is the
 * site's own patch of ground visible or occluded.
 *
 * ── THE NULL CONTROL, WHICH THIS LANE HAD NEVER RUN ───────────────────────
 *
 * Every "lamp pixel" number in five rounds came from diffing two frames taken a
 * moment apart with the lamp layers repainted between them. Nobody had ever
 * taken the two frames with NOTHING repainted and run the same classifier. Every
 * site here does, at both poses, and `nullGreen` is in the JSON beside the real
 * number. A masked diff with a noise floor would have been reporting canopy as
 * lamplight for five rounds.
 *
 * ── THE DECORATION, COUNTED ───────────────────────────────────────────────
 *
 * §22 added one line to the card because the audit found js/night.js paints
 * road glow with no surveyed pole under it. That line lives behind the fold.
 * This script counts it: warm pixels inside the disc in the untouched frame that
 * the props-lit diff does NOT account for are decoration, and they are counted
 * per site so the question "how often does a person who flies down see light the
 * card did not count" has a number rather than an anecdote.
 *
 * Frames go to VERIFY_FRAMES (default: this directory) — CLAUDE.md rule 12.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/pinpose.mjs [pairs] [perKind]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const FRAMES = process.env.VERIFY_FRAMES || OUT;
fs.mkdirSync(FRAMES, { recursive: true });

const NIGHT = 0.92;
const W = 960, H = 600;
const WANT_PAIRS = Number(process.argv[2] || 70);
const PER_KIND = Number(process.argv[3] || 10);
const LAMP_GREEN_MIN = 200;   // the bar rounds 3, 4 and 5 all used
const DEDUPE_M = 40;
const SITES_PER_ROUTE = 2;

// THE TWO POSES.
const PLAN = { name: 'plan', pitch: 0, zoom: 19.8 };
// `js/app.js` raises maxPitch to 88; `scripts/verify/walk.mjs` gates the app's
// walking height at 1.70 m. At pitch 84 an eye 1.7 m up looks 16 m along the
// pavement, which is the near half of the 25 m the claim is about.
const EYE = { name: 'eye', pitch: 84, altM: 1.70, zoom0: 21.5 };
const EYE_ERR_MAX_M = 2.0;    // a solved eye further than this from the site is not scored
const EYE_ALT_TOL_M = 0.25;

// ── the shipped index, decoded in node ────────────────────────────────────
const J = JSON.parse(fs.readFileSync('data/walk_lamps.json', 'utf8'));
const q = J.q || 1e-6;
const dec = (o) => {
  const xs = (o && o.x) || [], ys = (o && o.y) || [];
  const X = [], Y = []; let ax = 0, ay = 0;
  for (let i = 0; i < xs.length; i++) { ax += xs[i]; ay += ys[i]; X.push(ax * q); Y.push(ay * q); }
  return { X, Y, n: X.length };
};
const WARM = dec(J.warm);
const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
const apart = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);
const nearestWarm = (lon, lat) => {
  let best = Infinity;
  for (let i = 0; i < WARM.n; i++) {
    const dx = (WARM.X[i] - lon) * MPD_LON, dy = (WARM.Y[i] - lat) * MPD_LAT;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
};
console.log(`index: ${WARM.n} warm street lamps decoded from data/walk_lamps.json`);

const CODES = Object.keys(JSON.parse(fs.readFileSync('data/walk_graph.json', 'utf8')).code);
let seed = 20260824;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// A run of 24 sites at two poses takes ~25 minutes on this machine and the
// JSON is only written at the end, so the watchdog is set well clear of it:
// a run killed at 45 minutes loses every measurement it took.
const browser = await launch(chromium, { gl: 'hardware', maxMs: 5400000 });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });

// ── seed real routes and take the sites off them ──────────────────────────
const pinSites = [], litSites = [], coolSites = [];
const routesSeen = [];
const tried = new Set();
for (let a = 0; a < WANT_PAIRS * 10 && routesSeen.length < WANT_PAIRS; a++) {
  const f = CODES[Math.floor(rnd() * CODES.length)], t = CODES[Math.floor(rnd() * CODES.length)];
  if (f === t || tried.has(f + '>' + t)) continue;
  tried.add(f + '>' + t);
  const r = await page.evaluate(async ([from, to]) => {
    const res = await window.wayfindRoute(from, to, {});
    if (!res.ok) return null;
    const lit = await window.wayfindLit();
    if (!lit.ok) return null;
    return {
      totalM: lit.totalM, lamps: lit.lamps, inDarkArea: lit.inDarkArea,
      reportedAt: lit.reportedAt, reportedAtM: lit.reportedAtM,
      runsAt: lit.runsAt, darkNearM: lit.darkNearM, radiusM: lit.radiusM,
    };
  }, [f, t]);
  if (!r) continue;
  routesSeen.push({ from: f, to: t, ...r });
}
console.log(`routed: ${routesSeen.length} pairs (of ${tried.size} tried)`);
const withPins = routesSeen.filter(r => r.inDarkArea && r.reportedAt.length);
console.log(`  ...entering the surveyed area with at least one pin on them: ${withPins.length}`);
const RADIUS_M = routesSeen[0] ? routesSeen[0].radiusM : 25;
const DARK_NEAR_M = routesSeen[0] ? routesSeen[0].darkNearM : 35;

/** Heading a walker faces here, so a pitched camera looks ALONG the pavement
 *  rather than across it. A pitched frame is a direction as much as a place. */
function headingAt(route, ll) {
  let best = Infinity, bearing = 0;
  for (const run of route.runsAt) {
    for (let i = 0; i < run.line.length - 1; i++) {
      const p = run.line[i], n = run.line[i + 1];
      const d = apart(p, ll);
      if (d < best) {
        best = d;
        bearing = (Math.atan2((n[0] - p[0]) * MPD_LON, (n[1] - p[1]) * MPD_LAT) * 180 / Math.PI + 360) % 360;
      }
    }
  }
  return bearing;
}
function take(pool, site) {
  if (pool.filter(s => s.key === site.key).length >= SITES_PER_ROUTE) return;
  if (pool.some(o => apart(o.ll, site.ll) < DEDUPE_M)) return;
  pool.push(site);
}
for (const R of routesSeen) {
  const key = R.from + '>' + R.to;
  if (R.inDarkArea) {
    R.reportedAt.forEach((p, i) => take(pinSites, {
      kind: 'pin', from: R.from, to: R.to, key, ll: p.at, note: p.note || '',
      atM: R.reportedAtM[i], d: +nearestWarm(p.at[0], p.at[1]).toFixed(1), bearing: headingAt(R, p.at),
    }));
  }
  for (const run of R.runsAt) {
    const mid = run.line[Math.floor(run.line.length / 2)];
    if (!mid) continue;
    take(run.lit ? litSites : coolSites, {
      kind: run.lit ? 'lit' : 'cool', from: R.from, to: R.to, key, ll: mid, note: '',
      d: +nearestWarm(mid[0], mid[1]).toFixed(1), bearing: headingAt(R, mid),
    });
  }
}
const pick = (pool, n) => {
  const out = [], seenRoute = new Set();
  for (const pass of [0, 1]) for (const s of pool) {
    if (out.length >= n) break;
    if (pass === 0 && seenRoute.has(s.key)) continue;
    seenRoute.add(s.key); out.push(s);
  }
  return out;
};
let SITES = [
  ...pick(pinSites, PER_KIND).map((s, i) => ({ ...s, i })),
  ...pick(litSites, PER_KIND).map((s, i) => ({ ...s, i })),
  ...pick(coolSites, PER_KIND).map((s, i) => ({ ...s, i })),
];
// ONLY=pin:1,lit:3 re-shoots named sites without re-walking the sample — the
// seed is fixed, so `pin 1` is the same pavement it was on the full run.
if (process.env.ONLY) {
  const want = new Set(process.env.ONLY.split(',').map(s => s.trim()));
  SITES = SITES.filter(s => want.has(s.kind + ':' + s.i));
  console.log(`ONLY=${process.env.ONLY} -> ${SITES.length} site(s)`);
}
console.log(`sites: ${SITES.filter(s => s.kind === 'pin').length} PIN (violet, ${DARK_NEAR_M} m) · ` +
  `${SITES.filter(s => s.kind === 'lit').length} LIT (amber, ${RADIUS_M} m) · ` +
  `${SITES.filter(s => s.kind === 'cool').length} COOL (${RADIUS_M} m)`);
if (!process.env.ONLY && !SITES.filter(s => s.kind === 'pin').length) {
  console.log('NO PIN SITES — nothing to measure.'); await browser.close(); process.exit(1);
}

// ── night, asserted not assumed ───────────────────────────────────────────
await page.evaluate((p) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(p); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, p, true);
}, NIGHT);
await page.waitForTimeout(1500);
const night = await page.evaluate(() => {
  const el = document.getElementById('tod-slider');
  return { slider: el ? Number(el.value) : null, nightness: window.NIGHT && window.NIGHT.value };
});
console.log('night:', JSON.stringify(night));
await page.waitForFunction(() => {
  const m = window.__map;
  return !!(m && m.getLayer('props-lit') && m.getLayer('props-lit-core'));
}, null, { timeout: 120000 });
await page.evaluate(() => { const r = document.getElementById('wf-root'); if (r) r.style.display = 'none'; });

// ── the poser ─────────────────────────────────────────────────────────────
/**
 * Solve centre and zoom so the EYE lands on the site at the wanted altitude.
 * Alternating, four passes: altitude first (it moves the eye back), then the
 * centre offset. Both read from the transform's own values, never assumed.
 */
async function poseEye(site) {
  return page.evaluate(([ll, pitch, wantAlt, z0, brg]) => {
    const m = window.__map;
    const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(ll[1] * Math.PI / 180);
    const camLL = () => {
      const t = m.transform;
      const c = t.getCameraLngLat ? t.getCameraLngLat() : null;
      return c ? [c.lng, c.lat] : null;
    };
    const camAlt = () => {
      const t = m.transform;
      return t.getCameraAltitude ? t.getCameraAltitude() : NaN;
    };
    let z = z0, centre = [ll[0], ll[1]];
    for (let k = 0; k < 5; k++) {
      m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
      const alt = camAlt();
      if (isFinite(alt) && alt > 0) z = z + Math.log2(alt / wantAlt);
      m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
      const c = camLL();
      if (!c) break;
      centre = [centre[0] + (ll[0] - c[0]), centre[1] + (ll[1] - c[1])];
    }
    m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
    const c = camLL(), alt = camAlt();
    return {
      zoom: +z.toFixed(3), centre,
      eyeErrM: c ? +Math.hypot((c[0] - ll[0]) * MPD_LON, (c[1] - ll[1]) * MPD_LAT).toFixed(2) : null,
      altM: +alt.toFixed(2),
    };
  }, [site.ll, EYE.pitch, EYE.altM, EYE.zoom0, site.bearing]);
}

let posed = null;
async function look(site, pose) {
  if (site.key !== posed) {
    await page.evaluate(async ([f, t]) => {
      await window.wayfindRoute(f, t, {});
      const r = document.getElementById('wf-root'); if (r) r.style.display = 'none';
    }, [site.from, site.to]);
    posed = site.key;
    await page.waitForTimeout(400);
  }
  let cam = null;
  if (pose.name === 'plan') {
    await page.evaluate(([ll, z, pitch, brg]) => window.__map.jumpTo({ center: ll, zoom: z, pitch, bearing: brg }),
      [site.ll, pose.zoom, pose.pitch, site.bearing]);
  } else {
    cam = await poseEye(site);
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => new Promise((r) => {
    const t = setTimeout(r, 3000);
    window.__map.once('idle', () => { clearTimeout(t); r(); });
  }));

  const rad = site.kind === 'pin' ? DARK_NEAR_M : RADIUS_M;
  const poly = await page.evaluate(([ll, r, n]) => {
    const m = window.__map, out = [];
    const dLat = r / 111320, dLon = r / (111320 * Math.cos(ll[1] * Math.PI / 180));
    for (let k = 0; k < n; k++) {
      const th = 2 * Math.PI * k / n;
      const p = m.project([ll[0] + dLon * Math.cos(th), ll[1] + dLat * Math.sin(th)]);
      out.push([p.x, p.y]);
    }
    const c = m.project(ll);
    return { poly: out, cx: c.x, cy: c.y };
  }, [site.ll, rad, 24]);

  // WHAT IS RENDERED, IN WORLD TERMS — the only lamp question a pitched frame
  // can answer honestly. Every props-lit feature anywhere in the viewport, with
  // its true ground distance to the site computed from its own coordinate.
  const seen = await page.evaluate(([ll, w, h]) => {
    const m = window.__map;
    const box = [[0, 0], [w, h]];
    const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(ll[1] * Math.PI / 180);
    const out = [];
    const feats = m.getLayer('props-lit') ? m.queryRenderedFeatures(box, { layers: ['props-lit'] }) : [];
    const seenKey = new Set();
    for (const f of feats) {
      const c = f.geometry && f.geometry.coordinates;
      if (!c) continue;
      const key = c[0].toFixed(6) + ',' + c[1].toFixed(6);
      if (seenKey.has(key)) continue;                    // §40c: a feature repeats per tile
      seenKey.add(key);
      out.push({ c: (f.properties || {}).c || 'warm', d: +Math.hypot((c[0] - ll[0]) * MPD_LON, (c[1] - ll[1]) * MPD_LAT).toFixed(1) });
    }
    const warm = out.filter(o => o.c !== 'blue').sort((a, b) => a.d - b.d);
    const p = m.project(ll);
    // Is the site's own patch of ground visible from here, or is something in
    // front of it? The topmost rendered layer at the site's screen point names
    // the answer without this script having to guess a threshold.
    let top = null, inView = p.x >= 0 && p.x < w && p.y >= 0 && p.y < h;
    if (inView) {
      const hit = m.queryRenderedFeatures([p.x, p.y]);
      top = hit.length ? hit[0].layer.id : '(nothing)';
    }
    const has = (id) => { try { return m.getLayer(id) ? m.queryRenderedFeatures([[0, 0], [w, h]], { layers: [id] }).length : -1; } catch (e) { return -1; } };
    return {
      warmVisible: warm.length, nearestVisibleWarmM: warm.length ? warm[0].d : null,
      warmVisibleWithin: warm.filter(o => o.d <= 25).length,
      topAtSite: top, siteOnScreen: inView,
      pad: has('wayfind-lit-pad'), mark: has('wayfind-dark-mark'),
      missing: ['props-lit', 'props-lit-core'].filter(id => !m.getLayer(id)),
    };
  }, [site.ll, W, H]);

  // three frames: base, base again (the NULL control), and the masked one
  const base = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await page.waitForTimeout(700);
  const base2 = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await page.evaluate(() => {
    const m = window.__map; m.__save = {};
    const paint = {
      'props-lit': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ff00'],
      'props-lit-core': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ffff'],
    };
    for (const id of Object.keys(paint)) {
      if (!m.getLayer(id)) continue;
      m.__save[id] = { color: m.getPaintProperty(id, 'circle-color'), op: m.getPaintProperty(id, 'circle-opacity') };
      m.setPaintProperty(id, 'circle-color', paint[id]);
      m.setPaintProperty(id, 'circle-opacity', 1);
    }
  });
  await page.waitForTimeout(700);
  const mask = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await page.evaluate(() => {
    const m = window.__map;
    for (const id of Object.keys(m.__save || {})) {
      m.setPaintProperty(id, 'circle-color', m.__save[id].color);
      m.setPaintProperty(id, 'circle-opacity', m.__save[id].op);
    }
    m.__save = {};
  });

  const px = await page.evaluate(async ([b64a, b64n, b64b, pts, w, h]) => {
    const load = (b) => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b; });
    const [A, N, B] = await Promise.all([load(b64a), load(b64n), load(b64b)]);
    const dat = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, im.width, im.height).data; };
    const a = dat(A), nn = dat(N), b = dat(B), Wp = A.width, Hp = A.height;
    const sx = Wp / w, sy = Hp / h;
    const P = pts.map(p => [p[0] * sx, p[1] * sy]);
    // The 24-edge crossing test over half a million pixels is most of this
    // script's wall clock, and all but a fraction of those pixels are nowhere
    // near the polygon. Bounding box first.
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of P) {
      if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0];
      if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1];
    }
    const inPoly = (x, y) => {
      if (x < bx0 || x > bx1 || y < by0 || y > by1) return false;
      let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const cls = (R, G, Bl) => {
      const mx = Math.max(R, G, Bl);
      if (mx < 12) return 0;
      const hiR = R > mx * .55, hiG = G > mx * .55, hiB = Bl > mx * .55;
      if (hiG && hiB && !hiR) return 2;   // core (cyan)
      if (hiG && !hiB && !hiR) return 1;  // pool (green)
      return 0;
    };
    let discGreen = 0, frameGreen = 0, discCore = 0, frameCore = 0, discPx = 0;
    let nullGreen = 0, nullCore = 0;
    let discWarmBase = 0, discWarmDecor = 0;
    for (let y = 0; y < Hp; y++) for (let x = 0; x < Wp; x++) {
      const i = (y * Wp + x) * 4;
      const within = inPoly(x, y);
      if (within) discPx++;
      // the NULL: two untouched frames, same classifier
      if (!(a[i] === nn[i] && a[i + 1] === nn[i + 1] && a[i + 2] === nn[i + 2])) {
        const k = cls(nn[i], nn[i + 1], nn[i + 2]);
        if (k === 1) nullGreen++; else if (k === 2) nullCore++;
      }
      const changed = !(nn[i] === b[i] && nn[i + 1] === b[i + 1] && nn[i + 2] === b[i + 2]);
      if (changed) {
        const k = cls(b[i], b[i + 1], b[i + 2]);
        if (k === 2) { frameCore++; if (within) discCore++; }
        else if (k === 1) { frameGreen++; if (within) discGreen++; }
      }
      // A WARM PIXEL IN THE DISC. Kept, but DO NOT read `discWarmDecor` as
      // "decoration": this bar counts the night ground itself. It reported
      // 5,279 px at a pin whose frame (`r6-pin-02-plan.png`) is a black
      // tree-lined path with no light in it at all, because this city's ground
      // is a warm dark brown after dark and a warm-tinted SURFACE is not light.
      // Caught by looking at the frame. The calibrated version — a bar set on
      // this lane's own dark and lit populations rather than guessed — is
      // `shots/walk/lit/decorpx.mjs`, and that is the number the document uses.
      if (within) {
        const R = nn[i], G = nn[i + 1], Bl = nn[i + 2];
        if (R >= 60 && R > G && G > Bl && (R - Bl) >= 25) {
          discWarmBase++;
          if (!changed) discWarmDecor++;
        }
      }
    }
    return { discGreen, frameGreen, discCore, frameCore, discPx, nullGreen, nullCore, discWarmBase, discWarmDecor };
  }, [base.toString('base64'), base2.toString('base64'), mask.toString('base64'), poly.poly, W, H]);

  const tag = `${FRAMES}/r6-${site.kind}-${String(site.i).padStart(2, '0')}-${pose.name}`;
  // NO OVERLAY AT EYE POSE, and the reason is the same one that keeps the disc
  // test out of that column. The eye stands AT the site, so half of the site's
  // own 25 m ground circle is BEHIND the camera, and points behind the camera
  // do not project — they come back on the wrong side of the screen and the
  // "disc" draws as a handful of crossing lines. `project(site)` is equally
  // meaningless there: it is asking where the camera is on the camera's own
  // screen. So the eye frame is exactly what a person standing there sees,
  // unannotated, and every eye-column number comes from queryRenderedFeatures
  // with true ground distances instead.
  if (pose.name === 'eye') {
    fs.writeFileSync(tag + '.png', base2);
    return finish();
  }
  const b64 = await page.evaluate(async ([b, pts, cx, cy, w, h]) => {
    const im = await new Promise(res => { const g2 = new Image(); g2.onload = () => res(g2); g2.src = 'data:image/png;base64,' + b; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const sx = im.width / w, sy = im.height / h;
    g.strokeStyle = '#ff2fd6'; g.lineWidth = 2;
    g.beginPath();
    pts.forEach((p, k) => { const X = p[0] * sx, Y = p[1] * sy; k ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.closePath(); g.stroke();
    g.beginPath();
    g.moveTo(cx * sx - 8, cy * sy); g.lineTo(cx * sx + 8, cy * sy);
    g.moveTo(cx * sx, cy * sy - 8); g.lineTo(cx * sx, cy * sy + 8); g.stroke();
    return c.toDataURL('image/png').split(',')[1];
  }, [base2.toString('base64'), poly.poly, poly.cx, poly.cy, W, H]);
  fs.writeFileSync(tag + '.png', Buffer.from(b64, 'base64'));
  return finish();

  function finish() {
    const eyeOk = pose.name !== 'eye' || (cam && cam.eyeErrM != null &&
      cam.eyeErrM <= EYE_ERR_MAX_M && Math.abs(cam.altM - EYE.altM) <= EYE_ALT_TOL_M);
    return {
      kind: site.kind, i: site.i, pose: pose.name, from: site.from, to: site.to,
      ll: site.ll, d: site.d, note: site.note, bearing: Math.round(site.bearing),
      radiusM: rad, frame: path.basename(tag + '.png'), cam, eyeOk,
      ...seen, ...px,
      lampInDisc: px.discGreen >= LAMP_GREEN_MIN, lampInFrame: px.frameGreen >= LAMP_GREEN_MIN,
    };
  }
}

const rows = [];
for (const site of SITES) {
  for (const pose of [PLAN, EYE]) {
    const r = await look(site, pose);
    rows.push(r);
    const camTxt = r.cam ? `eye ${r.cam.eyeErrM} m off, ${r.cam.altM} m up, z${r.cam.zoom}` : '';
    console.log(`  ${r.kind} ${String(r.i).padStart(2)} ${r.pose.padEnd(4)} ${r.from}->${r.to}` +
      `  idx ${String(r.d).padStart(6)} m  disc ${String(r.discGreen).padStart(6)}  frame ${String(r.frameGreen).padStart(6)}` +
      `  null ${r.nullGreen}  decor ${String(r.discWarmDecor).padStart(6)}` +
      `  visible warm: ${r.warmVisible}${r.nearestVisibleWarmM != null ? ' nearest ' + r.nearestVisibleWarmM + ' m' : ''}` +
      `  top@site ${r.topAtSite}  ${camTxt}${r.eyeOk ? '' : '  *EYE NOT SOLVED'}`);
  }
}

const P = (k) => rows.filter(r => r.kind === k && r.pose === 'plan' && !r.missing.length);
const E = (k) => rows.filter(r => r.kind === k && r.pose === 'eye' && !r.missing.length && r.eyeOk);
const share = (a, f) => `${a.filter(f).length} / ${a.length}`;
const med = (a, k) => { const s = a.map(r => r[k]).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

console.log('\n# 1. THE PLAN MATRIX — the pose rounds 3-5 used, now with the third colour in it');
console.log('                                          PIN (violet)     LIT (amber)      COOL');
console.log(`  a surveyed lamp pool inside the disc     ${share(P('pin'), r => r.lampInDisc).padEnd(17)}${share(P('lit'), r => r.lampInDisc).padEnd(17)}${share(P('cool'), r => r.lampInDisc)}`);
console.log(`  ...anywhere in the frame                 ${share(P('pin'), r => r.lampInFrame).padEnd(17)}${share(P('lit'), r => r.lampInFrame).padEnd(17)}${share(P('cool'), r => r.lampInFrame)}`);
console.log(`  median lamp-pool pixels in the disc      ${String(med(P('pin'), 'discGreen')).padEnd(17)}${String(med(P('lit'), 'discGreen')).padEnd(17)}${med(P('cool'), 'discGreen')}`);
console.log(`  median metres to the nearest mapped lamp ${String(med(P('pin'), 'd')).padEnd(17)}${String(med(P('lit'), 'd')).padEnd(17)}${med(P('cool'), 'd')}`);

console.log('\n# 2. THE NULL CONTROL — two untouched frames, same classifier');
const allNull = rows.filter(r => !r.missing.length);
console.log(`  sites with any "lamp" pixel from repainting NOTHING:  ${allNull.filter(r => r.nullGreen > 0).length} / ${allNull.length}` +
  `   (max ${Math.max(0, ...allNull.map(r => r.nullGreen))} px)`);

console.log('\n# 3. WARM PIXELS IN THE DISC (raw — see the comment: this counts warm GROUND');
console.log('#    as well as light. The calibrated answer is shots/walk/lit/decorpx.mjs.)');
for (const k of ['pin', 'lit', 'cool']) {
  const a = P(k);
  console.log(`  ${k.padEnd(5)}  median warm px ${String(med(a, 'discWarmDecor')).padEnd(10)}median surveyed-lamp px ${med(a, 'discGreen')}`);
}

console.log('\n# 4. THE EYE COLUMN — camera placed ON the site at the app\'s walking height');
const eyeRows = rows.filter(r => r.pose === 'eye');
const solved = eyeRows.filter(r => r.eyeOk);
console.log(`  eye solved to within ${EYE_ERR_MAX_M} m and ${EYE.altM} +/- ${EYE_ALT_TOL_M} m:  ${solved.length} / ${eyeRows.length}` +
  `   (median miss ${med(solved.map(r => ({ e: r.cam.eyeErrM })), 'e')} m)`);
// THE EYE COLUMN IS READ OFF THE MASKED DIFF, NOT OFF queryRenderedFeatures,
// AND THAT IS A CORRECTION MADE MID-RUN BY LOOKING AT THE ROWS. `warmVisible`
// came back 0 at EVERY eye pose — including a site 3.2 m from a lamp whose own
// masked diff scores 17,107 pool pixels in the same frame. MapLibre's hit test
// on a `circle-pitch-scale: 'map'` layer does not survive pitch 84 at z21, so
// the count is a confident zero from an instrument that cannot see. Both
// numbers are still written to the JSON so the disagreement is on the record,
// but the one this table uses is the one that agrees with the picture.
// `topAtSite` is dropped at eye pose for the same reason §43 gives: project()
// of the point the camera is standing on is not a screen position.
console.log('                                          PIN (violet)     LIT (amber)      COOL');
console.log(`  surveyed lamplight in the frame you see  ${share(E('pin'), r => r.lampInFrame).padEnd(17)}${share(E('lit'), r => r.lampInFrame).padEnd(17)}${share(E('cool'), r => r.lampInFrame)}`);
console.log(`  median pool pixels in that frame         ${String(med(E('pin'), 'frameGreen')).padEnd(17)}${String(med(E('lit'), 'frameGreen')).padEnd(17)}${med(E('cool'), 'frameGreen')}`);
console.log(`  queryRenderedFeatures agrees             ${share(E('pin'), r => (r.warmVisible > 0) === r.lampInFrame).padEnd(17)}` +
  `${share(E('lit'), r => (r.warmVisible > 0) === r.lampInFrame).padEnd(17)}${share(E('cool'), r => (r.warmVisible > 0) === r.lampInFrame)}`);

console.log('\n# 5. THE VIOLET COLUMN, SITE BY SITE — the one never audited');
for (const r of P('pin')) {
  const e = rows.find(x => x.kind === 'pin' && x.i === r.i && x.pose === 'eye');
  console.log(`  pin ${String(r.i).padStart(2)}  ${r.from}->${r.to}  nearest mapped lamp ${String(r.d).padStart(6)} m` +
    `   plan: ${String(r.discGreen).padStart(5)} px of surveyed lamp in the disc` +
    `   eye: ${String(e ? e.frameGreen : -1).padStart(5)} px in the frame   ${(r.note || '(no words)').slice(0, 40)}`);
}

// A re-shoot of two named sites must never overwrite the table the document
// cites — that is a whole run's sample replaced by a fragment of itself.
if (process.env.ONLY) {
  console.log(`\nONLY run: ${OUT}/pinpose.json left untouched. Frames in ${FRAMES}.`);
  await browser.close();
  process.exit(0);
}
fs.writeFileSync(`${OUT}/pinpose.json`, JSON.stringify({
  night, poses: { PLAN, EYE }, greenMin: LAMP_GREEN_MIN, radiusM: RADIUS_M, darkNearM: DARK_NEAR_M,
  eyeErrMaxM: EYE_ERR_MAX_M, eyeAltTolM: EYE_ALT_TOL_M,
  pairsRouted: routesSeen.length, pairsWithPins: withPins.length, frames: FRAMES, rows, errs,
}, null, 1));
console.log(`\nwrote ${OUT}/pinpose.json · frames in ${FRAMES}`);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
