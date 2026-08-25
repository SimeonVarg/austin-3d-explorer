/**
 * confirm-line.mjs — WHERE THE LINE GOES, measured instead of chosen.
 *
 *   node confirm-line.mjs               # both passes, the sweep, the verdict
 *   node confirm-line.mjs --only 05     # one image, for a fast look
 *   node confirm-line.mjs --json out.json
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS FILE EXISTS FOR
 *
 * js/schedconfirm.js gives every extracted class a confidence and shows the
 * student anything under `CONF.askBelow`. That number is the whole feature: too
 * high and a student confirms all seven classes by hand and gives up; too low
 * and a wrong room is saved silently and they walk to the wrong building. It
 * cannot be argued into place. It has to be measured.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE HONEST DIFFICULTY, STATED UP FRONT
 *
 * The shipping pipeline scores 136 predictions on this corpus with ZERO wrong
 * answers (docs/img-extract.md). A threshold cannot be calibrated against
 * errors that are not there, and a sweep over a population with no errors in it
 * proves only that the line is not costing taps.
 *
 * So this runs the corpus TWICE:
 *
 *   STRICT — the shipping tune. Measures the COST: how many correct classes the
 *            line asks about needlessly.
 *   LOOSE  — the same engine, same images, same readers, with the four hard
 *            refusals the previous lane installed turned off through TUNE:
 *            the edge-of-crop guard, the class-length guard, the across-days
 *            room vote, and the quarter-hour snap. Those four guards are the
 *            reason the strict pass has no errors, so switching them off
 *            reproduces exactly the wrong answers they were built for — real
 *            OCR mistakes, from the real engine, on the real corpus, rather
 *            than errors invented to be caught. Measures the DANGER: how many
 *            wrong answers the line lets through unasked.
 *
 * A threshold that is cheap on STRICT and safe on LOOSE is the one to ship, and
 * neither pass on its own can tell you that.
 *
 * NO NETWORK, EVER. Same promise as everything else in this round: the images
 * are local JPEGs, they are handed to a page on 127.0.0.1 as data URLs, and the
 * OCR runs in a WebAssembly worker on this machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { session, importModule, closeSession, PAGE_APP } from './schedimg-extract.mjs';
import { loadCorpus, expand, normBuilding, normRoom, normDay, parseTime, hhmm }
  from './image-bench.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ══════════════════════════════════════════════════════════════════════════
   THE TWO PASSES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The four guards, off. Each line is a refusal js/schedimg.js makes today and
 * the wrong answer it was installed to prevent — see docs/img-extract.md.
 */
const LOOSE_TUNE = {
  // "WEL 2.22" — the left half of "WEL 2.224" — on image 14.
  geom: { edgeTouchPx: -5 },
  // "1:00am 12:30 pm": an 11.5-hour class from one eaten digit.
  judge: { minClassMin: 1, maxClassMin: 1440 },
  // "GDC 2.216" and its twin "GDC 2.236" on image 04, no longer made to agree,
  // and a block whose room did not read at all no longer borrowing one.
  grid: { agreeAcrossDays: false, snapMin: 5 },
};

const PASSES = [
  { id: 'strict', tune: null, what: 'the shipping tune' },
  { id: 'loose', tune: LOOSE_TUNE, what: 'four refusals switched off, to make errors to catch' },
];

/* ══════════════════════════════════════════════════════════════════════════
   TRUTH
   ══════════════════════════════════════════════════════════════════════════ */

const key4 = m => [m.building, m.room, m.day, m.start, m.end].join('|');

function truthKeys(entry) {
  const req = new Set(), all = new Set();
  const byKey = new Map();
  for (const c of entry.classes) {
    const m = {
      building: normBuilding(c.building), room: normRoom(c.room),
      day: normDay(c.day), start: parseTime(c.start), end: parseTime(c.end),
    };
    all.add(key4(m));
    if (c.required) req.add(key4(m));
    byKey.set(key4(m), { ...m, course: c.course });
  }
  return { req, all, byKey, rows: [...byKey.values()] };
}

/** Is this one prediction a fully-correct meeting of this image? */
function isRight(pred, tk) {
  for (const m of expand(pred)) if (tk.all.has(key4(m))) return true;
  return false;
}

/**
 * The three-of-four neighbour, if any: the truth row this prediction was
 * TRYING to be. It is what tells us whether the question's options contained
 * the right answer — the number that says whether a tap could have saved it.
 */
