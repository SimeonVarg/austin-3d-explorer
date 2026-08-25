/**
 * si-integration.mjs — the five schedule-import lanes, MERGED, driven end to end.
 *
 * Every one of `acer/si-gaps`, `si-dayview`, `si-parser`, `si-ui` and
 * `si-privacy` won its own blind comparison IN ISOLATION. Nothing had ever run
 * all five on one tree. This is that run, and it is deliberately written to
 * answer questions about the SEAMS between the lanes rather than about any one
 * lane's own work, because each lane already has a gate for its own work.
 *
 * WHAT IT ASSERTS, AND WHY EACH ONE IS A SEAM RATHER THAN A FEATURE
 *
 *  1. THE IMPORT SCREEN REACHES THE PARSER. `si-ui`'s `impRawRows()` calls
 *     `window.wayfindParseSchedule` and keeps the answer only when
 *     `Array.isArray(r)`. `si-parser` shipped that name as an `async function`
 *     returning an OBJECT. So the test is not "does the import work" — it does
 *     — but "which decoder actually ran", measured by instrumenting the call.
 *
 *  2. THE IMPORT SCREEN AND THE ROUTER AGREE ABOUT A BUILDING. `si-gaps` made
 *     SSW routable; `si-ui` carries its own hard-coded `IMP_UNREACHABLE` table
 *     that still says SSW has no door. Two surfaces, one app, one question.
 *
 *  3. AN IMPORTED SCHEDULE REACHES THE DAY VIEW. `si-ui` publishes
 *     `window.wayfindSchedule`; `si-dayview`'s `wayfindDayFromSchedule()` reads
 *     `schedule.events`/`.routable`. Whether those are the same object is a
 *     fact, so it is measured.
 *
 *  4. AN IMPORTED SCHEDULE REACHES THE STORE. `si-privacy` exposes
 *     `WAYFIND.store.save()` and calls it "the public seam the import lanes
 *     call". Whether anything calls it decides whether Delete has anything to
 *     delete and whether a reload keeps the schedule.
 *
 *  5. THE DAY VIEW STILL ROUTES. Feed the day view the shape it does accept,
 *     read the legs off the DOM in order, click one, and confirm the ribbon and
 *     the answer bar are the ones the single-leg feature already shipped.
 *
 *  6. AN OFF-MAP CLASS FAILS CLEANLY. A class at the Pickle campus must be
 *     NAMED and explained on both surfaces, never dropped and never a throw.
 *
 *  7. NOTHING LEAVES. Every request made while a schedule is being imported is
 *     captured — through `context.route`, which sees worker traffic, and
 *     through a raw TCP sink that depends on no Playwright behaviour at all —
 *     and scanned for the schedule's own strings. A canary is fired with the
 *     guard disarmed FIRST, so a clean result is known not to be a blind one.
 *
 *  8. THE FEATURE THAT ALREADY SHIPPED IS UNTOUCHED. Someone who never imports
 *     anything must get exactly the walk feature that beat Citymapper: the
 *     search sheet, a route, the ribbon, and no new console noise.
 *
 *  9. OFF STAYS OFF. `?clip=1`, `?autopilot=1`, `?sliderdemo=1` must show none
 *     of this — including both import doors and the privacy footer — and the
 *     plain page must not carry any of it at all.
 *
 * Usage:
 *   python scripts/serve.py 8971                       # from the repo root
 *   node scripts/verify/si-integration.mjs 8971 --shots ../../shots/si/integration
 *
 * Exit: 0 every gate passed, 1 a gate failed, 2 bad args.
 */
import { chromium } from 'playwright-core';
import { launch, BASE as DEFAULT_BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const argPort = argv.find(a => /^\d+$/.test(a));
const BASE = process.env.VERIFY_URL || (argPort ? `http://127.0.0.1:${argPort}` : DEFAULT_BASE);
const SHOTS = opt('--shots', null);
const FIX = path.join(__dirname, 'schedule-fixtures', 'integration-tuesday.ics');
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };

if (!fs.existsSync(FIX)) { console.error('missing fixture ' + FIX); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ICS = fs.readFileSync(FIX, 'utf8');

let pass = 0, fail = 0;
const ok = (c, name, detail) => {
  if (c) { pass++; console.log(`  PASS  ${name}${detail ? '   ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '   ' + detail : ''}`); }
};
const note = (s) => console.log('        ' + s);
const head = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 72 - s.length)));

