/**
 * arts-check.mjs — assert the arts precinct is what docs/PASS_ARTS.md claims.
 *
 * Most of these are NEGATIVES or SHAPE assertions rather than "did we set a
 * property", because every regression that matters in this pass looks fine in a
 * style dump and fine in a screenshot you do not zoom into:
 *
 *   - a band whose inset collapsed still draws, just at the wrong size
 *   - a layer anchored at the wrong place still draws, just under the ground
 *   - a replaced building still in `buildings-3d` draws INSIDE the bands
 *   - a pattern image that was never registered paints the wall transparent
 *   - a colour that only works at noon looks perfect in every day screenshot
 *
 * Two of those are not hypothetical. Writing this file found that
 * applyArtsColors had lost its ensureImages() call, so the Ransom Center's
 * panels and the Bass lobby's glass were frozen at whatever time of day they
 * were first registered while every band around them moved. And the Bass lobby,
 * originally handed to the shared facade atlas to save an image, came back
 * BRICK — nearest-RGB against fourteen mostly-tan buckets snaps blue-grey glass
 * to tan. Both of those rendered beautifully.
 *
 * Usage:  node arts-check.mjs        # needs the repo served; set VERIFY_URL
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const W = 1100, H = 740;

const POSE = {
  lbj:     { center: [-97.72929, 30.28590], zoom: 17.4, pitch: 62, bearing: 205 },
  ransom:  { center: [-97.74123, 30.28434], zoom: 17.4, pitch: 62, bearing: 125 },
  blanton: { center: [-97.73742, 30.28098], zoom: 17.4, pitch: 60, bearing: 40 },
  kelly:   { center: [-97.73782, 30.28168], zoom: 18.0, pitch: 58, bearing: 330 },
  // Bearing 355, not 175. The lobby is on the SOUTH elevation, so a camera north
  // of the building looking south has 105 m of blind brick between it and the
  // only glass in the pass — and the first run of this file duly reported
  // "0.00% cool" for a lobby that was rendering perfectly.
  bass:    { center: [-97.73103, 30.28600], zoom: 17.2, pitch: 62, bearing: 355 },
  // Nadir ONLY for counting objects. docs/PASS_COMMON.md is right that an
  // orthographic top-down tells you nothing about how a building LOOKS; it is
  // still the only view in which "are there twelve discs and how wide are they"
  // is a question about geometry rather than about perspective.
  petals:  { center: [-97.73793, 30.280885], zoom: 18.6, pitch: 0, bearing: 0 },
};

let pass = 0, fail = 0;
const ok = (c, msg, extra) => {
  c ? pass++ : fail++;
  console.log(`${c ? 'ok  ' : 'FAIL'}  ${msg}${extra != null ? '   [' + extra + ']' : ''}`);
};

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
// Wait for the PASS, not for the style: it self-boots after buildings-3d exists,
// which on the software rasteriser is several seconds after isStyleLoaded().
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getLayer && m.getLayer('arts-solid') && m.getSource('austin-arts');
}, null, { timeout: 120000 });
// The graphics auto-detect rewrites every setting ~11 s in, which would change
// the look halfway through the run.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(2500);

// ── 1. wiring ────────────────────────────────────────────────────────
const wiring = await page.evaluate(() => {
  const m = window.__map;
  const ids = m.getStyle().layers.map(l => l.id);
  const gone = ['d997136f-049e-4769-be88-dab62a98fac6', 'a5ec01b5-8575-406d-9711-1b5486b71838',
                '8a27170d-b961-40a6-830b-1073a83dabe2', '4f12c48f-87c0-4928-9c50-1d73cc590e81',
                '31901788-06c4-440c-8b95-bf8061f074cc', 'f6fbb1e7-945c-47ff-8071-17af0ea713cc'];
  const filt = JSON.stringify(m.getFilter('buildings-3d') || null);
  return {
    layers: ids.filter(i => i.startsWith('arts-')),
    idxArts: ids.indexOf('arts-solid'),
    idxB3d: ids.indexOf('buildings-3d'),
    idxGround: ids.indexOf('ground-areas'),
    replacedInFilter: gone.filter(g => filt.includes(g)).length,
    panelImg: m.hasImage('arts-hrc-panel'),
    glassImg: m.hasImage('arts-bass-glass'),
    // Asked FUNCTIONALLY, not by looking for the __arts marker. Six modules
    // wrap applyTimeOfDay by polling, so which one ends up outermost is a race:
    // the marker check passed one run and failed the next while the behaviour
    // was identical both times. What matters is that moving p moves this pass's
    // paint, so that is what gets asked.
    todHooked: (() => {
      window.applyTimeOfDay(m, 0.10, true);
      const a = JSON.stringify(m.getPaintProperty('arts-solid', 'fill-extrusion-color'));
      window.applyTimeOfDay(m, 0.80, true);
      const b = JSON.stringify(m.getPaintProperty('arts-solid', 'fill-extrusion-color'));
      return a !== b;
    })(),
    vgSolid: m.getPaintProperty('arts-solid', 'fill-extrusion-vertical-gradient'),
  };
});
ok(wiring.layers.length === 4, 'four arts layers exist', wiring.layers.join(','));
ok(wiring.idxArts > wiring.idxB3d, 'arts is anchored ABOVE buildings-3d, not at the bottom of the stack',
   `arts@${wiring.idxArts} > b3d@${wiring.idxB3d}`);
ok(wiring.idxGround === -1 || wiring.idxArts > wiring.idxGround,
   'arts is above ground-areas (the anchor trap that once buried the stadium)', `ground@${wiring.idxGround}`);
ok(wiring.replacedInFilter === 6, 'every sampled replaced id is in the buildings-3d filter',
   wiring.replacedInFilter + '/6');
ok(wiring.panelImg && wiring.glassImg, 'both pattern images are registered',
   `panel=${wiring.panelImg} glass=${wiring.glassImg}`);
ok(wiring.todHooked === true,
   'moving the time of day moves this pass paint — the day/night hook is live');
ok(wiring.vgSolid === false,
   'vertical-gradient is OFF on the banded layer (it draws a dark seam per band)', wiring.vgSolid);

// ── the rig ──────────────────────────────────────────────────────────
//
// HOW "our pixels" is decided. Two false starts are worth recording, because
// both produced numbers that looked entirely reasonable.
//
//  1. Paint the basemap background magenta, count every non-magenta pixel. That
//     reported 236,655 px for Kelly's Austin, a 20 m object, because this app
//     does not draw its sky as a LAYER: js/sky.js uses map.setSky(), a
//     style-level property no setLayoutProperty loop can touch. Every luma and
//     hue read through that key was a number about the sky.
//  2. Render the pose twice, arts off then arts on, and keep the pixels that
//     CHANGED — which is what scripts/verify/README.md recommends. But the sky
//     here is animated, so the whole frame drifts a few units between the two
//     captures. Restricting the layers to ONE building then measured MORE
//     changed pixels than showing all of them, which is arithmetically
//     impossible, and that is how the flaw announced itself.
//
// What works is a MASK PASS: paint the arts layers a key colour, read the mask
// off that frame, then restore the real paint and measure the same pixels.
// Geometry is identical between the two passes because only paint changed, and
// the key survives face shading — magenta stays red-and-blue-high, green-low,
// which nothing else in this scene is.
const KEY_IMG = 'arts-key-mask';

const PAINT = await page.evaluate(() => ({
  solid: window.__map.getPaintProperty('arts-solid', 'fill-extrusion-color'),
  cap: window.__map.getPaintProperty('arts-cap', 'fill-extrusion-color'),
}));

// A 64 px all-magenta image, so the two PATTERN layers can be keyed too.
await page.evaluate((id) => {
  const d = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255; }
  if (!window.__map.hasImage(id)) window.__map.addImage(id, { width: 64, height: 64, data: d });
}, KEY_IMG);

const BASE_FILTER = {
  'arts-solid': ['==', ['get', 'lyr'], 'solid'],
  'arts-panel': ['==', ['get', 'lyr'], 'panel'],
  'arts-glass': ['==', ['get', 'lyr'], 'glass'],
  'arts-cap': ['==', ['get', 'cap'], 1],
};

async function settle(ms) {
  await page.waitForTimeout(ms || 2600);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(700);
}

// `only` restricts the measurement to ONE building. At zoom 18 over Kelly's
// Austin the Blanton, the Smith Building and twelve petals are all in frame, so
// an unrestricted measure compared Kelly's saturation with the Blanton's using
// mostly the same pixels and got 0.240 both times.
async function frame(name, p, only) {
  await page.evaluate(({ s, p, F, only }) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo(s);
    window.applyTimeOfDay(m, p, true);
    for (const id of Object.keys(F)) {
      const f = only ? ['all', F[id], ['==', ['get', 'b'], only]] : F[id];
      try { m.setFilter(id, f); } catch (e) {}
    }
    // Everything else off, so nothing occludes the bands. Re-applied per pose:
    // on a long run something in the adaptive-graphics path turns layers back
    // on, and isolate.mjs came back with the whole city's roof decks visible.
    for (const l of m.getStyle().layers) {
      const keep = l.id.startsWith('arts-') || l.type === 'background';
      try { m.setLayoutProperty(l.id, 'visibility', keep ? 'visible' : 'none'); } catch (e) {}
    }
  }, { s: POSE[name], p, F: BASE_FILTER, only: only || null });
  await settle(3000);
}

/** Key the four layers, read the mask, then put the real paint back. */
async function mask() {
  await page.evaluate((KEY) => {
    const m = window.__map;
    for (const id of ['arts-solid', 'arts-cap']) {
      try { m.setPaintProperty(id, 'fill-extrusion-color', '#ff00ff'); } catch (e) {}
    }
    for (const id of ['arts-panel', 'arts-glass']) {
      try { m.setPaintProperty(id, 'fill-extrusion-pattern', KEY); } catch (e) {}
    }
    m.triggerRepaint();
  }, KEY_IMG);
  await page.waitForTimeout(2600);
  const n = await page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const mk = new Uint8Array(w * h);
    let n = 0;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      const r = buf[j], g = buf[j + 1], b = buf[j + 2];
      // Magenta after face shading: red and blue both present and comparable,
      // green well below both. The sky is blue with real green in it; the
      // ground is tan; neither can satisfy this.
      if (r > 28 && b > 28 && g < 0.45 * Math.max(r, b) && Math.abs(r - b) < 0.55 * Math.max(r, b)) {
        mk[i] = 1; n++;
      }
    }
    window.__artsMask = mk;
    return n;
  });
  await page.evaluate((P) => {
    const m = window.__map;
    try { m.setPaintProperty('arts-solid', 'fill-extrusion-color', P.solid); } catch (e) {}
    try { m.setPaintProperty('arts-cap', 'fill-extrusion-color', P.cap); } catch (e) {}
    try { m.setPaintProperty('arts-panel', 'fill-extrusion-pattern', 'arts-hrc-panel'); } catch (e) {}
    try { m.setPaintProperty('arts-glass', 'fill-extrusion-pattern', 'arts-bass-glass'); } catch (e) {}
    m.triggerRepaint();
  }, PAINT);
  await page.waitForTimeout(2600);
  return n;
}

