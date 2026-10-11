# Round 2: quality improved; the no-overhead goal remains unmet

The candidate keeps the 4×4 spatial coverage grid, fixes the material footprint on the remaining West Campus facades, welds identical mesh vertices, skips lighting terms with zero contribution, and uses hardware shadow comparisons. Readable app source is retained while its delivered script omits comments and whitespace. Sampling remains off by default; changes are uncommitted.

The arithmetic: exact compaction saves 106.39 MB across supported scene buffers, versus the sampler’s 73.73 MB desktop target (213.17 MB on the phone canvas). Desktop storage can therefore be paid for; this does not pay for sixteen coverage samples in frame time. The branch’s quoted 347→103 MiB saving largely overlaps packed vertices already on main.

Quality below is error/flicker in 255 levels against fixed, original-main 16-jitter floating truth; rest gives error only. Main and round-1 columns preserve round-1 measurements. Round 2 uses the same views and recorded main camera paths, Intel Iris Plus 655, 960×600 DPR1, graphics auto-detect cancelled. The 8-bit motion floor is about 0.17. Drag is actual pointer input recorded and replayed; three consecutive frames per moving row.

| View / motion | Main (round 1) | Round 1 lattice | Round 2 |
|---|---:|---:|---:|
| campus-far / rest | 4.73 | 0.23 | 0.23 |
| west-mid / rest | 7.85 | 0.89 | 0.26 |
| guad-street / rest | 3.89 | 0.20 | 0.17 |
| downtown-far / rest | 2.31 | 0.36 | 0.36 |
| campus-far-night / rest | 2.88 | 0.14 | 0.14 |
| guad-street-night / rest | 2.29 | 0.09 | 0.10 |
| campus-far / step | 4.71/6.15 | 0.23/0.28 | 0.23/0.28 |
| west-mid / step | 7.83/10.82 | 0.89/1.07 | 0.27/0.35 |
| guad-street / step | 3.87/5.63 | 0.22/0.33 | 0.18/0.29 |
| downtown-far / step | 2.30/2.74 | 0.36/0.45 | 0.36/0.45 |
| campus-far-night / step | 2.79/4.12 | 0.14/0.20 | 0.14/0.20 |
| guad-street-night / step | 2.30/3.69 | 0.10/0.16 | 0.10/0.15 |
| campus-far / drag | 4.69/7.41 | 0.25/0.37 | 0.25/0.38 |
| west-mid / drag | 7.69/12.31 | 0.90/1.19 | 0.28/0.45 |
| guad-street / drag | 3.91/6.24 | 0.24/0.34 | 0.18/0.29 |
| downtown-far / drag | 2.26/3.64 | 0.37/0.57 | 0.37/0.57 |
| campus-far-night / drag | 2.51/4.30 | 0.14/0.22 | 0.14/0.22 |
| guad-street-night / drag | 2.33/3.98 | 0.10/0.16 | 0.10/0.16 |

The strict quality gate retains two small failures: campus drag flicker 0.375304 > 0.375 and Guadalupe night rest error 0.095315 > 0.095. These are not rounded into passes. Other final view/mode rows meet the declared bar.

West’s remaining error was concentrated in filtered facade overlays on the Standard, Union on 24th and Waterloo (84.6% of the diagnosed residual). Explicit native texture gradients preserve anisotropic filtering: the step result falls from 0.89/1.07 to about 0.27/0.35 without another texture fetch.

Costs: minima of three cold interleaved repetitions, CPU throttle 1×, vsync off, moving frames without screenshot readback. GPU is allocated WebGL buffers/textures/renderbuffers. JS is post-GC page V8 used heap plus backing storage. Download lists completed worker-inclusive encoded response bodies on the local server. Each successful page aborted one trees.pmtiles request; its transferred bytes are unknown. Total-download equality is unproved and the gate rejects that accounting. Values use decimal MB.

| Machine | p50/p90 ms main → R2 | GPU MB main → R2 | JS MB main → R2 | Completed bodies MB main → R2 |
|---|---:|---:|---:|---:|
| Intel Iris Plus 655 | 54.8/94.9 → 117.4/195.1 | 565.817 → 539.157 | 481.675 → 437.427 | 51.491 → 51.418 |
| AMD laptop | 46.4/50.9 → 76.2/78.0 | 589.108 → 531.490 | 489.240 → 443.530 | 51.559 → 51.487 |
| Phone profile on AMD | 35.4/42.3 → startup failure | 346.314 → unmeasured | 265.580 → unmeasured | 50.109 → unmeasured |

