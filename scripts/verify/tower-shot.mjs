/**
 * tower-shot.mjs — screenshots of the UT Tower pass, before and after, in one run.
 *
 * shot.mjs cannot do the "before" half: it hard-codes the harness URL, and the
 * only honest before/after on a single build is `?tower=0`, which switches the
 * pass off at load. Two browser sessions in one script also means both halves
 * see the same machine, the same fonts and the same swiftshader.
 *
 * Usage: node tower-shot.mjs [prefix] [before|after|both]
 *
 * Traps this file already pays for, all from scripts/verify/README.md:
 *   - the harness URL MUST carry ?intro=0&drift=0, or the first frame of every
 *     list is the intro's end pose rather than the pose asked for;
 *   - cancelGraphicsAutoDetect(), which otherwise rewrites every setting 11 s in;
 *   - settle, triggerRepaint, and screenshot TWICE — a data-driven paint
 *     expression and a regenerated pattern atlas do not land in the same frame
 *     as the call, and the first frame after a time-of-day jump can still show
 *     the previous state.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = process.argv[2] || 'tower';
const WHICH = process.argv[3] || 'both';

// The Main Building's footprint centroid, from the snapshot.
const C = [-97.739325, 30.286015];

// Framing note, learned by rendering the first list and looking at it: a high
// pitch pushes the `center` a long way out in front of the camera, so a pose at
// pitch 74 with the centre placed SOUTH of the building put the tower up near
// the horizon at 90 px tall. `center` is the point at screen centre, and the
// tower's base wants to BE that point. Pitch stays in the 60-66 band the flying
// camera actually uses.
const SHOTS = [
  // The South Mall approach — the view every photograph of this building takes.
  { name: 'day-south',  p: 0.12, center: C, zoom: 17.5, pitch: 62, bearing: 4 },
  // Three-quarter from the south-west: shows the shaft's west face, the tower's
  // setbacks in profile and the west wing's tile roof at once.
  { name: 'day-sw',     p: 0.12, center: C, zoom: 17.2, pitch: 60, bearing: 42 },
  // From the east, which is where the flight path actually crosses.
  { name: 'day-east',   p: 0.18, center: C, zoom: 17.2, pitch: 62, bearing: 288 },
  { name: 'golden',     p: 0.50, center: C, zoom: 17.5, pitch: 62, bearing: 4 },
  { name: 'night',      p: 0.95, center: C, zoom: 17.5, pitch: 62, bearing: 4 },
  // Context, and the honest test: at the altitude the camera really flies —
  // 200-900 m — does it still read as the icon, or as a beige stick?
  { name: 'day-wide',   p: 0.15, center: [C[0] + 0.0004, C[1] - 0.0022], zoom: 16.1, pitch: 66, bearing: 8 },
  { name: 'night-wide', p: 0.95, center: [C[0] + 0.0004, C[1] - 0.0022], zoom: 16.1, pitch: 66, bearing: 8 },
  // Plan. Not for judging looks — an orthographic top-down always looks fine —
  // but for checking the three tile-roofed arms land on the real ones.
  { name: 'nadir',      p: 0.15, center: C, zoom: 17.0, pitch: 0, bearing: 4.9 },
];

const outDir = path.resolve('..', '..', 'shots');
fs.mkdirSync(outDir, { recursive: true });

async function run(tag, extraQuery) {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

  const url = SERVER + '/_harness.html?intro=0&drift=0' + extraQuery;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const m = window.__map;
    if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-ground', 'austin-trees']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 120000 }).catch(() => console.log('WARN: sources not all loaded'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) return false;
    try { if (window.__fly.eye().driving) return false; } catch (e) {}
    return true;
  }, null, { timeout: 40000 }).catch(() => {});

  for (const s of SHOTS) {
    await page.evaluate(async (s) => {
      const m = window.__map;
      if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
      window.applyTimeOfDay(m, s.p, true);
    }, s);
    await page.waitForTimeout(3500);
    await page.evaluate(() => new Promise(r => {
      const m = window.__map;
      if (m.loaded()) return r();
      m.once('idle', r);
      setTimeout(r, 15000);
    }));
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(1200);
    const file = path.join(outDir, `${PREFIX}-${tag}-${s.name}.png`);
    await page.screenshot({ path: file });
    await page.waitForTimeout(600);
    await page.screenshot({ path: file });
    console.log('WROTE', path.relative(process.cwd(), file));
  }

  const diag = await page.evaluate(() => {
    const m = window.__map;
    const src = id => { try { return m.querySourceFeatures(id).length; } catch (e) { return -1; } };
    const has = id => !!m.getLayer(id);
    return {
      towerSource: !!m.getSource('austin-tower'),
      towerFeaturesTiled: src('austin-tower'),
      layers: ['tower-wall', 'tower-solid', 'tower-detail'].filter(has),
      partsFilter: (() => { try { return JSON.stringify(m.getFilter('parts-3d')); } catch (e) { return 'n/a'; } })(),
      buildingsFilter: (() => { try { return JSON.stringify(m.getFilter('buildings-3d')).slice(0, 160); } catch (e) { return 'n/a'; } })(),
      // Asked of the DATA, not a hard-coded list: the bake allocates one image
      // per (family, palette), so the set grows whenever a band gets its own
      // colour and a fixed list quietly stops covering it.
      images: (window.__towerPats || []).filter(i => m.hasImage(i)),
    };
  });
  console.log(tag.toUpperCase() + ' DIAG', JSON.stringify(diag, null, 1));
  if (errors.length) console.log(tag.toUpperCase() + ' ERRORS', errors.slice(0, 10));
  await browser.close();
}

if (WHICH === 'both' || WHICH === 'before') await run('before', '&tower=0');
if (WHICH === 'both' || WHICH === 'after') await run('after', '');
