# The city at 2 metres — an honest reconnaissance

**Written 2026-08-05, acer lane. Reconnaissance only: no shipped code changed.**
`js/controls.js` was patched locally to reach 2 m and **restored afterwards** —
the diff is quoted below so the next agent can reproduce it in one edit. The only
files written are this one and `shots/eye/`.

Setup, quoted with every number: `python scripts/serve.py 8291` (no gzip),
`node scripts/verify/harness-drift.mjs` **PASS — 28 scripts in `index.html`, 28
in `_harness.html`** — run from the repo root before any pixel.
`_harness.html?intro=0&drift=0`, 1440x900, `deviceScaleFactor 1`, headless Chrome
on **SwiftShader** (the deterministic default in `scripts/verify/chrome.mjs`, not
the GPU), `cancelGraphicsAutoDetect()` at the top of every run. **One browser at
a time**, four sequential runs, reaped at the end. Every altitude below is the
**rendered** eye height, recomputed from `map.getZoom()/getPitch()` after the
scene settled — not the altitude that was requested.

---

## The one-paragraph answer

**Lowering `ALT_MIN` alone does not give you a walkable city, and I can prove it
in one measurement.** Standing still at 2 m works everywhere. But the moment you
press `W` on a West Campus pavement, the camera is thrown to **66.5 m in under a
second** — reproduced twice, at two sites, with the mechanism identified. That is
not a taste problem, it is a second floor nobody had found: the anti-clipping
guards measure "is there something tall within **6 metres horizontally**", which
at 18 m means "am I about to hit a roof" and at 2 m means "am I standing on a
pavement next to a building". **Fix that and eye level is genuinely viable** — on
open ground it already holds at 2.0–4.3 m with no help at all. Then the honest
bad news: the *pictures* at 2 m are worse than the geometry. Facade textures
collapse into barcodes and moiré, the two most famous landmarks in the frame set
(the Texas Capitol and Battle Hall) are blank perforated slabs, the street is
unlit at night, and stars and the moon draw straight through solid buildings.

---

## Part 1 — There are FIVE floors, not one. Four of them survive `ALT_MIN = 2`.

`js/controls.js:85` is the famous one. It is not the only one, and the other four
are the ones that actually stop you walking.

| # | Where | What it does | Survives `ALT_MIN=2`? |
|---|---|---|---|
| 1 | `ALT_MIN = 18` (line 85), used at lines 1086 and 1176 | clamps `alt` and `altUser` | no — this is the one everyone knows |
| 2 | `outAlt = Math.max(outAlt, 12)` in `writeToMap()` (line ~601) | **a second, undocumented, hard 12 m floor on the pose that is actually written to MapLibre** | **YES** — patch line 85 alone and the camera still never renders below 12 m |
| 3 | the hard net, line ~1180: `if (h > 0 && alt < h + HARD_CLEAR) { alt = altUser = h + HARD_CLEAR; }` where `h = maxHeightIn(eye, R_CAM=6)` | ejects you to roof + 4 m | **YES — and this is the walking-killer** |
| 4 | `writeToMap()`'s own copy of the hard net (line ~598) | same, on the written pose | **YES** |
| 5 | the rooftop floor, `altFloor = roof + SKIN_V (8)` with the `STEP_UP = 12` skim | ramps you over anything short | **YES** |

**#2 is the one that will waste someone's afternoon.** It is a bare literal with
no comment. Patch `ALT_MIN` to 2, screenshot, and you get a 12 m frame that looks
plausibly low and is not eye level.

The exact local patch used for this recon (**not committed**):

```js
// line 85
const ALT_MIN = (typeof window !== 'undefined' && window.__EYE_MIN != null) ? window.__EYE_MIN : 18;
const ALT_MAX = 900, ALT_SLACK = 30;

// line ~601, in writeToMap()
outAlt = Math.max(outAlt, Math.min(12, ALT_MIN));

// line ~99, so the recon could measure what the guard costs
const CELL = 6, SKIN = 2.5, SKIN_V = 8, STEP_UP = 12;
const R_CAM = (typeof window !== 'undefined' && window.__EYE_RCAM != null) ? window.__EYE_RCAM : 6;
const HARD_CLEAR = (typeof window !== 'undefined' && window.__EYE_HARD != null) ? window.__EYE_HARD : 4;
```

### Standing still at 2 m: works, everywhere, exactly as asked

The controller only takes ownership when `|alt - resolvedAlt| > 0.05`. With
`altUser = 2` and `ALT_MIN = 2` that test is false, so a scripted pose is left
alone and **all 42 frames in `shots/eye/` were rendered at the altitude they
asked for** (`renderedAlt` 2.00–2.27 m, position drift ≤ 1.5 m). Note the
consequence: **a stationary camera at 2 m is not protected by anything.** Several
frames are inside a wall because nothing stopped them.

