# K7 #1 — the day-pale sheet on the night horizon at the spawn pose

Branch `acer/k7-nighthorizon`, 2026-08-22. Defect frame:
`shots/f/sweep/sw-H1-spawn-night.png` (judge-confirmed, pose H1 = herowhere's
committed SPAWN, p=0.92, preset cinematic, SwiftShader, 1440x900).

**Status: REPRODUCED AND ISOLATED. The sheet is the OUTER RING (js/outer.js's
`outer-3d` flat ring and friends) still wearing the PREVIOUS hour's colours
while the rest of the scene has already reached night. It is not a rendering
defect at all — it is a screenshot of a scene that had not finished changing.
A retint of the outer ring rebuilds data-driven `fill-extrusion-color`
per-tile, asynchronously, and under SwiftShader that convergence takes ~6
seconds — longer than the sweep's settle. The sweep's H1-night frame is pose
24, the FIRST night pose after twelve dusk poses, so its capture landed inside
the dusk-to-night convergence window and froze the last still-stale far tiles
as a pale sheet. No render code is wrong; the fix requests are (1) a settle
that waits for pixels to stop changing — now implemented in `night-pale.mjs`,
requested for `shot.mjs` — and (2) optionally, for the outer lane, shrinking
the visible rebake window for real slow devices. Evidence below; all frames in
`shots/k7/nighthorizon/`.**

## What the defect is, measured off the committed frame

- A coherent pale patch ON the far terrain, frame x 380-700 (brightest),
  fading strips to x ~950; screen y 250-300 of 900, in a frame whose horizon
  line sits at y ~260. Colour at its brightest (86, 86, 98), peak luma ~88,
  against a ~20-luma far field. Zoom: `defect-zoom-committed.png`.
- Its internal texture — pale ground with small dark speckles standing in
  front — is exactly the dusk frame's far-ring texture at the same pixels
  (`compare-dusk-vs-night.png`), i.e. stale-hour geometry, not fog: fog
  brightens monotonically toward the horizon, and the sheet has a DARK band
  above it.

## The reproduction, three independent ways

**1. Temporal — the defect on demand.** Replay the sweep's own tail (pose 22
westcampus-dusk -> 23 downtown-dusk -> 24 H1-spawn-night, same recipe:
index.html, cinematic, SwiftShader, 1440x900, jump+retint in one evaluate)
but screenshot EARLY instead of settling. At +4.3 s the capture is the
committed defect: foreground converged to night (band mean luma 21 vs the
committed 20), far ring still pale (region peak 90 vs 88, meanRGB (39,33,56)
vs (43,37,60)) — `repro-midretint-defect-PRESENT.png`. The SAME RUN's next
capture 4.5 s later is fully converged and clean (peak 46) —
`repro-midretint-converged-4s-later.png`. Earlier in the window the WHOLE
scene is stale (`repro-midretint-whole-scene-stale.png`): the sheet is just
the last part of the city to converge.

**2. Static — the offender without a timing race.** Settle the whole scene at
night, then call `window.applyOuterColors(map, 0.5)` so ONLY the outer ring
wears dusk: the sheet reappears at the same band with the same texture and
brightness (region peak 90, meanRGB (55,48,68)) with zero transient anywhere
— `static-outer-night-baseline.png` vs `static-outer-held-at-dusk-MATCH.png`.
It spans the full horizon rather than one patch because here the WHOLE ring is
stale; the sweep's capture caught only the last unconverged far tiles.

**3. Ownership.** `night-pale.mjs spawn` names `outer-*` as owner of 89% of
the horizon band's bright pixels at this pose. (Its bright pixels at NIGHT are
lit windows — legitimate; the ownership is what matters here.)

And the gate experiment measured the window itself: firing the dusk->night
retint and sampling the band every 900 ms gives six successive disagreements
(pale count 78,674 -> 64,258 -> 51,934 -> 43,186 -> 28,196 -> 6,797 -> 2,745)
before it settles — ~6 s of convergence on an UNLOADED machine, SwiftShader.

## The mechanism, and why it hit exactly this frame

`applyOuterColors` retints by writing a NEW data-driven
`fill-extrusion-color` expression (`bakedColor(p)` — per-feature baked colour
trios mixed at p) into `outer-3d` / `outer-detail` / the parapet layers.
MapLibre re-evaluates a data-driven paint property per tile, asynchronously;
until a tile's buffers are rebuilt it draws the OLD evaluation. Everything
else in the frame converges in one paint (sky, fog colour, CSS grade, uniform
fill colours), so a capture inside the window shows a night city with
stale-hour outer tiles — pale, because dusk/day far-ring colours are pale and
the night grade cannot darken a colour that is still authored bright.

