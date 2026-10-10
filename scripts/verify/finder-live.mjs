/**
 * finder-live.mjs — the sentences of the finder's live bus line (js/finder-live.js), checked in node.
 * No browser, no network. Every expected sentence is written out here by hand.
 * Usage: node scripts/verify/finder-live.mjs [--break | --break=day]     (--break changes one word, --break=day drops the weekend reason: each must fail)
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = await import(pathToFileURL(path.join(ROOT, 'js', 'finder-live.js')).href);
if (process.argv.includes('--break')) L.LIVE.say.live = (m) => 'in ' + m + ' min';
if (process.argv.includes('--break=day')) L.LIVE.say.offDay = () => '';        // the weekend reason is lost: the day checks must fail
let pass = 0; const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; };
const ok_ = (c, msg) => { assert.ok(c, msg); pass++; };

// Austin time, whatever the machine's zone: 2026-10-14 13:30 UTC is 08:30 on a Wednesday there (daylight time, UTC-5);
// 2026-12-06 05:10 UTC is 23:10 on Saturday (standard time, UTC-6).
eq(L.austinNow(new Date('2026-10-14T13:30:00Z')), { day: 3, minute: 510 }, 'October: UTC-5');
eq(L.austinNow(new Date('2026-12-06T05:10:00Z')), { day: 6, minute: 1390 }, 'December: UTC-6, and the day rolls back');
eq(L.austinNow(new Date('2026-10-14T05:00:00Z')), { day: 3, minute: 0 }, 'midnight is minute 0, not 1440');

const bus = (route, boardName, alightName) => ({ kind: 'bus', route, boardName, alightName });
const opt = (legs, lo, hi) => ({ options: [{ lo, hi, legs }] });
// timetable, direct: 35 min 10 s .. 52 min 20 s -> "35-52 min"
eq(L.describe(opt([{ kind: 'walk' }, { kind: 'wait', live: false, headway: 15 }, bus('20', 'Riverside/Crossing Place', 'West Mall UT'), { kind: 'walk' }], 2110, 3140), 'GDC', true).lines,
  ['Bus to GDC now: 20 from Riverside/Crossing Place, about every 15 min (timetable) · 35-52 min door to door'], 'timetable sentence');
// live, direct
const live = L.describe(opt([{ kind: 'walk' }, { kind: 'wait', live: true, inMin: 6, headway: 15 }, bus('20', 'Riverside/Wickersham', 'West Mall UT'), { kind: 'walk' }], 2280, 2400), 'GDC', true);
eq(live.lines, ['Bus to GDC now: 20 from Riverside/Wickersham, in 6 min (live) · 38-40 min door to door'], 'live sentence');
eq(live.live, true, 'marked live');
eq(L.describe(opt([{ kind: 'walk' }, { kind: 'wait', live: true, inMin: 0, headway: 10 }, bus('801', 'A', 'B'), { kind: 'walk' }], 600, 600), 'WEL', true).lines,
  ['Bus to WEL now: 801 from A, due now (live) · 10 min door to door'], 'due now, and one number only when both ends round the same');
// one transfer
eq(L.describe(opt([{ kind: 'walk' }, { kind: 'wait', live: false, headway: 15 }, bus('20', 'A', 'West Mall UT'), { kind: 'walk' }, { kind: 'wait' }, bus('801', 'West Mall Station', 'Hyde Park'), { kind: 'walk' }], 2640, 4200), 'XYZ', true).lines,
  ['Bus to XYZ now: 20 from A, about every 15 min (timetable) · change to 801 at West Mall UT · 44-70 min door to door'], 'transfer sentence');
// the feed is not answering: say so, once, and only when the line is NOT live
eq(L.describe(opt([{ kind: 'walk' }, { kind: 'wait', live: false, headway: 15 }, bus('20', 'A', 'B'), { kind: 'walk' }], 600, 1500), 'GDC', false).lines[1],
  'Live bus data is not answering. These are timetable times.', 'feed down note');
eq(L.describe({ options: [], reason: 'no bus is running at that time' }, 'GDC', true).lines, ['No bus is running right now (timetable).'], 'nothing running');
eq(L.describe({ options: [], reason: 'no stop near the start' }, 'GDC', true).lines, ['No bus links this home and GDC right now.'], 'no link');
// Walking beats the bus (js/transit-route.js returns the walk and no option): say so, with a range
eq(L.describe({ options: [], reason: 'walking is as fast as any bus', walk: { lo: 278.571, hi: 354.545, m: 300 } }, 'GDC', true).lines,
  ['Walking to GDC is as quick as any bus: about 5-6 min.'], 'walking is as quick');
eq(L.describe({ options: [], reason: 'you are already there', walk: { lo: 0, hi: 0, m: 0 } }, 'GDC', true).lines,
  ['This home and GDC are the same place.'], 'same place');
// A timetable past its last date is never described as the timetable; a live bus still is.
const tt = opt([{ kind: 'walk' }, { kind: 'wait', live: false, headway: 15 }, bus('20', 'A', 'B'), { kind: 'walk' }], 2110, 3140);
eq(L.describe(tt, 'GDC', true, true).lines, ['The bus timetable on this page has run out of date, so no timetable times are shown.'], 'expired timetable');
eq(L.describe({ options: [], reason: 'no bus is running at that time' }, 'GDC', true, true).lines, ['The bus timetable on this page has run out of date, so no timetable times are shown.'], 'expired, nothing running');
eq(L.describe(opt([{ kind: 'walk' }, { kind: 'wait', live: true, inMin: 6, headway: 15 }, bus('20', 'A', 'B'), { kind: 'walk' }], 2280, 2400), 'GDC', true, true).lines,
  ['Bus to GDC now: 20 from A, in 6 min (live) · 38-40 min door to door'], 'expired timetable, but a live bus is still said');
// WHY THE LINE DISAGREES WITH THE LIST. The list is the weekday class-time timetable; on a weekend or late at night the line says so
// first, and only where it would otherwise contradict the list (walking wins, or no bus is running). Never a promise.
{
  const walkWins = { options: [], reason: 'walking is as fast as any bus', walk: { lo: 278.571, hi: 354.545, m: 300 } };
  const none = { options: [], reason: 'no bus is running at that time' };
  eq(L.describe(walkWins, 'GDC', true, false, { day: 6, minute: 600 }).lines, ['Today is Saturday: fewer buses. Walking to GDC is as quick as any bus: about 5-6 min.'], 'Saturday, walking wins');
  eq(L.describe(none, 'GDC', true, false, { day: 0, minute: 600 }).lines, ['Today is Sunday: fewer buses. No bus is running right now (timetable).'], 'Sunday, no bus running');
  eq(L.describe(none, 'GDC', true, false, { day: 3, minute: 23 * 60 + 10 }).lines, ['It is late: fewer buses. No bus is running right now (timetable).'], 'a weekday at 23:10');
  eq(L.describe(walkWins, 'GDC', true, false, { day: 3, minute: 5 * 60 }).lines, ['It is late: fewer buses. Walking to GDC is as quick as any bus: about 5-6 min.'], 'a weekday at 05:00');
  eq(L.describe(walkWins, 'GDC', true, false, { day: 3, minute: 510 }).lines, ['Walking to GDC is as quick as any bus: about 5-6 min.'], 'a weekday morning: no reason, the old sentence');
  eq(L.describe(walkWins, 'GDC', true, false).lines, ['Walking to GDC is as quick as any bus: about 5-6 min.'], 'no time given: the old sentence');
  eq(L.describe({ options: [], reason: 'no stop near the start' }, 'GDC', true, false, { day: 6, minute: 600 }).lines, ['No bus links this home and GDC right now.'], 'a missing link is not about the day');
  eq(L.describe(opt([{ kind: 'walk' }, { kind: 'wait', live: false, headway: 30 }, bus('20', 'A', 'B'), { kind: 'walk' }], 2110, 3140), 'GDC', true, false, { day: 6, minute: 600 }).lines,
    ['Bus to GDC now: 20 from A, about every 30 min (timetable) · 35-52 min door to door'], 'a bus that IS running on Saturday is just described: no disagreement, no reason');
  eq([6 * 60 - 1, 6 * 60, 22 * 60 - 1, 22 * 60].map((m) => L.offReason({ day: 2, minute: m })), ['It is late: fewer buses. ', '', '', 'It is late: fewer buses. '], 'class hours are 06:00 up to 22:00');
  eq(L.offReason(null), '', 'no time, no reason'); eq(L.offReason({ day: NaN, minute: 5 }), '', 'junk time, no reason');
  ok_(L.offReason({ day: 6, minute: 0 }) === 'Today is Saturday: fewer buses. ', 'Saturday is named');
}
// No sentence may promise or give a clock time.
for (const fn of Object.values(L.LIVE.say)) {
  const s = typeof fn === 'function' ? fn(7, 'X') : fn;
  assert.ok(!/\d{1,2}:\d{2}|you will|guarantee|on time/i.test(String(s)), 'no clock time and no promise: ' + s); pass++;
}
console.log(`PASS  finder-live: Austin time and every sentence of the live bus line (${pass} checks)`);
