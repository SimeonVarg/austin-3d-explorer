/**
 * schedules.mjs — the four source schedules every image in this corpus is
 * rendered from.
 *
 * WHERE THE DATA COMES FROM. Nothing here is invented campus geography. Every
 * building code is a real UT code that `js/wayfind.js` already knows about —
 * either from `data/ut_buildings.json` (UT's own 198-code register, retrieved
 * 2026-08-05) or from the OFF_MAP table for the Pickle campus. Every course
 * number is a real UT course number. s1 and s2 are the two .ics fixtures this
 * repo already ships, transcribed field for field.
 *
 * WHAT IS DECORATION. Unique numbers and instructor names on s1/s2 come
 * straight out of the fixtures. On s3/s4 the instructor column reads STAFF —
 * which is what UT's own schedule prints when no instructor is assigned — so
 * that no real person is attributed to a course they do not teach. Unique
 * numbers on s3/s4 are plausible five-digit filler and are not scored.
 *
 * THE SCORING UNIT IS A MEETING, NOT A COURSE. `days` is expanded one entry
 * per day when truth.json is written, because a schedule importer has to place
 * a class on a particular day at a particular time to be useful. A TTh course
 * is two meetings; an MWF course is three.
 */

/** Mon..Fri only — no UT lecture in these fixtures meets at the weekend. */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const SCHEDULES = {
  // ── s1 ── verbatim from scripts/verify/schedule-fixtures/integration-tuesday.ics
  s1: {
    id: 's1',
    term: 'Fall 2026',
    source: 'scripts/verify/schedule-fixtures/integration-tuesday.ics',
    sourceNote:
      'Transcribed field for field from the .ics: same six courses, same rooms, ' +
      'same times, same unique numbers, same instructors.',
    classes: [
      { unique: '54010', course: 'M 340L',   title: 'MATRICES AND MATRIX CALCULATIONS',       instructor: 'HEITMANN, R',   building: 'RLP', room: '0.106', days: ['Tue', 'Thu'],        start: '09:30', end: '11:00' },
      { unique: '07620', course: 'RTF 305',  title: 'INTRO TO MEDIA STUDIES',                 instructor: 'CHEN, W',       building: 'CMA', room: '6.146', days: ['Tue', 'Thu'],        start: '11:00', end: '12:30' },
      { unique: '38520', course: 'GOV 312L', title: 'ISSUES AND POLICIES IN AMER GOVT',       instructor: 'ALBERTSON, B',  building: 'WEL', room: '2.224', days: ['Mon', 'Wed', 'Fri'], start: '10:00', end: '11:00' },
      { unique: '55980', course: 'PHY 303L', title: 'ENGINEERING PHYSICS II',                 instructor: 'SITZ, G',       building: 'PAI', room: '3.02',  days: ['Mon', 'Wed', 'Fri'], start: '13:00', end: '14:00' },
      { unique: '51120', course: 'C S 439',  title: 'PRINCIPLES OF COMPUTER SYSTEMS',         instructor: 'WITCHEL, E',    building: 'GDC', room: '2.216', days: ['Tue', 'Thu'],        start: '14:00', end: '15:30' },
      { unique: '16995', course: 'EE 460R',  title: 'MICROELECTRONICS RESEARCH LAB',          instructor: 'BANERJEE, S',   building: 'MER', room: '1.906', days: ['Tue', 'Thu'],        start: '16:00', end: '17:30' },
    ],
  },

  // ── s2 ── verbatim from scripts/verify/schedule-fixtures/ut-regplus.ics
  s2: {
    id: 's2',
    term: 'Fall 2026',
    source: 'scripts/verify/schedule-fixtures/ut-regplus.ics',
    sourceNote:
      'Transcribed field for field from the .ics. C S 429 keeps its four-day ' +
      'MTWTh pattern, which is the densest week in the corpus.',
    classes: [
      { unique: '02615', course: 'ACC 311',  title: 'FUNDAMENTALS OF ACCOUNTING',   instructor: 'WHITE, B',        building: 'GSB', room: '2.122', days: ['Mon', 'Wed'],               start: '09:30', end: '11:00' },
      { unique: '07620', course: 'RTF 305',  title: 'INTRO TO MEDIA STUDIES',       instructor: 'CHEN, W',         building: 'CMA', room: '6.146', days: ['Tue', 'Thu'],               start: '11:00', end: '12:30' },
      { unique: '07105', course: 'J 310F',   title: 'REPORTING WORDS',              instructor: 'MCELROY, K',      building: 'DMC', room: '3.208', days: ['Tue', 'Thu'],               start: '14:00', end: '15:30' },
      { unique: '54795', course: 'C S 429',  title: 'COMP ORGANIZATN AND ARCH',     instructor: 'CHATTERJEE, S',   building: 'UTC', room: '3.102', days: ['Mon', 'Tue', 'Wed', 'Thu'], start: '16:00', end: '17:00' },
    ],
  },

  // ── s3 ── the rows of scripts/verify/schedule-fixtures/manual-paste.txt
  s3: {
    id: 's3',
    term: 'Fall 2026',
    source: 'scripts/verify/schedule-fixtures/manual-paste.txt',
    sourceNote:
      'The seven pasted rows, with two changes made ON PURPOSE and stated here ' +
      'rather than hidden: the fixture gives HIS 315K the deliberately-misspelt ' +
      'code "MAII 220" and gives PSY 301 no location at all. An IMAGE benchmark ' +
      'scores four fields per meeting, so a row that cannot have a true building ' +
      'cannot be scored; both rows carry a real code here (MEZ 1.306, BUR 106). ' +
      'The MAI 220 row of the fixture is dropped rather than renamed. Everything ' +
      'else — C S 429/GDC, M 340L/RLP, GOV 312L/WEL, PHY 303L/PAI — is the ' +
      'fixture unchanged.',
    classes: [
      { unique: '54780', course: 'M 340L',   title: 'MATRICES AND MATRIX CALCULATIONS', instructor: 'STAFF', building: 'RLP', room: '0.106', days: ['Tue', 'Thu'],        start: '09:30', end: '11:00' },
      { unique: '54795', course: 'C S 429',  title: 'COMP ORGANIZATN AND ARCH',         instructor: 'STAFF', building: 'GDC', room: '2.216', days: ['Mon', 'Wed', 'Fri'], start: '10:00', end: '11:00' },
      { unique: '38905', course: 'HIS 315K', title: 'THE UNITED STATES 1492-1865',      instructor: 'STAFF', building: 'MEZ', room: '1.306', days: ['Mon', 'Wed'],        start: '10:30', end: '11:30' },
      { unique: '55980', course: 'PHY 303L', title: 'ENGINEERING PHYSICS II',           instructor: 'STAFF', building: 'PAI', room: '3.02',  days: ['Tue', 'Thu'],        start: '12:30', end: '14:00' },
      { unique: '38520', course: 'GOV 312L', title: 'ISSUES AND POLICIES IN AMER GOVT', instructor: 'STAFF', building: 'WEL', room: '2.224', days: ['Mon', 'Wed', 'Fri'], start: '13:00', end: '14:00' },
      { unique: '43410', course: 'PSY 301',  title: 'INTRODUCTION TO PSYCHOLOGY',       instructor: 'STAFF', building: 'BUR', room: '106',   days: ['Tue', 'Thu'],        start: '14:00', end: '15:30' },
    ],
  },

  // ── s4 ── composed here, from codes the router already knows
  s4: {
    id: 's4',
    term: 'Fall 2026',
    source: 'composed for this corpus',
    sourceNote:
      'Not a transcription. A first-year load built to reach codes the two .ics ' +
      'fixtures never touch — JES and MEZ — and to carry a room shaped like ' +
      'JES A121A, which is letter-then-digits and breaks a room pattern that ' +
      'only ever saw "2.224". Codes and courses are real UT; unique numbers and ' +
      'STAFF are filler and are not scored.',
    classes: [
      { unique: '48730', course: 'BIO 311C', title: 'INTRODUCTORY BIOLOGY I',           instructor: 'STAFF', building: 'WEL', room: '1.316', days: ['Mon', 'Wed', 'Fri'], start: '09:00', end: '10:00' },
      { unique: '63565', course: 'UGS 303',  title: 'SIGNATURE COURSE',                 instructor: 'STAFF', building: 'JES', room: 'A121A', days: ['Tue', 'Thu'],        start: '09:30', end: '11:00' },
      { unique: '54015', course: 'M 340L',   title: 'MATRICES AND MATRIX CALCULATIONS', instructor: 'STAFF', building: 'RLP', room: '0.106', days: ['Tue', 'Thu'],        start: '11:00', end: '12:30' },
      { unique: '38910', course: 'HIS 315K', title: 'THE UNITED STATES 1492-1865',      instructor: 'STAFF', building: 'MEZ', room: '1.306', days: ['Mon', 'Wed'],        start: '14:00', end: '15:00' },
      { unique: '51125', course: 'C S 439',  title: 'PRINCIPLES OF COMPUTER SYSTEMS',   instructor: 'STAFF', building: 'GDC', room: '2.216', days: ['Tue', 'Thu'],        start: '15:30', end: '17:00' },
    ],
  },
};

/** Every meeting of a schedule, one per (class, day). */
export function meetings(sched) {
  const out = [];
  for (let i = 0; i < sched.classes.length; i++) {
    const c = sched.classes[i];
    for (const d of c.days) {
      out.push({
        key: sched.id + '-' + i + '-' + d,
        clsIndex: i,
        course: c.course,
        title: c.title,
        building: c.building,
        room: c.room,
        day: d,
        start: c.start,
        end: c.end,
      });
    }
  }
  return out;
}

/** "09:30" -> 570 */
export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "13:00" -> "1:00 pm" (UT's registrar prints lower-case am/pm) */
export function ampm(hhmm) {
  const t = toMin(hhmm);
  const h24 = Math.floor(t / 60), mm = t % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return h + ':' + String(mm).padStart(2, '0') + ' ' + (h24 < 12 ? 'am' : 'pm');
}

/** ['Tue','Thu'] -> 'TTh' — UT's own day letters. */
export function dayLetters(days) {
  const L = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'Th', Fri: 'F' };
  return days.map(d => L[d]).join('');
}
