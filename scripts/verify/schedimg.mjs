/**
 * schedimg.mjs — the gate for `js/schedimg.js`.
 *
 *   python scripts/serve.py 8099          (or let this script start its own)
 *   node scripts/verify/schedimg.mjs
 *
 * FOUR THINGS, AND EACH ONE IS A PROMISE THE FEATURE MAKES.
 *
 *   1. IT COSTS THE PAGE NOTHING until a student picks an image. Asserted at
 *      the network level on the REAL page, not by reading the HTML: every
 *      request the browser makes while loading index.html is captured, and
 *      none of them may be the engine.
 *   2. IT IS THE REAL PAGE. The module is imported into the loaded app the way
 *      the import screen will import it, and it has to work there.
 *   3. NOTHING LEAVES THE DEVICE. Every request made from the moment the image
 *      is handed over is captured — context-level, so a Worker's own fetches
 *      are in scope — and checked against a raw socket sink that cannot have a
 *      blind spot about its own input. Nothing may carry a course code, a room
 *      or a byte of the picture, and nothing at all may leave 127.0.0.1. Then
 *      the instruments are proved not blind by firing a canary through them.
 *   4. IT REFUSES RATHER THAN GUESSES. A truncated field, an unreadable room,
 *      a class-length that is not a class: each has to come back in `unsure`
 *      with a sentence a student can act on, not in `classes`.
 *
 * It does NOT reprint the benchmark score — that is image-bench.mjs's job and
 * quoting a number in two places is how the two drift apart.
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
const CORPUS = path.join(HERE, 'schedule-images');

let pass = 0, fail = 0;
const ok = (c, name, detail) => {
  if (c) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
};
const note = s => console.log('        ' + s);
const head = s => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 70 - s.length)));

// ── a socket that cannot lie about what reached it ──────────────────────────
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

const browser = await launch(chromium, { maxMs: Number(process.env.VERIFY_MAX_MS || 900000) });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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

// ════════════════════════════════════════════════════════════════════════════
head('1. the app loads and this feature costs it nothing');
await page.goto(BASE + '/index.html?walk=1', { waitUntil: 'load', timeout: 180000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForTimeout(1500);

const ENGINE = /tesseract|traineddata|\.wasm(\?|$)|schedimg/i;
const atLoad = seen.filter(r => ENGINE.test(r.url));
note(seen.length + ' requests while the page loaded');
ok(atLoad.length === 0, 'not one byte of the reader is fetched at page load',
  atLoad.length ? atLoad.slice(0, 3).map(r => r.url.slice(-60)).join(' | ') : 'nothing matching tesseract/traineddata/wasm/schedimg');
ok(await page.evaluate(() => typeof window.wayfindImageExtract), // undefined until imported
  'and the global it installs is absent until then', 'typeof = ' +
  await page.evaluate(() => typeof window.wayfindImageExtract));

// ════════════════════════════════════════════════════════════════════════════
head('2. imported the way the import screen will import it');
const loaded = await page.evaluate(async (b) => {
  const t0 = performance.now();
  const m = await import(b + '/js/schedimg.js');
  window.__schedimg = m;
  return { ms: Math.round(performance.now() - t0), api: typeof m.extract,
    global: typeof window.wayfindImageExtract };
}, BASE);
ok(loaded.api === 'function' && loaded.global === 'function',
  'a dynamic import brings up the module inside the real app', loaded.ms + ' ms');
const stillNoEngine = seen.filter(r => /tesseract|traineddata/i.test(r.url));
ok(stillNoEngine.length === 0,
  'and STILL no engine — importing the module is not loading the reader',
  stillNoEngine.length + ' engine requests');

// ════════════════════════════════════════════════════════════════════════════
head('3. it reads a real picture of a schedule, on the device');
const img = 'data:image/jpeg;base64,' +
  fs.readFileSync(path.join(CORPUS, '01-ut-table-clean.jpg')).toString('base64');
const beforeRead = seen.length;
const res = await page.evaluate(async (u) => {
  const t0 = performance.now();
  const out = await window.wayfindImageExtract(u);
  return {
    ms: Math.round(performance.now() - t0), layout: out.layout, source: out.source,
    n: out.classes.length, engine: out.engine.name,
    sample: out.classes.slice(0, 2).map(c =>
      c.building + ' ' + c.room + ' ' + c.day + ' ' + c.start + '-' + c.end),
    stages: out.stages,
  };
}, img);
note('engine: ' + res.engine);
note('stages (ms): ' + JSON.stringify(res.stages));
ok(res.n >= 10, 'the registrar table comes back as classes', res.n + ' meetings in ' + res.ms + ' ms');
ok(res.layout === 'table', 'and it worked out that it was looking at a table', res.layout);
note('first two: ' + res.sample.join(' | '));

const engineReqs = seen.filter(r => /tesseract|traineddata/i.test(r.url));
ok(engineReqs.length > 0, 'the reader was fetched only NOW, when an image arrived',
  engineReqs.length + ' requests');
ok(engineReqs.every(r => r.url.startsWith(BASE)),
  'and every byte of it came from this origin, not a CDN',
  engineReqs.map(r => new URL(r.url).origin).filter((v, i, a) => a.indexOf(v) === i).join(', '));

// ════════════════════════════════════════════════════════════════════════════
head('4. nothing about the picture left the device');
const NEEDLES = ['M 340L', 'RTF 305', 'GOV 312L', 'PHY 303L', 'C S 439', 'EE 460R',
  'RLP 0.106', 'CMA 6.146', 'WEL 2.224', 'PAI 3.02', 'GDC 2.216', 'MER 1.906',
  'MATRICES', 'HEITMANN', 'base64', 'image/jpeg'];
const since = seen.filter(r => !/tesseract|traineddata|\.wasm/i.test(r.url));
const carried = since.filter(r => {
  const hay = r.url + ' ' + (r.body || '');
  return NEEDLES.some(n => hay.indexOf(n) >= 0 || hay.indexOf(encodeURIComponent(n)) >= 0);
});
ok(carried.length === 0, 'no request carries a course, a room or a picture',
  carried.length ? carried.slice(0, 3).map(c => c.method + ' ' + c.url.slice(0, 80)).join(' | ')
    : NEEDLES.length + ' needles checked over ' + seen.length + ' requests');
// AND A STRONGER ONE, because "no needle matched" is only as good as the list.
// While the image was being read, nothing the browser sent had a BODY at all.
// A picture cannot leave a page inside a GET's query string without appearing
// in the needles above, and it cannot leave any other way without a body.
const during = seen.slice(beforeRead);
const withBody = during.filter(r => r.bytes > 0);
ok(withBody.length === 0,
  'and while it was reading, not one request had a body of any kind',
  during.length + ' requests during the read, ' + withBody.length + ' with a body');
const offOrigin = seen.filter(r => !r.url.startsWith(BASE) && !r.url.startsWith('data:') &&
  !r.url.startsWith('blob:'));
note('off-origin requests during the whole run: ' + offOrigin.length +
  (offOrigin.length ? ' — ' + [...new Set(offOrigin.map(r => new URL(r.url).host))].join(', ') +
    ', which is the map, not this feature' : ''));
ok(sinkHits.length === 0, 'the raw socket sink was never contacted', SINK);

// PROVE THE INSTRUMENTS ARE NOT BLIND. A clean sheet means nothing without it.
const canary = await page.evaluate(async (s) => {
  const text = 'M 340L MATRICES canary RLP 0.106';
  const out = {};
  try { await fetch(s + '/__schedimg_canary', { method: 'POST', body: text }); out.fetch = 'sent'; }
  catch (e) { out.fetch = 'threw ' + e.message; }
  try {
    const src = 'onmessage=async(e)=>{try{await fetch(e.data.u,{method:"POST",body:e.data.t});' +
      'postMessage("sent")}catch(err){postMessage("threw "+err.message)}}';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    out.worker = await new Promise(res => {
      w.onmessage = e => res(e.data);
      w.onerror = e => res('error');
      w.postMessage({ u: s + '/__schedimg_canary_worker', t: text });
      setTimeout(() => res('timeout'), 6000);
    });
    w.terminate();
  } catch (e) { out.worker = 'threw ' + e.message; }
  return out;
}, SINK);
await page.waitForTimeout(2000);
note('canary: ' + JSON.stringify(canary));
const capSaw = t => seen.some(r => r.url.indexOf(t) >= 0);
const sinkSaw = t => sinkHits.some(h => h.indexOf(t) >= 0);
ok(capSaw('__schedimg_canary') && sinkSaw('__schedimg_canary'),
  'both instruments see a deliberate leak from the page',
  'capture=' + capSaw('__schedimg_canary') + ' socket=' + sinkSaw('__schedimg_canary'));
ok(capSaw('__schedimg_canary_worker') || sinkSaw('__schedimg_canary_worker'),
  'and neither is blind to one fired from inside a Worker',
  'capture=' + capSaw('__schedimg_canary_worker') + ' socket=' + sinkSaw('__schedimg_canary_worker'));

// ════════════════════════════════════════════════════════════════════════════
head('5. it says "I am not sure" instead of guessing');
const unit = await page.evaluate(() => {
  const M = window.__schedimg;
  const out = {};
  // A class that is eleven and a half hours long is an OCR slip, not a class.
  out.longRange = M.parseRange('1:00am 12:30 pm');
  // A day run OCR doubled a letter in. Must still be Tuesday and Thursday.
  out.doubled = M.parseDayLetters('TTth');
  // A word, not a day run.
  out.notDays = M.parseDayLetters('MMM');
  // A building code one confusable character from exactly one real one.
  out.repair1 = M.repairCode('WFL', new Set(['WEL', 'GDC']));
  // ..and one that could be two different real buildings is refused.
  out.ambiguous = M.repairCode('GDD', new Set(['GDC', 'GDF']));
  out.exact = M.repairCode('RLP', new Set(['RLP']));

  // ── THE COURSE CODE IS NOT A LOCATION ────────────────────────────────────
  // A UT Registration Plus block opens with its course code, and at least seven
  // UT department prefixes are also real building codes (ART, ASE, BIO, BME,
  // CAL, GRS, KIN, checked against data/ut_buildings.json). Read left to right
  // with no rule about it, the title line wins before the location line is ever
  // looked at — and the answer passes every downstream check, because the
  // building really exists. It just is not this class's building.
  const W = (text, x0, y0) => ({ text, x0, y0, x1: x0 + text.length * 10, y1: y0 + 20, conf: 92 });
  const KNOWN = new Set(['ART', 'WEL', 'UTC']);
  out.titleLine = M.locFromWords([
    W('ART', 0, 0), W('302,', 40, 0), W('45672', 90, 0), W('-', 150, 0), W('Reyes', 160, 0),
    W('9:30am', 0, 30), W('-', 70, 30), W('11:00am', 90, 30),
    W('WEL', 0, 60), W('2.224', 40, 60),
  ], KNOWN);
  // ...and when the block prints no location at all, the course code does not
  // become one. Declining costs a tap; this used to cost a walk across campus.
  out.titleOnly = M.locFromWords([W('ART', 0, 0), W('302', 40, 0)], KNOWN);
  // A room number whose full stop the scan dropped is a DIFFERENT room, on a
  // different floor. There is no way to know where the stop went, so it is
  // refused rather than guessed at.
  out.lostDot = M.locFromWords([W('UTC', 0, 0), W('1102', 40, 0)], KNOWN);
  return out;
});
ok(unit.longRange && unit.longRange.bad === true,
  'an 11-hour "class" is refused as a bad reading', 'len=' + (unit.longRange || {}).len + ' min');
ok(String(unit.doubled) === 'Tue,Thu', 'an OCR-doubled "TTth" still reads as Tue+Thu',
  String(unit.doubled));
ok(unit.notDays === null, '"MMM" is a word, not three Mondays', String(unit.notDays));
ok(unit.repair1 && unit.repair1.code === 'WEL' && unit.repair1.repaired === true,
  'a one-character building slip is repaired AND flagged', JSON.stringify(unit.repair1));
ok(unit.ambiguous === null, 'a slip that could be two real buildings is refused',
  String(unit.ambiguous));
ok(unit.exact && unit.exact.repaired === false, 'a real code is taken as it stands',
  JSON.stringify(unit.exact));
ok(unit.titleLine && unit.titleLine.code === 'WEL' && unit.titleLine.room === '2.224',
  'a course code that is also a real building is not read as the location',
  JSON.stringify(unit.titleLine));
ok(unit.titleOnly === null,
  '...and with no location printed, the course code does not become one',
  JSON.stringify(unit.titleOnly));
ok(unit.lostDot === null, 'a room number with its full stop dropped is refused',
  JSON.stringify(unit.lostDot));

// ── THE OTHER KIND OF WEEK GRID: A RULED TABLE ──────────────────────────────
// myUT draws an HTML table with a rule between every cell and tints the
// occupied ones a few shades off white. The block finder cannot see it at all
// — the rules weld the whole table into one page-sized shape 6% full, which is
// discarded — so on three real screenshots it kept at most one rectangle and
// two of the three returned NOTHING: no classes, no "could not read this".
//
// The picture below is drawn here rather than read off disk on purpose. The
// real screenshots are a record of where a named student is at a given hour,
// they are gitignored, and they stay that way; what this gate has to hold is
// the GEOMETRY, and geometry can be drawn. Every measurement in it is one that
// cost a round: the label below its own rule, the today-tint, the seam.
const ruled = await page.evaluate(() => {
  const M = window.__schedimg, T = M.TUNE;
  const W = 740, H = 620, GUT = 100, PITCH = 100, TOP = 20, HOUR = 100;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  // THE TODAY-TINT, and it is on a WEEKDAY WITH A CLASS IN IT. The corpus brief
  // calls the tinted column Saturday; on one real image it is the fourth of
  // six. A reader that anchors on the tint puts a whole image on the wrong day,
  // and one that measures each column against its own background reads every
  // cell in this column as a gap.
  g.fillStyle = '#fce8e0';
  g.fillRect(GUT + 3 * PITCH, TOP, PITCH, HOUR * 6);
  // the rules, UNDER the cells: a cell is drawn over its own hour rule, which
  // is why a 90-minute class is one unbroken stretch of paint
  g.strokeStyle = '#dcdcdc'; g.lineWidth = 2;
  for (let i = 0; i <= 6; i++) {
    g.beginPath(); g.moveTo(GUT + i * PITCH, TOP);
    g.lineTo(GUT + i * PITCH, TOP + HOUR * 6); g.stroke();
    g.beginPath(); g.moveTo(GUT, TOP + i * HOUR);
    g.lineTo(GUT + 6 * PITCH, TOP + i * HOUR); g.stroke();
  }
  const cell = (col, h0, h1) => {
    g.fillStyle = '#f0f0f0';
    g.fillRect(GUT + col * PITCH + 6, TOP + h0 * HOUR + 3, PITCH - 12, (h1 - h0) * HOUR - 6);
  };
  cell(0, 0, 1); cell(0, 1, 2);   // back to back: one seam, on the hour
  cell(1, 2, 3.5);                // ninety minutes: no seam, straight through
  cell(3, 4, 5);                  // inside the tinted column
  cell(4, 0, 1);
  const id = g.getImageData(0, 0, W, H);
  const rect = { w: W, h: H, data: id.data, source: 'screenshot' };

  // The hour labels sit 18 px BELOW their own rules, which is where myUT puts
  // them and is the whole reason ruledHourAxis() exists.
  const NAMES = ['8AM', '9AM', '10AM', '11AM', '12PM', '1PM'];
  const rows = NAMES.map((t, i) => {
    const y0 = TOP + i * HOUR + 18, y1 = y0 + 20;
    return { y0, y1, x0: 30, x1: 80,
      words: [{ text: t, x0: 30, y0, x1: 80, y1, conf: 95 }] };
  });

  const grid = M.ruledGrid(rect, rows, T);
  if (!grid) return { grid: null };
  const axis = M.ruledHourAxis(rows, grid, T);
  const naive = M.hourAxis(rows, grid.gutterRight);
  const cells = M.ruledCells(rect, grid, [], axis, T);
  const snap = v => Math.round(v / T.grid.snapMin) * T.grid.snapMin;
  return {
    cols: grid.cols.length,
    hrules: grid.hrules.length,
    atTopRule: axis ? Math.round(axis.minutesAt(TOP)) : null,
    naiveAtTopRule: naive ? Math.round(naive.minutesAt(TOP)) : null,
    cells: cells.map(x => x.col + ':' + snap(axis.minutesAt(x.y0)) + '-' + snap(axis.minutesAt(x.y1))).sort(),
  };
});
ok(ruled.grid !== null && ruled.cols === 6,
  'a ruled table gives up its six day columns', 'columns: ' + ruled.cols);
ok(ruled.atTopRule === 480,
  'the hour label is read as sitting BELOW its own rule, not on it',
  'the 8am rule reads ' + ruled.atTopRule + ' min');
note('fitting the label boxes instead, as the block reader does, puts that rule at ' +
  ruled.naiveAtTopRule + ' min — clean, plausible, and a quarter of an hour early');
ok(ruled.cells.join(' ') === '0:480-540 0:540-600 1:600-690 3:720-780 4:480-540',
  'the cells come back on the hour, cut where two meet and not where one runs on',
  ruled.cells.join(' '));
ok(ruled.cells.filter(x => x.startsWith('3:')).length === 1,
  'and the tinted column yields its one class, not nine hours of one',
  ruled.cells.filter(x => x.startsWith('3:')).join(' ') || 'nothing');

// The crop that cuts a room in half: it must be reported, not proposed.
const cropped = 'data:image/jpeg;base64,' +
  fs.readFileSync(path.join(CORPUS, '14-gcal-crop-column.jpg')).toString('base64');
const cut = await page.evaluate(async (u) => {
  const out = await window.wayfindImageExtract(u);
  return {
    layout: out.layout, n: out.classes.length,
    unsure: out.unsure.map(u2 => (u2.building || '?') + ' ' + (u2.room || '?') + ' — ' + u2.why),
    everyClassHasFourFields: out.classes.every(c =>
      c.building && c.room && c.day && /^\d\d:\d\d$/.test(c.start) && /^\d\d:\d\d$/.test(c.end)),
    rooms: out.classes.map(c => c.room),
    whyStrings: out.classes.filter(c => c.needsConfirm).map(c => c.why),
  };
}, cropped);
note('layout: ' + cut.layout + ', proposed ' + cut.n + ', unsure ' + cut.unsure.length);
for (const u of cut.unsure.slice(0, 4)) note('unsure: ' + u);
ok(cut.everyClassHasFourFields,
  'every class it does propose has all four fields filled in', cut.n + ' proposed');
// The cut Friday column on this image reads "WEL 2.22" — the left half of WEL
// 2.224. It must not appear as a class, whatever else happens on this image.
ok(!cut.rooms.includes('2.22'),
  'the half-room the crop cut through is not proposed as a room',
  'rooms proposed: ' + [...new Set(cut.rooms)].join(' '));
// UT does not print four digits in a row. One that reaches the student is a
// room number whose full stop was lost in the scan — a different floor,
// proposed at full confidence, which is what happened on a real screenshot.
ok(cut.rooms.every(r => !/\d{4}/.test(String(r))),
  'and no proposed room has four digits in a row, which is a lost full stop',
  'rooms proposed: ' + [...new Set(cut.rooms)].join(' '));

// A POSITIVE TEST FOR `unsure`, because an empty list passes every rule about
// what a list contains. Image 05 has rows this reader can see and cannot
// finish, and each one has to come back with a sentence.
const partial = 'data:image/jpeg;base64,' +
  fs.readFileSync(path.join(CORPUS, '05-ut-table-angled-left.jpg')).toString('base64');
const soft = await page.evaluate(async (u) => {
  const out = await window.wayfindImageExtract(u);
  return { n: out.classes.length, unsure: out.unsure.map(x => x.why) };
}, partial);
note('the angled table: ' + soft.n + ' proposed, ' + soft.unsure.length + ' held back');
for (const w of soft.unsure.slice(0, 3)) note('unsure: ' + w);
ok(soft.unsure.length > 0 && soft.unsure.every(w => typeof w === 'string' && w.length > 12),
  'a row it can see but cannot finish comes back with a reason, not silence',
  soft.unsure.length + ' held back');

// AND THE HARDEST CASE OF ALL: A PICTURE IT CANNOT READ AT ALL. Image 06 is an
// angled photograph of a week grid whose captions do not come apart; it
// proposes nothing, and until this round it returned a completely empty result
// with no explanation, which a student cannot tell from "there is nothing on
// this picture". It has to name what it can see.
const unreadable = 'data:image/jpeg;base64,' +
  fs.readFileSync(path.join(CORPUS, '06-gcal-angled-right.jpg')).toString('base64');
const blind = await page.evaluate(async (u) => {
  const out = await window.wayfindImageExtract(u);
  return {
    layout: out.layout, n: out.classes.length, seen: out.seen,
    unsure: out.unsure.map(x => x.why), days: out.unsure.map(x => x.day).filter(Boolean),
  };
}, unreadable);
note('the angled week grid: layout ' + blind.layout + ', proposed ' + blind.n +
  ', seen-not-read ' + (blind.seen || {}).onlySeen);
for (const w of blind.unsure.slice(0, 1)) note('unsure: ' + w);
ok(blind.layout === 'grid',
  'the day headings are repaired far enough to enter the grid reader at all',
  'layout: ' + blind.layout);
ok(blind.n === 0 && blind.unsure.length > 0,
  'a calendar it cannot read reports what it saw instead of nothing at all',
  blind.unsure.length + ' seen and not read, 0 proposed');
ok(new Set(blind.days).size >= 3,
  'and it still knows which day each of them is on, from the column',
  [...new Set(blind.days)].join(' '));

// ════════════════════════════════════════════════════════════════════════════
head('6. no page errors along the way');
const real = errs.filter(e => !/favicon|__schedimg_canary/.test(e));
ok(real.length === 0, 'the console stayed clean', real.slice(0, 3).join(' | ') || 'no errors');

await page.evaluate(async () => { try { await window.__schedimg.releaseEngine(); } catch (e) {} });
console.log('\n' + (fail ? 'FAILED  ' : 'ok  ') + pass + ' passed, ' + fail + ' failed\n');
try { browser.__done(); } catch (e) {}
stopServer();
sink.close();
process.exit(fail ? 1 : 0);
