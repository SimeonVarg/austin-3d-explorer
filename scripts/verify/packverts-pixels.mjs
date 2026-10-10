/**
 * packverts-pixels.mjs — ?packverts=1 moves ZERO pixels.
 *
 * packverts-decode.mjs proves the CPU side (every packed vertex decodes to exactly the unpacked one; no browser). THIS proves the GPU side:
 * that the vertex shader reads the two float textures and lands on the pixels the attributes gave it.
 *
 * ONE PAGE, three builds. Two loads of the city are never the same picture (labels, tiles and walls settle at their own pace, and on a loaded
 * machine the first shot of a page is a different city from the second: a first version of this check compared two pages and its CONTROL moved
 * 96% of the pixels). So the page is loaded once, left to settle, and the authored buildings are rebuilt in place with slopesApartments.rebuild():
 * off, then on (slopes.packSet(true)), then off again. Every pose is photographed after each build. "on" must differ from "off" by no more pixels
 * than "off again" does (the control: what the page moves against itself, zero when it is deterministic). Exact: any channel, any amount.
 *
 *   VERIFY_URL=http://127.0.0.1:PORT node scripts/verify/packverts-pixels.mjs [--out DIR] [--poses file.json] [--phone] [--query "packverts=0&rustbuilder=1"] [--break]
 *   --phone  390x844 @3x with ?lite=1 (the phone profile: the build is chunked, three.js frees the CPU copies after upload)
 *   --query  extra query for the page (e.g. rustbuilder=1: then "off" is the Rust builder and "on" is the packed JS builder)
 *   --break  the "on" build is photographed at a different hour: must report moved pixels and exit 1
 * Software rendering (the default here) is what CI uses; VERIFY_GL=hardware measures the GPU you have.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './lib/png.mjs';
import { BASE, launch } from './chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARAMS = {
  shotQuery: 'intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0',   // ci/pictures.mjs LOOK.shotQuery plus shot.mjs's own
  phone: { width: 390, height: 844, dpr: 3, query: 'lite=1' },
  desktop: { width: 1440, height: 900, dpr: 1 },
  maxMovedPixels: 0,            // "on" may move no more pixels than the control moves
  breakShiftP: 0.06,            // --break: the "on" shoot's time of day, later by this much of the day
  settleMs: 4000,               // after a camera jump, as shot.mjs
  wallCapMs: 60000, quietReads: 3,
  loadMs: 900000,               // page load / style / sources (a loaded Mac needs minutes)
  buildWaitMs: 1500000,         // one in-place rebuild's ceiling (a loaded machine takes minutes)
  maxMs: 150 * 60 * 1000,
};
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(opt('--out', 'packverts-pixels-out'));
const poses = JSON.parse(fs.readFileSync(path.resolve(opt('--poses', path.join(HERE, 'ci/poses.json'))), 'utf8'));
const PHONE = argv.includes('--phone'), BREAK = argv.includes('--break');
const VP = PHONE ? PARAMS.phone : PARAMS.desktop;
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { maxMs: PARAMS.maxMs });
const page = await browser.newPage({ viewport: { width: VP.width, height: VP.height }, deviceScaleFactor: VP.dpr });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
const q = [PARAMS.shotQuery, PHONE ? PARAMS.phone.query : '', opt('--query', '')].filter(Boolean).join('&');
await page.goto(`${BASE}/_harness.html?${q}`, { waitUntil: 'domcontentloaded', timeout: PARAMS.loadMs });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: PARAMS.loadMs });
await page.waitForFunction(() => {
  const m = window.__map; if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roofscape', 'austin-tower', 'austin-westcampus', 'austin-drag', 'austin-arts', 'austin-moody', 'austin-stadium']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: PARAMS.loadMs }).catch(() => console.log('WARN: sources not all loaded'));
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// the opening veil ("Still building 90%") sits over the page until the city is ready: a first version photographed it, and its control moved 99.9999% of the pixels
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: PARAMS.buildWaitMs, polling: 1000 });
await page.waitForFunction(() => { const A = window.slopesApartments; return !!(A && A.count.done && A.group); }, null, { timeout: PARAMS.buildWaitMs, polling: 1000 });
if (!(await page.evaluate(() => !!(window.slopes && window.slopes.packSet)))) { console.log('FAIL: this checkout has no slopes.packSet (the packed layout is not here)'); await browser.__done(); process.exit(1); }

// ISOLATE WHAT THE SWITCH CHANGES. On a busy machine the rest of the city never holds still between two shots (map tiles, name labels, trees and the
// "Modes" badge were still arriving: a control that moves 38% to 99% of the pixels). The packed layout only changes how the apartment meshes are drawn, so
// every MapLibre layer except the custom three.js one (the slopes layer, which draws the apartments and every other builder mesh) is hidden: what is
// left is the sky, the three.js meshes and the page's fixed controls, which are the same in every shot.
// Auto brightness adapts the exposure frame by frame: on the laptop the control (off vs off again) moved every pixel of a view by up to 10/255 for that reason alone.
await page.evaluate(() => { if (window.GFX) window.GFX.autoExposure = false; if (window.applyGraphics) window.applyGraphics(); });
const hidden = await page.evaluate(() => { const m = window.__map; let n = 0; for (const l of m.getStyle().layers) if (l.type !== 'custom') { try { m.setLayoutProperty(l.id, 'visibility', 'none'); n++; } catch (e) {} } return n; });
console.log(`hid ${hidden} MapLibre layers; the custom (three.js) layers stay`);
const tris = [];
async function rebuild(packed) {
  const r = await page.evaluate(async packed => {
    const A = window.slopesApartments, before = A.count.ms;
    window.slopes.packSet(packed);
    A.rebuild();
    return before;
  }, packed);
  await page.waitForFunction(r => { const A = window.slopesApartments; return !!(A.group && A.count.done && A.count.ms !== r && A.count.ms > 0); }, r, { timeout: PARAMS.buildWaitMs, polling: 1000 });
  const info = await page.evaluate(() => { let tris = 0, packed = 0, bytes = 0; window.slopesApartments.group.traverse(o => { const g = o.geometry; if (g && g.index) { tris += g.index.count / 3; if (g.userData.pack) packed++; for (const k in g.attributes) { const a = g.attributes[k].array; if (a) bytes += a.byteLength; } if (g.index.array) bytes += g.index.array.byteLength; } }); return { tris, packedMeshes: packed, bytesMb: +(bytes / 1048576).toFixed(1), ms: window.slopesApartments.count.ms }; });
  console.log(`build ${packed ? 'PACKED' : 'unpacked'}: ${JSON.stringify(info)}`);
  if (packed && !info.packedMeshes) throw new Error('packSet(true) but no mesh is packed: the check would compare the unpacked layout with itself');
  if (!packed && info.packedMeshes) throw new Error('packSet(false) but a mesh is still packed');
  tris.push(info.tris);
  if (tris.length > 1 && tris[tris.length - 1] !== tris[0]) throw new Error(`this build has ${info.tris} triangles, the first had ${tris[0]}: buildings failed to build (see the page errors), so the pictures would differ for the wrong reason`);
  return info;
}
const wallsBusy = () => { const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count; return { pace: !!(P && P.busy), apartments: !!(A && !A.done) }; };
async function shootAll(side, shiftP = 0) {
  for (const s of poses) {
    await page.evaluate(async ({ s, shiftP }) => {
      const m = window.__map; if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
      if (typeof s.p === 'number') { const p = Math.min(1, s.p + shiftP); const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p); window.applyTimeOfDay(m, p); }
    }, { s, shiftP });
    await page.waitForTimeout(PARAMS.settleMs);
    await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(() => r(), 15000); }));
    let quiet = 0; const t0 = Date.now();
    while (quiet < PARAMS.quietReads && Date.now() - t0 < PARAMS.wallCapMs) { const b = await page.evaluate(wallsBusy); if (b.pace || b.apartments) quiet = 0; else quiet++; await page.waitForTimeout(500); }
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(1500);
    const file = path.join(OUT, `${side}-${s.name}.png`);
    await page.screenshot({ path: file }); await page.waitForTimeout(600); await page.screenshot({ path: file });
  }
  console.log(`shot ${side}: ${poses.length} views`);
}
const diff = (a, b) => {
  const A = decodePNG(a), B = decodePNG(b); if (A.width !== B.width || A.height !== B.height) throw new Error('size mismatch');
  const n = A.width * A.height; let moved = 0, max = 0, over12 = 0;
  for (let i = 0; i < n; i++) { let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i * A.bpp + c] - B.data[i * B.bpp + c])); if (d > 0) moved++; if (d > 12) over12++; if (d > max) max = d; }
  return { moved, over12, max, total: n };
};

process.on('uncaughtException', e => { console.log('FAIL: ' + e.message + (errors.length ? '\npage errors: ' + errors.slice(0, 3).join(' | ') : '')); process.exit(1); });
const infoOff = await rebuild(false); await shootAll('off');
const infoOn = await rebuild(true); await shootAll('on', BREAK ? PARAMS.breakShiftP : 0);
await rebuild(false); await shootAll('again');
await browser.__done();

let bad = 0;
console.log(`\n${PHONE ? 'phone profile (390x844 @3x, ?lite=1)' : 'desktop (1440x900)'}${BREAK ? '  [--break: the on shoot is at a later hour]' : ''}; apartment geometry ${infoOff.bytesMb} MiB unpacked -> ${infoOn.bytesMb} MiB packed (arrays on the CPU side; the tables are textures)`);
console.log('view                 moved px (on vs off)   control (off vs again)   max channel diff   over 12/255');
for (const p of poses) {
  let row;
  try {
    const f = side => path.join(OUT, `${side}-${p.name}.png`);
    const on = diff(f('off'), f('on')), ctl = diff(f('off'), f('again'));
    const ok = on.moved <= ctl.moved + PARAMS.maxMovedPixels; if (!ok) bad++;
    row = `${ok ? 'same   ' : 'MOVED  '}${p.name.padEnd(17)} ${String(on.moved).padStart(8)} (${(100 * on.moved / on.total).toFixed(4)}%)   ${String(ctl.moved).padStart(8)}               ${String(on.max).padStart(3)}              ${on.over12}`;
  } catch (e) { bad++; row = `ERROR  ${p.name.padEnd(17)} ${e.message}`; }
  console.log(row);
}
if (errors.length) console.log('page errors:', errors.slice(0, 5));
console.log(bad ? `\nFAIL: ${bad} of ${poses.length} view(s) moved pixels${BREAK ? ' (--break: this is the expected result)' : ''}` : `\nPASS: ${poses.length} views, zero pixels moved by the packed layout`);
process.exit(bad ? 1 : 0);
