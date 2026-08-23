# K7 #2 — far-ring vegetation outlines ignored the time of day

**Verdict: FIXED in `js/outer.js` (branch `acer/k7-greenring`). The glowing
mint-green squiggles on the dark far field were the Liberty basemap's `park`
fill layer keeping its authored constant `fill-outline-color` —
`rgba(95, 208, 100, 1)` — while `js/timeofday.js` retinted only its
`fill-color`.** The outline now copies the fill's own just-tinted colour on
every retint, so it rides the same night fade as everything else, by
construction.

Look first: `shots/k7/greenring/band-before-H4-night.png` vs
`band-after-H4-night.png` (2x crops of the horizon band). Full frames below.

## The mechanism, isolated before fixing

The sweep (`docs/sweep-2026-08-22.md` finding 2) guessed "far-ring
landuse/greenbelt geometry", i.e. `js/outer.js`'s own data. That guess was
wrong in a useful way: `js/outer.js` draws only fill-extrusions whose colours
are baked `wd/wg/wn` trios that already follow the hour. The squiggles are not
ring geometry at all.

1. **Layer inventory at the exact sweep pose** (H4-city: center
   -97.75194,30.2654, z14.41, pitch 72, bearing 200; p=0.92; cinematic;
   1440x900 headless SwiftShader; `_harness.html?intro=0&drift=0`;
   `cancelGraphicsAutoDetect()`; port 8653; `harness-drift.mjs` PASS first).
   Every visible layer's paint colour was dumped. Exactly one visible layer
   carried a constant green line/outline:

   ```
   park | fill | openmaptiles/park | fill-outline-color=rgba(95, 208, 100, 1) | fill-color=#242a1c
   ```

   `js/timeofday.js cleanupBasemap()` puts basemap park/landcover FILLS in its
   `_parkFills` bucket and retints their `fill-color` to the hour's park tone
   on every heavy pass — but it never writes `fill-outline-color`, and a
   MapLibre fill layer with an AUTHORED outline keeps it at every hour. Inside
   the core box our own opaque ground covers the basemap, so the wireframe only
   showed on the far field — which is why it read as "far ring".

2. **Magenta mask (HANDOFF §48), same pose, same page**: setting that ONE
   paint property to `#ff00ff` recoloured the squiggles and nothing else —
   all 159 green-dominant pixels in the frame changed (159 of 159), green
   count fell to 0, and 1,950 magenta pixels appeared along the same polygon
   perimeters (`iso-baseline-night.png`, `iso-magenta-mask-night.png`).
   Copying the night-tinted `fill-color` onto the outline removed every
   green-dominant pixel in the frame (`iso-outline-follows-fill-night.png`).
   This is also the subject-on-screen proof: mask the suspect, the defect
   pixels change.

## The fix

`tintVegOutlines()` in `js/outer.js`: on every retint (it is called from
`applyOuterColors`, which already runs after every `applyTimeOfDay` via the
module's existing wrapper, plus a boot catch-up for the initial paint that can
predate the hook), copy each vegetation fill's current `fill-color` onto its
`fill-outline-color`. No second copy of the park palette exists in this file,
so it cannot drift from `js/timeofday.js`'s tint. Layers are selected by the
same predicate as `cleanupBasemap()`'s park bucket, narrowed to fills that
actually carry an authored outline — today exactly one, `park` — derived
rather than hardcoded so a basemap style update cannot quietly ship a second
daylight wireframe. Redundant per-frame writes are skipped with a string
compare, so the per-frame cost is one `getPaintProperty` on one layer.

Taste knob (CLAUDE.md rule 11): `OUTER.vegOutlineTint` — `false` restores the
basemap's authored outlines untouched.

Why it lives in `js/outer.js` and not `js/timeofday.js`: `js/timeofday.js` is
another lane's file this round. The mechanism is reachable and correct from
here — the far field is this module's domain — and the copy-the-fill shape
means there is nothing to keep in sync. If the timeofday lane ever wants to
absorb it (one `safePaint(map, id, 'fill-outline-color', s.park)` over
`_parkFills` in its apply loop), the whole block lifts out cleanly.

## Verified at the sweep's own pose, three hours, before/after, frames read by eye

All frames in `shots/k7/greenring/`, fresh page load per run (the AFTER frames
exercise the shipped code path, not a hand-set paint property), same protocol
both sides via `scripts/verify/shot.mjs`.

