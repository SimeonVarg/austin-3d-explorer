/**
 * packverts-pixels.mjs — ?packverts=1 moves ZERO pixels.
 *
 * The same cameras, the same hours, the same page, with the switch off and with it on, then every pixel compared. packverts-decode.mjs
 * proves the CPU side (every packed vertex decodes to exactly the unpacked one, no browser); THIS proves the GPU side: that the
 * vertex shader reads the two float textures and arrives at the pixels the attributes gave it.
 *
 * It uses what the CI pictures use (ci/poses.json, scripts/verify/shot.mjs on _harness.html, software rendering so the picture is
 * deterministic, ?namelabels=0&facadepace=0&timeofdaypace=0 so the page is the same twice) and shoots THREE times: off, on, and off AGAIN
 * (the control: what the page moves against itself). The check passes when the "on" shoot differs from the "off" shoot by no more pixels
 * than the control does, which is zero when the page is deterministic. It is exact, not a tolerance: any channel, any amount.
 *
 *   node scripts/verify/packverts-pixels.mjs [--out DIR] [--poses file.json] [--phone] [--on "packverts=1&rustbuilder=1"]
 *   VERIFY_URL=http://127.0.0.1:PORT must point at a server of THIS checkout (scripts/serve.py), as for every check here.
 *     --phone  shoots at 390x844 @3x with ?lite=1 (the phone profile: chunked build, three.js frees the CPU copies), the packed layout over several chunks
 *     --on     the query that turns the switch on (default packverts=1); try "packverts=1&rustbuilder=1" for both switches
 *     --break  the "on" shoot is taken an hour later in the day; the check must report moved pixels and exit 1
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './lib/png.mjs';
import { BASE } from './chrome.mjs';
import { slowMachineEnv } from './ci/plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARAMS = {
  shotQuery: 'namelabels=0&facadepace=0&timeofdaypace=0',   // ci/pictures.mjs LOOK.shotQuery: the page is the same twice
  phone: { vp: '390x844x3', query: 'lite=1' },
  maxMovedPixels: 0,                                       // "on" may move no more pixels than the control moves (the control is 0 on a deterministic page)
  breakShiftP: 0.06,                                       // --break: the "on" shoot's time of day, later by this much of the day
  maxMs: 90 * 60 * 1000,
};
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(opt('--out', 'packverts-pixels-out'));
const POSES = path.resolve(opt('--poses', path.join(HERE, 'ci/poses.json')));
const PHONE = argv.includes('--phone'), BREAK = argv.includes('--break');
const ON_Q = opt('--on', 'packverts=1');
fs.mkdirSync(OUT, { recursive: true });
let poses = JSON.parse(fs.readFileSync(POSES, 'utf8'));

function shoot(side, query, posesFile) {
  const cwd = path.join(OUT, side); fs.mkdirSync(cwd, { recursive: true });
  const q = [PARAMS.shotQuery, PHONE ? PARAMS.phone.query : '', query].filter(Boolean).join('&');
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, 'shot.mjs'), side, posesFile], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...slowMachineEnv(), VERIFY_URL: BASE, VERIFY_MAX_MS: String(PARAMS.maxMs), SHOT_Q: q, ...(PHONE ? { SHOT_VP: PARAMS.phone.vp } : {}) },
    });
    let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    child.on('close', code => { fs.writeFileSync(path.join(OUT, side + '.log'), log); console.log(`shot ${side} (${q}): exit ${code}, ${Math.round((Date.now() - t0) / 1000)} s`); resolve(code); });
  });
}
const pic = (side, name) => path.join(OUT, side, 'shots', `${side}-${name}.png`);
function diff(a, b) {
  const A = decodePNG(a), B = decodePNG(b);
  if (A.width !== B.width || A.height !== B.height) throw new Error('size mismatch');
  const n = A.width * A.height; let moved = 0, max = 0, over12 = 0;
  for (let i = 0; i < n; i++) {
    let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i * A.bpp + c] - B.data[i * B.bpp + c]));
    if (d > 0) moved++; if (d > 12) over12++; if (d > max) max = d;
  }
  return { moved, over12, max, total: n };
}

const offPoses = path.join(OUT, 'poses-off.json'), onPoses = path.join(OUT, 'poses-on.json');
fs.writeFileSync(offPoses, JSON.stringify(poses));
fs.writeFileSync(onPoses, JSON.stringify(BREAK ? poses.map(p => ({ ...p, p: Math.min(1, p.p + PARAMS.breakShiftP) })) : poses));
await shoot('off', '', offPoses);
await shoot('on', ON_Q, onPoses);
await shoot('again', '', offPoses);

let bad = 0, shown = 0;
console.log(`\n${PHONE ? 'phone profile (390x844 @3x, ?lite=1)' : 'desktop (1440x900)'}: switch on = "${ON_Q}"${BREAK ? '  [--break: the on shoot is taken at a later hour]' : ''}`);
console.log('view                 moved px (on vs off)   control (off vs off)   max channel diff   over 12/255');
for (const p of poses) {
  let row;
  try {
    const on = diff(pic('off', p.name), pic('on', p.name)), ctl = diff(pic('off', p.name), pic('again', p.name));
    const ok = on.moved <= ctl.moved + PARAMS.maxMovedPixels;
    if (!ok) bad++; shown++;
    row = `${(ok ? 'same   ' : 'MOVED  ')}${p.name.padEnd(17)} ${String(on.moved).padStart(8)} (${(100 * on.moved / on.total).toFixed(4)}%)   ${String(ctl.moved).padStart(8)}             ${String(on.max).padStart(3)}              ${on.over12}`;
  } catch (e) { bad++; row = `ERROR  ${p.name.padEnd(17)} ${e.message}`; }
  console.log(row);
}
console.log(bad ? `\nFAIL: ${bad} of ${poses.length} view(s) moved pixels${BREAK ? ' (--break: this is the expected result)' : ''}` : `\nPASS: ${shown} views, zero pixels moved by ${ON_Q}`);
process.exit(bad ? 1 : 0);