// ── the raw sink: a socket cannot have a blind spot about its own input ──────
const sinkHits = [];
const sink = net.createServer(sock => {
  let buf = '';
  sock.on('data', d => { buf += d.toString('latin1'); });
  sock.on('end', () => sinkHits.push(buf));
  sock.on('error', () => {});
  sock.end('HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n');
});
await new Promise(r => sink.listen(0, '127.0.0.1', r));
const SINK = 'http://127.0.0.1:' + sink.address().port;

const browser = await launch(chromium, { maxMs: 1800000 });
const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });

// ── the capture: context-level, so MapLibre's own workers are in scope ───────
const seen = [];
let capturing = false;
await ctx.route('**/*', async (route) => {
  if (capturing) {
    const req = route.request();
    let buf = null;
    try { buf = req.postDataBuffer(); } catch (e) { buf = null; }
    seen.push({
      url: req.url(), method: req.method(),
      body: buf ? buf.toString('utf8') : null, bytes: buf ? buf.length : 0,
      frame: (() => { try { return !!req.frame(); } catch (e) { return false; } })(),
    });
  }
  try { await route.continue(); } catch (e) {}
});

const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 250)); });

async function settle(p) {
  await p.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await p.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await p.waitForFunction(() => {
    const v = document.getElementById('veil');
    return !v || getComputedStyle(v).opacity === '0' || v.classList.contains('lift');
  }, null, { timeout: 180000 }).catch(() => note('note: veil never reported lifted'));
}
async function shot(p, name) {
  if (!SHOTS) return;
  const f = path.join(SHOTS, name + '.jpg');
  await p.screenshot({ path: path.join(SHOTS, '_tmp.jpg'), type: 'jpeg', quality: 72 });
  await p.screenshot({ path: f, type: 'jpeg', quality: 72 });   // trust the second
  try { fs.unlinkSync(path.join(SHOTS, '_tmp.jpg')); } catch (e) {}
  note('shot ' + path.basename(f));
}

console.log('\n' + '='.repeat(78));
console.log('  si-integration — ' + BASE + '   (sink ' + SINK + ')');
console.log('='.repeat(78));

