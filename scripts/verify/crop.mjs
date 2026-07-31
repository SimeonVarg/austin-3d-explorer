/**
 * crop.mjs — magnify a region of a shot so a defect can actually be SEEN.
 *
 * A 1440x900 frame of a whole campus puts a 12 m roof feature in about 40 px.
 * "Is that roof z-fighting or is that a plant screen?" is not answerable at
 * that size, and answering it by reasoning instead of looking is how this repo
 * ships defects. Nearest-neighbour, so no interpolation invents structure.
 *
 * The source must be an http URL, not a path: a page built with setContent has
 * an opaque origin and the browser refuses to read a file:// image into a
 * canvas from it. The repo is already being served for the rest of the suite,
 * so pass e.g. $VERIFY_URL/scripts/verify/shots/foo.png — a bare path is
 * resolved against VERIFY_URL for convenience.
 *
 * Usage: node crop.mjs <in.png|url> <x> <y> <w> <h> <out.png> [scale=3]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import path from 'node:path';

const [, , file, X, Y, W, H, out, scaleArg] = process.argv;
const S = Number(scaleArg || 3);
const url = /^https?:/.test(file)
  ? file
  : SERVER + '/' + path.relative(path.resolve('../..'), path.resolve(file)).split(path.sep).join('/');

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Math.round(W * S), height: Math.round(H * S) } });
await page.setContent(
  `<body style="margin:0;background:#000">
   <canvas id="c" width="${Math.round(W * S)}" height="${Math.round(H * S)}"></canvas>
   <script>
     const im = new Image();
     im.onload = () => {
       const cx = document.getElementById('c').getContext('2d');
       cx.imageSmoothingEnabled = false;
       cx.drawImage(im, ${X}, ${Y}, ${W}, ${H}, 0, 0, ${Math.round(W * S)}, ${Math.round(H * S)});
       document.title = 'ok';
     };
     im.onerror = () => { document.title = 'err'; };
     im.src = ${JSON.stringify(url)};
   </script></body>`);
await page.waitForFunction(() => document.title === 'ok' || document.title === 'err', null, { timeout: 30000 });
if (await page.title() === 'err') { console.error('could not load', url); process.exit(1); }
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
