/**
 * image-bench.mjs — score anything that turns a schedule image into classes.
 *
 *   node image-bench.mjs --selftest
 *   node image-bench.mjs ./my-extractor.mjs [--name ours] [--json out.json]
 *
 * WHAT IT IS FOR. Every later stage of this round is scored on this file, and
 * both sides of every comparison must be scored by THIS file — ours and the
 * reference, same corpus, same normalisation, same rules. A comparison where
 * each side grades itself is not a comparison.
 *
 * THE EXTRACTOR CONTRACT. A module that default-exports one function:
 *
 *     export default async function extract(imagePath, meta) {
 *       // meta = { file, path, bytes }.  It does NOT include the condition and
 *       // it does NOT include the answers. Deliberately: a feature does not
 *       // get told the photo is blurry before it reads it.
 *       return [ { building: 'WEL', room: '2.224', day: 'Tue',
 *                  start: '09:30', end: '11:00' }, ... ];
 *     }
 *
 * Shapes it will also take, so neither side has to be rewritten to be scored
 * (see `expand()`): `code` for `building`; `location` / `loc` for a combined
 * "WEL 2.224"; `days` as an array or as UT day letters ("TTh", "MWF");
 * `startMin` / `endMin` in minutes past midnight; times as "09:30", "9:30 am",
 * "9:30AM" or a number.
 *
 * THE UNIT OF SCORING IS A MEETING WITH FOUR FIELDS RIGHT: building, room, day
 * and time. Three of four is a miss, and this file will not give partial credit
 * for it — but it does COUNT the three-of-four cases separately, because "wrong
 * room, right everything else" and "did not see it at all" are different bugs
 * and a scorer that flattens them teaches nothing.
 *
 * TIME MEANS START AND END. A walk feature uses the end time to decide when you
 * leave, so an importer that gets it wrong sends you late to the next class.
 * The headline number requires both; `startOnly` is reported beside it so the
 * split is visible rather than argued about.
 *
 * PRECISION IS SCORED, NOT JUST RECALL. An extractor that emits a confident
 * wrong room is worse than one that says it is unsure — that is the whole
 * premise of the feature. So every prediction that matches nothing is counted,
 * and the ones that name a class which is on the SCHEDULE but not on THIS IMAGE
 * are counted separately as hallucinations.
 *
 * IT MAKES NO NETWORK CALLS AND IT NEVER WILL. A schedule is personal data and
 * a picture of one is worse. This file reads local JPEGs and calls a function.
 * If an extractor uploads the image, that is a privacy failure regardless of
 * its score, and `scripts/verify/si-integration.mjs` section 6 is the gate that
 * catches it at the socket.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = path.join(HERE, 'schedule-images');
export const CONDITIONS = ['clean-export', 'angled-photo', 'dark-mode', 'partial-crop'];

// ══════════════════════════════════════════════════════════════════════════
// NORMALISATION — the only place either side is allowed to be forgiven
// ══════════════════════════════════════════════════════════════════════════

/** 'wel' / ' WEL ' / 'WEL.' -> 'WEL'. Letters and digits only. */
export function normBuilding(v) {
  if (v == null) return null;
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s || null;
}

/**
 * '2.224' -> '2.224'.  Case and whitespace are forgiven; punctuation is NOT.
 * `0.106` and `0106` are different rooms in UT's own numbering and this file
 * will not pretend otherwise.
 */