### Walking at 2 m: it works on open ground and explodes next to a building

Placed at 2 m, waited for `!driving`, then **one 0.7 s tap of `W`**. Two reps per
site, both printed; the reps agree.

| site | `roofAt(eye, R_CAM=6)` | alt before | alt after one step | change |
|---|---|---|---|---|
| South Mall lawn | 0 m | 2.00 | **2.82** | +0.8 |
| East Mall | 0 m | 2.21 | **4.31** | +2.1 |
| Rio Grande carriageway | 0 m | 3.22 | **3.21** | 0.0 |
| Guadalupe pavement | 11.3 m | 2.00 | **16.2 / 15.7** | **+14.2 / +13.7** |
| Nueces pavement | 62.5 m | 2.00 | **66.5 / 66.5** | **+64.5** |

`altUser` — the *persistent* user altitude, not a transient lift — lands on
exactly `roofAt + HARD_CLEAR`: 11.3 + 4 = 15.3, 62.5 + 4 = 66.5. That identifies
the guard beyond doubt as the hard net at line ~1180.

**The lever is `R_CAM`, and I measured it.** Same probe, same sites, with
`R_CAM = 1.0` m instead of 6:

| site | +alt at `R_CAM = 6` | +alt at `R_CAM = 1` |
|---|---|---|
| Nueces pavement | **+64.5 m** | **+0.8 m** |
| Rio Grande | 0.0 | 0.0 |
| South Mall / East Mall | +0.8 / +2.1 | −0.4 / −0.3 |
| Guadalupe pavement | +14.2 | +9.9 (that pose really is ~1 m from a 9.4 m wall) |

A 6 m horizontal probe is correct for a camera that is *above* the roofline; it
is wrong for one standing on a 3 m pavement, where it reads "a tower is within
6 m" as "you are inside the tower". Sustained walking is the same story:
holding `W` for 14 s from 2 m on the Drag never got below **15.3 m** and settled
at **19.3 m**; walking at a wall ended at **37.5 m — standing on the roof**
(`shots/eye/40-walked-at-a-wall-from-2m-ended-on-the-roof.png`).

**Related, same root cause:** `STEP_UP = 12` lets the camera *skim over* anything
whose roof is within 12 m of the eye. At 18 m that is a sensible "hop the low
stuff". At 2 m it means **every building under ~14.5 m stops being a wall and
becomes a ramp** — you walk at a two-storey West Campus house and are lifted onto
its roof instead of being stopped.

---

## Part 2 — What the pictures show, ranked by how bad it is

All frames in `shots/eye/`. I looked at every one; the ranking is mine.

### 1. Facade textures do not survive close range. This is the worst thing, by a distance.

They are tile patterns authored to be read at 200–900 m. At 2 m a repeat that
covers ~1.2 m of wall subtends a third of the screen, and three distinct failure
modes appear:

* **Barcode.** `12-twenty-two-15-whole-frame-is-one-texture-day.png` is the whole
  1440x900 frame filled with vertical brown stripes and nothing else. The Main
  Building's south wall does the same in `02-main-building-portal-day.png`, and
  its east wall in `08-east-mall-portal-in-a-barcode-day.png` — where you can
  also see a **hard horizontal seam** all the way across where the tile changes
  band.
* **Pegboard.** `04-guadalupe-wall-is-a-pegboard-day.png` and
  `06-rio-grande-starbucks-with-no-shopfront-day.png`: the window grid becomes a
  literal grid of brown dots on tan, ground to sky, 1.2 m apart.
* **Moiré.** `07-battle-hall-moire-day.png`, `13-sutton-hall-arcade-day.png` and
  `23-alley-moire-and-stars-through-walls-night.png` show textbook chevron
  interference where the repeat beats the pixel grid. Battle Hall and Sutton
  Hall — two of the best buildings on campus — read as corrugated card.

Distance proves it is magnification and not the texture: in
`17-south-mall-south-no-aerial-haze-day.png` the *same* PCL dot grid at 200 m
reads perfectly well.

### 2. The landmarks people will aim at have no ground floor.

* **The Texas Capitol** (`16-the-texas-capitol-at-2m-day.png`) is a red
  perforated slab meeting flat sand. No dome, no portico, no columns, no steps,
  no plinth. From the south lawn (`11-...`) it is a red warehouse behind a label.
* **Battle Hall** (`15-battle-hall-is-a-blank-wall-day.png`): **~90 % of the
  frame is two flat colour fields** — tan ground, tan wall, one hard line
  between. No arcade, no arch, no window, no door on that whole elevation.
* **Sutton Hall's arch** and the South Mall arch (`13-`, `07-`) are flat
  brown blobs with zero recess — painted arches.
* **DKR** (`10-`, `24-`) reads as a striped mass; the concourse is flat
  rectangles.