/** Reduce the masked pixels. All work stays in-page — ground-luma.mjs learned
 *  that handing 4M numbers back over CDP takes twenty minutes. */
function stats() {
  return page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);   // rows are BOTTOM-up
    const mk = window.__artsMask;
    const L = [], S = [], HU = [], ys = [];
    let n = 0, sr = 0, sg = 0, sb = 0, aySum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (h - 1 - y) * w + x;                    // the mask is in GL order
        if (!mk[idx]) continue;
        const j = idx * 4;
        const r = buf[j], g = buf[j + 1], b = buf[j + 2];
        n++; sr += r; sg += g; sb += b; aySum += y;
        L.push((0.30 * r + 0.59 * g + 0.11 * b) / 255);
        ys.push(y);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
        S.push(mx ? dd / mx : 0);
        let hu = -1;
        if (dd) {
          hu = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
          hu = ((hu * 60) + 360) % 360;
        }
        HU.push(hu);
      }
    }
    if (!n) return { n: 0 };
    const q = (a, f) => { const v = a.slice().sort((x, y) => x - y); return v[Math.floor(f * (v.length - 1))]; };
    const hueFrac = (lo, hi) => HU.filter(x => x >= lo && x <= hi).length / n;
    // "Is there a dark band, and does it sit LOW?" — a more honest question than
    // reading one pixel column, because the tallest column of a pitched
    // extrusion runs across the ROOF plane and not down the wall. A first
    // version of this test read one column and duly reported the base of the LBJ
    // as brighter than the mass above it.
    const med = q(L, 0.5);
    let dn = 0, dySum = 0;
    for (let i = 0; i < L.length; i++) if (L[i] < med * 0.62) { dn++; dySum += ys[i]; }
    return {
      n, mean: [sr / n, sg / n, sb / n],
      lumaMed: med, luma90: q(L, 0.9), luma98: q(L, 0.98), luma05: q(L, 0.05), satMed: q(S, 0.5),
      warm: hueFrac(12, 70), cool: hueFrac(160, 255),
      darkFrac: dn / n,
      darkYRel: dn ? (dySum / dn - aySum / n) / h : 0,
    };
  });
}