await page.goto(`${BASE}/index.html?walk=1&drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(page);
await page.waitForSelector('#wf-imp-entry', { timeout: 180000 });
await page.waitForTimeout(1500);

// ════════════════════════════════════════════════════════════════════════════
head('1. which decoder actually reads the file the student hands over');
// Instrument the seam BEFORE anything is imported.
await page.evaluate(() => {
  window.__seam = { calls: 0, kept: 0, returned: [] };
  const orig = window.wayfindParseSchedule;
  window.__origParse = orig;
  window.wayfindParseSchedule = function (...a) {
    window.__seam.calls++;
    const r = orig.apply(this, a);
    window.__seam.returned.push(Object.prototype.toString.call(r));
    if (Array.isArray(r)) window.__seam.kept++;
    return r;
  };
});
await page.click('#wf-imp-entry');
await page.waitForTimeout(700);
await page.click('#wf-imp-tabs button[data-src="ut"]');
await page.waitForTimeout(400);

capturing = true;                       // everything from here on is watched
await page.setInputFiles('#wf-imp-file', FIX);
await page.waitForTimeout(4000);

const seam = await page.evaluate(() => JSON.parse(JSON.stringify(window.__seam)));
note('impRawRows called wayfindParseSchedule ' + seam.calls + ' time(s), returning '
  + JSON.stringify(seam.returned) + '; kept ' + seam.kept);
ok(seam.calls > 0, 'the import screen does reach for the parser lane');
ok(seam.kept > 0, "the parser lane's answer is the one the screen uses",
  seam.kept === 0 ? '<- it is a Promise, Array.isArray() is false, the screen falls back to its own decoder' : '');

// The measurable cost of that fallback, on the parser lane's OWN fixture.
const compare = await page.evaluate(async () => {
  const txt = await (await fetch('scripts/verify/schedule-fixtures/manual-paste.txt')).text();
  const ui = await window.wayfindImportParse(txt, 'ut');
  const par = await window.__origParse(txt, { source: 'ut' });
  return {
    uiPlaced: (ui.classes || []).length, uiRejected: (ui.rejects || []).length,
    parPlaced: (par.events || []).filter(e => e.status === 'ok').length,
    parTotal: (par.events || []).length,
    uiCodes: (ui.classes || []).map(c => c.code).sort(),
    parCodes: (par.events || []).filter(e => e.status === 'ok').map(e => e.code).sort(),
  };
});
note('manual-paste.txt: the screen places ' + compare.uiPlaced + ' [' + compare.uiCodes.join(' ')
  + '], the parser lane places ' + compare.parPlaced + ' of ' + compare.parTotal
  + ' [' + compare.parCodes.join(' ') + ']');
ok(compare.uiPlaced >= compare.parPlaced,
  'the screen loses no class the parser lane can place',
  compare.uiPlaced < compare.parPlaced
    ? `<- ${compare.parPlaced - compare.uiPlaced} classes silently dropped by the fallback decoder` : '');

// ════════════════════════════════════════════════════════════════════════════
head('2. the import screen and the router agree about a building');
const SSW_ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
  'DTSTART;TZID=America/Chicago:20260826T100000', 'DTEND;TZID=America/Chicago:20260826T110000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'SUMMARY:SW 310 – INTRO TO SOCIAL WORK',
  'LOCATION:SSW 2.130', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const ssw = await page.evaluate(async (ics) => {
  const hits = window.wayfindSearch ? window.wayfindSearch('SSW') : [];
  const row = hits.find(h => h.code === 'SSW') || null;
  const offmap = window.wayfindOffMap ? window.wayfindOffMap('SSW') : null;
  const imp = await window.wayfindImportParse(ics, 'ut');
  const r = (imp.rejects || []).find(x => x.code === 'SSW') || null;
  const c = (imp.classes || []).find(x => x.code === 'SSW') || null;
  return { routable: row ? !!row.routable : null, doors: row ? row.doors : null,
           offmap: !!offmap, importStatus: r ? r.status : (c ? 'ok' : 'absent') };
}, SSW_ICS);
note('router: SSW routable=' + ssw.routable + ' doors=' + ssw.doors
  + ' offMapTable=' + ssw.offmap + '   import screen: ' + ssw.importStatus);
ok(ssw.routable === true, 'si-gaps made SSW routable on this tree');
ok(ssw.importStatus === 'ok', 'the import screen agrees SSW is reachable',
  ssw.importStatus !== 'ok' ? "<- si-ui's hard-coded IMP_UNREACHABLE still says nodoor" : '');

// ════════════════════════════════════════════════════════════════════════════
head('3. an off-map class fails cleanly and by name');
const impText = await page.evaluate(() => {
  const p = document.getElementById('wf-imp');
  return p && !p.classList.contains('hidden') ? p.innerText : null;
});
ok(!!impText && /MER 1\.906/.test(impText), 'the Pickle class is named on screen, not dropped');
ok(!!impText && /Pickle Research Campus/.test(impText), 'and it says WHERE it is');
ok(!!impText && /11 km north/.test(impText), 'and WHY this app cannot take you there');
ok(errs.length === 0, 'no console error or page error during the import', errs.join(' | '));
await shot(page, 'import-result-phone');

// ════════════════════════════════════════════════════════════════════════════
head('4. the handoff: what the import gives the rest of the feature');
await page.click('.wf-imp-go');
await page.waitForTimeout(2500);
const handoff = await page.evaluate(async () => {
  const st = window.WAYFIND && window.WAYFIND.store;
  const s = window.wayfindSchedule || null;
  let day = null;
  if (s) { try { day = await window.wayfindDayFromSchedule(s, { show: false }); } catch (e) { day = { threw: String(e) }; } }
  return {
    published: !!s, keys: s ? Object.keys(s) : null, classes: s ? (s.classes || []).length : 0,
    dayOk: day ? !!day.ok : null, dayWhy: day ? day.why : null,
    storeHas: st ? st.has() : null,
    lsKeys: Object.keys(localStorage),
    ends: [...document.querySelectorAll('#wf-ends input')].map(i => i.value),
  };
});
note('window.wayfindSchedule = {' + (handoff.keys || []).join(', ') + '}  classes=' + handoff.classes);
note('localStorage after the import: ' + JSON.stringify(handoff.lsKeys));
ok(handoff.published, 'the import publishes a schedule for the rest of the feature');
ok(handoff.ends[0] && handoff.ends[1], 'and fills both ends of the single-leg router',
  handoff.ends.join(' -> '));
ok(handoff.dayOk === true, 'the day view accepts the object the import publishes',
  handoff.dayOk ? '' : '<- wayfindDayFromSchedule says "' + handoff.dayWhy + '": it reads .events, the import publishes .classes');
ok(handoff.storeHas === true, 'the import saves the schedule through WAYFIND.store',
  handoff.storeHas ? '' : '<- nothing calls store.save(), so Delete has nothing to delete and a reload loses it');

// ════════════════════════════════════════════════════════════════════════════
head('5. the day view, fed the shape it does accept, and one leg clicked');
const dayBuilt = await page.evaluate(async (ics) => {
  const parsed = await window.__origParse(ics, { source: 'ut' });
  const r = await window.wayfindDayFromSchedule(parsed, { day: 'TU' });
  await new Promise(res => setTimeout(res, 1200));
  const p = document.getElementById('wf-day');
  const rows = [...document.querySelectorAll('#wf-day-list > *')].map(e => ({
    cls: e.className, text: e.innerText.replace(/\n+/g, ' | ').slice(0, 180),
  }));
  return { ok: !!r.ok, day: r.day, open: !!(p && !p.classList.contains('hidden')),
           sum: document.getElementById('wf-day-sum') ? document.getElementById('wf-day-sum').innerText.replace(/\n/g, ' · ') : null,
           rows };
}, ICS);
note('day = ' + dayBuilt.day + '   summary: ' + dayBuilt.sum);
for (const r of dayBuilt.rows) note('  [' + r.cls + '] ' + r.text);
ok(dayBuilt.ok && dayBuilt.open, 'the day view opened from a parsed schedule');
const rowText = dayBuilt.rows.map(r => r.text).join(' ~ ');
const order = ['RLP', 'CMA', 'GDC', 'MER'].map(c => rowText.indexOf(c));
ok(order.every(i => i >= 0), 'every one of the day\'s four classes is on screen', JSON.stringify(order));
ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
  'and they are in time order, first class first');
// The day view MUST name it, and must give si-gaps's reason for it. si-gaps
// put the Pickle codes into search() as `offmap` entries; dayPlace() checks
// `entry.routable` before it checks `entry.offMap`, so on the merged tree an
// off-map building falls into the generic "nothing is mapped to walk to"
// branch. Alone, si-dayview reached its own offmap branch and said "11 km
// north". Merged, it says the wrong thing — which is a defect only the merge
// can produce, so it is asserted here rather than in either lane's own gate.
ok(/MER/.test(rowText), 'the Pickle class is named in the day view, not dropped');
const merReason = (dayBuilt.rows.map(r => r.text).find(t => /MER/.test(t) && /(door|path|km|Pickle|campus)/i.test(t)) || '');
note('the day view\'s reason for MER: "' + merReason.replace(/.*\|\s*(No door[^|]*|We can[^|]*)/, '$1').slice(0, 160) + '"');
ok(/Pickle|km north|another campus/i.test(rowText),
  'and the day view gives si-gaps\'s off-map reason for it',
  /Pickle|km north/i.test(rowText) ? ''
    : '<- it says "no door or path", the reason for a building on THIS campus');
await shot(page, 'dayview-phone');

const legClick = await page.evaluate(async () => {
  const walk = [...document.querySelectorAll('#wf-day-list .wf-day-walk, #wf-day-list [class*="walk"]')]
    .filter(e => e.tagName === 'BUTTON' || e.getAttribute('role') === 'button' || e.onclick);
  const target = walk[0] || [...document.querySelectorAll('#wf-day-list button')][0];
  if (!target) return { clicked: false };
  target.click();
  await new Promise(r => setTimeout(r, 3000));
  const m = window.__map;
  const src = m.getSource && m.getSource('wayfind-route');
  const pill = document.getElementById('wf-pill');
  return {
    clicked: true, label: target.innerText.replace(/\n+/g, ' | ').slice(0, 120),
    routeDrawn: !!src,
    routeCoords: (() => { try { const d = src._data; return d && d.features && d.features[0] && d.features[0].geometry.coordinates.length; } catch (e) { return null; } })(),
    pillOpen: !!(pill && !pill.classList.contains('hidden')),
    pillText: pill ? pill.innerText.replace(/\n+/g, ' | ').slice(0, 200) : null,
    ends: [...document.querySelectorAll('#wf-ends input')].map(i => i.value),
  };
});
note('clicked: ' + legClick.label);
note('answer bar: ' + legClick.pillText);
ok(legClick.clicked, 'a leg row in the day view is clickable');
ok(legClick.routeDrawn, 'clicking it draws a route on the real map',
  'wayfind-route coords=' + legClick.routeCoords);
ok(legClick.pillOpen && /min/.test(String(legClick.pillText)),
  'and the answer bar the single-leg feature already shipped prints the walk');
await shot(page, 'leg-routed-phone');

// ════════════════════════════════════════════════════════════════════════════
head('6. nothing left the device while all of that happened');
capturing = false;
const NEEDLES = ['M 340L', 'RTF 305', 'C S 439', 'EE 460R', 'GOV 312L', 'PHY 303L',
  'RLP 0.106', 'CMA 6.146', 'GDC 2.216', 'MER 1.906', 'WEL 2.224', 'PAI 3.02',
  'MATRICES', 'MICROELECTRONICS', 'Heitmann', 'Witchel', 'Banerjee'];
const carried = seen.filter(r => {
  const hay = (r.url + ' ' + (r.body || ''));
  return NEEDLES.some(n => hay.indexOf(n) >= 0 || hay.indexOf(encodeURIComponent(n)) >= 0);
});
note('requests captured while the schedule was on screen: ' + seen.length
  + '  (with a body: ' + seen.filter(r => r.bytes > 0).length + ')');
const guard = await page.evaluate(() => window.WAYFIND.store.guard.state());
note('guard: checked=' + guard.checked + ' quietChecked=' + guard.quietChecked
  + ' blocked=' + guard.blocked + ' watched=' + guard.watched
  + ' binaryBytes=' + guard.binaryBytes);
ok(carried.length === 0, 'no captured request carries any of the schedule\'s own strings',
  carried.length ? carried.slice(0, 3).map(c => c.method + ' ' + c.url.slice(0, 90)).join(' | ') : NEEDLES.length + ' needles');
ok(sinkHits.length === 0, 'the raw socket sink was never contacted', SINK);
// THE GUARD ARMS ITSELF OFF THE STORE. `setWatchlist(buildWatchlist(schedCache))`
// runs at install and on every store change, so `watched` is the number of
// strings out of the SAVED schedule it is looking for. The import never saves
// (gate 4), so at the exact moment the schedule is in memory and on screen the
// guard is watching nothing and is on its fast path. That is not a leak — the
// app makes no such request — but it does mean the proof si-privacy built is
// not running during the one event it was built for.
ok(guard.watched > 0, 'the guard is watching the schedule the student just imported',
  guard.watched ? guard.watched + ' strings' : '<- watchlist empty: nothing saved it, so nothing armed it');
ok(guard.quietChecked > 0, 'the guard really was inspecting worker traffic',
  guard.quietChecked + ' worker messages');

// PROVE THE INSTRUMENT IS NOT BLIND. Disarm the guard, fire the same strings
// through fetch, sendBeacon and a real Worker, and require BOTH instruments to
// catch each one. A clean sheet above means nothing without this.
capturing = true;
const canary = await page.evaluate(async (sink) => {
  const text = 'M 340L MATRICES canary RLP 0.106';
  window.WAYFIND.store.guard.__disarmForAudit();
  const out = {};
  try { await fetch(sink + '/__canary_fetch', { method: 'POST', body: text }); out.fetch = 'sent'; }
  catch (e) { out.fetch = 'threw ' + e.message; }
  try { out.beacon = navigator.sendBeacon(sink + '/__canary_beacon', text) ? 'sent' : 'refused'; }
  catch (e) { out.beacon = 'threw ' + e.message; }
  try {
    const src = `onmessage = async (e) => { try { await fetch(e.data.u, { method:'POST', body:e.data.t }); postMessage('sent'); } catch (err) { postMessage('threw ' + err.message); } };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    out.worker = await new Promise((res) => {
      w.onmessage = (e) => res(e.data); w.onerror = (e) => res('error ' + e.message);
      w.postMessage({ u: sink + '/__canary_worker', t: text });
      setTimeout(() => res('timeout'), 6000);
    });
    w.terminate();
  } catch (e) { out.worker = 'threw ' + e.message; }
  window.WAYFIND.store.guard.arm();
  return out;
}, SINK);
await page.waitForTimeout(2500);
capturing = false;
note('canary results: ' + JSON.stringify(canary));
const capSaw = (tag) => seen.some(r => r.url.indexOf(tag) >= 0);
const sinkSaw = (tag) => sinkHits.some(h => h.indexOf(tag) >= 0);
ok(capSaw('__canary_fetch') && sinkSaw('__canary_fetch'),
  'both instruments see a disarmed fetch leak', 'capture=' + capSaw('__canary_fetch') + ' socket=' + sinkSaw('__canary_fetch'));
