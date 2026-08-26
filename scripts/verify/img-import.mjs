/**
 * img-import.mjs — the gate for the PHOTO route of the shipped import sheet.
 *
 *   node scripts/verify/img-import.mjs            (starts its own server)
 *   node scripts/verify/img-import.mjs --shots ../../shots/img-integrate
 *
 * `scripts/verify/schedimg.mjs` gates the reader and `schedconfirm.mjs` gates
 * the screen that asks. Neither of them touches `js/wayfind.js`, so neither can
 * answer the only question this piece is about: **does a photograph end up in
 * the same place a calendar file ends up?**
 *
 * TEN THINGS, and each is a seam rather than a feature.
 *
 *  1. THE SHEET STILL HAS ONE DOOR. `WF_DOOR.mode === 'one'` was a decision
 *     Simeon made on 2026-08-25 and the sheet fits a 390x844 phone with 2 px to
 *     spare. A fourth import source must not cost either.
 *  2. THE PHOTO ROUTE IS A TAB, NOT A MODE. Four tabs, one panel, the same
 *     control shape, and the panel still fits the phone.
 *  3. IT COSTS THE COLD LOAD NOTHING. Not one byte of `schedconfirm`,
 *     `schedimg`, `walkgraph` or the ~5 MB OCR engine may be fetched before a
 *     student picks a file. Asserted at the network level on the real page.
 *  4. A PICTURE REACHES THE SAME PLACE AN .ICS REACHES. `store.save()`,
 *     `window.wayfindSchedule`, the `wayfind:schedule` event, the day view, the
 *     privacy panel's own count and the delete control — all of it, from one
 *     photograph, with no second path anywhere.
 *  5. WHAT NOBODY CHECKED SAYS SO, AND KEEPS SAYING SO AFTER A RELOAD. A class
 *     whose question went unanswered is stored under `confidence: 1` and is
 *     marked on the day view; a class with no doubt at all is not.
 *  6. NOTHING LEAVES. Every request from the moment the picture is handed over
 *     is captured — context-level, so the OCR worker's own fetches are in scope
 *     — and cross-checked against a raw TCP sink. Then both instruments are
 *     proved not blind with a canary through `fetch` and through a real Worker.
 *  7. A RELOAD KEEPS IT, including which fields were never checked.
 *  8. THE MARK IS A CONTROL. A class the reader was unsure of can be answered —
 *     corrected, or confirmed as read — from the day view, on a schedule that
 *     came off disk, without re-photographing anything. Before this the chip
 *     was a dead end: delete the whole schedule or live with it forever.
 *  9. DELETE STILL MEANS GONE, for a schedule that came from a photograph.
 * 10. A HEIC FAILS AS A FORMAT. The default iPhone camera format gets a
 *     sentence about the format, before the ~5 MB reader is fetched — not the
 *     generic "that picture could not be read" it used to get.
 *
 * Exit: 0 all gates passed, 1 a gate failed.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SHOTS = opt('--shots', null);
if (SHOTS) fs.mkdirSync(path.resolve(HERE, SHOTS), { recursive: true });
const SHOTDIR = SHOTS ? path.resolve(HERE, SHOTS) : null;

// 01 is the clean registrar table: it reads at 14/14 and it carries `MER
// 1.906`, a real UT building at the Pickle campus, so ONE run exercises the
// placed path, the off-map reject path and an unanswered question at once.
const IMAGE = opt('--image', '01-ut-table-clean.jpg');

let pass = 0, fail = 0;
const ok = (c, name, detail) => {
  if (c) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
};
const note = s => console.log('        ' + s);
const head = s => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 70 - s.length)));

// ── a socket that cannot have a blind spot about its own input ──────────────
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

// ── the server ──────────────────────────────────────────────────────────────
let server = null;
let BASE = process.env.VERIFY_URL || null;
if (!BASE) {
  const port = await new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
  // NEVER `python -m http.server`: it ignores `Range:` and every PMTiles layer
  // on the real page silently vanishes.
  server = spawn(process.env.PYTHON || 'python',
    [path.join(ROOT, 'scripts', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore' });
  BASE = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(BASE + '/index.html'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }
}
const stopServer = () => { try { if (server && !server.killed) server.kill(); } catch (e) {} };
process.once('exit', stopServer);
process.once('SIGINT', () => { stopServer(); process.exit(130); });
process.once('SIGTERM', () => { stopServer(); process.exit(143); });

const browser = await launch(chromium, { maxMs: Number(process.env.VERIFY_MAX_MS || 1800000) });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
});

const seen = [];
let capturing = true;
await ctx.route('**/*', async (route) => {
  if (capturing) {
    const req = route.request();
    let body = null;
    try { const b = req.postDataBuffer(); body = b ? b.toString('utf8') : null; } catch (e) {}
    seen.push({ url: req.url(), method: req.method(), body, bytes: body ? body.length : 0 });
  }
  try { await route.continue(); } catch (e) {}
});

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 250)); });

async function shot(p, name) {
  if (!SHOTDIR) return;
  const f = path.join(SHOTDIR, name + '.jpg');
  await p.screenshot({ path: path.join(SHOTDIR, '_tmp.jpg'), type: 'jpeg', quality: 72 });
  await p.screenshot({ path: f, type: 'jpeg', quality: 72 });    // trust the second
  try { fs.unlinkSync(path.join(SHOTDIR, '_tmp.jpg')); } catch (e) {}
  note('shot ' + path.basename(f));
}
const clickIn = (p, sel, re) => p.evaluate(([s, src]) => {
  const rx = new RegExp(src, 'i');
  const b = [...document.querySelectorAll(s + ' button')]
    .find(x => rx.test((x.textContent || '').trim()));
  if (!b) return false;
  b.click(); return true;
}, [sel, re.source]);

