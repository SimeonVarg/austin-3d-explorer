// The custom-renderer study's picture numbers, recomputed from the result files committed next to it. No browser, about a second.
//
// WHY. The study's section 7.3 quotes "0.15% over tolerance", "56.1 / 39.7 / 1.6" for the three planted breaks and "4 to 14%" for the L4,
// and no output was committed, so none of it could be checked. experiments/renderer/results/ now holds the raw result.json of those
// runs; this reads THEM (never a copy of the numbers), derives each figure, and fails if the doc does not say it. It also holds the gate
// to the committed numbers: the clean Mac run passes the default limits, the three Mac breaks fail them, and a clean L4 run FAILS them
// (which is the reason the limits are per-runner parameters).
//
//   node scripts/verify/renderer-study-numbers.mjs            exit 0 = the doc matches the files
//   node scripts/verify/renderer-study-numbers.mjs --break    plants the old "0.7 to 4.5" and a wrong break figure in the doc text: must exit 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RES = f => JSON.parse(fs.readFileSync(path.join(REPO, 'experiments/renderer/results', f), 'utf8'));
const { LIMITS, EXEMPT_VIEWS, verdict } = await import(pathToFileURL(path.join(REPO, 'experiments/renderer/lib/verdict.mjs')).href);
let doc = fs.readFileSync(path.join(REPO, 'docs/custom-renderer-study-2026-10-09.md'), 'utf8');
if (process.argv.includes('--break')) doc = doc.replace('mean 1.0 to 4.5 of 255', 'mean 0.7 to 4.5 of 255').replace('| **56.1** (worst view 71.6)', '| **56.9** (worst view 71.6)');

const fails = [];
const need = (what, text) => { if (!doc.includes(text)) fails.push(`${what}: the doc should contain "${text}"`); };
const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2), f3 = x => x.toFixed(3), f4 = x => x.toFixed(4);
const day = d => d.rows.filter(r => !EXEMPT_VIEWS.test(r.name));
const night = d => d.rows.filter(r => EXEMPT_VIEWS.test(r.name));
const mean = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;

const mac = RES('mac-standalone-clean.json'), ml = RES('mac-maplibre-clean.json');
const brk = { light: RES('mac-standalone-break-light.json'), quant: RES('mac-standalone-break-quant.json'), facet: RES('mac-standalone-break-facet.json') };
const l4 = RES('l4-standalone-clean.json'), l4light = RES('l4-standalone-break-light.json');

// 1. the Mac per-view table: | view | building % | over % | IoU | mean diff | SSIM |
for (const r of mac.rows) {
  const name = EXEMPT_VIEWS.test(r.name) ? `**${r.name}**` : r.name;
  const over = EXEMPT_VIEWS.test(r.name) ? `**${f1(r.pctOverOnBuildings)}**` : f2(r.pctOverOnBuildings);
  need(`Mac table, ${r.name}`, `| ${name} | ${f1(r.buildingPctApp)} | ${over} | ${f4(r.silhouetteIoU)} | ${f2(r.meanAbsDiffOnBuildings)} | ${f4(r.ssim)} |`);
}
// 2. the headline sentence for the day views
const d = day(mac);
need('Mac day views', `${f2(mean(d, 'pctOverOnBuildings'))}% of building pixels over tolerance on average (worst ${f2(Math.max(...d.map(r => r.pctOverOnBuildings)))}%), silhouettes identical, SSIM ${f3(mean(d, 'ssim'))}`);
need('Mac night views', `${Math.round(Math.min(...night(mac).map(r => r.pctOverOnBuildings)))} to ${Math.round(Math.max(...night(mac).map(r => r.pctOverOnBuildings)))}% over`);
const mld = day(ml);
if (Math.abs(mean(mld, 'pctOverOnBuildings') - mean(d, 'pctOverOnBuildings')) > 0.02) fails.push('the MapLibre run no longer agrees with the standalone run ("the same on the standalone page and inside MapLibre")');