shot.mjs's settle is 4000 ms + an idle-wait + 1500 ms — but the idle-wait
short-circuits on `m.loaded() && m.areTilesLoaded()`, which is TRUE throughout
the rebake (no tiles are LOADING — their paint buffers are rebuilding). So the
kept frame lands ~6 s after the retint: inside the window on any slowed
machine. H1-spawn-night is the first night pose after twelve dusk poses — the
only night pose whose capture follows a retint — which is why the other 11
night frames were clean. The sweep's own session logged 11-65 s load variance
and five browser crashes; contention stretches the window well past any fixed
settle.

## Why seven earlier reproduction attempts were all clean

They all settled properly (full 4 s + idle + 1.5 s, quiet machine) or ran on
hardware GL, where the rebake converges before any capture. The transient only
freezes into a frame when the capture races the convergence — which is what
the sweep did and a well-behaved repro does not. Attempt 7 (SwiftShader,
3-pose chunk tail, 560 s watchdog) is `repro-swiftshader-chunktail-defect-
absent.png`: measured region peak 46 vs the committed 88, 81 hot horizon
columns vs 595 — clean, and hash-distinct from the committed frame.

## Five mechanisms reconstructed earlier and ruled out (kept for the record)

Forced live at the night pose, screenshotted, no match — strips in this dir:
day basemap ground fills (`recon-day-basemap-no-match.png` — speckles
everywhere, foreground lights up), stale day map-sky feeding the fog
(`recon-stale-day-sky-no-match.png` — bleaches the whole sky), golden water
(thin ribbon, far narrower), whole basemap family at golden (speckles, too
wide), celestial body (sun az 297.6 elev -32.8, moon az 112 elev 20 at p=0.92
— neither at the sheet's azimuth ~239).

## The instrument: night-pale.mjs, five blindnesses fixed + a convergence gate

1. **Region** — it counted the bottom two-thirds; far terrain at pitch 74
   lives at the horizon, inside the skipped "sky". Poses now carry a band;
   spawn's is [0.22, 0.40].
2. **Layer scope** — fill-extrusion only; now every visible layer of every
   type, grouped by pass.
3. **Threshold** — PALE=120 vs a sheet peaking ~88; per-pose now (spawn: 60).
4. **Graphics preset** — unpinned, so cinematic's 1100 m far scene could
   simply not exist at the default's 700 m. Poses pin preset and hour now
   (spawn: cinematic, p=0.92).
5. **Custom layers** — `getStyle().layers` omits them; the probe walks
   `map.style._order`.
6. **NEW — the convergence gate.** `__todCurrentP` asserts the intention and
   `areTilesLoaded()` lies during a rebake, so the script now refuses to count
   until two samples 900 ms apart agree (10 tries, then FAIL). Verified both
   ways: passes silently on a settled scene (counts reproduce within 1 px),
   and fires 6 times through a real dusk->night transition before clearing.

Run: `VERIFY_URL=http://127.0.0.1:PORT node scripts/verify/night-pale.mjs spawn`.

**The pose-bug caution stands:** at this pose with the defect absent, the top
scorer is `outer-tower` = lit downtown windows, which are SUPPOSED to be
bright. Read `shots/night-pale-spawn-before.png` before believing any
attribution — the instrument names the offender only when the offence is on
screen.

## Requests to other lanes (per CLAUDE.md — written, not applied)

**scripts/verify/shot.mjs (verify lane) — the fix that prevents recurrence.**
The settle must wait for the SCENE, not the tiles: before keeping a frame,
loop until two consecutive captures (or two cheap readback digests ~900 ms
apart) agree, with a bounded retry. The existing "screenshot twice, trust the
second" almost does this — it just never compares the two. Without it, any
pose that follows an hour change can commit a mid-retint frame, and the next
sweep will re-report this class at whichever pose sits first after a
transition. (The previous request here — reordering `applyTimeOfDay`'s
basemap sweep — is withdrawn: the basemap was never the offender, and no
reordering inside one synchronous call changes an async per-tile rebake.)

**js/outer.js (outer lane) — optional, taste-gated.** The same window is
visible to a real visitor who drags the time slider quickly on a slow device:
the far ring lags the hour by however long the rebake takes (sub-second on
hardware GL here; seconds under software rendering). If a phone test of
`?sliderdemo=1` shows it, candidates: probe MapLibre 5's `global-state`
expressions for the hour mix (authored once, retinted via
`setGlobalStateProperty` — PROBE the rebake cost first, it may pay the same
per-tile price), or briefly ease `fill-extrusion-opacity` (cheap, uniform)
through the transition. The static harness above
(`applyOuterColors(map, staleP)` on a settled night scene) is the A/B rig for
either. Not prescribed as mandatory: the committed reel shots are clean, and
on hardware GL the window is short.

## Not established

- WHERE MapLibre's rebake order comes from (near-to-far is consistent with
  every frame here, but the queue policy itself was not read); the committed
  patch's exact footprint (which tiles were last) was not reproduced
  bit-for-bit, only the state class.
- Whether a real phone shows the lag during `?sliderdemo=1`'s sweep — not
  tested on a device; the outer-lane request is gated on that test.
- The `global-state` fix's actual cost — unprobed.