function nearestTruth(pred, tk) {
  let best = null;
  for (const m of expand(pred)) {
    for (const t of tk.rows) {
      let n = 0;
      if (m.building === t.building) n++;
      if (m.room === t.room) n++;
      if (m.day === t.day) n++;
      if (m.start === t.start && m.end === t.end) n++;
      if (n >= 3 && (!best || n > best.n)) best = { n, t, m };
    }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════
   ONE PASS OVER THE CORPUS, INSIDE THE REAL PAGE
   ══════════════════════════════════════════════════════════════════════════ */

async function runPass(s, corpus, pass, only) {
  await s.page.evaluate(async ([b, tuneJson]) => {
    const m = window.__schedimg || await import(b + '/js/schedimg.js');
    window.__schedimg = m;
    if (!window.__schedconfirm) {
      window.__schedconfirm = await import(b + '/js/schedconfirm.js');
      // THE MEASUREMENT HAS TO BE OF WHAT SHIPS. prepare() is what loads the
      // campus walking graph and the register, so review() without it measures
      // a configuration nobody runs — and would have scored the round that
      // introduced the confusable-neighbour check as costing nothing, because
      // the check would not have been switched on.
      window.__cfmctx = await window.__schedconfirm.prepare();
    }
    // Put the shipping tune back before applying a new one, so the passes are
    // independent of the order they run in.
    if (!window.__tune0) window.__tune0 = JSON.parse(JSON.stringify(m.TUNE));
    for (const [k, v] of Object.entries(window.__tune0)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(m.TUNE[k], v);
      else m.TUNE[k] = v;
    }
    if (tuneJson) {
      const patch = JSON.parse(tuneJson);
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(m.TUNE[k], v);
        else m.TUNE[k] = v;
      }
    }
  }, [s.base, pass.tune ? JSON.stringify(pass.tune) : null]);

  const out = [];
  for (const img of corpus.truth.images) {
    if (only && img.image.indexOf(only) < 0) continue;
    const file = path.join(corpus.dir, img.image);
    const url = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const res = await s.page.evaluate(async (u) => {
      // keepSheet is FALSE here on purpose: a canvas cannot cross out of the
      // page and this harness has no eyes anyway. The screen asks for it; the
      // measurement does not.
      const o = await window.__schedimg.extract(u, { keepSheet: false });
      const rev = window.__schedconfirm.review(o, window.__cfmctx);
      const lite = (c) => ({
        course: c.course, building: c.building, room: c.room, day: c.day,
        start: c.start, end: c.end,
        needsConfirm: c.needsConfirm, why: c.why,
        overall: c.score.overall, fields: c.score.fields, ask: c.ask,
        key: c.__key, group: c.__group,
      });
      return {
        layout: o.layout, source: o.source,
        classes: rev.classes.map(lite),
        questions: rev.questions.map(q => ({
          id: q.id, field: q.field, groupId: q.groupId, confidence: q.confidence,
          trusted: q.trusted, why: q.why, kind: q.kind,
          options: q.options.map(x => x.value),
          hasBox: !!q.box,
        })),
        recover: rev.recover.map(r => ({
          building: r.building, room: r.room, day: r.day,
          start: r.start, end: r.end, options: r.options.map(x => x.value),
          reason: r.reason,
        })),
        counts: rev.counts,
        // Proof, per image, that the cross-checks were LIVE for this number
        // rather than quietly absent.
        walkCheck: rev.walkCheck,
      };
    }, url);
    out.push({ image: img.image, condition: img.condition, ...res });
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SWEEP
   ══════════════════════════════════════════════════════════════════════════ */

const STEPS = [0.30, 0.40, 0.50, 0.60, 0.66, 0.72, 0.78, 0.84, 0.90, 0.95];

function sweep(perImage, corpus) {
  const rows = [];
  const joined = [];
  for (const im of perImage) {
    const entry = corpus.truth.images.find(x => x.image === im.image);
    const tk = truthKeys(entry);
    for (const c of im.classes) {
      const right = isRight(c, tk);
      const near = right ? null : nearestTruth(c, tk);
      joined.push({ image: im.image, condition: im.condition, cls: c, right, near,
        questions: im.questions.filter(q => q.groupId === c.group) });
    }
  }
  for (const t of STEPS) {
    let askedRight = 0, askedWrong = 0, quietRight = 0, quietWrong = 0;
    // TAPS ARE COUNTED PER QUESTION, NOT PER MEETING. A TTh course is two rows
    // and one question; counting it twice would make every threshold look
    // twice as expensive as it is.
    const tapped = new Set();
    for (const j of joined) {
      const asked = j.cls.overall < t;
      if (asked) {
        for (const q of j.questions) tapped.add(j.image + '|' + q.id);
        if (j.right) askedRight++; else askedWrong++;
      } else if (j.right) quietRight++; else quietWrong++;
    }
    rows.push({ t, askedRight, askedWrong, quietRight, quietWrong, taps: tapped.size,
      total: joined.length });
  }
  return { rows, joined };
}

/**
 * Of the wrong predictions the line DOES ask about, how many had the right
 * answer among the buttons? A question whose options do not contain the truth
 * is a question that costs a tap and fixes nothing.
 */
function optionCoverage(joined, t) {
  let asked = 0, covered = 0;
  const misses = [];
  for (const j of joined) {
    if (j.right || j.cls.overall >= t || !j.near) continue;
    asked++;
    const truth = j.near.t;
    const want = { building: truth.building, room: truth.room, day: truth.day,
      time: hhmm(truth.start) + '-' + hhmm(truth.end) };
    const hit = j.questions.some(q => {
      const w = want[q.field];
      if (w == null) return false;
      return q.options.some(o => String(o).toUpperCase() === String(w).toUpperCase());
    });
    if (hit) covered++;
    else misses.push({ image: j.image,
      got: j.cls.building + ' ' + j.cls.room + ' ' + j.cls.day + ' ' + j.cls.start + '-' + j.cls.end,
      truth: truth.building + ' ' + truth.room + ' ' + truth.day + ' ' +
        hhmm(truth.start) + '-' + hhmm(truth.end),
      askedAbout: j.questions.map(q => q.field).join(',') || '(none)' });
  }
  return { asked, covered, misses };
}

/* ══════════════════════════════════════════════════════════════════════════
   REPORT
   ══════════════════════════════════════════════════════════════════════════ */

function pct(a, b) { return b ? (100 * a / b).toFixed(1) + '%' : '—'; }

function report(id, what, perImage, corpus) {
  const { rows, joined } = sweep(perImage, corpus);
  const right = joined.filter(j => j.right).length;
  console.log('\n══ ' + id.toUpperCase() + ' — ' + what);
  console.log('   ' + joined.length + ' predictions over ' + perImage.length +
    ' images: ' + right + ' right, ' + (joined.length - right) + ' wrong');
  // WHICH CROSS-CHECKS WERE ACTUALLY LIVE FOR THIS NUMBER. A confidence model
  // measured with its strongest check switched off is a different model.
  const wc = (perImage[0] || {}).walkCheck || {};
  console.log('   cross-checks live: walking graph=' + !!wc.active +
    '  confusable neighbours=' + !!wc.neighbours + '  register names=' + !!wc.venue +
    (wc.source ? '  [' + wc.source + ']' : ''));
  console.log('');
  console.log('   line   asked  of which right  of which WRONG   quiet-and-WRONG   taps');
  for (const r of rows) {
    const asked = r.askedRight + r.askedWrong;
    console.log(
      '   ' + r.t.toFixed(2).padStart(5) +
      String(asked).padStart(7) +
      String(r.askedRight).padStart(16) +
      String(r.askedWrong).padStart(16) +
      String(r.quietWrong).padStart(18) +
      String(r.taps).padStart(7) +
      (r.quietWrong ? '   <- a wrong answer saved in silence' : ''));
  }
  return { rows, joined };
}

async function main() {
  const args = process.argv.slice(2);
  const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : null; })();
  const jsonOut = (() => { const i = args.indexOf('--json'); return i >= 0 ? args[i + 1] : null; })();

  const corpus = loadCorpus();
  const s = await session({ page: process.env.SCHEDIMG_PAGE || PAGE_APP });
  await importModule(s.page, s.base);

  const all = {};
  for (const pass of PASSES) {
    console.log('\nrunning ' + pass.id + ' (' + pass.what + ')');
    all[pass.id] = await runPass(s, corpus, pass, only);
  }

  const strict = report('strict', PASSES[0].what, all.strict, corpus);
  const loose = report('loose', PASSES[1].what, all.loose, corpus);

  console.log('\n══ THE VERDICT');
  const line = 0.72;
  const sRow = strict.rows.find(r => Math.abs(r.t - line) < 1e-9);
  const lRow = loose.rows.find(r => Math.abs(r.t - line) < 1e-9);
  const cov = optionCoverage(loose.joined, line);
  console.log('   at askBelow = ' + line.toFixed(2) + ':');
  console.log('     STRICT  ' + (sRow.askedRight + sRow.askedWrong) + ' of ' + sRow.total +
    ' classes asked about (' + pct(sRow.askedRight + sRow.askedWrong, sRow.total) + '), ' +
    sRow.taps + ' taps, ' + sRow.quietWrong + ' wrong answers saved in silence');
  console.log('     LOOSE   ' + (lRow.askedRight + lRow.askedWrong) + ' of ' + lRow.total +
    ' classes asked about, ' + lRow.askedWrong + ' of ' +
    (lRow.askedWrong + lRow.quietWrong) + ' wrong answers caught, ' +
    lRow.quietWrong + ' saved in silence');
  console.log('     the buttons contained the right answer on ' + cov.covered + ' of ' +
    cov.asked + ' wrong-and-asked classes (' + pct(cov.covered, cov.asked) + ')');
  if (cov.misses.length) {
    console.log('\n   asked about, and the right answer was NOT among the buttons:');
    for (const m of cov.misses.slice(0, 10)) {
      console.log('     ' + m.image.padEnd(34) + m.got + '  ->  ' + m.truth +
        '   [asked: ' + m.askedAbout + ']');
    }
  }

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ strict: all.strict, loose: all.loose }, null, 1));
    console.log('\nwrote ' + jsonOut);
  }
  await closeSession();
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  closeSession().then(() => process.exit(1), () => process.exit(1));
});
