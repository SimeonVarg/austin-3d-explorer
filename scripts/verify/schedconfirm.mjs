/**
 * schedconfirm.mjs — the gate for `js/schedconfirm.js`.
 *
 *   node scripts/verify/schedconfirm.mjs            (starts its own server)
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/schedconfirm.mjs
 *
 * SIX THINGS, AND EACH ONE IS A PROMISE THE CONFIRM FLOW MAKES.
 *
 *   1. IT COSTS THE PAGE NOTHING. Not referenced from index.html, not fetched
 *      until a student is actually looking at a result. Asserted at the network
 *      level on the real page, not by reading the HTML.
 *   2. THE MODEL FIRES ON THE CASE IT WAS BUILT FOR, AND STAYS QUIET OTHERWISE.
 *      Eight synthetic readings, one per cross-check, run against the real
 *      module in the real page — no OCR, so this section is fast and is the one
 *      to run while changing a weight.
 *   3. THE LINE HOLDS BOTH WAYS. A clean reading is not asked about; a reading
 *      with an ambiguous building always is; and a reading below trustBelow is
 *      never pre-selected — that last one is the difference between a check and
 *      a trap.
 *   4. NOTHING LEAVES THE DEVICE. Context-level capture (so a worker's own
 *      fetches are in scope) plus a raw socket that cannot have a blind spot
 *      about its own input, then the instruments are PROVED not blind with a
 *      canary before the result is believed.
 *   5. IT WORKS ON A 390x844 PHONE WITH ONE THUMB. Measured on the FRAME and
 *      on the box model: the panel is inside the viewport, nothing scrolls
 *      sideways, every control that ends a step is at least 44 px tall, and the
 *      crop beside each question contains actual pixels of the student's own
 *      picture rather than an empty canvas that is "present in the DOM".
 *   6. THE ANSWERS GO WHERE THEY WERE PROMISED. One tap on a Tuesday/Thursday
 *      reading changes BOTH meetings; a day answer of "Mon,Wed" produces two
 *      meetings and not three; an unanswered reading below keepUnansweredAbove
 *      is dropped rather than saved.
 *
 * It does NOT print a benchmark score. `image-bench.mjs` owns that number and
 * `confirm-line.mjs` owns where the threshold goes; quoting either here is how
 * two numbers drift apart.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CORPUS = path.join(HERE, 'schedule-images');
const args = process.argv.slice(2);
const shotArg = (() => { const i = args.indexOf('--shots'); return i >= 0 ? args[i + 1] : null; })();
const SHOTS = shotArg ? path.resolve(shotArg) : path.join(ROOT, 'shots', 'img-confidence');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, name, detail) => {
  if (c) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
};
const note = s => console.log('        ' + s);
const head = s => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 70 - s.length)));

/* ── a socket that cannot lie about what reached it ────────────────────────── */
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

/* ── the server. NEVER python -m http.server: it ignores Range:. ───────────── */
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

const browser = await launch(chromium, { maxMs: Number(process.env.VERIFY_MAX_MS || 1200000) });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  deviceScaleFactor: 2,
});

const seen = [];
let capturing = true;
await ctx.route('**/*', async (route) => {
  if (capturing) {
    const req = route.request();
    let body = null;
    try { const b = req.postDataBuffer(); body = b ? b.toString('utf8') : null; } catch (e) {}
    seen.push({ url: req.url(), method: req.method(), body });
  }
  try { await route.continue(); } catch (e) {}
});

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 250)); });

/* ── a PNG decoder, so an assertion can be about the FRAME ────────────────── */
function decodePNG(buf) {
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 2;
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++], line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev ? prev[i] : 0;
      const c = (prev && i >= ch) ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

/** Standard deviation of luma over a decoded PNG — 0 means a flat rectangle. */
function lumaSpread(png) {
  const { w, h, ch, data } = png;
  let n = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * ch;
    const l = ch >= 3 ? 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] : data[p];
    n++; sum += l; sum2 += l * l;
  }
  return Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
}

/* ════════════════════════════════════════════════════════════════════════════
   1. IT COSTS THE PAGE NOTHING
   ════════════════════════════════════════════════════════════════════════════ */
head('1. the page pays nothing for a screen nobody opened');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(!/schedconfirm/.test(html), 'index.html does not reference js/schedconfirm.js');

