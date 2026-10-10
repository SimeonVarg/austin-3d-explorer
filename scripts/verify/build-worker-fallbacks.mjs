/**
 * build-worker-fallbacks.mjs — whatever goes wrong with the build worker, the real page ends with ALL its buildings, built on the main thread, with one
 * console line saying why. And a tab that is hidden while the worker builds still finishes.
 *
 * build-worker-client.mjs (Node, in CI) proves every failure of the worker CLIENT is a bounded rejection. THIS proves the page's reaction to each, in the
 * real page: seven loads of ?buildworker=1, each a different way for the worker to go wrong (a reference load with ?buildworker=0 gives the triangle count
 * and the number of buildings every arm must reach):
 *   no-worker    window.Worker does not exist                      script-404   js/build-worker.js answers 404
 *   throws       the worker throws at the start of its build       silent       the worker loads, says ready, and never answers the build
 *                                                                  (?buildworkertimeout=T so the wait is short)
 *   hidden       the tab is hidden (document.hidden true, visibilitychange) while the worker builds: it must still finish, in the worker
 * Per fallback arm: the buildings are all there (same triangles, same count as the reference), buildWorkerState is 'failed', the switch is off for the
 * rest of the page, and the page logged exactly ONE line from the worker fallback. Per hidden arm: state 'done', same triangles.
 *
 *   VERIFY_URL=http://127.0.0.1:PORT node scripts/verify/build-worker-fallbacks.mjs [--only silent,hidden] [--break]
 *   --break  the page's catch rethrows instead of building on the main thread (js/slopes-apartments.js is edited in flight): the fallback arms must FAIL, exit 1
 */
import { chromium } from 'playwright-core';
import { BASE, launch, glArgsFor } from './chrome.mjs';

const PARAMS = {
  query: 'intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0',
  viewport: { width: 1440, height: 900 },
  silentTimeoutMs: 25000,       // ?buildworkertimeout for the arm whose worker never answers (the worker needs a few seconds to load its scripts; the build itself never starts)
  loadMs: 600000, doneMs: 1200000,   // a loaded machine takes minutes
};
const argv = process.argv.slice(2), BREAK = argv.includes('--break');
const oi = argv.indexOf('--only'), ONLY = oi >= 0 ? argv[oi + 1].split(',') : null;
const ARMS = {
  reference: { query: '&buildworker=0' },
  'no-worker': { query: '&buildworker=1', init: () => { window.Worker = undefined; }, fallback: true },
  'script-404': { query: '&buildworker=1', route: { match: /\/js\/build-worker\.js/, status: 404 }, fallback: true },
  throws: { query: '&buildworker=1', route: { match: /\/js\/build-worker\.js/, edit: t => t.replace('async function run(', 'async function run(__m) { throw new Error("test: the worker fails at the start of its build"); }\nasync function __unused(') }, fallback: true },
  silent: { query: '&buildworker=1&buildworkertimeout=' + PARAMS.silentTimeoutMs, route: { match: /\/js\/build-worker\.js/, edit: t => t.replace('async function run(', 'async function run(__m) { await new Promise(() => {}); }\nasync function __unused(') }, fallback: true },
  hidden: { query: '&buildworker=1', hide: true },
};
const names = Object.keys(ARMS).filter(n => !ONLY || n === 'reference' || ONLY.includes(n));

