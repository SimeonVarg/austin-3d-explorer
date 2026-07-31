/**
 * skycolour.mjs — what colour is the sky, actually?
 *
 * "Too deep blue, like I'm in space" is a claim about pixels, so read the pixels
 * rather than reasoning about the hex values in the preset. Samples a vertical
 * column of the sky at several times of day and pitches, and reports the rendered
 * RGB plus HSL — saturation and lightness are what the complaint is really about.
 *
 * Uses _harness.html because gl.readPixels only returns non-black with
 * preserveDrawingBuffer, which only the harness page forces.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(5000);

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l * 100];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

// Pitch up so there is real sky in frame: at pitch 64 with a 58 deg FOV only
// +3 deg of sky is visible, which is not enough of a column to judge a gradient.
for (const pitch of [80, 72]) {
  for (const p of [0.05, 0.12, 0.30]) {
    const rows = await page.evaluate(async ({ pitch, p }) => {
      const m = window.__map;
      m.jumpTo({ pitch, bearing: 90 });
      window.applyTimeOfDay(m, p, true);
      await new Promise(r => setTimeout(r, 900));
      m.triggerRepaint();
      await new Promise(r => setTimeout(r, 500));

      const cv = m.getCanvas();
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      const W = cv.width, H = cv.height;
      // transform.horizonLineFromTop() returned 0 at every pitch here, which
      // collapsed the whole sampling column onto row 0 — five identical readings
      // that looked like a flat sky. Use the closed form instead: MapLibre pitch
      // is from straight down, so the horizon sits (90 - pitch) above the axis.
      const rad = d => d * Math.PI / 180;
      const fov = m.getVerticalFieldOfView();
      const off = Math.tan(rad(90 - m.getPitch())) / Math.tan(rad(fov / 2));
      const hzCss = (0.5 - 0.5 * off) * cv.clientHeight;
      const scale = H / cv.clientHeight;
      const hz = hzCss * scale;

      const out = [];
      // Fractions of the visible sky band, top of frame down to the horizon.
      for (const f of [0.02, 0.25, 0.5, 0.75, 0.95]) {
        const y = Math.round(f * hz);
        const px = new Uint8Array(4);
        // readPixels is bottom-up.
        gl.readPixels(Math.round(W / 2), H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push({ f, y: Math.round(y / scale), rgb: [px[0], px[1], px[2]] });
      }
      return { hzCss: Math.round(hzCss), rows: out };
    }, { pitch, p });

    console.log(`\npitch ${pitch}  p=${p}  horizon at y=${rows.hzCss} css px of 800`);
    for (const r of rows.rows) {
      const [h, s, l] = hsl(...r.rgb);
      const hex = '#' + r.rgb.map(v => v.toString(16).padStart(2, '0')).join('');
      console.log(`   ${(r.f * 100).toFixed(0).padStart(3)}% down  y=${String(r.y).padStart(3)}  ${hex}` +
        `  rgb(${r.rgb.join(',')})   H ${h.toFixed(0).padStart(3)}  S ${s.toFixed(0).padStart(3)}%  L ${l.toFixed(0).padStart(3)}%`);
    }
  }
}

console.log('\nReference: a real clear midday sky reads roughly S 35-55% / L 55-75% near the');
console.log('zenith and pales to S 15-25% / L 80-88% at the horizon. S above ~60% with');
console.log('L below ~45% is the "outer space" look.');

await browser.__done();
