// Question (d): what does a walking-route query cost today, in JS? Uses the real js/walkgraph.js (the typed-array
// Dijkstra over data/walk_graph.json, 11,062 nodes / 11,997 edges) with memoisation off, over every code pair sampled.
//   node route-bench.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(repo, 'data/walk_graph.json'), 'utf8')) });
const m = await import(pathToFileURL(path.join(repo, 'js/walkgraph.js')).href);
m.WALKG.memo = false;
let t = performance.now(); const w = await m.walkProbe({ url: 'x' }); const loadMs = performance.now() - t;
const codes = w.codes.filter(c => w.has(c));
console.log(`graph decode+load (JSON parse included): ${loadMs.toFixed(1)} ms; ${w.graph.N} nodes; ${codes.length} walkable building codes`);
let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pairs = Array.from({ length: 400 }, () => [codes[Math.floor(rnd() * codes.length)], codes[Math.floor(rnd() * codes.length)]]).filter(p => p[0] !== p[1]);
for (let i = 0; i < 40; i++) w.route(...pairs[i]);   // warm
const runs = [];
for (let r = 0; r < 7; r++) { t = performance.now(); let ok = 0; for (const p of pairs) if (w.route(p[0], p[1])) ok++; runs.push((performance.now() - t) / pairs.length); if (r === 0) console.log(`${pairs.length} random pairs, ${ok} routable`); }
runs.sort((a, b) => a - b);
console.log(`route query (two Dijkstra passes: normal and fast-floor): min ${runs[0].toFixed(3)} ms, median ${runs[3].toFixed(3)} ms, max ${runs[6].toFixed(3)} ms per pair over 7 runs`);