The 584-door / 24-lobby / recessed-shopfront work **is the exception, and it is
good.** The Main Building portal (`02-`, `08-`) has a real reveal, jamb, steps,
transom and glazed leaves. The Drag (`03-the-drag-pavement-day.png`) has awnings,
recessed shopfronts, a kerb, a verge and bollards. Nueces
(`05-nueces-street-west-campus-day.png`) has a glazed lobby, a canopy and a bin
and is the most convincing frame in the set. **That work reads far better at 2 m
than at 18 m and it is the strongest argument for doing this.** But it is a
3 m-tall stripe at the bottom of a 60 m barcode.

### 3. Sky, stars, moon and clouds draw *through* solid geometry.

Only visible from below, and it looks broken rather than stylised.

* **Stars over tree canopies and over walls**:
  `20-south-mall-stars-drawn-over-canopies-night.png` has stars sitting on the
  canopies right across frame; `23-...` has them scattered over two brick walls
  1.5 m away.
* **The moon in front of DKR**:
  `24-dkr-the-moon-is-drawn-in-front-of-the-stadium-night.png` — the disc is
  unambiguously painted on the stadium facade.
* **Clouds over a wall 2 m away**:
  `09-clipped-into-a-wall-clouds-drawn-over-it-day.png`.

### 4. Trees are the second-worst thing in the frame, and they are everywhere.

* Canopies are **stacks of flat hard-shaded plates** with visible gaps you can
  see sky through (`14-under-a-live-oak-labels-collide-day.png`), and their
  undersides are unlit flat green with no dappling and no shadow cast on the
  ground.
* **Trunks are square slabs ~2 m across** — at eye level they are pillars, not
  trees.
* **Trunks and canopies are not attached.** `10-dkr-floating-canopies-day.png`
  has canopies hanging in mid-air with no trunk beneath; `03-` has a picket line
  of trunks along the Drag with far fewer canopies above them. This is the same
  root cause HANDOFF §103 measured from the data (73 % of canopy centres have no
  trunk within 2 m); at 18 m it is invisible, at 2 m it is the first thing you
  see.
* **Canopies are translucent and unsorted**: on the Capitol grounds
  (`11-capitol-grounds-canopies-are-see-through-day.png`) you look *through* the
  canopies at the building. From above they read as canopy; from below they are
  green fog.
* Walking under one turns a third of the screen into a flat green field with no
  interior (`09-`).

### 5. Labels are the most obviously wrong UI element at eye level.

Sizing is pinned to zoom, not to distance in metres, so at 2 m the nearest label
is a billboard and everything else is dust — and because the horizon sits at
mid-frame, *every label in the city projects into one narrow horizontal band*.

* `03-the-drag-pavement-day.png`: **"Chipotle" is rendered ~35 px tall, floating
  in the middle of the pavement, bigger than the shop it names**, while "Dollar
  Slice Club" 20 m away is 6 px and "Foxtrot"/"The Co-op" collide.
* `14-under-a-live-oak-labels-collide-day.png`: eight building labels in one
  overlapping row.
* At night they are still day-coloured white/red chips in an unlit street
  (`21-`).

### 6. The night street is unlit. Not moody — unlit.

`21-the-drag-the-street-is-unlit-night.png`: the pavement, road and verge are
near-black; the only light in the frame is the shopfront glazing. There is **one**
street-lamp pool in the whole set (`22-nueces-one-lamp-pool-night.png`) and it is
a flat painted ellipse on the tarmac with no falloff onto the kerb, **no pole
above it**, and no light thrown on the buildings. The lamp posts elsewhere are
unlit black sticks. And the daylight-coloured shopfront apron polygon on the Drag
stays fully bright at night, glowing in a black street.

At 18 m this reads as a beautiful night skyline. At 2 m it reads as a blackout.

### 7. The ground plane carries the frame now, and it is a flat colour.

At 18 m the ground is ~30 % of the picture; at 2 m with the horizon at mid-frame
it is 45–60 %, and it is a single fill with a soft ~5 m noise.
`15-battle-hall-is-a-blank-wall-day.png` is **~55 % one tan**;
`13-sutton-hall-arcade-day.png` ~60 %. Where the ground *texture* is visible it
shows its repeat as a soft ring ~30 m across sitting in front of you like a stain
(`10-`, `07-`). No paving joints at pedestrian scale, no gutter, no drain.

**Kerbs are the happy surprise: they exist, they are the right height, and they
read correctly** (`05-`, `06-`, `03-`, `11-`). Thresholds and door sills do not —
doors meet the pavement at a hard colour seam with no step.

### 8. No aerial perspective, so distance reads wrong from below.

`17-south-mall-south-no-aerial-haze-day.png`: downtown at ~2 km is as saturated
and contrasty as a building 40 m away, and the ground plane simply ends at a hard
flat horizon. At 18 m looking down this is hidden; at 2 m the horizon is 40 % of
the frame.

