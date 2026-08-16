// dupids.mjs — the ownership audit across every bake in data/.
//
// Every bake declares a top-level `replacedBuildingIds` array; app.js filters
// those ids out of `buildings-3d`. If two bakes claim the SAME id, only one
// filter entry is needed to hide the generic building, but BOTH bakes still
// emit their own geometry for it — so one authored building renders inside the
// other. Coplanar walls at the same height are the textbook z-fighting case,
// and a stray tall band from the loser reads as "a long line shooting out".
//
// This is a static check: no browser, no server, no camera. Run it before
// diagnosing anything visual.
//
//   node scripts/verify/dupids.mjs
//
// Exit code 1 if any id is claimed twice, or if a claimed id is missing from
// the snapshot (a bake claiming an id that does not exist hides nothing and
// usually means the id set was derived against a different snapshot).

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'data');
// READ THE SNAPSHOT THE APP ACTUALLY LOADS, not a date frozen into this file.
//
// js/app.js boots on `data/manifest.json`'s `latest`. This line said
// '2026-07-30' and stayed there while eight newer snapshots landed — so on
// 2026-08-16, with the app rendering the 2026-08-16 snapshot, the
// "claimed but not in the detailed snapshot" half of this audit was comparing
// bake claims against a building set six weeks stale. That is this repo's
// signature failure: a guard passing because it is not looking at the thing it
// guards. The date is now derived, and an unreadable manifest is a hard error
// rather than a silent fallback.
const MANIFEST = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));
// `--snapshot <date>` overrides it. That exists so this gate can be WATCHED
// FAILING against an older snapshot without editing data/manifest.json — a
// guard nobody has seen go red is not evidence of anything.
const snapArg = process.argv.indexOf('--snapshot');
const SNAP_DATE = snapArg >= 0 ? process.argv[snapArg + 1] : MANIFEST.latest;
if (!SNAP_DATE) { console.error('data/manifest.json has no `latest`'); process.exit(2); }
const SNAP = join(DATA, 'snapshots', SNAP_DATE, 'buildings.detailed.geojson');

console.log(`snapshot ${SNAP_DATE}${snapArg >= 0 ? '  (--snapshot override; manifest.latest is ' + MANIFEST.latest + ')' : '  (from data/manifest.json latest)'}`);

const files = readdirSync(DATA).filter((f) => f.endsWith('.geojson'));

// id -> [{file, count}]
const claims = new Map();
const perFile = [];

for (const f of files) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
  } catch (e) {
    console.log(`  ${f.padEnd(28)} UNPARSEABLE (${e.message.slice(0, 60)})`);
    continue;
  }
  const ids = j.replacedBuildingIds;
  if (!Array.isArray(ids)) continue;
  const uniq = new Set(ids.map(String));
  perFile.push({ file: f, n: ids.length, uniq: uniq.size, features: (j.features || []).length });
  for (const id of uniq) {
    if (!claims.has(id)) claims.set(id, []);
    claims.get(id).push(f);
  }
  // self-duplicates inside one file are harmless for the filter but signal a
  // bake that emitted the same building twice.
  if (uniq.size !== ids.length) {
    console.log(`  NOTE ${f}: ${ids.length - uniq.size} repeated id(s) within its own array`);
  }
}

console.log('\nreplacedBuildingIds by file');
console.log('  ' + 'file'.padEnd(28) + 'claimed'.padStart(8) + 'unique'.padStart(8) + 'features'.padStart(10));
for (const r of perFile.sort((a, b) => b.n - a.n)) {
  console.log(
    '  ' + r.file.padEnd(28) + String(r.n).padStart(8) + String(r.uniq).padStart(8) + String(r.features).padStart(10)
  );
}
const total = perFile.reduce((s, r) => s + r.uniq, 0);
console.log('  ' + 'TOTAL'.padEnd(28) + String(total).padStart(8) + String(claims.size).padStart(8));

// --- the actual check -------------------------------------------------------
const dupes = [...claims.entries()].filter(([, fs]) => fs.length > 1);

// Names, so a collision is legible without opening the snapshot by hand.
let names = new Map();
try {
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  for (const f of snap.features) {
    const p = f.properties || {};
    names.set(String(p.id), `${p.name || '(unnamed)'} h=${p.final_height}`);
  }
} catch (e) {
  console.log(`\n(could not read snapshot for names: ${e.message})`);
}

console.log('\nCOLLISIONS (one id claimed by two or more bakes)');
if (!dupes.length) {
  console.log('  none');
} else {
  for (const [id, fs] of dupes.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  id ${id.padEnd(14)} ${fs.join(' + ')}`);
    if (names.has(id)) console.log(`      ${names.get(id)}`);
  }
}

// --- claimed-but-absent -----------------------------------------------------
let phantom = [];
if (names.size) {
  phantom = [...claims.keys()].filter((id) => !names.has(id));
  console.log('\nCLAIMED BUT NOT IN THE DETAILED SNAPSHOT');
  if (!phantom.length) console.log('  none');
  else for (const id of phantom.slice(0, 40)) console.log(`  id ${id.padEnd(14)} ${claims.get(id).join(' + ')}`);
  if (phantom.length > 40) console.log(`  ... and ${phantom.length - 40} more`);
}

console.log('');
process.exit(dupes.length || phantom.length ? 1 : 0);
