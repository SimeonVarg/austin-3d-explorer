/**
 * build-worker-client.mjs — the main-thread side of the build worker (js/apartments-worker.js) NEVER hangs and always reports why.
 *
 * js/slopes-apartments.js turns any rejection of startBuildWorker()/build() into the main-thread build (one console line, no retry), so what keeps the page
 * from being left without buildings is that every way a worker can go wrong is a REJECTION within a bounded time, with the worker terminated:
 *   no Worker in the browser          a Worker constructor that throws          a script that will not load (the worker's error event)
 *   an { error } during init          a throw mid-build ({ error })             a worker that never says ready (readyMs)
 *   a worker that never answers the build (buildMs)                              an unreadable message (messageerror)
 * plus the one that must work: ready, then done -> the payload, and the worker is not terminated until the page asks.
 *
 * No browser, no three.js: a fake Worker drives the real module. Each scenario has its own watchdog (WATCHDOG_MS); a hang is a FAIL, not a stuck run.
 *
 *   node scripts/verify/build-worker-client.mjs [--break]
 *   --break  runs the module with its two timers removed: the "never answers" scenarios must FAIL (hang) and the exit code is 1
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCHDOG_MS = 1500, SHORT_MS = 60;   // the scenarios give the module 60 ms; anything still pending after 1.5 s is a hang
const BREAK = process.argv.includes('--break');
let src = fs.readFileSync(path.join(REPO, 'js/apartments-worker.js'), 'utf8');
if (BREAK) { const n = src.split('timer = setTimeout(').length - 1; src = src.replace('timer = setTimeout(', 'timer = (() => 0)('); if (n !== 1) { console.log('FAIL: expected one timer in the module, found ' + n); process.exit(1); } }
const tmp = path.join(os.tmpdir(), 'bwc-' + process.pid + '.mjs'); fs.writeFileSync(tmp, src);

globalThis.location = { href: 'http://x/index.html?lite=1&buildworker=1', search: '?lite=1&buildworker=1' };
globalThis.document = { querySelector: () => ({ src: 'https://unpkg.com/three@0.159.0/build/three.min.js' }) };
let made = [];
// a fake dedicated worker: `script(w, msg)` decides what it does with each message the page posts
const fake = script => class FakeWorker extends EventTarget {
  constructor(url) { super(); this.url = String(url); this.terminated = false; if (script.ctor) script.ctor(this); made.push(this); if (script.load) queueMicrotask(() => script.load(this)); }
  postMessage(m) { if (!this.terminated && script.on) queueMicrotask(() => script.on(this, m)); }
  terminate() { this.terminated = true; }
  say(data) { if (!this.terminated) this.dispatchEvent(Object.assign(new Event('message'), { data })); }
  err(message) { if (!this.terminated) this.dispatchEvent(Object.assign(new Event('error'), { message })); }
  bad() { if (!this.terminated) this.dispatchEvent(new Event('messageerror')); }
};
const { startBuildWorker } = await import(pathToFileURL(tmp));
const watch = (p, what) => Promise.race([p.then(v => ({ v }), e => ({ e })), new Promise(r => setTimeout(() => r({ hung: what }), WATCHDOG_MS))]);

let bad = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) bad++; };
const reject = async (name, W, want, { build = false } = {}) => {
  made = []; if (W) globalThis.Worker = W; else delete globalThis.Worker;
  const start = await watch(startBuildWorker({ readyMs: SHORT_MS, buildMs: SHORT_MS }), name + ' (start)');
  let r = start;
  if (build && start.v) r = await watch(start.v.build([{ name: 'x' }], {}), name + ' (build)');
  const w = made[0];
  const ok = r.e && want.test(r.e.message) && (!w || w.terminated);
  say(!!ok, `${name}: ${r.hung ? 'HUNG past ' + WATCHDOG_MS + ' ms (' + r.hung + ')' : r.e ? 'rejects: "' + r.e.message + '"' : 'did not reject'}${w ? ', worker ' + (w.terminated ? 'terminated' : 'NOT terminated') : ''}`);
};

await reject('no Worker in the browser', null, /no Web Workers/);
await reject('a Worker constructor that throws', fake({ ctor() { throw new Error('SecurityError'); } }), /could not start the worker: SecurityError/);
await reject('a script that will not load', fake({ load: w => w.err('') }), /worker error/);
await reject('an error during init', fake({ on: (w, m) => m.init && w.say({ error: 'Error: importScripts failed\n  at x' }) }), /the worker threw: Error: importScripts failed/);
await reject('a worker that never says ready', fake({}), /did not answer in \d+ s \(loading its scripts\)|did not answer/);
await reject('an unreadable message', fake({ on: (w, m) => m.init && w.bad() }), /could not read/);
await reject('a throw mid-build', fake({ on: (w, m) => { if (m.init) w.say({ ready: true }); else if (m.build) w.say({ error: 'RangeError: Invalid typed array length' }); } }), /the worker threw: RangeError/, { build: true });
await reject('a worker that never answers the build', fake({ on: (w, m) => { if (m.init) w.say({ ready: true }); } }), /did not answer in \d+ s \(building\)|did not answer/, { build: true });

{   // the one that must work
  made = []; globalThis.Worker = fake({ on: (w, m) => { if (m.init) w.say({ ready: true }); else if (m.build) w.say({ done: { meshes: [], triangles: 7, specsSeen: m.build.specs.length, bf: m.build.byteFloats } }); } });
  const c = await watch(startBuildWorker({ readyMs: 1000, buildMs: 1000 }), 'ok start');
  const r = c.v ? await watch(c.v.build([{ name: 'a' }, { name: 'b' }], { byteFloats: [0, 1] }), 'ok build') : c;
  const w = made[0];
  say(!!(r.v && r.v.triangles === 7 && r.v.specsSeen === 2 && r.v.bf.length === 2 && !w.terminated), 'a good worker: ready, then done -> the payload (specs and the byte rule reach the worker), not terminated until the page asks');
  say(!!(w.url.includes('slopes=0') && w.url.includes('lite=1') && !w.url.includes('buildworker')), `the worker URL carries the page's flags, slopes=0, and no buildworker (${w.url.split('?')[1]})`);
  c.v && c.v.terminate(); say(w.terminated, 'terminate() terminates it');
}
fs.rmSync(tmp, { force: true });
console.log(bad ? `\nFAIL: ${bad} scenario(s)` : '\nPASS: every way a worker can go wrong is a bounded rejection');
process.exit(bad ? 1 : 0);
