/**
 * corpus.mjs — build the fifteen schedule images, truth.json and manifest.json.
 *
 *   cd scripts/verify && node schedule-images/tools/corpus.mjs
 *
 * HOW EVERY IMAGE IS MADE, in one sentence, because the manifest says it and
 * this is where it is true: a hand-written HTML mock (tools/pages.mjs) is
 * rendered in headless Chrome, screenshotted, and then — for the angled and
 * cropped conditions only — put through tools/photo.py, which warps, blurs,
 * glares, crops and JPEG-compresses it with Pillow. NO CAMERA IS INVOLVED
 * ANYWHERE. Nothing here is a photograph and nothing here is a screenshot of
 * UT's real registration system or of real Google Calendar.
 *
 * WHY TRUTH IS NOT HAND-TYPED. Each element that shows a meeting carries
 * `data-meet`. This script measures those boxes in the live page, intersects
 * them with the crop rectangle, and derives whether each meeting is fully on
 * the image, partly on it, or off it. A hand-typed answer key for a crop is a
 * guess about a pixel boundary; this is the boundary. (The images were then
 * looked at, one by one, to confirm the derived call matches what a human can
 * actually read — see README.md.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { launch } from '../../chrome.mjs';
import { SCHEDULES, meetings } from './schedules.mjs';
import { PAGE_BUILDERS } from './pages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');                       // schedule-images/
const SCRATCH = process.env.CORPUS_SCRATCH ||
  path.join(OUT, '.build');                                 // PNGs, never committed

// ── taste: how big and how compressed each family of image ends up ─────────
const ENCODE = {
  clean:  { maxw: 1400, quality: 80 },
  phone:  { maxw: 800,  quality: 82 },
  // A real phone shoots 3000+ px wide. 1150 was under-sampling the render on
  // top of every other degradation, which is a difficulty the feature will not
  // meet in practice; the whole corpus is under a quarter of its 4 MB budget,
  // so there is no reason to buy realism back with resolution.
  photo:  { maxw: 1400, quality: 78 },
  crop:   { maxw: 1300, quality: 80 },
};

// ══════════════════════════════════════════════════════════════════════════
// THE PLAN — fifteen images across four conditions.
//
// `cond` is the ONE condition an image is filed under for the per-condition
// score. `also` names conditions it additionally exercises (11 is a dark
// screen photographed at an angle; 15 is a dark screen cropped). Both are in
// the manifest; only `cond` decides which bucket the scorer counts it in.
// ══════════════════════════════════════════════════════════════════════════
const PLAN = [
  // ── clean exports ───────────────────────────────────────────────────────
  { id: '01', file: '01-ut-table-clean.jpg', cond: 'clean-export',
    sched: 's1', style: 'ut-table', theme: 'light', vp: [1280, 520], dsf: 2,
    enc: 'clean',
    what: 'A straight full-quality screenshot of the registrar-style course table.' },

  { id: '02', file: '02-gcal-week-clean.jpg', cond: 'clean-export',
    sched: 's2', style: 'gcal', theme: 'light', vp: [1440, 748], dsf: 2,
    enc: 'clean',
    what: 'A straight full-quality screenshot of a Google-Calendar-style week grid.' },

  { id: '03', file: '03-ut-cards-phone-clean.jpg', cond: 'clean-export',
    sched: 's3', style: 'ut-cards', theme: 'light', vp: [390, 844], dsf: 2, full: true,
    enc: 'phone',
    what: 'A phone-width scrolling screenshot of the same schedule as stacked cards, full quality.' },

  { id: '04', file: '04-gcal-week-clean-dense.jpg', cond: 'clean-export',
    sched: 's1', style: 'gcal', theme: 'light', vp: [1440, 748], dsf: 2,
    enc: 'clean',
    what: 'The densest week in the corpus — 14 meetings — as a clean week-grid screenshot.' },

  // ── angled phone photos ─────────────────────────────────────────────────
  { id: '05', file: '05-ut-table-angled-left.jpg', cond: 'angled-photo',
    sched: 's1', style: 'ut-table', theme: 'light', vp: [1280, 520], dsf: 2,
    enc: 'photo',
    // WHY THE ANGLE CAME DOWN FROM yaw -23 / pitch 9 / dist 2.35. A table row
    // is 1280 px of horizontal association, and at that angle the left end of
    // a row projected more than half a row-pitch below its own right end — so
    // "M 340L" lined up with the row ABOVE its own room. Every field was still
    // on the image, so the derived truth said all six rows were scorable, and
    // a careful human could not have got them right. Angles that keep a row
    // recognisably a row; the defocus and the glare do the difficulty.
    photo: { canvas: [1500, 1080], yaw: -17, pitch: 5, roll: -1.4, dist: 3.1,
             blur: 0.9, blurGrad: [1, 0.15], blurGradMax: 2.2,
             glare: [{ cx: 0.24, cy: 0.2, rx: 0.5, ry: 0.42, s: 0.4 }],
             wb: [1.05, 1.0, 0.93], noise: 3.4, vignette: 0.3, moire: 0.02,
             gamma: 1.06, bg: [26, 24, 22] },
    what: 'Same table as image 01, re-photographed: the screen is turned away to the ' +
          'left, the far edge is out of focus, a soft window reflection sits over the ' +
          'top-left, indoor warm white balance, sensor noise, JPEG at 74.' },

  { id: '06', file: '06-gcal-angled-right.jpg', cond: 'angled-photo',
    sched: 's2', style: 'gcal', theme: 'light', vp: [1440, 748], dsf: 2,
    enc: 'photo',
    photo: { canvas: [1500, 1020], yaw: 20, pitch: -7, roll: 1.9, dist: 2.5,
             blur: 0.8, blurGrad: [-1, 0.2], blurGradMax: 1.9,
             glare: [{ cx: 0.72, cy: 0.62, rx: 0.42, ry: 0.5, s: 0.3 }],
             wb: [0.96, 0.99, 1.07], noise: 4.0, vignette: 0.34, moire: 0.035,
             gamma: 1.02, bg: [22, 24, 29] },
    what: 'Same week grid as image 02, shot from the right of the monitor with a ' +
          'visible pixel-grid moire, cool office white balance and camera shake.' },

  { id: '07', file: '07-ut-cards-angled-blur.jpg', cond: 'angled-photo',
    sched: 's3', style: 'ut-cards', theme: 'light', vp: [390, 844], dsf: 2, full: true,
    enc: 'photo',
    // Gentler than it was. At yaw -14 / pitch 11 / dist 2.2 the card's own
    // horizontal rows projected steeply enough that a label and its value no
    // longer looked like they were on the same line — a difficulty the feature
    // will never meet in the wild, and one that made the image unfair rather
    // than hard.
    photo: { canvas: [1000, 1400], yaw: -11, pitch: 6, roll: 2.6, dist: 3.0,
             blur: 1.15, blurGrad: [0.6, 0.25], blurGradMax: 2.1,
             glare: [{ cx: 0.4, cy: 0.12, rx: 0.55, ry: 0.3, s: 0.32 }],
             wb: [1.06, 1.0, 0.9], noise: 5.0, vignette: 0.36, moire: 0.0,
             gamma: 1.1, bg: [30, 27, 24] },
    what: 'A phone held at an angle and photographed slightly out of focus — the ' +
          'worst-focus image in the corpus, and still readable by eye.' },

  { id: '08', file: '08-gcal-angled-glare.jpg', cond: 'angled-photo',
    sched: 's4', style: 'gcal', theme: 'light', vp: [1440, 748], dsf: 2,
    enc: 'photo',
    photo: { canvas: [1500, 1020], yaw: 12, pitch: 6, roll: -1.3, dist: 2.7,
             blur: 0.7, blurGrad: [1, 0.3], blurGradMax: 1.6,
             // 0.78 blew two classes clean off the top row, which would have
             // made truth.json claim four correct fields nobody could read.
             glare: [{ cx: 0.5, cy: 0.11, rx: 0.72, ry: 0.28, s: 0.55 },
                     { cx: 0.86, cy: 0.55, rx: 0.2, ry: 0.26, s: 0.32 }],
             wb: [1.03, 1.0, 0.97], noise: 3.0, vignette: 0.3, moire: 0.03,
             gamma: 1.0, bg: [24, 23, 25] },
    what: 'A strip light blown out across the top third of the screen — the glare, ' +
          'not the angle, is what this image tests.' },

  // ── dark mode ───────────────────────────────────────────────────────────
  { id: '09', file: '09-ut-table-dark-clean.jpg', cond: 'dark-mode',
    sched: 's2', style: 'ut-table', theme: 'dark', vp: [1280, 428], dsf: 2,
    splitRoom: true, enc: 'clean',
    what: 'Dark theme, clean screenshot, and the ONE layout in the corpus that puts ' +
          'the building code and the room number in two separate columns.' },

  { id: '10', file: '10-gcal-week-dark-clean.jpg', cond: 'dark-mode',
    sched: 's3', style: 'gcal', theme: 'dark', vp: [1440, 748], dsf: 2,
    enc: 'clean',
    what: 'Dark-theme week grid, clean screenshot: light text on dark everywhere ' +
          'except inside the event blocks, which stay light-on-colour.' },

  { id: '11', file: '11-gcal-dark-angled.jpg', cond: 'dark-mode', also: ['angled-photo'],
    sched: 's1', style: 'gcal', theme: 'dark', vp: [1440, 748], dsf: 2,
    enc: 'photo',
    photo: { canvas: [1500, 1020], yaw: -17, pitch: -9, roll: 2.1, dist: 2.4,
             blur: 1.0, blurGrad: [1, 0.2], blurGradMax: 2.1,
             // Sat over the 9:30 and 11:00 Tuesday blocks at s 0.9 and erased
             // both of them. A reflection this app cannot read through is not
             // a hard image, it is a wrong answer key. Moved up onto the day
             // headings, where it is still the brightest thing in the frame.
             glare: [{ cx: 0.30, cy: 0.20, rx: 0.26, ry: 0.28, s: 0.7 }],
             wb: [1.0, 1.0, 1.04], noise: 4.6, vignette: 0.3, moire: 0.06,
             gamma: 0.95, bg: [17, 17, 20] },
    what: 'A dark screen photographed at an angle. A dark panel is a mirror, so the ' +
          'window reflection is the brightest thing in the frame and it lands over ' +
          'the middle of the week.' },

  // ── partial crops ───────────────────────────────────────────────────────
  { id: '12', file: '12-ut-table-crop-top.jpg', cond: 'partial-crop',
    sched: 's1', style: 'ut-table', theme: 'light', vp: [1280, 520], dsf: 2,
    enc: 'crop', crop: { kind: 'top-through-row', row: 3, frac: 0.55 },
    what: 'The top of image 01 only. The cut runs through the middle of one table ' +
          'row, so that row is half a line of type and is scored as optional.' },

  { id: '13', file: '13-ut-table-crop-bottom.jpg', cond: 'partial-crop',
    sched: 's1', style: 'ut-table', theme: 'light', vp: [1280, 520], dsf: 2,
    enc: 'crop', crop: { kind: 'bottom-through-row', row: 2, frac: 0.45 },
    what: 'The bottom of image 01 only — no column headings at all, which is the ' +
          'case that makes a reader guess which column is the room.' },

  { id: '14', file: '14-gcal-crop-column.jpg', cond: 'partial-crop',
    sched: 's1', style: 'gcal', theme: 'light', vp: [1440, 748], dsf: 2,
    enc: 'crop', crop: { kind: 'right-through-block', frac: 0.16 },
    what: 'Image 04 with the Friday column cut through mid-word. The fraction was ' +
          'walked down twice by looking at the result: at 42% of the block the ' +
          'sliver still showed the whole time range and the whole room, so the ' +
          'condition was not being tested at all; at 22% the room survived and only ' +
          'the time was cut. At 16% Friday reads "GOV 312L / 10:00 am / WEL 2.22" and ' +
          '"PHY 303L / 1:00 pm - / PAI 3.02" — one room cut mid-string, one short ' +
          'enough to survive, and neither end time readable. Both Friday meetings are ' +
          'therefore optional in truth.json: credit for getting them, no penalty for ' +
          'refusing, and a hallucination if invented.' },

  { id: '15', file: '15-ut-cards-dark-crop-bottom.jpg', cond: 'partial-crop', also: ['dark-mode'],
    sched: 's4', style: 'ut-cards', theme: 'dark', vp: [390, 700], dsf: 2, full: true,
    enc: 'crop', crop: { kind: 'bottom-through-row', row: 1, frac: 0.5 },
    what: 'A dark phone screenshot with the top scrolled off — the crop condition and ' +
          'the dark condition at the same time.' },
];

// ── crop geometry, derived from the measured boxes ─────────────────────────
function cropRect(spec, boxes, pageW, pageH, dsf) {
  const els = boxes.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const pad = 14 * dsf;
  if (spec.kind === 'top-through-row') {
    const r = els[spec.row];
    const y = Math.round(r.y + r.h * spec.frac);
    return [0, 0, pageW, Math.min(pageH, y)];
  }
  if (spec.kind === 'bottom-through-row') {
    const r = els[spec.row];
    const y = Math.round(r.y + r.h * spec.frac);
    return [0, Math.max(0, y), pageW, pageH - Math.max(0, y)];
  }
  if (spec.kind === 'right-through-block') {
    // The rightmost column's blocks: cut through them, not between them.
    const maxX = Math.max(...els.map(e => e.x));
    const last = els.filter(e => Math.abs(e.x - maxX) < 4 * dsf)[0];
    const x = Math.round(last.x + last.w * spec.frac);
    return [0, 0, Math.min(pageW, x + pad), pageH];
  }
  throw new Error('unknown crop kind ' + spec.kind);
}

function overlapFrac(box, rect) {
  const [rx, ry, rw, rh] = rect;
  const ix = Math.max(0, Math.min(box.x + box.w, rx + rw) - Math.max(box.x, rx));
  const iy = Math.max(0, Math.min(box.y + box.h, ry + rh) - Math.max(box.y, ry));
  const a = box.w * box.h;
  return a > 0 ? (ix * iy) / a : 0;
}

// Anything at or above FULL is scored; anything at or above SEEN but below
// FULL is optional (credit if found, no penalty if missed); below SEEN the
// meeting is not on the image at all and emitting it is a hallucination.
const FULL = 0.995, SEEN = 0.2;

/**
 * Refuse to build a corpus that names a building this app does not know.
 *
 * "NEVER SILENTLY INVENT A BUILDING" applies to the benchmark before it applies
 * to the feature. A corpus with a made-up code in it would score every later
 * stage on a question the router cannot answer, and nobody would notice,
 * because the answer key and the image would agree with each other.
 *
 * Two sources, both files already in this repo: UT's own register snapshot, and
 * the two tables in `js/wayfind.js` that cover what the register misses (SSW on
 * campus, the ten at Pickle). Read out of the files rather than copied, so this
 * cannot go stale.
 */
