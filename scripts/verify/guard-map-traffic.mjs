/**
 * guard-map-traffic.mjs — the egress guard refuses the schedule, and ONLY the
 * schedule. It must never refuse the map's own traffic.
 *
 *   node scripts/verify/guard-map-traffic.mjs      (starts its own server)
 *
 * WHY THIS EXISTS. On 2026-09-28 a phone with a photo-imported schedule stored
 * refused MapLibre's own tiles. The watchlist was every string in the stored
 * doc, so the app's own words became needles: `provenance.confirmedBy:
 * 'student'` matched "Student Activity Center" inside a vector tile, and
 * `read: 'photo'` matched too. Separately, any payload with more than 4 MB of
 * binary was refused unread, and the map's own image replies are bigger than
 * that. It showed up as a flaky "no console errors" check in img-import.mjs,
 * because it depended on which tiles loaded while a schedule was stored.
 *
 * This gate needs no map, so it runs in seconds. It loads js/wayfind.js on a
 * bare page, stores a schedule shaped exactly like a confirmed photo import
 * (every app-owned field filled in), and fires payloads at a REAL Worker:
 *
 *   1. MAP-LIKE PAYLOADS PASS: vector-tile words ("Student Activity Center",
 *      "building", "photo" ...), each alone, as tile bytes; map decimals
 *      that contain a stored room number ("0.4024|elm|11.9061"), as bytes
 *      and as a string; and a big image reply over the old 4 MB budget.
 *   2. THE SCHEDULE IS STILL REFUSED: title, building + room pair, instructor, the
 *      photo's original reading, in UTF-8 and UTF-16LE bytes and as strings,
 *      at the START and the END of a big buffer, and a buffer past the hard
 *      ceiling is refused unread.
 *
 * Exit: 0 all pass, 1 a check failed.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (c, name, detail) => {
  if (c) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
};
const head = s => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 70 - s.length)));

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
    try { const r = await fetch(BASE + '/js/wayfind.js', { method: 'HEAD' }); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }
}
const stopServer = () => { try { if (server && !server.killed) server.kill(); } catch (e) {} };
process.once('exit', stopServer);

const browser = await launch(chromium, { maxMs: 300000 });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));

// A bare page, then the one module. `?walk=1` is what turns the feature on.
await page.goto(BASE + '/scripts/verify/schedimg-blank.html?walk=1', { waitUntil: 'load' });
await page.addScriptTag({ url: '/js/wayfind.js' });
await page.waitForFunction(() => window.wayfindStore && window.wayfindStore.guard, null, { timeout: 30000 });

console.log('\n' + '='.repeat(78));
console.log('  guard-map-traffic — ' + BASE);
console.log('='.repeat(78));

// ════════════════════════════════════════════════════════════════════════════
head('0. a schedule shaped like a confirmed photo import is stored');
const TITLE = 'Zygomorphic Percussion Seminar';
const INSTRUCTOR = 'Quentin Ashgrove';
const ROOM_PAIR = 'GDC 2.216';
const READ_AS = 'MER 1.906';     // what the photo said before the student fixed it
const setup = await page.evaluate((c) => {
  const s = window.wayfindStore;
  s.clear();
  const saved = s.save({
    term: 'Fall 2026', tz: 'America/Chicago',
    sources: [{ id: 's0', kind: 'image-ocr', label: 'a photo of a schedule' }],
    classes: [
      { id: 'c0', code: 'GDC', room: '2.216', title: c.TITLE, instructor: c.INSTRUCTOR,
        days: ['MO', 'WE'], startMin: 600, endMin: 650, confidence: 1, src: 's0',
        unroutableWhy: null,
        provenance: { read: 'photo', confirmed: true, confirmedBy: 'student',
          unconfirmedFields: [], why: null, correctedFrom: c.READ_AS } },
      { id: 'c1', code: 'MER', room: '1.906', title: null, instructor: null,
        days: ['TU'], startMin: 780, endMin: 870, confidence: 0.6, src: 's0',
        unroutableWhy: 'offmap',
        provenance: { read: 'photo', confirmed: false,
          unconfirmedFields: ['building', 'room', 'time', 'days'],
          why: 'you were not asked about the building or the room' } },
    ],
  });
  return { saved: saved.ok, state: s.guard.state() };
}, { TITLE, INSTRUCTOR, READ_AS });
ok(setup.saved && setup.state.armed && setup.state.watched > 0,
  'the guard armed itself off the stored schedule', 'watched=' + setup.state.watched);

/** Fire one payload at a real Worker; 'passed' or 'refused: <why>'. */
const fire = (kind, arg) => page.evaluate(([kind, arg]) => {
  if (!window.__w) {
    window.__w = new Worker(URL.createObjectURL(new Blob(['onmessage=()=>{}'], { type: 'text/javascript' })));
  }
  const enc = (s) => new TextEncoder().encode(s);
  const u16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 255; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
  /** Image-like bytes (opaque RGBA noise), with `text` written at `at`. */
  const image = (mb, text, at) => {
    const u8 = new Uint8Array(Math.round(mb * 1024 * 1024));
    for (let i = 0; i < u8.length; i++) u8[i] = (i & 3) === 3 ? 255 : ((i * 2654435761) >>> 24) & 255;
    if (text) { const t = enc(text); u8.set(t, at === 'end' ? u8.length - t.length - 3 : 5); }
    return u8;
  };
  let msg;
  if (kind === 'tile') msg = { type: 'GR', data: { rawData: enc('\x1a\x05water\x0a' + arg + '\x12\x04name').buffer } };
  else if (kind === 'string') msg = { type: 'x', data: { note: arg } };
  else if (kind === 'utf16') msg = { type: 'x', data: { rawData: u16(arg).buffer } };
  else if (kind === 'image') msg = { type: '<response>', data: { img: { width: 1, height: 1, data: image(arg.mb, arg.text, arg.at) } } };
  try { window.__w.postMessage(msg); return 'passed'; }
  catch (e) {
    const m = String(e.message).match(/content \((.*)\)\. The schedule/);
    return 'refused: ' + (m ? m[1] : String(e.message).slice(0, 90));
  }
}, [kind, arg]);

