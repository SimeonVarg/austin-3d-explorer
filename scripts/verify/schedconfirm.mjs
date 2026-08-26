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
        // codeCandidates() on a code that IS on the register returns just that
        // code, so the fixture has to track the building it is overridden with
        // or the option lists below carry a stale RLP that no real evidence
        // bundle would ever contain.
        candidates: { building: [(over && over.building) || 'RLP'] },
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
  // buildings 19 minutes apart on foot. It REPORTS and does not ask on its own
  // — see the assertions below and CONF.time.tooTight for why that changed.
  out.walk = one(mk({ start: '09:30', end: '11:00' }),
    [mk({ building: 'WEL', room: '2.224', start: '11:05', end: '12:00', course: 'PHY 303' })],
    { routeMinutes: (a, b) => 19 });
  out.walkOff = one(mk({ start: '09:30', end: '11:00' }),
    [mk({ building: 'WEL', room: '2.224', start: '11:05', end: '12:00', course: 'PHY 303' })]);
  // BACK-TO-BACK IS WHAT A REAL TIMETABLE LOOKS LIKE. With the graph live this
  // shape fired on twelve of the forty-nine meetings in the benchmark's own
  // ANSWER KEY before tooTight moved into the corroborating band. Section 2e
  // measures that against the whole key; this is the unit case.
  out.backToBack = one(mk({ start: '09:30', end: '11:00' }),
    [mk({ building: 'WEL', room: '2.224', start: '11:00', end: '12:30', course: 'PHY 303' })],
    { routeMinutes: (a, b) => 13 });

  // ── THE CONFUSABLE-NEIGHBOUR CHECK, on stubs, so the weights can be moved
  //    without waiting for a graph. Section 2c does the same on the REAL one.
  const stubN = (c) => ({ NEZ: ['MEZ'], MEZ: ['NEZ'], TSG: ['TSC'], TSC: ['TSG'] }[c] || []);
  const stubName = (c) => ({ NEZ: 'NORTH END ZONE BUILDING', MEZ: 'MEZES HALL',
    TSG: '27TH STREET GARAGE', TSC: 'LEE & JOE JAMAIL TEXAS SWIMMING CTR' }[c] || null);
  // A day whose other classes are 2 minutes from MEZ and 7 from NEZ: swapping
  // saves 10 minutes across the two adjacent walks, so NEZ is worth one tap.
  const near = (a, b) => (a === 'NEZ' || b === 'NEZ' ? 7 : 2);
  out.neighbourNearer = one(mk({ building: 'NEZ', room: '1.306', start: '10:30', end: '11:30' }),
    [mk({ building: 'WEL', room: '2.224', start: '09:00', end: '10:00' }),
      mk({ building: 'GDC', room: '2.216', start: '12:00', end: '13:00' })],
    { routeMinutes: near, neighbours: stubN, registerName: stubName });
  // ..and the SAME day with the truth in it must be silent.
  out.neighbourTruth = one(mk({ building: 'MEZ', room: '1.306', start: '10:30', end: '11:30' }),
    [mk({ building: 'WEL', room: '2.224', start: '09:00', end: '10:00' }),
      mk({ building: 'GDC', room: '2.216', start: '12:00', end: '13:00' })],
    { routeMinutes: near, neighbours: stubN, registerName: stubName });
  // The strong form: the neighbour turns a walk that does not fit into one that
  // does. The question moves off the CLOCK and onto the BUILDING.
  out.neighbourFixes = one(mk({ building: 'NEZ', room: '1.306', start: '10:00', end: '11:00' }),
    [mk({ building: 'WEL', room: '2.224', start: '09:00', end: '10:00' })],
    { routeMinutes: near, neighbours: stubN, registerName: stubName });
  // UT's own printed name, for the pairs that are too close together for the
  // graph to separate. Nobody is taught in a car park.
  out.venue = one(mk({ building: 'TSG', room: '1.102' }),
    [], { neighbours: stubN, registerName: stubName });
  // ..and the swimming centre next door to it raises nothing.
  out.venueOk = one(mk({ building: 'TSC', room: '1.102' }),
    [], { neighbours: stubN, registerName: stubName });

  const lite = (x) => ({
    overall: x.s.overall, fields: x.s.fields, ask: x.ask,
    notes: x.s.notes, extraCodes: x.s.extraCodes || [],
    walkCheck: x.r.walkCheck,
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
ok(/walk/.test((model.walk.notes.time || []).join(' ')),
  'the campus graph SEES five minutes between a nineteen-minute walk',
  (model.walk.notes.time || []).join(' ') || '(no note)');
// AND DOES NOT ASK ON IT ALONE, which is the correction this round made and the
// most useful thing the measurement did. "There is not enough time to walk
// this" has no candidate answer — the only button is the reading — and with a
// real graph behind it, it fired on twelve of the forty-nine meetings of the
// benchmark's own answer key, every one of them correct. It corroborates now.
ok(!model.walk.ask && Math.abs(model.walk.fields.time - 0.85) < 1e-9,
  'but it does NOT ask on that alone: a doubt with no candidate answer corroborates',
  'time = ' + model.walk.fields.time.toFixed(2) + ', line ' + L);
ok(!model.backToBack.ask,
  'so two classes printed back to back — what a real timetable looks like — are quiet',
  'overall ' + model.backToBack.overall.toFixed(2));
ok(!/walk/.test((model.walkOff.notes.time || []).join(' ')),
  'and that check is silent when the graph is not loaded, rather than guessing');

/* ── the hole this round was for: a REAL code that is the WRONG real code ──── */
const nq = model.neighbourNearer.qs.find(q => q.field === 'building');
ok(model.neighbourNearer.ask && nq,
  'a real code whose one-stroke neighbour fits the rest of the day far better is asked about',
  'building ' + model.neighbourNearer.fields.building.toFixed(2));
ok(nq && nq.options.indexOf('MEZ') >= 0 && nq.options.indexOf('NEZ') >= 0,
  'and BOTH real codes are on the screen as taps — the button that closes the hole',
  nq ? JSON.stringify(nq.options) : '(no question)');
ok(nq && nq.trusted && nq.first === 'NEZ',
  'the READING still leads: nothing is wrong with these four characters',
  nq ? 'first = ' + nq.first : '');
ok(!model.neighbourTruth.ask,
  'and the same day with the TRUE building in it asks nothing at all',
  'overall ' + model.neighbourTruth.overall.toFixed(2));
const fq = model.neighbourFixes.qs.find(q => q.field === 'building');
ok(model.neighbourFixes.ask && fq && !model.neighbourFixes.qs.some(q => q.field === 'time'),
  'when the neighbour makes an impossible walk possible, the question moves off the CLOCK',
  'questions: ' + model.neighbourFixes.qs.map(q => q.field).join(',') || '(none)');
const vq = model.venue.qs.find(q => q.field === 'building');
ok(model.venue.ask && vq && vq.options.indexOf('TSC') >= 0,
  'UT calling it a GARAGE is asked about, with the building next door offered',
  vq ? JSON.stringify(vq.options) : '(no question)');
ok(!model.venueOk.ask,
  'and the swimming centre one stroke away from it raises nothing',
  'overall ' + model.venueOk.overall.toFixed(2));
ok(model.neighbourNearer.walkCheck.neighbours && model.venue.walkCheck.venue,
  'review() REPORTS which cross-checks were live rather than leaving it to be assumed',
  JSON.stringify(model.neighbourNearer.walkCheck));

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
    // THE NEW EXPORT, AND WHAT IT IS FOR. codeCandidates('MEZ') is ['MEZ'] —
    // the code is on the register, so there is nothing to offer and the misread
    // went through in silence. codeNeighbours() answers the other question.
    mezNbr: si.codeNeighbours('MEZ', codes),
    nezNbr: si.codeNeighbours('NEZ', codes),
    gdcNbr: si.codeNeighbours('GDC', codes),
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
// THE HOLE AS IT STOOD LAST ROUND, still asserted from the data, because the
// premise has not changed — only what this file does about it.
ok(lex.mez.length === 1 && lex.mez[0] === 'MEZ',
  'MEZ is itself a real code, so no LEXICON check can doubt a NEZ read as MEZ',
  'codeCandidates has nothing to offer here — that is the hole');
ok(lex.mezNbr.length === 1 && lex.mezNbr[0] === 'NEZ' &&
   lex.nezNbr.length === 1 && lex.nezNbr[0] === 'MEZ',
  '..and codeNeighbours() is what has something to offer: MEZ <-> NEZ, from the register',
  'MEZ -> ' + lex.mezNbr.join(',') + ' / NEZ -> ' + lex.nezNbr.join(','));
ok(lex.gdcNbr.length === 0,
  'a code with no confusable real neighbour gets no question from it',
  'GDC -> ' + JSON.stringify(lex.gdcNbr));
note(lex.silentPairs.length + ' pairs of real codes are one confusable character ' +
  'apart: ' + lex.silentPairs.join(', '));

/* ════════════════════════════════════════════════════════════════════════════
   2c. THE SAME THING ON THE REAL GRAPH — and exactly how far it reaches

   Section 2b proves the hole exists in the app's own register. This proves the
   fix reaches into it, on `data/walk_graph.json` itself rather than a stub, AND
   measures the part of it the fix does NOT reach, pair by pair.
   ════════════════════════════════════════════════════════════════════════════ */
head('2c. the confusable-pair check, on the real walk graph');
const realGraph = await page.evaluate(async ([b, pairs]) => {
  const M = window.__cfm;
  const wg = await import(b + '/js/walkgraph.js');
  const probe = await wg.walkProbe();
  if (!probe) return { loaded: false };
  const ctx = await M.prepare();
  const mk = (over) => Object.assign({
    course: 'HIS 315K', building: 'MEZ', room: '1.306', day: 'Mon', days: ['Mon'],
    start: '10:30', end: '11:30',
    ev: {
      boxes: {}, conf: { building: 92, room: 92, day: 92, time: 92 },
      from: { day: 'column', time: 'axis', room: 'read', building: 'lexicon' },
      flags: { knownCode: true, axisAgrees: true, edge: {}, source: 'screenshot' },
      candidates: { building: [(over && over.building) || 'MEZ'] },
    },
  }, over || {});
  // The corpus's own schedule s3 puts a real class at MEZ 1.306. Every shape
  // below is that class with ONE STROKE changed.
  // ── THE THREE SHAPES, AND WHY THERE ARE THREE ────────────────────────────
  //
  // For one whole round this section had only `day` — the misread inside a
  // THREE-CLASS DAY — and it passed green while a real-but-wrong code was
  // committed at 1.00 on every schedule shape that has no same-day neighbour.
  // The gate was green over the hole. So the same misread now runs in three
  // shapes, and `day` STAYS as the control: without it a silent result here is
  // indistinguishable from a rig that stopped working.
  //
  //   day   the misread with a class either side of it, same day  (the control)
  //   week  alone on Friday, with an ordinary MWF load on other days
  //   lone  alone on Friday, and the ONLY class in the schedule
  //
  // Each of the three is run twice, once with the misread and once with the
  // TRUE code, because "it asks" is only half the property. The half that
  // costs a student something is "it stays quiet when the reading is right".
  const day = (code) => [
    mk({ building: 'WEL', room: '2.224', start: '09:00', end: '10:00', course: 'PHY 303' }),
    mk({ building: code, room: '1.306', start: '10:30', end: '11:30' }),
    mk({ building: 'GDC', room: '2.216', start: '12:00', end: '13:00', course: 'C S 429' }),
  ];
  const week = (code) => [
    mk({ building: 'WEL', room: '2.224', day: 'Mon', days: ['Mon'],
      start: '09:00', end: '10:00', course: 'PHY 303' }),
    mk({ building: 'GDC', room: '2.216', day: 'Wed', days: ['Wed'],
      start: '12:00', end: '13:00', course: 'C S 429' }),
    mk({ building: code, room: '1.306', day: 'Fri', days: ['Fri'],
      start: '10:30', end: '11:30' }),
  ];
  const lone = (code) => [
    mk({ building: code, room: '1.306', day: 'Fri', days: ['Fri'],
      start: '10:30', end: '11:30' }),
  ];
  const run = (code, shape) => {
    const classes = (shape || day)(code);
    const r = M.review({ classes, unsure: [] }, ctx);
    const c = r.classes.find(x => x.building === code);
    const q = r.questions.filter(x => x.classKey === c.__key);
    return {
      ask: c.ask, building: c.score.fields.building, overall: c.score.overall,
      why: (c.score.notes.building || []).join('; '),
      kind: c.score.neighbour ? c.score.neighbour.kind : null,
      options: q.map(x => ({ field: x.field, first: x.options[0] && x.options[0].value,
        values: x.options.map(o => o.value) })),
      // Every question the WHOLE schedule raises, not just this class's: the
      // failure a widened check introduces is a tax on the rows beside it.
      questions: r.counts.questions,
      walkCheck: r.walkCheck,
    };
  };
  // How far apart is every confusable pair, and can the graph even see both?
  const sep = [];
  for (const p of pairs) {
    const [x, y] = p.split('/');
    const r = (probe.has(x) && probe.has(y)) ? probe.route(x, y) : null;
    sep.push({ pair: p, both: probe.has(x) && probe.has(y),
      lo: r ? r.lo : null, metres: r ? r.metres : null });
  }
  // And the OTHER witness, over the same thirteen pairs: UT's own printed name.
  // Computed from data/ut_buildings.json through the shipping regex, so the
  // coverage claim in docs/img-confidence.md is a measurement and not a list
  // somebody typed.
  const si2 = await import(b + '/js/schedimg.js');
  const reg = await si2.buildingRegister();
  const venue = [];
  for (const p of pairs) {
    const [x, y] = p.split('/');
    const bad = (c) => {
      const n = reg.get(c);
      return n ? M.CONF.venue.unlikely.test(String(n).toUpperCase()) : null;
    };
    venue.push({ pair: p, x: bad(x), y: bad(y), xn: reg.get(x), yn: reg.get(y) });
  }
  return {
    loaded: true, asOf: probe.asOf, codes: probe.codes.length,
    misread: run('NEZ'), truth: run('MEZ'),
    weekMisread: run('NEZ', week), weekTruth: run('MEZ', week),
    loneMisread: run('NEZ', lone), loneTruth: run('MEZ', lone),
    // THE OVER-ASK CONTROL FOR THE WIDENED CHECK. PAI/PAT are 250 m apart and
    // this file's own §2c below reports the pair as unresolvable; widening the
    // walk read from the day to the WEEK must not quietly start resolving it.
    // s1 and s3 both put a real class in PAI 3.02, so if this fires it fires on
    // the corpus.
    weekPai: run('PAI', week),
    sep, venue,
    // The probe against a few known pairs, for the record.
    mezWel: probe.route('MEZ', 'WEL'), nezWel: probe.route('NEZ', 'WEL'),
    paiWel: probe.route('PAI', 'WEL'), patWel: probe.route('PAT', 'WEL'),
  };
}, [BASE, lex.silentPairs]);

ok(realGraph.loaded, 'js/walkgraph.js loads data/walk_graph.json in the real page',
  realGraph.loaded ? realGraph.codes + ' routable codes, baked ' + realGraph.asOf : 'DID NOT LOAD');
if (realGraph.loaded) {
  ok(realGraph.misread.walkCheck.active && realGraph.misread.walkCheck.neighbours,
    'and review() has the walking cross-check LIVE with no options passed to it',
    JSON.stringify(realGraph.misread.walkCheck));
  note('MEZ->WEL is ' + realGraph.mezWel.lo + ' min / ' + realGraph.mezWel.metres + ' m;  ' +
    'NEZ->WEL is ' + realGraph.nezWel.lo + ' min / ' + realGraph.nezWel.metres + ' m');
  // THE FAILURE THE PREVIOUS ROUND OF THIS FILE COULD NOT SEE.
  ok(realGraph.misread.ask,
    'MEZ 1.306 misread as NEZ is now ASKED ABOUT — the hole 2b names is closed here',
    'building ' + realGraph.misread.building.toFixed(2) + ' < ' + model.CONF.askBelow +
    '  "' + realGraph.misread.why + '"');
  const rbq = realGraph.misread.options.find(o => o.field === 'building');
  ok(rbq && rbq.values.indexOf('MEZ') >= 0 && rbq.first === 'NEZ',
    'with MEZ as a tap and the reading still leading — it asks, it does not rewrite',
    rbq ? JSON.stringify(rbq.values) : '(no building question)');
  ok(!realGraph.truth.ask,
    'and the same day with the TRUE MEZ in it is not asked about at all',
    'overall ' + realGraph.truth.overall.toFixed(2));

  /* ── THE ONE-CLASS DAY, which is where the check above used to go silent ──
     Every line down to the PAI control is the shape `misread` above could not
     see: `adjacentLegs()` skips every class not on the same day, and
     neighbourDoubt() then returned null on an empty list. A once-a-week
     discussion section, lab or seminar is one of the commonest schedule shapes
     there is, and it was committed at overall 1.00 with no question and no
     "why". `misread` and `truth` above are kept exactly as they were, as the
     CONTROL — a silent result here has to be distinguishable from a rig that
     has stopped doing anything. */
  ok(realGraph.weekMisread.ask && realGraph.weekMisread.kind === 'week-nearer',
    'ALONE ON FRIDAY with an ordinary week around it: the graph now reads the WEEK and asks',
    'building ' + realGraph.weekMisread.building.toFixed(2) + '  "' +
      realGraph.weekMisread.why + '"');
  const wbq = realGraph.weekMisread.options.find(o => o.field === 'building');
  ok(wbq && wbq.values.indexOf('MEZ') >= 0 && wbq.first === 'NEZ',
    '..with MEZ as a tap and the reading still leading, exactly as the same-day case does',
    wbq ? JSON.stringify(wbq.values) : '(no building question)');
  // THE HALF THAT COSTS A STUDENT SOMETHING. A check that asks about the
  // misread and also about the truth has not found anything; it has just
  // learned to ask.
  ok(!realGraph.weekTruth.ask && realGraph.weekTruth.questions === 0,
    '..and the SAME week with the TRUE MEZ in it asks nothing, about any row',
    'overall ' + realGraph.weekTruth.overall.toFixed(2) + ', ' +
      realGraph.weekTruth.questions + ' questions in the whole schedule');
  ok(realGraph.loneMisread.ask && realGraph.loneMisread.kind === 'lone',
    'THE ONLY CLASS IN THE SCHEDULE: nothing to compare it with, so the PAIR is the doubt',
    'building ' + realGraph.loneMisread.building.toFixed(2) + '  "' +
      realGraph.loneMisread.why + '"');
  const lbq = realGraph.loneMisread.options.find(o => o.field === 'building');
  ok(lbq && lbq.values.indexOf('MEZ') >= 0 && lbq.first === 'NEZ',
    '..and the buttons contain the fix, which is the whole test of whether a question is worth a tap',
    lbq ? JSON.stringify(lbq.values) : '(no building question)');
  // THE PRICE OF THE LAST ONE, ASSERTED RATHER THAN GLOSSED. With one class and
  // no second building anywhere, this app has no evidence in EITHER direction,
  // so the true reading is asked about too. That is one tap on a one-class
  // import, and it is the cost of the case above. Written down so that nobody
  // reads the passing line above as "it only ever asks when it is wrong".
  ok(realGraph.loneTruth.ask && realGraph.loneTruth.questions === 1,
    '..and it is SYMMETRIC: a lone TRUE MEZ costs exactly one tap, because nothing can tell them apart',
    'overall ' + realGraph.loneTruth.overall.toFixed(2) + ', ' +
      realGraph.loneTruth.questions + ' question');
  // THE OVER-ASK CONTROL. Widening the walk read from the day to the week must
  // not start resolving a pair the graph cannot separate — 250 m and 2 minutes
  // apart is inside the noise, and s1 and s3 both have a real PAI 3.02 class.
  note('PAI->WEL is ' + realGraph.paiWel.lo + ' min / ' + realGraph.paiWel.metres + ' m;  ' +
    'PAT->WEL is ' + realGraph.patWel.lo + ' min / ' + realGraph.patWel.metres + ' m');
  ok(!realGraph.weekPai.ask && realGraph.weekPai.questions === 0,
    'and PAI alone on Friday raises NOTHING: the week read cannot separate a 250 m pair either',
    'overall ' + realGraph.weekPai.overall.toFixed(2) + ' — the mean can move by at most ' +
      'the distance between the pair, which is why CONF.walk.weekGainMin is 3');

  // AND THE HONEST LIMIT, MEASURED PAIR BY PAIR RATHER THAN CLAIMED.
  const both = realGraph.sep.filter(s => s.both);
  const far = both.filter(s => s.lo != null && s.lo * 2 >= 5);
  note('of the ' + realGraph.sep.length + ' confusable pairs, ' + both.length +
    ' have BOTH members in the walk graph:');
  for (const s of realGraph.sep) {
    note('   ' + s.pair.padEnd(9) + (s.both
      ? (String(s.lo) + ' min / ' + s.metres + ' m apart' +
        (s.lo * 2 >= 5 ? '   <- the graph can separate these' : '   (too close to separate)'))
      : 'not both in the graph — the graph cannot see this pair'));
  }
  ok(far.length >= 2,
    'the graph can separate the pairs it is far enough apart to separate, and says which',
    far.map(s => s.pair).join(', ') + ' — the other ' + (realGraph.sep.length - far.length) +
    ' are the residual hole');

  // THE SECOND WITNESS, over the same thirteen pairs, computed from the
  // register rather than listed by hand.
  const byName = realGraph.venue.filter(v => (v.x && !v.y) || (v.y && !v.x));
  note('and UT\'s own printed names separate these:');
  for (const v of byName) {
    note('   ' + v.pair.padEnd(9) + (v.x ? v.xn : v.yn) + '  vs  ' + (v.x ? v.yn : v.xn));
  }
  const covered = new Set(far.map(s => s.pair).concat(byName.map(v => v.pair)));
  ok(covered.size >= 4,
    'between the graph and the register, this many of the 13 pairs raise a question',
    covered.size + ' of ' + realGraph.sep.length + ': ' + [...covered].sort().join(', '));
  note('THE RESIDUAL HOLE IS THE OTHER ' + (realGraph.sep.length - covered.size) + ': ' +
    realGraph.sep.map(s => s.pair).filter(p => !covered.has(p)).join(', '));
  // PAI/PAT NAMED ON ITS OWN, because it is the one that matters. Two real
  // teaching buildings 250 m apart, and the corpus's own s3 has a class in
  // PAI 3.02. Neither witness can see it.
  ok(!covered.has('PAI/PAT'),
    'PAI/PAT is honestly reported as STILL INVISIBLE rather than quietly counted as covered',
    'two real teaching buildings, 250 m apart — a room register would settle it and this repo has none');
}

/* ════════════════════════════════════════════════════════════════════════════
   2d. THE PROBE AGREES WITH THE APP'S OWN ROUTER

   `js/walkgraph.js` is a SECOND reader of `data/walk_graph.json`. A second
   reader that disagrees with the first is worse than no reader: the confirm
   screen would be telling a student a walk is impossible while the app's own
   route card, on the same two buildings, prints a time that fits.

   So this drives the real `window.wayfindRoute` — the async, UI-driving one
   this probe exists to avoid — on real pairs and compares. It is checked, not
   claimed. The probe is expected to come in at or BELOW the router (it drops
   the router's door-role handicap, which can only make a route shorter), and
   the gap is printed rather than hidden inside a tolerance.
   ════════════════════════════════════════════════════════════════════════════ */
head('2d. the probe vs the app\'s own router, on the same graph');
const cross = await page.evaluate(async ([b, pairs]) => {
  if (typeof window.wayfindRoute !== 'function') return { ran: false };
  const wg = await import(b + '/js/walkgraph.js');
  const probe = await wg.walkProbe();
  const rows = [];
  for (const p of pairs) {
    const mine = probe.route(p[0], p[1]);
    let theirs = null;
    try { theirs = await window.wayfindRoute(p[0], p[1], { fit: false }); } catch (e) {}
    rows.push({
      pair: p.join(' -> '),
      mineLo: mine ? mine.lo : null, mineM: mine ? mine.metres : null,
      theirLo: theirs && theirs.ok ? theirs.lo : null,
      theirM: theirs && theirs.ok ? Math.round(theirs.distM) : null,
    });
  }
  return { ran: true, rows };
}, [BASE, [['MEZ', 'WEL'], ['NEZ', 'WEL'], ['GDC', 'RLP'], ['PAI', 'BUR'],
  ['JES', 'CMA'], ['MEZ', 'NEZ'], ['WEL', 'GDC'], ['TSC', 'TSG']]]);
if (!cross.ran) {
  note('window.wayfindRoute is not on this page — cross-check skipped, not failed');
} else {
  let compared = 0, over = 0, worst = 0;
  for (const r of cross.rows) {
    if (r.mineLo == null || r.theirLo == null) { note('   ' + r.pair + '  (one end not routable both ways)'); continue; }
    compared++;
    const d = r.mineLo - r.theirLo;
    if (d > 0) over++;
    worst = Math.max(worst, Math.abs(d));
    note('   ' + r.pair.padEnd(14) + 'probe ' + String(r.mineLo).padStart(2) + ' min / ' +
      String(r.mineM).padStart(4) + ' m     router ' + String(r.theirLo).padStart(2) +
      ' min / ' + String(r.theirM).padStart(4) + ' m     diff ' + (d >= 0 ? '+' : '') + d);
  }
  ok(compared >= 5, 'the two were compared on real pairs, not asserted equal',
    compared + ' pairs');
  ok(over === 0,
    'the probe never says a walk is LONGER than the app\'s own route card does',
    over + ' pairs over, worst gap ' + worst + ' min');
}

/* ════════════════════════════════════════════════════════════════════════════
   2e. THE ANSWER KEY IS A POPULATION OF PERFECT READINGS. ASK IT NOTHING.

   THIS IS THE SECTION THAT CAUGHT A REAL DEFECT, so it is worth saying what it
   is for. `confirm-line.mjs` measures the cost of the line by running OCR over
   fifteen images and takes twenty minutes. This runs the benchmark's own
   `truth.json` — 49 meetings that are correct BY DEFINITION — straight through
   the model with every cross-check live, in about a second. Every question it
   asks is a FALSE question, with no OCR anywhere to argue about.

   The first time it ran, with the campus graph switched on for the first time,
   it asked about TWELVE of the forty-nine, all the same shape: a class printed
   back-to-back with the next one in another building. A printed timetable is
   written in blocks and that is what a real one looks like — the walking check
   was calling four real schedules impossible. `CONF.time.tooTight` moved from
   0.55 to 0.85 because of this number and nothing else.
   ════════════════════════════════════════════════════════════════════════════ */
head('2e. the benchmark answer key, straight through the model: expect no questions');
const key = JSON.parse(fs.readFileSync(path.join(CORPUS, 'truth.json'), 'utf8'));
const bySched = new Map();
for (const img of key.images) {
  const k = img.schedule || img.image;
  if (!bySched.has(k)) bySched.set(k, img.classes);
}
const truthRun = await page.evaluate(async (sets) => {
  const M = window.__cfm;
  const ctx = await M.prepare();
  const out = [];
  for (const [sid, cls] of sets) {
    const classes = cls.map(c => ({
      course: c.course, building: c.building, room: c.room, day: c.day, days: [c.day],
      start: c.start, end: c.end,
      ev: {
        boxes: {}, conf: { building: 92, room: 92, day: 92, time: 92 },
        from: { day: 'column', time: 'axis', room: 'read', building: 'lexicon' },
        flags: { knownCode: true, axisAgrees: true, edge: {}, source: 'screenshot' },
        candidates: { building: [c.building] },
      },
    }));
    const rev = M.review({ classes, unsure: [] }, ctx);
    out.push({
      sid, n: classes.length,
      asked: rev.classes.filter(c => c.ask).map(c => ({
        at: c.day + ' ' + c.start + ' ' + c.building + ' ' + c.room,
        why: ['building', 'room', 'day', 'time']
          .map(f => (c.score.notes[f] || []).join('; ')).filter(Boolean).join(' / '),
      })),
      live: rev.walkCheck,
    });
  }
  return out;
}, [...bySched.entries()].map(([k, v]) => [k, v]));
const keyTotal = truthRun.reduce((a, r) => a + r.n, 0);
const keyAsked = truthRun.reduce((a, r) => a + r.asked.length, 0);
note('cross-checks live for this run: ' + JSON.stringify(truthRun[0] && truthRun[0].live));
for (const r of truthRun) {
  note('   ' + r.sid + '  ' + r.n + ' meetings, ' + r.asked.length + ' asked');
  for (const a of r.asked) note('        ' + a.at + '   ' + a.why);
}
ok(keyAsked === 0,
  'not one of the answer key\'s own meetings raises a question',
  keyAsked + ' of ' + keyTotal + ' asked' +
  (keyAsked ? '  <- every one is a tap a student pays for nothing' : ''));

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
await page.evaluate(async () => {
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
  // prepare(), NOT a bare review(): the screen a student sees has the walking
  // graph and the confusable-neighbour check behind it, so the frames this
  // section commits have to be of that screen and not of a reduced one.
  const ctx = await window.__cf.prepare({
    buildingName: (c) => ({ GDC: 'Gates Dell Complex' }[c] || null),
  });
  window.__ctx = ctx;
  window.__rev = window.__cf.review(out, ctx);
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

/* ── 5b. THE PICTURE OF THE THING THIS ROUND WAS FOR ────────────────────────

   CLAUDE.md rule 3: lead with the picture when the change is visual. But the
   FIRST version of this section was a lie you could see, and it is worth
   writing down because nothing but looking at the frame would have caught it.
   It seeded a synthetic NEZ class onto image 01's evidence — and image 01 has
   no MEZ on it, so the panel asked "Is this building NEZ?" over a crop of the
   student's picture with `RLP 0.106` ringed in the accent colour. The app was
   pointing at the wrong line while asking about a different one, which is the
   exact failure the crop exists to prevent.

   So this uses a picture that genuinely contains the class. Corpus image 03 is
   schedule s3 on a phone card stack and it really carries `MEZ 1.306`
   (HIS 315K) — the same real class docs/img-confidence.md has been citing
   since round one. It is read for real, and then ONE STROKE of the answer is
   changed to make the misread this round exists to catch. The crop beside the
   question is that row's own pixels, so a reader can see the picture say MEZ
   while the reading says NEZ. */
head('5b. the question the confusable-pair check asks, over the row it is about');
const img03 = path.join(CORPUS, '03-ut-cards-phone-clean.jpg');
const url03 = 'data:image/jpeg;base64,' + fs.readFileSync(img03).toString('base64');
const nezShown = await page.evaluate(async ([u]) => {
  const si = window.__si || await import(new URL('./js/schedimg.js', location.href).href);
  const out = await si.extract(u, { keepSheet: true });
  // The REAL MEZ reading off the REAL picture, with its real box.
  const mezRows = out.classes.filter(c => c.building === 'MEZ');
  const mez = mezRows[0];
  if (!mez) return { found: false, saw: out.classes.map(c => c.building) };
  const before = mez.building + ' ' + mez.room;
  // ONE STROKE, on EVERY meeting of that reading. A Mon/Wed course is two rows
  // off one line of the picture and js/schedimg.js hands both the same evidence
  // object; changing one of them would be a misread no engine could make.
  // Everything else — the box, the confidences, the days, the hours, the
  // picture behind it — is untouched.
  for (const c of mezRows) {
    c.building = 'NEZ';
    if (c.ev && c.ev.candidates) c.ev.candidates.building = ['NEZ'];
    if (c.ev && c.ev.flags) c.ev.flags.rawCode = 'NEZ';
  }
  const rev = window.__cf.review(out, window.__ctx);
  // TAKE THE FIRST PANEL OUT OF THE DOM WITHOUT CALLING destroy(). destroy()
  // empties the schedule photograph's canvas — that is its job, and section 7
  // is the assertion that it does.
  const old = document.getElementById('wf-cfm');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  window.__host2 = document.createElement('div');
  document.body.appendChild(window.__host2);
  window.__ui2 = window.__cf.mount(window.__host2, rev, {});
  const i = rev.questions.findIndex(q => q.field === 'building' && q.current === 'NEZ');
  if (i >= 0) { window.__ui2.state.step = i; window.__ui2.render(); }
  const r = document.getElementById('wf-cfm');
  const cv = r.querySelector('.cfm-crop canvas');
  const b = cv ? cv.getBoundingClientRect() : null;
  return {
    found: true, before, day: mezRows.map(c => c.day).join('+'),
    hours: mez.start + '-' + mez.end,
    classes: out.classes.length, asked: rev.counts.asked,
    // One reading, both meetings: the question is asked once and the answer
    // lands on both, which section 6 asserts in general.
    meetings: mezRows.length,
    ask: (r.querySelector('.cfm-ask') || {}).textContent || '',
    why: (r.querySelector('.cfm-why') || {}).textContent || '',
    opts: [...r.querySelectorAll('.cfm-opt-v')].map(x => x.textContent),
    crop: b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null,
  };
}, [url03]);
ok(nezShown.found,
  'image 03 really carries the MEZ class the doc has been citing since round one',
  nezShown.found ? nezShown.before + ', ' + nezShown.day + ' ' + nezShown.hours +
    ' (' + nezShown.meetings + ' meetings), among ' + nezShown.classes +
    ' classes read off that picture'
    : 'buildings read: ' + JSON.stringify(nezShown.saw));
if (nezShown.found) {
  note('on screen: "' + nezShown.ask + '"  ->  ' + nezShown.opts.join(' / '));
  note('and under it: "' + nezShown.why + '"');
  ok(/NEZ/.test(nezShown.ask) && nezShown.opts.indexOf('MEZ') >= 0,
    'one stroke changed on a real reading, and the phone asks about it with MEZ as a tap',
    JSON.stringify(nezShown.opts));
  await page.screenshot({ path: path.join(SHOTS, '_throwaway.png') });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, 'confirm-neighbour-phone.jpg'),
    type: 'jpeg', quality: 80 });
  // AND THE CROP IS THAT ROW'S OWN PIXELS. Asserted on the frame, because
  // "a canvas is present" is exactly what was true of the frame that was wrong.
  let nezSpread = 0;
  if (nezShown.crop) {
    const buf = await page.screenshot({ clip: nezShown.crop });
    nezSpread = lumaSpread(decodePNG(buf));
  }
  ok(nezSpread > 12,
    'and the crop beside it is real pixels of the row the question is about',
    'luma spread ' + nezSpread.toFixed(1));
}
// Same reason as above: unmount, never destroy. Section 7 owns destroy().
await page.evaluate(() => {
  const r = document.getElementById('wf-cfm');
  if (r && r.parentNode) r.parentNode.removeChild(r);
  if (window.__host) document.body.appendChild(window.__ui.root);
});

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
    // THE EVIDENCE BUNDLE IS THE ONE js/schedimg.js ACTUALLY EMITS. It used to
    // be `conf: {}, from: {}` here, which is a shape evidenceFor() cannot
    // produce — and an empty bundle scores every field at CONF.noWords (0.5),
    // so the fixture was quietly asserting that a perfectly legible row is
    // half-doubted. That only became visible once recover rows started being
    // scored at all; before this round nothing scored them, which was the bug.
    unsure: [{
      course: 'C S 429', building: 'CRE', room: '2.216', day: 'Tue', days: ['Tue', 'Thu'],
      start: '14:00', end: '15:30', reason: 'not-a-code',
      why: '"CRE" does not read like a UT building code',
      ev: { boxes: { all: { x0: 60, y0: 296, x1: 700, y1: 334 } },
        conf: { building: 88, room: 91, day: 90, time: 92 },
        from: { day: 'column', time: 'axis', room: 'read', building: 'unrepaired' },
        flags: { knownCode: false, rawCode: 'CRE', axisAgrees: true, edge: {},
          source: 'screenshot' },
        candidates: { building: ['CPE', 'GRE'] } },
    }],
    seen: { onlySeen: 0 },
  });
  const before = M.apply(rev).classes.length;
  rev.recover[0].answer = 'CPE';
  const after = M.apply(rev).classes;
  return { n: rev.recover.length, options: rev.recover[0] ? rev.recover[0].options.map(o => o.value) : [],
    doubt: rev.recover[0] ? rev.recover[0].doubt : null,
    before, after: after.length, days: after.map(c => c.day),
    confirmed: after.every(c => c.confirmed) };
});
ok(rec.n === 1 && rec.options.join(',') === 'CPE,GRE',
  'a class REFUSED for an ambiguous code comes back as a choice of the two real ones',
  rec.options.join(' or '));
