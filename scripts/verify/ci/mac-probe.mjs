/**
 * ci/mac-probe.mjs — what graphics does full Chrome get on a GitHub macOS runner?
 *
 * A probe, not a check: it asks WebGL for its renderer string in three launch
 * modes and takes one screenshot of the city with the hardware path. If the
 * answer is a real Apple GPU, hardware-only checks (the ones quarantined for
 * "needs a GPU") have somewhere to run. It always exits 0 unless it could not
 * launch Chrome at all.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8442 node scripts/verify/ci/mac-probe.mjs --out DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, GL_ARGS, HW_ARGS, BASE } from '../chrome.mjs';

const argv = process.argv.slice(2);
const OUT = path.resolve(argv[argv.indexOf('--out') + 1] || 'mac-probe');
fs.mkdirSync(OUT, { recursive: true });

const RENDERER = () => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { renderer: 'NO WEBGL' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    version: gl.getParameter(gl.VERSION),
  };
};

const MODES = [
  { mode: 'full Chrome, headed, default GPU flags', opts: { headless: false, args: HW_ARGS } },
  { mode: 'headless, hardware flags', opts: { gl: 'hardware' } },
  { mode: 'headless, SwiftShader (the suite default)', opts: { args: GL_ARGS } },
];

const report = { platform: process.platform, arch: process.arch, modes: [] };
for (const m of MODES) {
  let browser;
  try {
    browser = await launch(chromium, { ...m.opts, maxMs: 120000 });
    const page = await browser.newPage();
    await page.goto('about:blank');
    report.modes.push({ mode: m.mode, ...(await page.evaluate(RENDERER)) });
  } catch (e) {
    report.modes.push({ mode: m.mode, error: String(e.message || e).split('\n')[0] });
  } finally {
    try { await browser?.__done(); } catch (e) {}
  }
  console.log(JSON.stringify(report.modes.at(-1)));
}

// One picture of the real app on the hardware path.
let browser;
try {
  browser = await launch(chromium, { headless: false, args: HW_ARGS, maxMs: 300000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const t0 = Date.now();
  await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) r(); else m.once('idle', r); setTimeout(r, 60000); }));
  await page.waitForTimeout(5000);
  report.appLoadSecs = Math.round((Date.now() - t0) / 1000);
  report.appRenderer = await page.evaluate(() => {
    const gl = window.__map.painter?.context?.gl || window.__map.getCanvas().getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'unknown';
  });
  await page.screenshot({ path: path.join(OUT, 'mac-app.png') });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'mac-app.png') });
} catch (e) {
  report.appError = String(e.message || e).split('\n')[0];
} finally {
  try { await browser?.__done(); } catch (e) {}
}
fs.writeFileSync(path.join(OUT, 'mac-probe.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exitCode = report.modes.every(m => m.error) ? 1 : 0;
