/**
 * coverage.mjs - what Facet v0 covers of the catalog, and the order in which adding one layer type at a time would cover more.
 * Measured in metres of band height over every recipe in data/apartments (a band is a stretch of wall wearing one skin): NOT a triangle count
 * (a band's triangle count needs the dump). Greedy: at each step add the one capability that unblocks the most windowed band height.
 *   node experiments/facet/coverage.mjs
 */
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromRecipe } from './lib/facet.mjs';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/apartments'); const items = [];
for (const f of fs.readdirSync(dir)) { if (f === 'index.json' || !f.endsWith('.json')) continue; let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f))); } catch { continue; } if (!r.skins || !r.blocks) continue;
  const uses = []; for (const b of r.blocks) { for (const bd of b.bands || []) uses.push(bd); for (const fc of Object.values(b.faces || {})) for (const bd of (fc && fc.bands) || []) uses.push(bd); }
  for (const bd of uses) { const sk = r.skins[bd.skin]; if (!sk || bd.z1 == null) continue; const win = !!sk.window; let reasons = []; try { fromRecipe(r, bd.skin, bd); } catch (e) { if (!e.refused) continue; reasons = e.refused.map(x => x.replace(/^kind (\w+) is not.*$/, 'kind $1')); } items.push({ h: bd.z1 - bd.z0, win, reasons, b: r.name }); } }
const total = items.reduce((s, i) => s + i.h, 0), winTotal = items.filter(i => i.win).reduce((s, i) => s + i.h, 0);
console.log('band height total', total.toFixed(0), 'm; with windows', winTotal.toFixed(0), 'm (', (100 * winTotal / total).toFixed(0), '%)');
const have = new Set(); const order = [];
console.log('start: windowed height Facet v0 accepts', (100 * items.filter(i => i.win && !i.reasons.length).reduce((s, i) => s + i.h, 0) / winTotal).toFixed(0), '%');
for (let step = 0; step < 8; step++) {
  const cand = new Map(); for (const i of items) { if (!i.win || !i.reasons.length) continue; const need = i.reasons.filter(r => !have.has(r)); if (need.length === 1) cand.set(need[0], (cand.get(need[0]) || 0) + i.h); }
  const best = [...cand].sort((a, b) => b[1] - a[1])[0]; if (!best) break; have.add(best[0]); order.push(best);
  const acc = items.filter(i => i.win && i.reasons.every(r => have.has(r))).reduce((s, i) => s + i.h, 0);
  console.log(`add ${best[0]} -> windowed band height covered ${(100 * acc / winTotal).toFixed(0)}% of all windowed height (this step unlocks ${best[1].toFixed(0)} m)`);
}
const all = {}; for (const i of items) if (i.win && i.reasons.length) for (const r of i.reasons) all[r] = (all[r] || 0) + i.h; console.log('windowed height blocked by each reason (m):', JSON.stringify(Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]))));
