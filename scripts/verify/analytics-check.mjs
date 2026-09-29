/**
 * analytics-check.mjs — the visit counter sends a page view and nothing else,
 * and it never goes through, around or over the schedule egress guard.
 *
 *   node scripts/verify/analytics-check.mjs      (starts its own server, no GPU)
 *
 * WHAT IS REAL AND WHAT IS NOT. Real: js/analytics.js, js/wayfind.js (so the
 * real egress guard, armed by a real stored schedule), vercel.json's headers,
 * and a real Chrome. NOT real: Vercel's own /_vercel/insights/script.js, which
 * only exists on a Vercel deployment with Web Analytics switched on. The
 * server here answers that path with a STAND-IN written from Vercel's
 * documented contract (drain window.vaq at load, pass every event through the
 * registered beforeSend as { type, url }, POST the survivor once to
 * /_vercel/insights/view). What the stand-in cannot prove is what the real
 * script puts in the body. docs/analytics.md says how to check that live.
 *
 * The page is served from a NON-dev host (check.flyover.example, mapped to
 * 127.0.0.1 with --host-resolver-rules), because js/analytics.js is inert on
 * localhost. That way the code path under test is the production one, with no
 * test hook in it.
 *
 * WHAT IT ASSERTS
 *   0  The include: one <script src="js/analytics.js"> in index.html and in
 *      _harness.html, last, after js/wayfind.js. The file never mentions the
 *      schedule (comment-stripped source). vercel.json sends Referrer-Policy
 *      origin. Vercel's script is injected by analytics.js and nowhere else.
 *   1  Dev hosts are inert: no request to /_vercel/ from 127.0.0.1 or localhost.
 *   2  On a production host, a URL full of ?from=&to=&dayat=&utm_ and a #hash
 *      produces ONE beacon whose URL is origin + path, whose Referer header is
 *      the origin only, with no cookie, no storage write, no third-party host.
 *      A pushState/replaceState storm does not make a second page view; a
 *      custom event is dropped; clean() fails closed.
 *   3  THE GUARD, REAL. A stored schedule arms the real guard; the beacon goes
 *      through it (its log has the request, not blocked) and carries none of the
 *      schedule. The negative control: the same channel carrying a class title
 *      IS refused, so the guard was live in that page. Both beacon shapes the
 *      stand-in can use (sendBeacon, fetch) pass. A Blob body is refused while
 *      a schedule is stored (fail-safe, see docs/si-privacy.md section 12).
 *   4  Opt-out: ?va=off stops the counting and sticks, ?va=on restores it.
 *   5  Analytics that is not switched on yet (script 404) breaks nothing.
 *   6  With the walking feature off and a schedule sitting in localStorage, the
 *      only storage key js/analytics.js touches is va-disable.
 *
 * Exit: 0 all pass, 1 a check failed.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROD_HOST = 'check.flyover.example';     // not a dev host; mapped to loopback below
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let fails = 0, passes = 0;
const head = (t) => console.log('\n' + '─'.repeat(78) + '\n  ' + t + '\n' + '─'.repeat(78));
const ok = (cond, label, detail) => {
  if (cond) passes++; else fails++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '   [' + detail + ']' : ''));
  return !!cond;
};

// ═══ the server: the repo's js/, vercel.json's headers, and a stand-in ═══════
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const CONFIG_HEADERS = ((VERCEL.headers || []).find(h => h.source === '/(.*)') || { headers: [] })
  .headers.reduce((o, h) => (o[h.key.toLowerCase()] = h.value, o), {});

const srv = { mode: 'beacon-string', hookHistory: true, scriptStatus: 200, seen: [] };

/** The stand-in for /_vercel/insights/script.js. Written from the documented
 *  contract, NOT copied from Vercel. `hookHistory` is the worst case: a script
 *  that also reports every pushState/replaceState as a navigation. */
