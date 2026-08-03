/**
 * label-legibility.mjs — is a label actually READABLE, as a number.
 *
 * "small grey labels are unreadable and overlapping" is the complaint, and
 * every previous attempt to answer it stopped at "looks better now". This
 * measures it, by hiding one label layer at a time and diffing the frame:
 *
 *   pixels that changed  = exactly the ink that layer owns (glyph AND halo,
 *                          which is what a reader sees as "the label")
 *   the HIDDEN frame at  = literally the scene behind the label — not a guess
 *   those same pixels      at what it is sitting on, the actual pixels
 *
 * so the contrast number is glyph-ink against the thing it has to be read
 * against, per layer, at a named pose and hour. The numbers reported:
 *
 *   placed   symbols that survived collision (queryRenderedFeatures)
 *   ink      pixels of label on screen. A layer decluttered to nothing, or
 *            faded to nothing by its own zoom ramp, is a near-zero here and no
 *            amount of colour work will fix it.
 *   contrast MEDIAN WCAG ratio, label ink vs the scene behind it. Median, not
 *            mean: a halo pixel and a glyph pixel are both "ink" and averaging
 *            them hides a bright glyph inside a dark halo.
 *   p10      the 10th-percentile ratio — the worst-lit tenth of the word. This
 *            is the number that decides whether a label looks washed out, and
 *            it is the one the old cream-at-0.37-alpha labels failed.
 *
 * WHAT DID NOT WORK — three attempts, ~50 minutes, all recorded so the next
 * pass does not repeat them:
 *
 *  - Sampling a hand-picked box round a label. Wrong the way HANDOFF §48 says
 *    it is always wrong: the box round "McCombs" at the street pose is mostly
 *    roof, so the roof scored as the label's contrast.
 *  - The magenta-mask trick with setPaintProperty, one layer at a time. Right
 *    in principle and it never once finished: 4 settles a layer x 6 layers x 4
 *    poses is ~96 waits on `map.once('idle')`, and an idle that never fires
 *    costs the full fallback each time. Two runs died on the watchdog at 5 and
 *    at 25 minutes having printed nothing at all.
 *  - The same trick with all layers masked in ONE pass, each in its own
 *    primary. Fast enough, and the renderer CRASHED — "Target page has been
 *    closed" during the settle after the first jumpTo, with five other agents'
 *    browsers on the box. setLayoutProperty('visibility') needs no glyph
 *    re-upload and no paint-buffer re-upload, which is why this version is the
 *    one that runs.
 *  - A naive 7x7 dilation for "the scene just outside the halo" also crashed
 *    the renderer: 49 reads x 6.4M pixels. Hiding the layer makes the whole
 *    dilation unnecessary — the answer is in the hidden frame.
 *
 * Usage:
 *   VERIFY_MAX_MS=900000 VERIFY_URL=http://127.0.0.1:8156 \
 *     node scripts/verify/label-legibility.mjs --tag before
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TAG = opt('--tag', 'before');
const EXTRA = opt('--extra', '');

const POSES = {
  aerial: { center: [-97.7394, 30.2845], zoom: 16.4, pitch: 58, bearing: 250 },
  street: { center: [-97.7371, 30.2845], zoom: 17.6, pitch: 72, bearing: 20 },
};
const TIMES = { day: 0.30, dusk: 0.62, night: 0.95 };
const wantPose = (opt('--pose', 'aerial,street')).split(',');
const wantTod  = (opt('--tod-name', 'day,dusk,night')).split(',');

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0' + EXTRA,
  { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.evaluate(() => {
  window.__ll = {
    async read() {
      const m = window.__map;
      m.triggerRepaint();
      // triggerRepaint SCHEDULES a frame; reading straight after it returns the
      // PREVIOUS one. Two rAFs, always.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = m.getCanvas();
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const w = c.width, h = c.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w, h, px };
    },
    settle(cap) {
      return new Promise(r => {
        const m = window.__map;
        m.triggerRepaint();
        if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, 350);
        m.once('idle', r); setTimeout(r, cap || 3500);
      });
    },
    // Hide ONE label layer, read, put it back, and score every pixel that moved
    // against what the hidden frame shows underneath it.
    async score(id) {
      const m = window.__map;
      const base = window.__ll.base;
      const vis = m.getLayoutProperty(id, 'visibility');
      m.setLayoutProperty(id, 'visibility', 'none');
      await window.__ll.settle();
      const off = await window.__ll.read();
      m.setLayoutProperty(id, 'visibility', vis === undefined ? 'visible' : vis);
      await window.__ll.settle();

      const lum = (r, g, b) => {
        const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const n = base.w * base.h, rs = [];
      for (let p = 0; p < n; p++) {
        const k = p * 4;
        const dr = base.px[k] - off.px[k], dg = base.px[k + 1] - off.px[k + 1], db = base.px[k + 2] - off.px[k + 2];
        // 12 is above the frame-to-frame noise of this renderer (measured: an
        // unchanged layer scores under 300 px at this threshold, i.e. nothing).
        if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 12) continue;
        const a = lum(base.px[k], base.px[k + 1], base.px[k + 2]);
        const b = lum(off.px[k], off.px[k + 1], off.px[k + 2]);
        rs.push((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
      }
      if (!rs.length) return { ink: 0 };
      rs.sort((x, y) => x - y);
      const q = f => +rs[Math.min(rs.length - 1, Math.floor(rs.length * f))].toFixed(2);
      return { ink: rs.length, p10: q(0.10), contrast: q(0.50), p90: q(0.90) };
    },
  };
});

// props.js and places.js add their label layers after a fetch resolves, so a
// list taken at style-load is short by two. Waited for, not assumed.
await page.waitForTimeout(9000);

const rows = [];
for (const todName of wantTod) {
  await page.evaluate(v => {
    const el = document.getElementById('tod-slider');
    if (el) {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
  }, TIMES[todName]);
  await page.waitForTimeout(2000);

  for (const poseName of wantPose) {
    await page.evaluate(q => window.__map.jumpTo(q), POSES[poseName]);
    await page.evaluate(() => window.__ll.settle(30000));
    await page.waitForTimeout(1500);

    const LAYERS = await page.evaluate(() =>
      window.__map.getStyle().layers
        .filter(l => l.type === 'symbol')
        .filter(l => { try { return window.__map.getLayoutProperty(l.id, 'text-field') !== undefined; } catch (e) { return false; } })
        .filter(l => window.__map.getLayoutProperty(l.id, 'visibility') !== 'none')
        .map(l => l.id));

    const placed = await page.evaluate(ids => Object.fromEntries(ids.map(id => {
      let n = 0;
      try { n = window.__map.queryRenderedFeatures({ layers: [id] }).length; } catch (e) {}
      return [id, n];
    })), LAYERS);

    await page.evaluate(async () => { window.__ll.base = await window.__ll.read(); });
    for (const id of LAYERS) {
      const s = await page.evaluate(i => window.__ll.score(i), id);
      rows.push({ tod: todName, pose: poseName, layer: id, placed: placed[id], ...s });
    }
    await page.evaluate(() => { window.__ll.base = null; });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log('\n tod    pose    layer                    placed      ink     p10  median     p90');
for (const r of rows) {
  console.log(' ' + pad(r.tod, 6) + ' ' + pad(r.pose, 7) + ' ' + pad(r.layer, 24) +
    String(r.placed).padStart(6) + String(r.ink).padStart(9) +
    String(r.p10 == null ? '-' : r.p10).padStart(8) +
    String(r.contrast == null ? '-' : r.contrast).padStart(8) +
    String(r.p90 == null ? '-' : r.p90).padStart(8));
}
console.log('\ncontrast = WCAG ratio of label ink against the scene revealed behind it.');
console.log('p10 = worst-lit tenth of the word, the number a washed-out label fails. tag:', TAG);

await browser.close();