ok(rec.before === 0 && rec.after === 2 && rec.confirmed,
  'and nothing enters the schedule from it without a tap',
  rec.before + ' before the tap -> ' + rec.after + ' after, on ' + rec.days.join('+'));
ok(Array.isArray(rec.doubt) && rec.doubt.length === 0,
  'a recover row whose only problem WAS the code has nothing left in doubt, so the tap really does settle it',
  'leftover doubts: ' + JSON.stringify(rec.doubt));

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

/* ════════════════════════════════════════════════════════════════════════════
   8. THE INVARIANT: NOTHING IS `confirmed` WHILE A DOUBT IS STILL OPEN

   THIS SECTION EXISTS BECAUSE THE PROMISE AT THE TOP OF js/schedconfirm.js WAS
   FALSE IN TWO PLACES, and both were found by executing the module rather than
   by reading it.

     1. THE CAP. `maxQuestionsPerClass` is 2; a reading can have four doubtful
        fields. applyGroup()'s old safety net counted only the questions that
        had been BUILT, so a reading with building 0.30 / room 0.45 / time 0.19
        produced two questions and, once both were answered, a class tagged
        `confirmed: true` carrying `room: "2.2%"` — a value the file's own
        grammar check had flagged as containing characters a UT room number
        cannot contain. `g.tooManyDoubts` was computed and never read again.

     2. THE RECOVER LANE, which put a false sentence in the record: a cut-off
        `WEL 2.22` — the reader's own words are "part of it is missing" — was
        shown as a ONE-OPTION question about the building and then written as
        `confirmed: true, why: "confirmed by you from the picture"`.

   So the assertions below are about the OUTPUT OF apply(), field by field,
   across a matrix of 1..4 doubtful fields. A future edit that reintroduces
   either hole fails here.
   ════════════════════════════════════════════════════════════════════════════ */
