/**
 * v2-film.mjs - the opening flight as a film (v2/film.js, behind ?film=1): the film plays over the canvas while the live city
 * loads for the flight's END under it, then the film goes away and the live city is there.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-film.mjs      (a real GPU: 1 minute; it is not in the CI run, see ci/checks.json)
 *
 * Why: the film replaces the live opening flight on the screens it is made for. If its hand-over breaks, a person is left with
 * a frozen picture over a city that does not answer, or with no opening at all. This check runs the three ways it can go, with a
 * small test clip (fixtures/film-test.mp4, 2.5 s, a test pattern) in the place of the real film (?filmsrc=):
 *   1. THE FILM PLAYS TO ITS END: the loading screen lifts, the flight's state is "film", the film is over the canvas, the names
 *      are hidden, the live camera stands at the flight's END (not its start) and the live flight does not run. After the clip
 *      the film is taken away, the state is "done" and the camera is still at the end.
 *   2. A PERSON TAKES THE CAMERA DURING THE FILM: the film is taken away at once, the state is "cancelled", and the live camera
 *      stands at the flight's pose of that moment (near the start for a clip this short), not at the end.
 *   3. THE FILM CANNOT BE PLAYED (a file that is not there): the film is dropped and the live camera is put back at the flight's start.
 * It does not judge the film's picture: that is the maker's job (scripts/verify/v2-film-frames.mjs) and the owner's eye.
 *
 * Any renderer. THE PAGE REPORTS ITS OWN STATE (four times a second, through a binding) and the check reads those reports; it
 * does not ask the page. On GitHub's software renderer a page that draws the live flight can be busy for minutes at a time and
 * does not answer a question, but what it reported before is there. ?filmwait= gives the page time to get the clip's first frame.
 * The page is opened with the small test tile set (?tiles=test): the film's hand-over does not depend on which buildings load,
 * and with the whole city a software renderer needs ten minutes a page.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
const base = BASE.replace(/\/$/, ''), CLIP = '../scripts/verify/fixtures/film-test.mp4';
const WAIT = '&filmwait=240000';   // (a software renderer needs more than the page's own 6 s to get the clip's first frame)
const browser = await launch(chromium, { maxMs: 1400000 });
const fails = [], ok = (c, m) => { console.log(`${c ? 'PASS' : '*FAIL'} ${m}`); if (!c) fails.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (q, more = '') => {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 480 } })).newPage();
  const errs = [], log = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.exposeFunction('__filmReport', (s) => { try { log.push(JSON.parse(s)); } catch (e) {} });
  await page.addInitScript(() => { setInterval(() => { const v = window.__v2; if (!v || !v.intro || !v.intro()) return;
    const I = v.INTRO, p = v.map.pose(), m = (a, b) => Math.hypot((a.lng - b[0]) * 96000, (a.lat - b[1]) * 111000), f = document.getElementById('film'), mk = document.getElementById('markers');
    let free = null; if (f) for (let y = 120; y < 400 && !free; y += 20) for (let x = 200; x < 760; x += 20) { const e = document.elementFromPoint(x, y); if (e && e.id === 'view') { free = [x, y]; break; } }
    window.__filmReport(JSON.stringify({ intro: v.intro().state, by: v.intro().cancelledBy, film: v.film() && v.film().state, el: !!f, t: f ? f.currentTime : -1, names: mk && +getComputedStyle(mk).opacity < 0.05 ? 'hidden' : 'visible',
      toStart: m(p.center, I.start.center), toEnd: m(p.center, I.end.center), easing: v.map.isEasing(), free })); }, 250); });
  // (not "load": a film element holds the page's load event back until its first frame is in, and on a software renderer that is late)
  await page.goto(`${base}/v2/?adapt=0&steady=0&tiles=test&film=1&filmsrc=${encodeURIComponent(q)}${more}`, { waitUntil: 'commit', timeout: 180000 });
  // wait until the page has reported a state that `want` accepts (or `ms` have gone by); the report, or null
  const until = async (want, ms) => { const t0 = Date.now(); for (;;) { const r = log.find(want); if (r) return r; if (Date.now() - t0 > ms) return null; await sleep(200); } };
  const last = () => log[log.length - 1] || {};
  return { page, errs, log, until, last };
};
const show = (r) => (r ? `flight "${r.intro}", film "${r.film}"` : 'no such report');

// 1. the film plays to its end
{ const { page, errs, log, until, last } = await open(CLIP, WAIT);
  const a = await until((r) => r.intro === 'film' && r.film === 'playing' && r.el, 500000);
  ok(!!a, `1. the film plays: ${show(a || last())}, the film is on the page ${!!(a && a.el)}`);
  ok(!!a && a.names === 'hidden', `1. the names are hidden under the film (${a && a.names})`);
  ok(!!a && a.toEnd < 5 && a.toStart > 500 && !a.easing, `1. the live camera stands at the flight's END under the film (${a ? a.toEnd.toFixed(0) : '?'} m from the end, ${a ? a.toStart.toFixed(0) : '?'} m from the start, flying ${a && a.easing})`);
  const n = log.length, b = await until((r) => log.indexOf(r) >= n && !r.el && r.film === 'done', 400000);
  ok(!!b && b.intro === 'done', `1. after the clip the film is gone: ${show(b || last())}, still on the page ${b ? b.el : last().el}`);
  const c = await until((r) => log.indexOf(r) >= n && !r.el && r.names === 'visible', 20000);
  ok(!!c && c.toEnd < 5, `1. the live city is at the flight's end, names shown (${c ? c.toEnd.toFixed(0) + ' m, ' + c.names : 'no such report'})`);
  ok(errs.length === 0, `1. no page errors (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await page.context().close().catch(() => {}); }

// 2. a person takes the camera during the film
{ const { page, errs, log, until, last } = await open(CLIP, WAIT);
  const a = await until((r) => r.intro === 'film' && r.el && r.t > 0.2 && r.free, 500000);
  // a point of the picture with no control over it: there the pointer must fall THROUGH the film to the canvas
  ok(!!a, `2. a pointer over the film reaches the canvas (at ${a && a.free})`);
  const [px, py] = (a && a.free) || [480, 240];
  await page.mouse.move(px, py); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(px + i * 6, py + i * 2); await sleep(30); }   // (a drag that lasts some frames, as a hand's does)
  await page.mouse.up();
  const b = await until((r) => !r.el && r.intro === 'cancelled', 60000);
  ok(!!b && b.by === 'input' && b.film === 'cancelled', `2. a drag during the film takes it away: ${show(b || last())} by "${(b || last()).by}", still on the page ${b ? b.el : last().el}`);
  ok(!!b && b.toStart < 800 && b.toEnd > 1500, `2. the live camera stands where the film was, at the flight's start and not at its end (it looks at a point ${b ? b.toStart.toFixed(0) : '?'} m from the start's, ${b ? b.toEnd.toFixed(0) : '?'} m from the end's; the drag itself turns the view)`);
  ok(errs.length === 0, `2. no page errors (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await page.context().close().catch(() => {}); }

// 3. the film cannot be played
{ const { page, errs, until, last } = await open('./film/not-there.mp4');
  const a = await until((r) => !r.el && r.film === null && r.toStart < r.toEnd, 600000);
  ok(!!a && ['primed', 'flying', 'done'].includes(a.intro), `3. with no film the flight is live as before: ${show(a || last())}, film on the page ${a ? a.el : last().el}, the camera is back on the flight's own path (${a ? a.toStart.toFixed(0) : '?'} m from the start, ${a ? a.toEnd.toFixed(0) : '?'} m from the end)`);
  ok(errs.length === 0, `3. no page errors (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await Promise.race([page.context().close().catch(() => {}), sleep(15000)]); }

await Promise.race([browser.close().catch(() => {}), sleep(15000)]);
console.log(fails.length ? `\n*FAIL ${fails.length} of the film's hand-overs` : '\nPASS the film plays, hands over, can be taken over, and is not needed');
process.exit(fails.length ? 1 : 0);
