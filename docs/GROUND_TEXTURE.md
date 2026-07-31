# The ground-texture pass

> "the ground doesnt look like the ground it looks like a walkway of flour. Roads
> should look like roads. Add a bit of texture. Grass and water should also have
> a bit of texture"

Everything here lives in `js/ground.js`. No data was re-baked, no new file is
fetched at runtime, and `scripts/bake_ground.py` was not changed — the finding
that made this pass tractable is that the thing the complaint is mostly about
was never in `data/ground.geojson` at all.

## 1. The roads were not ours to begin with

`scripts/bake_ground.py` reads `footways`, `plazas`, `landuse`, `water`, `sport`
and `parking`. It reads **nothing drivable**. Every road in the frame was the
Liberty basemap's own `transportation` source-layer, kept by `cleanupBasemap`
and painted from the `road` / `roadCasing` entries in `js/timeofday.js`:

| | day | golden | night |
|---|---|---|---|
| `road` | `#e2dac7` | `#e8c79a` | `#2a2519` |
| a concrete footpath | `#dfd9cb` | `#e3cba6` | `#181b24` |

Measured on the real render (`scripts/verify/ground-luma.mjs`), a road and a
campus footpath were **6.2 luma apart by day and 0.4 luma apart at night**. They
were the same object. That is the complaint, in a number.

`styleRoad` also writes **one** width expression across every road layer it
keeps, so a motorway and a residential street could not differ in width even in
principle — and the layer ids come from whatever version of the basemap style
loads.

So this pass takes the roads over. The basemap's `transportation` line layers
are hidden (and remembered, so `GROUND.roads = false` hands them straight back)
and redrawn from the same vector tiles as `ground-road-casing` / `ground-road` /
`ground-road-lane`, with:

- **the `asphalt` tone from the SURF palette** — pushed darker and cooler, and
  now doing double duty for roads and parking lots;
- **width by OpenMapTiles `class`**, in metres, through the same
  metres-to-pixels machinery the paths already used (`GROUND.roadWidth`);
- **`service` alleys on a zoom fade**, because 246 extra hairlines at altitude
  read as noise;
- **lane markings only where a real road has them**: `class` in
  `GROUND.laneClasses`, never a ramp, never a tunnel — and the colour is chosen
  from the data, yellow down the middle of an undivided road and white on a
  carriageway the tiles mark `oneway`.

`js/timeofday.js` is untouched. Its `road`/`roadCasing` writes now land on
hidden layers, which is the cheapest possible way to not have to edit a file
another session owns.

## 2. fill-pattern, measured rather than assumed

The brief said to verify the scaling behaviour rather than trust the docs.
`scripts/verify/pattern-scale.mjs` paints a hard-edged 32 px stripe tile on the
ground areas, looks straight down and counts the on-screen period:

```
zoom   periodPx   period_m
16.0        32       33.0
16.5        46       33.5
17.0        32       16.5
17.5        46       16.8
18.0        32        8.2
```

`fill-pattern` is anchored in **tile space at the image's native pixel size**.
It stretches by 2^frac within a zoom level and **snaps back at every integer
zoom**, so the feature size in metres halves each level. 46 ≈ 32·√2 confirms the
stretch; the reset at 17.0 and 18.0 confirms it is not world-anchored.

The design consequence is not negotiable: **only scale-free noise survives**.
Anything with a period the eye can count changes size 4× across the zoom band
the camera flies in and pops at every integer zoom. That is why all four tiles
are blobs and speckle, and why the first water tile — one clean band plus a
wobble — had to be thrown away after it rendered Waller Creek as a zebra ribbon.

## 3. Two techniques, both kept, because they do different jobs

The brief asked for both to be measured before choosing.
`scripts/verify/ground-flatness.mjs` chops the ground half of a flying frame
into 16×16 blocks and reports the share whose luma standard deviation is near
zero — the measurable version of "reads as paper" — plus the distinct-colour
count, which is the metric per-feature jitter moves and local contrast cannot.

```
config    surfaceSd   %flat<0.5   distinct colours
flat         16.086       17.8                 878     <- as it shipped
jitter       16.071       17.6                 973
texArea      16.249       14.5                1011
texBase      16.127       13.3                 885
all          16.273       10.1                1081
```

They are complementary, not alternatives:

- **`fill-pattern`** is what removes flat area: 17.8% → 10.1% of the frame is
  dead flat, a 43% cut. It barely moves the colour count.
- **per-feature jitter** is what removes flat *colour*: +203 distinct colours,
  and it costs no image and no per-frame work. It cannot show up in local
  contrast because it varies between features, not inside one.

`texBase` is a patterned `background` layer, and it is listed separately on
purpose — a patterned background either works or does nothing at all, and it
must not be credited for the fill layer's result. It measurably works, and it
reaches the catch-all ground under everything OSM does not classify, which was
54% of an isolated ground frame and belongs to `js/timeofday.js`.

## 4. Time of day is free

The facade atlas has to be redrawn on every time-of-day tick because its colour
lives inside the image — a `getImageData` readback per pattern, described in
`js/timeofday.js` as the slowest common canvas2d op on iOS.

These tiles carry **no colour at all**. They are pure alpha modulation: black
where they darken, white where they lighten. They are generated once at load and
never touched again. `applyGroundColors` moves the layer's *opacity* along the
same day→golden→night ramp as everything else, which is one `setPaintProperty`.

The jitter rides the ramp for free too, because its amplitude is expressed as a
**fraction of each surface's own luma** rather than an absolute step: ±6% of a
217-luma daytime path is ±13, and ±6% of the same path at night (luma 27) is
±1.6. One number, correct at every hour.

