/**
 * dayview.mjs — the ruler for the walk feature's day plan.
 *
 * WHAT IT CHECKS, AND WHY EACH ONE IS HERE
 *
 *   1. THE DAY PLAN CANNOT DISAGREE WITH THE ANSWER BAR. Every walk row prints
 *      minutes and a distance. Those must be the SAME numbers `wayfindRoute()`
 *      returns for the same two ends, read off the rendered DOM and compared to
 *      the API, per leg. A day view that quietly rounds differently from the bar
 *      it feeds is the "two surfaces, two claims" failure this repo has already
 *      paid for twice (the stairs offer vs. the stairs button; the ruler vs. the
 *      router).
 *
 *   2. EXACTLY ONE ROW IS "NEXT", AND IT IS THE RIGHT ONE FOR THE CLOCK. Driven
 *      with `?dayat=HH:MM`, which freezes the clock, so this is a fact and not a
 *      picture of one afternoon.
 *
 *   3. THE PROBLEM CHIPS SAY WHAT THE ROUTER SAYS. A leg the router calls tight
 *      must carry a tight chip, a leg with stairs and no step-free alternative
 *      must say so, and a class in a building the app cannot reach must be named
 *      as unreachable rather than silently dropped.
 *
 *   4. THE FORCING FUNCTION, RE-VERIFIED RATHER THAN QUOTED. The eleven codes
 *      the brief names are re-probed from the running app every run: which of
 *      them the router refuses, and for each, whether UT's own surveyed door for
 *      it lies inside or outside the extent of the graph we route on. The
 *      Pickle claim and the SSW claim are therefore measurements here, not
 *      inherited assertions.
 *
 *   5. OFF STAYS OFF. `?clip=1` (and by extension `?autopilot=1`,
 *      `?sliderdemo=1`, which set the same class) must leave nothing of this
 *      surface visible, and a page with no `?walk=1` must not contain any of it
 *      at all.
 *
 * Usage:
 *   python scripts/serve.py 8914                     # from the repo root
 *   node scripts/verify/dayview.mjs 8914             # from scripts/verify
 *   node scripts/verify/dayview.mjs 8914 --shots ../../shots/si/dayview
 *   VERIFY_URL=http://127.0.0.1:8914 node scripts/verify/dayview.mjs
 *
 * Exit: 0 all gates pass, 1 a gate failed, 2 bad args.
 */
import { chromium } from 'playwright-core';
import { launch, BASE as DEFAULT_BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const argPort = argv.find(a => /^\d+$/.test(a));
const BASE = process.env.VERIFY_URL || (argPort ? `http://127.0.0.1:${argPort}` : DEFAULT_BASE);
const SHOTS = opt('--shots', null);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };

/** The eleven the brief names. Re-probed, never assumed. */
const CLAIMED_GAPS = ['BE1', 'BEG', 'EME', 'FS1', 'FSL', 'MER', 'PX3', 'ROC', 'SSW', 'SV1', 'TCB'];

/** Minutes tolerated between what a row PRINTS and what the router SAYS. Zero:
 *  the row is written from the same object, so any difference at all is a bug,
 *  not float noise. */
const EPS_MIN = 0;
/** Metres tolerated on the same comparison. fmtDist() rounds to two significant
 *  figures, so the row and the API agree to within that rounding and no more. */
const EPS_M = 0.06;      // 6 % — fmtDist's worst case at the bottom of a decade