async function look(name, p, only) {
  await frame(name, p, only);
  await mask();
  return stats();
}

// ── 2. the LBJ is a STACK, not a box ─────────────────────────────────
const lbj = await look('lbj', 0.12, 'lbj');
{
  const s = lbj;
  ok(s.n > 3000, 'LBJ: the isolated frame is not empty', s.n + ' px');
  ok(s.darkFrac > 0.03,
     'LBJ: a distinctly darker band exists — stacked geometry, which one extrusion cannot do',
     (s.darkFrac * 100).toFixed(1) + '% of its pixels');
  ok(s.darkYRel > 0.01,
     'LBJ: ...and that band sits LOW on the building, where the undercroft is',
     '+' + (s.darkYRel * 100).toFixed(1) + '% of frame height below its own mean');
  ok(s.luma05 > 0.08,
     'LBJ: the undercroft is a shaded loggia, not a black hole punched in the plaza',
     s.luma05.toFixed(3));
  // Within ONE pose, and as a ratio. Two earlier versions of this assertion were
  // unsound: an absolute cut-off, and a comparison of the LBJ's p90 against
  // Bass's, which came out 0.388 to 0.391 — a statement about two bearings, not
  // about travertine versus brick. Note the scale too: gl.readPixels reads the
  // MAP canvas, which is BEFORE js/graphics.js composites its exposure and
  // grade on the separate FX canvas, so every luma in this file is darker than
  // the same pixel in a screenshot. The travertine that measures 0.42 here
  // samples #f7ddaf in docs/shots.
  ok(s.luma98 / Math.max(0.01, s.luma05) > 2.0,
     'LBJ: the sunlit travertine is more than twice the luma of its own undercroft',
     `${s.luma98.toFixed(3)} / ${s.luma05.toFixed(3)} = ${(s.luma98 / s.luma05).toFixed(2)}x`);
  ok(s.warm > 0.55, 'LBJ: cream, not neutral concrete', (s.warm * 100).toFixed(0) + '% warm');
}

