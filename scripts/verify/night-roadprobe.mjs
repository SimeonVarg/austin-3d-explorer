/**
 * night-roadprobe.mjs — one-off: what does querySourceFeatures return for the
 * basemap transportation layer at spawn? Source name, classes, counts, and the
 * bbox of the buildings data (the streetlight fence).
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => new Promise(res => window.__map.once('idle', res)));

const r = await page.evaluate(() => {
  const m = window.__map;
  const style = m.getStyle();
  const vecSources = Object.entries(style.sources).filter(([, s]) => s.type === 'vector').map(([id]) => id);
  const out = { vecSources };
  for (const src of vecSources) {
    const feats = m.querySourceFeatures(src, { sourceLayer: 'transportation' });
    const byClass = {};
    for (const f of feats) {
      const c = f.properties.class || '?';
      byClass[c] = (byClass[c] || 0) + 1;
    }
    out[src] = { total: feats.length, byClass };
    const one = feats.find(f => f.properties.class === 'primary') || feats[0];
    if (one) out.sampleProps = one.properties;
  }
  const bs = m.getSource('austin-buildings');
  const data = bs && bs._data;
  if (data && data.features) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const f of data.features) {
      const walk = cs => { for (const c of cs) { if (typeof c[0] === 'number') { if (c[0]<w)w=c[0]; if (c[0]>e)e=c[0]; if (c[1]<s)s=c[1]; if (c[1]>n)n=c[1]; } else walk(c); } };
      if (f.geometry) walk(f.geometry.coordinates);
    }
    out.buildingsBbox = { w, s, e, n };
    out.buildingsCount = data.features.length;
  } else {
    out.buildingsBbox = null;
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
