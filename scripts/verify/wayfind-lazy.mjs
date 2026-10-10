/**
 * wayfind-lazy.mjs — the walking feature is not downloaded unless it is asked for. (2026-10-10)
 *
 * js/wayfind.js is 893 KB and returns on its first line unless the feature is on. index.html now loads the
 * 1 KB js/wayfind-loader.js instead, which writes js/wayfind.js into the page only when the feature would have run
 * past that first line. Three things must stay true, and this checks each:
 *
 *   1 (text)    index.html and _harness.html carry js/wayfind-loader.js in the place js/wayfind.js had (between
 *               js/entrances.js's group and js/live-here-core.js) and no direct js/wayfind.js tag. The ship
 *               switch in the loader equals `on:` in js/wayfind.js, and the ON/OFF condition in the loader is the
 *               condition in js/wayfind.js, character for character after whitespace.
 *   2 (vm)      for a table of URLs the loader decides EXACTLY as js/wayfind.js does (the condition lifted out of
 *               js/wayfind.js and run on the same URL), including ?walk=0 vetoing ?from= / ?to= / ?livehere=1.
 *   3 (browser, --browser) a real page load: `/` makes NO request for js/wayfind.js; `/?walk=1`, `/?from=WEL&to=MAI`
 *               and `/?livehere=1` DO; `/?walk=0&from=WEL` does not; `/?wayfind=eager` does. Also `/` has no
 *               window.WAYFIND and no wayfind-* map source after the city has loaded its first frame.
 *
 *   node scripts/verify/wayfind-lazy.mjs                          # 1 and 2, no browser, milliseconds
 *   VERIFY_URL=http://127.0.0.1:8480 node scripts/verify/wayfind-lazy.mjs --browser [--gl hardware] [--seconds 25]
 *
 * Exit code 1 on any failure. Part 3 goes through the machine's browser queue like every browser run.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ok   ' + m); } else { fails++; console.log('  FAIL ' + m); } };

// ── 1. text ────────────────────────────────────────────────────────────────
console.log('1. the page, the loader and js/wayfind.js agree');
const scriptSrcs = f => [...read(f).matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
for (const f of ['index.html', '_harness.html']) {
  const s = scriptSrcs(f);
  ok(!s.includes('js/wayfind.js'), f + ': no direct <script src="js/wayfind.js"> (it is 893 KB)');
  const i = s.indexOf('js/wayfind-loader.js');
  ok(i >= 0 && s.filter(x => x === 'js/wayfind-loader.js').length === 1, f + ': exactly one js/wayfind-loader.js');
  ok(i > s.indexOf('js/entrances.js') && i < s.indexOf('js/live-here-core.js') && i < s.indexOf('js/controls.js') || (f === '_harness.html' && i > s.indexOf('js/entrances.js') && i < s.indexOf('js/app.js')),
    f + ': it sits where js/wayfind.js sat: after js/entrances.js, before js/live-here-core.js and js/app.js');
}
const loader = read('js/wayfind-loader.js'), wf = read('js/wayfind.js');
const shipLoader = /const SHIP = (true|false);/.exec(loader)?.[1];
const shipWf = /const WAYFIND = \{[\s\S]*?\bon: (true|false),/.exec(wf)?.[1];
ok(shipLoader && shipLoader === shipWf, `ship switch: loader SHIP = ${shipLoader}, js/wayfind.js on: ${shipWf}`);
const norm = s => s.replace(/\s+/g, ' ').replace(/WAYFIND\.on/g, 'SHIP').trim();
const condWf = /const ENABLED = ([\s\S]*?);\s*window\.WAYFIND = WAYFIND;/.exec(wf)?.[1];
const condLoader = /const ENABLED = ([\s\S]*?);\s*const SRC/.exec(loader)?.[1];
ok(condWf && condLoader && norm(condWf) === norm(condLoader), 'the ON/OFF condition is the same text in both files');
const keyed = f => /const urlWalk = q\.get\('walk'\);\s*const urlFrom = q\.get\('from'\);\s*const urlTo = q\.get\('to'\);/.test(f);
ok(keyed(wf) && keyed(loader), 'both read walk, from and to from the query the same way');

// ── 2. the decision, on a table of URLs ───────────────────────────────────
console.log('2. the loader decides as js/wayfind.js does, on a table of URLs');
const decideWf = search => {
  const pre = /(const q = new URLSearchParams\(window\.location\.search\);)/.exec(wf)[1];
  const urlPart = /(const urlWalk = [\s\S]*?const ENABLED = [\s\S]*?;)\s*window\.WAYFIND = WAYFIND;/.exec(wf)[1];
  const ctx = { URLSearchParams, window: { location: { search } }, WAYFIND: { on: shipWf === 'true' } };
  vm.createContext(ctx);
  vm.runInContext(`${pre}\n${urlPart}\nthis.__out = ENABLED;`, ctx);
  return !!ctx.__out;
};
const decideLoader = search => {
  const written = [];
  const ctx = { window: { location: { search } }, document: { write: s => written.push(s), createElement: () => ({}), head: { appendChild() {} } }, URLSearchParams, Promise };
  vm.createContext(ctx);
  vm.runInContext(loader, ctx);
  return { wrote: written.length === 1 && /js\/wayfind\.js/.test(written[0]), n: written.length };
};
const URLS = ['', '?walk=1', '?walk=0', '?walk=', '?from=WEL', '?to=MAI', '?from=WEL&to=MAI', '?livehere=1', '?livehere=1&walk=0',
  '?walk=0&from=WEL&to=MAI', '?livehere=0', '?drift=0&intro=0', '?walk=1&livehere=1', '?foo=walk'];
for (const u of URLS) {
  const a = decideWf(u), b = decideLoader(u);
  ok(a === b.wrote && b.n <= 1, `${(u || '(no query)').padEnd(26)} js/wayfind.js runs: ${a}   loader writes it: ${b.wrote}`);
}
const eager = decideLoader('?wayfind=eager');
ok(eager.wrote, '?wayfind=eager (the A/B switch) loads it on a page that would not');

// ── 3. a real page ─────────────────────────────────────────────────────────
if (argv.includes('--browser')) {
  console.log('3. a real page load');
  const { startChrome } = await import('../perf/lib/cdp.mjs');
  const BASE = (process.env.VERIFY_URL || 'http://127.0.0.1:8099').replace(/\/$/, '');
  const SECONDS = +arg('--seconds', 25);
  const GL = arg('--gl', 'hardware');
  const cases = [
    ['/', false], ['/?drift=0&intro=0', false], ['/?walk=1', true], ['/?from=WEL&to=MAI', true], ['/?livehere=1', true],
    ['/?walk=0&from=WEL', false], ['/?wayfind=eager', true],
  ];
  for (const [u, want] of cases) {
    const chrome = await startChrome({ gl: GL, width: 1280, height: 800, maxMs: (SECONDS + 90) * 1000 });
    try {
      const page = await chrome.newPage();
      const seen = [];
      page.on('Network.requestWillBeSent', e => { if (/\/js\/wayfind(-loader)?\.js(\?|$)/.test(e.request.url)) seen.push(e.request.url.replace(/^https?:\/\/[^/]+/, '')); });
      await page.send('Network.enable'); await page.send('Page.enable'); await page.send('Runtime.enable');
      await page.send('Page.navigate', { url: BASE + u });
      // wait for the map and its first frames (the city does not have to finish)
      const t0 = Date.now();
      let st = null;
      while (Date.now() - t0 < SECONDS * 1000) {
        await new Promise(r => setTimeout(r, 500));
        try { st = JSON.parse((await page.send('Runtime.evaluate', { expression: `JSON.stringify({map:!!window.__map,wf:typeof window.WAYFIND,lazy:window.WAYFIND_LAZY||null,src:window.__map&&window.__map.getStyle?Object.keys((window.__map.getStyle()||{}).sources||{}).filter(s=>/wayfind/.test(s)):[]})`, returnByValue: true })).result.value); } catch (e) { st = null; }
        if (st && st.map && Date.now() - t0 > 6000) break;
      }
      const got = seen.some(x => /\/js\/wayfind\.js/.test(x));
      ok(got === want, `${u.padEnd(24)} requested js/wayfind.js: ${got} (want ${want}); requests: ${seen.join(' ')}  window.WAYFIND: ${st && st.wf}  wayfind map sources: ${st && st.src.length}`);
      if (!want) ok(st && st.wf === 'undefined' && st.src.length === 0, `${u.padEnd(24)} off means off: no window.WAYFIND, no wayfind map source`);
    } finally { await chrome.close(); }
  }
}
console.log(fails ? `FAIL: ${fails} failed, ${passes} passed` : `PASS: ${passes} checks`);
process.exit(fails ? 1 : 0);