head('8. nothing is confirmed while a doubt is still open');

const inv = await page.evaluate(() => {
  const M = window.__cf;
  const A = M.CONF.askBelow;
  const base = () => ({
    course: 'M 340L', building: 'RLP', room: '0.106', day: 'Tue', days: ['Tue'],
    start: '09:30', end: '11:00',
    ev: {
      boxes: { all: { x0: 0, y0: 8, x1: 300, y1: 28 } },
      conf: { building: 92, room: 92, day: 92, time: 92 },
      from: { day: 'column', time: 'axis', room: 'read', building: 'lexicon' },
      flags: { knownCode: true, axisAgrees: true, edge: {}, source: 'screenshot' },
      candidates: { building: ['RLP'] },
    },
  });
  // Each spoil makes exactly ONE field fall under the line, using the same
  // defects the corpus actually produces.
  const spoil = {
    building: (c) => { c.building = 'MZQ'; c.ev.flags.knownCode = false;
      c.ev.flags.rawCode = 'MZQ'; c.ev.from.building = 'unrepaired';
      c.ev.candidates.building = []; },
    room: (c) => { c.room = '2.2%'; },
    time: (c) => { c.start = '09:07'; c.end = '10:55'; },
    day: (c) => { c.day = 'Tue'; c.ev.from.day = 'letters'; c.ev.conf.day = 27; },
  };
  const run = (which, opts) => {
    const c = base();
    for (const f of which) spoil[f](c);
    const rev = M.review({ classes: [c], unsure: [] }, opts || {});
    const g = rev.groups[0];
    for (const q of rev.questions) q.answer = q.options[0].value;
    const res = M.apply(rev);
    // The scores AFTER the answers: a field the student answered is settled by
    // definition, so only the unanswered ones are checked against the line.
    const answered = new Set(rev.questions.map(q => q.field));
    const stillLow = ['building', 'room', 'time', 'day']
      .filter(f => !answered.has(f) && g.score.fields[f] < A);
    return {
      which, doubt: g.doubt, nq: rev.questions.length,
      retake: !!g.retake, kept: res.classes.length,
      confirmed: res.classes.map(x => !!x.confirmed),
      needsConfirm: res.classes.map(x => !!x.needsConfirm),
      unconfirmedFields: res.classes.map(x => x.unconfirmedFields || []),
      why: (res.classes[0] || res.dropped[0] || {}).why || null,
      stillLow, rev, g,
    };
  };
  const cases = [['building'], ['room'], ['time'], ['building', 'room'],
    ['building', 'room', 'time'], ['building', 'room', 'time', 'day']];
  const rows = cases.map(w => { const r = run(w); delete r.rev; delete r.g; return r; });

  // The same three-doubt reading, KEPT ANYWAY by the student.
  const c3 = base(); for (const f of ['building', 'room', 'time']) spoil[f](c3);
  const rev3 = M.review({ classes: [c3], unsure: [] }, {});
  rev3.groups[0].keepAnyway = true;
  const kept3 = M.apply(rev3).classes.map(x => ({ confirmed: !!x.confirmed,
    needsConfirm: !!x.needsConfirm, unconfirmedFields: x.unconfirmedFields || [],
    room: x.room, why: x.why }));

  // And with CONF.ask.overCap flipped to 'ask': all three get asked, and
  // answering all three legitimately DOES confirm.
  const was = M.CONF.ask.overCap;
  M.CONF.ask.overCap = 'ask';
  const askAll = run(['building', 'room', 'time']);
  M.CONF.ask.overCap = was;
  delete askAll.rev; delete askAll.g;

  // The cut-off recover row: one option is not a choice.
  const cut = {
    course: 'C S 429', building: 'WEL', room: '2.22', day: 'Tue', days: ['Tue'],
    start: '09:30', end: '11:00', reason: 'cut-off',
    why: 'this one runs off the edge of the picture, so part of it is missing',
    ev: { boxes: { all: { x0: 0, y0: 8, x1: 300, y1: 28 } },
      conf: { building: 92, room: 92, day: 92, time: 92 },
      from: { day: 'column', time: 'axis', room: 'read', building: 'unrepaired' },
      flags: { knownCode: false, edge: { room: true }, source: 'screenshot' },
      candidates: { building: ['WEL'] } },
  };
  const revC = M.review({ classes: [], unsure: [cut] }, {});
  const cutOut = M.apply(revC).classes;

  return { rows, kept3, askAll, overCapDefault: M.CONF.ask.overCap,
    cut: { recover: revC.recover.length, retake: revC.retake.length,
      wrote: cutOut.length,
      why: (revC.retake[0] || {}).retakeWhy || null } };
});

