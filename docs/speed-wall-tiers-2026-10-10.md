# Wall tiers, 2026-10-10: paint a wall image when a tile first asks for it

Rank 1 of `docs/speed-2026-10-09.md`. Code: `js/facades.js` (block "WALL TIERS"), one line in `js/image-memory.js`.
Switch: `?walltiers=0` is the old eager painting, in the same checkout. Knobs: `WALLTIERS` (`rawCache`, `slowKeep`).

## What it does
Before: `initFacades` and every later registration (`registerFacadeBuckets`, `quantiseStadiumFacades`, the downtown
towers) painted every image of every pattern in both tiers at once, and each hour or zoom-anchor repaint redrew the
whole set again in the paint workers. `PACE.visibleFirst` only reorders that repaint queue (images that already exist);
it does nothing for the boot painting, and the repaint still covered everything.

After: registration only records the pattern. MapLibre 5.24.0 fires `styleimagemissing` from inside the tile worker's
request for its pattern images, before the tile gets its atlas; the handler paints that one image (same `tileData`,
hour and zoom anchor current at that moment) and MapLibre looks it up again straight after. Hour and anchor repaints,
paced or not, only touch images that exist. A tile at zoom z asks for the images the pattern step names at z-1, z and
z+1, so the near tier is read only by tiles at z16 and above, and a pattern seen only from far away never gets one.
The last few drawings are kept (`rawCache`) so the two tiers of a pattern do not draw twice. Lazily added images are
handed to `js/image-memory.js` for the same release of MapLibre's second copy of the pixels the eager ones get.
`?facadepace=0&timeofdaypace=0` still paints walls at once; the switches are independent.

## What was measured
- Pixels at rest, walls at once (`facadepace=0&timeofdaypace=0`, the ten cameras of `ci/poses.json`, GitHub runner,
  software drawing, PR #438 against main): 0 of 10 views moved (pixels over tolerance 12: 0 in every view; biggest
  channel change 0 to 12; the before/before noise floor was 0.0000 to 0.0703 %).
- Real MapLibre 5.24.0, sixteen extruded squares, both tiers, eager against lazy: 18 of 18 images the same keys, 900x600
  screenshots identical (0 differing pixels).
- 92 of 93 CI checks passed on the first run; the one red, `westcampus-probe.mjs` "every pattern image is registered",
  asserted the old contract. It now asks for an unregistered image the way a tile does and requires it to exist.
- New `scripts/verify/facade-walltiers.mjs` (CPU only, two negative controls): nothing painted at registration; one
  image per request; repaints touch only held images; `?walltiers=0` is the eager path.

## What was NOT measured (and why)
Time to city ready, worker CPU and texture memory, before and after, on a quiet machine. The AWS runner was taken by
other dispatches (each new dispatch cancels the pending one; my run was cancelled four times) and the Mac was at load
200 to 950. Tools are in place: `scripts/verify/perf-walltiers-suite.mjs` (`--steps load,pics,mem,counts`) and the
`--qarms` option of `scripts/perf/load-profile.mjs` alternate `?walltiers=0` and the default, interleaved; it reports
initFacades time, images painted when asked, paint-worker busy ms, images held, GL texture bytes.
Texture memory note: the 749 MB is MapLibre's per-tile pattern atlases, which hold the images a tile references; this
change does not alter which images a tile references, so expect the GL texture figure to stay about the same and the
CPU-side image copies (and the repaint work) to fall. That is a prediction until the suite runs.

## Laptop run, 2026-10-10 04:2x local (hardware drawing, ANGLE D3D11 on the AMD Radeon of the owner's laptop, Chrome 141)
NOT a quiet machine (other lanes' jobs ran beside it) and ONE cold load per arm: every SECOND below is meaningless,
the COUNTS and BYTES are what the page asked for. 1280x800 at ratio 1.5, `?drift=0`, graphics auto-detect cancelled.

| | `?walltiers=0` (eager) | default (wall tiers) |
|---|---:|---:|
| `initFacades` call, main thread | 2,453 ms | 4 ms |
| wall images painted when a tile asked, main thread | 0 | 220 images, 4,961 ms |
| longest run of paints inside one tile request | | 49 images, 1,427 ms |
| paint-worker jobs / busy ms (repaints) | 158 / 4,815 | 0 / 0 |
| main thread + workers, painting only | 7,268 ms | 4,961 ms |
| images the map holds | 713 | 613 |
| CPU copies of facade images, far / near tier | 29 / 116 MB | 29 / 57 MB |
| GL textures asked for, all / js/facades.js atlases | 678 / 629 MB | 628 / 580 MB |
| city ready (NOT a valid timing) | 44.1 s | 39.6 s |

Reading: the far tier of every pattern is needed by some tile; about half the near images were never asked for. Total
painting work fell by about a third and 59 MB of CPU copies and 49 MB of texture went away, but the work moved from
workers and one boot call onto the main thread in tile-request bursts: 49 images in one request took 1.4 s here, and
the per-image cost (22 to 29 ms) was 3 to 4 times the eager 8 ms, which on a busy machine may be noise or may be real
(the eager path got the second tier of a pattern from one drawing; the drawing cache covers that, but only six deep).
This is the risk to settle on a quiet machine before this is the default: if the burst is real, the next step is to
bound it (paint at most N images per tile request and send the rest to the paint workers, accepting a few frames of
the old image only where the tile has none).

Pictures with walls painted in paced jobs (the default page), old painting against new, same laptop, ten cameras,
old painting shot twice for its own noise: 0 of 10 views changed; moved pixels 0.0061 % (spawn-day, noise 0.0012 %),
0.0001 % (tower-night), 0 elsewhere; biggest channel change 89 (spawn-day, a few pixels), 13, then 8 or less.
