# Round 3 — draw less, then smooth
Decision: use the permitted coarse case: collapse every tiled recipe facade to its area-weighted RGB mean, drop fins/louvres and rails; retain walls, roofs, slabs, piers and massing. No distance threshold or per-frame LOD work.
Switch in `js/slopes-apartments.js`: `?samplelattice=0&detailcut=all`; reload. Class-only flags: `faces`, `fins`, `rails`. For native MSAA put `smooth=1` FIRST. Defaults remain unchanged.
Scope: authored recipe tiler/blades/balcony rails and named rail detail meshes/decks. Separate bespoke renderers, roof textures, MapLibre facades and structural piers remain; this is not a proven exhaustive citywide removal bound.
Intel Iris Plus 655 (ANGLE Metal), 960×600 DPR1, 1× CPU. Timing: vsync off, 32 moving intervals after 8 warmup frames, fresh contexts; three interleaved main/removed/removed+4× triplets (middle reversed), shared main controls give three pairs per treatment.
All times below are ms; minima take p50 and p90 independently. Raw columns list ALL three p50/p90 values per arm, in repetition order. Triangles are authored draws at the quality pose, excluding MapLibre.

| View / arm | Drawn triangles | Min p50/p90 | Raw rep 0; rep 1; rep 2 |
|---|---:|---|---|
| campus-far / main | 2,290,355 | 54.90/92.80 | 56.90/93.10; 57.10/95.30; 54.90/92.80 |
| campus-far / removed | 967,819 | 53.40/86.10 | 53.40/87.40; 60.80/86.10; 65.60/94.70 |
| campus-far / removed + 4× | 967,819 | 59.90/101.20 | 84.90/112.40; 59.90/101.20; 85.10/110.00 |
| west-mid / main | 2,109,901 | 31.90/63.20 | 33.40/69.60; 34.30/65.30; 31.90/63.20 |
| west-mid / removed | 858,697 | 22.20/51.60 | 22.20/53.40; 26.90/51.60; 26.70/52.50 |
| west-mid / removed + 4× | 858,697 | 34.80/63.70 | 43.70/76.80; 34.80/75.90; 37.10/63.70 |
Load: 1-minute OS load 13.0–56.6; sampled CPU busy 32%–54%; noisy shared machine. Completed 18/18 cold loads; raw load, renderer, antialias and interval records in each `r3-cost-*/cost.json`.

Shimmer: E/F = mean absolute image error / residual frame-change error (levels/255), three consecutive one-pixel steps. Both columns use the SAME frozen main building mask; own-scene truth isolates shimmer from picture changes. Native-footprint 16-jitter floating truth, second captures; all repeat noise zero.
| View / arm | Against frozen main E/F | Against own-scene truth E/F |
|---|---|---|
| campus-far / main | 4.71/6.15 | 4.71/6.15 |
| campus-far / removed | 6.95/6.54 | 2.92/3.39 |
| campus-far / removed + 4× | 5.28/4.90 | 1.11/1.57 |
| west-mid / main | 7.83/10.82 | 7.83/10.82 |
| west-mid / removed | 14.34/13.58 | 4.75/6.16 |
| west-mid / removed + 4× | 11.32/10.01 | 1.42/2.06 |

**Answer: no for this measured switch.** Native removal cuts authored draws by 57.7%/59.3% and own-scene shimmer from 6.15/10.82 to 3.39/6.16; adding plain 4× MSAA ends at 1.57/2.06, above 1.0. Timing minima main → removed → removed+4× (p50): campus-far 54.90 → 53.40 → 59.90 ms; west-mid 31.90 → 22.20 → 34.80 ms. The residual includes roof-tile/material patterns and retained renderers/structural detail, so it is not a measured silhouette-only floor. A complete generator rule is not ruled out by this incomplete coverage.
Largest generated detail classes (includes culled buildings): facade cells/windows/reveals/frames/mullions 2,135,372 triangles replaced by 33,436; rails/bars 396,716; fins/louvres 38,332. Counts reflect generator emissions, not per-view visible contribution.
Class-only removal F, campus/west (same fixed mask, own truth; no repeat pass for these attribution captures): faces: 3.44/6.40. Reductions need not add because occlusion and filtering interact.
Commands: `VERIFY_URL=http://127.0.0.1:8492 node /Users/simeonvarghese/Projects/astra-pipe/tools/gpu-run.mjs --label moire -- node scripts/verify/moire-r3-bar.mjs --out out/r3-removed-own --views campus-far,west-mid --q samplelattice=0,detailcut=all --arms main --motion step --frames 3 --fast --raw-truth --frames-out`; then `python3 out/run-r3.py`; `python3 out/r3-score.py`; `python3 out/r3-report.py`.
Evidence: `out/r3-scores.json`, `out/r3-*/bar.json`, `out/r3-cost-*/cost.json`; second-frame comparisons `out/r3-campus-far-comparison.jpg` and `out/r3-west-mid-comparison.jpg`. MSAA context reports 4 samples, own offscreen target false; lattice unloaded.
Control note: first campus main timing used the query-off experiment source through an old snapshot hardlink; no per-frame switch code executes, and query-off pixels reproduce frozen main exactly. The snapshot was then detached and restored to the original bytes.
Not proven: exhaustive detail coverage, exact pixel-threshold selection, fidelity-preserving mean materials, total MapLibre triangle savings, physical-phone results, or a future generator guarantee. Initial helper run with missing polygon support was stopped/discarded; corrected quality runs have zero page/shader errors. No git writes; round-2 REPORT.md preserved.
