# K7 #3 — flare ghost rings on facades with the sun off-screen (FIXED)

Branch `acer/k7-flare`, 2026-08-22. One line of behaviour changed in
`js/graphics.js`; everything else here is the proof.

## What the defect was

`shots/f/sweep/sw-westcampus-dusk.png`: two translucent rings ON The
Standard's facade, a third on the ground lower-left, sun nowhere in frame.
Fainter twins in `sw-H5-dkr-dusk.png`. A real lens flare is an artefact of the
lens — it belongs over the whole frame or not at all; a ring painted onto a
building in front of the camera is the bug.

## Why the existing gate did not fire (the actual mechanism, measured)

`renderFX` already gates the whole rays/flare chain on
`sunLive = S.front && S.elev > -1 && S.fade > 0.02 && !F.moonUp` — but
`S.front`/`S.fade` come from `js/sky.js`'s `projectVec`, which tests the angle
to the view AXIS, not the viewport: `front` is true for the entire front
hemisphere (`fd > 0.02`), and `fade` saturates at `fd ≥ 0.25`, i.e. anywhere
within ~75° of the axis. The frame's horizontal half-angle at 1440×900/fov 58
is only ~42°. In the gap between those two angles the sun is fully off-screen
and the gate passes at full strength.

Measured at the cited poses (`window.skyFrame.sun`, harness, cinematic):

| pose             | sun x (frame is 1440 wide) | front | fade |
|------------------|---------------------------|-------|------|
| westcampus-dusk  | **1767.9** (327 px out)   | true  | 1.0  |
| H5-dkr-dusk      | **2123.6** (683 px out)   | true  | 1.0  |
| H3-tower-dusk    | 132.0 (IN frame)          | true  | 1.0  |

The ghosts are then cast along the axis from that off-screen point through
frame centre — predicted centres from the measured sun position land within
~30 px of every observed ring (westcampus: k=0.42→(1328,204), k=0.72→(1013,331),
k=1.34→(364,594) vs rings at ~(1360,250)/(1010,325)/(370,560); H5:
k=0.72→(1113,331), k=1.34→(242,594), same match). All rings sit BELOW
`horizonPx`, so `GHOSTS.SKY_DAMP` — which only damps ghosts ABOVE the horizon
(the second-sun fix) — never touched them. Right machinery, wrong half of the
frame, and the wrong notion of "in frame" underneath it.

Isolation (pixel-diff per sub-effect, tolerance 4, one browser per pose):
at westcampus-dusk `flare 0.55→0` removes the rings; at H5 the flare
contribution is the only thing in the ring region (1.27% of the frame, rays
contribute 0 px there). The layer is the flare ghost chain, not the camera,
not the city.

## The fix (`js/graphics.js`)

The ghost chain and the anamorphic streak are images OF THE DISC, so they now
require the disc itself on screen: `flA` is multiplied by `discIn`, computed
from how far `(S.x, S.y)` sits outside the viewport, fading over
`FX_TUNE.FLARE.OFFSCREEN_SOFT` (0.12 of the frame diagonal ≈ 200 px at
1440×900) so a pan never hard-cuts the flare — a light just past the edge
still flares at about half strength, a sun 300+ px out draws nothing.
`sunLive`, rays, and bloom are untouched. One taste knob, named, live-editable
(`FX_TUNE.FLARE.OFFSCREEN_SOFT`); 0 makes the cut hard at the frame edge,
large values revert to the bug.

Rays were deliberately NOT gated on the disc: they are the one flare element
that legitimately enters the frame from an off-screen sun, and at the ring
poses they contributed either nothing (H5) or a frame-wide low-amplitude warm
wash (westcampus) that no sweep has ever flagged.

## Proof (all frames in `shots/k7/flare/`, all read by eye)

- `wc-dusk-before-base.png` — rings reproduce deterministically at the sweep
  pose; `wc-dusk-before-noflare.png` — flare off, rings gone (isolation).
- `wc-dusk-after-base.png` — fix in: rings gone, dusk look otherwise intact.
- `h5dusk-before-base.png` / `h5dusk-after-base.png` — same at H5; flare
  pixel contribution 1.27% → 0.00%.
- `h3dusk-before-base.png` / `h3dusk-after-base.png` — the sun-IN-frame
  control: disc at (132,126), `discIn = 1`, flare contribution 3.67% → 3.66%
  (identical footprint) — ray fan, near-sun ring and mid-frame ghosts all
  still there. Flare still earns its keep when the sun is visible.
- `reel-shotA-lift1s/5s/10s.png`, `reel-shotB-lift20s.png` — both reel-shot
  URL modes at 390×844 with touch, post-fix: Shot A downtown standing on
  frame one, Tower centre at +10 s; Shot B full night, knob at the moon.
  Zero console errors in every run. `graphics.mjs` 27/27 (its rays/flare
  assertions pose the camera AT the sun, bearing 256, so the new gate is
  exercised on its `discIn = 1` side there).

## The two cited artefacts that are NOT this defect

- **`sw-H3-tower-dusk.png`'s "fainter mid-frame rings"**: the sun is IN frame
  at that pose (x=132) — those rings are the designed ghost behaviour, same
  before and after the fix. The sweep grouped them with the westcampus rings;
  the measurement separates them.
- **`sw-westcampus-day.png`'s rust streak**: does not reproduce in a clean
  single-pose render (`wcday-before-base.png` is clean), and cannot be the
  flare chain — at that pose `front = false` (sun az 127 vs bearing 205,
  elev 59.6) and flare/rays change ZERO pixels. The band in the sweep frame
  hugs the horizon row (y≈205–245 vs horizonPx 177) with soft screen-space
  edges running straight across the tower's corner, which points at a
  horizon-hugging wash caught in a transient during the sweep's sequential
  session, not at a per-pose defect. Not established further — see below.

## What this did NOT establish

- The day-frame rust streak's true owner. Not reproduced, not isolated; only
  ruled OUT of the flare chain. If it recurs in a future sweep, diff that
  session's pose ORDER first.
- Nothing about motion: whether the flare fading over OFFSCREEN_SOFT reads
  smoothly during a pan was not filmed — stills only.
- Hardware GL / dpr 2 behaviour: SwiftShader 1440×900 and 390×844 only.
- `sw-H1-spawn-dusk.png`'s corner blob was not re-examined (sun near dead
  ahead at that bearing; expected to be the designed in-frame case).