function knownCodes() {
  // tools -> schedule-images -> verify -> scripts -> repo root
  const root = path.resolve(HERE, '../../../..');
  const reg = JSON.parse(fs.readFileSync(path.join(root, 'data/ut_buildings.json'), 'utf8'));
  const set = new Set(reg.buildings.map(b => String(b.ref).toUpperCase()));
  const src = fs.readFileSync(path.join(root, 'js/wayfind.js'), 'utf8');
  for (const block of ['CAMPUS_EXTRA', 'OFF_MAP']) {
    const m = new RegExp('const ' + block + ' = \\[([\\s\\S]*?)\\n  \\];').exec(src);
    if (!m) throw new Error('cannot find ' + block + ' in js/wayfind.js');
    for (const c of m[1].matchAll(/\['([A-Z0-9]{2,4})'/g)) set.add(c[1]);
  }
  return set;
}

function assertCodesAreReal() {
  const known = knownCodes();
  const bad = [];
  for (const s of Object.values(SCHEDULES)) {
    for (const c of s.classes) {
      if (!known.has(c.building)) bad.push(s.id + ' ' + c.course + ' -> ' + c.building);
    }
  }
  if (bad.length) {
    throw new Error('building codes this app does not know:\n  ' + bad.join('\n  '));
  }
  const used = new Set(Object.values(SCHEDULES).flatMap(s => s.classes.map(c => c.building)));
  console.log('building codes, all checked against data/ut_buildings.json + wayfind tables: ' +
    [...used].sort().join(' '));
  return [...used].sort();
}

async function main() {
  const codesUsed = assertCodesAreReal();
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await launch(chromium, { maxMs: 240000 });
  const jobs = [], truth = [], manifest = [];

  for (const p of PLAN) {
    const sched = SCHEDULES[p.sched];
    const build = PAGE_BUILDERS[p.style];
    const html = p.style === 'ut-table'
      ? build(sched, p.theme, !!p.splitRoom)
      : build(sched, p.theme);

    const ctx = await browser.newContext({
      viewport: { width: p.vp[0], height: p.vp[1] },
      deviceScaleFactor: p.dsf,
    });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const png = path.join(SCRATCH, p.id + '-base.png');
    await page.screenshot({ path: png, fullPage: !!p.full, type: 'png' });

    // Boxes in DEVICE pixels — the screenshot's own coordinate system.
    const boxes = await page.$$eval('[data-meet]', els => els.map(e => {
      const r = e.getBoundingClientRect();
      return { meet: e.getAttribute('data-meet'), x: r.x + window.scrollX,
               y: r.y + window.scrollY, w: r.width, h: r.height };
    }));
    const dim = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    await ctx.close();

    const dev = boxes.map(b => ({ meet: b.meet, x: b.x * p.dsf, y: b.y * p.dsf,
                                 w: b.w * p.dsf, h: b.h * p.dsf }));
    const pngW = (p.full ? dim.w : p.vp[0]) * p.dsf;
    const pngH = (p.full ? dim.h : p.vp[1]) * p.dsf;

    const rect = p.crop ? cropRect(p.crop, dev, pngW, pngH, p.dsf) : [0, 0, pngW, pngH];

    // ── every meeting of this schedule, filed by how much of it survived ──
    const ms = meetings(sched);
    const seen = new Map();
    for (const b of dev) for (const k of b.meet.split(',')) {
      seen.set(k, Math.max(seen.get(k) || 0, overlapFrac(b, rect)));
    }
    const rows = [], absent = [];
    for (const m of ms) {
      const f = seen.get(m.key) || 0;
      if (f >= SEEN) {
        rows.push({
          course: m.course, building: m.building, room: m.room,
          day: m.day, start: m.start, end: m.end,
          required: f >= FULL,
          visible: f >= FULL ? 'full' : 'partial',
          onImage: Number(f.toFixed(3)),
        });
      } else {
        absent.push({ course: m.course, building: m.building, room: m.room,
                      day: m.day, start: m.start, end: m.end,
                      onImage: Number(f.toFixed(3)) });
      }
    }

    const enc = ENCODE[p.enc];
    jobs.push({
      id: p.id, src: png, dst: path.join(OUT, p.file),
      op: p.photo ? 'photo' : (p.crop ? 'crop' : 'clean'),
      rect, photo: p.photo || null, maxw: enc.maxw, quality: enc.quality,
    });

    truth.push({
      image: p.file, condition: p.cond, alsoConditions: p.also || [],
      schedule: p.sched, classes: rows, notOnImage: absent,
    });

    manifest.push({
      image: p.file, condition: p.cond, alsoConditions: p.also || [],
      what: p.what,
      madeBy: p.photo
        ? 'HTML mock rendered in headless Chrome, then warped/blurred/glared in Pillow (tools/photo.py). Synthesized, not photographed.'
        : (p.crop
          ? 'HTML mock rendered in headless Chrome, then cropped in Pillow (tools/photo.py). Synthesized.'
          : 'HTML mock rendered in headless Chrome and JPEG-encoded. Synthesized, not a screenshot of any real product.'),
      surface: p.style === 'gcal' ? 'Google-Calendar-style week grid'
        : p.style === 'ut-table' ? 'UT-registrar-style course table'
        : 'UT course schedule as phone-width cards',
      theme: p.theme,
      sourceFixture: SCHEDULES[p.sched].source,
      sourceNote: SCHEDULES[p.sched].sourceNote,
      render: { viewport: p.vp, deviceScaleFactor: p.dsf, fullPage: !!p.full,
                basePixels: [pngW, pngH] },
      transform: p.photo
        ? { kind: 'perspective+defocus+glare+noise+jpeg', params: p.photo }
        : (p.crop ? { kind: 'crop', spec: p.crop, rectPixels: rect } : { kind: 'none' }),
      encode: { maxWidth: enc.maxw, jpegQuality: enc.quality },
    });
  }

  browser.__done();

  const jobFile = path.join(SCRATCH, 'jobs.json');
  fs.writeFileSync(jobFile, JSON.stringify(jobs, null, 2));
  const py = spawnSync(process.env.PYTHON || 'python',
    [path.join(HERE, 'photo.py'), jobFile], { stdio: 'inherit' });
  if (py.status !== 0) throw new Error('photo.py exited ' + py.status);

  // Final sizes come off the files that actually got written.
  let bytes = 0, meetTotal = 0, reqTotal = 0;
  for (let i = 0; i < PLAN.length; i++) {
    const f = path.join(OUT, PLAN[i].file);
    const st = fs.statSync(f);
    bytes += st.size;
    manifest[i].bytes = st.size;
    meetTotal += truth[i].classes.length;
    reqTotal += truth[i].classes.filter(c => c.required).length;
  }

  fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify({
    _what: 'The answer key. One entry per CLASS MEETING — a course on one day — ' +
      'because a schedule importer has to place a class on a day at a time to be ' +
      'useful. A TTh course is two entries. Four fields all correct (building, ' +
      'room, day, time) is one hit; three of four is a miss.',
    _fields: {
      required: 'true when the whole element is inside the image. These are what ' +
        'the score is out of.',
      visible: 'full or partial. A partial meeting is one the crop cut through: ' +
        'finding it earns credit, missing it costs nothing.',
      onImage: 'fraction of the element box inside the image, measured in the live ' +
        'page, not estimated.',
      notOnImage: 'meetings of the same schedule that this image does not show. ' +
        'Emitting one of these is a hallucination and the scorer counts it as such.',
    },
    _totals: { images: PLAN.length, scoredMeetings: reqTotal, meetingsOnImages: meetTotal },
    images: truth,
  }, null, 2));

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    _honesty: 'EVERY IMAGE IN THIS DIRECTORY IS SYNTHESIZED. No camera was used ' +
      'anywhere. Each one starts as a hand-written HTML mock rendered in headless ' +
      'Chrome; the angled ones are then put through a perspective warp, a graded ' +
      'defocus blur, a glare gradient, sensor noise and JPEG compression in Pillow. ' +
      'They are NOT screenshots of UT\'s registration system or of Google Calendar, ' +
      'and the "angled phone photos" are NOT photographs of a screen. What is real ' +
      'is the DATA: every building code, room, course number and time comes from ' +
      'this repo\'s own fixtures or from UT\'s building register.',
    _generator: 'scripts/verify/schedule-images/tools/corpus.mjs',
    _built: new Date().toISOString().slice(0, 10),
    _buildingCodes: codesUsed,
    _buildingCodesChecked:
      'The build refuses to run if any of these is not in data/ut_buildings.json ' +
      'or in the CAMPUS_EXTRA / OFF_MAP tables of js/wayfind.js. MER is the ' +
      'Pickle-campus code, on purpose: a schedule can name a building this app ' +
      'cannot walk you to, and the corpus has to contain that case.',
    _totalBytes: bytes,
    images: manifest,
  }, null, 2));

  console.log('wrote ' + PLAN.length + ' images, ' + (bytes / 1048576).toFixed(2) + ' MB total');
  console.log('scored meetings: ' + reqTotal + '  (+' + (meetTotal - reqTotal) + ' partial, optional)');
  for (const m of manifest) console.log('  ' + m.image + '  ' + (m.bytes / 1024).toFixed(0) + ' KB');
}

main().catch(e => { console.error(e); process.exit(1); });