export function normRoom(v) {
  if (v == null) return null;
  const s = String(v).toUpperCase().replace(/\s+/g, '').replace(/^#/, '');
  return s || null;
}

const DAY_WORDS = {
  MON: 'Mon', MONDAY: 'Mon', M: 'Mon', MO: 'Mon',
  TUE: 'Tue', TUES: 'Tue', TUESDAY: 'Tue', T: 'Tue', TU: 'Tue',
  WED: 'Wed', WEDS: 'Wed', WEDNESDAY: 'Wed', W: 'Wed', WE: 'Wed',
  THU: 'Thu', THUR: 'Thu', THURS: 'Thu', THURSDAY: 'Thu', TH: 'Thu', R: 'Thu',
  FRI: 'Fri', FRIDAY: 'Fri', F: 'Fri', FR: 'Fri',
  SAT: 'Sat', SATURDAY: 'Sat', SA: 'Sat', S: 'Sat',
  SUN: 'Sun', SUNDAY: 'Sun', SU: 'Sun', U: 'Sun',
};
const ISO_DAYS = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * One day token -> 'Mon'..'Sun', or null.
 *
 * Numbers are read as ISO weekday (Monday = 1) and nothing else. There are at
 * least three conventions in the wild and guessing between them is exactly the
 * kind of silent wrong answer this benchmark exists to catch, so a 0 is null,
 * not Sunday.
 */
export function normDay(v) {
  if (v == null) return null;
  if (typeof v === 'number') return ISO_DAYS[v] || null;
  const s = String(v).trim().toUpperCase().replace(/[^A-Z]/g, '');
  return DAY_WORDS[s] || null;
}

/** 'TTh' / 'MWF' / 'MTWThF' -> ['Tue','Thu'] etc. Longest token first. */
export function splitDayLetters(s) {
  const up = String(s).toUpperCase().replace(/[^A-Z]/g, '');
  const out = [];
  let i = 0;
  while (i < up.length) {
    if (up.startsWith('TH', i)) { out.push('Thu'); i += 2; continue; }
    if (up.startsWith('SU', i)) { out.push('Sun'); i += 2; continue; }
    if (up.startsWith('SA', i)) { out.push('Sat'); i += 2; continue; }
    const d = DAY_WORDS[up[i]];
    if (!d) return null;                       // an unreadable run is not a guess
    out.push(d);
    i += 1;
  }
  return out.length ? out : null;
}

/**
 * A time -> minutes past midnight, or null.
 *
 * '09:30' | '9:30 am' | '9:30AM' | '0930' | 570 all work. A BARE '3:30' with
 * no am/pm and no leading zero is 03:30 and will not silently become 15:30 —
 * an importer that cannot tell morning from afternoon has to say so, not pick.
 */
export function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v < 1440 ? Math.round(v) : null;
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === 'p') h += 12;
    return h * 60 + Number(m[2]);
  }
  m = /^(\d{1,2})\s*([ap])\.?m\.?$/.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[2] === 'p') h += 12;
    return h * 60;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]), mm = Number(m[2]);
    return h < 24 && mm < 60 ? h * 60 + mm : null;
  }
  m = /^(\d{3,4})$/.exec(s);
  if (m) {
    const h = Math.floor(Number(m[1]) / 100), mm = Number(m[1]) % 100;
    return h < 24 && mm < 60 ? h * 60 + mm : null;
  }
  return null;
}

