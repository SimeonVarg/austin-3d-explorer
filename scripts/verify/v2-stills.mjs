/**
 * v2-stills.mjs - the same still pictures from two (or more) versions of the v2 app, for a pixel-by-pixel comparison.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-stills.mjs OUT_DIR [--refs "main|."] [--phone]
 *
 * Each version gets a fresh page (?intro=0&fade=0), each view is shot after the camera is placed, every tile and the aerial ground
 * have settled (3 polls in a row) and the frame was drawn again after 1.5 s; the SECOND of two screenshots is kept (README).
 * Files: OUT_DIR/<view>__<ref>.png. Compare them with any image tool (the PR's numbers come from numpy: identical pixels, max channel
 * difference). --refs works as in v2-frame.mjs. Desktop 1440x900 at scale 2 (2880x1800); --phone 390x844 at scale 3.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'v2-stills';
fs.mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function refFolder(ref) {
  if (ref === '.') return 'v2';
  const run = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  let sha = '';
  try { sha = run('rev-parse', '--verify', '--quiet', ref + '^{commit}'); } catch (e) { sha = ''; }
  if (!sha) { run('fetch', '--depth', '1', 'origin', ref); sha = run('rev-parse', 'FETCH_HEAD'); }
  const dir = 'v2-ref-' + ref.replace(/[^A-Za-z0-9._-]+/g, '_');
  fs.rmSync(path.join(REPO, dir), { recursive: true, force: true });
  const tar = execFileSync('git', ['archive', '--format=tar', `--prefix=${dir}/`, `${sha}:v2`], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', REPO], { input: tar, maxBuffer: 1 << 30 });
  console.log(`ref ${ref} = ${sha.slice(0, 10)} -> /${dir}/`);
  return dir;
}
const REFS = arg('--refs', 'main|.').split('|').map((r) => ({ ref: r, dir: refFolder(r) }));
const ARM = process.argv.includes('--phone') ? { w: 390, h: 844, dpr: 3, mobile: true, tag: 'phone' } : { w: 1440, h: 900, dpr: 2, mobile: false, tag: 'desktop' };
const VIEWS = [
  { name: 'opening' },
  { name: 'street-guadalupe-21st', xz: [-252, 246], distance: 45, polar: 80, azimuth: 355 },
  { name: 'dkr-close', slug: 'dkr-memorial-stadium', distance: 330, polar: 58, azimuth: 235 },
  { name: 'west-campus-venue', slug: 'the-venue', distance: 380, polar: 55, azimuth: 30 },
  { name: 'dkr-2km', slug: 'dkr-memorial-stadium', distance: 2000, polar: 72, azimuth: 200 },
];
const browser = await launch(chromium, { args: [...HW_ARGS], maxMs: 1500000 });
let renderer = '';
for (const R of REFS) {
  const ctx = await browser.newContext({ viewport: { width: ARM.w, height: ARM.h }, deviceScaleFactor: ARM.dpr, isMobile: ARM.mobile, hasTouch: ARM.mobile });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE.replace(/\/$/, '')}/${R.dir}/?intro=0&fade=0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
  const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
  for (const v of VIEWS) {
    const pose = v.slug ? [man.buildings[v.slug].x, man.buildings[v.slug].z, v.distance, v.polar, v.azimuth] : v.xz ? [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth] : null;
    if (pose) await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), pose);
    else await page.evaluate(() => window.__v2.placeCamera(window.__v2.VIEW.START));
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 180000) {
      const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground && window.__v2ground.stats(); return { t: window.__v2.tiles(), g }; });
      const groundCalm = !s.g || s.g.failed || (s.g.index && s.g.missing === 0 && s.g.loading === 0 && s.g.waitingUpload === 0);
      calm = s.t && s.t.loading === 0 && groundCalm ? calm + 1 : 0; await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__v2.redraw());
    await page.waitForTimeout(300);
    const file = path.join(OUT, `${ARM.tag}-${v.name}__${R.ref.replace(/[^A-Za-z0-9._-]+/g, '_')}.png`);
    await page.screenshot({ path: file });
    await page.waitForTimeout(300);
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => window.__v2.info());
    console.log(`${R.ref} ${v.name}: ${file} canvas ${info.size.join('x')} calls ${info.calls} tris ${info.triangles}${info.shadow ? ` shadow redraws ${info.shadow.redraws}/${info.shadow.frames} culled ${info.shadow.culled}` : ''}`);
  }
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
console.log(`renderer: ${renderer}`);
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