for (const r of inv.rows) {
  note(r.which.join('+') + ' doubted -> ' + r.nq + ' question(s), ' +
    (r.retake ? 're-take' : 'kept ' + r.kept) +
    ', confirmed ' + JSON.stringify(r.confirmed));
}
ok(inv.rows.every(r => r.confirmed.every((c, i) =>
  !c || r.unconfirmedFields[i].length === 0)),
'across 1, 2, 3 and 4 doubtful fields, nothing comes out confirmed with a field still in doubt');
ok(inv.rows.every(r => r.stillLow.length === 0 || r.confirmed.every(c => !c)),
  'and no class the model still scores under the line is called confirmed',
  'cases with an unanswered field under the line: ' +
    inv.rows.filter(r => r.stillLow.length).map(r => r.which.join('+')).join(', ') || 'none');

const three = inv.rows.find(r => r.which.length === 3);
ok(three && three.nq === 0 && three.retake && three.kept === 0,
  'the critic\'s case: three doubts asks NOTHING and saves NOTHING by default',
  three ? three.nq + ' questions, kept ' + three.kept : 'missing');
ok(three && /MZQ/.test(three.why) && /2\.2%/.test(three.why) && /9:07/.test(three.why),
  'and the reason names all three defects rather than just the two it would have asked about',
  three ? '"' + String(three.why).slice(0, 120) + '"' : 'missing');