### 9. Small stuff, still visible.

Flat-plane awnings with no thickness; hedges as green cubes and stacked boxes;
lamp posts with no lamp head; specular smears on walls that read as grease; a
grey banner sprite floating over DKR at night; no cars and no people, which at
200 m reads as a model and at 2 m reads as evacuated.

---

## Part 3 — What I would tell Simeon

**The 2 m floor is the right call and I would still take it.** The frames that
work (`03`, `05`, `17`, `22`) are better than anything at 18 m, and the
ground-floor pass finally has a viewpoint. But the honest summary is that
**lowering the number is roughly a fifth of the job** — the collision system and
the facade textures are the other four fifths, and neither is a one-line change.

**If he wants one number today rather than a project, `6 m` is the answer** —
`shots/eye/31-ladder-the-drag-at-06m.png` against `30-` (2 m) and
`33-...-at-18m-today.png`. At 6 m the awnings, shopfronts, kerb and street
furniture all read, the texture magnification is roughly a third of what it is at
2 m, and every measured wall-eject in the table above shrinks. It is a first-floor
window rather than a pavement, so it is not walking directions — but it is an
honest, shippable improvement that needs no other work. **2 m is the right
destination; 6 m is what is ready.**

---

## MUST-FIX before eye level is genuinely good

1. **The hard net and the rooftop floor must stop treating "next to a building"
   as "inside a building."** `R_CAM = 6` is a horizontal radius sized for a
   camera above the roofline. Make it altitude-dependent (near ~0.5–1 m below,
   say, 20 m; 6 m above) or replace the radius test near the ground with a
   point-in-footprint containment test. Measured payoff: Nueces goes from **+64.5
   m to +0.8 m** on one step. **Nothing else on this list matters until this is
   done, because until it is done you cannot walk.**
2. **Delete or parameterise the undocumented `outAlt = Math.max(outAlt, 12)` in
   `writeToMap()`.** It is a second hidden floor and it will silently defeat the
   fix.
3. **Gate `STEP_UP` on altitude.** A pedestrian does not step over a 12 m
   building. Below ~10 m of eye height the skim should be a couple of metres
   (kerbs, plinths, steps) and everything else should be a wall.
4. **Give the facade atlas a close-range level.** Either a mip/detail level that
   fades the fine grid out under ~15 m of camera distance and leaves the base
   colour plus real modelled openings, or one extra atlas tier authored for
   pedestrian range. Everything below is cosmetic next to this; it is the
   difference between "a stylised city" and "a texture bug".
5. **Depth-test the celestial and cloud layers against the scene.** Stars, moon
   and clouds currently draw over solid geometry. This reads as a bug, not a
   style, and it is likely a draw-order fix rather than new art.
6. **Size labels by distance in metres, not by zoom, and add a near-clip.** A
   35 px "Chipotle" on the pavement and an 8-label pile-up on the horizon are
   both the same bug. Below some eye height, show only what is within ~60 m.
7. **Light the street at night.** One warm pool per lamp with real falloff onto
   the kerb and wall, a visible lamp head, and a night tint on the daylight apron
   polygons. Without it the night mode is unusable from the pavement — which is
   half the reason to be there.
8. **Attach every canopy to a trunk and stop drawing canopies translucent.**
   Derive crown radius and trunk diameter from one another in
   `scripts/shape_trees.py` (HANDOFF §103 already asks for this) and give the
   canopy an opaque underside. Right now trees are the second thing a walking
   user notices after the barcode.

## NICE-TO-HAVE

9. Aerial haze / desaturation with distance, and a soft horizon band.
10. A pedestrian-scale ground texture: paving joints, gutter line, a smaller
    repeat, and no visible 30 m tile ring.
11. Thresholds and door sills — one step at every door the entrances pass placed.
12. Round the tree trunks and break the canopy plates; the hard plate stack is
    the single most cartoon element at 2 m.
13. Give the Capitol, Battle Hall and Sutton Hall a modelled ground storey
    (portico, arcade, arch reveal). These are what people aim at.
14. Awning thickness, lamp heads, hedge silhouettes.
15. Contact shadow / ambient occlusion where objects meet the ground; hedges and
    aprons currently look pasted on.
16. Some life on the street. Empty is fine at 200 m and conspicuous at 2 m.

## Things that do NOT need fixing, verified by looking

* **Kerbs are correct** — right height, right profile, and they read at 2 m.
* **The entrances/lobby/shopfront pass is good** and is the best thing in every
  frame it appears in.
* **The road markings, verges and street furniture** hold up.
* **Walking on open ground already works at 2 m** with no change at all.
* **The flyover is untouched by any of this.** The default pose, the intro and
  the tour never go near the floor; this only adds a floor you can reach.