const standIn = () => `(function () {
  var before = null;
  var MODE = ${JSON.stringify(srv.mode)}, HOOK = ${JSON.stringify(srv.hookHistory)};
  function send(evt) {
    var out = before ? before(evt) : evt;
    if (!out) return;
    var body = JSON.stringify({ o: out.url, r: document.referrer || '', ts: Date.now(),
      sv: 'stand-in', sdkn: 'stand-in', en: out.type === 'event' ? 'event' : 'pageview', ed: out.data });
    var u = '/_vercel/insights/view';
    if (MODE === 'fetch') fetch(u, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'application/json' } });
    else if (MODE === 'beacon-blob') navigator.sendBeacon(u, new Blob([body], { type: 'application/json' }));
    else navigator.sendBeacon(u, body);
  }
  window.va = function (cmd, arg) {
    if (cmd === 'beforeSend') before = arg;
    else if (cmd === 'event') send({ type: 'event', url: location.href, data: arg && arg.data });
  };
  var q = window.vaq || [];
  for (var i = 0; i < q.length; i++) window.va.apply(null, q[i]);
  send({ type: 'pageview', url: location.href });
  if (HOOK) {
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      history[m] = function () { var r = orig.apply(this, arguments); send({ type: 'pageview', url: location.href }); return r; };
    });
    addEventListener('popstate', function () { send({ type: 'pageview', url: location.href }); });
  }
})();`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>analytics check</title></head>
<body><p>a bare page: the real js/wayfind.js, then the real js/analytics.js, in index.html's order.</p>
<script src="/js/wayfind.js"></script>
<script src="/js/analytics.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = req.url;
    srv.seen.push({ method: req.method, url, headers: req.headers, body });
    const send = (code, type, text) => {
      res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, CONFIG_HEADERS));
      res.end(text);
    };
    if (url.startsWith('/_vercel/insights/script.js')) {
      return srv.scriptStatus === 200 ? send(200, 'text/javascript', standIn()) : send(srv.scriptStatus, 'text/plain', 'not found');
    }
    if (url.startsWith('/_vercel/insights/view')) return send(204, 'text/plain', '');
    if (url.split('?')[0] === '/favicon.ico') return send(204, 'image/x-icon', '');
    const p = url.split('?')[0];
    if (p === '/' || p === '/other') return send(200, 'text/html; charset=utf-8', PAGE);
    if (p.startsWith('/js/') && !p.includes('..')) {
      const f = path.join(ROOT, p);
      if (fs.existsSync(f)) return send(200, 'text/javascript', fs.readFileSync(f, 'utf8'));
    }
    send(404, 'text/plain', 'no');
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const PROD = `http://${PROD_HOST}:${PORT}`;
const beacons = () => srv.seen.filter(r => r.url.startsWith('/_vercel/insights/view'));
const scriptGets = () => srv.seen.filter(r => r.url.startsWith('/_vercel/insights/script.js'));
const reset = () => { srv.seen.length = 0; };
const settle = async (ms = 900) => { await sleep(ms); };
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(60); } return false; };