ok(inv.kept3.length === 1 && inv.kept3[0].confirmed === false &&
   inv.kept3[0].needsConfirm === true &&
   inv.kept3[0].unconfirmedFields.length === 3,
'kept anyway, it is saved as UNCHECKED with all three fields named — never as confirmed',
  JSON.stringify(inv.kept3[0] && inv.kept3[0].unconfirmedFields));
ok(inv.kept3.length === 1 && inv.kept3[0].room === '2.2%' &&
   /not asked|nobody checked/.test(String(inv.kept3[0].why)),
'and the value the student never saw is still shown to be unchecked, not laundered',
  '"' + String(inv.kept3[0] && inv.kept3[0].why).slice(0, 90) + '"');

ok(inv.askAll.nq === 3 && inv.askAll.confirmed.every(c => c),
  'CONF.ask.overCap = "ask" is the one-line overrule: all three asked, and answering all three DOES confirm',
  inv.askAll.nq + ' questions -> confirmed ' + JSON.stringify(inv.askAll.confirmed));
ok(inv.overCapDefault === 'retake', 'and the shipping default is back to "retake" after the test');

ok(inv.cut.recover === 0 && inv.cut.retake === 1 && inv.cut.wrote === 0,
  'a cut-off row is not a one-button "recovery": it is a re-take, and it writes nothing',
  'recover ' + inv.cut.recover + ', retake ' + inv.cut.retake +
    ', classes written ' + inv.cut.wrote);

