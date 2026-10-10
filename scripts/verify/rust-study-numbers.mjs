// The Rust study's headline numbers, recomputed from the result files committed next to it. No browser, no GPU, about a second.
//
// WHY. docs/rust-study-2026-10-09.md quoted "635 to 666 ms, 3.7x" and "7.18 s" that no committed file held; a reviewer recomputed
// the Node whole-build row from experiments/rust-mesh/results/ and got 6.83 s. A study whose numbers cannot be recomputed is an
// opinion. This reads the raw results (never a copy of the numbers), derives every figure the doc leads with, and fails if the doc
// does not contain it, or if any "Node A to B s" / "Chrome A to B s" sentence in the doc says something the results do not.
//
//   node scripts/verify/rust-study-numbers.mjs            exit 0 = the doc's headline numbers all recompute
//   node scripts/verify/rust-study-numbers.mjs --doc FILE checks another copy of the report
//   node scripts/verify/rust-study-numbers.mjs --break    plants the old wrong figures in the doc text in memory: must exit 1
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const R = f => path.join(root, 'experiments/rust-mesh/results', f);
const json = f => JSON.parse(fs.readFileSync(R(f), 'utf8'));
const docArg = process.argv.indexOf('--doc');   // check another copy of the report (e.g. an older one)
let doc = fs.readFileSync(docArg > 0 ? process.argv[docArg + 1] : path.join(root, 'docs/rust-study-2026-10-09.md'), 'utf8');
if (process.argv.includes('--break')) doc = doc.replace('662 / 673 / 683', '635 to 666').replace('4.06 / 6.83 / 13.3', '4.06 / 7.18 / 13.3').replaceAll('Node 6.8 to 3.6 s', 'Node 7.2 to 3.7 s');

const fails = [];
const need = (what, text) => { if (!doc.includes(text) && !doc.includes(text.replace(/^\| (\d+) \|$/, '**$1**'))) fails.push(`${what}: the doc should contain "${text}"`); };
const group = n => Math.round(n).toLocaleString('en-US');
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sec = (ms, hi) => (ms / 1000).toFixed(hi && ms >= 10000 ? 1 : 2);   // seconds; the slowest run of 10 s or more is quoted to one decimal

// ── 1. the kernel table (Node, CPU time of the process): node-kernel-cpu.json, plus the vertex-count-known row from its own file
const k = json('node-kernel-cpu.json').summary, kx = json('node-kernel-cpu-wasm-exact.json').summary;
const TRI = k.app.triangles;
if (TRI !== 3113629 || kx['wasm-exact'].triangles !== TRI) fails.push(`kernel files disagree on the triangle count (${TRI}, ${kx['wasm-exact'].triangles})`);
for (const [name, label] of [['app', 'shipped JS'], ['typed', 'tuned JS'], ['typed-exact', 'tuned JS, count known'], ['wasm', 'Rust/Wasm'], ['materialize', 'point arrays only']]) {
  const c = k[name].coldCpu;
  need(`kernel table, ${label}`, `${group(c.min)} / ${group(c.median)} / ${group(c.max)}`);
  if (name !== 'materialize') need(`kernel table, ${label} per million triangles`, `| ${Math.round(c.min / (TRI / 1e6))} |`);
}
const wx = kx['wasm-exact'].coldCpu;
need('kernel table, Rust/Wasm count known', `${group(wx.min)} / ${group(wx.median)} / ${group(wx.max)}`);
need('kernel table, Rust/Wasm count known per million triangles', `| ${Math.round(wx.min / (TRI / 1e6))} |`);
const base = Math.min(k.materialize.maxRssMB.min, kx.materialize.maxRssMB.min);
need('kernel table, shipped JS peak memory', `+${Math.round(k.app.maxRssMB.min - base)} MB`);
need('kernel table, Rust/Wasm count known peak memory', `+${Math.round(kx['wasm-exact'].maxRssMB.min - base)} MB`);
const x1 = k.app.coldCpu.min / k.wasm.coldCpu.min, x2 = k.app.coldCpu.min / wx.min;
need('kernel speedup', `${x1.toFixed(1)}x to ${x2.toFixed(1)}x less CPU than the shipped JS builder`);
need('kernel speedup, count known', `(${x2.toFixed(1)}x with the count known)`);

