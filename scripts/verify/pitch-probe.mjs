/**
 * pitch-probe.mjs — where is the ceiling actually, and who sets it?
 *
 * The app names 85 in two places, but neither is what binds in flight. Ask the
 * running library rather than the docs: maplibre-gl is loaded from unpkg, there
 * is no vendored copy in this repo and none in its git history, so its own hard
 * limit cannot be read off disk.
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(`${SERVER}/index.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
  const m = window.__map;
  const R = { version: (window.maplibregl && window.maplibregl.version) || 'unknown' };
  R.appMaxPitch = m.getMaxPitch();

  // How high will the LIBRARY go if we ask? Raise the ceiling, then try to set
  // pitches past it and read back what actually stuck.
  R.libraryAccepts = {};
  for (const want of [85, 88, 89, 89.9, 90, 95, 100, 120]) {
    let err = null, got = null;
    try { m.setMaxPitch(want); } catch (e) { err = String(e.message || e).slice(0, 90); }
    try {
      m.setPitch(want);
      got = +m.getPitch().toFixed(2);
    } catch (e) { err = err || String(e.message || e).slice(0, 90); }
    R.libraryAccepts[want] = { maxPitchNow: +m.getMaxPitch().toFixed(2), pitchReached: got, err };
  }
  try { m.setMaxPitch(85); m.setPitch(70); } catch (e) {}

  // What the flycam's own caps are, and where they bite.
  R.fly = {};
  try {
    const c = window.__fly.consts ? window.__fly.consts() : window.__fly.consts;
    R.fly.consts = c;
  } catch (e) { R.fly.constsErr = String(e.message || e); }
  try { R.fly.eye = window.__fly.eye(); } catch (e) {}
  return R;
});
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
browser.__done();
