/**
 * finder-egress.mjs — what the finder's live bus line SENDS, checked at run time. No browser, no network.
 *
 * finder-static.mjs reads the source and says no file can send the schedule. This runs the code: it loads
 * js/finder-live.js (with js/transit-route.js) and js/transit-live.js into a vm with a fake page, selects a home for a
 * fixture schedule full of CANARY strings (class titles, building codes, door coordinates, the home's coordinates), calls
 * watch(), and records EVERY way a page can reach the network: fetch, XMLHttpRequest, navigator.sendBeacon, Image,
 * WebSocket, and injected script / link / iframe elements. Then:
 *   - no address or body holds a canary or the class building's or the home's coordinates,
 *   - the only hosts are the page's own origin and data.texas.gov, every request a body-less GET,
 *   - the one injected script is the page's own js/transit-live.js,
 *   - the requests really happen (a poll chain of 5 minutes), so a silent check cannot pass,
 *   - after the returned stop function is called no further request is made, 5 more minutes of fake timers later.
 *
 * Usage: node scripts/verify/finder-egress.mjs [--break | --break=stop]
 *   --break        makes the page beacon the class building's door to data.texas.gov on every update: it must fail
 *   --break=stop   makes the returned stop function do nothing: it must fail
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => fs.readFileSync(here(p), 'utf8');
const fx = (n) => fs.readFileSync(here('./fixtures/transit/' + n));
const sched = JSON.parse(read('./fixtures/finder-egress/schedule.json'));
const BREAK = process.argv.find((a) => a.startsWith('--break'));
const ORIGIN = 'https://austin3d.example', PAGE_HOSTS = new Set(['austin3d.example', 'data.texas.gov']);

// ---- the code under test, as one script: finder-live.js on top of transit-route.js (their imports/exports removed) ----
let live = read('../../js/finder-live.js').replace(/^\s*import\s+[^;]*from\s+'\.\/transit-route\.js';\s*$/m, '').replace(/^export /gm, '');
const route = read('../../js/transit-route.js').replace(/^export /gm, '');
if (BREAK === '--break') live = live.replace("box.append(opts.el('p', 'fd-live-credit', TL.credit));", "box.append(opts.el('p', 'fd-live-credit', TL.credit)); navigator.sendBeacon('https://data.texas.gov/log', JSON.stringify(to));");
if (BREAK === '--break=stop') live = live.replace('return () => { stopped = true;', 'return () => { /* broken: never stops */ void 0;').replace(/if \(window\.TransitLive\) \{ window\.TransitLive\.wantTrips\(false\); window\.TransitLive\.stop\(\); \} \};\s*$/m, '};');
const transit = read('../../js/transit-live.js');

// ---- the fake page ----
const T0 = 1791606130000;                                   // Fri 2026-10-09 23:22:10 Austin, 14 s after the saved feeds
let clock = T0;
const timers = []; let timerId = 0;
const sent = [];                                            // every attempt to reach the network, whatever the channel
const record = (kind, url, body) => sent.push({ kind, url: String(url), body: body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body) });

const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } };
const blobs = { 'eiei-9rpf': 0, 'rmk2-acnw': 0 };
const buf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body });
const ctx = {
  console, Promise, Uint8Array, DataView, URL, Intl, Map, Set, WeakMap, Math, Number, String, Array, Object, JSON, Error, encodeURIComponent, Date: FakeDate,
  setTimeout: (fn, ms) => { timers.push({ id: ++timerId, at: clock + (ms || 0), fn }); return timerId; },
  clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  setInterval: (fn) => { record('setInterval', 'timer'); return 0; }, clearInterval: () => {},
  location: { origin: ORIGIN, href: ORIGIN + '/', protocol: 'https:', host: 'austin3d.example' },
  fetch: (url, init) => {
    record('fetch', url, init && init.body);
    if (init && init.method && init.method !== 'GET') record('fetch-method:' + init.method, url);
    const u = new URL(url, ORIGIN);
    if (u.pathname === '/data/transit-live.json') return ok(JSON.parse(fx('bake-mini.json')));
    let m = u.pathname.match(/\/api\/views\/([a-z0-9-]+)\.json$/);
    if (m) { blobs[m[1]]++; return ok({ blobId: m[1] + '-b' + blobs[m[1]], blobFilename: m[1] === 'eiei-9rpf' ? 'v.pb' : 't.pb' }); }
    m = u.pathname.match(/\/api\/views\/([a-z0-9-]+)\/files\//);
    if (m) return ok(buf(fx(m[1] === 'eiei-9rpf' ? 'vehiclepositions.pb' : 'tripupdates.pb')));
    return Promise.resolve({ ok: false, status: 404 });
  },
  XMLHttpRequest: class { open(method, url) { this.u = url; this.m = method; } send(body) { record('xhr', this.u, body); } setRequestHeader() {} },
  Image: class { set src(v) { record('image', v); } },
  WebSocket: class { constructor(url) { record('websocket', url); } },
  navigator: { sendBeacon: (url, data) => { record('beacon', url, data); return true; } },
};
ctx.window = ctx; ctx.globalThis = ctx;
const listeners = [];
const track = (el) => { if (el && (el.src || el.href || el.action)) record('element:' + el.tagName, el.src || el.href || el.action); };
ctx.document = {
  visibilityState: 'visible', scripts: [{ getAttribute: (a) => (a === 'src' ? 'js/finder.js?v=1' : null) }],
  addEventListener: (t, f) => listeners.push(f), removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
  createElement: (tag) => ({ tagName: tag }),
  body: { append: (el) => { track(el); if (el.tagName === 'script') { vm.runInContext(transit, ctx); el.onload && el.onload(); } }, appendChild(el) { this.append(el); } },
  head: { append: track, appendChild: track },
};
vm.createContext(ctx);
vm.runInContext(live + '\n' + route + '\n;globalThis.__watch = watch;', ctx);

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {                                // run the fake timers due in the next `ms`, in order
  const end = clock + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    if (!timers.length || timers[0].at > end) break;
    const t = timers.shift(); clock = Math.max(clock, t.at); t.fn(); await flush();
  }
  clock = end; await flush();
}