// ════════════════════════════════════════════════════════════════════════════
head('1. the map\'s own traffic passes');
const MAP_WORDS = [
  'Student Activity Center', 'building', 'photo', 'Photo Lab', 'image-ocr',
  'a photo of a schedule', 'America/Chicago', 'room', 'time', 'days', 'offmap',
  'Speedway', 'Gregory Gym',
  // Decimals in the map's own data that CONTAIN the stored room numbers
  // (2.216, 1.906). The campus landscape layer's tree records look exactly
  // like this; a bare room number used to be a needle and matched them.
  '0.5926|pecan|12.2168|0.143', '0.4024|elm|11.9061|0.286',
];
for (const w of MAP_WORDS) {
  const r = await fire('tile', w);
  ok(r === 'passed', 'tile bytes holding "' + w + '" pass', r);
}
// The landscape layer reaches the worker as GeoJSON, so as strings, not bytes.
const treeStr = await fire('string', '0.5926|pecan|12.2168|0.143');
ok(treeStr === 'passed', 'a map string holding a stored room number passes', treeStr);
const bigClean = await fire('image', { mb: 12 });
ok(bigClean === 'passed', 'a 12 MB image reply with no schedule in it passes', bigClean);

// ════════════════════════════════════════════════════════════════════════════
head('2. the schedule is still refused');
const CASES = [
  ['tile', TITLE, 'the class title, as tile bytes'],
  ['utf16', TITLE, 'the class title, as UTF-16LE bytes'],
  ['string', 'meet at ' + ROOM_PAIR, 'the building + room pair, as a string'],
  ['tile', ROOM_PAIR, 'the building + room pair, as tile bytes'],
  ['string', INSTRUCTOR, 'the instructor, as a string'],
  ['string', 'it said ' + READ_AS, 'what the photo said before it was corrected'],
  ['image', { mb: 12, text: TITLE, at: 'start' }, 'the title at the START of a 12 MB image'],
  ['image', { mb: 12, text: TITLE, at: 'end' }, 'the title at the END of a 12 MB image'],
];
for (const [kind, arg, name] of CASES) {
  const r = await fire(kind, arg);
  ok(/^refused/.test(r), name + ' is refused', r);
}
const ceiling = await page.evaluate(() => window.wayfindStore.guard.state().policy.binaryScanBytes);
const past = await fire('image', { mb: ceiling / 1048576 + 1 });
ok(/^refused/.test(past) && /could not read/.test(past),
  'a payload past the hard ceiling (' + (ceiling / 1048576) + ' MB) is refused unread', past);

// ════════════════════════════════════════════════════════════════════════════
head('3. the guard\'s own record agrees');
const end = await page.evaluate(() => {
  const g = window.wayfindStore.guard;
  const blocked = g.log().filter(l => l.blocked).map(l => l.matched);
  window.wayfindStore.clear();
  return { blocked, state: g.state() };
});
ok(end.blocked.length === CASES.length + 1,
  'it logged exactly the refusals above, and nothing else',
  end.blocked.length + ' logged: ' + end.blocked.join(', '));
ok(end.state.watched === 0, 'and Delete emptied the watchlist again', 'watched=' + end.state.watched);
ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | ') || 'clean');

console.log('\n' + '='.repeat(78));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(78) + '\n');
await browser.close();
stopServer();
process.exit(fail ? 1 : 0);