await page.goto(BASE + '/index.html?walk=1', { waitUntil: 'load', timeout: 180000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForTimeout(1200);
const atLoad = seen.filter(r => /schedconfirm|schedimg|tesseract|traineddata/i.test(r.url));
note(seen.length + ' requests while the page loaded');
ok(atLoad.length === 0, 'and fetches neither reader nor engine at load',
  atLoad.length ? atLoad.slice(0, 3).map(r => r.url.slice(-50)).join(' | ') : 'none');
ok(await page.evaluate(() => typeof window.SCHEDCONFIRM) === 'undefined',
  'window.SCHEDCONFIRM is absent until it is imported');

/* ════════════════════════════════════════════════════════════════════════════
   2. THE MODEL — eight synthetic readings, one per cross-check
   ════════════════════════════════════════════════════════════════════════════ */
head('2. every cross-check fires on the case it was built for');
await page.evaluate(async (b) => {
  window.__cfm = await import(b + '/js/schedconfirm.js');
}, BASE);
ok(await page.evaluate(() => typeof window.__cfm.review) === 'function',
  'the module imports into the real page and exports review()');

const model = await page.evaluate(() => {
  const M = window.__cfm;
  // ONE HELPER, so every case below differs only in the thing it is testing.
  // 92 is a clean word confidence off this corpus; the shapes are the shapes
  // js/schedimg.js actually emits.
  const mk = (over) => {
    const c = {
      course: 'M 340L', building: 'RLP', room: '0.106', day: 'Tue', days: ['Tue'],
      start: '09:30', end: '11:00',
      ev: {
        boxes: { building: { x0: 10, y0: 10, x1: 40, y1: 26 },
          room: { x0: 42, y0: 10, x1: 90, y1: 26 }, day: null, time: null,
          all: { x0: 0, y0: 8, x1: 300, y1: 28 } },
        conf: { building: 92, room: 92, day: 92, time: 92 },
        from: { day: 'column', time: 'axis', room: 'read', building: 'lexicon' },
        flags: { knownCode: true, axisAgrees: true, edge: {}, source: 'screenshot' },
        candidates: { building: ['RLP'] },
      },
    };
    return Object.assign(c, over || {});
  };
  const dive = (over, evOver) => {
    const c = mk(over);
    if (evOver) {
      Object.assign(c.ev.flags, evOver.flags || {});
      Object.assign(c.ev.from, evOver.from || {});
      Object.assign(c.ev.conf, evOver.conf || {});
      if (evOver.candidates) c.ev.candidates = evOver.candidates;
    }
    return c;
  };
  const one = (c, extra, opts) => {
    const r = M.review({ classes: [c].concat(extra || []), unsure: [] }, opts || {});
    return { r, s: r.classes[0].score, ask: r.classes[0].ask,
      q: r.questions.filter(q => q.groupId === r.classes[0].__group) };
  };

  const out = {};
  out.clean = one(mk());

  // CRE is a REAL ambiguity in the app's own 209-code table, not an invented
  // one: it is one confusable character from CPE (Chemical and Petroleum
  // Engineering) and from GRE (Gregory Gymnasium), which are 400 m apart.
  // Section 2b proves that against the table itself.
  out.ambiguous = one(dive({ building: 'CRE' }, {
    flags: { knownCode: false, rawCode: 'CRE' }, from: { building: 'unrepaired' },
    candidates: { building: ['CPE', 'GRE'] },
  }));

  out.repaired = one(dive({ building: 'PAI' }, {
    flags: { knownCode: false, rawCode: 'PAL', repaired: true },
    from: { building: 'repaired' }, candidates: { building: ['PAI'] },
  }));

  out.unknownCode = one(dive({ building: 'MZQ' }, {
    flags: { knownCode: false, rawCode: 'MZQ' }, from: { building: 'unrepaired' },
    candidates: { building: [] },
  }));

  out.fourDigit = one(dive({ building: 'GSB', room: '2122' }));

  out.dotMismatch = one(dive({ building: 'GDC', room: '2216' }),
    [dive({ building: 'GDC', room: '2.410', day: 'Thu' })]);

  out.noMeridiem = one(dive({}, { flags: { noMeridiem: true }, from: { time: 'text' } }));

  out.offGrid = one(dive({ start: '09:07', end: '10:07' }));

  out.collide = one(mk(), [mk({ building: 'WEL', room: '2.224', course: 'PHY 303' })]);

  // A PARTIAL clash, which the benchmark's own answer key contains: schedule s3
  // has C S 429 at 10:00-11:00 MWF and HIS 315K at 10:30-11:30 MW, both marked
  // required, on images 03, 07 and 10.
  out.overlap = one(mk({ start: '10:00', end: '11:00' }),
    [mk({ building: 'MEZ', room: '1.306', start: '10:30', end: '11:30', course: 'HIS 315K' })]);

  out.endOff = one(mk({ end: '10:55' }));

  out.disagree = one(dive({}, { flags: { axisAgrees: false } }));

  out.cutOff = one(dive({}, { flags: { edge: { room: true } } }));

  // The walking cross-check, with a stub graph: two classes 5 minutes apart in
  // buildings 19 minutes apart on foot.
  out.walk = one(mk({ start: '09:30', end: '11:00' }),
    [mk({ building: 'WEL', room: '2.224', start: '11:05', end: '12:00', course: 'PHY 303' })],
    { routeMinutes: (a, b) => 19 });
  out.walkOff = one(mk({ start: '09:30', end: '11:00' }),
    [mk({ building: 'WEL', room: '2.224', start: '11:05', end: '12:00', course: 'PHY 303' })]);

  const lite = (x) => ({
    overall: x.s.overall, fields: x.s.fields, ask: x.ask,
    notes: x.s.notes,
    qs: x.q.map(q => ({ field: q.field, trusted: q.trusted, ask: q.ask,
      options: q.options.map(o => o.value), first: q.options[0] ? q.options[0].value : null })),
    defect: x.s.defect, legible: x.s.legible,
  });
  const res = {};
  for (const k of Object.keys(out)) res[k] = lite(out[k]);
  res.CONF = { askBelow: M.CONF.askBelow, trustBelow: M.CONF.trustBelow };
  return res;
});

const L = model.CONF.askBelow;
ok(!model.clean.ask && model.clean.overall >= L,
  'a clean reading is not asked about', 'overall ' + model.clean.overall.toFixed(2));
ok(model.ambiguous.ask && model.ambiguous.qs.some(q => q.field === 'building'),
  'a code that could be two real buildings is always asked about',
  'building ' + model.ambiguous.fields.building.toFixed(2));
ok(model.ambiguous.qs.some(q => q.options.indexOf('CPE') >= 0 && q.options.indexOf('GRE') >= 0),
  'and both real codes are offered as taps',
  (model.ambiguous.qs[0] || {}).options + '');
ok(model.repaired.ask && model.repaired.fields.building < L,
  'a code repaired by one character is asked about, not asserted',
  model.repaired.fields.building.toFixed(2));
ok(model.unknownCode.ask,
  'a well-formed code the app does not know is asked about, not deleted',
  model.unknownCode.fields.building.toFixed(2));
ok(model.fourDigit.ask && model.fourDigit.qs.some(q =>
  q.field === 'room' && q.options.indexOf('2.122') >= 0),
  'a four-digit room offers the dotted form UT actually uses',
  '2122 -> ' + JSON.stringify((model.fourDigit.qs.find(q => q.field === 'room') || {}).options));
ok(model.dotMismatch.ask && /dot/.test((model.dotMismatch.notes.room || []).join(' ')),
  'an undotted room in a building whose other rooms are dotted is asked about',
  (model.dotMismatch.notes.room || [])[0]);
ok(model.noMeridiem.ask && model.noMeridiem.fields.time < L,
  'a time with no am/pm printed anywhere is asked about',
  model.noMeridiem.fields.time.toFixed(2));
ok(model.offGrid.ask && /9:07/.test((model.offGrid.notes.time || []).join(' ')),
  'a class starting at 9:07 is asked about', (model.offGrid.notes.time || [])[0]);
ok(model.collide.ask && /very same hour/.test((model.collide.notes.time || []).join(' ')),
  'two classes at one hour on one day make BOTH suspect',
  (model.collide.notes.time || [])[0]);
ok(!model.overlap.ask && /overlaps/.test((model.overlap.notes.time || []).join(' ')),
  'but a PARTIAL clash is reported and not asked about — the corpus answer key has one',
  (model.overlap.notes.time || [])[0] + '  -> t=' + model.overlap.fields.time.toFixed(2));
ok(model.endOff.ask && model.endOff.qs.some(q => q.field === 'time' &&
  q.options.indexOf('09:30-11:00') >= 0),
  'a class ending at 10:55 is asked about, with 11:00 among the buttons',
  JSON.stringify((model.endOff.qs.find(q => q.field === 'time') || {}).options));
ok(model.disagree.ask, 'the ruler and the caption disagreeing is asked about',
  model.disagree.fields.time.toFixed(2));
ok(model.cutOff.ask && model.cutOff.fields.room < 0.2,
  'a field cut by the edge of a crop is all but refused',
  model.cutOff.fields.room.toFixed(2));
ok(model.walk.ask && /walk/.test((model.walk.notes.time || []).join(' ')),
  'the campus graph catches five minutes between a nineteen-minute walk',
  (model.walk.notes.time || []).join(' ') || '(no note)');
ok(!/walk/.test((model.walkOff.notes.time || []).join(' ')),
  'and that check is silent when the graph is not loaded, rather than guessing');

/* ════════════════════════════════════════════════════════════════════════════
   2b. THE AMBIGUITY IS IN THE APP'S OWN TABLE, and so is the hole
   ════════════════════════════════════════════════════════════════════════════ */
head('2b. against the real 209-code register, not a fixture');
const lex = await page.evaluate(async (b) => {
  const si = await import(b + '/js/schedimg.js');
  const codes = await si.buildingCodes();
  const CONFUSE_PAIRS = [];
  // Every pair of REAL codes one confusable character apart: the readings this
  // whole file is blind to, enumerated from the data rather than guessed at.
  const alts = { O: '0Q', 0: 'OQD', I: '1LT', 1: 'IL', L: 'I1', S: '5', 5: 'S',
    B: '8', 8: 'B', G: '6C', 6: 'G', Z: '2', 2: 'Z', D: 'O0', C: 'G', U: 'V',
    V: 'U', R: 'P', P: 'R', E: 'F', F: 'E', M: 'N', N: 'M' };
  const seen = new Set();
  for (const c of codes) {
    for (let i = 0; i < c.length; i++) {
      for (const a of (alts[c[i]] || '')) {
        const o = c.slice(0, i) + a + c.slice(i + 1);
        if (o !== c && codes.has(o)) {
          const k = [c, o].sort().join('/');
          if (!seen.has(k)) { seen.add(k); CONFUSE_PAIRS.push(k); }
        }
      }
    }
  }
  return {
    size: codes.size,
    cre: si.codeCandidates('CRE', codes),
    mez: si.codeCandidates('MEZ', codes),
    pal: si.codeCandidates('PAL', codes),
    repairCRE: si.repairCode('CRE', codes),
    silentPairs: CONFUSE_PAIRS.sort(),
  };
}, BASE);
note('the lexicon is ' + lex.size + ' codes');
ok(lex.cre.length === 2 && lex.cre.indexOf('CPE') >= 0 && lex.cre.indexOf('GRE') >= 0,
  '"CRE" really is two real UT buildings away, per data/ut_buildings.json',
  lex.cre.join(' or '));
ok(lex.repairCRE === null,
  'and repairCode() correctly REFUSES to write either of them down by itself');
ok(lex.pal.length === 1 && lex.pal[0] === 'PAI',
  '"PAL" has exactly one real neighbour, so that one IS written down, flagged',
  lex.pal.join(''));
// THE HOLE, ASSERTED RATHER THAN CLAIMED. See docs/img-confidence.md.
ok(lex.mez.length === 1 && lex.mez[0] === 'MEZ',
  'MEZ is itself a real code, so a NEZ misread as MEZ raises no doubt at all',
  'this is the failure this file cannot see');
note(lex.silentPairs.length + ' pairs of real codes are one confusable character ' +
  'apart: ' + lex.silentPairs.slice(0, 6).join(', ') + ' ...');

/* ════════════════════════════════════════════════════════════════════════════
   3. THE LINE HOLDS BOTH WAYS
   ════════════════════════════════════════════════════════════════════════════ */
head('3. the second line: what is offered first, and what is not offered first');
const bq = model.ambiguous.qs.find(q => q.field === 'building');
ok(bq && !bq.trusted && bq.first !== 'CRE',
  'a code that is not a code is NOT the first button — a check would be a trap',
  bq ? 'first = ' + bq.first : 'no question');
const rq = model.fourDigit.qs.find(q => q.field === 'room');
ok(rq && !rq.trusted && rq.first === '2.122',
  'nor is a room the app can NAME a defect in: the correction leads',
  rq ? 'first = ' + rq.first + ' (the reading, 2122, is second)' : 'no question');
// And the other half of the rule: a doubt about the reading is not the same as
// a doubt about its NEIGHBOURS. Two classes in one hour makes the time suspect
// without making these four digits suspect, so the reading still leads.
const cq = model.collide.qs.find(q => q.field === 'time');
ok(cq && cq.trusted && cq.first === '09:30-11:00',
  'a RELATIONAL doubt leaves the reading first, phrased as a check',
  cq ? 'first = ' + cq.first : 'no question');
ok(model.fourDigit.qs.some(q => q.field === 'room') && model.collide.ask,
  'both cases are still asked about — leading is about ORDER, not about silence');

/* ════════════════════════════════════════════════════════════════════════════
   4. NOTHING LEAVES THE DEVICE
   ════════════════════════════════════════════════════════════════════════════ */
head('4. nothing leaves the device');
const netMark = seen.length;

const CORPUS_IMG = path.join(CORPUS, '01-ut-table-clean.jpg');
const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(CORPUS_IMG).toString('base64');

const real = await page.evaluate(async ([b, u]) => {
  const si = await import(b + '/js/schedimg.js');
  const cf = await import(b + '/js/schedconfirm.js');
  window.__si = si; window.__cf = cf;
  const t0 = performance.now();
  const out = await si.extract(u, { keepSheet: true });
  window.__out = out;
  const rev = cf.review(out, { buildingName: () => null });
  window.__rev = rev;
  return {
    ms: Math.round(performance.now() - t0),
    classes: out.classes.length, questions: rev.questions.length,
    counts: rev.counts, sheet: !!(out.sheet && out.sheet.canvas),
    sheetW: out.sheet ? out.sheet.w : 0, sheetH: out.sheet ? out.sheet.h : 0,
  };
}, [BASE, dataUrl]);
note('image 01 read in ' + real.ms + ' ms: ' + real.classes + ' classes, ' +
  real.questions + ' questions, sheet ' + real.sheetW + 'x' + real.sheetH);
ok(real.sheet, 'the rectified page is kept as a CANVAS, which cannot be serialised anywhere');

// THE ALLOWLIST IS MEASURED, NOT WRITTEN DOWN. The app itself fetches basemap
// tiles from a public host, and it did so before this feature existed; the
// promise this section makes is that IMPORTING A SCHEDULE ADDS NO DESTINATION.
// So the set of hosts the page talked to before the image was handed over is
// the allowlist, and a single new one fails.
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u.slice(0, 12); } };
const hostsAtLoad = new Set(seen.slice(0, netMark)
  .filter(r => /^https?:/.test(r.url)).map(r => hostOf(r.url)));
