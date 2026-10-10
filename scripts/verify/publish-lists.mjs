// What the two hosts publish, held to what the site actually fetches. No browser, under a second.
//
// WHY. `.vercelignore` keeps build material out of the Vercel deployment, but GitHub Pages (deploy-pages.yml)
// uploads the whole repo root and never reads it. When experiments/ arrived (a 2 MB fixture, built .wasm files,
// 14 result files) neither host was told to leave it out. This pins the two lists to the facts:
//   1. experiments/ is ignored by Vercel AND removed before the Pages upload;
//   2. every .wasm the site's own code names is still published by both (the ignore must never swallow a file a
//      page fetches: pull request #440 fetches wasm/meshkernel.wasm behind ?rustbuilder=1);
//   3. nothing in js/ or index.html fetches, imports or links into experiments/.
//
//   node scripts/verify/publish-lists.mjs            exit 0 = consistent
//   node scripts/verify/publish-lists.mjs --break    plants "experiments/ is not ignored" and "wasm/ is ignored":
//                                                    must exit 1 (the check can fail)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const BREAK = process.argv.includes('--break');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// ── .vercelignore, the subset of gitignore syntax it uses: "dir/", "*.ext", exact path, blank, # comment
function parseIgnore(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}
function ignored(rules, relPath) {
  return rules.some(r => {
    if (r.endsWith('/')) return relPath === r.slice(0, -1) || relPath.startsWith(r);
    if (r.startsWith('*.')) return relPath.endsWith(r.slice(1));
    return relPath === r || relPath.startsWith(r + '/');
  });
}

let ignoreText = read('.vercelignore');
if (BREAK) ignoreText = ignoreText.replace(/^experiments\/$/m, '').concat('\nwasm/\n');
const rules = parseIgnore(ignoreText);

const pages = read('.github/workflows/deploy-pages.yml');
// folders the Pages job deletes before upload: every `rm -rf a b c` in a run step
const removed = new Set();
for (const m of pages.matchAll(/rm\s+-rf?\s+([^\n]+)/g)) for (const d of m[1].split(/\s+/)) if (d) removed.add(d.replace(/\/$/, ''));
if (BREAK) removed.delete('experiments');
const upload = pages.indexOf('upload-pages-artifact');
const rmAt = pages.search(/rm\s+-rf?\s/);

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

ok(ignored(rules, 'experiments/rust-mesh/dist/meshkernel.wasm'), '.vercelignore does not ignore experiments/ (fixtures, wasm and results would be deployed to Vercel)');
ok(removed.has('experiments') && rmAt >= 0 && rmAt < upload, 'deploy-pages.yml does not remove experiments/ BEFORE upload-pages-artifact (Pages would publish the studies)');

// every .wasm the site's own code names must survive both lists
const siteFiles = [];
for (const f of fs.readdirSync(path.join(root, 'js'))) if (f.endsWith('.js')) siteFiles.push('js/' + f);
siteFiles.push('index.html');
const wasmNames = new Set();
for (const f of siteFiles) {
  const src = read(f);
  for (const m of src.matchAll(/['"`]([\w./-]+\.wasm)['"`]/g)) {
    // a comment can name a file the page never fetches; only a literal in code counts
    const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    wasmNames.add(m[1].replace(/^\.?\//, ''));
  }
}
for (const w of wasmNames) {
  ok(!ignored(rules, w), `.vercelignore swallows ${w}, which the site fetches (a page would 404 on Vercel)`);
  ok(![...removed].some(d => w === d || w.startsWith(d + '/')), `deploy-pages.yml removes the folder holding ${w}, which the site fetches`);
  ok(fs.existsSync(path.join(root, w)), `${w} is named in the site's code but is not in the repo`);
}
if (BREAK) { ok(!ignored(rules, 'wasm/meshkernel.wasm'), 'planted: wasm/ is ignored'); }

// nothing in the running site reaches into experiments/
for (const f of siteFiles) {
  const src = read(f);
  const m = src.match(/(?:fetch\(|import\(|from\s|src=|href=|new URL\()\s*['"`][^'"`]*experiments\//);
  ok(!m, `${f} reaches into experiments/, which is not published`);
}

console.log(`wasm files named by the site: ${[...wasmNames].join(', ') || '(none)'}`);
if (fails.length) { for (const f of fails) console.log('FAIL: ' + f); process.exit(1); }
console.log('PASS: experiments/ is left out of both hosts; every wasm file the site fetches is still published');