let browser;
try {
  // ═══ 0. static: the include, the source, the config ═══════════════════════
  head('0. the include, the source, the config');
  const scriptSrcs = (f) => [...fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  for (const f of ['index.html', '_harness.html']) {
    const s = scriptSrcs(f);
    ok(s.filter(x => x === 'js/analytics.js').length === 1, f + ': exactly one js/analytics.js include');
    ok(s[s.length - 1] === 'js/analytics.js' && s.indexOf('js/wayfind.js') < s.indexOf('js/analytics.js'),
      f + ': it is the LAST script, after js/wayfind.js (the guard is up before it runs)');
    ok(!s.some(x => x.includes('/_vercel/') || x.includes('vercel-insights') || x.includes('va.vercel')),
      f + ': Vercel\'s script is never a <script src> here; only analytics.js injects it');
  }
  const src = fs.readFileSync(path.join(ROOT, 'js/analytics.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  ok(!/schedule|wayfind|austin3d|classes|instructor/i.test(code),
    'js/analytics.js, comments stripped, never mentions the schedule, WAYFIND, or an austin3d.* key');
  ok(/scriptSrc:\s*'\/_vercel\/insights\/script\.js'/.test(code), 'the injected script is a same-origin path');
  ok(!/https?:\/\/[a-z]/i.test(code), 'js/analytics.js names no host at all');
  ok(CONFIG_HEADERS['referrer-policy'] === 'origin',
    'vercel.json sends Referrer-Policy: origin on every response', CONFIG_HEADERS['referrer-policy']);

  browser = await launch(chromium, {
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--host-resolver-rules=MAP ${PROD_HOST} 127.0.0.1`,
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable'],
  });
  const newPage = async (ctx) => {
    const page = await ctx.newPage();
    page.__errs = []; page.__console = []; page.__hosts = new Set();
    page.on('pageerror', e => page.__errs.push(String(e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') page.__console.push(m.text().slice(0, 160)); });
    page.on('request', r => { try { page.__hosts.add(new URL(r.url()).host); } catch (e) {} });
    return page;
  };

  // ═══ 1. dev hosts are inert ═══════════════════════════════════════════════
  head('1. dev hosts do nothing');
  {
    const ctx = await browser.newContext();
    for (const host of ['127.0.0.1', 'localhost']) {
      reset();
      const page = await newPage(ctx);
      await page.goto(`http://${host}:${PORT}/?from=WEL&to=MAI&walk=0`, { waitUntil: 'load' });
      await settle();
      const st = await page.evaluate(() => window.ANALYTICS.state());
      ok(st.reason === 'dev-host' && !st.injected, host + ': inert', 'reason=' + st.reason);
      ok(scriptGets().length === 0 && beacons().length === 0, host + ': no request to /_vercel/ at all');
      await page.close();
    }
    const page = await newPage(ctx);
    await page.goto(`${PROD}/?walk=0`, { waitUntil: 'load' });
    const table = await page.evaluate(() => {
      const t = ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.20', '169.254.1.1', '[::1]', 'mac.local', 'a.localhost', 'x.test', '',
        'flyover-utx.vercel.app', 'check.flyover.example', 'austin3d.app'];
      return t.map(h => [h, window.ANALYTICS.isDevHost(h)]);
    });
    const want = { 'localhost': true, '127.0.0.1': true, '10.0.0.5': true, '192.168.1.20': true, '169.254.1.1': true, '[::1]': true,
      'mac.local': true, 'a.localhost': true, 'x.test': true, '': true,
      'flyover-utx.vercel.app': false, 'check.flyover.example': false, 'austin3d.app': false };
    ok(table.every(([h, v]) => v === want[h]), 'isDevHost: loopback, LAN, IPv6, .local/.test are dev; the vercel.app host and a custom domain are not',
      table.filter(([h, v]) => v !== want[h]).map(x => x[0]).join(',') || 'all 13 right');
    await ctx.close();
  }

  // ═══ 2. a production host: one page view, origin + path, nothing else ════
  head('2. production host, a URL full of things that must not leave');
  {
    reset();
    srv.mode = 'beacon-string'; srv.hookHistory = true; srv.scriptStatus = 200;
    const ctx = await browser.newContext();
    const page = await newPage(ctx);
    const dirty = '/?from=WEL&to=MAI&dayof=TU&dayat=0930&walk=0&utm_source=share&utm_medium=member#frag=secret';
    await page.goto(PROD + dirty, { waitUntil: 'load', referer: 'https://www.linkedin.com/' });
    ok(await waitFor(() => beacons().length >= 1), 'a page view arrives');
    await settle();
    ok(beacons().length === 1, 'exactly ONE beacon for the load', 'got ' + beacons().length);
    const b = beacons()[0] || { headers: {}, body: '', method: '' };
    let payload = {}; try { payload = JSON.parse(b.body); } catch (e) {}
    console.log('\n  the request, as the server received it (stand-in script):');
    console.log('    ' + b.method + ' /_vercel/insights/view');
    for (const k of ['host', 'content-type', 'referer', 'origin', 'cookie', 'authorization']) {
      if (b.headers[k] !== undefined) console.log('    ' + k + ': ' + b.headers[k]);
    }
    console.log('    body: ' + b.body + '\n');
    ok(payload.o === PROD + '/', 'the event URL is origin + path, exactly', payload.o);
    ok(!/[?#]/.test(payload.o || '?') && !/from=|WEL|MAI|dayat|utm_|frag|secret/i.test(b.body),
      'no query string, no hash, none of ?from= ?to= ?dayat= ?utm_ in the body');
    ok(payload.r === 'https://www.linkedin.com/', 'the referrer travels (that is the attribution)', payload.r);
    ok(b.headers.referer === PROD + '/' && !/[?#]/.test(b.headers.referer || '?'),
      'the Referer header on the beacon is the origin only (Referrer-Policy: origin)', b.headers.referer);
    ok(b.headers.cookie === undefined && b.headers.authorization === undefined, 'no cookie or authorization header');
    ok((await ctx.cookies()).length === 0 && (await page.evaluate(() => document.cookie)) === '', 'no cookie set, none readable');
    const keys = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    ok(keys.length === 0, 'nothing written to localStorage or sessionStorage', keys.join(',') || 'none');
    ok([...page.__hosts].filter(Boolean).every(h => h === PROD_HOST + ':' + PORT), 'every request this page made went to its own origin', [...page.__hosts].filter(Boolean).join(','));
    ok(page.__errs.filter(e => /analytics/i.test(e)).length === 0, 'no page error from analytics.js');

    // One page view per load, even for a script that treats history changes as navigation.
    await page.evaluate(() => {
      history.replaceState(null, '', '/?a=1');
      history.pushState(null, '', '/?b=2#h');
      history.replaceState(null, '', '/?from=GDC&to=EER');
    });
    await settle(600);
    ok(beacons().length === 1, 'replaceState/pushState on the same path is not a second page view', 'beacons=' + beacons().length);
    await page.evaluate(() => history.pushState(null, '', '/other?x=1'));
    ok(await waitFor(() => beacons().length === 2, 4000), 'a genuinely different path IS counted, still without its query');
    const second = JSON.parse(beacons()[1].body).o;
    ok(second === PROD + '/other', 'and it arrives as origin + path', second);

    // Custom events are dropped, and the event would have carried this.
    const before = beacons().length;
    await page.evaluate(() => window.va('event', { name: 'x', data: { title: 'Zygomorphic Percussion Seminar' } }));
    await settle(600);
    ok(beacons().length === before, 'a custom event (with a class-title payload) is dropped before it is sent');

    // clean() directly: policy, and failing closed.
    const c = await page.evaluate(() => {
      const A = window.ANALYTICS, d = 'https://x.example/p';
      const r = {};
      r.strip = A.clean({ type: 'pageview', url: d + '?utm_source=share&from=WEL#h' });
      A.keepQueryParams = ['utm_source', 'utm_medium'];
      r.keep = A.clean({ type: 'pageview', url: d + '2?utm_source=share&from=WEL&utm_medium=m#h' });
      A.keepQueryParams = [];
      r.dup = A.clean({ type: 'pageview', url: d + '?again=1' });
      r.evt = A.clean({ type: 'event', url: d + '3', data: { a: 'b' } });
      r.js = A.clean({ type: 'pageview', url: 'javascript:alert(1)' });
      r.nul = A.clean(null);
      r.nourl = A.clean({ type: 'pageview' });
      r.bad = A.clean({ type: 'pageview', url: 'http://[bad' });
      return r;
    });
    ok(c.strip && c.strip.url === 'https://x.example/p', 'clean() default: query and hash gone', c.strip && c.strip.url);
    ok(c.keep && c.keep.url === 'https://x.example/p2?utm_source=share&utm_medium=m', 'keepQueryParams keeps only what it lists, nothing else', c.keep && c.keep.url);
    ok(c.dup === null, 'a repeat of a URL already reported is dropped');
    ok(c.evt === null, 'clean() drops a custom event');
    ok(c.js === null && c.nul === null && c.nourl === null && c.bad === null, 'clean() fails closed on a non-http URL, null, a missing url and an unparseable one');

    // The loader's mode picker reloads with location.assign: same visitor, not a new arrival.
    const beforeAssign = beacons().length;
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.evaluate(() => location.assign('/?tour=1&p=0.5'))]);
    await settle();
    const stA = await page.evaluate(() => ({ st: window.ANALYTICS.state(), ref: document.referrer }));
    ok(beacons().length === beforeAssign && stA.st.reason === 'in-app-reload' && !stA.st.injected,
      'a same-origin reload (the mode picker) is not counted a second time', `reason=${stA.st.reason} referrer=${stA.ref}`);
    await ctx.close();
  }

  // ═══ 3. the real guard ════════════════════════════════════════════════════
  head('3. the real egress guard, armed by a real stored schedule');
  const TITLE = 'Zygomorphic Percussion Seminar', INSTRUCTOR = 'Quentin Ashgrove', ROOM_PAIR = 'GDC 2.216';
  const watched = [TITLE, INSTRUCTOR, ROOM_PAIR, 'GDC', '2.216'];
  const carriesSchedule = (text) => {
    const t = text.toLowerCase();
    return watched.filter(w => {
      const lw = w.toLowerCase();
      return t.includes(lw) || t.includes(encodeURIComponent(w).toLowerCase()) || t.includes(lw.replace(/ /g, '+'));
    });
  };
  for (const mode of ['beacon-string', 'fetch']) {
    reset();
    srv.mode = mode; srv.hookHistory = false; srv.scriptStatus = 200;
    const ctx = await browser.newContext();
    const page = await newPage(ctx);
    // First visit opts the browser out (so it counts nothing) and stores a schedule.
    await page.goto(`${PROD}/?walk=1&va=off`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.wayfindStore && window.wayfindStore.guard, null, { timeout: 30000 });
    const saved = await page.evaluate((c) => window.wayfindStore.save({
      term: 'Fall 2026', tz: 'America/Chicago',
      sources: [{ id: 's0', kind: 'google-ics', label: 'a Google Calendar export' }],
      classes: [{ id: 'c0', code: 'GDC', room: '2.216', title: c.TITLE, instructor: c.INSTRUCTOR,
        days: ['MO', 'WE'], startMin: 600, endMin: 650, confidence: 1, src: 's0' }],
    }).ok, { TITLE, INSTRUCTOR });
    ok(saved === true && beacons().length === 0, `[${mode}] schedule stored while opted out; the opted-out visit sent nothing`);
    // Second visit: counting on again, the schedule is already stored, so the
    // guard is armed at the moment analytics.js runs.
    reset();
    await page.goto(`${PROD}/?walk=1&va=on`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.wayfindStore && window.wayfindStore.guard, null, { timeout: 30000 });
    const armed = await page.evaluate(() => window.wayfindStore.guard.state());
    ok(armed.installed && armed.armed && armed.watched > 0, `[${mode}] the real guard is installed and armed`, 'watched=' + armed.watched);
    ok(await waitFor(() => beacons().length >= 1), `[${mode}] the page view still arrives`);
    await settle();
    const b = beacons()[0] || { body: '', headers: {}, url: '' };
    ok(beacons().length === 1, `[${mode}] exactly one beacon`, 'got ' + beacons().length);
    const whole = JSON.stringify({ url: b.url, headers: b.headers, body: b.body });
    ok(carriesSchedule(whole).length === 0, `[${mode}] the request (URL, every header, body) carries none of the schedule`,
      carriesSchedule(whole).join(',') || 'checked ' + watched.length + ' needles, raw and encoded');
    const st = await page.evaluate(() => window.wayfindStore.guard.state());
    const log = await page.evaluate(() => window.wayfindStore.guard.log());
    const mine = log.filter(l => /_vercel\/insights\/view/.test(l.url));
    ok(mine.length === 1 && mine[0].blocked === false && (mine[0].via === 'sendBeacon' || mine[0].via === 'fetch'),
      `[${mode}] the guard SAW the beacon and let it through`, mine.map(l => l.via + ' blocked=' + l.blocked).join(';'));
    ok(st.blocked === 0 && st.inspectFailures === 0, `[${mode}] guard.blocked === 0 and inspectFailures === 0`, `blocked=${st.blocked} failures=${st.inspectFailures}`);

    // Negative control: same channel, same URL, a class title. It must be refused.
    const beforeN = beacons().length;
    const refused = await page.evaluate(async (t) => {
      const r = {};
      r.beacon = navigator.sendBeacon('/_vercel/insights/view', JSON.stringify({ leak: t }));
      try { await fetch('/_vercel/insights/view', { method: 'POST', body: t, keepalive: true }); r.fetch = 'sent'; }
      catch (e) { r.fetch = 'refused'; }
      return r;
    }, TITLE);
    await settle(500);
    ok(refused.beacon === false && refused.fetch === 'refused' && beacons().length === beforeN,
      `[${mode}] NEGATIVE CONTROL: the same channel carrying a class title is refused and never reaches the server`,
      `sendBeacon=${refused.beacon} fetch=${refused.fetch}`);
    const st2 = await page.evaluate(() => window.wayfindStore.guard.state());
    ok(st2.blocked >= 2, `[${mode}] and the guard counted the refusals`, 'blocked=' + st2.blocked);
    await ctx.close();
  }
  {
    // What a Blob body does while a schedule is stored: refused as unreadable. Fail-safe.
    reset();
    srv.mode = 'beacon-blob'; srv.hookHistory = false;
    const ctx = await browser.newContext();
    const page = await newPage(ctx);
    await page.goto(`${PROD}/?walk=1&va=off`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.wayfindStore && window.wayfindStore.guard, null, { timeout: 30000 });
    await page.evaluate((c) => window.wayfindStore.save({ term: 'Fall 2026', tz: 'America/Chicago',
      sources: [{ id: 's0', kind: 'google-ics', label: 'a Google Calendar export' }],
      classes: [{ id: 'c0', code: 'GDC', room: '2.216', title: c.TITLE, instructor: c.INSTRUCTOR, days: ['MO'], startMin: 600, endMin: 650, confidence: 1, src: 's0' }] }), { TITLE, INSTRUCTOR });
    reset();
    await page.goto(`${PROD}/?walk=1&va=on`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.wayfindStore && window.wayfindStore.guard, null, { timeout: 30000 });
    await settle(1500);
    const st = await page.evaluate(() => window.wayfindStore.guard.state());
    ok(beacons().length === 0 && st.blockedOpaque >= 1,
      '[beacon-blob] KNOWN, FAIL-SAFE: a Blob body is refused as unreadable while a schedule is stored, so that visit is not counted and nothing is sent',
      `beacons=${beacons().length} blockedOpaque=${st.blockedOpaque}`);
    // ...and with the walking feature off (every ordinary visitor) the same body goes out.
    reset();
    await page.evaluate(() => localStorage.removeItem('va-disable'));
    await page.goto(`${PROD}/?walk=0`, { waitUntil: 'load' });
    ok(await waitFor(() => beacons().length === 1), '[beacon-blob] with the feature off (no guard, no schedule UI) the visit is counted normally');
    await ctx.close();
  }

  // ═══ 4. opt-out ═══════════════════════════════════════════════════════════
  head('4. opt-out: ?va=off sticks, ?va=on restores');
  {
    reset();
    srv.mode = 'beacon-string'; srv.hookHistory = false; srv.scriptStatus = 200;
    const ctx = await browser.newContext();
    const page = await newPage(ctx);
    await page.goto(`${PROD}/?walk=0&va=off`, { waitUntil: 'load' }); await settle();
    ok(scriptGets().length === 0 && beacons().length === 0, '?va=off: no script request, no beacon');
    ok((await page.evaluate(() => localStorage.getItem('va-disable'))) === '1', '?va=off writes Vercel\'s documented va-disable key, and only that');
    await page.goto(`${PROD}/?walk=0`, { waitUntil: 'load' }); await settle();
    const st = await page.evaluate(() => window.ANALYTICS.state());
    ok(st.reason === 'opted-out' && scriptGets().length === 0 && beacons().length === 0, 'the next load, no parameter: still opted out', st.reason);
    await page.goto(`${PROD}/?walk=0&va=on`, { waitUntil: 'load' });
    ok(await waitFor(() => beacons().length === 1), '?va=on: counting again');
    ok((await page.evaluate(() => localStorage.getItem('va-disable'))) === null, '?va=on removes the key');
    await ctx.close();
  }

  // ═══ 5. not switched on yet ═══════════════════════════════════════════════
  head('5. Vercel\'s script is not there yet (Web Analytics not enabled): nothing breaks');
  {
    reset();
    srv.scriptStatus = 404;
    const ctx = await browser.newContext();
    const page = await newPage(ctx);
    await page.goto(`${PROD}/?walk=0`, { waitUntil: 'load' }); await settle();
    ok(page.__errs.length === 0, 'no uncaught error', page.__errs.join(' | ') || 'none');
    ok(beacons().length === 0 && scriptGets().length === 1, 'one script request, 404, no beacon');
    ok(page.__console.every(m => /404|Failed to load resource/i.test(m)), 'the only console error is the 404 itself', page.__console.join(' | ') || 'none');
    ok(await page.evaluate(() => typeof window.va === 'function' && Array.isArray(window.vaq)), 'window.va still queues, so a later enable needs no code change');
    srv.scriptStatus = 200;
    await ctx.close();
  }

  // ═══ 6. which storage does the file touch? ════════════════════════════════
  head('6. feature off, a schedule in localStorage: which keys does analytics.js touch?');
  {
    reset();
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      try { localStorage.setItem('austin3d.schedule.v1', '{"v":1,"classes":[{"title":"Zygomorphic Percussion Seminar"}]}'); } catch (e) {}
      const log = window.__storageLog = [];
      for (const m of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) {
        const o = Storage.prototype[m];
        Storage.prototype[m] = function () { log.push(m + ':' + String(arguments[0])); return o.apply(this, arguments); };
      }
      const len = Object.getOwnPropertyDescriptor(Storage.prototype, 'length');
      Object.defineProperty(Storage.prototype, 'length', { get() { log.push('length'); return len.get.call(this); } });
      const io = indexedDB.open.bind(indexedDB);
      indexedDB.open = function (n) { log.push('idb:' + n); return io.apply(indexedDB, arguments); };
    });
    const page = await newPage(ctx);
    await page.goto(`${PROD}/?walk=0`, { waitUntil: 'load' });
    ok(await waitFor(() => beacons().length === 1), 'the page view is counted');
    const log = await page.evaluate(() => window.__storageLog);
    ok(log.length > 0 && log.every(e => e === 'getItem:va-disable'), 'the ONLY storage access is one read of va-disable; no schedule key, no enumeration, no IndexedDB', log.join(' ; '));
    const body = beacons()[0].body + JSON.stringify(beacons()[0].headers);
    ok(carriesSchedule(body).length === 0, 'and the beacon carries none of the stored schedule');
    await ctx.close();
  }
} catch (e) {
  fails++;
  console.log('  FAIL  the check itself threw: ' + (e && e.stack || e));
} finally {
  try { server.close(); } catch (e) {}
  try { browser && browser.__done(); } catch (e) {}
}

console.log('\n' + '='.repeat(78));
console.log(`  analytics-check: ${passes} passed, ${fails} failed`);
console.log('='.repeat(78));
process.exit(fails ? 1 : 0);
