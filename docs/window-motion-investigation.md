# Window motion investigation

September 21, 2026, based on `4c5ee8c` (PR #279). Production copies of
`facades.js`, `slopes-apartments.js`, `tiles.js` and `app.js` match the merged
files after normalizing line endings. The two experiments below were removed;
this pass changes documentation only.

## Pane coverage experiment

The authored facade tiler supplied whole-window coordinates through unused
glass-material attribute components. A derivative-based rectangle coverage
estimate reduced emission as panes shrank below four pixels, reaching full
filtering at one pixel. It added no vertex attributes, triangles or textures.
The same window coordinates continued across tiler subdivisions. The runtime
switch compared exactly the same geometry and camera with filtering off/on.

All 196 buildings and 363,808 tagged vertices loaded. At the West Campus pose,
the existing temporal crawl measure changed from 0.2957% to 0.2961%; at the idle
pose it changed from 0.5745% to 0.5810%. Neither improved. The off results also
reproduced the earlier baseline. The experiment was rejected, not shipped as a
flicker fix. Filtering only inside a pane cannot integrate its surrounding wall
area; simply reducing pane brightness is not sufficient evidence of stability.

## Texture-state cache experiment

The current CPU profile identified repeated texture-state queries in the shared
lighting adapter. A test cache tracked texture-unit selection, 2D bindings,
deletion and context restoration while preserving the existing binding/restore
sequence. A unit check covered those transitions and an uncached control.

Day, sunset and night off/on/off screenshots were byte-identical. Each view had
196 authored buildings, loaded tiles, no lighting failures and no GL error.
Across six interleaved 12-second rotations, cached runs removed all of the
410,448–439,854 preservation queries made in the uncached runs. Frame times
remained essentially unchanged. Minimum main-thread task duration changed from
10.919676 s to 10.775014 s, only 1.325%, below the predeclared 3% acceptance bar.
That did not justify adding more renderer state tracking, so it was removed.

Hardware GL, performance preset, 651x598 CSS viewport, DPR 1.5, 75% render scale,
no CPU throttle or CPU sampling profiler in the final comparison. CPU task
duration came from Chrome's Performance metrics. The earlier diagnostic profile
used a 1 ms sampling interval. No run in the final comparison had a frame over
100 ms; this does not erase the earlier slower results or establish that the
user's idle pauses are resolved.

The [measurement record](verification/window-motion-investigation.json) contains
the camera poses, loaded-state checks, motion results and individual timing runs.
Scratch patches and frames remain outside the repository.

## Next investigation

Attribute the visible interference by isolating authored geometry, fallback
textures and overlapping legacy layers at the same narrow viewing angles. Use
registered moving crops and inspect the sequence, not just a still or one
fixed-pixel statistic: the current crawl measure also counts legitimate moving
edges. Confirm the responsible renderer before changing facade architecture.

If geometry minification is confirmed, test a filtered representation of the
whole distant facade, including both windows and the spaces between them. Keep
nearby authored details and wall silhouettes, check retained light energy, and
budget additional memory against the already enlarged fallback atlas. Do not
retry pane-only dimming or enable MSAA by default based on cleaner stills alone.
Downtown reference geometry remains behind this motion priority.
