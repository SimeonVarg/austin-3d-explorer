/**
 * moody-roofprobe.mjs — WHICH layer draws Moody Center's roof, before and after?
 *
 * This exists because a claim in this pass was wrong and the screenshots caught
 * it. The snapshot paints Moody's roof `rd` = #434347, luma 67, and
 * data/roof_survey.json measures the real membrane at [255,255,253] — so
 * "the roof renders as a dark lid" looked like a safe headline. It is not:
 * measured off matched before/after frames the roof went luma 200.6 -> 192.6.
 * It was already pale before this pass touched anything.
 *
 * A wrong attribution is worse than no attribution, so this answers it by
 * POSITIVE IDENTIFICATION rather than by reasoning about the style: hide
 * everything, show exactly one candidate layer, and see whether a big bright
 * shape appears where Moody Center is. The background layer is hidden too, so
 * MapLibre clears to transparent and alpha alone says "this is that layer".
 *
 * Usage: node moody-roofprobe.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const POSE = { center: [-97.731845, 30.280934], zoom: 16.6, pitch: 68, bearing: 90 };
// The Moody roof in this pose, in canvas pixels, read off the rendered frame.
const ROI = [640, 330, 800, 400];

const browser = await launch(chromium);

async function probe(label, query, layers) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(SERVER + '/_harness.html?intro=0&drift=0' + query,
                  { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.evaluate((POSE) => {
    const m = window.__map;
    // The post stack would bloom and tone-map whatever is left visible, which is
    // fine for a screenshot and wrong for attributing a colour.
    Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
    window.applyGraphics();
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo(POSE);
    window.applyTimeOfDay(m, 0.25, true);
  }, POSE);
  await page.waitForTimeout(4000);
  await page.evaluate(async () => {
    const m = window.__map;
    const t0 = performance.now();
    while (performance.now() - t0 < 30000) {
      try { if (m.areTilesLoaded() && m.querySourceFeatures('austin-buildings').length > 150) break; }
      catch (e) {}
      await new Promise(r => setTimeout(r, 400));
    }
  });

  console.log('\n' + label);
  for (const only of layers) {
    const r = await page.evaluate(async ([only, ROI]) => {
      const m = window.__map;
      for (const l of m.getStyle().layers) {
        try { m.setLayoutProperty(l.id, 'visibility', l.id.startsWith(only) ? 'visible' : 'none'); } catch (e) {}
      }
      m.triggerRepaint();
      await new Promise(r => setTimeout(r, 1400));
      const cv = m.getCanvas();
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      const w = cv.width, h = cv.height;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // readPixels row 0 is the BOTTOM of the canvas; the ROI is in top-down
      // screen coordinates, so flip it. Getting this wrong samples the sky and
      // reports "the layer draws nothing here", which is a very convincing lie.
      const [x0, yTop, x1, yBot] = ROI;
      let n = 0, sr = 0, sg = 0, sb = 0;
      for (let y = h - yBot; y < h - yTop; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          if (buf[i + 3] < 128) continue;
          n++; sr += buf[i]; sg += buf[i + 1]; sb += buf[i + 2];
        }
      }
      const area = (x1 - x0) * (yBot - yTop);
      return { fill: n / area, r: n ? sr / n : 0, g: n ? sg / n : 0, b: n ? sb / n : 0 };
    }, [only, ROI]);
    const lum = 0.30 * r.r + 0.59 * r.g + 0.11 * r.b;
    console.log('  ' + only.padEnd(18) +
      'covers ' + (r.fill * 100).toFixed(0).padStart(3) + '% of the Moody roof box' +
      (r.fill > 0.05
        ? '   #' + [r.r, r.g, r.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') +
          '  luma ' + lum.toFixed(1)
        : ''));
  }
  await page.close();
}

await probe('BEFORE (?moody=0) — which layer is the pale roof?', '&moody=0',
            ['buildings-roof', 'buildings-3d', 'roofscape-', 'roofs-pitched']);
await probe('AFTER (?moody=1)', '&moody=1',
            ['moody-cap', 'moody-roof', 'moody-wall', 'roofscape-']);
await browser.__done();
