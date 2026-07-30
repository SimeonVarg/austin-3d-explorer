/**
 * night-debug.mjs — one-off: what does the facade atlas actually contain at
 * p=0.66, and does updateFacades run? Reads the registered style image bytes
 * before and after the call — no rendering in the loop, no tile-rebuild lag.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('console', m => console.log('[page]', m.type(), m.text()));
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const r = await page.evaluate(async () => {
  const m = window.__map;
  const getImg = (id) => {
    const im = m.style && m.style.imageManager ? m.style.imageManager.getImage(id) : null;
    if (!im || !im.data || !im.data.data) return null;
    const d = im.data.data; // RGBA bytes, 64x64
    const px = (x, y) => { const i = (y * 64 + x) * 4; return [d[i], d[i+1], d[i+2]]; };
    return { corner: px(1, 1), mid: px(32, 32) };
  };
  const out = {};
  out.sunElev66 = window.skyBodies ? window.skyBodies(0.66).sun.elev : 'no skyBodies';
  out.before = getImg('md00');
  window.applyTimeOfDay(m, 0.66, true);
  await new Promise(res => setTimeout(res, 500));
  out.after66 = getImg('md00');
  window.applyTimeOfDay(m, 0.95, true);
  await new Promise(res => setTimeout(res, 500));
  out.after95 = getImg('md00');
  out.hasUpdateFacades = typeof window.updateFacades;
  out.debugActive = !!window.__debugActive;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