// ---- the flow finder.js runs: heaviest class building of the schedule, its door, the selected home ----
const heaviest = [...sched.classes].sort((a, b) => b.meetings - a.meetings)[0];
const to = sched.buildings[heaviest.code].door, from = sched.home;
const box = { textContent: '', isConnected: true, append() {} };
let lines = 0;
const el = (tag, cls, text) => { if (/fd-live-line/.test(cls || '')) lines++; return { tag, cls, text }; };
const stop = ctx.__watch(box, from, to, { code: heaviest.code, el });
await flush(); await advance(5 * 60000);

let pass = 0; const check = (c, m) => { assert.ok(c, m); pass++; };
const canaries = [];
for (const c of sched.classes) canaries.push(c.title, c.code, c.title.split(' ')[0], c.title.toLowerCase());
for (const b of Object.values(sched.buildings)) for (const v of b.door) canaries.push(String(v), v.toFixed(4));
for (const v of from) canaries.push(String(v), v.toFixed(4));
canaries.push('ZZCANARY', 'ZQX', 'QQV');
const seen = (r) => decodeURIComponent(r.url) + '\n' + r.url + '\n' + r.body;

check(lines >= 10, `the live line was written and refreshed (${lines} times)`);
check(sent.length >= 20, `the page really talks to the network during 5 minutes (${sent.length} requests); a silent run proves nothing`);
check(sent.some((r) => /transit-live\.json/.test(r.url)) && sent.some((r) => /eiei-9rpf/.test(r.url)) && sent.some((r) => /rmk2-acnw/.test(r.url)), 'it fetched the baked slice, the vehicle feed and the trip feed');
for (const r of sent) {
  for (const c of canaries) assert.ok(!seen(r).includes(c), `${r.kind} ${r.url} carries a canary: ${c}`);
}
pass++;
const hosts = new Set(sent.filter((r) => /^(fetch|xhr|beacon|image|websocket|element:)/.test(r.kind)).map((r) => new URL(r.url, ORIGIN).host));
check([...hosts].every((h) => PAGE_HOSTS.has(h)), `the only hosts are the page's own origin and data.texas.gov (saw ${[...hosts].join(', ')})`);
check(sent.every((r) => r.kind === 'fetch' || r.kind.startsWith('element:script')), 'the only channels used are fetch and the one injected script (' + [...new Set(sent.map((r) => r.kind))].join(', ') + ')');
check(sent.every((r) => !r.body), 'no request carries a body');
check(sent.every((r) => !r.kind.startsWith('fetch-method')), 'every fetch is a plain GET');
const scripts = sent.filter((r) => r.kind === 'element:script');
check(scripts.length === 1 && scripts[0].url === 'js/transit-live.js?v=1', 'the one injected script is the page\'s own js/transit-live.js: ' + scripts.map((s) => s.url));
check(sent.filter((r) => r.kind === 'fetch' && /data\.texas\.gov/.test(r.url)).every((r) => /^https:\/\/data\.texas\.gov\/api\/views\/(eiei-9rpf|rmk2-acnw)(\.json$|\/files\/[a-z0-9-]+\?filename=[a-z.]+$)/.test(r.url)),
  'every data.texas.gov address is one of the two public feeds, with a name taken from the feed\'s own answer');

// ---- stop ----
stop();
const n = sent.length, pending = timers.length;
await advance(5 * 60000);
check(sent.length === n, `after stop() no request is made in 5 more minutes (${sent.length - n} new; ${pending} timers were pending at stop)`);
check(timers.length === 0, 'after stop() no timer is left (' + timers.length + ')');
check(listeners.length === 0, 'after stop() the visibilitychange listener is gone');

console.log(`PASS  finder-egress: ${sent.length} requests recorded over a 5-minute poll chain, none carries the schedule, the home or the door (${pass} checks)`);
