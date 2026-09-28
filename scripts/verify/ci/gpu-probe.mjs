/**
 * ci/gpu-probe.mjs — what graphics does Chrome get on this machine, and how
 * fast does the city draw with it?
 *
 * A probe, not a check. For each launch mode it records the WebGL renderer
 * string, then loads the real app (index.html, ?intro=0&drift=0) and counts
 * how many frames MapLibre actually renders in 15 s at the spawn view with a
 * repaint requested every frame. The last mode's frame is kept as a screenshot.
 *
 * It runs on the macOS runner (does full Chrome get a real GPU there?) and on
 * the Linux runner (how slow is SwiftShader on 4 cores?), so the two numbers
 * sit side by side in the PR comment. Exit 0 unless Chrome would not launch
 * in any mode.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8442 node scripts/verify/ci/gpu-probe.mjs --out DIR [--modes hw,headed,swiftshader]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, GL_ARGS, HW_ARGS, BASE } from '../chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(opt('--out', 'gpu-probe'));
const WANT = opt('--modes', 'headed,hw,swiftshader').split(',');
const FPS_WINDOW_MS = 15000;
fs.mkdirSync(OUT, { recursive: true });

const MODES = {
  headed: { mode: 'full Chrome, headed, hardware flags', opts: { headless: false, args: HW_ARGS } },
  hw: { mode: 'headless, hardware flags', opts: { gl: 'hardware' } },
  swiftshader: { mode: 'headless, SwiftShader (the suite default)', opts: { args: GL_ARGS } },
};

const report = { platform: process.platform, arch: process.arch, cpus: (await import('node:os')).cpus().length, modes: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'gpu-probe.json'), JSON.stringify(report, null, 1));

for (const key of WANT) {
  const m = MODES[key];
  if (!m) continue;
  const row = { mode: m.mode };
  report.modes.push(row);
  let browser;
  try {
    browser = await launch(chromium, { ...m.opts, maxMs: 420000 });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto('about:blank');
    Object.assign(row, await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return { renderer: 'NO WEBGL2' };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    }));
    const t0 = Date.now();
    await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
    await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
    await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) r(); else m.once('idle', r); setTimeout(r, 120000); }));
    row.loadSecs = Math.round((Date.now() - t0) / 1000);
    row.fps = await page.evaluate(ms => new Promise(resolve => {
      const m = window.__map; let n = 0;
      const onRender = () => { n++; m.triggerRepaint(); };
      m.on('render', onRender);
      m.triggerRepaint();
      const t0 = performance.now();
      setTimeout(() => { m.off('render', onRender); resolve(+(n / ((performance.now() - t0) / 1000)).toFixed(2)); }, ms);
    }), FPS_WINDOW_MS);
    await page.screenshot({ path: path.join(OUT, `app-${key}.png`), timeout: 180000 });
  } catch (e) {
    row.error = String(e.message || e).split('\n')[0];
  } finally {
    try { await browser?.__done(); } catch (e) {}
  }
  console.log(JSON.stringify(row));
  save();
}
save();
process.exitCode = report.modes.length && report.modes.every(m => m.error && !m.renderer) ? 1 : 0;
