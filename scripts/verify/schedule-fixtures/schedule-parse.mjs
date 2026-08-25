/**
 * schedule-parse.mjs — the gate for the class-schedule importer.
 *
 * WHAT IT ASSERTS, and why each assertion is here rather than a print:
 *
 *   1. Three real formats parse. The Google, Apple and UT Registration Plus
 *      fixtures in this directory are byte-for-byte imitations of what those
 *      three actually emit (CRLF, folded lines, VTIMEZONE, X-APPLE-*), taken
 *      from docs/import-bar-apple.md and docs/import-bar-ut.md. Every event in
 *      them must resolve to a building code.
 *   2. Every clean event reaches a ROUTE. Not "is marked routable" — routed,
 *      through the same computeRoute() the card uses. `entry.routable` is a
 *      liar: HLB reports false and routes anyway (see js/wayfind.js §14).
 *   3. Every bad event fails with a NAMED reason. messy.ics carries one of each
 *      failure a real student will hit, and the expectation table below names
 *      the problem code AND a phrase that must appear in the sentence the
 *      student reads. A parser that fails everything passes assertion 3 and
 *      dies on assertion 1, and vice versa — the pair is the gate.
 *   4. Partial failure behaves like Google Calendar's own import: one bad row
 *      never kills the file. messy.ics has EIGHT broken events and its one good
 *      one must still come through, with an "Imported 1 of 9" summary line.
 *   5. EVERY FIXTURE IS GRADED THROUGH THE UNQUALIFIED CALL —
 *      `wayfindParseSchedule(text)` with no `kind` — because that is the call
 *      the docs describe and the one an interface will make.
 *
 *      THIS ASSERTION EXISTS BECAUSE ITS ABSENCE HID A REAL BUG. The table
 *      below used to hand each fixture a `kind`, and `not-a-calendar.ics` was
 *      handed `'ics'`. So the fixture built to model the likeliest bad file a
 *      student uploads was the one fixture that never took the path a real
 *      upload takes: unqualified, the two-way sniff sent a saved sign-in page
 *      to the ROW parser, which reported nine errors — one per line of markup,
 *      each claiming the line "names a course but no building". 209 assertions
 *      were green over it. A gate that only calls the code the way that makes
 *      it pass is not a gate. `maxProblems` below is the specific guard: a
 *      file that is not a calendar must produce ONE problem, not one per line.
 *      The explicit `kind` override is still asserted, in its own section,
 *      where it cannot stand in for the default path.
 *
 * Run:
 *   python scripts/serve.py 8911
 *   VERIFY_URL=http://127.0.0.1:8911 node scripts/verify/schedule-fixtures/schedule-parse.mjs
 *
 * `--dump` prints the parsed shape instead of asserting, which is how the
 * expectation table below was built in the first place.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from '../chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUMP = process.argv.includes('--dump');
const SHOT_DIR = process.env.SHOT_DIR || path.join(HERE, '..', '..', '..', 'shots', 'si', 'parser');
const URL = `${BASE}/index.html?walk=1&drift=0&intro=0`;
const FIXTURE_URL = `${BASE}/scripts/verify/schedule-fixtures`;

// ══════════════════════════════════════════════════════════════════════════
// The expectation table. Every entry is graded through `wayfindParseSchedule
// (text)` with NO options — the sniff has to get it right on its own.
//
//   sniff       what `source.sniffed` must say the text looked like
//   kind        what `source.kind` must end up as
//   maxProblems a CEILING on the problem list, which is how "one wrong file
//               produces one error, not one error per line" is asserted
//   code/says   the machine-readable problem code, and a phrase that must
//               appear in the sentence a student actually reads, because a
//               problem code nobody can act on is not an error report
// ══════════════════════════════════════════════════════════════════════════
const EXPECT = {
  'google-clean.ics': {
    sniff: 'ics', kind: 'ics', total: 4, ok: 4, errors: 0,
    events: [
      { code: 'GDC', room: '2.216', days: ['MO', 'WE'], startMin: 600, endMin: 660, lastDate: '2026-12-07' },
      { code: 'WEL', room: '2.224', days: ['MO', 'WE', 'FR'], startMin: 660, endMin: 720 },
      { code: 'RLP', room: '0.106', days: ['TU', 'TH'], startMin: 570, endMin: 660 },
      { code: 'PAI', room: '3.02', days: ['TU', 'TH'], startMin: 750, endMin: 840 },
    ],
  },
  'apple-clean.ics': {
    sniff: 'ics', kind: 'ics', total: 4, ok: 4, errors: 0,
    events: [
      { code: 'ART', room: '1.102', days: ['TU', 'TH'], startMin: 930 },
      // The folded, escaped, three-line address with the code in parentheses.
      { code: 'WEL', days: ['MO', 'WE', 'FR'], startMin: 540 },
      { code: 'JES', room: 'A121A', days: ['MO', 'WE'], startMin: 780 },
      { code: 'GRE', room: '2.200', days: ['FR'], startMin: 660 },
    ],
  },
  'ut-regplus.ics': {
    sniff: 'ics', kind: 'ics', total: 4, ok: 4, errors: 0,
    events: [
      { code: 'UTC', room: '3.102', days: ['MO', 'TU', 'WE', 'TH'], startMin: 960, exDates: 3 },
      { code: 'CMA', room: '6.146', days: ['TU', 'TH'], startMin: 660, exDates: 1 },
      { code: 'DMC', room: '3.208', days: ['TU', 'TH'], startMin: 840 },
      { code: 'GSB', room: '2.122', days: ['MO', 'WE'], startMin: 570 },
    ],
  },
  'messy.ics': {
    sniff: 'ics', kind: 'ics', total: 9, ok: 1, minErrors: 8,
    summaryHas: 'Imported 1 of 9',
    fileProblems: [{ code: 'FILE_TRUNCATED', says: 'stops in the middle' }],
    events: [
      { code: 'BUR', room: '220', status: 'ok' },
      { status: 'failed', problem: 'BUILDING_UNKNOWN', says: 'MAI' },
      { status: 'failed', problem: 'LOCATION_MISSING', says: 'no location' },
      { status: 'failed', problem: 'DATE_MALFORMED', says: '2026O826T140000' },
      { status: 'failed', problem: 'BUILDING_IS_ADDRESS', says: 'street address' },
      { status: 'failed', problem: 'BUILDING_OFF_MAP', says: 'Pickle' },
      { status: 'failed', problem: 'BUILDING_NOT_WALKABLE', says: 'SSW' },
      { status: 'failed', problem: 'LOCATION_MISSING', says: 'no location' },
      { status: 'failed', problem: 'EVENT_TRUNCATED', says: 'cut off' },
    ],
  },
  // THE FIXTURE THE OLD GATE COULD NOT SEE. A saved UT EID sign-in page,
  // uploaded because the export link bounced through a login wall. Sniffed
  // unqualified it must be recognised as a web page and refused ONCE — the
  // regression this whole round is about is `maxProblems`, which was 9.
  'not-a-calendar.ics': {
    sniff: 'markup', kind: 'unknown', total: 0, ok: 0, minErrors: 1, maxProblems: 1,
    fileProblems: [
      { code: 'FILE_NOT_CALENDAR', says: 'not a calendar' },
      { code: 'FILE_NOT_CALENDAR', says: 'sign-in page' },
    ],
  },
  // The same wrong file WITHOUT a doctype or an <html> root — a panel copied
  // out of a course site. Only the tag-density half of the sniff can catch
  // this one, so it is here to keep that half honest.
  'saved-page.ics': {
    sniff: 'markup', kind: 'unknown', total: 0, ok: 0, minErrors: 1, maxProblems: 1,
    fileProblems: [{ code: 'FILE_NOT_CALENDAR', says: 'not a calendar' }],
  },
  // Not markup, not a calendar, not a schedule: a syllabus paragraph pasted
  // into the box by mistake. One verdict on the file, not five on its lines.
  'not-a-schedule.txt': {
    sniff: 'rows', kind: 'rows', total: 0, ok: 0, minErrors: 1, maxProblems: 1,
    fileProblems: [{ code: 'FILE_NOT_SCHEDULE', says: 'look like a class' }],
  },
  // THE GUARD ON THAT VERDICT, and the reason it is safe. One real class
  // among five lines of portal boilerplate. The file-level "this is not a
  // schedule" answer must NOT fire — a summary verdict that swallowed a good
  // class would be a worse bug than the one it replaced — so this imports
  // 1 of 6 and names the five junk lines individually.
  'mostly-junk.txt': {
    sniff: 'rows', kind: 'rows', total: 6, ok: 1, minErrors: 5,
    summaryHas: 'Imported 1 of 6',
    events: [
      { status: 'failed', problem: 'ROW_UNREADABLE', says: 'does not read like a class' },
      { status: 'failed', problem: 'ROW_UNREADABLE', says: 'does not read like a class' },
      { code: 'WEL', room: '2.224', days: ['MO', 'WE', 'FR'], startMin: 780, status: 'ok' },
      { status: 'failed', problem: 'ROW_UNREADABLE', says: 'does not read like a class' },
      { status: 'failed', problem: 'ROW_UNREADABLE', says: 'does not read like a class' },
      { status: 'failed', problem: 'ROW_UNREADABLE', says: 'does not read like a class' },
    ],
  },
  'manual-paste.txt': {
    sniff: 'rows', kind: 'rows', total: 7, ok: 5, minErrors: 2,
    summaryHas: 'Imported 5 of 7',
    events: [
      { code: 'GDC', room: '2.216', days: ['MO', 'WE', 'FR'], startMin: 600, endMin: 660, status: 'ok' },
      { code: 'RLP', room: '0.106', days: ['TU', 'TH'], startMin: 570, endMin: 660, status: 'ok' },
      { code: 'WEL', room: '2.224', days: ['MO', 'WE', 'FR'], startMin: 780, status: 'ok' },
      { code: 'PAI', room: '3.02', days: ['TU', 'TH'], startMin: 750, endMin: 840, status: 'ok' },
      // The brief's own example. One candidate on the line, and it is both a
      // course-shaped token and a real building code — the building wins.
      { code: 'MAI', room: '220', days: ['TU', 'TH'], startMin: 840, status: 'ok' },
      { status: 'failed', problem: 'BUILDING_UNKNOWN', says: 'MAI' },
      { status: 'failed', problem: 'LOCATION_MISSING', says: 'no building' },
    ],
  },
};

// Every clean fixture's schedule must produce at least this many walk legs,
// and all of them must route.
const LEGS_REQUIRED = { 'google-clean.ics': 2, 'apple-clean.ics': 1, 'ut-regplus.ics': 1 };

const fails = [];
const notes = [];
function check(ok, label, detail) {
  if (ok) { notes.push('  ok    ' + label); return true; }
  fails.push(label + (detail ? ' — ' + detail : ''));
  notes.push('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  return false;
}

const browser = await launch(chromium, { maxMs: 540000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
// Correctness, not speed — the probe rewrites every graphics setting ~11 s in.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.waitForFunction(() => typeof window.wayfindParseSchedule === 'function', null, { timeout: 60000 });

console.log('BASE          ' + BASE);
console.log('fixtures      ' + FIXTURE_URL);

// ── every fixture ─────────────────────────────────────────────────────────
const parsed = {};
for (const name of Object.keys(EXPECT)) {
  const exp = EXPECT[name];
  // Read off disk and hand the bytes in. The importer's job is text -> shape;
  // making every fixture a round trip through the dev server only adds a way
  // for the gate to fail for a reason that has nothing to do with parsing.
  // (The webcal/URL front end is tested over the wire further down, where the
  // network IS the thing under test.)
  const text = fs.readFileSync(path.join(HERE, name), 'utf8');
  // NO `kind`. The sniff has to decide, because that is the documented call
  // and the one an interface makes — see assertion 5 in the header.
  const got = await page.evaluate(async ({ text, label }) => {
    const s = await window.wayfindParseSchedule(text, { label });
    return JSON.parse(JSON.stringify(s));
  }, { text, label: name });
  parsed[name] = got;

  if (DUMP) {
    console.log('\n===== ' + name + ' =====');
    console.log(JSON.stringify(got, null, 1));
    continue;
  }

  console.log('\n--- ' + name + ' ---');
  console.log('  sniffed: ' + got.source.sniffed + '  ->  kind: ' + got.source.kind);
  console.log('  summary: ' + got.summary);
  check(got.shape === 'ut-walk-schedule' && got.version === 1, `${name}: shape stamped`);
  check(got.source.sniffed === exp.sniff, `${name}: sniffed as ${exp.sniff}`, String(got.source.sniffed));
  check(got.source.kind === exp.kind, `${name}: source kind ${exp.kind}`, String(got.source.kind));
  if (exp.maxProblems != null) {
    // The regression guard. Nine LOCATION_MISSING errors for nine lines of
    // HTML is what this number is here to make impossible.
    check(got.problems.length <= exp.maxProblems,
      `${name}: at most ${exp.maxProblems} problem(s), not one per line`,
      `got ${got.problems.length}: ` + got.problems.map(p => p.code).join(','));
  }
  check(got.counts.total === exp.total, `${name}: ${exp.total} events`, `got ${got.counts.total}`);
  check(got.counts.ok === exp.ok, `${name}: ${exp.ok} usable`, `got ${got.counts.ok}`);
  if (exp.errors != null) {
    check(got.counts.errors === exp.errors, `${name}: ${exp.errors} errors`, `got ${got.counts.errors}`);
  }
  if (exp.minErrors != null) {
    check(got.counts.errors >= exp.minErrors, `${name}: at least ${exp.minErrors} errors`, `got ${got.counts.errors}`);
  }
  if (exp.summaryHas) {
    check(got.summary.indexOf(exp.summaryHas) >= 0,
      `${name}: summary reads "${exp.summaryHas}"`, JSON.stringify(got.summary));
  }
  for (const fp of (exp.fileProblems || [])) {
    const hit = got.problems.find(p => p.code === fp.code);
    if (check(!!hit, `${name}: file problem ${fp.code}`)) {
      check(hit.text.toLowerCase().indexOf(fp.says.toLowerCase()) >= 0,
        `${name}: ${fp.code} says "${fp.says}"`, JSON.stringify(hit.text));
    }
  }
  (exp.events || []).forEach((e, i) => {
    const ev = got.events[i];
    const tag = `${name} row ${i + 1}`;
    if (!check(!!ev, `${tag}: present`)) return;
    if (e.status) check(ev.status === e.status, `${tag}: status ${e.status}`, ev.status);
    if (e.code) check(ev.code === e.code, `${tag}: code ${e.code}`, String(ev.code));
    if (e.room) check(ev.room === e.room, `${tag}: room ${e.room}`, String(ev.room));
    if (e.days) {
      check(ev.days.join(',') === e.days.join(','), `${tag}: days ${e.days.join(',')}`, ev.days.join(','));
    }
    if (e.startMin != null) check(ev.startMin === e.startMin, `${tag}: start ${e.startMin}`, String(ev.startMin));
    if (e.endMin != null) check(ev.endMin === e.endMin, `${tag}: end ${e.endMin}`, String(ev.endMin));
    if (e.lastDate) check(ev.lastDate === e.lastDate, `${tag}: last date ${e.lastDate}`, String(ev.lastDate));
    if (e.exDates != null) check(ev.exDates.length === e.exDates, `${tag}: ${e.exDates} skipped dates`, String(ev.exDates.length));
    if (e.problem) {
      const hit = ev.problems.find(p => p.code === e.problem);
      if (check(!!hit, `${tag}: problem ${e.problem}`, ev.problems.map(p => p.code).join('/'))) {
        check(hit.text.indexOf(e.says) >= 0, `${tag}: says "${e.says}"`, JSON.stringify(hit.text));
        check(hit.text.length > 25, `${tag}: message is a sentence`, JSON.stringify(hit.text));
      }
    }
  });
  for (const p of got.problems) console.log(`  [${p.level}] ${p.code}: ${p.text}`);
}

if (DUMP) { await browser.__done(); process.exit(0); }

// ── the explicit `kind` override, in its own section ──────────────────────
//
// It has to be here and it must NOT be how the table above is graded. A drop
// zone knows a file's extension and may reasonably force the parser, so the
// override is real API and is asserted in both directions. But when the
// override was doing double duty as the default path's test, it hid the bug
// this round exists to fix: the one fixture that needed the sniff most was
// the one fixture the sniff was never asked about.
console.log('\n--- the explicit kind override ---');
const forced = await page.evaluate(async ({ ics, html }) => {
  const asRows = await window.wayfindParseSchedule(ics, { kind: 'rows' });
  const asIcs = await window.wayfindParseSchedule(html, { kind: 'ics' });
  return JSON.parse(JSON.stringify({
    asRows: { kind: asRows.source.kind, sniffed: asRows.source.sniffed },
    asIcs: {
      kind: asIcs.source.kind, sniffed: asIcs.source.sniffed,
      problems: asIcs.problems.map(p => ({ code: p.code, text: p.text })),
    },
  }));
}, {
  ics: fs.readFileSync(path.join(HERE, 'google-clean.ics'), 'utf8'),
  html: fs.readFileSync(path.join(HERE, 'not-a-calendar.ics'), 'utf8'),
});
check(forced.asRows.kind === 'rows' && forced.asRows.sniffed === 'ics',
  'kind:"rows" overrules a sniff that said ics, and the sniff is still recorded',
  JSON.stringify(forced.asRows));
check(forced.asIcs.kind === 'ics' && forced.asIcs.sniffed === 'markup',
  'kind:"ics" overrules a sniff that said markup, and the sniff is still recorded',
  JSON.stringify(forced.asIcs));
check(forced.asIcs.problems.length === 1 && forced.asIcs.problems[0].code === 'FILE_NOT_CALENDAR',
  'and forcing ics on a web page still gives exactly one named failure',
  JSON.stringify(forced.asIcs.problems.map(p => p.code)));
console.log('  google-clean.ics forced to rows -> ' + JSON.stringify(forced.asRows));
console.log('  not-a-calendar.ics forced to ics -> [' + forced.asIcs.problems[0].code + ']');

// A BOM in front of the doctype. Windows and several export paths write one,
// and the head test is anchored at `^`, so an unhandled BOM would push the
// doctype off the anchor and drop the file back into the row parser — the
// exact bug, wearing three invisible bytes. The regex allows for it; this is
// the assertion that says so, since nothing about it is visible in the source.
const bommed = await page.evaluate(async ({ html }) => {
  const s = await window.wayfindParseSchedule('﻿' + html);
  return JSON.parse(JSON.stringify({ sniffed: s.source.sniffed, problems: s.problems.map(p => p.code) }));
}, { html: fs.readFileSync(path.join(HERE, 'not-a-calendar.ics'), 'utf8') });
check(bommed.sniffed === 'markup' && bommed.problems.length === 1,
  'a BOM in front of the doctype does not hide the web page',
  JSON.stringify(bommed));

// ── every clean event must actually ROUTE ─────────────────────────────────
console.log('\n--- routing the clean schedules ---');
for (const name of Object.keys(LEGS_REQUIRED)) {
  const checked = await page.evaluate(async ({ text }) => {
    const s = await window.wayfindParseSchedule(text, {});
    await window.wayfindScheduleCheck(s);
    return JSON.parse(JSON.stringify({
      counts: s.counts, legs: s.legs,
      codes: s.events.map(e => ({ code: e.code, routable: e.resolved && e.resolved.routable, status: e.status })),
    }));
  }, { text: fs.readFileSync(path.join(HERE, name), 'utf8') });
  const unroutable = checked.codes.filter(c => c.routable !== true);
  check(unroutable.length === 0, `${name}: every class routes`, JSON.stringify(unroutable));
  check(checked.legs.length >= LEGS_REQUIRED[name],
    `${name}: at least ${LEGS_REQUIRED[name]} class-to-class legs`, String(checked.legs.length));
  check(checked.legs.every(l => l.ok), `${name}: every leg has a route`,
    JSON.stringify(checked.legs.filter(l => !l.ok)));
  for (const l of checked.legs) {
    console.log(`  ${l.day} ${l.from} -> ${l.to}  ${l.ok ? Math.round(l.distM) + ' m' : 'NO ROUTE (' + l.why + ')'}` +
      (l.gapMin != null ? `  (${l.gapMin} min between classes)` : ''));
  }
}

// ── the webcal:// front end, end to end against a real feed ───────────────
//
// Two halves, because they test different things and this harness serves
// plain HTTP. `webcal://` means "subscribe over HTTPS" (docs/import-bar-
// apple.md), so the REWRITE is asserted against the https target it produces,
// and the FETCH-AND-PARSE path is exercised over the http URL this server can
// actually answer. Testing the rewrite by pointing it at a http server would
// only prove the constant had been bent to make the test pass.
console.log('\n--- webcal:// subscribe ---');
const rewrite = await page.evaluate(async () => {
  const s = await window.wayfindFetchSchedule('webcal://calendar.google.com/calendar/ical/x/basic.ics');
  return JSON.parse(JSON.stringify({ source: s.source, problems: s.problems }));
});
check(rewrite.source.fetched === 'https://calendar.google.com/calendar/ical/x/basic.ics',
  'webcal:// is rewritten to the https feed behind it', String(rewrite.source.fetched));
console.log('  webcal://calendar.google.com/... -> ' + rewrite.source.fetched);

const webcal = await page.evaluate(async ({ base }) => {
  const s = await window.wayfindFetchSchedule(`${base}/scripts/verify/schedule-fixtures/google-clean.ics`);
  return JSON.parse(JSON.stringify({ counts: s.counts, source: s.source, summary: s.summary, problems: s.problems }));
}, { base: BASE });
check(webcal.counts.ok === 4, 'subscribe-by-URL imports 4 classes',
  JSON.stringify(webcal.counts) + ' ' + JSON.stringify(webcal.problems.map(p => p.code)));
check(webcal.source.kind === 'ics-url', 'and stamps itself as a URL source', webcal.source.kind);
console.log('  ' + webcal.summary + '   (from ' + webcal.source.url + ')');

// A feed URL that answers 200 with a SIGN-IN PAGE — the same wrong bytes an
// upload brings, arriving over the wire, and the way this actually fails in
// the wild. The URL front end must reach the same one sentence.
const loginFeed = await page.evaluate(async ({ base }) => {
  const s = await window.wayfindFetchSchedule(`${base}/scripts/verify/schedule-fixtures/not-a-calendar.ics`);
  return JSON.parse(JSON.stringify({
    kind: s.source.kind, sniffed: s.source.sniffed, counts: s.counts,
    problems: s.problems.map(p => ({ code: p.code, text: p.text })),
  }));
}, { base: BASE });
check(loginFeed.problems.length === 1 && loginFeed.problems[0].code === 'FILE_NOT_CALENDAR',
  'a feed that answers with a sign-in page fails with one named reason',
  JSON.stringify(loginFeed.problems.map(p => p.code)));
check(loginFeed.sniffed === 'markup', 'and records that it read as a web page', String(loginFeed.sniffed));
console.log('  [' + loginFeed.problems[0].code + '] ' + loginFeed.problems[0].text.slice(0, 72) + '…');

const badUrl = await page.evaluate(async () => {
  const s = await window.wayfindFetchSchedule('https://calendar.google.com/calendar/ical/definitely-not-real/basic.ics');
  return JSON.parse(JSON.stringify({ counts: s.counts, problems: s.problems }));
});
check(badUrl.problems.length === 1 && /URL_/.test(badUrl.problems[0].code),
  'an unreachable feed fails with one named reason', JSON.stringify(badUrl.problems.map(p => p.code)));
check((badUrl.problems[0] || {}).hint && badUrl.problems[0].hint.indexOf('.ics') >= 0,
  'and tells the student what to do instead', JSON.stringify((badUrl.problems[0] || {}).hint));
console.log('  [' + badUrl.problems[0].code + '] ' + badUrl.problems[0].text);

// ── the seam a future OCR / API source comes in through ───────────────────
console.log('\n--- wayfindScheduleFrom (the OCR / API seam) ---');
const seam = await page.evaluate(async () => {
  const s = await window.wayfindScheduleFrom([
    { course: 'C S 429', location: 'UTC 3.102', days: 'MWF', start: '4:00pm', end: '5:00pm', confidence: 0.97 },
    { course: 'M 408C', location: 'Welch Hall', days: ['MO', 'WE'], startMin: 600, confidence: 0.62 },
    { course: 'EE 379K', location: 'MER 1.606D', days: 'TTH', startMin: 540, confidence: 0.91 },
  ], { kind: 'image', label: 'photo of a printed schedule', producer: 'ocr-v0' });
  return JSON.parse(JSON.stringify(s));
});
check(seam.shape === 'ut-walk-schedule' && seam.version === 1, 'the OCR seam produces the same shape');
check(seam.source.kind === 'image', 'and stamps its own source kind', seam.source.kind);
check(seam.events[0].code === 'UTC' && seam.events[0].days.join(',') === 'MO,WE,FR' && seam.events[0].startMin === 960,
  'a structured row resolves exactly like an .ics row',
  JSON.stringify({ code: seam.events[0].code, days: seam.events[0].days, startMin: seam.events[0].startMin }));
check(seam.events[1].code === 'WEL' && seam.events[1].problems.some(p => p.code === 'BUILDING_BY_NAME'),
  'a building given by NAME resolves but is flagged, never silently',
  JSON.stringify(seam.events[1].problems.map(p => p.code)));
check(seam.events[2].status === 'failed' && seam.events[2].problems.some(p => p.code === 'BUILDING_OFF_MAP'),
  'and an off-map row fails the same way it does from a file',
  JSON.stringify(seam.events[2].problems.map(p => p.code)));
check(seam.events[0].confidence === 0.97, 'a per-row confidence survives into the shape', String(seam.events[0].confidence));
for (const p of seam.problems) console.log(`  [${p.level}] ${p.code}: ${p.text}`);

// ── PROVE THE SUBJECT IS ON SCREEN ────────────────────────────────────────
// House rule: a number nobody looked at is not evidence. Draw one leg that
// came out of a parsed schedule and photograph it.
console.log('\n--- drawing a leg that came out of the parser ---');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const drawn = await page.evaluate(async ({ text }) => {
  const s = await window.wayfindParseSchedule(text, {});
  await window.wayfindScheduleCheck(s);
  const leg = s.legs.find(l => l.ok);
  if (!leg) return { ok: false };
  const ans = await window.wayfindRoute(leg.from, leg.to, { fit: true });
  return {
    ok: !!ans.ok, from: leg.from, to: leg.to, day: leg.day, gapMin: leg.gapMin,
    fromTitle: leg.fromTitle, toTitle: leg.toTitle,
    distM: ans.distM, headline: ans.headline, sub: ans.sub,
    fromName: ans.fromName, toName: ans.toName,
    vertices: ans.vertices, bbox: ans.bbox,
  };
}, { text: fs.readFileSync(path.join(HERE, 'google-clean.ics'), 'utf8') });
check(drawn.ok, 'the leg draws on the map', JSON.stringify(drawn));
console.log(`  ${drawn.day}: ${drawn.fromTitle} (${drawn.from}) -> ${drawn.toTitle} (${drawn.to})`);
console.log(`  ${drawn.fromName} -> ${drawn.toName}: ${drawn.headline} / ${drawn.sub}`);

await page.waitForTimeout(2500);
// Screenshot twice, trust the second (CLAUDE.md verification rule 10).
await page.screenshot({ path: path.join(SHOT_DIR, '_warm.png') });
await page.waitForTimeout(1200);
const shot = path.join(SHOT_DIR, 'leg-from-schedule.png');
await page.screenshot({ path: shot });
fs.rmSync(path.join(SHOT_DIR, '_warm.png'), { force: true });

// Read the live GL buffer and KEEP IT IN THE PAGE. Sampling the canvas, not
// the DOM: a memory note in this project says visible-in-DOM is not
// visible-on-camera. Nothing large crosses the CDP wire — an earlier cut
// shipped 768,000 numbers per frame out of the renderer and wedged the run.
const grab = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return null;
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let dark = 0, n = 0;
  const keep = new Uint8Array(Math.ceil(w / 2) * Math.ceil(h / 2) * 3);
  let k = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      keep[k++] = buf[i]; keep[k++] = buf[i + 1]; keep[k++] = buf[i + 2];
      n++;
      if (buf[i] + buf[i + 1] + buf[i + 2] < 40) dark++;
    }
  }
  const prev = window.__parserFrame;
  window.__parserFrame = keep;
  let diff = -1;
  if (prev && prev.length === keep.length) {
    diff = 0;
    for (let i = 0; i < keep.length; i += 3) {
      if (Math.abs(keep[i] - prev[i]) + Math.abs(keep[i + 1] - prev[i + 1]) +
          Math.abs(keep[i + 2] - prev[i + 2]) > 24) diff++;
    }
  }
  return { w, h, sampled: n, dark, diff };
});

const fitted = await grab();
check(!!fitted && fitted.sampled > 0, 'the canvas could be sampled at all');
check(fitted && fitted.dark / fitted.sampled < 0.9,
  'the camera is not buried (the frame is not black)',
  fitted ? (Math.round(1000 * fitted.dark / fitted.sampled) / 10) + '% black' : 'no canvas');

// Now stand ON the route, which is the altitude the 1.6 m painted ribbon is
// drawn for and the one Simeon judges from. `centre` is the bounding box's
// middle and at this pitch that looks past the walk at the horizon; `on` is a
// vertex OF the route, so the camera is put there and aimed down the next
// segment.
const walk = await page.evaluate(async ({ from, to, zoom, pitch }) => {
  const ans = await window.wayfindRoute(from, to, {});
  if (!ans.ok) return { ok: false };
  const a = ans.on, b = ans.onNext;
  const brg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
  window.__map.jumpTo({ center: a, zoom: zoom, pitch: pitch, bearing: brg });
  return { ok: true, at: a, bearing: Math.round(brg) };
}, { from: drawn.from, to: drawn.to, zoom: 19.3, pitch: 56 });
check(walk.ok, 'the same leg redraws at walking height');
await page.waitForTimeout(3200);
await page.screenshot({ path: path.join(SHOT_DIR, '_warm2.png') });
await page.waitForTimeout(1200);
const shot2 = path.join(SHOT_DIR, 'leg-walking-height.png');
await page.screenshot({ path: shot2 });
fs.rmSync(path.join(SHOT_DIR, '_warm2.png'), { force: true });

// THE PROOF THAT THE ROUTE IS PAINTED, not merely present in a source.
//
// A fixed colour threshold was the first attempt and it was the wrong
// instrument: "count warm pixels" needed a number chosen AFTER seeing the
// answer, which is not a test. Nor is picking a pixel-count bar after reading
// the pixel count — the first two tries were 472 and 1448, and any threshold
// between them would have been reverse-engineered from the result.
//
// So the instrument calibrates itself. Grab the same still frame TWICE with
// nothing changed at all: whatever differs between those two is this
// renderer's own noise floor, measured on this machine on this run. Then clear
// the route from the unmoved camera and grab again. The route is only claimed
// to be on screen if removing it moves an order of magnitude more pixels than
// standing still does. No number in this block was chosen by looking at the
// answer.
const NOISE_MULTIPLE = 10;    // signal must beat the still-frame noise by this
const ABS_FLOOR = 200;        // ...and by this, in case the noise floor is zero
await grab();                                  // frame A (route drawn)
await page.waitForTimeout(1800);
const still = await grab();                    // frame B, nothing changed
const noise = still ? still.diff : -1;
await page.evaluate(() => window.wayfindClear && window.wayfindClear());
await page.waitForTimeout(1800);
const cleared = await grab();                  // frame C, route removed
const diff = cleared ? cleared.diff : -1;
const bar = Math.max(ABS_FLOOR, noise * NOISE_MULTIPLE);
check(diff > bar, 'clearing the route changes the picture (so it was drawn)',
  `${diff} pixels moved vs a ${noise}-pixel noise floor (bar ${bar}) of ${still ? still.sampled : 0} sampled`);
console.log(`  still frame moves ${noise} px; clearing the route moves ${diff} px (bar ${bar})`);
console.log('  frames: ' + shot + '\n          ' + shot2);

// ── nothing may throw ─────────────────────────────────────────────────────
check(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));

console.log('\n' + notes.join('\n'));
console.log('\n' + (fails.length ? ` FAIL  ${fails.length} of ${notes.length} assertions\n   - ` + fails.join('\n   - ')
  : ` PASS  ${notes.length} assertions`));
await browser.__done();
process.exit(fails.length ? 1 : 0);