note('hosts the app already used: ' + [...hostsAtLoad].join(', '));
const since = seen.slice(netMark);
const OFFBOX = since.filter(r => /^https?:/.test(r.url) && !hostsAtLoad.has(hostOf(r.url)));
const SECRETS = ['RLP', '0.106', 'GDC', '2.216', 'M 340L', 'CMA', '6.146', 'WEL', '2.224'];
const carrying = since.filter(r => {
  const hay = (r.url + ' ' + (r.body || '')).toUpperCase();
  const dec = (() => { try { return decodeURIComponent(hay); } catch (e) { return hay; } })();
  return SECRETS.some(s => hay.indexOf(s.toUpperCase()) >= 0 || dec.indexOf(s.toUpperCase()) >= 0);
});
note(since.length + ' requests since the image was handed over');
ok(OFFBOX.length === 0, 'the import contacted no host the app was not already using',
  OFFBOX.slice(0, 3).map(r => hostOf(r.url)).join(' | ') || 'none');
const OFFBOX_ANY = since.filter(r => /^https?:/.test(r.url) && hostOf(r.url).indexOf('127.0.0.1') < 0);
note(OFFBOX_ANY.length + ' off-box requests in that window, all of them ' +
  [...new Set(OFFBOX_ANY.map(r => hostOf(r.url)))].join('/') + ' basemap tiles');