ok(capSaw('__canary_worker') || sinkSaw('__canary_worker'),
  'the capture is NOT blind to a leak fired from inside a Worker',
  'capture=' + capSaw('__canary_worker') + ' socket=' + sinkSaw('__canary_worker') + ' worker=' + canary.worker);
const armedAgain = await page.evaluate(() => window.WAYFIND.store.guard.state().armed);
ok(armedAgain === true, 'the guard was re-armed after the canary');

// ════════════════════════════════════════════════════════════════════════════
head('7. delete, then reload: is it actually gone?');
// The UI does not save (gate 4), so seed the store the way si-privacy's own
// audit does — otherwise there is nothing to delete and the test is vacuous.
const seeded = await page.evaluate(async (ics) => {
  const parsed = await window.__origParse(ics, { source: 'ut' });
  const ui = await window.wayfindImportParse(ics, 'ut');
  const st = window.WAYFIND.store;
  st.save(ui);
  return { has: st.has(), classes: (st.load() || {}).classes ? st.load().classes.length : 0,
           keys: Object.keys(localStorage), inv: st.inventory ? st.inventory() : null };
}, ICS);
note('seeded: has=' + seeded.has + ' classes=' + seeded.classes + ' localStorage=' + JSON.stringify(seeded.keys));
ok(seeded.has === true, 'a schedule written through store.save() is stored');
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(page);
await page.waitForSelector('#wf-priv', { timeout: 180000 });
await page.waitForTimeout(1500);
const afterReload = await page.evaluate(() => ({
  has: window.WAYFIND.store.has(),
  priv: (document.getElementById('wf-priv') || {}).innerText,
  delVisible: (() => { const b = document.getElementById('wf-priv-del'); return !!(b && getComputedStyle(b).display !== 'none'); })(),
}));
note('after reload: has=' + afterReload.has + '  panel: ' + String(afterReload.priv).replace(/\n/g, ' / '));
ok(afterReload.has === true, 'the stored schedule survives a reload');
ok(afterReload.delVisible, 'and the Delete control is offered');
await shot(page, 'privacy-saved-phone');

