/**
 * rest-rule.mjs - THE STILL-CAMERA ACCUMULATION'S RULE: when it shifts the lens, when it resets, and where its 16 shifts sit.
 *
 * NO BROWSER, NO GPU: Node and the repo's own js/frame-target.js (its makeRest() is plain state). Milliseconds. Runs in CI.
 * The picture side (does the mean equal a supersampled truth, does the page stop drawing) needs a GPU: rest-converge.mjs
 * and moire-bar.mjs.
 *
 *  1. THE SHIFTS are the 16 cells of a 4x4 grid in the pixel (the set moire-bar.mjs builds its truth from), opposite
 *     cells in turn (every even prefix is centred: the picture does not drift while it converges), the first 4 one per
 *     row and per column, the first 8 two per row and per column (where a slow device stops).
 *  2. A STILL CAMERA: plain frame, the wait, then 16 shifted frames whose weights 1/n make the plain mean, then done:
 *     nothing more is asked for, and MapLibre's own label re-check frames show the mean and change nothing.
 *  3. THE RESETS. A frame at another camera, a frame while the map is busy, and a frame somebody else asked for are
 *     drawn plain and void the mean. A wait restarts only on such a frame. A cycle broken at one camera waits twice as
 *     long each time and gives up after REST.maxBreaks; a camera move forgives.
 *  4. SOFT FRAMES (an animation of the content, FrameTarget.soft()): never a reset once converged, the shifts keep
 *     cycling through all 16, weight REST.softAlpha; while waiting they do not restart the wait; a soft frame mixed
 *     with a real request is a reset.
 *  5. Off is off: no shift, no wait.
 *
 *   node scripts/verify/rest-rule.mjs            exit 0 = all hold
 *   node scripts/verify/rest-rule.mjs --break    the rule is made deaf to outside requests: must FAIL (exit 1)
 */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BREAK = process.argv.includes('--break');
globalThis.window = globalThis; globalThis.location = { search: '' };
vm.runInThisContext(fs.readFileSync(path.join(REPO, 'js/frame-target.js'), 'utf8'), { filename: 'js/frame-target.js' });
const FT = globalThis.FrameTarget, P = FT.REST;
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
const make = () => { const r = FT.makeRest(P); if (BREAK) r.asked = () => {}; return r; };
const near = (a, b) => Math.abs(a - b) < 1e-12;

// ---- 1. the shifts ----
{
  const R = make(), o = Array.from({ length: 16 }, (_, k) => R.offset(k));
  const cell = v => Math.round((v + 0.5) * 4 - 0.5);
  const set = new Set(o.map(p => cell(p[0]) + ',' + cell(p[1])));
  say(set.size === 16 && o.every(p => p.every(v => [0, 1, 2, 3].includes(cell(v)) && near(v, (cell(v) + 0.5) / 4 - 0.5))), 'the 16 shifts are the 16 cells of a 4x4 grid, at the cell centres (the meter\'s truth samples)');
  say(o.every((p, k) => k % 2 === 0 || (near(p[0], -o[k - 1][0]) && near(p[1], -o[k - 1][1]))), 'opposite cells follow each other: every even prefix is centred');
  const per = (n, axis) => { const c = [0, 0, 0, 0]; for (let k = 0; k < n; k++) c[cell(o[k][axis])]++; return c.join(''); };
  say(per(4, 0) === '1111' && per(4, 1) === '1111', 'the first 4 shifts: one per column and one per row');
  say(per(8, 0) === '2222' && per(8, 1) === '2222', 'the first 8 shifts: two per column and two per row');
  say(Math.max(...o.flat().map(Math.abs)) < 0.5, 'no shift reaches half a pixel');
}

// one frame: outside requests first, then begin/end. Returns what the rule decided.
function frame(R, { cam = 'A', quiet = true, on = true, asked = 0, soft = 0 } = {}) {
  for (let i = 0; i < asked; i++) R.asked();
  for (let i = 0; i < soft; i++) { R.soft(); R.asked(); }       // an animator calls soft(), then triggerRepaint (which the page counts as a request)
  const shift = R.begin(cam, quiet, on), kind = R.S.kind, a = R.end(on);
  return { shift, kind, ...a, phase: R.S.phase };
}
const converge = (R, cam = 'A') => { let f = frame(R, { cam, asked: 1 }); R.start(); const out = []; do { f = frame(R, { cam }); out.push(f); } while (f.again); return out; };

// ---- 2. a still camera ----
{
  const R = make();
  const f0 = frame(R, { asked: 1 });
  say(f0.kind === 'plain' && !f0.shift && !f0.mean && f0.wait === P.delayMs && f0.phase === 'wait', `the first frame at a camera is plain and starts the wait (${f0.wait} ms)`);
  say(R.start() === true && R.S.phase === 'cycle', 'the wait over: a cycle starts');
  const vals = [], seen = new Set(); let mean = 0, ok = true, last = null;
  for (let n = 1; n <= 16; n++) {
    const f = frame(R); last = f;
    if (f.kind !== 'sample' || !f.shift || !f.mean || !near(f.weight, 1 / n) || f.again !== (n < 16)) ok = false;
    seen.add(f.shift.join(',')); const v = Math.sin(n * 7.3) * 100; vals.push(v); mean = mean * (1 - f.weight) + v * f.weight;
  }
  say(ok && seen.size === 16, '16 frames follow, each with its own shift, weights 1, 1/2 ... 1/16, each asking for the next but the last');
  say(Math.abs(mean - vals.reduce((a, b) => a + b, 0) / 16) < 1e-9, 'those weights make the plain mean of the 16 frames');
  say(last.phase === 'done' && last.again === false && last.wait === 0, 'then it is done: nothing more is asked for');
  const h = frame(R);
  say(h.kind === 'hold' && !h.shift && h.mean && h.weight === 0 && !h.again && h.wait === 0 && h.phase === 'done', 'a frame nobody outside asked for (MapLibre checking its labels) shows the mean and changes nothing');
  const R8 = make(); frame(R8, { asked: 1 }); R8.start(8); let n8 = 0, f8; do { f8 = frame(R8); n8++; } while (f8.again);
  say(n8 === 8 && f8.phase === 'done' && near(f8.weight, 1 / 8), 'a slow device\'s cycle of 8 is done after 8');
}

