/**
 * zfight.mjs — find surfaces that FLICKER as the camera moves.
 *
 * Z-fighting is invisible in a screenshot. Two coplanar faces resolve to one of
 * them for any given frame and look perfectly fine; the defect only exists in
 * the DIFFERENCE between frames, which is why "the roof is glitching while I
 * move" cannot be reproduced by taking a picture and staring at it. Every
 * z-fight this repo has shipped was reported by a human flying the camera and
 * missed by the screenshot suite.
 *
 * The test: render three frames while the camera moves STEADILY — zoom z,
 * z+d, z+2d — and look for pixels that go A, B, A. Real geometry under a
 * monotonic camera change is monotonic too: a surface gets a little brighter,
 * an edge creeps one pixel and then another. It does not jump away and come
 * straight back. A depth-buffer tie does exactly that, because which surface
 * wins is decided by rounding that has no relationship to the camera's
 * direction of travel.
 *
 * So the signature is: |f0 - f2| small AND |f0 - f1| large.
 *
 * THE STEP MUST BE MONOTONIC AND THAT IS THE WHOLE TEST. The first cut of this
 * file put frames 0 and 2 at the SAME pose and only frame 1 elsewhere, which
 * makes |f0 - f2| identically zero and flags every pixel any edge moved across
 * — it lit up every building edge, every tree and every kerb in the frame and
 * reported the entire city as z-fighting. A null result from a broken
 * discriminator looks exactly like a clean scene, so this is asserted below.
 *
 * Edge pixels are also excluded outright: a z-fight is a large FLAT surface
 * flickering, while a one-pixel edge straddling two colours flips for ordinary
 * rasterisation reasons at any sub-pixel camera step. Requiring the pixel's 3x3
 * neighbourhood in frame 0 to be flat removes that entire false-positive class.
 * Screen-space clusters of what survives are reported with a bounding box and a
 * mask PNG, and the caller maps the box back to a building.
 *
 * The reduction happens in the page — handing three 1440x900 framebuffers back
 * through CDP is the twenty-minute, 2 GB mistake in this directory's README.
 *
 * Usage: node zfight.mjs <shots.json> [outPrefix]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3] || 'zf';
const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(9000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.evaluate(() => {
  window.__zf = (function () {
    let cv = null, cx = null;
    const f = [];
    function grab(i) {
      const gl = window.__map.getCanvas();
      if (!cv) {
        cv = document.createElement('canvas');
        cv.width = gl.width; cv.height = gl.height;
        cx = cv.getContext('2d', { willReadFrequently: true });
      }
      cx.drawImage(gl, 0, 0);
      f[i] = cx.getImageData(0, 0, cv.width, cv.height).data;
    }
    /**
     * A-B-A detection, then 8-connected clustering of the flagged pixels so the
     * answer is "one flickering roof" rather than 40,000 loose pixels.
     */
    function scan(sameTol, flipTol, minCluster, flatTol) {
      const [a, b, c] = f, W = cv.width, H = cv.height;
      const flag = new Uint8Array(W * H);
      let n = 0, moved = 0;
      const lum = (buf, i) => (buf[i] * 299 + buf[i + 1] * 587 + buf[i + 2] * 114) / 1000;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const p = y * W + x, i = p * 4;
          const ac = Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]);
          const ab = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (ab >= flipTol) moved++;   // how much of the frame moved AT ALL
          if (ac > sameTol) continue;
          if (ab < flipTol) continue;
          // Flat-neighbourhood gate: a z-fight is a surface, not an edge.
          const l0 = lum(a, i);
          let flat = true;
          for (let dy = -1; dy <= 1 && flat; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (Math.abs(lum(a, ((y + dy) * W + (x + dx)) * 4) - l0) > flatTol) { flat = false; break; }
            }
          if (!flat) continue;
          flag[p] = 1; n++;
        }
      }
      // The guard on the discriminator itself. If almost nothing in the frame
      // changed between f0 and f1, the camera did not actually move and every
      // "no flicker" result below is vacuous.
      const movedPct = (moved / (W * H)) * 100;
      // cluster
      const seen = new Uint8Array(W * H), out = [], stack = [];
      for (let p0 = 0; p0 < W * H; p0++) {
        if (!flag[p0] || seen[p0]) continue;
        stack.length = 0; stack.push(p0); seen[p0] = 1;
        let cnt = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        while (stack.length) {
          const p = stack.pop(); cnt++;
          const x = p % W, y = (p / W) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (flag[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
          }
        }
        if (cnt >= minCluster) out.push({ n: cnt, box: [x0, y0, x1, y1] });
      }
      out.sort((u, v) => v.n - u.n);
      // paint the mask over frame A so the report can be looked at
      const img = cx.createImageData(W, H);
      for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        img.data[i] = flag[p] ? 255 : a[i] >> 2;
        img.data[i + 1] = flag[p] ? 0 : a[i + 1] >> 2;
        img.data[i + 2] = flag[p] ? 255 : a[i + 2] >> 2;
        img.data[i + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      return { flagged: n, total: W * H, movedPct, clusters: out.slice(0, 12), mask: cv.toDataURL('image/png') };
    }
    return { grab, scan };
  })();
});

async function settle(ms) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(700);
}

console.log('pose                     moved   flicker   clusters (px @ screen box)');
for (const s of SHOTS) {
  // Three poses along a STEADY zoom-in. The step is small enough that no real
  // edge travels more than a pixel or two, and monotonic so that anything that
  // goes there-and-back is not the camera.
  const D = s.dz != null ? s.dz : 0.003;
  for (let k = 0; k < 3; k++) {
    await page.evaluate(({ s, k, D }) => {
      const m = window.__map;
      if (s.gfx && window.GFX && window.GFX_PRESETS[s.gfx]) {
        Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]); window.applyGraphics();
      }
      if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: s.center, zoom: s.zoom + k * D, pitch: s.pitch, bearing: s.bearing });
      if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
    }, { s, k, D });
    await settle(k === 0 ? 4000 : 1800);
    await page.evaluate((k) => window.__zf.grab(k), k);
  }
  const r = await page.evaluate(() => window.__zf.scan(14, 30, 220, 6));
  const pct = ((r.flagged / r.total) * 100).toFixed(3);
  console.log(
    s.name.padEnd(24) + (r.movedPct.toFixed(1) + '%').padStart(7) +
    (pct + '%').padStart(9) + '   ' +
    (r.movedPct < 1
      ? 'INVALID: the camera barely moved, this result means nothing'
      : r.clusters.length
        ? r.clusters.map(c => `${c.n}@[${c.box.join(',')}]`).join('  ')
        : '(none)')
  );
  if (r.clusters.length) {
    fs.writeFileSync(path.join(outDir, `${OUT}-${s.name}-flicker.png`),
                     Buffer.from(r.mask.split(',')[1], 'base64'));
  }
}
await browser.close();