let fails = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) { passes++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// Nine full page loads (three fixtures x two viewports, plus the three off-state
// pages). Each one waits out the veil on a machine that may have other lanes on
// it, so the watchdog is sized for the whole run rather than for one load.
const browser = await launch(chromium, { maxMs: 1500000 });

async function open(query, viewport) {
  const page = await browser.newPage({ viewport: viewport || DESK });
  await page.goto(`${BASE}/index.html?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  // Correctness, not speed: the auto-detect probe rewrites every graphics
  // setting ~11 s in (CLAUDE.md verification rule 10).
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
  return page;
}

/** JPEG, not PNG, and that is CLAUDE.md rule 12 rather than a preference: every
 *  worktree agent gets a full checkout of every tracked file, so a committed
 *  frame is multiplied by the number of live lanes. These are 1280x800 of mostly
 *  flat sky and a dark panel; at q72 they are about a tenth of the PNG. */
async function shot(page, name) {
  if (!SHOTS) return;
  const f = path.join(SHOTS, name.replace(/\.png$/, '.jpg'));
  // Screenshot twice, trust the second (CLAUDE.md verification rule 10).
  await page.screenshot({ path: path.join(SHOTS, '_tmp.jpg'), type: 'jpeg', quality: 72 });
  await page.screenshot({ path: f, type: 'jpeg', quality: 72 });
  try { fs.unlinkSync(path.join(SHOTS, '_tmp.jpg')); } catch (e) {}
  console.log(`       shot ${path.basename(f)}`);
}

/** What the panel actually rendered, read off the DOM rather than off the API
 *  that drew it — that is the whole point of the comparison in gate 1. */
async function readPanel(page) {
  return page.evaluate(() => {
    const p = document.getElementById('wf-day');
    if (!p || p.classList.contains('hidden')) return null;
    const rows = [...p.querySelectorAll('#wf-day-list > .wf-d-row')].map(r => {
      const walk = r.classList.contains('wf-d-walk');
      const chips = [...r.querySelectorAll('.wf-d-chip')].map(c => ({
        cls: [...c.classList].find(x => /^wf-d-/.test(x) && x !== 'wf-d-chip') || null,
        text: c.textContent.trim(),
      }));
      const t = (sel) => { const n = r.querySelector(sel); return n ? n.textContent.trim() : null; };
      return {
        type: walk ? 'walk' : 'class',
        next: r.classList.contains('next'),
        past: r.classList.contains('past'),
        picked: r.classList.contains('picked'),
        disabled: !!r.disabled,
        codes: [...r.querySelectorAll('.wf-d-code')].map(n => n.textContent.trim()),
        min: t('.wf-d-min'), dist: t('.wf-d-dist'), gap: t('.wf-d-gap'),
        course: t('.wf-d-course'), place: t('.wf-d-place'), room: t('.wf-d-room'),
        t1: t('.wf-d-t1'), t2: t('.wf-d-t2'), t3: t('.wf-d-t3'),
        bar: (() => {
          const b = r.querySelector('.wf-d-bar');
          if (!b) return null;
          const g = (s) => { const n = b.querySelector(s); return n ? n.style.width : null; };
          return { over: b.classList.contains('over'), lo: g('.wf-d-bar-lo'), hi: g('.wf-d-bar-hi'), ov: g('.wf-d-bar-ov') };
        })(),
        chips,
        h: Math.round(r.getBoundingClientRect().height),
      };
    });
    return {
      title: (document.getElementById('wf-day-title') || {}).textContent,
      count: (document.querySelector('.wf-d-count') || {}).textContent,
      checks: (document.querySelector('.wf-d-checks') || {}).textContent || null,
      unreach: (document.querySelector('.wf-d-unreach') || {}).textContent || null,
      foot: (document.getElementById('wf-day-foot') || {}).textContent,
      box: (() => { const b = p.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
      rows,
    };
  });
}

console.log(`dayview.mjs — ${BASE}`);

// ══════════════════════════════════════════════════════════════════════════
// GATE 4 (first, because everything else is built on it): the forcing function
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[gaps] the eleven codes, re-probed from the running app');
{
  const page = await open('walk=1&drift=0&intro=0');
  await page.waitForFunction(() => typeof window.wayfindRoute === 'function', null, { timeout: 60000 });
  await page.evaluate(() => window.wayfindRoute('WEL', 'MAI'));
  const res = await page.evaluate(async (codes) => {
    const out = {};
    for (const c of codes) {
      const hits = window.wayfindSearch(c);
      const known = !!hits.find(x => x.code === c);
      const r = await window.wayfindRoute('WEL', c);
      const ut = window.wayfindUTDoors(c);
      out[c] = { known, why: r.ok ? null : r.why, utDoors: ut ? ut.length : 0,
        lat: ut && ut[0] ? ut[0].lat : null, lon: ut && ut[0] ? ut[0].lon : null };
    }
    const mai = window.wayfindUTDoors('MAI')[0];
    return { out, mai };
  }, CLAIMED_GAPS);
  const R = 6371000, rad = d => d * Math.PI / 180;
  const hav = (a, b) => {
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  let far = 0, near = 0, unroutable = 0;
  for (const c of CLAIMED_GAPS) {
    const r = res.out[c];
    const km = r.lat == null ? null : hav([r.lat, r.lon], [res.mai.lat, res.mai.lon]) / 1000;
    if (r.why) unroutable++;
    if (km != null && km > 5) far++; else if (km != null) near++;
    console.log(`       ${c}  known=${r.known}  route=${r.why || 'ok'}  UT doors=${r.utDoors}` +
      (km == null ? '' : `  ${km.toFixed(2)} km from the Tower`));
  }
  ok('all eleven are still unroutable', unroutable === 11, `${unroutable}/11`);
  ok('ten of them are far off campus (Pickle claim)', far === 10, `${far} over 5 km`);
  ok('SSW is on main campus, not off it (the brief\'s second claim is FALSE)',
    near === 1 && res.out.SSW.utDoors > 0,
    `SSW has ${res.out.SSW.utDoors} UT-surveyed doors, ${(hav([res.out.SSW.lat, res.out.SSW.lon], [res.mai.lat, res.mai.lon]) / 1000).toFixed(2)} km from the Tower`);
  ok('every one of the eleven fails as "notfound", not "noroute"',
    CLAIMED_GAPS.every(c => res.out[c].why === 'notfound'),
    'the search index does not carry them at all');
  await page.close();
}

// ══════════════════════════════════════════════════════════════════════════
// GATES 1-3: the day plan itself
// ══════════════════════════════════════════════════════════════════════════
for (const [fixture, at] of [['tth', '10:50'], ['mwf', '09:55'], ['gaps', '10:50']]) {
  console.log(`\n[${fixture}] the day plan at ${at}`);
  const page = await open(`walk=1&day=${fixture}&dayat=${at}&drift=0&intro=0`);
  await page.waitForFunction(() => document.getElementById('wf-day') &&
    !document.getElementById('wf-day').classList.contains('hidden'), null, { timeout: 60000 });
  const panel = await readPanel(page);
  ok('the panel rendered', !!panel);
  if (!panel) { await page.close(); continue; }

  const walks = panel.rows.filter(r => r.type === 'walk');
  const classes = panel.rows.filter(r => r.type === 'class');
  const api = await page.evaluate((f) => window.wayfindDay(window.wayfindDayFixture(f)), fixture);
  ok('one row per class and one walk between each pair',
    classes.length === api.classes && walks.length === api.classes - 1,
    `${classes.length} classes, ${walks.length} walks`);

  // ── GATE 2 ───────────────────────────────────────────────────────────────
  const nextN = walks.filter(w => w.next).length;
  ok('exactly one walk is marked NEXT', nextN === 1, `${nextN} marked`);
  const atMin = (+at.split(':')[0]) * 60 + (+at.split(':')[1]);
  const apiWalks = api.rows.filter(r => r.type === 'walk');
  const apiClasses = api.rows.filter(r => r.type === 'class');
  let expect = -1;
  for (let i = 0; i < apiWalks.length; i++) {
    const dest = apiClasses[i + 1];
    if (atMin < dest.startMin + 5) { expect = i; break; }
  }
  ok('and it is the walk the clock says it is',
    expect >= 0 && walks[expect] && walks[expect].next,
    `expected leg ${expect + 1} (${apiWalks[expect] ? apiWalks[expect].from + '->' + apiWalks[expect].to : '-'})`);

  // ── GATE 1 ───────────────────────────────────────────────────────────────
  let drift = 0, checked = 0;
  for (let i = 0; i < apiWalks.length; i++) {
    const a = apiWalks[i], row = walks[i];
    if (a.status !== 'ok') {
      ok(`leg ${i + 1} ${a.from}->${a.to}: unroutable row is disabled and says why`,
        row.disabled && row.chips.length > 0, row.chips.map(c => c.text).join(' / '));
      continue;
    }
    const live = await page.evaluate(async ([f, t]) => {
      const r = await window.wayfindRoute(f, t);
      return { lo: r.lo, hi: r.hi, distM: r.distM };
    }, [a.from, a.to]);
    checked++;
    // The rule is written out again here rather than read off the page, for
    // the same reason walkmeter.mjs carries its own Dijkstra: a check that asks
    // the code what it meant to print is not a check. `Under N` is the answer
    // bar's own wording for a range whose fast end is zero (SAY.minWalkUnder).
    const printed = (row.min || '').trim();
    const want = live.lo === 0 ? 'Under ' + live.hi : live.lo + '–' + live.hi;
    if (printed !== want) { drift++; console.log(`       leg ${i + 1} prints ${JSON.stringify(printed)}, router says ${JSON.stringify(want)}`); }
    // the distance the row prints, back through fmtDist's own rounding
    const pd = (row.dist || '').trim();
    const asM = /km/.test(pd) ? parseFloat(pd) * 1000 : parseFloat(pd);
    const rel = Math.abs(asM - live.distM) / live.distM;
    if (!(rel <= EPS_M)) { drift++; console.log(`       leg ${i + 1} prints ${pd}, router says ${Math.round(live.distM)} m`); }
  }
  ok('every walk row prints the router\'s own minutes and distance',
    drift === 0, `${checked} legs checked, ${drift} disagreements`);
  ok('at least one routable leg was actually compared', checked > 0,
    checked ? '' : 'this fixture has no routable leg, so gate 1 proved nothing on it');

  // ── GATE 3 ───────────────────────────────────────────────────────────────
  let chipMiss = 0;
  for (let i = 0; i < apiWalks.length; i++) {
    const a = apiWalks[i], row = walks[i];
    const have = new Set(row.chips.map(c => (c.cls || '').replace('wf-d-', '')));
    for (const p of a.problems) {
      const want = { late: 'late', tight: 'tight', stairsOnly: 'stairsOnly', stairs: 'stairs',
        signals: 'signals', noroute: 'off', offmap: 'off', unknown: 'off', nodoor: 'off' }[p];
      if (want && !have.has(want)) { chipMiss++; console.log(`       leg ${i + 1} is ${p} and has no ${want} chip`); }
    }
    if (!a.problems.length && row.chips.length) {
      chipMiss++; console.log(`       leg ${i + 1} has no problem and ${row.chips.length} chips`);
    }
  }
  ok('the chips on a row are exactly the problems the router found', chipMiss === 0);
  // The time gutter is one clock all the way down: a walk row shows the END of
  // the class it leaves, so the column never has a hole in it.
  const fmt = (m) => { let hh = Math.floor(m / 60) % 12; if (!hh) hh = 12; return hh + ':' + String(m % 60).padStart(2, '0') + (Math.floor(m / 60) >= 12 ? 'pm' : 'am'); };
  ok('every walk row carries the time the class before it ends',
    walks.every((w, i) => w.t3 === fmt(apiClasses[i].endMin)),
    walks.map(w => w.t3).join(' '));
  const nProblem = apiWalks.filter(w => w.problems.length).length;
  ok('the header counts the walks with something to check',
    nProblem === 0 ? panel.checks == null : /^\d+/.test(panel.checks || '') && +String(panel.checks).match(/^\d+/)[0] === nProblem,
    `${nProblem} of ${apiWalks.length} — header: ${JSON.stringify(panel.checks)}`);
  ok('a day holding a building we cannot reach says so at the top',
    (api.unreachable > 0) === !!panel.unreach,
    `${api.unreachable} unreachable — header: ${JSON.stringify(panel.unreach)}`);

  // NEVER REASSURE (docs/walk/what-we-can-honestly-say.md §15). No row anywhere
  // may tell a student they have time.
  const body = await page.evaluate(() => document.getElementById('wf-day').textContent);
  const banned = /\bspare\b|\byou'?ll make it\b|\bplenty of time\b|\benough time\b|\bin time\b|\beasy\b|\bno rush\b/i;
  ok('nothing on this surface promises you will make it', !banned.test(body),
    banned.test(body) ? JSON.stringify(body.match(banned)[0]) : '');

  // Picking a leg drives the SAME single-leg answer bar that already shipped.
  const pickIdx = apiWalks.findIndex(w => w.status === 'ok');
  if (pickIdx >= 0) {
    await page.evaluate((i) => {
      const rows = [...document.querySelectorAll('#wf-day-list > .wf-d-walk')];
      rows[i].click();
    }, pickIdx);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      pill: !document.getElementById('wf-pill').classList.contains('hidden'),
      head: document.getElementById('wf-headline').textContent,
      from: document.getElementById('wf-from').value,
      to: document.getElementById('wf-to').value,
      drawn: !!(window.__map.getSource && window.__map.getSource('wayfind-route')),
      picked: [...document.querySelectorAll('#wf-day-list > .wf-d-walk')].filter(r => r.classList.contains('picked')).length,
      dayStillOpen: !document.getElementById('wf-day').classList.contains('hidden'),
    }));
    const a = apiWalks[pickIdx];
    // The bar's own phrasing, not the row's: `Under N min walk` when the fast
    // end is zero (SAY.minWalkUnder), `lo-hi min walk` otherwise. Checking the
    // BAR says the same thing the ROW does is the point of the gate.
    const wantHead = a.lo === 0 ? 'Under ' + a.hi + ' min walk' : a.lo + '-' + a.hi + ' min walk';
    ok('tapping a walk row draws that route through the shipped answer bar',
      after.pill && after.drawn && after.head.startsWith(wantHead),
      `${a.from}->${a.to} — headline: ${JSON.stringify(after.head)}`);
    ok('and the day plan stays open with that row marked, so you can switch legs',
      after.dayStillOpen && after.picked === 1);
  }

  await shot(page, `${fixture}-desktop.png`);
  await page.close();

  // the phone, because that is what he judges it on
  const ph = await open(`walk=1&day=${fixture}&dayat=${at}&drift=0&intro=0`, PHONE);
  await ph.waitForFunction(() => document.getElementById('wf-day') &&
    !document.getElementById('wf-day').classList.contains('hidden'), null, { timeout: 60000 });
  const pp = await readPanel(ph);
  ok('on a 390 px phone the panel is on screen and not cut off',
    pp && pp.box.x >= 0 && pp.box.x + pp.box.w <= PHONE.width && pp.box.y >= 0 &&
    pp.box.y + pp.box.h <= PHONE.height,
    pp ? `x${pp.box.x} y${pp.box.y} ${pp.box.w}x${pp.box.h}` : 'no panel');
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok('and nothing on the page scrolls sideways', !overflow);
  const smallTargets = await ph.evaluate(() => [...document.querySelectorAll('#wf-day-list > .wf-d-walk:not(:disabled)')]
    .map(r => Math.round(r.getBoundingClientRect().height)).filter(h => h < 44));
  ok('every pressable walk row is at least 44 px tall', smallTargets.length === 0,
    smallTargets.length ? 'short rows: ' + smallTargets.join(', ') : '');
  await shot(ph, `${fixture}-phone.png`);
  await ph.close();
}

// ══════════════════════════════════════════════════════════════════════════
// The end of the day. No row is next, and the panel has to SAY that rather
// than simply mark nothing — a panel with no marked row and no sentence reads
// as one that failed to work out which row was next.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[done] the same day, after the last class');
{
  const page = await open('walk=1&day=tth&dayat=16:30&drift=0&intro=0');
  await page.waitForFunction(() => document.getElementById('wf-day') &&
    !document.getElementById('wf-day').classList.contains('hidden'), null, { timeout: 60000 });
  const p = await readPanel(page);
  ok('no walk is marked next', p && p.rows.filter(r => r.next).length === 0);
  ok('and the panel says the day is behind you', !!(p && p.unreach && /behind you/i.test(p.unreach)),
    JSON.stringify(p && p.unreach));
  ok('every walk row is dimmed as past', p && p.rows.filter(r => r.type === 'walk').every(r => r.past));
  await shot(page, 'tth-done.png');
  await page.close();
}

// ══════════════════════════════════════════════════════════════════════════
// GATE 5: off stays off
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[off] the feature adds nothing when it has not been asked for');
{
  const page = await open('drift=0&intro=0');
  const bare = await page.evaluate(() => ({
    day: !!document.getElementById('wf-day'),
    btn: !!document.getElementById('wf-day-btn'),
    css: !!document.getElementById('wf-day-css'),
    root: !!document.getElementById('wf-root'),
    api: typeof window.wayfindDay,
  }));
  ok('no ?walk=1: no panel, no button, no stylesheet, no api',
    !bare.day && !bare.btn && !bare.css && !bare.root && bare.api === 'undefined',
    JSON.stringify(bare));
  await page.close();

  const clip = await open('walk=1&day=tth&dayat=10:50&clip=1&drift=0&intro=0');
  await clip.waitForFunction(() => document.getElementById('wf-day'), null, { timeout: 60000 });
  await clip.waitForTimeout(600);
  const vis = await clip.evaluate(() => {
    const seen = [];
    for (const id of ['wf-day', 'wf-day-btn']) {
      const n = document.getElementById(id);
      if (!n) continue;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) seen.push(id);
      for (const d of n.querySelectorAll('*')) {
        const dr = d.getBoundingClientRect(), dc = getComputedStyle(d);
        if (dc.display !== 'none' && dc.visibility !== 'hidden' && dr.width > 0 && dr.height > 0) { seen.push(id + ' > ' + (d.className || d.tagName)); break; }
      }
    }
    return seen;
  });
  ok('?clip=1 leaves nothing of the day plan on the frame', vis.length === 0, vis.join(', '));
  await shot(clip, 'clip-nothing.png');
  await clip.close();
}

console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'}  ${passes} ok, ${fails} failed`);
await browser.__done();
process.exit(fails === 0 ? 0 : 1);