// ---- 3. the resets ----
{
  let R = make(); converge(R);
  let f = frame(R, { cam: 'B', asked: 1 });
  say(f.kind === 'plain' && !f.mean && !f.shift && f.phase === 'wait' && f.wait === P.delayMs && R.S.breaks === 0, 'converged, then the camera moves: a plain frame, the mean is void, the wait starts again');
  R = make(); converge(R); f = frame(R, { asked: 1 });
  say(f.kind === 'plain' && !f.mean && f.phase === 'wait' && f.wait === P.delayMs, 'converged, then somebody asks for a frame at the same camera (data, the hour): the same');
  R = make(); converge(R); f = frame(R, { quiet: false });
  say(f.kind === 'plain' && !f.mean, 'converged, then a frame while the map moves, loads or fades labels: plain');
  R = make(); frame(R, { asked: 1 }); R.start(); frame(R); frame(R); f = frame(R, { cam: 'B', asked: 1 });
  say(f.kind === 'plain' && f.wait === P.delayMs && R.S.breaks === 0 && R.S.n === 0, 'a camera move in the middle of a cycle: plain, nothing kept, and it is not counted as a broken cycle');
  // a wait restarts only on a real change
  R = make(); frame(R, { asked: 1 }); f = frame(R);
  say(f.kind === 'plain' && f.wait === -1, 'while waiting, a frame nobody outside asked for leaves the wait running');
  f = frame(R, { asked: 1 });
  say(f.kind === 'plain' && f.wait === P.delayMs, 'while waiting, a frame somebody asked for restarts the wait');
  // broken cycles back off, then give up; a camera move forgives
  R = make(); frame(R, { asked: 1 }); const waits = [];
  for (let b = 0; b < P.maxBreaks; b++) { R.start(); frame(R); frame(R); f = frame(R, { asked: 1 }); waits.push(f.wait); }
  say(waits.slice(0, -1).every((w, i) => w === P.delayMs * 2 ** (i + 1)) && waits[waits.length - 1] === 0 && R.S.phase === 'plain' && R.start() === false,
    `a cycle broken at one camera waits longer each time (${waits.slice(0, -1).join(', ')} ms) and gives up after ${P.maxBreaks}`);
  f = frame(R, { cam: 'B', asked: 1 });
  say(f.wait === P.delayMs && R.S.breaks === 0 && R.start() === true, 'a camera move forgives: the next camera gets its cycle');
  // the first frame of a cycle is always a fresh start, whoever asked for it
  R = make(); frame(R, { asked: 1 }); R.start(); f = frame(R, { asked: 1 });
  say(f.kind === 'sample' && near(f.weight, 1), 'the first frame of a cycle takes whatever is on the page (weight 1), whoever asked for it');
}

// ---- 4. soft frames ----
{
  let R = make(); converge(R);
  const shifts = new Set(); let ok = true, f;
  for (let i = 0; i < 16; i++) { f = frame(R, { soft: 1 }); if (f.kind !== 'soft' || !f.shift || !f.mean || f.weight !== P.softAlpha || f.again || f.phase !== 'done') ok = false; shifts.add(f.shift.join(',')); }
  say(ok && shifts.size === 16, `converged, then 16 soft frames: none resets, each is shifted (all 16 shifts in turn) and enters the mean with weight ${P.softAlpha}`);
  f = frame(R, { soft: 1, asked: 1 });
  say(f.kind === 'plain' && f.phase === 'wait', 'a soft frame together with a real request is a reset');
  R = make(); frame(R, { asked: 1 }); f = frame(R, { soft: 1 });
  say(f.kind === 'plain' && f.wait === -1, 'while waiting, a soft frame is drawn plain and leaves the wait running (a 15 Hz animation cannot starve the cycle)');
  R.start(); f = frame(R, { soft: 1 }); const g = frame(R, { soft: 1 });
  say(f.kind === 'sample' && g.kind === 'sample' && near(g.weight, 1 / 2), 'during a cycle a soft frame is one more sample');
}

// ---- 5. off ----
{
  const R = make(); let ok = true;
  for (let i = 0; i < 5; i++) { const f = frame(R, { on: false, asked: i ? 0 : 1 }); if (f.kind !== 'plain' || f.shift || f.mean || f.wait !== 0 || f.again) ok = false; }
  say(ok && R.start() === false, 'switched off: every frame plain, no shift, no wait');
}
console.log(failed ? `\n${failed} FAILED` : '\nall hold');
process.exit(failed ? 1 : 0);
