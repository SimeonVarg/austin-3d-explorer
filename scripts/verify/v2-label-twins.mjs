// v2-label-twins.mjs - one physical building, one name, counted over EVERY name v2 shows (no browser, no GPU, no server).
//   node scripts/verify/v2-label-twins.mjs        (Node >=22.15)
//
// 2026-10-24: the live site printed "Moore-Hill Dormitory" (the Blender model, named from the map) AND "Moore-Hill Residence Hall"
// (the university's name, from the walking graph) on one building. v2/labels.js merges two names by their WORDS (#528); "dormitory"
// and "residence hall" share none, and the next pair of names would be a different pair. The class is "two names, one footprint", so
// this check does not read words: it builds the real name list (blenderItems + homeItems + campusItems on the shipped data, through
// the city worker's own outlines), runs the app's own text merge, and counts the name pairs that stand on ONE map outline:
//   - a UT building (its doors) whose doors lie on the outlines of a Blender model, or an apartment on the same model as a Blender
//     model: a twin. The BEFORE count is the twins left by the text rule alone; the AFTER count is the twins left once the footprint
//     rule (labels.js mergeFootprints, which the app runs in every layout) has run. AFTER must be 0.
//   - "complex" pairs (one model several UT buildings land on: the DKR stands hold Bellmont Hall and both end-zone buildings) are
//     listed, not failed: they are different buildings under one roof of outlines.
// Also asserts the app really calls the rule (labels.js layout), and the Moore-Hill case itself.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadWorld, url } from './lib/v2-world.mjs';

const w = await loadWorld();
const { mergeNames, footprintTwins, mergeFootprints } = w.labels;
const F = w.field;

const items = [];
const textMerged = mergeNames(items, w.items);
console.log(`${w.items.length} names built; ${textMerged} merged by words; ${items.length} left`);

const before = footprintTwins(items, F);
console.log(`BEFORE (words only): ${before.twins.length} buildings with two names`);
for (const [keep, drop] of before.twins) console.log(`  ${keep.kind}:"${keep.name}"  +  ${drop.kind}:"${drop.name}"`);

const merged = mergeFootprints(items, F);
const after = footprintTwins(items, F);
console.log(`AFTER (footprint rule): ${after.twins.length} buildings with two names; ${merged.length} names merged; ${items.length} names left`);
const strongComplex = after.complexes;
const seen = new Set();
console.log(`complexes kept as separate names (listed, not failed): ${strongComplex.length} model/UT-building pairs`);
for (const [m, c] of strongComplex) { const k = m.name + '|' + c.name; if (!seen.has(k)) { seen.add(k); console.log(`  "${m.name}" (${m.ids.length} outlines)  /  "${c.name}"`); } }

// the case that started it
const mh = items.filter((i) => /moore-hill/i.test(i.name));
assert.equal(mh.length, 1, `Moore-Hill is one name, got ${mh.map((i) => i.name).join(' | ')}`);
assert.equal(mh[0].code, 'MHD', 'the surviving Moore-Hill name carries the UT building code (its card walks to it)');
// a UT building that is NOT under a model keeps its name (nothing is merged away by accident)
assert(items.filter((i) => i.kind === 'campus').length > 30, 'plain UT buildings keep their names');
// a dropped UT name does not take its walk away: the kept name has a UT code, so its card still routes
for (const [keep, drop] of merged) if (drop.code) assert(keep.code, `${keep.name} has a UT code after taking ${drop.name}`);
// the app runs the rule
const src = await readFile(url('v2/labels.js'), 'utf8');
assert(/layout\(now, W, H\) \{[^]*?this\.mergeFootprints\(\)/.test(src), 'Labels.layout() must call mergeFootprints()');
assert.equal(after.twins.length, 0, 'every building has one name');
console.log(`PASS one physical building, one name: ${before.twins.length} -> ${after.twins.length}`);
