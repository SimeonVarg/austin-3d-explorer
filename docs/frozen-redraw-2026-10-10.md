# One frozen page, drawn again: is it the same picture?

*2026-10-10, branch `mac/frozen-redraw`. The check is `scripts/verify/frozen-redraw.mjs` (hand-run, GPU).*

## Why

Every picture check that reads the night (the CI before/after pictures, `night-eye.mjs`) found that two loads of the same
night view differ, by 0.1 to 3.5% of the pixels over 12/255, and read that as change. A night-eye lane measured 5 to 8
different frames out of 8 when it redrew one frozen page, by up to 250,000 pixels. This asks the narrow question under
all of it: with the clock held, the camera still, the labels hidden and the page finished, does the map's own canvas
repeat itself?

## What was found

**On `main` as it ships, yes.** Both night cameras (`spawn-night`, `tower-night` of `ci/poses.json`), 8 redraws each,
every pair of frames compared on the map's canvas: 0 pixels over 12/255 between any two (`spawn-night`: one distinct frame;
`tower-night`: up to 6 distinct frames, 14 to 23 pixels by one level). The condition is a *finished* page: the cloud
panorama up (it is fetched when the browser is idle, up to seconds after the first paint), the shadow proxy built, the
facade and apartment paced jobs done, and the sky clock held. `?skyfreeze=<ms>` (this branch, `js/sky.js`) holds the clock
the stars twinkle and the clouds drift by; without it a still night sky changes by design (stars twinkle at about 1 Hz).

**The jitter that was reported came from one configuration: bloom on and auto-exposure off.** With both on (the Balanced,
Cinematic and Ultra tiers) or both off (Performance), the canvas repeats. With bloom on and auto-exposure off it draws a
different frame every redraw, by whole-frame brightness (`spawn-night`: 7 to 8 different frames of 8, up to 48,405
pixels over 12/255, 925,950 by any amount in one pair; `~/flyover-private/night-2026-10-10/jitter/ae-off-bloom-on-strip.webp`
is the 8 redraws and the difference from the first, x8). The number 48,405 repeated exactly in separate runs, so it is a
fixed sequence of states, not noise.

Ruled out, in this order (`--explain`, `--arms`, `--suspect`):

| suspect | evidence |
|---|---|
| a uniform, a time or frame-counter value | every uniform set and every draw made in each redraw is logged by program: none differs between redraws, in either camera |
| a different set of draws (a layer arriving late) | draw counts per program identical in every redraw |
| the clock | the sky clock is held; a frozen clock does not cure it |
| the sky atmosphere pass, the clouds, the stars, the lamps, the shadows and AO | each switched off alone: it still jitters (the atmosphere arm moves one view and not the other) |
| the GPU not having finished when the canvas is read | `gl.finish()` plus a one-pixel read before the grab: 38,258 pixels; waiting 2 s after the redraw: 48,405 |
| bloom | **bloom off (auto-exposure still off): 0 pixels over 12.** Auto-exposure on (bloom still on): 0. |

So the canvas differs when the bloom pass reads it (`bloomCtx.drawImage(mapCanvas, ...)` in `js/graphics.js renderFX`) and
nothing else reads it: auto-exposure's own read of the same canvas (`aeMeasure`, or its `readPixels`) makes it stable.
I did not find the mechanism. What is established: it is not the scene, not a uniform, not time, not timing; it is a
property of reading a preserved-buffer WebGL canvas into a 2D canvas, and a second reader cures it. I did not change
`graphics.js` here: a fix that cures it by adding a read would be a guess at a mechanism.

## Can a visitor see it?

Not on a parked camera in any shipped tier: nothing redraws, and the three tiers with bloom have auto-exposure on, the
fourth has no bloom. It becomes visible if someone turns auto-exposure off with bloom on **and** something keeps
redrawing: the strip above is what that looks like (a whole-frame brightness step between redraws). The night-eye branch
had exactly that by accident: its frozen night skipped the exposure metering, which is where its "5 to 8 different
frames" came from; it now meters and holds the gain at 1.

## The check

`node frozen-redraw.mjs` (green), `--break` (a hundredth of a degree of camera between two redraws: must exit 1),
`--explain` (the uniform and draw logs), `--arms` (the four tiers and the suspects one at a time), `--suspect`
(the auto-exposure case alone, read three ways). It reads the map canvas with `toDataURL`, hides the name labels first
(their collision placement follows tile arrival order: a different system) and waits for the page to finish.