/* ── and the SCREEN says so, on the phone, in pixels ───────────────────────── */
const rtUi = await page.evaluate(() => {
  const M = window.__cf;
  const c = {
    course: 'M 340L', building: 'MZQ', room: '2.2%', day: 'Tue', days: ['Tue'],
    start: '09:07', end: '10:55',
    ev: { boxes: { all: { x0: 0, y0: 8, x1: 300, y1: 28 } },
      conf: { building: 92, room: 92, day: 92, time: 92 },
      from: { day: 'column', time: 'axis', room: 'read', building: 'unrepaired' },
      flags: { knownCode: false, rawCode: 'MZQ', axisAgrees: true, edge: {},
        source: 'screenshot' },
      candidates: { building: [] } },
  };
  const good = {
    course: 'C S 429', building: 'GDC', room: '2.216', day: 'Wed', days: ['Wed'],
    start: '11:00', end: '12:00',
    ev: { boxes: { all: { x0: 0, y0: 40, x1: 300, y1: 60 } },
      conf: { building: 94, room: 94, day: 94, time: 94 },
      from: { day: 'column', time: 'axis', room: 'read', building: 'lexicon' },
      flags: { knownCode: true, axisAgrees: true, edge: {}, source: 'screenshot' },
      candidates: { building: ['GDC'] } },
  };
  const rev = M.review({ classes: [good, c], unsure: [] }, {});
  const host = document.createElement('div');
  host.id = 'rt-host';
  document.body.appendChild(host);
  const ui = M.mount(host, rev, {});
  ui.state.step = 999; ui.render();
  window.__rtUi = ui;
  const root = document.getElementById('wf-cfm');
  const btn = root.querySelector('.cfm-rt-keep');
  const b = btn ? btn.getBoundingClientRect() : null;
  const rb = root.getBoundingClientRect();
  return {
    text: root.textContent,
    heading: (root.querySelector('.cfm-retake-h') || {}).textContent || '',
    why: (root.querySelector('.cfm-rt-why') || {}).textContent || '',
    ready: (root.querySelector('.cfm-note') || {}).textContent || '',
    btnH: b ? Math.round(b.height) : 0,
    btnIn: !!b && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 &&
      b.right <= innerWidth,
    panelBottom: Math.round(rb.y + rb.height), vh: innerHeight,
    sideways: document.documentElement.scrollWidth > innerWidth,
  };
});
note('the summary heading reads: "' + rtUi.heading + '"');
note('and under the row: "' + rtUi.why.slice(0, 120) + '"');
ok(/to check yourself/i.test(rtUi.heading),
  'the summary really does say so — the re-take list has its own heading',
  '"' + rtUi.heading + '"');
