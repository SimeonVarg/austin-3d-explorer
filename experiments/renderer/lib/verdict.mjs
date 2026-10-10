/**
 * lib/verdict.mjs - turns compare.mjs's per-view numbers into PASS or FAIL. Pure: numbers in, verdict out, no browser, no files,
 * so selftest-compare.mjs can feed it planted breaks and a clean run and hold it to failing and passing.
 *
 * The limits are NAMED PARAMETERS (nothing is buried in a function body), each with the reason for its value. They are calibrated to
 * ONE runner: the Mac iGPU (Metal), where the clean prototype reads a worst day view of 0.28% of building pixels over tolerance.
 * The AWS L4 (NVIDIA, OpenGL ES through ANGLE) reads 4 to 14% on the SAME clean code, so on that runner the limits must be re-set
 * (compare.mjs --max-over ... ) from an app-against-app run on it; the study says plainly that the facet break (1.6%) cannot be told
 * from clean there, only the light and quant breaks can.
 */
export const LIMITS = {
  maxPctOverOnBuildings: 1.0,   // % of building pixels more than the tolerance away. Mac clean: worst 0.28. Breaks: facet 1.6 (worst view 4.0), quant 39.7, light 56.1
  minSsim: 0.985,               // Mac clean: worst 0.9944. Breaks: facet 0.994 (not caught by this one), quant 0.434, light 0.912
  minSilhouetteIoU: 0.998,      // Mac clean: worst 0.9999. quant 0.955 is the only break that moves the silhouette
  maxMeanAbsDiff: 1.0,          // 0-255 per channel over building pixels. Mac clean: worst 0.29
  minBuildingPct: 0.4,          // a view must show at least this % building pixels (same as images.mjs LOOK.minBuildingPct), in the app AND the prototype
};
/** Views the prototype knowingly does not match: the night lamps, window emission and u_nightWallAmbient are not ported (study 7.3). They must still SHOW buildings. */
export const EXEMPT_VIEWS = /-night$/;

/** rows: compareImages() results with a `name`. Returns { ok, checked, exempt, failures: [string] }. */
export function verdict(rows, limits = LIMITS, exempt = EXEMPT_VIEWS) {
  const failures = [], checkedNames = [], exemptNames = [];
  if (!rows.length) failures.push('no views were scored at all');
  for (const r of rows) {
    if (r.error) { failures.push(`${r.name}: ${r.error}`); continue; }
    // an empty view proves nothing: it used to be dropped from the summary without a word, so a camera that lost its buildings made the mean look BETTER
    if (!r.showsBuildings || !(r.buildingPctApp >= limits.minBuildingPct)) { failures.push(`${r.name}: EMPTY VIEW, the app picture shows ${r.buildingPctApp}% building pixels (need ${limits.minBuildingPct}%) and the prototype ${r.buildingPctProto}%; a view with no buildings cannot pass`); continue; }
    if (!(r.buildingPctProto >= limits.minBuildingPct)) { failures.push(`${r.name}: the prototype draws ${r.buildingPctProto}% building pixels against the app's ${r.buildingPctApp}%`); continue; }
    if (exempt && exempt.test(r.name)) { exemptNames.push(r.name); continue; }
    checkedNames.push(r.name);
    if (r.pctOverOnBuildings > limits.maxPctOverOnBuildings) failures.push(`${r.name}: ${r.pctOverOnBuildings}% of building pixels over tolerance (limit ${limits.maxPctOverOnBuildings})`);
    if (r.ssim < limits.minSsim) failures.push(`${r.name}: SSIM ${r.ssim} (limit ${limits.minSsim})`);
    if (r.silhouetteIoU < limits.minSilhouetteIoU) failures.push(`${r.name}: silhouette IoU ${r.silhouetteIoU} (limit ${limits.minSilhouetteIoU})`);
    if (r.meanAbsDiffOnBuildings > limits.maxMeanAbsDiff) failures.push(`${r.name}: mean colour difference ${r.meanAbsDiffOnBuildings} of 255 (limit ${limits.maxMeanAbsDiff})`);
    for (const k of ['pctOverOnBuildings', 'ssim', 'silhouetteIoU', 'meanAbsDiffOnBuildings']) if (r[k] == null || Number.isNaN(r[k])) failures.push(`${r.name}: ${k} is ${r[k]}`);
  }
  if (!checkedNames.length) failures.push('no non-exempt view was checked');
  return { ok: failures.length === 0, checked: checkedNames, exempt: exemptNames, failures };
}