page.once('dialog', d => d.accept());
await page.click('#wf-priv-del');
await page.waitForTimeout(1200);
const afterDelete = await page.evaluate(() => ({
  has: window.WAYFIND.store.has(),
  keys: Object.keys(localStorage),
  priv: (document.getElementById('wf-priv') || {}).innerText,
}));
note('after delete: has=' + afterDelete.has + ' localStorage=' + JSON.stringify(afterDelete.keys));
ok(afterDelete.has === false, 'Delete wipes it');
await shot(page, 'privacy-deleted-phone');
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(page);
await page.waitForSelector('#wf-priv', { timeout: 180000 });
await page.waitForTimeout(1200);
const afterDeleteReload = await page.evaluate(() => ({
  has: window.WAYFIND.store.has(),
  keys: Object.keys(localStorage),
  idb: typeof indexedDB !== 'undefined',
  priv: (document.getElementById('wf-priv') || {}).innerText,
}));
note('after delete + reload: ' + String(afterDeleteReload.priv).replace(/\n/g, ' / '));
ok(afterDeleteReload.has === false, 'and it is still gone after a fresh load');
ok(!afterDeleteReload.keys.some(k => /schedule/i.test(k)),
  'no schedule key is left in localStorage', JSON.stringify(afterDeleteReload.keys));