ok(carrying.length === 0, 'and none carried a course code, a room or a building',
  carrying.slice(0, 2).map(r => r.url.slice(0, 70)).join(' | ') || 'none');
ok(sinkHits.length === 0, 'the raw socket sink was never contacted');

// AND NOW PROVE THE INSTRUMENTS ARE NOT BLIND. A capture that saw nothing is
// worth nothing until it has been shown catching something.
const canaryMark = seen.length;
await page.evaluate(async (s) => {
  try { await fetch(s + '/canary-fetch?RLP+0.106', { mode: 'no-cors' }); } catch (e) {}
  await new Promise((res) => {
    const src = 'self.addEventListener("message",async (e)=>{' +
      'try{await fetch(e.data+"/canary-worker?GDC+2.216",{mode:"no-cors"});}catch(x){}' +
      'self.postMessage(1);});';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = () => { w.terminate(); res(); };
    w.postMessage(s);
    setTimeout(res, 4000);
  });
}, SINK);
await page.waitForTimeout(900);
const canaries = seen.slice(canaryMark).filter(r => /canary/.test(r.url));
ok(canaries.some(r => /canary-fetch/.test(r.url)), 'the capture catches a plain fetch');
ok(canaries.some(r => /canary-worker/.test(r.url)),
  'and one made from inside a real Worker — so a worker leak could not hide');