ok(/^1 class ready\.$/.test(rtUi.ready.trim()),
  'and the unreadable row is NOT in the ready count',
  '"' + rtUi.ready.trim() + '"');
ok(/MZQ/.test(rtUi.why) || /2\.2%/.test(rtUi.why) || /9:07/.test(rtUi.why),
  'the reason printed is the app\'s own, in plain words, not a bare warning');
ok(rtUi.btnH >= 44 && rtUi.btnIn,
  'the "use it anyway" button is a real thumb target inside a 390x844 screen',
  rtUi.btnH + ' px tall, on screen: ' + rtUi.btnIn);
ok(!rtUi.sideways && rtUi.panelBottom <= rtUi.vh,
  'and the panel with it on still fits the phone',
  'bottom ' + rtUi.panelBottom + ' of ' + rtUi.vh);

await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SHOTS, '_throwaway.png') });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SHOTS, 'confirm-retake-phone.jpg'),
  type: 'jpeg', quality: 80 });
await page.evaluate(() => {
  try { window.__rtUi.destroy(); } catch (e) {}
  const h = document.getElementById('rt-host');
  if (h && h.parentNode) h.parentNode.removeChild(h);
});

/* ════════════════════════════════════════════════════════════════════════════
   9. THE SEAM IS ONE CALL, AND IT RUNS

   The honest weakness of round one was that none of this was reachable from the
   app: `impFromFile` in js/wayfind.js knows nothing about any of it, and that
   file belongs to another lane. That is STILL true — this branch has zero lines
   of diff against it. What changed is the size of what the other lane has to
   write, and an integration point nobody has ever executed is a promise rather
   than a seam. So this executes it: one call, a real corpus image, the real
   page, and the screen on screen at the end of it.
   ════════════════════════════════════════════════════════════════════════════ */
