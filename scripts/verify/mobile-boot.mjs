/**
 * mobile-boot.mjs — does a phone get the REAL buildings, every visit?
 *
 * WHY. Reported twice (HANDOFF "Sep 16 2026 — The phone shows the REAL
 * buildings") and again on 2026-09-19 with a phone screenshot: The Standard as
 * two plain pillars, campus as flat prisms with no pitched roofs. That is the
 * three.js layer OFF — js/mobile.js's safe profile (`slopes=0`) — on a phone
 * that never crashed. This script drives the boot counter and the profile
 * through the ways a real phone actually loads a page, on an emulated phone
 * (390x844 at DPR 3, isMobile, hasTouch, an iPhone user agent), and asserts the
 * visit ends with the authored meshes.
 *
 *   VERIFY_URL=http://127.0.0.1:8601 node mobile-boot.mjs [scenario ...] [--out DIR]
 *
 * SCENARIOS (default: all but `shots`)
 *   probe       one fresh visit: is the phone profile engaged at all?
 *               (matchMedia('(pointer: coarse)') true, LITE_PROFILE.on)
 *   returning   three ordinary visits in a row, then a reload. Every one must
 *               be the normal profile with the authored buildings.
 *   interrupt   three loads cut short (reload / navigate away / reload) at
 *               3-9 s, then a normal visit — which must be the normal profile.
 *   background  hidden + frozen mid-load, resumed; then a load that is killed
 *               WHILE HIDDEN (what iOS does to a background tab). Neither is
 *               a crash; the next visit must be normal.
 *   crash       two genuine renderer crashes mid-load (CDP Page.crash — no
 *               pagehide, no hidden: the WebKit memory kill), then a visit:
 *               it must fall back WITH a visible notice, and one tap on the
 *               notice must bring the full city back.
 *   legacy      a phone still carrying the pre-fix state: the old integer
 *               counter at 3 and the old auto-written URL
 *               `?lite=safe&slopes=0&campuslandscape=0&preset=performance`.
 *               It must recover by itself. A hand-typed `?lite=safe` must show
 *               the notice, and its button must restore the full city.
 *   landscape   the same phone at 844x390.
 *   desktop     1280x800, no touch: no profile, the URL untouched, no counter.
 *   crashloop   Safari's own recovery (2026-09-24 report): the renderer is
 *               killed DURING THE OPENING FLIGHT and the same URL loads again at
 *               once, the way Safari reloads a killed page one time by itself.
 *               That reload must be the `lighter` tier with the authored
 *               buildings, a notice, and no reload of its own; killed again
 *               (Safari's second kill: its error page, then the visitor's
 *               reload), the next load is the safe tier. Never a self-reload.
 *   contextloss the WebGL context lost and restored after load: the page must
 *               reload by itself and draw the authored buildings again.
 *   ctxintro    the WebGL context lost DURING THE OPENING FLIGHT: exactly one
 *               reload, onto the `lighter` tier with the authored buildings;
 *               lost again there, NO second reload - the notice instead.
 *   shots       The Standard, The Otis Hotel, Moody Center, 21 Rio, Icon,
 *               Villas on 24th and Moontower on the phone profile, each shot
 *               twice and the second kept (JPEG in --out).
 *
 * Exit code: 0 all asserted scenarios passed, 1 any failed.
 * Every browser launch in a shared session must be wrapped in the lane's
 * gpu-run.mjs; this script launches exactly one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const OUT = oi >= 0 ? argv[oi + 1] : (process.env.OUT || path.join(os.tmpdir(), 'mobile-boot'));
const picked = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
const ALL = ['probe', 'returning', 'interrupt', 'background', 'crash', 'crashloop', 'legacy', 'landscape', 'desktop', 'contextloss', 'ctxintro'];
const SCEN = picked.length ? picked : ALL;
fs.mkdirSync(OUT, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA };
const LAND = { ...PHONE, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } };
const DESK = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

// How long a finished visit is kept open before it is judged. js/mobile.js
// declares startup a success a settle window after the veil lifts (15 s), so
// the reading is taken after that — generous to the OLD code too, whose claim
// was "cleared when the veil lifts".
const SETTLE_MS = +(process.env.MOBILE_SETTLE_MS || 18000);
const REVEAL_MS = +(process.env.MOBILE_REVEAL_MS || 200000);
const WANT = ['The Standard', 'The Otis Hotel', 'Moody Center', '21 Rio', 'Icon', 'Villas on 24th', 'Moontower'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await launch(chromium, { gl: 'hardware', maxMs: +(process.env.VERIFY_MAX_MS || 3600000) });

function snap(page) {
  return page.evaluate(() => {
    let boot = null;
    try { boot = localStorage.getItem('flyover.boot'); } catch (e) {}
    const n = document.getElementById('lite-notice');
    const lp = window.LITE_PROFILE ? JSON.parse(JSON.stringify(window.LITE_PROFILE)) : null;
    let built = null;
    try { built = window.slopesApartments ? window.slopesApartments.built.map(b => b.name) : null; } catch (e) {}
    let hidden = null;
    try { hidden = window.slopesApartments ? window.slopesApartments.hidden.missing : null; } catch (e) {}
    return {
      search: location.search,
      coarse: matchMedia('(pointer: coarse)').matches,
      touch: navigator.maxTouchPoints,
      screen: [screen.width, screen.height],
      lite: lp,
      boot,
      slopesOn: !!(window.SLOPES && window.SLOPES.on),
      aptsOn: !!(window.APARTMENTS && window.APARTMENTS.on),
      preset: window.GFX ? window.GFX.preset : null,
      built, filterMissing: hidden,
      tris: window.slopes && window.slopes.stats ? window.slopes.stats().triangles : null,
      aptsBuildMs: window.slopesApartments ? window.slopesApartments.count.ms : null,
      intro: window.__intro ? { reason: window.__intro.reason, waitedMs: window.__intro.waitedMs, modelFallback: window.__intro.modelFallback || null, modelLate: window.__intro.modelLate || null } : null,
      notice: n ? { shown: getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0, text: n.innerText.replace(/\s+/g, ' ').trim() } : null,
    };
  });
}

async function waitReveal(page) {
  const t0 = Date.now();
  await page.waitForFunction(() => window.__intro && window.__intro.reason, null, { timeout: REVEAL_MS, polling: 250 });
  // On a phone the authored buildings may land AFTER the veil (js/mobile.js
  // LITE.lateAuthored). Judge what the visit ends up showing, not the frame
  // the veil lifted on.
  //
  // WAIT FOR `readyToReveal()`, NOT FOR `.group`. The group object appears when
  // the time-sliced build STARTS; `readyToReveal()` is false while `_building`
  // is in flight and until the filters, rigs and sources have caught up. Those
  // are not the same instant: on 2026-09-20, with three other GPU lanes on this
  // machine, one apartment build took 223 s, and `legacy: a reload after
  // recovery stays normal` read the scene 18 s after `.group` appeared, found
  // 5 of the 7 named buildings and called it a fallback. It was not one — the
  // same scenario is 3/3 green on reps of the same code — the instrument had
  // simply looked too early. `readyToReveal()` is also what the round's brief
  // says to wait on, and it returns true (rather than hanging) when the fetch
  // genuinely failed, so a real failure still reaches the assertion.
  await page.waitForFunction(() => !(window.SLOPES && window.SLOPES.on) || !(window.APARTMENTS && window.APARTMENTS.on) ||
    (window.slopesApartments && (window.slopesApartments.readyToReveal
      ? window.slopesApartments.readyToReveal()
      : !!window.slopesApartments.group)), null, { timeout: REVEAL_MS, polling: 500 }).catch(() => {});
  return Date.now() - t0;
}

async function visit(page, url, { settle = SETTLE_MS, how = 'goto' } = {}) {
  const t0 = Date.now();
  if (how === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  else await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()).catch(() => {});
  await waitReveal(page);
  const revealMs = Date.now() - t0;
  await sleep(settle);
  const s = await snap(page);
  s.revealMs = revealMs;
  return s;
}

async function crash(page) {
  const cdp = await page.context().newCDPSession(page);
  const crashed = new Promise(r => page.once('crash', r));
  cdp.send('Page.crash').catch(() => {});
  await Promise.race([crashed, sleep(8000)]);
}

async function setHidden(page, hidden) {
  // Headless Chrome keeps every page `visible`, so the visibility flip is
  // dispatched in the page (the same event iOS sends when the app goes to the
  // background), and the freeze is the real one: CDP suspends timers and tasks.
  await page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const short = s => ({
  search: s.search, on: s.lite && s.lite.on, safe: s.lite && s.lite.safe, reason: s.lite && s.lite.reason,
  applied: s.lite && s.lite.applied, boot: s.boot, slopesOn: s.slopesOn, aptsOn: s.aptsOn, preset: s.preset,
  built: s.built ? s.built.length : null, want: s.built ? WANT.filter(w => s.built.includes(w)).length + '/' + WANT.length : null,
  tris: s.tris, aptsBuildMs: s.aptsBuildMs, revealMs: s.revealMs, notice: s.notice, intro: s.intro,
});
const isFull = s => !!(s.lite && s.lite.on && !s.lite.safe && s.slopesOn && s.aptsOn && s.built && WANT.every(w => s.built.includes(w)));
const clean = s => !/(^|[?&])(lite|slopes|campuslandscape|preset)=/.test(s.search);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function withCtx(opts, fn) {
  const ctx = await browser.newContext(opts);
  try { return await fn(ctx); } finally { await ctx.close().catch(() => {}); }
}
function errsOf(page) {
  const e = [];
  page.on('pageerror', x => e.push(String(x.message || x).slice(0, 160)));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(BASE)) e.push(r.status() + ' ' + r.url().slice(BASE.length)); });
  return e;
}

const S = {};

S.probe = () => withCtx(PHONE, async ctx => {
  const page = await ctx.newPage();
  const errs = errsOf(page);
  const s = await visit(page, '/?drift=0');
  log('probe', JSON.stringify(short(s)));
  check('probe: coarse pointer in page', s.coarse, `touch=${s.touch} screen=${s.screen}`);
  check('probe: phone profile engaged', s.lite && s.lite.on, JSON.stringify(s.lite && s.lite.applied));
  check('probe: normal profile, authored buildings built', isFull(s), `${short(s).want} safe=${s.lite && s.lite.safe}`);
  check('probe: the address bar is the visitor\'s own', s.search === '?drift=0', s.search);
  check('probe: no 404 / page error', !errs.length, errs.slice(0, 4).join(' | '));
});

S.returning = () => withCtx(PHONE, async ctx => {
  const page = await ctx.newPage();
  const rows = [];
  for (let i = 1; i <= 3; i++) {
    const s = await visit(page, '/?drift=0');
    rows.push(s); log(`returning visit ${i}`, JSON.stringify(short(s)));
  }
  const r = await visit(page, '', { how: 'reload' });
  rows.push(r); log('returning reload', JSON.stringify(short(r)));
  rows.forEach((s, i) => check(`returning: ${i < 3 ? 'visit ' + (i + 1) : 'reload'} gets the authored buildings`, isFull(s), `safe=${s.lite && s.lite.safe} boot=${s.boot} search=${s.search} modelFallback=${s.intro && s.intro.modelFallback}`));
  check('returning: URL never carries lite/slopes/preset', rows.every(clean), rows.map(s => s.search).join(' , '));
});

S.interrupt = () => withCtx(PHONE, async ctx => {
  const page = await ctx.newPage();
  const cuts = [['reload', 3000], ['navigate', 6000], ['reload', 9000]];
  for (const [how, at] of cuts) {
    await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(at);
    const b = await page.evaluate(() => { try { return localStorage.getItem('flyover.boot'); } catch (e) { return null; } });
    if (how === 'reload') await page.reload({ waitUntil: 'commit' });
    else await page.goto('about:blank');
    log(`interrupt: ${how} at ${at} ms (boot key was ${b})`);
  }
  const s = await visit(page, '/?drift=0');
  log('interrupt: then a visit', JSON.stringify(short(s)));
  check('interrupt: three cut-short loads are not crashes', isFull(s), `safe=${s.lite && s.lite.safe} boot=${s.boot}`);
});

S.background = () => withCtx(PHONE, async ctx => {
  let page = await ctx.newPage();
  await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(5000);
  const cdp = await ctx.newCDPSession(page);
  await setHidden(page, true);
  let frozen = 'ok';
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(e => { frozen = e.message.slice(0, 80); });
  await sleep(10000);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await setHidden(page, false);
  await waitReveal(page);
  await sleep(SETTLE_MS);
  const a = await snap(page);
  log(`background: hidden+frozen 10 s mid-load (freeze: ${frozen}), resumed`, JSON.stringify(short(a)));
  check('background: resumed load finishes with the authored buildings', isFull(a), `boot=${a.boot}`);
  // Killed while hidden: iOS reclaims a background tab's process. Not a crash
  // of ours, and it must not count as one.
  await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(6000);
  await setHidden(page, true);
  await sleep(500);
  await crash(page);
  page = await ctx.newPage();
  const b = await visit(page, '/?drift=0');
  log('background: after a kill while hidden', JSON.stringify(short(b)));
  check('background: a tab killed while hidden is not a crash', isFull(b), `safe=${b.lite && b.lite.safe} boot=${b.boot}`);
  // And one more kill while hidden: two in a row still must not trip it.
  await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(6000); await setHidden(page, true); await sleep(500); await crash(page);
  await (async () => { page = await ctx.newPage(); await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 }); await sleep(6000); await setHidden(page, true); await sleep(500); await crash(page); })();
  page = await ctx.newPage();
  const c = await visit(page, '/?drift=0');
  log('background: after two more kills while hidden', JSON.stringify(short(c)));
  check('background: repeated background kills never trip the fallback', isFull(c), `safe=${c.lite && c.lite.safe} boot=${c.boot}`);
});

S.crash = () => withCtx(PHONE, async ctx => {
  let page = await ctx.newPage();
  for (let i = 1; i <= 2; i++) {
    await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(7000);
    const b = await page.evaluate(() => { try { return localStorage.getItem('flyover.boot'); } catch (e) { return null; } });
    await crash(page);
    log(`crash ${i}: renderer killed mid-load (boot key was ${b})`);
    page = await ctx.newPage();
  }
  const s = await visit(page, '/?drift=0');
  log('crash: visit after two crashes', JSON.stringify(short(s)));
  check('crash: two genuine crashes fall back to the safe scene', s.lite && s.lite.safe && !s.slopesOn, `safe=${s.lite && s.lite.safe}`);
  check('crash: the fallback says so on screen', s.notice && s.notice.shown, JSON.stringify(s.notice));
  check('crash: the fallback is not written into the URL', clean(s), s.search);
  await page.screenshot({ path: path.join(OUT, 'crash-notice-1.jpg'), type: 'jpeg', quality: 80 });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'crash-notice.jpg'), type: 'jpeg', quality: 80 });
  const btn = await page.$('#lite-notice button[data-act="full"]');
  check('crash: the notice has a "load full city" button', !!btn);
  if (btn) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {}), btn.tap()]);
    await waitReveal(page);
    await sleep(SETTLE_MS);
    const r = await snap(page);
    log('crash: after one tap', JSON.stringify(short(r)));
    check('crash: one tap restores the full city', isFull(r), `safe=${r.lite && r.lite.safe}`);
    check('crash: and the URL is clean after the retry', clean(r), r.search);
    // A later visit stays normal (the retry succeeded, so the counter is clear).
    const l = await visit(page, '/?drift=0');
    log('crash: a later visit', JSON.stringify(short(l)));
    check('crash: a later visit after a good retry is normal', isFull(l));
  }
});

S.legacy = () => withCtx(PHONE, async ctx => {
  let page = await ctx.newPage();
  // Put the pre-fix state in this origin: the old integer counter.
  await page.goto(BASE + '/data/apartments/index.json', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('flyover.boot', '3'));
  const old = '/?drift=0&slopes=0&campuslandscape=0&preset=performance&lite=safe';
  const s = await visit(page, old);
  log('legacy: old counter 3 + old auto-written safe URL', JSON.stringify(short(s)));
  check('legacy: an old auto-written ?lite=safe URL recovers by itself', isFull(s), `safe=${s.lite && s.lite.safe} search=${s.search}`);
  check('legacy: and the address bar is cleaned', s.search === '?drift=0', s.search);
  const r = await visit(page, '', { how: 'reload' });
  // Log the row, not just the URL. This check failed once on a loaded machine
  // and the detail said only `?drift=0`, which is the part that was RIGHT —
  // there was no way to tell a real fallback from a build that had not landed
  // inside the settle window yet. Every other scenario logs its row; this one
  // did not.
  log('legacy: reload after recovery', JSON.stringify(short(r)));
  check('legacy: a reload after recovery stays normal', isFull(r),
    `safe=${r.lite && r.lite.safe} ${short(r).want} slopesOn=${r.slopesOn} ${r.search}`);
  // Hand-typed ?lite=safe: honoured, explained, one tap away from the full city.
  const h = await visit(page, '/?drift=0&lite=safe');
  log('legacy: hand-typed ?lite=safe', JSON.stringify(short(h)));
  check('legacy: a hand-typed ?lite=safe is honoured', h.lite && h.lite.safe && !h.slopesOn);
  check('legacy: ...and explained on screen', h.notice && h.notice.shown, JSON.stringify(h.notice));
  const btn = await page.$('#lite-notice button[data-act="full"]');
  if (btn) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {}), btn.tap()]);
    await waitReveal(page); await sleep(SETTLE_MS);
    const t = await snap(page);
    log('legacy: after tapping load full city', JSON.stringify(short(t)));
    check('legacy: one tap from ?lite=safe restores the full city', isFull(t), t.search);
  } else check('legacy: ?lite=safe notice has a button', false);
  // The pre-fix NORMAL phone URL, shared to a desktop, must not force the phone
  // profile there.
  await withCtx(DESK, async dctx => {
    const dp = await dctx.newPage();
    await dp.goto(BASE + '/?drift=0&campuslandscape=0&preset=performance&lite=1', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const d = await snap(dp);
    log('legacy: old phone URL opened on a desktop', JSON.stringify({ search: d.search, lite: d.lite }));
    check('legacy: an old phone URL does not force the phone profile on a desktop', d.lite && !d.lite.on, d.search);
  });
});

S.landscape = () => withCtx(LAND, async ctx => {
  const page = await ctx.newPage();
  const s = await visit(page, '/?drift=0');
  log('landscape', JSON.stringify(short(s)));
  check('landscape: coarse + profile on', s.coarse && s.lite && s.lite.on, `screen=${s.screen}`);
  check('landscape: authored buildings', isFull(s));
  await page.screenshot({ path: path.join(OUT, 'landscape-1.jpg'), type: 'jpeg', quality: 80 });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'landscape.jpg'), type: 'jpeg', quality: 80 });
});

S.desktop = () => withCtx(DESK, async ctx => {
  const page = await ctx.newPage();
  const s = await visit(page, '/?drift=0', { settle: 3000 });
  log('desktop', JSON.stringify(short(s)));
  check('desktop: no phone profile', s.lite && !s.lite.on);
  check('desktop: URL untouched', s.search === '?drift=0', s.search);
  check('desktop: no boot counter written', s.boot === null, String(s.boot));
  // The desktop's scene is whatever main gives it: nothing applied by
  // js/mobile.js, the three.js layer and the campus planting on. Whether the
  // authored buildings beat app.js's 90 s ceiling on a loaded machine is the
  // desktop's own (unchanged) behaviour — logged, not asserted.
  const cl = await page.evaluate(() => !!(window.CAMPUS_LANDSCAPE && window.CAMPUS_LANDSCAPE.on));
  check('desktop: full scene (three.js layer + campus planting on, nothing applied)', s.slopesOn && cl && s.lite && s.lite.applied.length === 0,
    `preset=${s.preset} campuslandscape=${cl} applied=${JSON.stringify(s.lite && s.lite.applied)} authored=${s.aptsOn} modelFallback=${s.intro && s.intro.modelFallback}`);
});

// WebGL context loss (lead 4): a phone can take the WebGL context back under
// memory pressure without killing the tab. MapLibre restores its own layers;
// the three.js layer does not (measured before js/mobile.js handled it: the
// authored and campus buildings were holes). js/mobile.js reloads the page
// once the context is restored and the page is visible. Asserted here: the
// page reloads by itself and ends with the authored buildings DRAWING.
S.contextloss = () => withCtx(PHONE, async ctx => {
  const page = await ctx.newPage();
  const errs = errsOf(page);
  const s = await visit(page, '/?drift=0&intro=0', { settle: 6000 });
  const shot = async tag => { await page.screenshot({ path: path.join(OUT, `ctxloss-${tag}-1.jpg`), type: 'jpeg', quality: 70 }); await sleep(1000); await page.screenshot({ path: path.join(OUT, `ctxloss-${tag}.jpg`), type: 'jpeg', quality: 70 }); };
  const frames = () => page.evaluate(() => ({ slopesFrames: window.slopes && window.slopes.frames, tris: window.slopes && window.slopes.stats ? window.slopes.stats().triangles : null, origin: performance.timeOrigin }));
  await shot('before');
  const f0 = await frames();
  let reloaded = false;
  page.on('framenavigated', fr => { if (fr === page.mainFrame()) reloaded = true; });
  const lost = await page.evaluate(() => {
    const gl = window.__map.painter && window.__map.painter.context && window.__map.painter.context.gl;
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    if (!ext) return 'no WEBGL_lose_context';
    window.__lc = ext; ext.loseContext(); return 'lost';
  });
  await sleep(1000);
  await page.evaluate(() => window.__lc && window.__lc.restoreContext()).catch(() => {});
  // The reload starts within a moment of the restore; give it room.
  const t0 = Date.now();
  while (!reloaded && Date.now() - t0 < 15000) await sleep(250);
  log(`contextloss: ${lost}; page reloaded by itself: ${reloaded} (${Date.now() - t0} ms after restore)`);
  check('contextloss: a lost + restored context reloads the page', reloaded);
  if (reloaded) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await waitReveal(page);
    await sleep(8000);
    const a = await snap(page);
    const f2 = await frames();
    log('contextloss: after the reload', JSON.stringify({ ...short(a), frames: f2 }));
    check('contextloss: after the reload the authored buildings draw again', isFull(a) && f2.slopesFrames > 0 && f2.tris > 0 && f2.origin !== f0.origin,
      `frames=${f2.slopesFrames} tris=${f2.tris} safe=${a.lite && a.lite.safe}`);
    check('contextloss: the reload is not counted as a crash', a.lite && !a.lite.safe && a.lite.crashes === 0, `boot=${a.boot}`);
    await shot('after');           // same start pose as 'before' (intro=0)
  }
  log('contextloss errors', JSON.stringify(errs.slice(0, 3)));
});

// ── Sep 24 2026: the reload loop ────────────────────────────────────
// Every load the page starts by itself is a main-frame DOCUMENT REQUEST this
// script did not ask for. Counted from the moment the listener is attached, so
// the count after one goto is 1 and anything above it is the page's own reload.
// NOT `framenavigated`: Playwright fires that for same-document history
// changes too, and js/mobile.js calls history.replaceState twice on every load
// (the profile flags in, the visitor's URL back) — the first version of this
// counter read 3 for one load and called it a reload loop.
function selfNavs(page) {
  const o = { n: 0 };
  page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) o.n++; });
  return o;
}
async function waitFlying(page) {
  await page.waitForFunction(() => { const f = window.__intro && window.__intro.flight; return !!(f && f.state === 'flying'); },
    null, { timeout: REVEAL_MS, polling: 200 });
}
async function loseContext(page) {
  return page.evaluate(() => {
    const gl = window.__map.painter && window.__map.painter.context && window.__map.painter.context.gl;
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    if (!ext) return 'no WEBGL_lose_context';
    window.__lc = ext; ext.loseContext(); return 'lost';
  });
}
const tierOf = s => s.lite && s.lite.tierName;
const flightOf = page => page.evaluate(() => (window.__intro && window.__intro.flight ? window.__intro.flight.state : null));

S.crashloop = () => withCtx(PHONE, async ctx => {
  let page = await ctx.newPage();
  await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()).catch(() => {});
  await waitFlying(page);
  const b0 = await page.evaluate(() => ({ tier: window.LITE_PROFILE && window.LITE_PROFILE.tierName, boot: localStorage.getItem('flyover.boot') }));
  await crash(page);
  log(`crashloop: killed during the opening flight on the "${b0.tier}" tier (boot ${b0.boot})`);
  check('crashloop: the first load was the phone tier', b0.tier === 'phone', b0.tier);
  // Safari's one automatic reload.
  page = await ctx.newPage();
  let navs = selfNavs(page);
  const s1 = await visit(page, '/?drift=0');
  await sleep(10000);   // room for any reload of our own to happen
  const s1b = await snap(page);
  const fl1 = await flightOf(page);
  log("crashloop: Safari's reload", JSON.stringify({ ...short(s1b), tier: tierOf(s1b), flight: fl1, navs: navs.n }));
  check("crashloop: Safari's reload lands on the lighter tier", tierOf(s1) === 'lighter' && !s1.lite.safe, tierOf(s1));
  check('crashloop: ...with the authored buildings', isFull(s1b), short(s1b).want);
  check('crashloop: ...skipping the opening flight', fl1 === null, String(fl1));
  check('crashloop: ...saying so on screen', s1b.notice && s1b.notice.shown, JSON.stringify(s1b.notice));
  check('crashloop: ...and it never reloads itself', navs.n === 1, `main-frame navigations ${navs.n}`);
  await page.screenshot({ path: path.join(OUT, 'crashloop-lighter-1.jpg'), type: 'jpeg', quality: 80 });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'crashloop-lighter.jpg'), type: 'jpeg', quality: 80 });
  // The lighter tier dies too, mid-load (a phone that cannot hold even that):
  // Safari's reload of THAT must be the safe tier. (Killing the page above
  // would not do: it has already outlived the settle window, i.e. the lighter
  // tier SURVIVED there, which is not a death.)
  await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(7000);
  const b1 = await page.evaluate(() => ({ tier: window.LITE_PROFILE && window.LITE_PROFILE.tierName }));
  await crash(page);
  log(`crashloop: killed mid-load on the "${b1.tier}" tier`);
  page = await ctx.newPage();
  navs = selfNavs(page);
  await visit(page, '/?drift=0');
  await sleep(10000);
  const s2b = await snap(page);
  log('crashloop: after a second kill', JSON.stringify({ ...short(s2b), tier: tierOf(s2b), navs: navs.n }));
  check('crashloop: a second kill lands on the safe tier', tierOf(s2b) === 'safe' && s2b.lite.safe && !s2b.slopesOn, tierOf(s2b));
  check('crashloop: ...with the notice', s2b.notice && s2b.notice.shown, JSON.stringify(s2b.notice));
  check('crashloop: ...and no reload of its own', navs.n === 1, `main-frame navigations ${navs.n}`);
});

S.ctxintro = () => withCtx(PHONE, async ctx => {
  const page = await ctx.newPage();
  const errs = errsOf(page);
  await page.goto(BASE + '/?drift=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()).catch(() => {});
  const navs = selfNavs(page);
  await waitFlying(page);
  const origin0 = await page.evaluate(() => performance.timeOrigin);
  const lost = await loseContext(page);
  await sleep(1000);
  await page.evaluate(() => window.__lc && window.__lc.restoreContext()).catch(() => {});
  const t0 = Date.now();
  while (navs.n < 1 && Date.now() - t0 < 15000) await sleep(250);
  log(`ctxintro: ${lost} during the opening flight; reloads by itself: ${navs.n} (${Date.now() - t0} ms after restore)`);
  check('ctxintro: a context lost during the flight reloads once', navs.n === 1, `navigations ${navs.n}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await waitReveal(page);
  await sleep(SETTLE_MS);
  const a = await snap(page);
  const origin1 = await page.evaluate(() => performance.timeOrigin);
  const fl = await flightOf(page);
  log('ctxintro: after the reload', JSON.stringify({ ...short(a), tier: tierOf(a), flight: fl }));
  check('ctxintro: the reload is the lighter tier with the authored buildings', origin1 !== origin0 && tierOf(a) === 'lighter' && isFull(a), `${tierOf(a)} ${short(a).want}`);
  check('ctxintro: ...no opening flight, and a notice', fl === null && a.notice && a.notice.shown, `flight=${fl} ${JSON.stringify(a.notice)}`);
  await page.screenshot({ path: path.join(OUT, 'ctxintro-lighter-1.jpg'), type: 'jpeg', quality: 80 });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'ctxintro-lighter.jpg'), type: 'jpeg', quality: 80 });
  // Lost again on the lighter tier: the one automatic reload is spent.
  const lost2 = await loseContext(page);
  await sleep(1000);
  await page.evaluate(() => window.__lc && window.__lc.restoreContext()).catch(() => {});
  await sleep(15000);
  const b = await snap(page);
  log(`ctxintro: ${lost2} again; navigations now ${navs.n}`, JSON.stringify({ notice: b.notice, tier: tierOf(b) }));
  check('ctxintro: a second loss does NOT reload again', navs.n === 1, `navigations ${navs.n}`);
  check('ctxintro: ...it offers the reload on screen instead', b.notice && b.notice.shown && /Reload/.test(b.notice.text), JSON.stringify(b.notice));
  await page.screenshot({ path: path.join(OUT, 'ctxintro-second-1.jpg'), type: 'jpeg', quality: 80 });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'ctxintro-second.jpg'), type: 'jpeg', quality: 80 });
  log('ctxintro errors', JSON.stringify(errs.slice(0, 3)));
});

// Camera poses computed from each building's own footprint.
function poseFor(name) {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments/index.json'), 'utf8'));
  for (const f of idx.buildings) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments', f), 'utf8'));
    if (d.name !== name) continue;
    const ring = d.footprint.ring || (d.footprint.rings && d.footprint.rings[0]) || d.footprint;
    let x = 0, y = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const [lng, lat] of ring) { x += lng; y += lat; minx = Math.min(minx, lng); maxx = Math.max(maxx, lng); miny = Math.min(miny, lat); maxy = Math.max(maxy, lat); }
    x /= ring.length; y /= ring.length;
    const k = Math.cos(y * Math.PI / 180);
    const ext = Math.max((maxx - minx) * 111320 * k, (maxy - miny) * 110540);
    const fl = d.levels && d.levels.floors;
    const h = (d.levels && (d.levels.top || d.levels.roof)) || (fl ? fl[fl.length - 1] : 30);
    // The whole building and its plan in frame (The Standard's defect is its
    // PLAN: a W, not two sticks), so wider and steeper than eye level.
    const span = Math.max(ext, h * 1.2) * 2.2;               // metres across the frame
    const mpp = span / 390;
    const zoom = Math.log2(156543.03 * k / mpp);
    return { center: [x, y], zoom: Math.min(19.2, zoom), pitch: 45, bearing: 25, h };
  }
  return null;
}

// SHOTS_QUERY adds flags (the BEFORE frames use `&lite=0&slopes=0&...`, the
// scene a trapped phone showed, without the notice); SHOTS_TAG prefixes files.
const SHOTS_QUERY = process.env.SHOTS_QUERY || '';
const SHOTS_TAG = process.env.SHOTS_TAG || 'phone';
S.shots = () => withCtx(PHONE, async ctx => {
  const page = await ctx.newPage();
  const s = await visit(page, '/?drift=0&intro=0' + SHOTS_QUERY, { settle: 8000 });
  log('shots: profile', JSON.stringify(short(s)));
  if (!SHOTS_QUERY) check('shots: phone profile, authored buildings', isFull(s));
  for (const name of WANT) {
    const p = poseFor(name);
    if (!p) { check(`shots: pose for ${name}`, false); continue; }
    // Braces: jumpTo() RETURNS THE MAP, and page.evaluate serializes whatever
    // comes back. On main at 0252095 that was a >512 MB message and killed
    // the run (ERR_STRING_TOO_LONG in Playwright's pipe, 2026-09-24).
    await page.evaluate(o => { window.__map.jumpTo({ center: o.center, zoom: o.zoom, pitch: o.pitch, bearing: o.bearing }); }, p);
    await sleep(6000);
    await page.evaluate(() => new Promise(r => { const m = window.__map; const t = setTimeout(r, 8000); m.once('idle', () => { clearTimeout(t); r(); }); }));
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await page.screenshot({ path: path.join(OUT, `${SHOTS_TAG}-${slug}-1.jpg`), type: 'jpeg', quality: 82 });
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, `${SHOTS_TAG}-${slug}.jpg`), type: 'jpeg', quality: 82 });
    log('shot', name, JSON.stringify(p));
  }
});

for (const name of SCEN) {
  if (!S[name]) { console.error('unknown scenario', name); process.exitCode = 2; continue; }
  log(`\n=== ${name} ===`);
  const t0 = Date.now();
  try { await S[name](); } catch (e) { check(`${name}: ran`, false, String(e.message || e).slice(0, 200)); }
  log(`(${name} took ${Math.round((Date.now() - t0) / 1000)} s)`);
}
const bad = results.filter(r => !r.ok);
log(`\n${results.length - bad.length}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, 'mobile-boot-results.json'), JSON.stringify(results, null, 1));
browser.__done();
process.exit(bad.length ? 1 : 0);
