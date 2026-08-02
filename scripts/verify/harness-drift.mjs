/**
 * harness-drift.mjs — does _harness.html load the same city index.html does?
 *
 * WHY THIS HAS TO EXIST. `_harness.html` is a hand-maintained duplicate of
 * index.html's script list, and it is the page every pixel-sampling script
 * loads, because index.html does not keep the drawing buffer and `readPixels`
 * on a swapped buffer returns black.
 *
 * So a module missing from the harness produces a scene that looks completely
 * plausible and IS NOT THE ONE THE SITE SERVES — and every number measured
 * against it is a number about a different build. The file's own comment has
 * warned about this since `capitol.js` was added to index.html first and three
 * shot runs "proved" the Capitol Complex had not changed.
 *
 * It happened again anyway. On 2026-08-02 the harness was missing `js/tiles.js`,
 * so every night-pale run, every luma probe and every pixel assertion for an
 * unknown number of passes was measured on a city with NO VECTOR TILES — the
 * GeoJSON fallbacks, which is not what the site serves.
 *
 * AND THIS SCRIPT IMMEDIATELY EARNED ITSELF. The report that prompted it said
 * `js/outer.js` was missing too. It was not: a `grep` for `js/[a-z0-9]*\.js`
 * matches the module names inside COMMENTS as readily as inside script tags, and
 * both files talk about outer.js in prose. Adding it "back" introduced a
 * duplicate <script> tag, and the first run of this check caught it. Hence the
 * duplicate test below, and hence parsing `<script src="...">` rather than
 * grepping for filenames.
 *
 * Pure text: no browser, no server, runs in milliseconds. Put it first in any
 * suite.
 *
 * Usage:  node scripts/verify/harness-drift.mjs
 */
import fs from 'node:fs';

const scriptsIn = (file) => {
  const html = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<script\s+src="(js\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
};

const site = scriptsIn('index.html');
const harness = scriptsIn('_harness.html');

const siteSet = new Set(site);
const harnessSet = new Set(harness);
const missing = site.filter(s => !harnessSet.has(s));
const extra = harness.filter(s => !siteSet.has(s));
const dupes = harness.filter((v, i) => harness.indexOf(v) !== i);

// ORDER MATTERS FOR ONE OF THEM AND ONLY ONE, so it is checked by name rather
// than by comparing the whole sequence: js/tiles.js registers the pmtiles://
// protocol and calls setWorkerCount, and both have to happen before any Map is
// constructed. Everything else is a window assignment that the app awaits.
const tilesIdx = harness.indexOf('js/tiles.js');
const orderBad = tilesIdx > 0;

console.log(`index.html:    ${site.length} scripts`);
console.log(`_harness.html: ${harness.length} scripts`);

let bad = false;
if (missing.length) {
  bad = true;
  console.log('\n*FAIL — in index.html but NOT in _harness.html:');
  for (const s of missing) console.log('   ' + s);
  console.log('  Every pixel measured through the harness is of a different city.');
}
if (extra.length) {
  bad = true;
  console.log('\n*FAIL — in _harness.html but NOT in index.html:');
  for (const s of extra) console.log('   ' + s);
}
if (dupes.length) {
  bad = true;
  console.log('\n*FAIL — loaded TWICE by _harness.html:');
  for (const s of dupes) console.log('   ' + s);
  console.log('  A module that self-boots will run its init twice.');
}
if (orderBad) {
  bad = true;
  console.log(`\n*FAIL — js/tiles.js is at position ${tilesIdx}, must be first:`);
  console.log('  it registers the pmtiles:// protocol and must run before any Map.');
}
if (!bad) console.log('\n PASS  the harness loads the same city the site does');

process.exit(bad ? 1 : 0);