head('9. confirmFromFile(file, host) — the whole integration, run once');
const img13 = path.join(CORPUS, '13-ut-table-crop-bottom.jpg');
const url13 = 'data:image/jpeg;base64,' + fs.readFileSync(img13).toString('base64');
const seam = await page.evaluate(async ([u]) => {
  // A File, exactly as an <input type=file> hands one over — not a data URL,
  // because "it works on a string" is not the thing being claimed.
  const blob = await (await fetch(u)).blob();
  const file = new File([blob], 'schedule.jpg', { type: 'image/jpeg' });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const t0 = performance.now();
  let resolved = null;
  const p = window.__cf.confirmFromFile(file, host).then(r => { resolved = r; return r; });
  // Give it the OCR, then look at what is actually on the screen.
  await new Promise(r => setTimeout(r, 200));
  const waitFor = async () => {
    for (let i = 0; i < 600; i++) {
      if (document.getElementById('wf-cfm')) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };
  const up = await waitFor();
  const r = document.getElementById('wf-cfm');
  const shot = {
    mounted: up, ms: Math.round(performance.now() - t0),
    title: r ? (r.querySelector('.cfm-title') || {}).textContent : null,
    settledEarly: resolved !== null,
  };
  // Close it the way a student would, and see what the promise gives back.
  const x = r && r.querySelector('.cfm-x, .cfm-go');
  if (x) x.click();
  const out = await p;
  return Object.assign(shot, {
    resolvedTo: out && Array.isArray(out.classes) ? out.classes.length : null,
    stillInDom: !!document.getElementById('wf-cfm'),
  });
}, [url13]);
ok(seam.mounted, 'one call took a File and put the confirm screen on the real page',
  seam.mounted ? 'mounted in ' + seam.ms + ' ms, header reads "' + seam.title + '"'
    : 'never mounted');
ok(!seam.settledEarly,
  'and did not resolve before the student had touched it',
  'the promise waits for the screen, which is the whole point of it');
ok(seam.resolvedTo !== null && !seam.stillInDom,
  'closing it resolves the same call and takes the panel away',
  'resolved to ' + seam.resolvedTo + ' classes, panel gone');
// ZERO IS THE RIGHT ANSWER HERE AND NOT A FAILURE. The close cross is the
// student walking away, and walking away gives back nothing rather than a
// half-confirmed schedule. "Use these" is the other exit and section 6 is where
// what it returns is asserted.
note('closed with the cross, so 0 classes is the contract: walking away saves nothing');

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