## 5. The lane-marking rule, checked against streets we know

The rule is "white lane divider if the tiles mark the carriageway `oneway`,
yellow centre line otherwise". `oneway` arriving as the string `"yes"` instead
of the number `1` would push every road onto the yellow branch and the rule
would be silently wrong, so `road-probe.mjs` checks it two ways.

The values are `number:1` on 655 features and **absent** on 230 — there is no
`oneway: 0`, which the `['==', 1]` test handles correctly. 655 of 885 looks
alarming until you notice the histogram covers *every* transportation feature:
246 service roads, 170 paths and 54 ramps are most of it, and none of those is
eligible for a marking.

Then the part that actually settles it — point-query streets whose direction is
not in doubt, at pitch 0, where the centre pixel is the street:

```
street                    class       oneway  ->marking      reality
Guadalupe @ the Drag      primary     -       yellow        TWO-WAY
MLK Jr Blvd @ Univ        secondary   -       yellow        TWO-WAY
Speedway @ 24th           NO FEATURE  -       ?             pedestrianised
```

Both named two-way arterials take the yellow branch, and Speedway correctly
returns no road at all because it is a pedestrian mall. The remaining rows in
that table are query misses on coordinates that were off the carriageway, not
absences — the one-way branch is confirmed only visually, on I-35's divided
mainlanes in `tex-inspect`, which is weaker and is listed under what is missing.

## 6. Frame cost: none that can be measured

`ground-tex-perf.mjs`, headed, `index.html`, scripted bearing sweep, six reps,
configurations interleaved **and counterbalanced** (the order reverses on
alternate reps, because the machine drifts upward across a run and whichever
config always goes first wins by construction):

```
config    dropMIN   all reps
before       167    [167, 175, 178, 194, 190, 172]
roads        179    [190, 189, 182, 198, 183, 179]
noTex        181    [193, 183, 186, 197, 181, 190]
after        174    [182, 182, 178, 174, 193, 186]

delta vs before (MIN of 6):  roads +12   noTex +14   after +7
within-config spread of `before` alone: 27
```

**There is no result here, and that is the finding.** Every delta is smaller
than the spread one configuration produces on its own, and the ordering is not
monotonic in the amount of work — `after` measured *cheaper* than `noTex`, which
does strictly less. That is only possible if these are noise. An earlier 4-rep
run reached the same conclusion with different numbers.

What can be said honestly: any real cost is below roughly 14 dropped frames per
4.2 s on this machine, which is under the measurement floor. The design reason
to expect that is in §4 — the tiles are generated once and never regenerated,
so the per-frame addition is three line layers, one fill layer and one
background layer, and no per-tick image work at all.

## 7. What is still flat

- **The road surface itself.** `fill-pattern` is a fill property; a line layer
  would need `line-pattern`, which tiles *along* the line and would read as a
  repeating stripe down every street. Roads get their variation from the casing,
  the class widths and the markings, and the carriageway is still one flat tone.
- **The remaining 10.1%** of dead-flat blocks is mostly far-field ground where
  the texture sits under the haze. That is aerial perspective doing its job, not
  a defect.
- **The one-way branch of the lane rule is confirmed only by eye**, on I-35's
  divided mainlanes. Every point-query coordinate for a known one-way street
  missed the carriageway. The two-way branch is confirmed properly.
- **The road widths are generative, not measured.** The tiles carry no width and
  no lane count, so `GROUND.roadWidth` is an honest typical section per class,
  not a survey. Roads went from 5.6% to 30.3% of an isolated ground frame, which
  is plausible for a US city but is not verified against a real section.
- **`js/timeofday.js` still keeps `road` and `roadCasing` in all three presets**
  and still writes them every tick. They now land on hidden layers and do
  nothing. Deleting them belongs to whoever owns that file.

## The frames

From the flying camera (`scripts/verify/shots-ground-tex.json`), in `docs/shots/`:

| | before | after |
|---|---|---|
| Guadalupe, day | `ground-drag-day-before.jpg` | `ground-drag-day-after.jpg` |
| West Campus, day | `ground-westcampus-day-before.jpg` | `ground-westcampus-day-after.jpg` |
| Guadalupe, golden | `ground-drag-golden-before.jpg` | `ground-drag-golden-after.jpg` |
| Guadalupe, night | `ground-drag-night-before.jpg` | `ground-drag-night-after.jpg` |

## Verifying it

```bash
python -m http.server 8137 --bind 127.0.0.1     # from the repo root, own port
```

```bash
cd scripts/verify && VERIFY_URL=http://127.0.0.1:8137 node ground-luma.mjs
```

- `ground-luma.mjs` — the luma separations, by positive identification: one
  render for colour, one with each class painted a key colour for the mask.
  **This is the guard on the trap.** The paving tones are pale on purpose; if
  path-vs-ground separation ever falls back toward single digits, the bug that
  made the whole path network invisible has come back.
- `pattern-scale.mjs` — the fill-pattern scaling law, remeasured.
- `ground-flatness.mjs` — local contrast and colour count, per technique.
- `tex-inspect.mjs` — one surface with the pattern on, off, and alone, plus the
  raw tiles at 3× so a defect in a *tile* is not diagnosed as a defect in the
  *map*.
- `ground-tex-perf.mjs` — the interleaved A/B, minimum of the reps.
- `road-probe.mjs` — what the basemap actually carries: classes, subclasses and
  which layers `cleanupBasemap` left showing.
