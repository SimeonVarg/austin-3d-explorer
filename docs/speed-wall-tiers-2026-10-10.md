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