ok(sinkHits.length >= 1, 'the raw socket caught them too, independently of Playwright',
  sinkHits.length + ' hit(s)');

/* ════════════════════════════════════════════════════════════════════════════
   5. THE SCREEN, ON A 390x844 PHONE
   ════════════════════════════════════════════════════════════════════════════ */
head('5. one thumb, 390x844, and the crop is really the student picture');

// A READING THAT IS GUARANTEED TO BE ASKED ABOUT, AND WHOSE CROP AGREES WITH
// THE QUESTION. It is appended to the REAL result of image 01 and its boxes are
// the REAL boxes of image 01's own GDC row, so the crop is that row's actual
// pixels — and the seeded reading is that row with its dot dropped, which is
// exactly the defect (a lost period) the bar's one near-miss was. Everything on
// the screen therefore refers to one real line of one real picture.
await page.evaluate(() => {
  const out = window.__out;
  const donor = out.classes.find(c => c.building === 'GDC' && c.ev && c.ev.boxes.room)
    || out.classes.find(c => c.ev && c.ev.boxes.room);
  const seed = {
    course: 'C S 429', building: 'GDC', room: '2216', day: 'Tue', days: ['Tue'],
    // 18:30 on purpose: every other hour on image 01 is taken, and a seeded
    // class laid on top of a real one is caught by the collision check — which
    // is correct behaviour and the wrong thing to be testing here.
    start: '18:30', end: '20:00', needsConfirm: true, why: null,
  };
  seed.ev = {
    boxes: donor ? JSON.parse(JSON.stringify(donor.ev.boxes)) : {
      building: { x0: 120, y0: 300, x1: 190, y1: 330 },
      room: { x0: 195, y0: 300, x1: 300, y1: 330 }, day: null, time: null,
      all: { x0: 60, y0: 296, x1: 700, y1: 334 } },
    conf: { building: 90, room: 74, day: 90, time: 90 },
    from: { day: 'column', time: 'axis', room: 'read', building: 'lexicon' },
    flags: { knownCode: true, rawCode: 'GDC', axisAgrees: true, edge: {}, source: 'screenshot' },
    candidates: { building: ['GDC'] },
  };
  const seed2 = JSON.parse(JSON.stringify(seed));
  seed2.day = 'Thu'; seed2.days = ['Thu']; seed2.ev = seed.ev;
  out.classes.push(seed, seed2);
  window.__rev = window.__cf.review(out, { buildingName: (c) => ({
    GDC: 'Gates Dell Complex' }[c] || null) });
  window.__host = document.createElement('div');
  document.body.appendChild(window.__host);
  window.__ui = window.__cf.mount(window.__host, window.__rev, {
    onDone: (r) => { window.__done = r; },
    onCancel: () => { window.__cancelled = true; },
  });
  // Show the seeded question, whatever else image 01 asked about today.
  const i = window.__rev.questions.findIndex(q => q.field === 'room' && q.current === '2216');
  if (i >= 0) { window.__ui.state.step = i; window.__ui.render(); }
});
await page.waitForTimeout(400);

