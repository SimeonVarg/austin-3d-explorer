/**
 * slopes-switch-console.mjs — the REAL page, every way the vertex-store switches can be set, and nothing in the console that should not be there.
 *
 * WHY. js/slopes.js keeps the loaded Rust builder in a closure variable (`_rustBuild`), and two CPU checks that lift pieces of that file into a stub scope
 * (slopes-buffer-memory.mjs, slopes-chunked-build.mjs) once died with `ReferenceError: _rustBuild is not defined` because the lift did not include its declaration.
 * That was the check, not the page (every real reference sits inside the same IIFE as the declaration). This check shows it on the real page: five loads, each
 * with the console and uncaught errors recorded.
 *
 *   loads (each in a fresh page; the phone profile = ?lite=1 at 390x844 @3x, a desktop load = 1440x900):
 *     phone, default   phone, ?rustbuilder=0   phone, ?rustbuilder=1   phone, ?packverts=0   desktop, default
 *   For each: waits until the authored buildings have been built, then asserts
 *     - no uncaught error and no console error that names a ReferenceError, TypeError or `_rustBuild`
 *     - slopes.packOn() and slopes.rustBuilder are what the URL says (default: packed ON, Rust OFF)
 *     - the apartments mesh is packed exactly when packOn(), the same triangle count in every load of the same profile
 *     - a .wasm was requested exactly when ?rustbuilder=1 (and js/slopes-rust.js with it)
 *
 *   VERIFY_URL=http://127.0.0.1:PORT node scripts/verify/slopes-switch-console.mjs [--only phone-default,...] [--break]
 *   --break  expects the opposite of the default for the Rust switch: the check must fail and exit 1.
 * Software rendering is what CI uses; on the real GPU: VERIFY_GL=hardware (the Colab and laptop lanes).
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const LOADS = [
  { name: 'phone-default', phone: true, q: '', pack: true, rust: false },
  { name: 'phone-rustbuilder-0', phone: true, q: 'rustbuilder=0', pack: true, rust: false },
  { name: 'phone-rustbuilder-1', phone: true, q: 'rustbuilder=1', pack: true, rust: true },
  { name: 'phone-packverts-0', phone: true, q: 'packverts=0', pack: false, rust: false },
  { name: 'desktop-default', phone: false, q: '', pack: true, rust: false },
];
const PARAMS = { waitMs: 1500000, settleMs: 2000, base: 'intro=0&drift=0&namelabels=0' };
const argv = process.argv.slice(2), BREAK = argv.includes('--break');
const oi = argv.indexOf('--only'), only = oi >= 0 ? argv[oi + 1].split(',') : null;
let failed = 0; const say = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) failed++; };

const browser = await launch(chromium, { maxMs: PARAMS.waitMs * LOADS.length + 300000, ...(process.env.VERIFY_GL === 'hardware' ? { gl: 'hardware' } : {}) });
try {
  for (const L of LOADS) {
    if (only && !only.includes(L.name)) continue;
    const page = await browser.newPage(L.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 } : { viewport: { width: 1440, height: 900 } });
    const errors = [], console_ = [], req = [];
    page.on('pageerror', e => errors.push(e.name + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console_.push(m.type() + ': ' + m.text().slice(0, 200)); });
    page.on('request', r => req.push(r.url()));
    const url = `${BASE}/index.html?${PARAMS.base}${L.phone ? '&lite=1' : ''}${L.q ? '&' + L.q : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PARAMS.waitMs });
    await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()).catch(() => {});
    await page.waitForFunction(() => { const A = window.slopesApartments; return !!(A && A.count.done && A.group && A.count.ms > 0); }, null, { timeout: PARAMS.waitMs, polling: 1000 });
    await page.waitForTimeout(PARAMS.settleMs);
    const s = await page.evaluate(() => {
      let tris = 0, packedMeshes = 0, meshes = 0;
      // the generator's own meshes: 'apartments', 'apartments-2' ... (the group also holds the facade filter's overlay quads, 'filtered-facade', which are built another way and never packed)
      window.slopesApartments.group.traverse(o => { const g = o.geometry; if (g && g.index && g.attributes.position && /^apartments(-\d+)?$/.test(o.name)) { meshes++; tris += g.index.count / 3; if (g.userData.pack) packedMeshes++; } });
      return { packOn: window.slopes.packOn(), rustBuilder: window.slopes.rustBuilder, rustState: window.slopes.rustInfo().state, packInfo: window.slopes.packInfo(), meshes, packedMeshes, tris };
    });
    await page.close();
    const wantRust = BREAK ? !L.rust : L.rust;
    const bad = errors.filter(e => /ReferenceError|TypeError|_rustBuild/.test(e)).concat(console_.filter(c => /ReferenceError|_rustBuild|is not defined/.test(c)));
    const wasm = req.filter(u => /\.wasm(\?|$)/.test(u)).length, rjs = req.filter(u => /\/js\/slopes-rust\.js(\?|$)/.test(u)).length;
    console.log(`\n${L.name}: ${url.replace(BASE, '')}\n  packOn ${s.packOn}, rustBuilder ${s.rustBuilder} (${s.rustState}), ${s.meshes} mesh(es), ${s.packedMeshes} packed, ${s.tris} triangles, byte rule ${s.packInfo.byteConversion}, .wasm requests ${wasm}, slopes-rust.js requests ${rjs}, console warnings/errors ${console_.length}, uncaught ${errors.length}`);
    for (const c of console_.slice(0, 3)) console.log('  console ' + c);
    say(bad.length === 0, `${L.name}: no ReferenceError, TypeError or _rustBuild message in the console${bad.length ? ': ' + bad[0] : ''}`);
    say(errors.length === 0, `${L.name}: no uncaught page error${errors.length ? ': ' + errors[0] : ''}`);
    say(s.packOn === L.pack && (s.packedMeshes > 0) === L.pack && (!L.pack || s.packedMeshes === s.meshes), `${L.name}: packed vertices ${L.pack ? 'ON, every apartment mesh packed' : 'OFF, none packed'}`);
    say(s.rustBuilder === wantRust && (wasm === 1) === wantRust && (rjs >= 1) === wantRust, `${L.name}: the Rust builder is ${wantRust ? 'ON, one .wasm and js/slopes-rust.js requested' : 'OFF, no .wasm and no js/slopes-rust.js requested'}`);
  }
} finally { await browser.__done(); }
console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: no console error in any of the five loads');
process.exit(failed ? 1 : 0);