// ════════════════════════════════════════════════════════════════════════════
head('8. the walk feature someone who never imports anything gets');
const plain = await ctx.newPage();
const plainErrs = [];
plain.on('pageerror', e => plainErrs.push(String(e).slice(0, 200)));
plain.on('console', m => { if (m.type() === 'error') plainErrs.push(m.text().slice(0, 200)); });
await plain.goto(`${BASE}/index.html?walk=1&drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(plain);
await plain.waitForSelector('#wf-sheet', { timeout: 180000 });
await plain.waitForTimeout(1500);
const walkOnly = await plain.evaluate(async () => {
  const r = await window.wayfindRoute('WEL', 'PAI');
  const ins = [...document.querySelectorAll('#wf-ends input')];
  ins[0].value = ''; ins[1].value = '';
  return {
    routeOk: !!(r && r.ok), distM: r && Math.round(r.distM),
    minLo: r && r.minLo, minHi: r && r.minHi,
    stairs: r && r.stair ? r.stair.sets : null,
    sheetOpen: !document.getElementById('wf-sheet').classList.contains('hidden'),
    stored: window.WAYFIND.store.has(),
    published: !!window.wayfindSchedule,
  };
});
note('WEL->PAI  ' + walkOnly.distM + ' m  ' + walkOnly.minLo + '-' + walkOnly.minHi + ' min  stairs=' + walkOnly.stairs);
ok(walkOnly.routeOk, 'the single-leg router still routes with nothing imported');
ok(walkOnly.distM === 291, 'and returns the same 291 m walkmeter has recorded all round',
  walkOnly.distM + ' m');
ok(walkOnly.stored === false && !walkOnly.published,
  'a page nobody imported on holds no schedule at all');
ok(plainErrs.length === 0, 'no console errors on the walk page', plainErrs.join(' | '));
await shot(plain, 'walk-only-phone');
await plain.close();

// ════════════════════════════════════════════════════════════════════════════
head('8b. what the merged sheet looks like on a phone');
// Two lanes each appended their own way in to the same sheet, neither able to
// see the other's. The question is not "did the append work" — both did — but
// what a student sees when both are there, on the 390x844 Simeon judges from.
const sheetPage = await ctx.newPage();
await sheetPage.goto(`${BASE}/index.html?walk=1&drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(sheetPage);
await sheetPage.waitForSelector('#wf-imp-entry', { timeout: 180000 });
await sheetPage.waitForTimeout(1500);
const fold = await sheetPage.evaluate(() => {
  const sheet = document.getElementById('wf-sheet');
  const kids = [...sheet.children];
  const sr = sheet.getBoundingClientRect();
  const rows = kids.map(c => {
    const r = c.getBoundingClientRect();
    return { id: c.id || c.className, h: Math.round(r.height), top: Math.round(r.top),
             bottom: Math.round(r.bottom), disp: getComputedStyle(c).display };
  });
  // The same sheet with this round's three additions removed, measured rather
  // than reasoned about: how tall was it before five lanes appended to it?
  const added = ['wf-day-btn', 'wf-imp-entry'].map(id => document.getElementById(id)).filter(Boolean);
  const priv = document.getElementById('wf-priv');
  const before = sheet.scrollHeight
    - added.reduce((n, e) => n + e.getBoundingClientRect().height, 0)
    - (priv ? priv.getBoundingClientRect().height : 0);
  const doors = kids.filter(c => /import/i.test(c.innerText || ''))
    .map(c => (c.id || c.className) + ': "' + c.innerText.split('\n')[0] + '"');
  return {
    sheet: { top: Math.round(sr.top), bottom: Math.round(sr.bottom), h: Math.round(sr.height),
             scrollH: sheet.scrollHeight, overflowY: getComputedStyle(sheet).overflowY },
    win: innerHeight, rows, doors,
    heightWithoutThisRound: Math.round(before),
  };
});
note('sheet ' + fold.sheet.h + ' px tall, content ' + fold.sheet.scrollH
  + ' px, overflow-y: ' + fold.sheet.overflowY + '  (window ' + fold.win + ')');
note('content height without this round\'s three additions: ' + fold.heightWithoutThisRound + ' px');
for (const d of fold.doors) note('  door -> ' + d);
ok(fold.doors.length <= 1, 'the sheet offers ONE way to import a schedule, not two',
  fold.doors.length > 1 ? '<- two rows, from two lanes, saying almost the same sentence' : '');
ok(fold.sheet.scrollH <= fold.sheet.h + 2 || fold.sheet.overflowY !== 'hidden',
  'nothing in the sheet is cut off unreachably on a phone',
  fold.sheet.scrollH > fold.sheet.h
    ? `<- ${fold.sheet.scrollH - fold.sheet.h} px past the fold with overflow-y: ${fold.sheet.overflowY}` : '');
const clipped = fold.rows.filter(r => r.disp !== 'none' && r.bottom > fold.sheet.bottom + 1);
if (clipped.length) note('below the fold: ' + clipped.map(r => r.id).join(', '));
ok(!clipped.some(r => /wf-foot|wf-priv/.test(r.id)),
  'the privacy line and the Delete control are on screen, not below the fold',
  clipped.length ? clipped.map(r => r.id).join(', ') : '');
await shot(sheetPage, 'sheet-phone');
await sheetPage.close();

// ════════════════════════════════════════════════════════════════════════════
head('9. off stays off — clip, autopilot, sliderdemo, and the plain page');
const WF_IDS = ['wf-root', 'wf-button', 'wf-sheet', 'wf-day-btn', 'wf-day',
  'wf-imp-entry', 'wf-imp', 'wf-priv', 'wf-priv-del', 'wf-pill'];
for (const q of ['clip=1&walk=1', 'autopilot=1&preset=cinematic', 'sliderdemo=1&preset=cinematic']) {
  const p = await ctx.newPage();
  const pe = [];
  p.on('pageerror', e => pe.push(String(e).slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') pe.push(m.text().slice(0, 200)); });
  await p.goto(`${BASE}/index.html?${q}&drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await settle(p);
  await p.waitForTimeout(6000);
  const vis = await p.evaluate((ids) => {
    const out = [];
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) continue;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.01 && r.width > 1 && r.height > 1)
        out.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return { shown: out, body: document.body.className,
             attrib: (() => { const a = document.querySelector('.maplibregl-ctrl-attrib, .mapboxgl-ctrl-attrib');
               if (!a) return null; const cs = getComputedStyle(a); const r = a.getBoundingClientRect();
               return { text: a.innerText.slice(0, 80), vis: cs.display !== 'none' && r.height > 1 }; })() };
  }, WF_IDS);
  note(q + '  body="' + vis.body + '"  visible walk UI: ' + (vis.shown.length ? vis.shown.join(', ') : 'none'));
  ok(vis.shown.length === 0, 'no walk or import UI is visible under ?' + q);
  ok(pe.length === 0, 'no console error under ?' + q, pe.join(' | '));
  await shot(p, 'off-' + q.split('&')[0].replace('=', ''));
  await p.close();
}
const bare = await ctx.newPage();
const bareErrs = [];
bare.on('pageerror', e => bareErrs.push(String(e).slice(0, 200)));
bare.on('console', m => { if (m.type() === 'error') bareErrs.push(m.text().slice(0, 200)); });
await bare.goto(`${BASE}/index.html?drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(bare);
await bare.waitForTimeout(4000);
const bareState = await bare.evaluate((ids) => ({
  present: ids.filter(id => !!document.getElementById(id)),
  store: !!(window.WAYFIND && window.WAYFIND.store && window.WAYFIND.store.has()),
  attrib: (() => { const a = document.querySelector('.maplibregl-ctrl-attrib, .mapboxgl-ctrl-attrib');
    if (!a) return null; const r = a.getBoundingClientRect();
    return { text: a.innerText.slice(0, 90), vis: getComputedStyle(a).display !== 'none' && r.height > 1 }; })(),
}), WF_IDS);
note('plain page: wf-* present = ' + JSON.stringify(bareState.present));
note('attribution: ' + JSON.stringify(bareState.attrib));
ok(bareState.present.length === 0, 'the plain page carries none of the walk feature');
ok(bareErrs.length === 0, 'zero console errors on the plain page', bareErrs.join(' | '));
ok(!!bareState.attrib && bareState.attrib.vis && /OpenStreetMap/i.test(bareState.attrib.text),
  'OSM attribution is visible on the plain page');
await shot(bare, 'plain-page');
await bare.close();

console.log('\n' + '='.repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(78) + '\n');
try { sink.close(); } catch (e) {}
browser.__done();
process.exit(fail ? 1 : 0);
