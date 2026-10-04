/**
 * tile-heal.mjs - a poisoned browser cache must not take a map layer with it.
 *
 * The incident (measured 2026-10-04 in a desktop browser on the live site): a
 * normal fetch of the first range of outer.pmtiles, roads.pmtiles and
 * props.pmtiles came back from the HTTP cache as a 206 with the right length and
 * Content-Range and every byte ZERO, so the archive could not open and downtown
 * simply was not there. A cache-bypassing fetch returned the real file.
 *
 * This script re-creates that in a real page. It intercepts the first range
 * (bytes=0-16383) of the three archives and answers a NORMAL read with a
 * zero-filled 206 copy of the real response (same status, headers, length). A
 * cache-bypassing read (the browser sends Cache-Control: no-cache and Pragma:
 * no-cache for cache:'reload') and a generation URL (?cg=N) get the real bytes.
 * Playwright's own interception switches the HTTP cache off, so the "cache" here
 * is this handler, and it is deliberately given two behaviours:
 *
 *   outer, props  a reload REPAIRS the entry: the next normal read is real.
 *   roads         a reload does NOT stick: a normal read of the plain URL stays
 *                 poisoned, so the archive has to move to a new URL (?cg=1).
 *
 * ONE page load, then every claim is read from it:
 *   - the poison really was served (zero-filled first ranges for all three);
 *   - the archives healed in the SAME load (one navigation, no reload), outer
 *     and props by a reload, roads by a generation, stored once per archive;
 *   - one console line per healed archive, naming it; no page error;
 *   - roads read their tiles from ?cg=1 afterwards;
 *   - the DRAWN result: the far ring and the road armature have decoded
 *     features in the tile cache AND change the frame. The frame check hides
 *     the layers of one source at a time at a downtown pose and counts the
 *     pixels that moved; a layer that never loaded moves none.
 *
 * `--break` loads the page with ?tileheal=0 (the stock sources, no check: the
 * code path before the heal). The same poison then removes the far ring and the
 * roads, and this script must exit 1.
 *
 * Usage (laptop, through the browser queue):
 *   node <gpu-run.mjs> --label tile-heal -- node tile-heal.mjs [--break] [--out DIR]
 * with VERIFY_URL pointing at a served checkout (scripts/serve.py <port>).
 * Exit 0 pass, 1 an assertion failed, 2 could not run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const BREAK = process.argv.includes('--break');
const oi = process.argv.indexOf('--out');
const OUT = oi > 0 ? process.argv[oi + 1] : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const FIRST = 'bytes=0-16383';
// Does a reload repair the poisoned entry? (See the header.)
const RELOAD_REPAIRS = { outer: true, roads: false, props: true };
// The downtown pose the turn meter uses: the far ring and the roads fill the frame.
const POSE = { center: [-97.7445, 30.2668], zoom: 16.3, pitch: 72, bearing: 200 };
const PROPS_POSE = { center: [-97.7394, 30.2862], zoom: 17, pitch: 55, bearing: 0 };   // the Main Mall
// Share of the frame (percent of pixels moved by more than DELTA, 0-255 on any
// channel) that hiding one source must change. Measured, not guessed: see the
// numbers this prints. A layer that did not load changes none.
const DELTA = 24;
const MIN_SHARE = { outer: 3, roads: 0.3 };
const MIN_FEATURES = 100;
const MAX_NOISE = 0.5;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const logs = [], errors = [];
let navigations = 0;
page.on('console', m => logs.push({ type: m.type(), text: m.text() }));
page.on('pageerror', e => errors.push(e.message));
page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });

// ---- the poisoned cache ------------------------------------------------------
// WHAT THE ROUTE CAN SEE. Playwright's interception sits above the browser's
// HTTP cache, so the Cache-Control: no-cache / Pragma: no-cache that Chrome adds
// to a cache:'reload' fetch further down the stack are NOT on the request it
// is shown (see `headersSeen` in the summary line). The page's own `cache`
// option is the same fact one step earlier, so a one-line shim copies it into a
// request header the route can read. Either signal counts as a bypass.
await page.addInitScript(() => {
  const real = window.fetch;
  window.fetch = function (input, init) {
    if (init && init.cache && init.cache !== 'default') {
      const headers = new Headers(init.headers);
      headers.set('x-cache-mode', init.cache);
      init = { ...init, headers };
    }
    return real.call(this, input, init);
  };
});
const served = [];                 // every archive request, with what it was answered
const repaired = new Set();
const headersSeen = new Set();     // which of the cache headers the route ever saw on a read
await page.route(/\/data\/tiles\/(outer|roads|props)\.pmtiles(\?.*)?$/, async route => {
  const req = route.request();
  const url = new URL(req.url());
  const name = /(\w+)\.pmtiles$/.exec(url.pathname)[1];
  const h = req.headers();
  if (h['cache-control']) headersSeen.add('cache-control: ' + h['cache-control']);
  if (h.pragma) headersSeen.add('pragma: ' + h.pragma);
  const bypass = (/no-cache/.test(h['cache-control'] || '') && /no-cache/.test(h.pragma || ''))
    || ['reload', 'no-store', 'no-cache'].includes(h['x-cache-mode']);
  const generation = url.searchParams.has('cg');
  let poisoned = false;
  if (h.range === FIRST && !generation) {
    if (bypass) { if (RELOAD_REPAIRS[name]) repaired.add(name); }
    else poisoned = !repaired.has(name);
  }
  served.push({ name, range: h.range, bypass, generation, poisoned });
  // Only the poisoned reads are fetched here; the rest go to the network as the
  // page asked for them (route.fetch opens its own connections, and a burst of
  // tile reads overflowed the local server's listen queue: ECONNREFUSED).
  if (!poisoned) return route.continue();
  for (let tries = 0; ; tries++) {
    try {
      const real = await route.fetch();
      const body = await real.body();
      return await route.fulfill({ response: real, body: Buffer.alloc(body.length) });
    } catch (e) {
      if (tries >= 4) return route.abort().catch(() => {});
      await new Promise(r => setTimeout(r, 250 * (tries + 1)));
    }
  }
});

// ---- one load ----------------------------------------------------------------
await page.goto(`${BASE}/_harness.html?intro=0&drift=0${BREAK ? '&tileheal=0' : ''}`,
  { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.waitForFunction(() => window.__map.getLayer('outer-3d') && window.__map.getLayer('ground-road-far'), null, { timeout: 120000 })
  .catch(() => {});
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(pose => { const m = window.__map; if (m.isEasing && m.isEasing()) m.stop(); m.jumpTo(pose); }, POSE);
await page.waitForTimeout(6000);
await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 30000); }));

const state = await page.evaluate(() => {
  const m = window.__map, T = window.TILES || {};
  const feats = (src, layer) => { try { return m.querySourceFeatures(src, { sourceLayer: layer }).length; } catch (e) { return -1; } };
  const store = {};
  try { for (const k of ['outer', 'roads', 'props']) store[k] = localStorage.getItem('tiles.cachegen.' + k); } catch (e) {}
  return {
    tilesOn: T.on, heals: T.heals || [], store,
    urls: Object.fromEntries(Object.entries(T.archives || {}).map(([k, v]) => [k, v.url])),
    features: { outer: feats('austin-outer', 'outer'), roads: feats('austin-roads', 'roads') },
  };
});

// ---- the frame: hide one source's layers at a time, count the pixels that moved
// Page screenshots, not readPixels: the compositor only ever presents a whole
// frame, and a readPixels a moment after triggerRepaint caught frames mid-draw
// (the same state twice "moved" 66% of the frame).
const frames = {};
async function snap(tag) {
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(2500);
  await page.screenshot();                       // screenshot twice, trust the second
  frames[tag] = (await page.screenshot()).toString('base64');
}
const moved = (a, b) => page.evaluate(async ([a, b, D]) => {
  const pixels = async b64 => {
    const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const A = await pixels(a), B = await pixels(b);
  let n = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (Math.abs(A[i] - B[i]) > D || Math.abs(A[i + 1] - B[i + 1]) > D || Math.abs(A[i + 2] - B[i + 2]) > D) n++;
  }
  return +(100 * n / (A.length / 4)).toFixed(3);
}, [frames[a], frames[b], DELTA]);
const setHidden = (src, hide) => page.evaluate(([src, hide]) => {
  const m = window.__map;
  for (const l of m.getStyle().layers) if (l.source === src) m.setLayoutProperty(l.id, 'visibility', hide ? 'none' : 'visible');
}, [src, hide]);

await snap('all');
await snap('all2');                       // the same state twice: the noise floor
await setHidden('austin-outer', true);  await snap('noOuter');  await setHidden('austin-outer', false);
await setHidden('austin-roads', true);  await snap('noRoads');  await setHidden('austin-roads', false);
const share = { noise: await moved('all', 'all2'), outer: await moved('all', 'noOuter'), roads: await moved('all', 'noRoads') };
if (OUT) fs.writeFileSync(path.join(OUT, BREAK ? 'tile-heal-break.png' : 'tile-heal.png'), Buffer.from(frames.all, 'base64'));

// The props archive covers the campus, not downtown: look there for its tiles.
await page.evaluate(pose => window.__map.jumpTo(pose), PROPS_POSE);
await page.waitForTimeout(5000);
await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 30000); }));
const propFeatures = await page.evaluate(() => {
  try { return window.__map.querySourceFeatures('austin-props', { sourceLayer: 'props' }).length; } catch (e) { return -1; }
});

// ---- assertions --------------------------------------------------------------
const checks = [];
const ok = (name, cond, detail = '') => { checks.push({ name, pass: !!cond }); console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || !detail ? '' : '   ' + detail)); };
const poisonedBy = n => served.filter(r => r.name === n && r.poisoned).length;
const tilesLines = logs.filter(l => /^\[tiles\]/.test(l.text) && (l.type === 'warning' || l.type === 'error'));
const linesFor = n => tilesLines.filter(l => l.text.includes(n + '.pmtiles'));
const healOf = n => state.heals.find(x => x.archive === n);

ok('the poison was served: zero-filled first ranges for outer, roads and props',
  poisonedBy('outer') >= 1 && poisonedBy('roads') >= 1 && poisonedBy('props') >= 1,
  JSON.stringify({ outer: poisonedBy('outer'), roads: poisonedBy('roads'), props: poisonedBy('props') }));
ok('the page loaded once: no navigation, no reload, after the first', navigations === 1, 'navigations ' + navigations);
ok('no page error', errors.length === 0, errors.join(' | '));

// the heal
ok('outer healed by a reload, in the same load', healOf('outer')?.how === 'reload' && !state.store.outer, JSON.stringify([healOf('outer'), state.store.outer]));
ok('props healed by a reload, in the same load', healOf('props')?.how === 'reload' && !state.store.props, JSON.stringify([healOf('props'), state.store.props]));
ok('roads (a reload does not stick) moved to generation 1, stored once',
  healOf('roads')?.how === 'generation' && healOf('roads')?.gen === 1 && state.store.roads === '1' && /\?cg=1$/.test(state.urls.roads || ''),
  JSON.stringify([healOf('roads'), state.store.roads, state.urls.roads]));
ok('roads read their tiles from ?cg=1 afterwards',
  served.some(r => r.name === 'roads' && r.generation && r.range !== FIRST), 'no tile read on ?cg=1');
ok('outer and props stayed on their plain URLs, with no stored generation',
  !/\?cg=/.test(state.urls.outer || '') && !/\?cg=/.test(state.urls.props || '') && served.every(r => r.name === 'roads' || !r.generation));
ok('one console line per healed archive, each naming it, none an error',
  ['outer', 'roads', 'props'].every(n => linesFor(n).length === 1 && linesFor(n)[0].type === 'warning'),
  JSON.stringify(tilesLines.map(l => l.text.slice(0, 90))));

// the drawn result
ok(`the far ring is in the tile cache (>= ${MIN_FEATURES} decoded features)`, state.features.outer >= MIN_FEATURES, 'outer features ' + state.features.outer);
ok(`the roads are in the tile cache (>= ${MIN_FEATURES} decoded features)`, state.features.roads >= MIN_FEATURES, 'road features ' + state.features.roads);
ok('props are in the tile cache (at the campus pose)', propFeatures > 0, 'prop features ' + propFeatures);
ok(`the far ring is DRAWN: hiding it moves >= ${MIN_SHARE.outer}% of the frame`, share.outer >= MIN_SHARE.outer, share.outer + '%');
ok(`the roads are DRAWN: hiding them moves >= ${MIN_SHARE.roads}% of the frame`, share.roads >= MIN_SHARE.roads, share.roads + '%');
ok(`the instrument is steady: the same state twice moves under ${MAX_NOISE}% of the frame`, share.noise < MAX_NOISE, share.noise + '%');

console.log(JSON.stringify({ break: BREAK, share, features: { ...state.features, props: propFeatures }, headersSeen: [...headersSeen], urls: state.urls, store: state.store,
  poisoned: { outer: poisonedBy('outer'), roads: poisonedBy('roads'), props: poisonedBy('props') },
  heals: state.heals.map(h => `${h.archive}:${h.how}:${h.gen}`), console: tilesLines.map(l => l.text.slice(0, 160)) }));

await browser.__done();
const failed = checks.filter(c => !c.pass);
console.log(`${checks.length - failed.length}/${checks.length} passed` + (BREAK ? ' (--break: the heal is off)' : ''));
process.exit(failed.length ? 1 : 0);