async function one(name) {
  const arm = ARMS[name];
  const browser = await launch(chromium, { maxMs: PARAMS.doneMs + PARAMS.loadMs, args: glArgsFor(process.env.VERIFY_GL || 'hardware') });
  const logs = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: PARAMS.viewport, deviceScaleFactor: 1 });
    page.on('console', m => { const t = m.text(); if (/\[slopes-apartments\]/.test(t) && /worker/i.test(t)) logs.push(t.slice(0, 220)); if (m.type() === 'error') errors.push(t.slice(0, 160)); });
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 160)));
    if (arm.init) await page.addInitScript(arm.init);
    if (arm.route) await page.route(arm.route.match, async route => {
      if (arm.route.status) return route.fulfill({ status: arm.route.status, body: 'not found' });
      const r = await route.fetch(); const body = await r.text(); const out = arm.route.edit(body);
      if (out === body) throw new Error('the test edit of js/build-worker.js matched nothing: the check would not break the worker');
      return route.fulfill({ response: r, body: out, headers: { ...r.headers(), 'content-type': 'text/javascript' } });
    });
    if (BREAK && arm.fallback) await page.route(/\/js\/slopes-apartments\.js/, async route => {   // --break: the page's catch rethrows instead of building here
      const r = await route.fetch(); const body = await r.text(); const out = body.replace("console.warn('[slopes-apartments] the build worker failed, building here instead —', e && e.message || e);", 'throw e;');
      if (out === body) throw new Error('--break: the fallback line in js/slopes-apartments.js was not found');
      return route.fulfill({ response: r, body: out, headers: { ...r.headers(), 'content-type': 'text/javascript' } });
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/index.html?${PARAMS.query}${arm.query}`, { waitUntil: 'domcontentloaded', timeout: PARAMS.loadMs });
    await page.waitForFunction(() => window.cancelGraphicsAutoDetect, null, { timeout: 120000 }).catch(() => {});
    await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
    if (arm.hide) {   // hide the tab once the worker is building (not before: the page decides some things at load)
      await page.waitForFunction(() => window.__aptsBuild && /building|starting/.test(window.__aptsBuild.buildWorkerState()), null, { timeout: PARAMS.doneMs, polling: 100 });
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    await page.waitForFunction(() => { const A = window.slopesApartments; return !!(A && A.count.done && A.group); }, null, { timeout: PARAMS.doneMs, polling: 500 });
    const r = await page.evaluate(() => {
      let tris = 0, meshes = 0; window.slopesApartments.group.traverse(o => { const g = o.geometry; if (g && g.index) { tris += g.index.count / 3; meshes++; } });
      const B = window.__aptsBuild;
      return { tris, meshes, built: window.slopesApartments.built.length, failedBuildings: B.failed().length, state: B.buildWorkerState(), on: B.buildWorkerOn() };
    });
    return { name, seconds: (Date.now() - t0) / 1000, ...r, logs, errors: errors.slice(0, 4) };
  } finally { await browser.__done(); }
}

const results = [];
for (const n of names) { try { results.push(await one(n)); } catch (e) { results.push({ name: n, error: e.message.split('\n')[0] }); } console.log(JSON.stringify(results[results.length - 1])); }
const ref = results.find(r => r.name === 'reference');
let bad = 0; const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) bad++; };
console.log('');
if (!ref || ref.error) { console.log('FAIL: the reference load failed: ' + (ref && ref.error)); process.exit(1); }
say(ref.tris > 0 && ref.built > 0, `reference (?buildworker=0): ${ref.tris} triangles, ${ref.built} buildings, state ${ref.state}`);
for (const r of results) {
  if (r.name === 'reference') continue;
  const arm = ARMS[r.name];
  if (r.error) { say(false, `${r.name}: ${r.error}`); continue; }
  const allThere = r.tris === ref.tris && r.built === ref.built && r.failedBuildings === ref.failedBuildings;
  if (arm.fallback) {
    say(allThere && r.state === 'failed' && r.on === false && r.logs.length === 1,
      `${r.name}: ${allThere ? 'all buildings there (' + r.tris + ' triangles, ' + r.built + ' built)' : 'BUILDINGS MISSING: ' + r.tris + ' triangles, ' + r.built + ' built, against ' + ref.tris + ' and ' + ref.built}; state ${r.state}, switch ${r.on ? 'still on' : 'off'}, ${r.logs.length} console line(s) from the fallback${r.logs[0] ? ': "' + r.logs[0] + '"' : ''} (${r.seconds.toFixed(0)} s)`);
  } else {
    say(allThere && r.state === 'done', `${r.name}: ${allThere ? 'all buildings there (' + r.tris + ' triangles)' : 'BUILDINGS MISSING: ' + r.tris + ' against ' + ref.tris}; worker state ${r.state}${r.logs.length ? '; unexpected console line: ' + r.logs[0] : ''} (${r.seconds.toFixed(0)} s)`);
  }
}
console.log(bad ? `\nFAIL: ${bad} arm(s)` : '\nPASS: every worker failure ends with all the buildings, and a hidden tab still finishes');
process.exit(bad ? 1 : 0);