| hour | frames | mint-outline px | green-dominant px (band y240-340) | changed px vs before |
|---|---|---|---|---|
| day p=0.14 | `before/after-H4-day.png` | 477 -> 0 | 1416 -> 113 (the residual is the park FILLS' own legitimate green) | 25,822 |
| dusk p=0.5 | `before/after-H4-dusk.png` | 0 -> 0 (speckles below the mint threshold at dusk; see band crops for the visible change) | 0 -> 0 | 972, all in y 243-318 |
| night p=0.92 | `before/after-H4-night.png` | — | 159 -> 0 | 2,892 (54 sky px = one star speck at (909-911, 51-52), see below) |

- Mint-outline criterion `g>r+30 && g>b+25 && g>120`; green-dominant
  `g>r+20 && g>b+20 && g>60` — both derived by sampling the squiggle pixels
  themselves (~rgb(50,95,68) after the night grade).
- **The changed-pixel sets are honest to the pixel**: a same-build repeat of
  the day pose (`rep-H4-day-rep2.png` vs `after-H4-day.png`) differs by
  **zero** pixels at the same tolerance — SwiftShader is exactly deterministic
  here — so every changed pixel in the before/after pairs is the outline
  recolour. The day count is large because at this wide pose park polygons
  pepper the whole ground (1,321 of those pixels are outline pixels inside the
  downtown rectangle: Republic Square, Waterloo Park, etc.), every one of them
  swapping a 1 px authored-mint perimeter for a fill-matched one.
- **The far ring recedes, it does not vanish**: the fix touches no fill —
  the park/landcover fills were already tinted correctly and are bit-identical
  in the after frames. The horizon silhouette and far-field structure hold in
  all three after frames (read by eye).
- Zero console errors in every run (`shot.mjs` error capture).

## Reel-shot regression check

`?autopilot=1&preset=cinematic&drift=0` and
`?sliderdemo=1&preset=cinematic&drift=0` at 390x844, deviceScaleFactor 2,
touch enabled, timed from the `#veil` `lift` class per
`docs/sweep-2026-08-22.md`: frames at lift+1 s/+5 s/+10 s (Shot A) and
lift+20 s (Shot B) in `shots/k7/greenring/reel-*.png`. **Both hold, read by
eye**: Shot A opens with downtown standing over campus on frame one, joystick
nub and BOOST live, and at +10 s the Tower stands centre with the full
downtown skyline behind; Shot B at +20 s is full night parked on the campus
view, Tower lit base-to-crown, knob at the moon. No green squiggles anywhere,
zero console errors in both modes. (This check ran on hardware GL —
`VERIFY_GL=hardware` — which chrome.mjs's own guidance endorses for
screenshot runs where composition, not exact hex, is the assertion; the
first SwiftShader attempt sat 25 minutes without producing frame one while a
sibling lane's freeze test loaded the machine, and was killed.)

## Incidental finding for the K7 #1 lane (night-pale horizon)

The same inventory shows the basemap `building` FILL layer (2D footprints,
kept in `_groundFills` and tinted `#242121` at night) also carries an authored
zoom-ramped outline `hsla(35, 6%, 79%, 0.32)` — a pale warm grey that
`js/timeofday.js` likewise never retints. Same defect class, different colour
family; it is a candidate mechanism for the pale sheet at the spawn pose. Not
touched here — it is not green, not vegetation, and it is the other lane's
investigation.

## What this did NOT establish

- Only the H4-city pose was re-verified at three hours (plus the two reel-shot
  modes). Other sweep poses that showed muted speckles (`sw-downtown-day`)
  were not re-shot; the mechanism is one property on one global layer, but
  those exact frames were not re-taken.
- Whether K7 #1's night-pale sheet is the `building` outline above — reported,
  not tested.
- Nothing about motion: the outline now follows the same 1/128-quantised heavy
  retint as every other basemap tint; a mid-sweep lag beyond that quantisation
  was not measured.
- Desktop 1440x900 SwiftShader for the pose frames; no hardware-GL rep.
- A faint red-only additive sky glow (~+20-25 R across the upper sky) appears
  on a page left running for several minutes and is absent on fresh loads —
  seen on the isolation page before any mask was applied, identical across all
  three isolation frames, so it did not contaminate the diffs. Unidentified;
  plausibly the K7 #3 FX overlay. Logged, not diagnosed.