const geom = await page.evaluate(() => {
  const r = document.getElementById('wf-cfm');
  const b = r.getBoundingClientRect();
  const tap = [...r.querySelectorAll('button')].map(x => {
    const q = x.getBoundingClientRect();
    return { t: (x.textContent || '').slice(0, 22), w: Math.round(q.width), h: Math.round(q.height) };
  });
  return {
    box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
    vw: innerWidth, vh: innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    tap,
    // The controls that END a step are the ones a thumb must reach; the close
    // cross and the back link are escape hatches and may be small.
    ends: tap.filter(x => !/^×$/.test(x.t) && !/Back/.test(x.t)),
    ask: (r.querySelector('.cfm-ask') || {}).textContent || '',
    opts: [...r.querySelectorAll('.cfm-opt-v')].map(x => x.textContent),
    count: (r.querySelector('.cfm-count') || {}).textContent || '',
  };
});
note('panel ' + geom.box.w + 'x' + geom.box.h + ' at (' + geom.box.x + ',' + geom.box.y +
  ') in a ' + geom.vw + 'x' + geom.vh + ' viewport');
note('the question on screen: "' + geom.ask + '"  ->  ' + geom.opts.join(' / '));
ok(/Which room is this/.test(geom.ask) && geom.opts[0] === '2.216',
  'the screen is showing the seeded room question, correction first', geom.opts.join('/'));
ok(geom.box.x >= 0 && geom.box.x + geom.box.w <= geom.vw,
  'the panel is inside the viewport left to right');
ok(geom.box.y >= 0 && geom.box.y + geom.box.h <= geom.vh,
  'and top to bottom, so nothing is below the fold',
  'bottom ' + (geom.box.y + geom.box.h) + ' of ' + geom.vh);
ok(geom.docScrollW <= geom.vw, 'the page does not scroll sideways',
  geom.docScrollW + ' vs ' + geom.vw);
const small = geom.ends.filter(t => t.h < 44);
ok(small.length === 0, 'every control that ends a step is at least 44 px tall',
  small.length ? JSON.stringify(small) : geom.ends.length + ' controls, min ' +
    Math.min(...geom.ends.map(t => t.h)) + ' px');
// THE THUMB ZONE. On a phone held one-handed the bottom half of the screen is
// what a thumb reaches without the hand moving.
const opts = await page.evaluate(() => [...document.querySelectorAll('.cfm-opt,.cfm-chip')]
  .map(x => Math.round(x.getBoundingClientRect().top)));
ok(opts.length > 0 && Math.min(...opts) > geom.vh * 0.35,
  'the answer buttons sit in the lower two-thirds, where a thumb is',
  'topmost option at y=' + (opts.length ? Math.min(...opts) : '—') + ' of ' + geom.vh);

// Screenshot twice and trust the second.
// JPEG, not PNG: these frames are CITED by docs/img-confidence.md so they are
// committed, and every committed byte is multiplied by every parallel worktree
// (CLAUDE.md rule 12). A 780x1688 PNG of this panel is 1.4 MB; the same frame
// at quality 80 is under 200 KB and nothing in it is a pixel test.
const shotQ = path.join(SHOTS, 'confirm-question-phone.jpg');
await page.screenshot({ path: path.join(SHOTS, '_throwaway.png') });
await page.waitForTimeout(250);
await page.screenshot({ path: shotQ, type: 'jpeg', quality: 80 });

// THE CROP IS ASSERTED ON THE FRAME, NOT ON THE DOM. "The canvas is present"
// is not the standard: Simeon judges from a phone recording, so what has to be
// true is that the pixels are there in the picture.
const cropBox = await page.evaluate(() => {
  const c = document.querySelector('.cfm-crop canvas');
  if (!c) return null;
  const b = c.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});