// ── 3. Bass: two materials, and the glass is the minority ────────────
{
  const s = await look('bass', 0.12, 'bass');
  ok(s.n > 5000, 'Bass: the isolated frame is not empty', s.n + ' px');
  ok(s.warm > 0.45, 'Bass: most of the complex is warm blind brick', (s.warm * 100).toFixed(1) + '%');
  ok(s.cool > 0.006, 'Bass: the glazed lobby is on screen and is NOT brick — the regression this pass hit',
     (s.cool * 100).toFixed(2) + '% cool');
  ok(s.cool < s.warm * 0.55, 'Bass: glass stays the minority material, as on the real building',
     `cool ${(s.cool * 100).toFixed(1)}% vs warm ${(s.warm * 100).toFixed(1)}%`);
}

// ── 4. Kelly is the whitest and coolest thing in the precinct ────────
const kelly = await look('kelly', 0.12, 'kelly');
const blanton = await look('blanton', 0.12, 'blanton');
ok(kelly.n > 300, 'Kelly: the object is on screen at all at a flying zoom', kelly.n + ' px');
ok(kelly.luma90 >= blanton.luma90 * 0.95,
   'Kelly: at least as light as the Blanton limestone beside it',
   `${kelly.luma90.toFixed(3)} vs ${blanton.luma90.toFixed(3)}`);
ok(kelly.satMed < blanton.satMed,
   'Kelly is COOLER than the Blanton limestone beside it — the contrast the samples measured',
   `kelly ${kelly.satMed.toFixed(3)} < blanton ${blanton.satMed.toFixed(3)}`);

