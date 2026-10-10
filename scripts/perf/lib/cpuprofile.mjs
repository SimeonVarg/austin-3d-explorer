/**
 * cpuprofile.mjs — read a V8 .cpuprofile (Chrome DevTools Profiler.stop) and answer: where did the
 * main thread's time go?
 *
 * Measures nothing by itself. Every number is derived from the sampled stacks of the profile you give
 * it, so it carries that profile's settings (sampling interval, CPU throttle, whether Chrome was busy
 * with other work). The sampling profiler itself costs a few percent, so these are upper bounds.
 *
 * A sample's duration is the time to the NEXT sample (timeDeltas[i+1]), the way DevTools attributes it.
 */
import fs from 'node:fs';

export function loadProfile(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

const short = url => {
  if (!url) return '';
  try { const u = new URL(url); return (u.host.startsWith('127.0.0.1') || u.host.startsWith('localhost') ? '' : u.host) + u.pathname.replace(/^\//, ''); }
  catch (e) { return url; }
};
const label = cf => {
  const f = short(cf.url);
  return (cf.functionName || '(anonymous)') + (f ? `  ${f}:${cf.lineNumber + 1}` : '');
};

export function analyse(profile, { top = 25, binMs = 1000 } = {}) {
  const nodes = new Map(); for (const n of profile.nodes) nodes.set(n.id, n);
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const { samples, timeDeltas } = profile;
  const N = samples.length;
  const dur = new Float64Array(N);
  for (let i = 0; i < N; i++) dur[i] = (i + 1 < N ? timeDeltas[i + 1] : 0) / 1000;   // ms
  const t = new Float64Array(N); let acc = 0;
  for (let i = 0; i < N; i++) { acc += timeDeltas[i] / 1000; t[i] = acc; }        // ms since profile start

  const keyOf = id => { const cf = nodes.get(id).callFrame; return label(cf); };
  const self = new Map(), incl = new Map(), spanFirst = new Map(), spanLast = new Map();
  const byFile = new Map();
  let total = 0, idle = 0, program = 0, gc = 0;
  const bins = new Map();
  for (let i = 0; i < N; i++) {
    const id = samples[i], d = dur[i], cf = nodes.get(id).callFrame, name = cf.functionName;
    total += d;
    if (name === '(idle)') { idle += d; continue; }
    if (name === '(program)') program += d;
    if (name === '(garbage collector)') gc += d;
    const k = keyOf(id); self.set(k, (self.get(k) || 0) + d);
    const file = short(cf.url) || name; byFile.set(file, (byFile.get(file) || 0) + d);
    const bin = Math.floor(t[i] / binMs);
    let b = bins.get(bin); if (!b) bins.set(bin, b = { busy: 0, files: new Map() });
    b.busy += d; b.files.set(file, (b.files.get(file) || 0) + d);
    // inclusive: each distinct function once per sample
    const seen = new Set();
    for (let n = id; n != null; n = parent.get(n)) {
      const nm = nodes.get(n).callFrame.functionName;
      if (nm === '(root)') break;
      const kk = keyOf(n); if (seen.has(kk)) continue; seen.add(kk);
      incl.set(kk, (incl.get(kk) || 0) + d);
      if (!spanFirst.has(kk)) spanFirst.set(kk, t[i]); spanLast.set(kk, t[i]);
    }
  }
  const rank = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const busy = total - idle;
  return {
    sampleCount: N, intervalUs: N > 1 ? Math.round((t[N - 1] - t[0]) * 1000 / (N - 1)) : null,
    totalMs: +total.toFixed(1), busyMs: +busy.toFixed(1), idleMs: +idle.toFixed(1), gcMs: +gc.toFixed(1), programMs: +program.toFixed(1),
    topSelf: rank(self, top).map(([k, v]) => ({ fn: k, selfMs: +v.toFixed(1), pctBusy: +(100 * v / busy).toFixed(1) })),
    topFiles: rank(byFile, 15).map(([k, v]) => ({ file: k, selfMs: +v.toFixed(1), pctBusy: +(100 * v / busy).toFixed(1) })),
    // functions from our own js/ whose subtree ran > 150 ms: the named phases
    phases: [...incl.entries()].filter(([k, v]) => v >= 150 && /\sjs\/[\w.-]+\.js:\d+$/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 40)
      .map(([k, v]) => ({ fn: k, inclusiveMs: +v.toFixed(1), firstAtMs: +spanFirst.get(k).toFixed(0), lastAtMs: +spanLast.get(k).toFixed(0) })),
    timeline: [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([bin, b]) => ({
      atS: bin * binMs / 1000, busyMs: +b.busy.toFixed(0), top: [...b.files.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([f, v]) => `${f} ${v.toFixed(0)}`).join(' | '),
    })),
  };
}

export function formatTop(a, n = 25) {
  const out = [`busy ${a.busyMs} ms of ${a.totalMs} ms sampled (idle ${a.idleMs}, GC ${a.gcMs}, (program) ${a.programMs}); ${a.sampleCount} samples every ~${a.intervalUs} us`];
  out.push('top self time:');
  a.topSelf.slice(0, n).forEach((r, i) => out.push(`${String(i + 1).padStart(3)}. ${String(r.selfMs).padStart(8)} ms ${String(r.pctBusy).padStart(5)}%  ${r.fn}`));
  out.push('by file:'); a.topFiles.forEach(r => out.push(`     ${String(r.selfMs).padStart(8)} ms ${String(r.pctBusy).padStart(5)}%  ${r.file}`));
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node cpuprofile.mjs <file.cpuprofile> [top=25] [--json]'); process.exit(2); }
  const a = analyse(loadProfile(file), { top: +(process.argv[3] || 25) });
  if (process.argv.includes('--json')) console.log(JSON.stringify(a, null, 1));
  else { console.log(formatTop(a, +(process.argv[3] || 25))); console.log('phases (inclusive >= 150 ms, own js/):'); a.phases.forEach(p => console.log(`  ${String(p.inclusiveMs).padStart(8)} ms  at ${p.firstAtMs}-${p.lastAtMs} ms  ${p.fn}`)); }
}
