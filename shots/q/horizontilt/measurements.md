# H3 re-verification — horizon tilt vs. camera roll, measured during a real strafe

Method: `_harness.html` (real `controls.js`, `preserveDrawingBuffer` on), camera
placed with `jumpTo` once `!__fly.eye().driving`, then a REAL keyboard hold on
`KeyD` then `KeyA` (no synthetic `setRoll`) — literally "when I move sideways".
Sampled every ~220ms while banked. For each frame: read live `pitch`, `roll`
(`map.getRoll()`, cross-checked against `__fly.fx().roll`), `fov`, `W`, `H` from
the page, and independently predict (elementary pinhole geometry, not borrowed
from `js/sky.js`) where the true horizon should sit at the left/right screen
edges — the roll-0 row rotated rigidly about the frame centre by the camera's
own roll. Then `gl.readPixels` the actual rendered column at those two edges
and find the strongest colour step near the predicted row.

`predL/predR` = independently predicted row. `measL/measR` = measured row.

```
tag            roll(deg)  predL   predR   measL  measR
01-baseline     0.000     137.35  137.35   175    175
02-strafeR-0    0.553     143.44  132.24   181    169
02-strafeR-1    1.270     153.37  127.65   191    165
02-strafeR-2    1.465     158.34  128.66   195    166
02-strafeR-3    1.493     160.31  130.08   197    168
02-strafeR-4    1.498     161.36  131.02   198    168
02-strafeR-5    1.500     162.42  132.05   199    169
03-settled      0.861     156.22  138.79   194    177
04-strafeL-1   -1.158     131.82  155.26   170    194
```
(`04-strafeL-{0,2,3,4,5}` are excluded here: the left-edge column's strongest
colour step in those frames was a building silhouette, not the fog edge — a
side effect of literal WASD strafing translating the camera position, which
moves what's in that fixed screen column frame to frame. `04-strafeL-1`'s delta
matched the same low magnitude as every clean fog-edge read (~24-26 luma
steps), confirming it caught the real feature.)

**Result: `measL - measR` tracks `predL - predR` to within ~1 px at every clean
sample, in BOTH bank directions** (right strafe: predicted delta 30.37 px vs.
measured 30 px at max roll +1.50°; left strafe: predicted -23.44 px vs.
measured -24 px at roll -1.16°). Solving the measured delta back through the
same geometry gives an implied roll of ~1.48° against an actual live roll of
1.4998° — a residual of about **0.02°, i.e. no measurable sign or magnitude
error**. `shots/q/horizontilt/02-strafeR-5.png` and `04-strafeL-3.png` show it
by eye: the fog line's right end lifts under a right-strafe bank and the left
end lifts under a left-strafe bank, following the banked skyline rather than
staying level against it.

This defect was already fixed on `main` by PR #125 (`acer/horizon-roll-speedway`,
2026-08-04) — `js/sky.js`'s `FS_GROUND` shader and its DOM fallback already
measure the ray's rise against the camera's rolled world-up rather than the
screen row. `HANDOFF.md` §63 recorded that fix as measured only at a
*synthetic, forced* roll and flagged explicitly: "Not verifiable from stills —
needs a sideways move." This pass supplies that motion verification, with a
real strafe rather than a forced `setRoll`, and it holds. No change made to
`js/sky.js`.