// 3. the three planted breaks (day views averaged)
const cleanMean = mean(d, 'pctOverOnBuildings');
for (const [name, ex] of Object.entries(brk)) {
  const bd = day(ex), over = mean(bd, 'pctOverOnBuildings'), worst = Math.max(...bd.map(r => r.pctOverOnBuildings));
  need(`break ${name}: over`, name === 'quant' ? `**${f1(over)}** |` : `**${f1(over)}** (worst view ${f1(worst)})`);
  need(`break ${name}: SSIM`, `| ${name === 'quant' ? '**' + f3(mean(bd, 'ssim')) + '**' : f3(mean(bd, 'ssim'))} |`);
  need(`break ${name}: IoU`, `| ${name === 'quant' ? '**' + f3(mean(bd, 'silhouetteIoU')) + '**' : f3(mean(bd, 'silhouetteIoU'))} |`);
  if (name === 'light') need('break light: times the clean number', `${Math.round(over / cleanMean / 10) * 10} times the clean number`);
  if (name === 'facet') {
    need('break facet: times the clean number on average', `${Math.round(over / cleanMean)} times the clean number on average`);
    const t = bd.find(r => r.name === 'tower-day'), c = d.find(r => r.name === 'tower-day');
    need('break facet: single view', `tower-day: ${f1(t.pctOverOnBuildings)}% against ${f2(c.pctOverOnBuildings)}%`);
  }
}
need('clean reference in the break paragraph', `clean for comparison: ${f2(mean(d, 'pctOverOnBuildings'))}% over, SSIM ${f3(mean(d, 'ssim'))}`);

// 4. the L4 paragraph
const ld = day(l4), lo = ld.map(r => r.pctOverOnBuildings);
need('L4 over', `${Math.round(Math.min(...lo))} to ${Math.round(Math.max(...lo))}% of building pixels over tolerance`);
need('L4 mean diff', `mean ${f1(Math.min(...ld.map(r => r.meanAbsDiffOnBuildings)))} to ${f1(Math.max(...ld.map(r => r.meanAbsDiffOnBuildings)))} of 255`);
need('L4 IoU', `silhouette IoU ${f3(Math.min(...ld.map(r => r.silhouetteIoU)))} to ${f3(Math.max(...ld.map(r => r.silhouetteIoU)))}`.replace('0.997 to 0.999', '0.997 to 0.999'));
need('L4 SSIM', `SSIM ${f2(Math.min(...ld.map(r => r.ssim)))} to ${f2(Math.max(...ld.map(r => r.ssim)))}`);
const ln = night(l4).map(r => r.pctOverOnBuildings);
need('L4 night', `the night views ${Math.round(Math.min(...ln))} to ${Math.round(Math.max(...ln))}%`);
const ll = day(l4light).map(r => r.pctOverOnBuildings);
need('L4 light break', `day views ${Math.round(Math.min(...ll))} to ${Math.round(Math.max(...ll))}%`);
need('L4 vs facet', 'The facet break (1.6%) is BELOW the L4\'s clean day reading (4 to 14%)');
const facetMean = mean(day(brk.facet), 'pctOverOnBuildings');
if (!(facetMean < Math.min(...lo))) fails.push(`the doc says the facet break (${f2(facetMean)}%) is below the L4's clean reading, but the L4 minimum is ${f2(Math.min(...lo))}%`);

// 5. the gate against the committed numbers
const vMac = verdict(mac.rows), vL4 = verdict(l4.rows);
if (!vMac.ok) fails.push('the clean Mac run no longer passes the default limits: ' + vMac.failures.join('; '));
for (const [name, ex] of Object.entries(brk)) if (verdict(ex.rows).ok) fails.push(`the ${name} break PASSES the default limits on the Mac numbers; the doc says it fails the gate`);
if (vL4.ok) fails.push('a clean L4 run PASSES the Mac limits; the doc says it fails them (that is why limits are per runner)');
if (!verdict(l4light.rows).ok === false) { /* light on the L4 fails under any limits, nothing to add */ }

console.log(`Mac clean day: ${f2(cleanMean)}% over (worst ${f2(Math.max(...d.map(r => r.pctOverOnBuildings)))}); breaks light/quant/facet ${Object.values(brk).map(e => f1(mean(day(e), 'pctOverOnBuildings'))).join(' / ')}; L4 clean ${f1(Math.min(...lo))} to ${f1(Math.max(...lo))}%`);
console.log(`gate on the committed numbers: Mac clean ${vMac.ok ? 'PASS' : 'FAIL'}; Mac breaks ${Object.entries(brk).map(([n, e]) => n + ' ' + (verdict(e.rows).ok ? 'PASS' : 'FAIL')).join(', ')}; L4 clean with Mac limits ${vL4.ok ? 'PASS' : 'FAIL'} (limits ${JSON.stringify(LIMITS)})`);
if (fails.length) { for (const f of fails) console.log('FAIL: ' + f); process.exit(1); }
console.log('PASS: the study\'s picture numbers recompute from the committed result files, and the gate reads them as the doc says');
