/**
 * ground-flatness.mjs — "reads as paper, not ground" is a claim about pixels.
 *
 * The complaint is that a 600x400 region of unbroken flat tone reads as paper.
 * The measurable version of that is LOCAL CONTRAST: chop the ground half of the
 * frame into 16x16 blocks and take the mean of the per-block luma standard
 * deviation. Flat fill -> near zero. Real surface variation -> above it. Global
 * variance is the wrong metric: a frame of twelve flat hexes has plenty of it.
 *
 * Four configurations, isolated so each one's contribution is attributable:
 *   flat   the layer as it shipped — one hex per surface, no pattern
 *   jitter per-feature lightness only (no images, near-zero cost)
 *   tex    fill-pattern only (jitter off)
 *   all    what ships
 *
 * Usage: node ground-flatness.mjs [p]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const P = parseFloat(process.argv[2] ?? '0.14');
const POSE = { center: [-97.7370, 30.2810], zoom: 16.1, pitch: 68, bearing: 86 };
const BLOCK = 16;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(5000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Ground only, post off. Grain, bloom and trees would all show up as local
// contrast and none of them is the thing under test.
await page.evaluate(([pose, p]) => {
  const m = window.__map;
  Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
  window.applyGraphics();
  for (const l of m.getStyle().layers) {
    const keep = l.id.startsWith('ground-') || l.type === 'background' || /^sky|atmos|haze/.test(l.id);
    try { if (!keep) m.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
  }
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo(pose);
  window.applyTimeOfDay(m, p, true);
}, [POSE, P]);
await page.waitForTimeout(3000);

// Each texture layer separately, because "the texture works" is not a finding
// if one of the two layers is silently not rendering. A patterned BACKGROUND
// layer in particular is the kind of thing that either works or does nothing at
// all, and it must not be credited for the fill layer's result.
const CONFIGS = {
  flat:    { jitter: false, area: false, base: false },
  jitter:  { jitter: true,  area: false, base: false },
  texArea: { jitter: false, area: true,  base: false },
  texBase: { jitter: false, area: false, base: true  },
  all:     { jitter: true,  area: true,  base: true  },
};

const results = {};
for (const [name, cfg] of Object.entries(CONFIGS)) {
  await page.evaluate(([cfg, p]) => {
    const m = window.__map;
    const G = window.GROUND;
    if (window.__gSaved === undefined) window.__gSaved = { j: G.jitter, pj: G.pathJitter };
    G.jitter = cfg.jitter ? window.__gSaved.j : 0;
    G.pathJitter = cfg.jitter ? window.__gSaved.pj : 0;
    window.applyGroundColors(m, p);
    const vis = (id, on) => {
      try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {}
    };
    vis('ground-texture', cfg.area);
    vis('ground-base-texture', cfg.base);
    m.triggerRepaint();
  }, [cfg, P]);
  await page.waitForTimeout(2200);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(800);

  results[name] = await page.evaluate((BLOCK) => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // readPixels is bottom-up, so the ground half is the BOTTOM of the buffer
    // in screen terms == rows 0..h*0.55 here. Skip the UI chrome strip.
    const y0 = Math.floor(h * 0.06), y1 = Math.floor(h * 0.55);
    let sum = 0, n = 0, lo = 999, hi = -999;
    for (let by = y0; by + BLOCK <= y1; by += BLOCK) {
      for (let bx = 0; bx + BLOCK <= w; bx += BLOCK) {
        let s = 0, s2 = 0, c = 0;
        for (let y = by; y < by + BLOCK; y++) for (let x = bx; x < bx + BLOCK; x++) {
          const i = (y * w + x) * 4;
          const L = 0.2126 * buf[i] + 0.7152 * buf[i+1] + 0.0722 * buf[i+2];
          s += L; s2 += L * L; c++;
        }
        const mean = s / c;
        const sd = Math.sqrt(Math.max(0, s2 / c - mean * mean));
        // Blocks straddling a road kerb or a building edge are pure edge
        // contrast, not surface texture; drop the top decile by sd later.
        sum += sd; n++; lo = Math.min(lo, sd); hi = Math.max(hi, sd);
      }
    }
    // Second pass keeping only blocks below the 80th percentile of sd, which
    // removes the edges and leaves the surface.
    const sds = [];
    for (let by = y0; by + BLOCK <= y1; by += BLOCK) {
      for (let bx = 0; bx + BLOCK <= w; bx += BLOCK) {
        let s = 0, s2 = 0, c = 0;
        for (let y = by; y < by + BLOCK; y++) for (let x = bx; x < bx + BLOCK; x++) {
          const i = (y * w + x) * 4;
          const L = 0.2126 * buf[i] + 0.7152 * buf[i+1] + 0.0722 * buf[i+2];
          s += L; s2 += L * L; c++;
        }
        const mean = s / c;
        sds.push(Math.sqrt(Math.max(0, s2 / c - mean * mean)));
      }
    }
    sds.sort((a, b) => a - b);
    const cut = sds.slice(0, Math.floor(sds.length * 0.8));
    const frac = t => +(100 * sds.filter(v => v < t).length / sds.length).toFixed(1);

    // Distinct colours. This is the metric the JITTER moves and local contrast
    // cannot: jitter varies BETWEEN features, so it never shows up inside a
    // 16x16 block, but it is exactly what turns 3,117 areas into more than
    // fourteen exact hexes. Quantised to 4 levels per channel so antialiasing
    // along an edge does not count as variety.
    const seen = new Set();
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      seen.add(((buf[i] >> 2) << 12) | ((buf[i+1] >> 2) << 6) | (buf[i+2] >> 2));
    }
    return {
      meanSd: +(sum / n).toFixed(3),
      surfaceSd: +(cut.reduce((a, v) => a + v, 0) / cut.length).toFixed(3),
      flat05: frac(0.5), flat10: frac(1.0), flat20: frac(2.0),
      colours: seen.size,
      blocks: n,
    };
  }, BLOCK);
}

// Put the settings back so nothing downstream inherits a probe's state.
await page.evaluate((p) => {
  const G = window.GROUND;
  if (window.__gSaved) { G.jitter = window.__gSaved.j; G.pathJitter = window.__gSaved.pj; }
  window.applyGroundColors(window.__map, p);
}, P);

console.log(`\nground half of the frame, p=${P}, ${BLOCK}x${BLOCK} blocks`);
console.log('config   surfaceSd   %flat<0.5  %flat<1.0  %flat<2.0   distinct colours');
for (const [k, r] of Object.entries(results)) {
  console.log('%s %s %s %s %s %s', k.padEnd(8),
    String(r.surfaceSd).padStart(9), String(r.flat05).padStart(10),
    String(r.flat10).padStart(10), String(r.flat20).padStart(10),
    String(r.colours).padStart(18));
}
console.log('\nsurfaceSd  mean sd of the flattest 80% of blocks (drops kerb/edge blocks)');
console.log('%flat<X    share of blocks with luma sd below X — the "reads as paper" share');
console.log('colours    distinct 6-bit-per-channel colours; the metric jitter moves');
await browser.__done();
