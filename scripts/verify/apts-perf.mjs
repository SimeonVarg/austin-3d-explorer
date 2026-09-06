/**
 * apts-perf.mjs — what do js/slopes-apartments.js and js/slopes-art.js cost?
 *
 * ONE PAGE, the two generators toggled at runtime, interleaved A/B/B/A, warm-up
 * reps discarded, the MINIMUM of the per-rep medians reported — every one of
 * those is a rule scripts/verify/arts-perf.mjs paid for and its header explains.
 * Headed and on the real GPU, vsync and the occlusion throttles off, because a
 * timing run on SwiftShader measures fill rate and a throttled window measures
 * the window manager.
 *
 *   VERIFY_URL=http://127.0.0.1:8471 node scripts/verify/apts-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch, HW_ARGS, MARK_ARG } from './chrome.mjs';

const REPS = Number(process.argv[2] || 3);
const FRAMES = 200;
const WARMUP = 2;

const POSES = {
  'standard-sw': { center: [-97.74578, 30.28699], zoom: 18.66, pitch: 55, bearing: 45 },
  'mall-cruise': { center: [-97.7393, 30.2856], zoom: 17.48, pitch: 55, bearing: 0 },
};

const browser = await launch(chromium, {
  headless: false,
  maxMs: 1800000,
  args: [
    ...HW_ARGS,
    '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
    MARK_ARG,
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();
await page.goto(`${SERVER}/index.html?intro=0&drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 240000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => { if (window.GFX) window.GFX.autoExposure = false; });
await page.waitForTimeout(25000);        // both generators must have built once

const gpu = await page.evaluate(() => {
  const gl = window.__map.getCanvas().getContext('webgl2') || window.__map.getCanvas().getContext('webgl');
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), preset: window.GFX && window.GFX.preset };
});
const built = await page.evaluate(() => ({
  apts: !!(window.slopes && window.slopes.debugGroup && window.slopes.root),
  groups: (window.slopes && window.slopes.root ? window.slopes.root.children : []).map(c => c.name),
}));
console.log('GPU:', gpu.renderer, '| graphics preset:', gpu.preset, '| groups:', built.groups.join(' '));

async function run(on, pose) {
  await page.evaluate(({ on, pose }) => {
    window.APARTMENTS.on = on; window.ART3D.on = on;
    window.applySlopesApartments && window.applySlopesApartments(window.__map);
    window.applySlopesArt && window.applySlopesArt(window.__map);
    window.__map.jumpTo(Object.assign({}, pose));
  }, { on, pose });
  await page.waitForTimeout(2500);
  // PROVE THE TOGGLE DID SOMETHING, or a 0.00 ms delta means nothing.
  const tris = await page.evaluate(() => {
    let t = 0, groups = [];
    for (const g of (window.slopes && window.slopes.root ? window.slopes.root.children : [])) {
      if (g.name !== 'slopes-apartments' && g.name !== 'slopes-art') continue;
      groups.push(g.name);
      g.traverse(o => { if (o.geometry && o.geometry.index) t += o.geometry.index.count / 3; else if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) t += o.geometry.attributes.position.count / 3; });
    }
    return { tris: Math.round(t), groups: groups.join('+') || 'none' };
  });
  console.log(`   ${on ? 'ON ' : 'OFF'} at this rep: ${tris.tris} triangles in [${tris.groups}]`);
  return page.evaluate(async ({ n, pose }) => {
    const m = window.__map, dts = [];
    let last = performance.now(), b = pose.bearing || 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.35;
        m.jumpTo(Object.assign({}, pose, { bearing: b }));
        if (dts.length < n) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const d = dts.slice(5).sort((x, y) => x - y);      // the first frames after a jumpTo carry tile work
    return {
      frames: dts.length,
      p50: +d[d.length >> 1].toFixed(2),
      p90: +d[Math.floor(d.length * 0.9)].toFixed(2),
    };
  }, { n: FRAMES, pose });
}

const out = {};
for (const [name, pose] of Object.entries(POSES)) {
  out[name] = { on: [], off: [] };
  for (let r = 0; r < WARMUP; r++) for (const k of [true, false]) await run(k, pose);
  for (let r = 0; r < REPS; r++) {
    for (const on of (r % 2 ? [false, true] : [true, false])) {
      out[name][on ? 'on' : 'off'].push(await run(on, pose));
    }
  }
}
console.log('\n' + FRAMES + ' frames per rep, ' + REPS + ' reps interleaved after ' + WARMUP + ' discarded warm-ups; MIN of the per-rep medians.');
for (const [name, r] of Object.entries(out)) {
  const on50 = Math.min(...r.on.map(x => x.p50)), off50 = Math.min(...r.off.map(x => x.p50));
  const on90 = Math.min(...r.on.map(x => x.p90)), off90 = Math.min(...r.off.map(x => x.p90));
  console.log(`${name.padEnd(13)} ON  p50 ${on50.toFixed(2)} ms  p90 ${on90.toFixed(2)} ms   [${r.on.map(x => x.p50).join(', ')}]`);
  console.log(`${name.padEnd(13)} OFF p50 ${off50.toFixed(2)} ms  p90 ${off90.toFixed(2)} ms   [${r.off.map(x => x.p50).join(', ')}]`);
  console.log(`${name.padEnd(13)} DELTA ${(on50 - off50 >= 0 ? '+' : '')}${(on50 - off50).toFixed(2)} ms at p50, ${(on90 - off90 >= 0 ? '+' : '')}${(on90 - off90).toFixed(2)} ms at p90\n`);
}
await browser.__done();
