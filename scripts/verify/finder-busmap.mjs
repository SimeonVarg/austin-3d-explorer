/**
 * finder-busmap.mjs — ONE browser look at the pathfinder pass: the bus on the finder's map, in its ranking, the "Show live
 * buses" switch, and the bus row under a long walk in the walking pathfinder. Needs a GPU and the live bus feed; it is run by
 * hand on a cloud lane (scripts/colab/run.py or acer-run.sh), not in CI (scripts/verify/ci/checks.json quarantine).
 *
 * It loads the real city ONCE for the finder (rule 13: load once, test many), flips things inside the page, and writes a picture
 * at each step to VERIFY_OUT. It uses a major (Computer Science), never a student's schedule: nothing personal is typed in.
 * Every request of the run is recorded and the privacy rule is checked on the wire: no request carries a home, a stop or a
 * class building, and the live buses ask data.texas.gov only for the two public feeds.
 *
 * Usage: node scripts/verify/finder-busmap.mjs --out DIR     (or VERIFY_OUT=DIR; VERIFY_GL=hardware is the default)
 * Laptop lane: acer-run.sh check finder-busmap.mjs --out {out} --workcopy DIR --gl hardware
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const oi = process.argv.indexOf('--out');
const OUT = (oi > 0 && process.argv[oi + 1]) || process.env.VERIFY_OUT || '.';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const note = {};
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail: detail === undefined ? null : detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 1500000 });
try {
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctxB.newPage();
  const errors = [], reqs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('request', (r) => reqs.push({ t: Date.now(), url: r.url(), method: r.method(), body: r.postData() || '' }));
  await page.addInitScript(() => { const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 50); });
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); };
  const st = () => page.evaluate(() => window.finderState());
  const feedReqs = (since) => reqs.filter((r) => r.t >= since && /data\.texas\.gov/.test(r.url));

  // ── 1. the ranking ──────────────────────────────────────────────────────────
  await page.goto(BASE + '/index.html?intro=0&drift=0&finder=1&major=computer-science&mode=either', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.finderState && window.finderState().loaded, null, { timeout: 240000 });
  await page.waitForFunction(() => window.finderState().bus.rank && window.finderState().bus.timetableLegs > 0, null, { timeout: 120000 }).catch(() => {});
  let s = await st();
  check('the ranking took the timetable bus for walkable homes', s.bus.rank && s.bus.timetableLegs > 0, { timetableLegs: s.bus.timetableLegs, stats: s.bus.stats });
  note.rankingMsInBrowser = s.bus.stats && s.bus.stats.ms;
  const subs = await page.$$eval('.fd-item', (lis) => lis.map((li) => ({ id: li.dataset.id, name: li.querySelector('.fd-name').textContent, sub: li.querySelector('.fd-sub').textContent, min: li.querySelector('.fd-min').textContent })));
  note.rows = subs;
  check('rows say walk or bus, as a range', subs.every((r) => /· (walk|bus about|walk \+ bus about) \d+–\d+ min$/.test(r.sub)), subs.filter((r) => !/· (walk|bus about|walk \+ bus about) \d+–\d+ min$/.test(r.sub)).slice(0, 3));
  const busRows = subs.filter((r) => /bus about/.test(r.sub));
  check('some rows go by bus and most are still walks', busRows.length >= 4 && subs.filter((r) => /· walk \d/.test(r.sub)).length >= 10, { bus: busRows.length, walk: subs.filter((r) => /· walk \d/.test(r.sub)).length });
  await shot('01-ranking');

  // ── 2. a timetable-bus home: the trip on the map ─────────────────────────────
  const pick = busRows.find((r) => !/Riverside/.test(r.sub) && !/Estates|Village|Element|Town Lake/.test(r.name)) || busRows[0];
  note.pickedHome = pick && pick.name;
  const t2 = Date.now();
  await page.evaluate((id) => window.finderSelect(id), pick.id);
  await page.waitForFunction(() => { const r = window.finderState().route; return r.bus >= 1 && r.stop >= 2; }, null, { timeout: 30000 }).catch(() => {});
  await sleep(4000);
  s = await st();
  check('selecting a bus home draws the trip: bus line, walk links, and a stop at each end', s.route.bus >= 1 && s.route.stop >= 2 && s.route.link >= 2, s.route);
  check('and its board / get-off tags', s.labels >= 2, s.labels);
  const feats = await page.evaluate(() => window.__map.querySourceFeatures('finder-route').map((f) => ({ k: f.properties.k, c: f.properties.c || null, r: f.properties.r || null, role: f.properties.role || null, n: f.geometry.coordinates.length })));
  note.features = feats;
  const bus = feats.filter((f) => f.k === 'bus');
  check('the bus leg carries a route colour and runs along many points of the route\'s real line', bus.length >= 1 && bus.every((f) => /^#[0-9a-f]{6}$/i.test(f.c || '') && f.n >= 3), bus);
  const routeColours = await page.evaluate(async () => { const d = await (await fetch('data/transit-live.json')).json(); const o = {}; for (const r of Object.values(d.routes)) o[r.short] = r.color; return o; });
  check('that colour is the route\'s own colour from the baked slice', bus.every((f) => routeColours[f.r] && routeColours[f.r].toLowerCase() === f.c.toLowerCase()), bus.map((f) => [f.r, f.c, routeColours[f.r]]));
  const layers = await page.evaluate(() => ['finder-route-bus', 'finder-route-walk', 'finder-route-link', 'finder-route-stop', 'finder-route-casing'].map((id) => [id, !!window.__map.getLayer(id)]));
  check('the route layers exist (bus, walk, link, stop, casing)', layers.every((l) => l[1]), layers);
  await shot('02-trip-selected');
  // frame the whole trip: the pictures the owner wants
  const framed = await page.evaluate(() => {
    const m = window.__map, fs = m.querySourceFeatures('finder-route'); if (!fs.length) return null;
    let w = 180, e = -180, s = 90, n = -90;
    for (const f of fs) { const flat = f.geometry.coordinates.flat(Infinity); for (let i = 0; i + 1 < flat.length; i += 2) { w = Math.min(w, flat[i]); e = Math.max(e, flat[i]); s = Math.min(s, flat[i + 1]); n = Math.max(n, flat[i + 1]); } }
    try {
      m.stop(); const cam = m.cameraForBounds([[w, s], [e, n]], { padding: { top: 90, bottom: 90, left: 440, right: 90 } });
      if (cam) m.jumpTo({ center: cam.center, zoom: Math.min(cam.zoom, 15.8), pitch: 35, bearing: 0 });
    } catch (err) { return { error: String(err) }; }
    return { bounds: [w, s, e, n], zoom: m.getZoom() };
  }).catch((err) => ({ error: String(err) }));
  note.framed = framed;
  await sleep(6000);
  await shot('03-trip-framed');
  const line = await page.$eval('.fd-live', (n) => n.textContent).catch(() => null);
  note.liveLine = line;
  check('the live line under the home still reads', line && /Bus to|Walking to|No bus|Looking/.test(line), line);

  // ── 3. "Show live buses" ─────────────────────────────────────────────────────
  check('the switch exists and is OFF by default', await page.$eval('.fd-livebuses input', (i) => i.checked === false), s.liveBuses);
  check('and nothing but the line is polling before it is on (no vehicles layer)', await page.evaluate(() => !window.__map.getLayer('transit-live-vehicles')));
  await page.click('.fd-livebuses input');
  await page.waitForFunction(() => window.finderState().liveBuses.active && window.__map.getLayer('transit-live-vehicles'), null, { timeout: 30000 }).catch(() => {});
  await sleep(25000);                                              // one or two polls
  s = await st();
  const live = await page.evaluate(() => {
    const m = window.__map, src = m.getSource('transit-live-vehicles'), feats = src && src._data ? src._data.features : [];
    return { layers: m.getStyle().layers.map((l) => l.id).filter((id) => /^transit-live/.test(id)), shown: feats.length, routes: [...new Set(feats.map((f) => f.properties.route))],
      city: window.TransitLive ? window.TransitLive.vehiclesGeo(null).features.length : null, note: document.querySelector('.fd-livebuses-note').textContent, state: window.TransitLive ? window.TransitLive.state().ok : null };
  });
  note.live = live;
  check('live buses: only the vehicles layers are on the map (no stops, no lines)', live.layers.sort().join() === 'transit-live-vehicle-halo,transit-live-vehicles', live.layers);
  const tripRoutes = (live.note.match(/route[s]? ([\w, ]+)\./) || [])[1];
  check('and the note names the trip\'s routes (' + tripRoutes + ')', !!tripRoutes);
  check('only those routes\' buses are drawn, not the city\'s', live.routes.every((r) => (tripRoutes || '').split(/,\s*/).includes(r)) && (live.city === null || live.shown <= live.city), live);
  await shot('04-live-buses');
  await page.click('.fd-livebuses input');
  await sleep(1500);
  check('switching it off removes the layer and the poll handle', await page.evaluate(() => !window.__map.getLayer('transit-live-vehicles') && !window.finderState().liveBuses.active));
  // deselect: the live line also stops; then NOTHING may ask the bus feeds anything
  await page.evaluate(() => window.finderSelect(null));
  await sleep(2500);
  const quietFrom = Date.now();
  await sleep(30000);
  check('with nothing selected and the switch off, no request goes to the bus feeds in 30 s', feedReqs(quietFrom).length === 0, feedReqs(quietFrom).map((r) => r.url));
  // on again, then hide the finder: everything stops
  await page.evaluate((id) => window.finderSelect(id), pick.id);
  await page.waitForFunction(() => window.finderState().route.bus >= 1, null, { timeout: 20000 }).catch(() => {});
  await page.click('.fd-livebuses input');
  await page.waitForFunction(() => window.finderState().liveBuses.active, null, { timeout: 30000 }).catch(() => {});
  await sleep(5000);
  await page.click('.fd-hide');
  await sleep(2500);
  const hiddenFrom = Date.now();
  await sleep(30000);
  s = await st();
  check('hiding the finder: no trip, no live layer, no live handle', s.view === 'pill' && !s.route.bus && !s.liveBuses.active && await page.evaluate(() => !window.__map.getLayer('transit-live-vehicles') && !window.__map.getLayer('finder-route-bus') || window.__map.getSource('finder-route')._data.features.length === 0), { view: s.view, route: s.route, liveBuses: s.liveBuses });
  check('and no request to the bus feeds in the 30 s after', feedReqs(hiddenFrom).length === 0, feedReqs(hiddenFrom).map((r) => r.url));
  await page.evaluate(() => window.finderOpen());
  await sleep(2000);

  // ── 4. modes: Walk asks nothing of the bus; Either has it back without searching again ──
  await page.click('.fd-mode[data-mode=walk]'); await sleep(1500);
  s = await st();
  check('Walk: no timetable bus in the list', s.bus.timetableLegs === 0, s.bus.timetableLegs);
  await page.click('.fd-mode[data-mode=either]'); await sleep(2500);
  s = await st();
  check('Either again: the timetable buses are back from the cache (no new searches)', s.bus.timetableLegs > 0 && s.bus.stats.searches === 0, s.bus.stats);
  await page.click('.fd-mode[data-mode=bus]'); await sleep(1500);
  note.busModeUnavailable = await page.$eval('.fd-unav', (n) => n.textContent);
  await shot('05-bus-mode');
  await page.click('.fd-mode[data-mode=either]'); await sleep(1000);

  // ── 5. the privacy rule, on the wire ─────────────────────────────────────────
  const home = await page.evaluate(() => window.finderState().selected);
  const homes = await (await fetch(BASE + '/data/finder/homes.json')).json();
  const h = homes.homes.find((x) => x.id === pick.id);
  const needles = [h.id, h.name, h.name.toLowerCase().replace(/ /g, '-'), h.p[0].toFixed(4), h.p[1].toFixed(4), 'CS', 'GDC'].filter((x) => x && x.length > 4);
  const bad = reqs.filter((r) => r.method !== 'GET' || r.body);
  check('every request is a bodiless GET', bad.length === 0, bad.map((r) => r.method + ' ' + r.url).slice(0, 5));
  const feed = reqs.filter((r) => /data\.texas\.gov/.test(r.url));
  check('the bus feeds were asked only for the two public files', feed.length > 0 && feed.every((r) => /^https:\/\/data\.texas\.gov\/api\/views\/(eiei-9rpf|rmk2-acnw)(\.json$|\/files\/[a-z0-9-]+\?filename=[a-z.]+$)/.test(r.url)), { n: feed.length, sample: [...new Set(feed.map((r) => r.url.replace(/files\/[a-z0-9-]+/, 'files/<id>')))] });
  const leak = reqs.filter((r) => !/\.(png|jpg|pbf|pmtiles|woff2?)(\?|$)/.test(r.url) && needles.some((n) => decodeURIComponent(r.url).includes(n) && !/^https?:\/\/[^/]+\/(data\/finder\/homes\.json|js\/|data\/apartments\/)/.test(r.url)));
  check('no request names the home, its coordinates or a class building', leak.length === 0, leak.map((r) => r.url).slice(0, 5));
  const towns = [...new Set(reqs.map((r) => new URL(r.url).host))];
  note.hosts = towns;
  check('no request URL carries a coordinate, stop, route or home parameter', !reqs.some((r) => /[?&](lat|lon|lng|stop|route|home)=/.test(r.url)), reqs.filter((r) => /[?&](lat|lon|lng|stop|route|home)=/.test(r.url)).map((r) => r.url).slice(0, 3));
  check('no page error', errors.length === 0, errors.slice(0, 5));
  await page.close();

  // ── 6. the walking pathfinder: one bus row under a long walk, none under a short one ──
  const wf = async (from, to) => {
    const p = await ctxB.newPage(); const rq = [];
    p.on('request', (r) => rq.push({ t: Date.now(), url: r.url(), method: r.method(), body: r.postData() || '' }));
    p.on('pageerror', (e) => errors.push('wf: ' + e.message));
    await p.addInitScript(() => { const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 50); });
    await p.goto(`${BASE}/index.html?intro=0&drift=0&finder=0&walk=1&from=${from}&to=${to}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => { const h = document.getElementById('wf-headline'); return h && /min/.test(h.textContent); }, null, { timeout: 240000 }).catch(() => {});
    return { p, rq };
  };
  {
    const { p, rq } = await wf('ADH', 'HCG');
    await p.waitForFunction(() => { const b = document.getElementById('wf-busrow'); return b && !b.hidden && b.textContent.length > 10; }, null, { timeout: 60000 }).catch(() => {});
    const r = await p.evaluate(() => ({ head: document.getElementById('wf-headline').textContent, row: document.getElementById('wf-busrow').textContent, hidden: document.getElementById('wf-busrow').hidden }));
    note.wayfindLong = r;
    check('long walk (ADH to HCG): one bus row is shown under it', !r.hidden && /^Bus to .* now: /.test(r.row), r);
    check('the row is a range, says timetable or live, gives no clock time and no promise', /\d+-\d+ min door to door/.test(r.row) && /\((timetable|live)\)/.test(r.row) && !/\b\d{1,2}:\d{2}\b|you will|guarantee/i.test(r.row), r.row);
    check('and it names the credit', /CapMetro/.test(r.row));
    await p.screenshot({ path: `${OUT}/06-wayfind-row.png` });
    const fd = rq.filter((x) => /data\.texas\.gov/.test(x.url));
    check('its downloads are the two public feeds only', fd.every((x) => /^https:\/\/data\.texas\.gov\/api\/views\/(eiei-9rpf|rmk2-acnw)/.test(x.url)) && rq.every((x) => x.method === 'GET' && !x.body), { feed: fd.length });
    check('no request names the buildings', !rq.some((x) => /[?&=\/](ADH|HCG)(&|$|\.|\/)/.test(x.url.replace(/from=ADH&to=HCG/, ''))), rq.filter((x) => /ADH|HCG/.test(x.url)).map((x) => x.url).slice(0, 3));
    // clearing the route stops the row's downloads
    await p.evaluate(() => { const b = document.querySelector('.wf-act-clr'); if (b) b.click(); });
    await sleep(2500);
    const from = Date.now(); await sleep(30000);
    const after = rq.filter((x) => x.t >= from && /data\.texas\.gov/.test(x.url));
    note.wayfindAfterClear = { rowHidden: await p.evaluate(() => document.getElementById('wf-busrow').hidden), feedRequests: after.length };
    check('clearing the route hides the row and stops its downloads', note.wayfindAfterClear.rowHidden && after.length === 0, note.wayfindAfterClear);
    await p.close();
  }
  {
    const { p, rq } = await wf('WEL', 'GDC');
    await sleep(15000);
    const r = await p.evaluate(() => ({ head: document.getElementById('wf-headline').textContent, hidden: document.getElementById('wf-busrow').hidden, text: document.getElementById('wf-busrow').textContent }));
    note.wayfindShort = r;
    check('short walk (WEL to GDC): no row at all, and the bus feeds were never asked', r.hidden && r.text === '' && rq.filter((x) => /data\.texas\.gov/.test(x.url)).length === 0, { r, feed: rq.filter((x) => /data\.texas\.gov/.test(x.url)).length });
    await p.screenshot({ path: `${OUT}/07-wayfind-short.png` });
    await p.close();
  }
  check('no page error in the walking pathfinder pages either', errors.length === 0, errors.slice(0, 5));
} finally {
  fs.writeFileSync(`${OUT}/finder-busmap.json`, JSON.stringify({ results, note }, null, 2));
  await browser.__done();
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL  finder-busmap: ${failed.length} of ${results.length} checks` : `PASS  finder-busmap: ${results.length} checks`);
process.exitCode = failed.length ? 1 : 0;
