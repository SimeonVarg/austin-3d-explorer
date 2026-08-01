import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
const b = await launch(chromium);
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await p.waitForTimeout(9000);
for (const pose of [
  { n: 'c3 outside low', c: [-97.73220, 30.28300], z: 18.2, pi: 79, be: 330 },
  { n: 'above',          c: [-97.73286, 30.28396], z: 16.6, pi: 52, be: 180 },
  { n: 'inside',         c: [-97.73286, 30.28396], z: 18.4, pi: 70, be: 180 },
]) {
  const r = await p.evaluate((q) => {
    const m = window.__map;
    m.jumpTo({ center: q.c, zoom: q.z, pitch: q.pi, bearing: q.be });
    const e = window.__fly.eye();
    return { lng: e.lng, lat: e.lat, alt: e.alt,
             op: m.getPaintProperty('stadium-field', 'raster-opacity'),
             hasLayer: !!m.getLayer('stadium-field') };
  }, pose);
  await p.waitForTimeout(4500);
  const after = await p.evaluate(() => window.__map.getPaintProperty('stadium-field', 'raster-opacity'));
  const cx = -97.73286, cy = 30.28396;
  const d = Math.hypot((r.lng - cx) * 111320 * Math.cos(cy * Math.PI / 180), (r.lat - cy) * 111320);
  console.log(`${pose.n.padEnd(16)} cam alt ${r.alt.toFixed(0).padStart(5)} m   dist from field ${d.toFixed(0).padStart(5)} m   opacity ${String(after)}`);
}
await b.__done();