// ── 5. twelve petals, at the size and the spread the aerial measured ─
//
// Counted by AREA and by SPREAD rather than by blob, because the discs touch.
// The snapshot's own footprints put the canopy centres 9.5 m apart with a 9.2 m
// diameter, so the gap between neighbours is 0.3 m - about one pixel at any
// zoom this can be rendered at - and a flood fill merges the cluster into one
// shape. The first version of this test counted blobs and reported 0 discs from
// a 31,926 px mask, which is a statement about connected components and not
// about petals.
await frame('petals', 0.12, 'petal');
const petalMaskN = await mask();
{
  const r = await page.evaluate(() => {
    const m = window.__map;
    const cv = m.getCanvas();
    const mk = window.__artsMask;
    const w = cv.width, h = cv.height;
    let n = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
    for (let i = 0; i < w * h; i++) {
      if (!mk[i]) continue;
      const x = i % w, y = (i / w) | 0;
      n++;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    const a = m.project([-97.7380, 30.2809]), b = m.project([-97.7370, 30.2809]);
    const dpr = cv.width / m.getContainer().clientWidth;
    const mpp = (0.0010 * 96000) / (Math.hypot(a.x - b.x, a.y - b.y) * dpr);
    return { n, mpp, area: n * mpp * mpp, spanX: (maxx - minx + 1) * mpp, spanY: (maxy - miny + 1) * mpp };
  });
  // Ten 9.2 m discs from the snapshot plus two 8.0 m discs digitised off the
  // aerial = 765 m2 of canopy, less whatever the neighbours overlap.
  ok(r.area > 560 && r.area < 1000,
     'the petal canopies cover the ~765 m2 twelve discs of that size should',
     r.area.toFixed(0) + ' m2 from ' + petalMaskN + ' px at ' + r.mpp.toFixed(3) + ' m/px');
  // The plaza cluster alone is ~38 m across. Only the two petals digitised off
  // the z20 nadir tile, 60 m to the east, can push the spread past 85 m - so
  // this is the assertion that those two are present AND in the right place.
  ok(r.spanX > 85,
     'the two petals missing from the snapshot are present, 60 m east of the cluster',
     r.spanX.toFixed(0) + ' m of spread');
}

// ── 6. it is not a noon-only precinct ────────────────────────────────
{
  const day = await look('ransom', 0.12, 'ransom');
  const gold = await look('ransom', 0.50, 'ransom');
  const night = await look('ransom', 0.88, 'ransom');
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  ok(d(day.mean, gold.mean) > 10, 'the precinct changes at golden hour', d(day.mean, gold.mean).toFixed(1));
  // 0.72, not 0.5: these bands carry wn values from the same wall_ramp() that
  // scripts/bake_stadium.py uses, and this assertion exists to catch "night
  // never happens", not to police the shape of the curve.
  ok(night.lumaMed < day.lumaMed * 0.72, 'the precinct goes properly dark at night',
     `${night.lumaMed.toFixed(3)} vs ${day.lumaMed.toFixed(3)}`);
  // The two tiles are IMAGES, repainted rather than re-expressed. When
  // ensureImages went missing from applyArtsColors during a refactor, every
  // other assertion here still passed and those two bands alone stayed at noon.
  const moved = await page.evaluate(() => {
    const m = window.__map;
    const grab = id => { const i = m.style.getImage(id); return i && Array.from(i.data.data.slice(0, 96)).join(','); };
    window.applyTimeOfDay(m, 0.12, true);
    const a = [grab('arts-hrc-panel'), grab('arts-bass-glass')];
    window.applyTimeOfDay(m, 0.94, true);
    const b = [grab('arts-hrc-panel'), grab('arts-bass-glass')];
    return a.every((v, i) => v && b[i] && v !== b[i]);
  });
  ok(moved === true, 'both pattern images are redrawn for time of day', moved);

  // The panel joint must be a VALUE STEP, not a black bar. The first cut of this
  // tile used the sampled joint hex directly and rendered as a cage of eleven
  // hard black bars across a 63 m elevation.
  const contrast = await page.evaluate(() => {
    const m = window.__map;
    window.applyTimeOfDay(m, 0.12, true);
    const d = m.style.getImage('arts-hrc-panel').data.data, L = [];
    for (let i = 0; i < d.length; i += 4) L.push(0.30 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]);
    L.sort((a, b) => a - b);
    return { lo: L[Math.floor(L.length * 0.03)], hi: L[Math.floor(L.length * 0.97)] };
  });
  ok(contrast.hi / Math.max(1, contrast.lo) < 2.6,
     'the Ransom panel joint is a shadow reveal, not a black cage',
     `light/dark ${(contrast.hi / contrast.lo).toFixed(2)}`);

  // The single most identifying colour fact in this pass, and one that can be
  // asked of the image bytes instead of a render: three separate patches of the
  // real facade measured H60 S1.8-2.5%, DEAD NEUTRAL, while the concrete cornice
  // on the same building measured H32 S10%. That difference is the etched glass
  // against the concrete. The snapshot had this building as #cdc4b0 — the campus
  // limestone default, and a warm tan.
  const neutral = await page.evaluate(() => {
    const m = window.__map;
    window.applyTimeOfDay(m, 0.12, true);
    const d = m.style.getImage('arts-hrc-panel').data.data;
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < d.length; i += 4) { n++; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
    const r = sr / n, g = sg / n, b = sb / n;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return { sat: (mx - mn) / mx, rgb: [r, g, b].map(v => Math.round(v)) };
  });
  ok(neutral.sat < 0.06,
     'the Ransom Center panel field is NEUTRAL grey, not the campus limestone tan',
     `saturation ${(neutral.sat * 100).toFixed(1)}% at rgb(${neutral.rgb.join(',')})`);
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