Round-1 costs retained (main → lattice; original heap/byte limits in `out/round1/REPORT.md`):

| Machine | p50/p90 ms | GPU MB | JS used heap MB range |
|---|---:|---:|---:|
| Intel | 51.9/96.0 → 110.5/213.6 | 580.8 → 654.5 | 136.2–139.3 → 136.7–141.1 |
| AMD | 45.0/47.3 → 94.1/96.1 | 595.8 → 669.6 | 135.2–141.6 → 135.6–139.1 |
| Phone profile | 33.5/38.6 → 165.4/169.3 | 334.6 → 547.8 | 129.8–131.3 → 129.6–132.4 |

Cross-machine raw-source binding remains red: 221 Windows files differ only by LF→CRLF, and 64 files are byte-identical; no unexplained difference was found (`out/r2-line-endings.json`). The raw-hash gate is not relaxed. Each cost comparison still uses pristine main and candidate on the same machine.

The phone candidate fails before timing: `MeshCompact.bytes` reads `byteLength` from an attribute array already released by the memory manager. Runtime disables sampling after that error. No phone candidate cost is claimed; no corrective implementation/test round began after the budget stop.

The phone profile is 390×844 CSS/DPR3 with the application’s canvas cap, on the AMD laptop; it is not physical-phone acceptance. Process/worker JS heaps, driver allocations and production-CDN transfer are not measured. Compaction adds startup CPU work and covers initially loaded geometry, not all later arrivals.

Distinct routes tested: 4×/8× MSAA, smaller spatial grids with MSAA, depth-reprojected history, shading once at native pixel centres, exact mesh welding, planar reduction, daylight specialization, shadow bounds, depth prefill, strip rendering/culling and backface removal. Lower sample counts/history/native-centre lighting missed quality; strips reduced storage but slowed drawing; backface removal lost visible surfaces. The final planar regrouping removed only 1.04% of eligible triangles and 0.85 MB; it stays excluded. Details and raw probes: `out/r2-decisions.md`, `out/geometry-options.md`.

**Future content is not guaranteed.** The proposed generator rule replaces repeated subpixel detail with its integrated material/coverage representation while preserving depth, occlusion and silhouettes; every bake and shader must register, and unsupported classes must fail. That complete representation/registry is not implemented. Finite sixteen-point sampling cannot establish the requested guarantee. `docs/moire-zero-contract.md` is the one page; `out/future-content-rule.md` records the concrete missing construction.

The source-hashed gate requires all six views at rest, step and pointer drag; stricter West limits; three cold comparisons on all profiles; and construction proof. It rejects missing proof and overhead. `out/r2-acceptance.json` contains the measurements; `out/r2-gate.txt` records its actual result. The gate’s synthetic self-test is not city acceptance.

Off switch: remove all sample query flags and reload. Live `SampleLattice.set(false)` releases the sample target but retains compacted geometry and shader hooks. On: `?samplelattice=1&samplegrad=1&samplelight=1&samplepcf=1&samplebounds=1&samplework=1&samplecompact=1&sampleday=1`.

Visual evidence: `out/campus-before-after.webp`, six seconds, 2,944,848 bytes, same 30-pose campus rotation as round 1, before | after. Playback is not a frame-rate test. The paired PNGs and pose/hash metadata are in the task folder’s `scratch/r2-clip`.

Reproduce (server on 8492; queued browser permission required):
```sh
python3 out/run-r2-final.py   # serial local quality, Intel cost, clip captures
python3 out/run-r2-remote.py  # waits for local completion, then AMD and phone costs
python3 out/assemble-r2-acceptance.py
node scripts/verify/moire-r2-gate.mjs --report out/r2-acceptance.json
python3 out/make-r2-clip.py --source scratch/r2-clip --dest out/campus-before-after.webp
```
No git writes to the work copy, commits, PRs or publishing were performed. Baseline: `7344c56b517803408141b77cd85aa15342f39cba`.

Implementation stopped at the $65.05 notice; new spend including verification/handback is approximately $71.08 ($88.78 including round 1). No new experiment or corrective round followed the notice.