export function hhmm(min) {
  if (min == null) return '--:--';
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

/**
 * One prediction object -> zero or more normalised meetings.
 *
 * A prediction that names several days becomes several meetings, because the
 * answer key is per-meeting. A prediction that cannot produce a day at all
 * still comes through, with `day: null`, so it can be counted as a wrong
 * answer instead of quietly disappearing.
 */
export function expand(p) {
  if (!p || typeof p !== 'object') return [];

  let building = p.building ?? p.code ?? p.bldg ?? p.buildingCode ?? null;
  let room = p.room ?? p.roomNumber ?? null;

  // "WEL 2.224" in one field, which is how UT itself writes it.
  const combined = p.location ?? p.loc ?? p.locationText ?? p.where ?? null;
  if ((building == null || room == null) && combined != null) {
    const m = /^\s*([A-Za-z]{2,4}\d?)\s+([A-Za-z0-9.\-]+)\s*$/.exec(String(combined));
    if (m) {
      if (building == null) building = m[1];
      if (room == null) room = m[2];
    } else if (building == null) {
      building = combined;
    }
  }

  let days = null;
  if (Array.isArray(p.days)) days = p.days.map(normDay);
  else if (typeof p.days === 'string') days = splitDayLetters(p.days) || [normDay(p.days)];
  else if (p.day != null) days = [normDay(p.day)];
  else if (p.weekday != null) days = [normDay(p.weekday)];
  if (!days || !days.length) days = [null];

  const start = parseTime(p.start ?? p.startMin ?? p.startTime ?? p.begin ?? null);
  const end = parseTime(p.end ?? p.endMin ?? p.endTime ?? p.finish ?? null);

  return days.map(d => ({
    building: normBuilding(building),
    room: normRoom(room),
    day: d,
    start, end,
    _raw: p,
  }));
}

function truthMeeting(t) {
  return {
    building: normBuilding(t.building),
    room: normRoom(t.room),
    day: normDay(t.day),
    start: parseTime(t.start),
    end: parseTime(t.end),
    course: t.course,
    required: !!t.required,
  };
}

const key4 = m => [m.building, m.room, m.day, m.start, m.end].join('|');
const key3 = m => [m.building, m.room, m.day, m.start].join('|');

/** How many of the four fields two meetings agree on. */
function agree(a, b) {
  let n = 0;
  if (a.building != null && a.building === b.building) n++;
  if (a.room != null && a.room === b.room) n++;
  if (a.day != null && a.day === b.day) n++;
  if (a.start != null && a.start === b.start && a.end === b.end) n++;
  return n;
}

// ══════════════════════════════════════════════════════════════════════════
// SCORING ONE IMAGE
// ══════════════════════════════════════════════════════════════════════════
export function scoreImage(truthEntry, predictions) {
  const required = truthEntry.classes.filter(c => c.required).map(truthMeeting);
  const optional = truthEntry.classes.filter(c => !c.required).map(truthMeeting);
  const offImage = (truthEntry.notOnImage || []).map(truthMeeting);

  const preds = [];
  for (const p of predictions || []) for (const m of expand(p)) preds.push(m);

  const used = new Array(preds.length).fill(false);
  const take = (want, exact, marks) => {
    const k = exact ? key4(want) : key3(want);
    for (let i = 0; i < preds.length; i++) {
      if (used[i] || marks[i]) continue;
      if ((exact ? key4(preds[i]) : key3(preds[i])) === k) { marks[i] = true; return i; }
    }
    return -1;
  };

  // Exact first, so a prediction that gets all four right is never spent on a
  // truth row it only three-quarters matches.
  const hits = [], missed = [];
  for (const t of required) (take(t, true, used) >= 0 ? hits : missed).push(t);
  const bonus = [];
  for (const t of optional) if (take(t, true, used) >= 0) bonus.push(t);

  // Start-only, for the "how much of the loss is the end time" split. THIS
  // PASS DOES NOT CONSUME ANYTHING — it runs on a copy of the used-flags. A
  // prediction with the right start and the wrong end is still a wrong answer:
  // it has to stay in the leftovers so it costs precision and shows up in the
  // three-of-four list. Consuming it here (the first version did) quietly
  // credited an extractor for the field it got wrong.
  const shadow = used.slice();
  let startOnly = 0;
  for (const t of missed) if (take(t, false, shadow) >= 0) startOnly++;

  const leftover = preds.filter((_, i) => !used[i]);

  // A leftover that names a real meeting of this schedule which is NOT on this
  // image is the specific failure the corpus was built to expose.
  const offKeys = new Set(offImage.map(key4));
  const hallucinated = leftover.filter(p => offKeys.has(key4(p)));

  // A leftover that agrees with a required row on 3 of 4 is a near miss.
  const nearMiss = [];
  for (const p of leftover) {
    if (hallucinated.includes(p)) continue;
    let best = null;
    for (const t of required) {
      const n = agree(p, t);
      if (n === 3 && (!best || n > best.n)) best = { n, t, p };
    }
    if (best) nearMiss.push(best);
  }

  return {
    image: truthEntry.image,
    condition: truthEntry.condition,
    requiredTotal: required.length,
    hits: hits.length,
    misses: missed.length,
    startOnlyRecovered: startOnly,
    optionalTotal: optional.length,
    optionalHits: bonus.length,
    predictions: preds.length,
    falsePositives: leftover.length,
    hallucinations: hallucinated.length,
    nearMisses: nearMiss.length,
    nearMissDetail: nearMiss.slice(0, 8).map(b => ({
      predicted: b.p.building + ' ' + b.p.room + ' ' + b.p.day + ' ' +
        hhmm(b.p.start) + '-' + hhmm(b.p.end),
      truth: b.t.building + ' ' + b.t.room + ' ' + b.t.day + ' ' +
        hhmm(b.t.start) + '-' + hhmm(b.t.end),
      course: b.t.course,
    })),
    missedDetail: missed.map(t => t.course + ' ' + t.building + ' ' + t.room + ' ' +
      t.day + ' ' + hhmm(t.start) + '-' + hhmm(t.end)),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// RUNNING THE WHOLE CORPUS
// ══════════════════════════════════════════════════════════════════════════
export function loadCorpus(dir = CORPUS_DIR) {
  const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return { dir, truth, manifest };
}

/**
 * @param {(imagePath: string, meta: object) => Promise<object[]>} extract
 * @param {{name?: string, dir?: string, only?: string}} [opts]
 */
export async function runBench(extract, opts = {}) {
  const { dir, truth } = loadCorpus(opts.dir);
  const rows = [];
  for (const entry of truth.images) {
    if (opts.only && !entry.image.includes(opts.only)) continue;
    const p = path.join(dir, entry.image);
    const meta = { file: entry.image, path: p, bytes: fs.statSync(p).size };
    let preds = [];
    let error = null;
    const t0 = Date.now();
    try {
      preds = (await extract(p, meta)) || [];
    } catch (e) {
      error = e && e.message ? e.message : String(e);
    }
    const row = scoreImage(entry, preds);
    row.ms = Date.now() - t0;
    row.error = error;
    rows.push(row);
  }

  const sum = (f, filter = () => true) =>
    rows.filter(filter).reduce((a, r) => a + f(r), 0);

  const byCondition = {};
  for (const c of CONDITIONS) {
    const f = r => r.condition === c;
    if (!rows.some(f)) continue;
    byCondition[c] = {
      images: rows.filter(f).length,
      requiredTotal: sum(r => r.requiredTotal, f),
      hits: sum(r => r.hits, f),
      misses: sum(r => r.misses, f),
      optionalHits: sum(r => r.optionalHits, f),
      falsePositives: sum(r => r.falsePositives, f),
      hallucinations: sum(r => r.hallucinations, f),
      nearMisses: sum(r => r.nearMisses, f),
    };
    const b = byCondition[c];
    b.recall = b.requiredTotal ? b.hits / b.requiredTotal : null;
  }

  const requiredTotal = sum(r => r.requiredTotal);
  const hits = sum(r => r.hits);
  const preds = sum(r => r.predictions);
  const fps = sum(r => r.falsePositives);

  return {
    name: opts.name || 'extractor',
    corpus: { dir, images: rows.length, requiredTotal },
    overall: {
      requiredTotal,
      hits,
      misses: sum(r => r.misses),
      recall: requiredTotal ? hits / requiredTotal : null,
      predictions: preds,
      precision: preds ? (preds - fps) / preds : null,
      falsePositives: fps,
      hallucinations: sum(r => r.hallucinations),
      nearMisses: sum(r => r.nearMisses),
      startOnlyRecovered: sum(r => r.startOnlyRecovered),
      optionalTotal: sum(r => r.optionalTotal),
      optionalHits: sum(r => r.optionalHits),
      errors: rows.filter(r => r.error).length,
      totalMs: sum(r => r.ms),
    },
    byCondition,
    byImage: rows,
  };
}

const pct = v => v == null ? '  -- ' : (v * 100).toFixed(1).padStart(5) + '%';

export function report(res) {
  const o = res.overall;
  const L = [];
  L.push('');
  L.push('image-bench  ' + res.name + '   (' + res.corpus.images + ' images, ' +
    o.requiredTotal + ' scored meetings)');
  L.push('');
  L.push('  ALL FOUR FIELDS RIGHT   ' + o.hits + ' / ' + o.requiredTotal + '   ' +
    pct(o.recall));
  L.push('  precision               ' + pct(o.precision) + '   (' + o.predictions +
    ' predictions, ' + o.falsePositives + ' matched nothing)');
  L.push('  hallucinations          ' + o.hallucinations +
    '   (a real class of this schedule, but not on this image)');
  L.push('  three-of-four near miss ' + o.nearMisses +
    '   (scored as misses; listed here so you can see which field)');
  L.push('  end-time-only losses    ' + o.startOnlyRecovered +
    '   (of the ' + o.misses + ' misses, this many had the right start)');
  L.push('  optional (cut) meetings ' + o.optionalHits + ' / ' + o.optionalTotal +
    '   (credit only, never a penalty)');
  if (o.errors) L.push('  EXTRACTOR THREW on      ' + o.errors + ' image(s)');
  L.push('');
  L.push('  by condition');
  L.push('    ' + 'condition'.padEnd(15) + 'imgs'.padStart(5) + 'right'.padStart(7) +
    'of'.padStart(6) + '  rate    false+  halluc');
  for (const [c, b] of Object.entries(res.byCondition)) {
    L.push('    ' + c.padEnd(15) + String(b.images).padStart(5) +
      String(b.hits).padStart(7) + String(b.requiredTotal).padStart(6) + '  ' +
      pct(b.recall) + String(b.falsePositives).padStart(8) +
      String(b.hallucinations).padStart(8));
  }
  L.push('');
  L.push('  by image');
  for (const r of res.byImage) {
    L.push('    ' + r.image.padEnd(34) + String(r.hits).padStart(4) + ' /' +
      String(r.requiredTotal).padStart(4) + '   ' + pct(r.requiredTotal ? r.hits / r.requiredTotal : null) +
      '   false+ ' + String(r.falsePositives).padStart(3) +
      (r.error ? '   ERROR: ' + r.error : ''));
  }
  L.push('');
  return L.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════
// SELF-TEST — because a scorer that says 100% to everything is the failure
// ══════════════════════════════════════════════════════════════════════════
/**
 * Three built-in extractors, run against the real corpus:
 *
 *   oracle     reads truth.json and returns the required rows in a DIFFERENT
 *              shape from the one truth stores them in — combined "WEL 2.224"
 *              location, UT day letters, "9:30 am" times — so a pass proves
 *              the normalisation actually does its job rather than proving
 *              that a string equals itself.
 *   sloppy     the oracle with one digit changed in every room. Every row is
 *              three-of-four. Must score 0.
 *   greedy     the oracle plus every meeting the crops cut off. Must keep full
 *              recall and lose precision, and the extra rows must be counted as
 *              hallucinations rather than as ordinary wrong answers.
 *
 * If any of those three does not behave, this file cannot be trusted to judge
 * a real comparison and it says so and exits 1.
 */
function selfTestExtractors(truth) {
  const byImage = new Map(truth.images.map(e => [e.image, e]));
  const asUt = c => ({
    location: c.building + ' ' + c.room,
    days: { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'Th', Fri: 'F' }[c.day],
    start: ampm(c.start), end: ampm(c.end),
  });
  const ampm = s => {
    const [h, m] = s.split(':').map(Number);
    const hh = h % 12 === 0 ? 12 : h % 12;
    return hh + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm');
  };
  return {
    oracle: (p, meta) => byImage.get(meta.file).classes.filter(c => c.required).map(asUt),
    sloppy: (p, meta) => byImage.get(meta.file).classes.filter(c => c.required)
      .map(c => asUt({ ...c, room: c.room.replace(/\d(?=[^\d]*$)/, d => (Number(d) + 1) % 10) })),
    greedy: (p, meta) => {
      const e = byImage.get(meta.file);
      return e.classes.filter(c => c.required).map(asUt)
        .concat((e.notOnImage || []).map(asUt));
    },
    // The parser lane's own shape, to prove `expand()` reads it: a bare code,
    // a day ARRAY, and times as minutes past midnight.
    parserShape: (p, meta) => byImage.get(meta.file).classes.filter(c => c.required)
      .map(c => ({
        code: c.building, room: c.room, days: [c.day],
        startMin: parseTime(c.start), endMin: parseTime(c.end),
      })),
    // Right start, wrong end, everything else right. Must score zero and must
    // NOT be forgiven by the start-only diagnostic.
    lateEnd: (p, meta) => byImage.get(meta.file).classes.filter(c => c.required)
      .map(c => ({
        building: c.building, room: c.room, day: c.day,
        start: c.start, end: hhmm(parseTime(c.end) + 15),
      })),
  };
}

async function selfTest(dir) {
  const { truth } = loadCorpus(dir);
  const ex = selfTestExtractors(truth);
  const out = [];
  const oracle = await runBench(ex.oracle, { name: 'selftest:oracle', dir });
  const sloppy = await runBench(ex.sloppy, { name: 'selftest:sloppy', dir });
  const greedy = await runBench(ex.greedy, { name: 'selftest:greedy', dir });
  const parser = await runBench(ex.parserShape, { name: 'selftest:parserShape', dir });
  const late = await runBench(ex.lateEnd, { name: 'selftest:lateEnd', dir });

  const checks = [
    ['oracle scores every required meeting',
      oracle.overall.hits === oracle.overall.requiredTotal,
      oracle.overall.hits + '/' + oracle.overall.requiredTotal],
    ['oracle emits no false positives',
      oracle.overall.falsePositives === 0, String(oracle.overall.falsePositives)],
    ['a one-digit room error scores zero',
      sloppy.overall.hits === 0, String(sloppy.overall.hits)],
    ['...and is reported as three-of-four, not as silence',
      sloppy.overall.nearMisses === sloppy.overall.requiredTotal,
      sloppy.overall.nearMisses + '/' + sloppy.overall.requiredTotal],
    ['inventing off-image classes keeps recall',
      greedy.overall.hits === greedy.overall.requiredTotal,
      greedy.overall.hits + '/' + greedy.overall.requiredTotal],
    ['...and costs precision',
      greedy.overall.precision < 1, pct(greedy.overall.precision)],
    ['...and is counted as hallucination',
      greedy.overall.hallucinations > 0, String(greedy.overall.hallucinations)],
    ['a code + day-array + minutes shape scores the same',
      parser.overall.hits === oracle.overall.hits,
      parser.overall.hits + '/' + parser.overall.requiredTotal],
    ['right start, wrong end scores zero',
      late.overall.hits === 0, String(late.overall.hits)],
    ['...and still costs precision',
      late.overall.precision === 0, pct(late.overall.precision)],
    ['...and the start is credited only as a diagnostic',
      late.overall.startOnlyRecovered === late.overall.requiredTotal,
      late.overall.startOnlyRecovered + '/' + late.overall.requiredTotal],
    ['the corpus has all four conditions',
      CONDITIONS.every(c => oracle.byCondition[c]),
      Object.keys(oracle.byCondition).join(', ')],
  ];
  let bad = 0;
  out.push('');
  out.push('image-bench self-test');
  out.push('');
  for (const [what, ok, got] of checks) {
    if (!ok) bad++;
    out.push('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + what.padEnd(52) + got);
  }
  out.push('');
  out.push(bad ? '  ' + bad + ' CHECK(S) FAILED — this scorer cannot judge a comparison.'
                : '  all checks pass.');
  out.push('');
  console.log(out.join('\n'));
  console.log(report(oracle));
  return bad === 0;
}

// ── CLI ───────────────────────────────────────────────────────────────────
const VALUE_FLAGS = new Set(['--dir', '--name', '--json', '--only']);

/** argv -> { flags, positional }. A flag's value is never mistaken for the module. */
function parseArgs(args) {
  const flags = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) { flags[a] = args[++i]; continue; }
    if (a.startsWith('--')) { flags[a] = true; continue; }
    positional.push(a);
  }
  return { flags, positional };
}

async function cli(argv) {
  const { flags, positional } = parseArgs(argv.slice(2));
  const flag = n => (typeof flags[n] === 'string' ? flags[n] : null);
  const dir = flag('--dir') || CORPUS_DIR;

  if (flags['--selftest']) {
    process.exit((await selfTest(dir)) ? 0 : 1);
  }
  const mod = positional[0];
  if (!mod) {
    console.error([
      'Usage: node image-bench.mjs <extractor.mjs> [--name ours] [--json out.json] [--only 05]',
      '       node image-bench.mjs --selftest',
      '',
      'The extractor module default-exports  (imagePath, meta) => predictions[].',
    ].join('\n'));
    process.exit(2);
  }
  const url = pathToFileURL(path.resolve(mod)).href;
  const loaded = await import(url);
  const fn = loaded.default || loaded.extract;
  if (typeof fn !== 'function') {
    console.error(mod + ' must default-export a function (imagePath, meta) => predictions[]');
    process.exit(2);
  }
  const res = await runBench(fn, { name: flag('--name') || path.basename(mod), dir, only: flag('--only') });
  console.log(report(res));
  const json = flag('--json');
  if (json) {
    fs.writeFileSync(json, JSON.stringify(res, null, 2));
    console.log('wrote ' + json);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  cli(process.argv).catch(e => { console.error(e); process.exit(1); });
}
