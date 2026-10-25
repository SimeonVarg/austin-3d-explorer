// node gen.mjs [--preview] [--only a,b] : serves this folder, opens gen.html in Chrome, collects POSTed outputs into ./out
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.TREES_OUT || path.join(HERE, '..', '..', 'v2', 'data', 'trees-real'); fs.mkdirSync(OUT, { recursive: true });
const preview = process.argv.includes('--preview');
const onlyI = process.argv.indexOf('--only'); const only = onlyI > 0 ? process.argv[onlyI + 1] : '';
const P = JSON.parse(fs.readFileSync(path.join(HERE, 'photo_colours.json'), 'utf8'));
// which photograph region each species form takes its colour from (sampled median of the masked pixels: sample.py)
const MAP = {
  live_oak:     { leaf: 'live_oak_street', trunk: 'trunk_street_oak' },
  cedar_elm:    { leaf: 'dark_backlit', trunk: 'trunk_street_oak', note: 'IMG_1778 bottom-right crown (the dark backlit deciduous tree)' },
  pecan:        { leaf: 'sunlit_leafy', trunk: 'trunk_street_oak', note: 'IMG_1779 sunlit leafy tree by the library' },
  crape_myrtle: { leaf: 'sunlit_leafy', trunk: 'trunk_street_oak', note: 'borrowed from IMG_1779: no crape myrtle in the photographs' },
  bald_cypress: { leaf: 'live_oak_lake', trunk: 'trunk_juniper', note: 'borrowed from the lake-side crowns of IMG_1762: no bald cypress in the photographs' },
  ashe_juniper: { leaf: 'juniper_slope', trunk: 'trunk_juniper' },
};
const colours = {};
for (const [sp, m] of Object.entries(MAP)) {
  const L = P[m.leaf], T = P[m.trunk];
  colours[sp] = { leaf: { shaded: L.shaded, mid: L.mid, sunlit: L.sunlit }, trunk: T.mid, source: { leaf: `IMG_${L.photo} ${m.leaf}`, trunk: `IMG_${T.photo} ${m.trunk}`, note: m.note || '' } };
}
fs.writeFileSync(path.join(HERE, 'colours.json'), JSON.stringify(colours));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.map': 'application/json' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && u.startsWith('/save/')) {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { fs.writeFileSync(path.join(OUT, path.basename(u)), Buffer.concat(chunks)); res.end('ok'); }); return;
  }
  const f = path.join(HERE, u === '/' ? 'gen.html' : u);
  if (!f.startsWith(HERE) || !fs.existsSync(f)) { res.statusCode = 404; res.end('no'); return; }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 700, height: 1700 } });
page.on('console', (m) => console.log('[page]', m.text())); page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/gen.html?preview=${preview ? 1 : 0}&only=${only}`);
await page.waitForFunction(() => window.__done, null, { timeout: 600000 });
console.log((await page.evaluate(() => window.__done)).join('\n'));
if (preview) await page.screenshot({ path: path.join(HERE, 'preview.png'), fullPage: true });
await browser.close(); srv.close();
