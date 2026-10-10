// Question (e): is decoding the live bus protobuf worth moving to wasm? Time the hand-written JS decoder from
// js/transit-live.js (branch mac/transit-live; it is not on main yet, so pass its path) on the real fixtures,
// then scale to the real feed sizes (vehicles about 20 KB, trip updates about 260 KB, per docs/transit-live.md).
//   node protobuf-decode.mjs <path/to/transit-live.js> <fixtureDir>     (fixtureDir has vehiclepositions.pb, tripupdates.pb)
import fs from 'node:fs'; import path from 'node:path';
const [file, dir] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf('let lo = 0, hi = 0;'), endMarker = '/* ---- state ---- */', b = src.indexOf(endMarker);
const body = src.slice(a, b);
const decode = new Function(`const STATUS = ['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO'];\n${body}\nreturn decode;`)();
for (const f of ['vehiclepositions.pb', 'tripupdates.pb']) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  const d = decode(bytes);
  let reps = 20000; for (let i = 0; i < 3000; i++) decode(bytes);   // warm
  const runs = []; for (let r = 0; r < 7; r++) { const t = performance.now(); for (let i = 0; i < reps; i++) decode(bytes); runs.push((performance.now() - t) / reps); }
  const us = Math.min(...runs) * 1000;
  console.log(`${f}: ${bytes.length} bytes -> ${d.vehicles.length} vehicles, ${d.trips.length} trips; min ${us.toFixed(1)} us per decode over 7 runs (${(bytes.length / us).toFixed(0)} MB/s)`);
  console.log(`   scaled to the live feed (MEASURED rate, EXTRAPOLATED size): ${f.startsWith('veh') ? '20 KB' : '260 KB'} -> ${(us * (f.startsWith('veh') ? 20000 : 260000) / bytes.length / 1000).toFixed(2)} ms per poll`);
}
