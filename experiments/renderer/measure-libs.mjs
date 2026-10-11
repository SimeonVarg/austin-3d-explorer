/**
 * measure-libs.mjs - what the two frameworks cost to DOWNLOAD and to PARSE, from the files the page
 * names (maplibre-gl@5.24.0, three@0.159.0, pmtiles@3.0.6). No GPU, no app, no slot needed.
 *   node experiments/renderer/measure-libs.mjs
 * Parse time = from the end of the response to the script's own `load` event, which covers compile and
 * the top-level run. Min of 9 fresh loads per library, at 1x CPU and with Chrome's CPU throttled 4x and
 * 6x (what a mid-range phone is closer to). Raw, gzip -9 and brotli -9 sizes are measured off the files.
 * The libraries are fetched once into <out>/libs by hand (see the README); the page loads them from a
 * local server with no cache so every load pays the full parse.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium, launch, PRIVATE } from './lib/app.mjs';
import { startStatic } from './lib/static.mjs';

const LIBS = ['maplibre-gl.js', 'three.min.js', 'pmtiles.js'];
const dir = path.join(PRIVATE, 'libs');
const sizes = {};
for (const f of [...LIBS, 'maplibre-gl.css']) {
  const b = fs.readFileSync(path.join(dir, f));
  sizes[f] = { raw: b.length, gzip9: zlib.gzipSync(b, { level: 9 }).length, brotli9: zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length };
}
const server = await startStatic(8498);
const browser = await launch(chromium, { gl: 'swiftshader' });
const res = { sizes, parse: {}, heapMB: {} };
try {
  for (const rate of [1, 4, 6]) {
    for (const lib of LIBS) {
      const times = [];
      for (let i = 0; i < 9; i++) {
        const ctx = await browser.newContext(); const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await page.goto('http://127.0.0.1:8498/exp/proto/blank.html', { waitUntil: 'load' });
        if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        await cdp.send('Runtime.enable');
        const h0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
        const ms = await page.evaluate(src => new Promise((resolve, reject) => {
          const s = document.createElement('script'); s.src = src + '?r=' + Math.random();
          s.onload = () => { const e = performance.getEntriesByType('resource').find(x => x.name.startsWith(s.src.split('?')[0])); resolve(performance.now() - (e ? e.responseEnd : 0)); };
          s.onerror = reject; document.head.appendChild(s);
        }), `/libs/${lib}`);
        const h1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
        times.push(ms); if (rate === 1 && i === 0) res.heapMB[lib] = +((h1 - h0) / 1048576).toFixed(2);
        await ctx.close();
      }
      times.sort((a, b) => a - b);
      (res.parse[lib] ||= {})[rate + 'x'] = { minMs: +times[0].toFixed(1), medianMs: +times[4].toFixed(1) };
      console.log(`${lib.padEnd(16)} cpu x${rate}: min ${times[0].toFixed(1)} ms, median ${times[4].toFixed(1)} ms`);
    }
  }
} finally { await browser.__done(); server.close(); }
fs.writeFileSync(path.join(PRIVATE, 'libs-measure.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res.sizes), JSON.stringify(res.heapMB));
