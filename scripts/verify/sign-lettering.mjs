/**
 * sign-lettering.mjs — no NEW pixel lettering on a building's sign. No browser.
 *
 * The app can draw a sign two ways: the old 5x7 dot font (`text` / `bitmap` on a sign: blocky letters) and smooth
 * outlines (`outline.polygons`, made by scripts/sign_outlines.py). On 2026-10-10 a new shop (Raising Cane's) went
 * live with its name in the dot font. The owner: "The canes logo is pixelated I thought that was never gonna happen
 * again". So the old way is frozen: only the recipes listed in sign-lettering-legacy.json may hold dot signs, and
 * none of them may hold MORE than it did that day. Everything else must use outlines.
 *
 *   node sign-lettering.mjs            every recipe in data/apartments
 *   node sign-lettering.mjs --break    proves the check can fail (a made-up recipe with one dot sign)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const LEGACY = JSON.parse(fs.readFileSync(path.join(HERE, 'sign-lettering-legacy.json'), 'utf8')).legacy;
const dotSigns = (o) => {
  let n = 0, smooth = 0;
  const walk = (x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x)) {
      if (k === 'signs' && Array.isArray(v)) {
        n += v.filter((s) => s && typeof s === 'object' && ('text' in s || 'bitmap' in s) && !s.outline).length;
        smooth += v.filter((s) => s && typeof s === 'object' && s.outline).length;
      }
      walk(v);
    }
  };
  walk(o); return { n, smooth };
};
const dir = path.join(ROOT, 'data/apartments');
const files = Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));
if (process.argv.includes('--break')) files['made-up-new-shop.json'] = { blocks: [{ faces: { u0: { bands: [{ signs: [{ text: 'SHOP', dot: 0.05 }] }] } } }] };

let bad = 0, checked = 0, dots = 0, outlines = 0;
for (const [f, doc] of Object.entries(files)) {
  const { n, smooth } = dotSigns(doc), allowed = LEGACY[f] || 0; checked++; dots += n; outlines += smooth;
  if (n > allowed) { bad++; console.log(`FAIL ${f}: ${n} sign(s) in the dot font (allowed ${allowed}). Draw the lettering as outlines: scripts/sign_outlines.py, then outline=load_sign(key) in the recipe's writer.`); }
}
for (const f of Object.keys(LEGACY)) if (!files[f]) console.log(`note: ${f} is in the legacy list but no longer exists; delete its line.`);
console.log(`${bad ? 'FAIL' : 'PASS'}  sign-lettering: ${checked} recipes, ${dots} legacy dot signs in ${Object.keys(LEGACY).length} frozen files, ${outlines} outline signs, ${bad} recipe(s) with new dot lettering`);
process.exit(bad ? 1 : 0);