console.log('\n' + '='.repeat(78));
console.log('  img-import — ' + BASE + '   (sink ' + SINK + ')   image ' + IMAGE);
console.log('='.repeat(78));

// ════════════════════════════════════════════════════════════════════════════
head('1. the cold load pays nothing for a feature most sessions never use');
await page.goto(BASE + '/index.html?walk=1&drift=0', { waitUntil: 'load', timeout: 180000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForSelector('#wf-imp-entry', { timeout: 180000 });
await page.waitForTimeout(1500);

const READER = /schedconfirm|schedimg|walkgraph|tesseract|traineddata|\.wasm(\?|$)/i;
const atLoad = seen.filter(r => READER.test(r.url));
note(seen.length + ' requests while the page loaded');
ok(atLoad.length === 0, 'not one byte of the reader or its engine is fetched at page load',
  atLoad.length ? atLoad.slice(0, 4).map(r => r.url.slice(-60)).join(' | ')
    : 'nothing matching schedconfirm/schedimg/walkgraph/tesseract/wasm');
const html = await (await fetch(BASE + '/index.html')).text();
ok(!/schedconfirm|schedimg|walkgraph/.test(html),
  'and none of the three modules is referenced from index.html',
  'the only way in is a dynamic import() at the moment a file is picked');

// ════════════════════════════════════════════════════════════════════════════
head('2. the sheet still offers ONE door, and it still fits the phone');
const sheet = await page.evaluate(() => {
  const s = document.getElementById('wf-sheet');
  const kids = [...s.children];
  const r = s.getBoundingClientRect();
  const doors = kids.filter(c => /schedule/i.test(c.innerText || '') && c.tagName === 'BUTTON')
    .map(c => (c.id || c.className) + ': "' + (c.innerText || '').split('\n')[0] + '"');
  return {
    h: Math.round(r.height), scrollH: s.scrollHeight, bottom: Math.round(r.bottom),
    overflowY: getComputedStyle(s).overflowY, win: innerHeight, doors,
    clipped: kids.filter(c => getComputedStyle(c).display !== 'none' &&
      c.getBoundingClientRect().bottom > r.bottom + 1).map(c => c.id || c.className),
  };
});
note('sheet ' + sheet.h + ' px tall holding ' + sheet.scrollH + ' px  (window ' + sheet.win + ')');
for (const d of sheet.doors) note('  door -> ' + d);
ok(sheet.doors.length === 1, 'the sheet offers ONE way into the schedule feature, not two',
  sheet.doors.length ? sheet.doors.join(' | ') : 'none found');
ok(sheet.scrollH <= sheet.h + 2 || sheet.overflowY !== 'hidden',
  'nothing in the sheet is cut off unreachably on a 390x844 phone',
  sheet.scrollH > sheet.h ? (sheet.scrollH - sheet.h) + ' px past the fold' : 'fits');
ok(!sheet.clipped.some(id => /wf-foot|wf-priv/.test(id)),
  'the privacy line and the Delete control are still on screen',
  sheet.clipped.length ? sheet.clipped.join(', ') : 'nothing below the fold');

// ════════════════════════════════════════════════════════════════════════════
head('3. a photograph is the fourth TAB of one panel, not a second screen');
await page.evaluate(() => { window.wayfindImportOpen(); window.wayfindImportSet('image'); });
await page.waitForTimeout(400);
const panel = await page.evaluate(() => {
  const p = document.getElementById('wf-imp');
  const r = p.getBoundingClientRect();
  const tabs = [...document.querySelectorAll('.wf-imp-tab')].map(b => ({
    t: (b.textContent || '').trim(), on: b.classList.contains('on'),
    w: Math.round(b.getBoundingClientRect().width),
    cut: b.scrollWidth > b.clientWidth + 1,
  }));
  const btn = [...p.querySelectorAll('#wf-imp-body button')]
    .map(b => ({ t: (b.textContent || '').trim(), h: Math.round(b.getBoundingClientRect().height) }));
  return {
    tabs, btn, win: innerHeight,
    top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width),
    inputs: [...p.querySelectorAll('input[type=file]')].map(i => ({ id: i.id, accept: i.accept })),
  };
});
note('tabs: ' + panel.tabs.map(t => t.t + '(' + t.w + 'px' + (t.on ? ',on' : '') + ')').join(' '));
note('panel ' + panel.w + ' px wide, ' + panel.top + '–' + panel.bottom + ' in a ' + panel.win + ' px window');
ok(panel.tabs.length === 4 && panel.tabs[3].t === 'Photo',
  'four tabs — Google, Apple, UT, Photo — in one panel',
  panel.tabs.map(t => t.t).join(' / '));
ok(!panel.tabs.some(t => t.cut), 'no tab label is clipped by the fourth one',
  'narrowest ' + Math.min(...panel.tabs.map(t => t.w)) + ' px');
ok(panel.bottom <= panel.win, 'the panel still ends above the bottom of the phone',
  'bottom ' + panel.bottom + ' <= ' + panel.win);
ok(panel.btn.some(b => /choose a photo/i.test(b.t) && b.h >= 40),
  'the photo tab offers one control, the same shape as the .ics one',
  panel.btn.map(b => b.t + ' ' + b.h + 'px').join(' | '));
ok(panel.inputs.length === 2 && panel.inputs.some(i => /^image\//.test(i.accept)),
  'and it has its own picker, so `accept` is never rewritten under a phone',
  panel.inputs.map(i => i.id + ' accept=' + i.accept).join(' | '));
await shot(page, 'photo-tab-phone');

// ════════════════════════════════════════════════════════════════════════════
head('4. one photograph, all the way to the device');
const beforeRead = seen.length;
const t0 = Date.now();
await page.evaluate(async (img) => {
  const r = await fetch('/scripts/verify/schedule-images/' + img);
  const b = await r.blob();
  // Exactly the object a <input type=file> hands the page.
  window.wayfindImportImage(new File([b], img, { type: 'image/jpeg' }));
}, IMAGE);

// While it reads, the panel must still be on screen SAYING SOMETHING. A blank
// phone for eight seconds is the failure this state exists to prevent.
await page.waitForTimeout(1200);
const busy = await page.evaluate(() => {
  const p = document.getElementById('wf-imp');
  return { hidden: p.classList.contains('hidden'), text: (p.innerText || '') };
});
ok(!busy.hidden && /reading|getting the reader/i.test(busy.text),
  'while it reads, the panel is up and says what it is doing',
  (busy.text.split('\n').find(l => /reading|getting/i.test(l)) || '(nothing)').trim());
await shot(page, 'reading-phone');

await page.waitForSelector('#wf-cfm', { timeout: 300000, state: 'attached' });
const swapped = await page.evaluate(() => ({
  cfm: !!document.getElementById('wf-cfm'),
  impHidden: document.getElementById('wf-imp').classList.contains('hidden'),
}));
ok(swapped.cfm && swapped.impHidden,
  'the check screen replaces the panel rather than stacking on it',
  'check screen up, import panel hidden');
await page.waitForTimeout(400);
await shot(page, 'check-phone');

// THE STUDENT WHO ANSWERS NOTHING. The floor, and the only behaviour a harness
// can produce without a model of what the student knows.
for (let i = 0; i < 8; i++) {
  if (!await clickIn(page, '#wf-cfm', /skip the rest/)) break;
  await page.waitForTimeout(120);
}
await page.waitForTimeout(300);
await shot(page, 'summary-phone');
await clickIn(page, '#wf-cfm', /^(use |close$)/);
await page.evaluate(async () => { await window.wayfindImportImageDone; return true; });
note('read + check screen: ' + Math.round((Date.now() - t0) / 1000) + ' s');

const result = await page.evaluate(() => {
  const r = window.wayfindImportResult();
  if (!r) return { none: true };
  return {
    err: r.err || null, decoder: r.decoder, source: r.source, via: r.via,
    placed: r.classes.length, rejected: r.rejects.length, events: r.events.length,
    rejectStatus: r.rejects.map(x => x.code + ':' + x.status),
    codes: [...new Set(r.classes.map(c => c.code))].sort(),
  };
});
note('result: ' + JSON.stringify(result));
ok(result.decoder === 'image' && result.source === 'image' && result.via === 'image',
  'the result names the producer that actually ran',
  'decoder=' + result.decoder + ' source=' + result.source + ' via=' + result.via);
ok(result.placed > 0, 'classes were placed from a picture', result.placed + ' placed');
ok(result.events === result.placed + result.rejected,
  'events and classes+rejects are two views of ONE list',
  result.events + ' = ' + result.placed + ' + ' + result.rejected);
ok(result.rejected === 0 || result.rejectStatus.every(s => /offmap|nodoor|unknown|nolocation/.test(s)),
  'anything not placed carries this screen\'s own reason, not a drop',
  result.rejectStatus.join(' ') || 'nothing rejected');
await shot(page, 'result-phone');

// The tap that saves.
ok(await clickIn(page, '#wf-imp-foot', /^use /), 'the result screen offers "Use these"');
await page.waitForTimeout(600);

const saved = await page.evaluate(() => {
  const sch = window.wayfindSchedule;
  const st = (() => { try { return WAYFIND.store.load(); } catch (e) { return null; } })();
  return {
    published: !!sch, source: sch && sch.source, savedOk: sch && sch.saved && sch.saved.ok,
    savedClasses: sch && sch.saved && sch.saved.classes,
    storeClasses: st && st.classes ? st.classes.length : 0,
    storeKind: st && st.sources && st.sources[0] ? st.sources[0].kind : null,
    storeLabel: st && st.sources && st.sources[0] ? st.sources[0].label : null,
    keys: Object.keys(localStorage),
    guard: WAYFIND.store.guard.state(),
    priv: (document.getElementById('wf-priv') || {}).innerText || '',
  };
});
note('store: ' + saved.storeClasses + ' classes, kind=' + saved.storeKind);
ok(saved.published && saved.source === 'image',
  'the schedule is published on window.wayfindSchedule', 'source=' + saved.source);
ok(saved.savedOk === true && saved.storeClasses > 0,
  'store.save() ran and the device holds it',
  saved.savedClasses + ' saved, ' + saved.storeClasses + ' on disk');
ok(saved.storeKind === 'image-ocr',
  'the store names the source with the vocabulary it reserved for a photo',
  saved.storeKind + ' -> "' + saved.storeLabel + '"');
ok(/photo/i.test(saved.priv), 'the privacy panel says so in the student\'s words',
  (saved.priv.split('\n').find(l => /device only/.test(l)) || saved.priv).trim().slice(0, 90));
ok(saved.guard.armed && saved.guard.watched > 0,
  'the egress guard armed itself off this schedule',
  'watched=' + saved.guard.watched);

// ════════════════════════════════════════════════════════════════════════════
head('5. the day view is the student\'s own day, and says what was not checked');
// THE REAL DOOR, not an API call: the one row on the sheet has to lead to the
// student's own day now that there is one.
await page.evaluate(() => { try { window.wayfindImportClose(); } catch (e) {} });
await page.click('#wf-imp-entry');
await page.waitForTimeout(900);
const dayDom = await page.evaluate(() => {
  const p = document.getElementById('wf-day');
  const r = p ? p.getBoundingClientRect() : null;
  return { open: !!p && !p.classList.contains('hidden'),
    text: p ? p.innerText : '', bottom: r ? Math.round(r.bottom) : null,
    win: innerHeight, example: p ? /EXAMPLE/.test(p.innerText) : false };
});
note('day panel: ' + dayDom.text.split('\n').slice(0, 6).join(' | '));
ok(dayDom.open, 'the one door on the sheet now opens the student\'s own day');
ok(!dayDom.example, 'it is the imported schedule and not the built-in example',
  'no EXAMPLE badge');
ok(/photo/i.test(dayDom.text), 'and the footer says where it came from',
  (dayDom.text.split('\n').find(l => /From/i.test(l)) || '').trim());
ok(dayDom.bottom == null || dayDom.bottom <= dayDom.win,
  'the day panel still fits the phone', dayDom.bottom + ' <= ' + dayDom.win);
await shot(page, 'day-phone');

// ...and then the day that actually carries an unchecked class, because today
// is whatever day this suite happens to run on.
const day = await page.evaluate(async () => {
  const sch = window.wayfindSchedule;
  const un = sch.events.filter(e => e.confidence < 1);
  const d = (un[0] && un[0].days[0]) || (sch.events[0] && sch.events[0].days[0]);
  // The same call `dayOpenForStudent()` makes, with a day named.
  await window.wayfindDayFromSchedule(sch, { day: d });
  const p = document.getElementById('wf-day');
  return { day: d, unchecked: un.length, total: sch.events.length,
    text: p ? p.innerText : '' };
});
await page.waitForTimeout(400);
note(day.unchecked + ' of ' + day.total + ' events came back unchecked; opened ' + day.day);
ok(day.unchecked === 0 || /check this one/i.test(day.text),
  'a class nobody was asked about is MARKED on the day, not silently routed',
  day.unchecked ? (day.text.split('\n').find(l => /check this one/i.test(l)) || '(no mark)').trim()
    : 'nothing was left unchecked on this picture');
await shot(page, 'day-unchecked-phone');

// ════════════════════════════════════════════════════════════════════════════
head('6. nothing about the picture left the device');
// The rooms and courses on corpus image 01, plus the words a picture would
// travel as. `truth.json` is the source of the first list rather than a list
// somebody typed.
const truth = JSON.parse(fs.readFileSync(path.join(HERE, 'schedule-images', 'truth.json'), 'utf8'));
const NEEDLES = [...new Set((truth.images || []).flatMap(im =>
  (im.classes || []).flatMap(c => [c.course, c.building + ' ' + c.room].filter(Boolean))))]
  .concat(['base64', 'image/jpeg', 'BEGIN:VCALENDAR']);
const since = seen.slice(beforeRead);
const own = since.filter(r => !/tesseract|traineddata|\.wasm/i.test(r.url));
const carried = own.filter(r => {
  const hay = r.url + ' ' + (r.body || '');
  return NEEDLES.some(n => hay.indexOf(n) >= 0 || hay.indexOf(encodeURIComponent(n)) >= 0);
});
note(since.length + ' requests since the picture was handed over, ' +
  NEEDLES.length + ' needles checked');
ok(carried.length === 0, 'no request carries a course, a room or a picture',
  carried.length ? carried.slice(0, 3).map(c => c.method + ' ' + c.url.slice(0, 80)).join(' | ')
    : 'none');
const withBody = since.filter(r => r.bytes > 0);
ok(withBody.length === 0, 'and not one request since had a body of ANY kind',
  since.length + ' requests, ' + withBody.length + ' with a body');
// THE ALLOWLIST IS MEASURED, NOT WRITTEN DOWN: the hosts the app already talked
// to before the picture existed are the allowlist, and one new host fails.
const hostOf = u => { try { return new URL(u).host; } catch (e) { return null; } };
const before = new Set(seen.slice(0, beforeRead).map(r => hostOf(r.url)).filter(Boolean));
const after = new Set(since.map(r => hostOf(r.url)).filter(Boolean));
const added = [...after].filter(h => !before.has(h));
ok(added.length === 0, 'importing a schedule adds no destination',
  added.length ? added.join(', ') : [...after].join(', ') + ' — all of them were already in use');
ok(sinkHits.length === 0, 'the raw socket sink was never contacted', SINK);

// ── FIRST: THE SHIPPED ALARM, ARMED, ON A SCHEDULE THAT CAME FROM A PICTURE ─
// This is the one thing `si-integration.mjs` §6 could never test. Its own note
// says the guard was watching NOTHING during a real import, because nothing
// called `store.save()`; the photo route saves, so the guard is armed off a
// student's own rooms at the moment it matters. Fire a real leak at it and it
// must throw and nothing must reach the sink.
const armedCanary = await page.evaluate(async (s) => {
  const cls = (WAYFIND.store.load().classes || [])[0];
  const text = 'canary ' + cls.code + ' ' + cls.room;
  const out = { text };
  try { await fetch(s + '/__armed_fetch', { method: 'POST', body: text }); out.fetch = 'SENT'; }
  catch (e) { out.fetch = 'blocked: ' + String(e.message).slice(0, 60); }
  return out;
}, SINK);
await page.waitForTimeout(800);
note('armed canary: ' + JSON.stringify(armedCanary));
ok(/^blocked/.test(armedCanary.fetch),
  'the SHIPPED guard blocks a leak of a photo-imported room, at the socket',
  armedCanary.fetch);
ok(!sinkHits.some(h => h.indexOf('__armed_fetch') >= 0),
  'and the sink confirms nothing got out', sinkHits.length + ' sink hits total');

// ── THEN: PROVE THE INSTRUMENTS ARE NOT BLIND ───────────────────────────────
// Disarm the guard, fire the same shape of leak, and require the capture or the
// socket to catch it. A clean sheet above means nothing without this, and with
// the guard armed a clean sheet proves the guard rather than the instrument.
const canary = await page.evaluate(async (s) => {
  const text = 'GOV 312L canary WEL 2.224';
  const out = {};
  window.WAYFIND.store.guard.__disarmForAudit();
  try { await fetch(s + '/__imgimport_canary', { method: 'POST', body: text }); out.fetch = 'sent'; }
  catch (e) { out.fetch = 'threw ' + e.message; }
  try {
    const src = 'onmessage=async(e)=>{try{await fetch(e.data.u,{method:"POST",body:e.data.t});' +
      'postMessage("sent")}catch(err){postMessage("threw "+err.message)}}';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    out.worker = await new Promise(res => {
      w.onmessage = e => res(e.data);
      w.onerror = () => res('error');
      w.postMessage({ u: s + '/__imgimport_canary_worker', t: text });
      setTimeout(() => res('timeout'), 6000);
    });
    w.terminate();
  } catch (e) { out.worker = 'threw ' + e.message; }
  window.WAYFIND.store.guard.arm();
  return out;
}, SINK);
await page.waitForTimeout(2500);
note('disarmed canary: ' + JSON.stringify(canary));
const capSaw = t => seen.some(r => r.url.indexOf(t) >= 0);
const sinkSaw = t => sinkHits.some(h => h.indexOf(t) >= 0);
ok(capSaw('__imgimport_canary') && sinkSaw('__imgimport_canary'),
  'both instruments can see a deliberate leak from the page',
  'capture=' + capSaw('__imgimport_canary') + ' socket=' + sinkSaw('__imgimport_canary'));
ok(capSaw('__imgimport_canary_worker') || sinkSaw('__imgimport_canary_worker'),
  'and neither is blind to one fired from inside a Worker',
  'capture=' + capSaw('__imgimport_canary_worker') + ' socket=' + sinkSaw('__imgimport_canary_worker'));
const rearmed = await page.evaluate(() => WAYFIND.store.guard.state());
ok(rearmed.armed && rearmed.watched > 0, 'the guard was re-armed afterwards',
  'watched=' + rearmed.watched + ' quietChecked=' + rearmed.quietChecked);

// ════════════════════════════════════════════════════════════════════════════
head('7. a reload keeps it, and Delete still means gone');
await page.goto(BASE + '/index.html?walk=1&drift=0', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForSelector('#wf-imp-entry', { timeout: 180000 });
await page.waitForTimeout(1200);
const back = await page.evaluate(() => {
  const s = window.wayfindSchedule;
  return {
    restored: !!(s && s.restored), n: s ? s.events.length : 0,
    source: s ? s.source : null,
    unchecked: s ? s.events.filter(e => e.confidence < 1).length : -1,
    prov: (() => { try {
      const st = WAYFIND.store.load();
      const c = (st.classes || []).find(x => x.provenance && x.provenance.unconfirmedFields);
      return c ? c.provenance : null;
    } catch (e) { return null; } })(),
  };
});
note('after reload: ' + JSON.stringify(back));
ok(back.restored && back.n === result.events,
  'the same number of classes comes back after a reload',
  back.n + ' of ' + result.events);
ok(back.source === 'image-ocr' || back.source === 'image',
  'and it still knows it came from a photograph', String(back.source));
ok(day.unchecked === 0 || back.unchecked === day.unchecked,
  '"not checked" survives the reload — it is stored, not a session flag',
  back.unchecked + ' unchecked, was ' + day.unchecked);
ok(day.unchecked === 0 || (back.prov && back.prov.unconfirmedFields.length > 0),
  'and the device remembers WHICH fields were never checked',
  back.prov ? JSON.stringify(back.prov.unconfirmedFields) + ' — "' +
    String(back.prov.why).slice(0, 60) + '"' : 'nothing to remember');

// ════════════════════════════════════════════════════════════════════════════
head('8. the mark is a CONTROL — one class corrected, without redoing the import');
// THE GAP THIS CLOSES. Until this section existed, `check this one` was a
// label: the app correctly identified its own uncertainty and then offered no
// way at all to settle it. The only route back was Delete-everything-and-
// re-photograph, so a student who saw the chip on day one saw the identical
// unresolved chip every day for the rest of the semester.
//
// IT IS TESTED HERE, AFTER THE RELOAD, ON PURPOSE. Correcting a class in the
// session that imported it is the easy half; the case that matters is the one
// the student actually lives in — the schedule came off disk, the import screen
// is long gone, and the picture was never kept.
await page.waitForFunction(() => {
  const v = document.getElementById('veil');
  return !v || v.classList.contains('gone') || getComputedStyle(v).opacity === '0';
}, null, { timeout: 180000 }).catch(() => {});
const fixDay = await page.evaluate(async () => {
  const s = window.wayfindSchedule;
  const un = s.events.filter(e => e.confidence < 1);
  const d = (un[0] && un[0].days[0]) || (s.events[0] && s.events[0].days[0]);
  await window.wayfindDayFromSchedule(s, { day: d });
  const p = document.getElementById('wf-day');
  const chips = [...p.querySelectorAll('.wf-d-chip')]
    .map(c => ({ tag: c.tagName, text: c.innerText.trim() }));
  const f = document.getElementById('wf-day-foot');
  return { day: d, unchecked: un.length, foot: f ? f.innerText.trim() : '',
    tappable: chips.filter(c => c.tag === 'BUTTON').length, chips };
});
await page.waitForTimeout(300);
note('day ' + fixDay.day + ': ' + fixDay.unchecked + ' unchecked, ' +
  fixDay.tappable + ' tappable chip(s)');
// CAUGHT ON CAMERA, NOT BY A GATE, AND NOT ON THIS SESSION'S PATH. §5 reads
// this footer off the LIVE import object and it said "From a photo of a
// schedule"; the RESTORED object goes through daySourceOf's other branch and
// said "From typed in" — under a schedule that came from a photograph, for
// every student who ever reloaded the page. See daySourceOf.
ok(/photo/i.test(fixDay.foot),
  'a RESTORED photo schedule still says where it came from',
  fixDay.foot || '(no footer)');
ok(back.unchecked === 0 || fixDay.tappable > 0,
  'the "check this one" chip is a BUTTON, not a label',
  (fixDay.chips.find(c => c.tag === 'BUTTON') || {}).text || '(none on this day)');

const fixSheet = back.unchecked === 0 ? null : await page.evaluate(() => {
  const b = [...document.querySelectorAll('#wf-day button.wf-d-chip')][0];
  if (!b) return null;
  // WHAT THE CHIP SAID, before it opens anything. The whole promise of this
  // sheet is that it is about the row the student tapped, so the quoted
  // reading and the field's contents have to be the same string.
  const q = /[“"]([^”"]+)[”"]/.exec(b.innerText || '');
  b.click();
  const f = document.getElementById('wf-fix');
  const r = f ? f.getBoundingClientRect() : null;
  const st = window.wayfindFixState();
  const stored = (WAYFIND.store.load().classes || [])
    .find(c => WAYFIND.store.keyOf(c) === (st && st.key)) || null;
  return {
    up: !!f && !f.classList.contains('hidden'),
    text: f ? f.innerText : '',
    quoted: q ? q[1] : null,
    prefill: (document.getElementById('wf-fix-place') || {}).value || '',
    say: (document.getElementById('wf-fix-say') || {}).textContent || '',
    state: st,
    open: stored && stored.provenance ? (stored.provenance.unconfirmedFields || []) : [],
    dayBtns: document.querySelectorAll('#wf-fix-days .wf-f-day').length,
    top: r ? Math.round(r.top) : null, bottom: r ? Math.round(r.bottom) : null,
    win: innerHeight,
    // WHERE THE PRIMARY ANSWER ACTUALLY IS, in the frame — not whether it is in
    // the DOM. The first cut of this sheet put "Save this" 40 px below the
    // sheet's own bottom edge on a phone with a route drawn: every assertion
    // about the panel passed and the button was not on screen.
    save: (() => {
      const s = document.getElementById('wf-fix-save');
      if (!s) return null;
      const b = s.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom),
        h: Math.round(b.height) };
    })(),
  };
});
if (fixSheet) {
  note('sheet: ' + fixSheet.text.split('\n').filter(Boolean).slice(0, 5).join(' | '));
  ok(fixSheet.up, 'tapping it opens a sheet that can answer the question');
  ok(!!fixSheet.state && !!fixSheet.state.key,
    'and the sheet knows WHICH stored class it is about', String(fixSheet.state && fixSheet.state.key));
  // THE QUESTION IS RECONSTRUCTED FROM WHAT THE DEVICE KEPT, which is the only
  // thing that could survive: the picture was deliberately never stored.
  ok(fixSheet.prefill.length > 0 && fixSheet.prefill === fixSheet.quoted,
    'the reading the chip quoted is what the field holds, ready to be edited',
    JSON.stringify(fixSheet.quoted) + ' -> ' + JSON.stringify(fixSheet.prefill));
  // ...AND THE SHEET ASKS ABOUT WHAT WAS ACTUALLY LEFT OPEN, which is the one
  // thing `provenance.unconfirmedFields` was stored for. A doubt about the DAY
  // that opened a sheet with no day control would be the same dead end in a
  // nicer wrapper.
  ok(fixSheet.open.indexOf('day') < 0 || fixSheet.dayBtns > 0,
    'the field the reader was actually unsure of is the field it asks about',
    JSON.stringify(fixSheet.open) + ' -> ' + fixSheet.dayBtns + ' day controls');
  ok(/never kept|photo/i.test(fixSheet.text),
    'it says the photo was not kept rather than pretending it could show it');
  ok(fixSheet.bottom == null || fixSheet.bottom <= fixSheet.win,
    'and the sheet fits the phone', fixSheet.bottom + ' <= ' + fixSheet.win);
  ok(!!fixSheet.save && fixSheet.save.top >= 0 &&
     fixSheet.save.bottom <= fixSheet.win && fixSheet.save.bottom <= fixSheet.bottom &&
     fixSheet.save.h >= 34,
    'the answer button is ON SCREEN and a thumb target, not merely in the DOM',
    fixSheet.save ? ('y ' + fixSheet.save.top + '..' + fixSheet.save.bottom +
      ' in a ' + fixSheet.win + ' window, ' + fixSheet.save.h + ' px tall') : 'no button');
  await shot(page, 'fix-sheet-phone');

  // ── the live answer under the field, which is the whole point of a sheet ──
  const live = await page.evaluate(() => {
    const i = document.getElementById('wf-fix-place');
    const set = (v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
    const read = () => ({ say: document.getElementById('wf-fix-say').textContent,
      cls: document.getElementById('wf-fix-say').className,
      sugg: [...document.querySelectorAll('.wf-f-sugg-b')].map(b => b.innerText.trim()) });
    set('WEL 2.224'); const good = read();
    set('ZZQ 9'); const bad = read();
    return { good, bad };
  });
  note('live: WEL -> "' + live.good.say + '"   ZZQ -> "' + live.bad.say + '"');
  ok(/welch/i.test(live.good.say),
    'typing a real code names the building back, before anything is saved',
    live.good.say);
  ok(/ok/.test(live.good.cls) && /bad/.test(live.bad.cls),
    'and a code this map has never heard of says so rather than accepting it',
    live.bad.say);

  // ── the answer goes through store.save() and out the same three names ─────
  const fixed = await page.evaluate(async () => {
    const i = document.getElementById('wf-fix-place');
    i.value = 'WEL 2.224';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    const st0 = WAYFIND.store.load();
    const before = st0.classes.filter(c => c.confidence < 1).length;
    const out = await window.wayfindFixSubmit(false);
    await new Promise(r => setTimeout(r, 500));
    const st = WAYFIND.store.load();
    const hit = st.classes.find(c => c.provenance && c.provenance.confirmedBy === 'student');
    const p = document.getElementById('wf-day');
    return {
      out, before, after: st.classes.filter(c => c.confidence < 1).length,
      n: st.classes.length,
      hit: hit ? { code: hit.code, room: hit.room, conf: hit.confidence,
        prov: hit.provenance, why: hit.unroutableWhy } : null,
      pubUnchecked: window.wayfindSchedule.events.filter(e => e.confidence < 1).length,
      sheetOpen: !document.getElementById('wf-fix').classList.contains('hidden'),
      dayOpen: !!p && !p.classList.contains('hidden'),
      dayText: p ? p.innerText : '',
    };
  });
  note('after the answer: ' + JSON.stringify(fixed.hit));
  ok(fixed.out && fixed.out.ok, 'the answer was written to the device',
    JSON.stringify(fixed.out));
  ok(fixed.n === back.n,
    'and it corrected a class rather than adding one', fixed.n + ' of ' + back.n);
  ok(!!fixed.hit && fixed.hit.conf === 1 &&
    fixed.hit.prov.unconfirmedFields.length === 0 && fixed.hit.prov.confirmed === true,
    'the doubt is closed on the stored class, not just on screen',
    'confidence=' + (fixed.hit && fixed.hit.conf));
  ok(!!fixed.hit && fixed.hit.prov.correctedFrom !== undefined,
    'and what the picture had said is kept, so a correction is distinguishable ' +
    'from a confirmation',
    JSON.stringify(fixed.hit && fixed.hit.prov.correctedFrom));
  ok(fixed.after === fixed.before - 1 && fixed.pubUnchecked === fixed.after,
    'exactly one mark cleared, on disk AND on window.wayfindSchedule',
    fixed.before + ' -> ' + fixed.after + ' stored, ' + fixed.pubUnchecked + ' published');
  ok(!fixed.sheetOpen && fixed.dayOpen,
    'the sheet closes and puts the student back on the day they were reading');
  await shot(page, 'fix-done-phone');

  // ── and it is a SAVE, not a session flag ─────────────────────────────────
  await page.goto(BASE + '/index.html?walk=1&drift=0', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.waitForSelector('#wf-imp-entry', { timeout: 180000 });
  await page.waitForTimeout(1200);
  const kept = await page.evaluate(() => {
    const s = window.wayfindSchedule;
    const st = WAYFIND.store.load();
    const hit = (st.classes || []).find(c => c.provenance && c.provenance.confirmedBy === 'student');
    return { n: s ? s.events.length : 0,
      unchecked: s ? s.events.filter(e => e.confidence < 1).length : -1,
      hit: hit ? hit.code + ' ' + hit.room + ' conf=' + hit.confidence : null };
  });
  note('after the second reload: ' + JSON.stringify(kept));
  ok(kept.n === back.n && kept.unchecked === fixed.after,
    'the answer survives a reload — the chip does not come back',
    kept.unchecked + ' unchecked, was ' + fixed.after);
  ok(!!kept.hit && / conf=1$/.test(kept.hit),
    'and the corrected class is still the corrected class', String(kept.hit));

  // ── the OTHER answer: "it was right" ─────────────────────────────────────
  const asRead = await page.evaluate(async () => {
    const s = window.wayfindSchedule;
    const un = s.events.filter(e => e.confidence < 1);
    if (!un.length) return { skipped: true };
    await window.wayfindDayFromSchedule(s, { day: un[0].days[0] });
    const b = [...document.querySelectorAll('#wf-day button.wf-d-chip')][0];
    if (!b) return { skipped: true, why: 'no chip' };
    b.click();
    const out = await window.wayfindFixSubmit(true);
    await new Promise(r => setTimeout(r, 400));
    const st = WAYFIND.store.load();
    const hit = (st.classes || []).find(c => c.provenance &&
      c.provenance.confirmedBy === 'student' && c.provenance.correctedFrom === null);
    return { out, hit: hit ? { code: hit.code, room: hit.room, conf: hit.confidence,
      from: hit.provenance.correctedFrom } : null,
      unchecked: window.wayfindSchedule.events.filter(e => e.confidence < 1).length };
  });
  note('"it was right": ' + JSON.stringify(asRead));
  ok(asRead.skipped || (asRead.out && asRead.out.ok && asRead.hit &&
    asRead.hit.conf === 1 && asRead.hit.from === null),
    'one tap can also answer "the reading was right", and it reads differently ' +
    'on disk from a correction',
    asRead.skipped ? 'nothing left unchecked' : JSON.stringify(asRead.hit));
}

// ════════════════════════════════════════════════════════════════════════════
head('9. Delete still means gone');
const wiped = await page.evaluate(async () => {
  const inv0 = WAYFIND.store.inventory ? WAYFIND.store.inventory() : null;
  await WAYFIND.store.clearAsync();
  return {
    before: inv0, has: WAYFIND.store.has(),
    published: !!window.wayfindSchedule,
    keys: Object.keys(localStorage),
  };
});
note('after delete: keys ' + JSON.stringify(wiped.keys));
ok(!wiped.has && !wiped.published,
  'Delete wipes a photo-imported schedule and unpublishes it',
  'store.has=' + wiped.has + ' published=' + wiped.published);
ok(!wiped.keys.some(k => /schedule/i.test(k)),
  'and no key with a schedule in it is left in this browser',
  wiped.keys.join(', '));

// ════════════════════════════════════════════════════════════════════════════
head('10. an iPhone HEIC fails as a FORMAT, not as "your picture is bad"');
// HEIC has been the default camera format on every iPhone since 2017, so on a
// large share of the phones this feature is for, "choose a photo of your
// timetable" hands this app a HEIC. Chrome and Firefox have no decoder for it
// and `createImageBitmap` simply rejects — and until IMP.image.heicBrands
// existed that rejection arrived seconds and ~5 MB later as the generic "That
// picture could not be read on this device", which blames the student's
// photograph for a format their browser never supported and gives them nothing
// to do. Playwright's Chromium is exactly such a browser, so this is a real
// negative and not a simulated one.
const heicMark = seen.length;
const heicT0 = Date.now();
const heic = await page.evaluate(async () => {
  // A minimal but genuine ISO-BMFF header: box length, 'ftyp', major brand
  // 'heic'. The sniff reads the bytes, not the name or the MIME type, because
  // a phone picker routinely hands over a file with neither.
  const b = new Uint8Array(64);
  const put = (i, s) => { for (let k = 0; k < s.length; k++) b[i + k] = s.charCodeAt(k); };
  b[3] = 24; put(4, 'ftyp'); put(8, 'heic'); put(16, 'mif1heic');
  const f = new File([b], 'IMG_0042.HEIC', { type: 'image/heic' });
  await window.wayfindImportImage(f);
  await new Promise(r => setTimeout(r, 250));
  const p = document.getElementById('wf-imp');
  return { text: p ? p.innerText : '', result: !!window.wayfindImportResult() };
});
const heicMs = Date.now() - heicT0;
const heicLine = heic.text.split('\n').map(s => s.trim())
  .find(l => /HEIC/i.test(l)) || '';
note('refused in ' + heicMs + ' ms: ' + heicLine.slice(0, 96));
ok(/HEIC/i.test(heic.text),
  'the sentence names the FORMAT and the browser, not the photograph', heicLine.slice(0, 70));
ok(/screenshot/i.test(heicLine),
  'and gives a way round it the student can do on the phone in their hand');
ok(!heic.result, 'nothing was imported from it');
const heicReqs = seen.slice(heicMark).filter(r => /tesseract|traineddata|\.wasm/i.test(r.url));
ok(heicReqs.length === 0,
  'and it was refused BEFORE the ~5 MB reader was fetched',
  heicReqs.length ? heicReqs.map(r => r.url.slice(0, 60)).join(' | ') : 'no engine request');

// ════════════════════════════════════════════════════════════════════════════
head('console');
const real = errs.filter(e => !/imgimport_canary/.test(e));
ok(real.length === 0, 'no console errors on the phone page anywhere in this run',
  real.slice(0, 3).join(' | ') || 'clean');

console.log('\n' + '='.repeat(78));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(78) + '\n');
try { browser.__done && browser.__done(); } catch (e) {}
await browser.close();
sink.close();
stopServer();
process.exit(fail ? 1 : 0);
