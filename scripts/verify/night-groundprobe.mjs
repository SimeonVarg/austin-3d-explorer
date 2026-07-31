/**
 * night-groundprobe.mjs — what IS the flat value the night ground plane sits at?
 *
 * night-luma.mjs reports a ground median of exactly 33.64 at three different
 * poses, which means one colour dominates the plane. `#090b12` (the night
 * `ground` preset) has a luma of 10.5, so it is NOT that, and a fix aimed at
 * the wrong preset field would move nothing. Find the modal colour and which
 * layer owns it before changing a value.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(6000);

const r = await page.evaluate(async () => {
  const m = window.__map, cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const W = cv.width, H = cv.height, N = W * H;
  // Look almost straight down so the frame is nearly all ground plane.
  m.jumpTo({ center: [-97.7415, 30.2865], zoom: 16.2, pitch: 20, bearing: 30 });
  window.applyTimeOfDay(m, 0.92, true);
  for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => { if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000); });

  const hideables = m.getStyle().layers
    .filter(l => l.type === 'fill-extrusion' || /^trees-/.test(l.id))
    .map(l => l.id);
  for (const id of hideables) { try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }
  for (let i = 0; i < 24; i++) await new Promise(r => requestAnimationFrame(r));

  const buf = new Uint8Array(N * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const hist = new Map();
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const k = `${buf[j]},${buf[j + 1]},${buf[j + 2]}`;
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([k, n]) => {
      const [R, G, B] = k.split(',').map(Number);
      return { rgb: k, share: +(100 * n / N).toFixed(2), luma: +(0.2126 * R + 0.7152 * G + 0.0722 * B).toFixed(1) };
    });

  // Which style layers are still visible and could own those pixels?
  const visible = m.getStyle().layers
    .filter(l => l.layout?.visibility !== 'none' && hideables.indexOf(l.id) === -1)
    .map(l => ({ id: l.id, type: l.type,
                 color: (l.paint || {})['fill-color'] || (l.paint || {})['line-color'] ||
                        (l.paint || {})['background-color'] || (l.paint || {})['circle-color'] }));
  return { top, visible: visible.filter(v => v.type !== 'symbol') };
});

console.log('Top flat colours over the near-nadir night ground plane:');
for (const t of r.top) console.log(`   rgb(${t.rgb.padEnd(12)}) luma ${String(t.luma).padStart(6)}   ${t.share}% of frame`);
console.log('\nStill-visible non-symbol layers and their painted colour:');
for (const v of r.visible) console.log(`   ${v.id.padEnd(34)} ${v.type.padEnd(16)} ${JSON.stringify(v.color)}`);
await browser.close();