ok(!!cropBox, 'the question shows a crop canvas at all');
let spread = 0;
if (cropBox) {
  // PNG for the measurement — the decoder above reads PNG and a JPEG's own
  // ringing would move the number this assertion is about — and a JPEG copy
  // beside it for the doc to cite.
  const buf = await page.screenshot({ clip: cropBox });
  spread = lumaSpread(decodePNG(buf));
  await page.screenshot({ clip: cropBox, path: path.join(SHOTS, 'confirm-crop.jpg'),
    type: 'jpeg', quality: 88 });
}
ok(spread > 12, 'and the crop is really pixels of the picture, not an empty canvas',
  'luma spread ' + spread.toFixed(1) + ' (a blank canvas is 0)');

/* ════════════════════════════════════════════════════════════════════════════
   6. THE ANSWERS GO WHERE THEY WERE PROMISED
   ════════════════════════════════════════════════════════════════════════════ */
head('6. one tap, both meetings');
// A REVIEW OF ITS OWN, not the one on screen. This section is about where an
// answer LANDS, and it needs a reading with a known shape rather than whatever
// image 01 happened to produce today: two meetings of one Tue/Thu course off
// one line of a picture, with a code that is one confusable character from two
// real UT buildings (section 2b proves CRE is exactly that).
const flow = await page.evaluate(async () => {
  const M = window.__cf;
  const ev = {
    boxes: { building: { x0: 120, y0: 300, x1: 190, y1: 330 },
      room: { x0: 195, y0: 300, x1: 300, y1: 330 }, day: null, time: null,
      all: { x0: 60, y0: 296, x1: 700, y1: 334 } },
    conf: { building: 61, room: 74, day: 90, time: 90 },
    from: { day: 'column', time: 'axis', room: 'read', building: 'unrepaired' },
    flags: { knownCode: false, rawCode: 'CRE', axisAgrees: true, edge: {}, source: 'screenshot' },
    candidates: { building: ['CPE', 'GRE'] },
  };
  const a = { course: 'C S 429', building: 'CRE', room: '2122', day: 'Tue',
    days: ['Tue'], start: '14:00', end: '15:30', ev };
  const b = Object.assign({}, a, { day: 'Thu', days: ['Thu'] });
  const rev = M.review({ classes: [a, b], unsure: [] });
  window.__flowRev = rev;
  const before = rev.classes.filter(c => c.building === 'CRE').length;
  const bq = rev.questions.find(q => q.field === 'building' && q.current === 'CRE');
  if (bq) bq.answer = 'CPE';
  const rq = rev.questions.find(q => q.field === 'room' && q.current === '2122');
  if (rq) rq.answer = '2.122';
  const res = M.apply(rev);
  const got = res.classes.filter(c => c.building === 'CPE' && c.room === '2.122');
  return {
    before, after: got.length, days: got.map(c => c.day),
    total: res.classes.length, dropped: res.dropped.length,
    hadQuestions: !!bq && !!rq, groups: rev.groups.length,
    questions: rev.questions.length,
  };
});
ok(flow.groups === 1 && flow.questions === 2,
  'two meetings off one line of the picture are ONE reading and TWO questions',
  flow.groups + ' reading(s), ' + flow.questions + ' question(s) for 2 meetings');
ok(flow.hadQuestions, 'the reading produced both a building and a room question');
ok(flow.before === 2 && flow.after === 2,
  'one answer per field rewrites BOTH meetings of a Tue/Thu reading',
  flow.before + ' before -> ' + flow.after + ' after, on ' + flow.days.join('+'));

const days = await page.evaluate(() => {
  const rev = window.__flowRev;
  const g = rev.groups[0];
  // A day answer, in exactly the shape the chips emit.
  const dq = { id: 'qd', field: 'day', kind: 'days', groupId: g.id,
    classKey: g.lead.__key, ask: '', current: g.days.join(','),
    confidence: 0.4, trusted: true, why: null, options: [], answer: 'Mon,Wed' };
  rev.questions.push(dq);
  const res = window.__cf.apply(rev);
  const got = res.classes.filter(c => c.building === 'CPE');
  rev.questions.pop();
  return got.map(c => c.day);
});
ok(days.length === 2 && days.indexOf('Mon') >= 0 && days.indexOf('Wed') >= 0,
  'answering the day chips with Mon+Wed yields two meetings, not three',
  days.join('+'));

const drop = await page.evaluate(() => {
  const M = window.__cf;
  const c = {
    course: 'X 101', building: 'MZQ', room: '9%1', day: 'Tue', days: ['Tue'],
    start: '09:07', end: '09:41',
    ev: { boxes: {}, conf: { building: 30, room: 28, day: 30, time: 30 },
      from: { day: 'letters', time: 'text', room: 'read', building: 'unrepaired' },
      flags: { knownCode: false, rawCode: 'MZQ', noMeridiem: true, edge: {} },
      candidates: { building: [] } },
  };
  const rev = M.review({ classes: [c], unsure: [] });
  const res = M.apply(rev);   // nothing answered
  return { overall: rev.classes[0].score.overall, kept: res.classes.length,
    dropped: res.dropped.length, why: (res.dropped[0] || {}).why };
});
ok(drop.kept === 0 && drop.dropped === 1,
  'a reading nothing believed, left unanswered, is dropped rather than saved',
  'overall ' + drop.overall.toFixed(2) + ' -> ' + drop.why);