// ── 2. the whole build, Node: node-end-to-end.txt (3 rounds x 3 reps) and node-end-to-end-hint.txt (the same, other arms)
function parseRuns(f) {
  const out = {}; let cur = null;
  for (const l of fs.readFileSync(R(f), 'utf8').split('\n')) {
    let m = l.match(/^== round \d+ (\S+)/); if (m) { cur = m[1]; continue; }
    m = l.match(/^rep \d+: (\d+) ms wall, (\d+) ms cpu/); if (m && cur) (out[cur] ||= []).push([+m[1], +m[2]]);
  }
  return out;
}
const e1 = parseRuns('node-end-to-end.txt'), e2 = parseRuns('node-end-to-end-hint.txt');
const rows = {
  'shipped JS builder (18 builds)': [...e1.real, ...e2.real],
  'shipped JS builder, count passed in (9 builds)': e2['js-hint'],
  'Rust builder, count unknown (9 builds)': e1.wasm,
  'Rust builder, count known (18 builds)': [...e1['wasm-exact'], ...e2['wasm-exact']],
};
const node = {};
for (const [label, v] of Object.entries(rows)) {
  const w = v.map(x => x[0]), c = v.map(x => x[1]);
  node[label] = { min: Math.min(...w), med: median(w), max: Math.max(...w), cpu: median(c) };
  const n = node[label];
  need(`Node whole build, ${label}`, `${sec(n.min)} / ${sec(n.med)} / ${sec(n.max, true)} s`);
  need(`Node whole build CPU, ${label}`, `${(n.cpu / 1000).toFixed(1)} s CPU`);
}
const nodeFrom = node['shipped JS builder (18 builds)'].med / 1000, nodeTo = node['Rust builder, count known (18 builds)'].med / 1000;

// ── 3. the whole build, Chrome: the two committed JSON files
const cb = json('browser-build-real-wasm.json').modes;
const chrome = {};
for (const [mode, label] of [['real', 'shipped JS builder'], ['wasm', 'Rust builder, count unknown'], ['wasm-exact', 'Rust builder, count known']]) {
  chrome[mode] = cb[mode];
  need(`Chrome whole build, ${label}`, `${sec(cb[mode].min)} / ${sec(cb[mode].median)} / ${sec(cb[mode].max, true)} s`);
}
const nl = json('browser-build-real-timed-null.json').null;
need('Chrome generator alone', `${sec(nl.min)} s fastest, ${(nl.median / 1000).toFixed(1)} s median in Chrome`);

// ── 4. every "Node A to B s" / "Chrome A to B s" sentence in the doc is the medians the files give
const seen = { Node: 0, Chrome: 0 };
const expect = { Node: [nodeFrom, nodeTo], Chrome: [chrome.real.median / 1000, chrome['wasm-exact'].median / 1000] };
for (const m of doc.matchAll(/\b(Node|Chrome) (\d+\.\d) to (\d+\.\d) s/g)) {
  const [kind, a, b] = [m[1], m[2], m[3]];
  // "Node 4.1 to 6.8 s" in the compute-range sentence is fastest-to-median, not before-to-after: only sentences that pair a JS and a Rust figure are held
  const around = doc.slice(Math.max(0, m.index - 140), m.index + 160);
  if (!/halve|in half|median/.test(around) || /fastest to/.test(around)) continue;
  seen[kind]++;
  const [ea, eb] = expect[kind];
  if (a !== ea.toFixed(1) || b !== eb.toFixed(1)) fails.push(`the doc says "${m[0]}" but the files give ${kind} ${ea.toFixed(1)} to ${eb.toFixed(1)} s`);
}
if (!seen.Node) fails.push('found no "Node A to B s" sentence to hold to the files (did the wording move?)');

console.log(`kernel: shipped ${group(k.app.coldCpu.min)} ms CPU vs Rust ${group(k.wasm.coldCpu.min)} / ${group(wx.min)} (count known): ${x1.toFixed(2)}x / ${x2.toFixed(2)}x`);
console.log(`Node whole build medians: ${nodeFrom.toFixed(2)} s -> ${nodeTo.toFixed(2)} s; Chrome ${expect.Chrome.map(x => x.toFixed(2)).join(' -> ')} s`);
if (fails.length) { for (const f of fails) console.log('FAIL: ' + f); process.exit(1); }
console.log('PASS: every headline number in the Rust study recomputes from the committed result files');