/* ── a refusal turned into a tap, and an empty result that still says what it saw ── */
head('6b. the two cases the reader could not answer at all');
const rec = await page.evaluate(() => {
  const M = window.__cf;
  const rev = M.review({
    classes: [],
    unsure: [{
      course: 'C S 429', building: 'CRE', room: '2.216', day: 'Tue', days: ['Tue', 'Thu'],
      start: '14:00', end: '15:30', reason: 'not-a-code',
      why: '"CRE" does not read like a UT building code',
      ev: { boxes: { all: { x0: 60, y0: 296, x1: 700, y1: 334 } }, conf: {}, from: {},
        flags: {}, candidates: { building: ['CPE', 'GRE'] } },
    }],
    seen: { onlySeen: 0 },
  });
  const before = M.apply(rev).classes.length;
  rev.recover[0].answer = 'CPE';
  const after = M.apply(rev).classes;
  return { n: rev.recover.length, options: rev.recover[0] ? rev.recover[0].options.map(o => o.value) : [],
    before, after: after.length, days: after.map(c => c.day),
    confirmed: after.every(c => c.confirmed) };
});
ok(rec.n === 1 && rec.options.join(',') === 'CPE,GRE',
  'a class REFUSED for an ambiguous code comes back as a choice of the two real ones',
  rec.options.join(' or '));
ok(rec.before === 0 && rec.after === 2 && rec.confirmed,
  'and nothing enters the schedule from it without a tap',
  rec.before + ' before the tap -> ' + rec.after + ' after, on ' + rec.days.join('+'));

const empty = await page.evaluate(() => {
  const M = window.__cf;
  const rev = M.review({
    classes: [], unsure: [{ course: null, day: 'Mon', start: null, end: null,
      why: 'a class is drawn here but none of its writing could be read', reason: 'seen-not-read' }],
    seen: { onlySeen: 10, days: ['Mon', 'Tue'] },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ui = M.mount(host, rev, {});
  const txt = host.textContent;
  const go = (host.querySelector('.cfm-go') || {}).textContent || '';
  ui.destroy(); host.remove();
  return { txt, go, questions: rev.questions.length };
});
ok(empty.questions === 0 && /10 more classes were visible/.test(empty.txt),
  'a picture that read as nothing still says how many classes it could SEE',
  '"' + (empty.txt.match(/10 more[^.]*\./) || [''])[0].slice(0, 90) + '"');
ok(/^Close$/.test(empty.go.trim()),
  'and offers Close rather than a Use button with nothing behind it',
  'button reads "' + empty.go + '"');

/* ── the summary screen, for the record ───────────────────────────────────── */
await page.evaluate(() => {
  const ui = window.__ui;
  ui.state.step = 999; ui.render();
});
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(SHOTS, '_throwaway.png') });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SHOTS, 'confirm-summary-phone.jpg'),
  type: 'jpeg', quality: 80 });

const sumGeom = await page.evaluate(() => {
  const r = document.getElementById('wf-cfm');
  const b = r.getBoundingClientRect();
  return { bottom: Math.round(b.y + b.height), vh: innerHeight,
    priv: !!r.querySelector('.cfm-priv'),
    go: (r.querySelector('.cfm-go') || {}).textContent || '' };
});
ok(sumGeom.bottom <= sumGeom.vh, 'the summary fits on the phone too',
  'bottom ' + sumGeom.bottom + ' of ' + sumGeom.vh);
ok(sumGeom.priv, 'and the line saying the picture never left the phone is on it');
note('final button reads: ' + sumGeom.go);

/* ── destroy() really destroys the picture ────────────────────────────────── */
head('7. the picture goes with the screen');
const gone = await page.evaluate(() => {
  const before = window.__rev.sheet && window.__rev.sheet.canvas
    ? window.__rev.sheet.canvas.width : 0;
  window.__ui.destroy();
  return { before, after: window.__rev.sheet ? window.__rev.sheet.canvas : 'null',
    inDom: !!document.getElementById('wf-cfm') };
});
ok(gone.before > 1 && gone.after === null,
  'closing the screen empties the canvas holding the schedule photograph',
  gone.before + ' px wide -> ' + gone.after);
ok(!gone.inDom, 'and takes the panel out of the document');

/* ════════════════════════════════════════════════════════════════════════════ */
head('console');
const real_errs = errs.filter(e => !/canary/i.test(e));
ok(real_errs.length === 0, 'no page errors', real_errs.slice(0, 3).join(' | ') || 'none');

console.log('\n' + (fail ? 'FAIL' : 'PASS') + '   ' + pass + ' passed, ' + fail + ' failed');
console.log('shots in ' + SHOTS);
try { fs.unlinkSync(path.join(SHOTS, '_throwaway.png')); } catch (e) {}
try { browser.__done && browser.__done(); } catch (e) {}
try { await browser.close(); } catch (e) {}
try { sink.close(); } catch (e) {}
stopServer();
process.exit(fail ? 1 : 0);
