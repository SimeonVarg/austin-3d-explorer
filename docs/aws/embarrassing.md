# The embarrassing list — what a stranger will notice on the tape

Read-only audit of **https://flyover-utx.vercel.app/** (the live site, not
localhost), 2026-08-06. **Nothing was changed. No commit, no push, no PR, no
fix.** Every defect below is written down and photographed and left exactly
where it is.

You asked for brutal. This is brutal. It is also fair: the app is genuinely
good-looking from 100–300 m at golden hour, and most of what follows only bites
at eye level, at night, or in the corners of the frame. The two things that
would embarrass you most are **not** the ones on your list.

---

## The instrument, and what it cannot tell you

* **Chrome, headless, real GPU** — `ANGLE (NVIDIA GeForce RTX 3050 Ti Laptop GPU,
  D3D11)`, 1600 × 1000 at dpr 1 (the `F-` batch is dpr 2). Every frame is
  screenshotted twice and the second one kept.
* **"Phone" is Chromium device emulation** — 393 × 852 CSS px, dpr 3, `isMobile`,
  `hasTouch`, iOS Safari user-agent string.
  **> REAL iPHONE / REAL SAFARI IS UNTESTED AND UNTESTABLE FROM HERE.** Emulated
  mobile is Blink on a laptop GPU wearing a costume. Different memory ceiling,
  different WebGL, different canvas handling, no thermal throttling. Nothing
  below predicts your actual phone. Anything marked UNTESTED stays untested.
* **The graphics auto-detect probe** was *cancelled at load* for the `B-` and
  `F-` batches (so those are a chosen preset), *left running* for the `A-`, `E-`
  and `M-` batches (so those are what a visitor actually gets). It says which,
  per finding.
* Pictures live in `shots/aws/`. Filenames are quoted against every claim.
  **A defect without a frame is not in this document.**

---

# THE RANKING

How likely is a stranger to notice it in a screen recording, worst first.
"Avoidable" means you can dodge it with framing or a keypress before you record.

| # | What | Notice? | Avoidable? |
|---|---|---|---|
| 1 | The app quietly downgrades its own graphics 25 s in — and stays downgraded next time | Certain | **Yes** — press `G`, pick Balanced |
| 2 | Building labels draw straight through whatever you are looking at, and `P` does not remove them | Certain | **No** — framing only |
| 3 | Look down at walking height and you get launched 48 m into the air | Certain, if he looks down | **Yes** — don't |
| 4 | Street level is half blank ground and giant flat tree slabs | Certain, if he walks | **Yes** — don't walk on tape |
| 5 | The night street is a sand-coloured plane | Certain, at night on foot | **Yes** — no night street |
| 6 | DKR close up: comb-shaped stairs, black holes in the seating | High | **Yes** — shoot it from above or far |
| 7 | The UT Tower vanishes above ~400 m | High on any wide | **Yes** — stay under 400 m |
| 8 | Lady Bird Lake is grey concrete, and meets blue water at a seam | High | **No** — if downtown is in frame |
| 9 | The Capitol dome is unlit at night | High | **Yes** — shoot the Capitol at dusk |
| 10 | The Tower's night flood dies to black at the base | Medium-high | Partly — frame the top half |
| 11 | The clouds look like lens smudges | Medium | **Yes** — keep the upper sky out |
| 12 | Lens-flare ghosts smeared across the road at low sun | Medium | Partly |
| 13 | Big blank roof slabs fill the foreground at 60–90 m | Medium | **Yes** — fly higher or lower |
| 14 | Everything past ~1 km is one flat tan carpet | Medium | **No** — on any wide |
| 15 | On a phone the UI eats ~22 % of the screen | Medium | **No** on phone (`P` is desktop only) |
| 16 | The BOOST button | Medium | **Yes** — it only exists on narrow layouts |
| 17 | A missing building beside Dobie — a blank lot with an orange rim | Low-medium | **Yes** |
| 18 | Roofs stab through each other; campus roofs are flat sage slabs | Low-medium | **Yes** |
| 19 | A hard horizontal seam across the sky | Low | **Yes** |
| 20 | West Campus at street level is a striped moiré tunnel | Low (needs walking) | **Yes** |
| 21 | The Speedway roof has a hard two-tone diagonal split | Low | **Yes** |
| 22 | Downtown facades are inconsistent — teal window grids next to plain boxes | Low | **No** |

---

# 1. THE APP DOWNGRADES ITSELF ON CAMERA, AND IT STAYS DOWNGRADED

`shots/aws/B-01-preset-BALANCED-wide.png` vs `B-02-preset-PERFORMANCE-wide.png`
`shots/aws/B-03-preset-BALANCED-sun.png` vs `B-04-preset-PERFORMANCE-sun.png`

**This is the worst thing in the report and it is completely avoidable.**

Measured on the live site with the probe left running, twice, headless, on the
RTX 3050 Ti:

```
VISIT 1, +26 s : preset "performance", autoDetected true, localStorage austin3d.gfx.v1 written
VISIT 2, + 8 s : preset "performance"   <- restored from disk BEFORE the probe could run
VISIT 2, +26 s : preset "performance"
```

So:

* **First visit:** ~25 s in, a black pill says *"28 fps measured — switched to the
  Performance preset"*, holds 2.6 s over the middle of the frame, and **changes
  what the app looks like mid-shot.** (`docs/aws/first-impression.md` caught the
  same thing headed, in 3 of 4 runs — two independent instruments agree.)
* **Second visit onward:** it opens straight into Performance with **no toast and
  no announcement**. Take 2 does not look like take 1 and nothing tells you.

What the downgrade actually costs, from `js/graphics.js`:

| | Balanced | Performance |
|---|---|---|
| render scale | 1.0 | **0.75** (the whole image is soft) |
| sun flare / god rays | 0.3 / 0.5 | **0 / 0** |
| ambient occlusion | on | **off** (everything goes flat) |
| draw distance | 700 m | **350 m** |
| tree density | 0.675 | **0.52** |
| outer city density | 1.0 | **0.45** |

Compare `B-03` and `B-04` — same pose, same second. Balanced has a real sun with
a flare and contact shadow under every eave; Performance is a flat pale disc and
a washed-out city with visibly fewer trees.

**Before you record:** press `G` and choose Balanced or Cinematic, or run
`window.cancelGraphicsAutoDetect()` in the console. If you have already opened
the site on the recording machine, **clear the site data first** — the
`austin3d.gfx.v1` key will have Performance in it.

---

# 2. THE LABELS. THIS IS THE ONE YOU CANNOT SWITCH OFF

`P` and `?clip=1` hide the title pill, the hint bar, the slider and the two
buttons. **They do not hide the building names.** Those are map symbols. There
is no key for them. So every frame you shoot carries 10–25 of them, and they are
wrong in five separate ways at once.

### 2a. They draw straight through the landmark

`shots/aws/B-16-tower-night-balanced.png` — the best night frame in the app, and
stamped across the UT Tower's shaft are **"Biomedical Engineering Building"**,
**"Scottish Rite Dormitory"**, **"T. S. Painter Hall"** and **"Pedogna"**. Four
labels, none of which is the building they are sitting on.
Same by day at the same pose: `F-01-TOWER-day-BALANCED.png`,
`F-02-TOWER-day-PERFORMANCE.png`, `A-05-tower-night-base.png`.

### 2b. The same thing gets named twice in one frame

`shots/aws/B-05-dkr-logo-nadir.png` — **"DKR Stadium"** and **"DKR Memorial
Stadium"**, 100 px apart, over the same bowl. Again in
`B-06-dkr-logo-low.png`.
`shots/aws/A-15-speedway-day.png` — **"Target"** appears **twice** in the same
frame, 180 px apart.

### 2c. They clip mid-word at both edges — on DESKTOP, not just phone

`A-04`: "arry Ransom Center". `B-16`: "Garriso", "O'Donnell B".
`A-12`: "eorge H.W. Bush State Office". `F-01`: "Nueces", "Co-op".
`M-01` (phone): "Rio", "Ion".

### 2d. The time-of-day slider is parked on top of them

`A-07`: "21 Ric" — the slider covers the rest of "21 Rio", and "Callaway House"
is behind it entirely. `A-11`: "Dobi… ty2…" for Dobie Twenty21.
`A-14` / `B-11`: "Innov… ow…" bisected. `A-16`: "Robert A. Welch Ha…".

### 2e. At eye level they collapse into one illegible band

`shots/aws/F-04-guadalupe-shopfront.png` — **twenty labels in one frame**, in
eight different colours, all on one horizontal line, several overlapping into
mush, most of them floating in mid-air over a tree.
`shots/aws/D-24-walk-t4.png` — "J2 Dining" and "Jester Java" overlap into
`J2 Dinin̶g̶ster Java`.
`shots/aws/A-09-drag-eye-day.png` — six labels stacked into one unreadable clump
at the left edge.

### 2f. Half of them are ghosted and half are not

In the same frame some names are full white with a hard halo and others are at
~40 % opacity. `A-11` ("The Nine", "Callaway House", "Texas Union", "McCombs"
faded; "The Castilian", "Skyloft" solid). `F-06` (four faded, one solid). It
reads as a rendering fault rather than a hierarchy.

**Nothing here is fixable before the shoot. It is framing or nothing.** The
tightest frames carry the fewest labels: get close, and get the horizon out of
the middle of the picture.

---

# 3. LOOK DOWN AND YOU GET LAUNCHED 48 METRES

`shots/aws/D-10-lookdown-88-before.png` → `D-11-lookdown-asked70.png` →
`D-12-lookdown-asked45.png`

Measured on the live site, standing on the South Mall at **2.67 m**:

| pitch asked | pitch granted | eye altitude |
|---|---|---|
| 88 (start) | 88 | **2.67 m** |
| 85 | 85 | 6.49 m |
| 80 | 80 | 12.58 m |
| 70 | 70 | **24.12 m** |
| 60 | 60 | 34.61 m |
| 45 | 45 | **47.99 m** |

You tilt the view down 43° and the app quietly puts you **45 metres in the air**.
`D-12` is the picture: you were standing on the grass, and now you are looking
at rooftops. On a recording that reads as the app fighting the operator, exactly
as you said.

This is worse than the number in `QUEUE.md` Y16 (which recorded 17.23 m at pitch
45). Today, live, it is 48 m. I did not chase why.

**Avoidable: at walking height, don't look down. Look level or up.**

---

# 4. STREET LEVEL IS HALF BLANK GROUND AND FLAT GREEN SLABS

`shots/aws/F-04-guadalupe-shopfront.png`, `D-23-walk-t3.png`, `D-24-walk-t4.png`,
`B-13-drag-street-day.png`, `M-05-portrait-street-day.png`

**This is the correction I would most want you to hear.** You have been weighing
the 10 m of barcode wall above the Guadalupe shopfronts. The wall is real — see
`A-09-drag-eye-day.png` and `A-10-drag-eye-night.png`, where it fills the right
60 % of the frame as tan-and-brown vertical bars — but **it is not what your eye
goes to first when you actually stand on the Drag.** These three things are:

1. **The ground.** The bottom 45–55 % of every eye-level frame is one flat cream
   or grey plane with nothing on it. No paving joints, no gutter, no kerb detail,
   no markings.
2. **The trees.** At 2 m the canopies are enormous flat-shaded olive slabs with
   hard polygon edges. In `F-04` they cover more than half the picture and hide
   the shopfronts entirely. In `D-24` they are a green ceiling and the trunks are
   plain chocolate rectangles.
3. **The label band** (§2e above).

`B-13-drag-street-day.png` is the honest one: standing in the middle of
Guadalupe, the bottom half is featureless grey asphalt with **two soft circular
lens ghosts smeared across it**, and both walls are pegboard.

**Avoidable: do not put walking-height footage in this video.** The app's
strength is 100–300 m. If you must show that you can walk, show
`D-20-walk-t0.png` framing — level, trees to the side, buildings in the middle
distance — and cut in two seconds.

---

# 5. THE NIGHT STREET IS A BEACH

`shots/aws/B-14-drag-street-night.png`

Standing on Guadalupe at night, the carriageway is a **uniform warm sand colour,
brighter than anything else in the frame**, covering the bottom half. No lamp
pools, no falloff, no texture. The buildings are black with dotted window grids
and the trees are dark slabs. The whole thing reads as a black city floating on
a desert.

This is the night-street fix (#161) overshooting: the road went from "darker than
the frame" to a flat plane brighter than the buildings.

**Avoidable: no night footage at street level.** Night from 100 m up is lovely —
`A-04-tower-night-s.png` and `B-16` are good pictures apart from the labels.

---

# 6. DKR — AND THE LONGHORN LOGO IS ACTUALLY FINE

**The logo: good news.** `shots/aws/B-05-dkr-logo-nadir.png` — from directly
above at 200 m the Longhorn at midfield is a clean, correct, burnt-orange
silhouette. It reads. Yard lines, hash marks and orange end zones are all there.
**It is not broken.**

What *is* broken is that it only works from directly overhead. At any oblique
angle it is a smear: `B-06-dkr-logo-low.png` (123 m, 58° pitch) and
`A-03-dkr-inbowl-day.png` — a small orange squiggle you would read as a scratch
on the grass.

**The bowl is the problem, not the logo.** In `B-06`:

* the radial stair strips **project out past the edge of each deck into open
  air**, so the upper deck has a row of pale sticks poking up over it like a comb;
* there is a **black slab** where the north videoboard should be, and a **black
  hole** in the lower bowl seating;
* the bowl floor around the field is a wide, blank, flat tan ring;
* the near stand is one huge featureless tan wall.

`A-01-dkr-nadir-day.png` shows two more: a **brown rectangle sitting on top of
each end zone**, and a stray dashed line running diagonally across the concourse.

**Avoidable: shoot DKR from straight above (`B-05` is a good frame) or from far
enough away that the skyline carries it. Do not fly into the bowl.**

---

# 7. THE UT TOWER DISAPPEARS FROM HIGH UP

`shots/aws/F-06-tower-far-BALANCED.png` — 435 m, looking south over campus.
**The Tower is not visible at all.** DKR is labelled, Union on 24th is labelled,
and the university's single most recognisable object is gone into the tan.

At 329 m (`A-07-labels-wide.png`) it is present but is a featureless cream stub
with no clock and no crown detail.

**Avoidable: keep Tower shots under about 400 m.** `F-01` at 98 m is the good one.

---

# 8–14. THE REST OF THE VISUAL LIST

**8. Lady Bird Lake is grey concrete.** `B-07-lake-water-day.png` — the water
through downtown is the same flat grey as the roads, and at the far end of the
frame **our grey meets the basemap's blue at a hard seam**. In a city sold on its
lake this is the wrong colour. Also `A-13-downtown-day.png`.

**9. The Capitol dome is unlit at night.** `A-14-capitol-night.png` — a dull pink
silhouette while every office block around it glitters. At dusk it is genuinely
handsome (`B-11-capitol-dusk.png`). **Shoot the Capitol at dusk, never at night.**

**10. The Tower's night flood.** `A-05-tower-night-base.png`, `B-16`. The crown
is right — bright, burnt, correct. Below the observation deck the gradient runs
down to near-black, the Main Building underneath is almost pure black, and the
window columns are **stark white vertical stripes that read as paint, not glass**.
There are also two **bright blue point lights** on the ground at the bottom-right
of both frames, among otherwise warm lamps; they look like a bug.

**11. The clouds look like lens smudges.** `B-12-horizon-flat.png` — four orange
blobs with bright cores floating in the sky. `F-06`, `B-09`. They do not read as
cloud; they read as dirt on the lens or UFOs.

**12. Lens-flare ghosts on the ground.** `F-04`, `B-13` — soft circles and rings
smeared across the road and pavement when the sun is low. Turning them off means
Performance, which costs you sharpness (§1). Pick one.

**13. Blank roof slabs in the foreground.** `A-08-labels-close.png` — a single
featureless grey-tan roof fills the bottom **45 %** of the frame.
`A-15-speedway-day.png` — same, plus a hard two-tone diagonal split down it.
`B-09-dobie-utc-far.png` — Rowling Hall's roof, bottom-left. At 60–90 m the app
regularly frames a blank plane.

**14. Beyond about a kilometre the city is one flat tan carpet.** `B-12`, `F-06`,
`A-11`, `A-13`. No colour variety, no height, no skyline — the roads are the only
structure. It is beautiful for two seconds as a wide and it does not survive four.

---

# 15. ON A PHONE THE FURNITURE EATS A FIFTH OF THE SCREEN

`shots/aws/M-01-portrait-home-default.png`, `M-06-portrait-campus-wide.png`

Measured off the live elements at 393 × 852 CSS px:

| element | box | note |
|---|---|---|
| title pill | 176 × 29 at (108, 16) | |
| graphics button | 34 × 34 at (343, 16) | |
| feedback button | 34 × 34 at (343, 58) | |
| **time-of-day column** | **44 × 205 at (341, 324)** | **24 % of screen height, right edge, at eye height — sits on the labels** |
| hint bar | **405 × 26** at (−6, 788) | **wider than the 393 px screen** |
| joystick | 100 × 100 at (32, 682) | |
| BOOST | 60 × 44 at (119, 650) | |

Plus MapLibre's attribution bar under the hint bar — **two stacked bars at the
bottom**. Total app furniture ≈ **22 % of the phone screen**, and the top ~30 %
of the portrait frame is empty sky on top of that.

`P` hides all of it — **on desktop.** There is no key on a phone. `?clip=1` in
the URL does the same job and works everywhere, so **if you film the phone, load
`?clip=1`.** (It still will not hide the building labels.)

---

# 16. THE BOOST BUTTON — what "a bit off visually" is

`shots/aws/M-03-boost-off-crop.png` (off) and `M-04-boost-on-crop.png` (latched)

Four separate things, and they compound:

1. **It collides with the joystick.** Measured: BOOST is a 60 × 44 box at
   (119.5, 650.5); the joystick zone is 100 × 100 at (32, 682), centre (82, 732),
   radius 50. The button's bottom-left corner is **53 px from the joystick
   centre** — i.e. essentially *on* the ring. In `M-03` you can see the ring's arc
   passing under the button's corner. It reads as bolted on, not placed.
2. **It is on the wrong side of the screen.** It sits bottom-**left**, next to the
   joystick, so the same thumb has to steer and boost. Your right thumb never
   goes near it.
3. **Off, it disappears.** A dark brown pill with a thin border. Over a dark
   building it is nearly invisible — see `M-05-portrait-street-day.png`, where it
   is sitting on a brown wall.
4. **On, it is the brightest object on the screen.** `M-04` — solid amber fill,
   white text, white glow, brighter than the sun in the same frame. The jump from
   (3) to (4) reads like an alert, not a state.

**Avoidable: it only exists on narrow layouts, so it is never in a desktop
recording.**

---

# 17–22. THE SMALLER ONES, ALL PHOTOGRAPHED

**17.** `B-09-dobie-utc-far.png` — a **blank tan lot with a thin orange rim**
beside Dobie, where a building should be. Reads as a hole in the model.

**18.** `A-12-jester-roofs.png` — Jester's roof strips cross each other at odd
angles with a dark slab overlapping; campus roofs generally are large flat
sage-green planes with red rims. Also `A-16-southmall-eye.png`: the lawn shows
its **triangulation** as tonal wedges.

**19.** `A-13-downtown-day.png` — a **hard horizontal line across the sky** where
the haze band stops. Same at dusk in `B-11`, at the top of the magenta.

**20.** `B-15-wc-street-day.png` — a West Campus street at 3 m is a converging
tunnel of horizontal brown stripes with severe aliasing, one label rendered as an
unreadable yellow blob, and a flat void for a ground.

**21.** `A-15-speedway-day.png` — the big foreground roof is split into two
different tones by a hard diagonal seam.

**22.** `A-13-downtown-day.png` — downtown towers with crisp teal window grids
stand next to plain untextured tan boxes of the same height. Downtown also still
reads cooler and greyer than campus (`QUEUE.md` K5).

Two more small ones worth a glance: the tenant tags in hot pink / red / green
scattered across campus at 200 m read like map pins, not architecture
(`A-12`, `A-15`); and `A-16` shows the campus facades at 5 m as a **regular dot
grid that reads like pegboard** — the same class of problem as the Drag's
barcode wall, on buildings nobody has looked at yet.

---

# WHAT I COULD NOT ESTABLISH — say these out loud

1. **Anything about a real iPhone or real Safari.** Chromium device emulation is
   not WebKit. Untested. Not predicted.
2. **The window-density flicker (`QUEUE.md` H2).** **NOT MEASURED.** I tried to
   catch it by screenshotting a fixed wall repeatedly and counting distinct
   frames. It came back **5 distinct of 5 at a completely still camera**, because
   the scene animates every frame anyway (god rays, clouds, light). My first
   attempt was worse still: it had **auto-exposure on**, which HANDOFF §112 already
   proved makes every frame depend on the one before it. The instrument cannot
   separate "flicker" from "animation". It needs video, not stills.
3. **The horizon tilt (H3).** Roll measured at exactly **±1.50°** when strafing
   (`__fly.fx()`, left and right, `E-01-strafe-left.png` / `E-02-strafe-right.png`).
   At that magnitude I could not see the sky-vs-map disagreement in a still frame.
   Needs video.
4. **A camera drift I found and am retracting.** An earlier run measured **5.66°
   of yaw and 2.9 m of sink in 5 seconds with hands off**. It was my own
   instrument: `map.jumpTo()` is overridden by the flight controller, which pulls
   the camera back to its own eye state. Repeated with **no `jumpTo` anywhere**,
   the pose is **byte-identical across 10 reads over 6 seconds**
   (`DRIFT-NO-JUMP`). **The camera sits perfectly still. There is no drift.**
   Worth knowing for the next lane: once you have driven the camera at all,
   scripted `jumpTo` silently does nothing.
5. **Pop-in during a fast flight: I did not find any.** Boosted 1.85 km across
   the city at 181 m (`E-10-boost-t0.png` → `E-14-boost-t4.png`) and buildings
   were present all the way to the horizon in every frame.
6. **Trees vanishing when you walk into them (Y12).** **Did not reproduce.** I
   walked into the South Mall tree line with real `W` and the trunks stayed solid
   and visible the whole way in (`D-20` → `D-24`).
7. **The intro and the 60-second tour** were not re-shot this pass — they are
   already covered in `docs/aws/first-impression.md` and `docs/aws/beautiful.md`.
8. **One thing I saw and cannot explain.** In the walk frames (`D-23`, `D-24`,
   `E-01`) the sky came back deep magenta with a sunset glow at an hour I had set
   to `p = 0.30`. Either the hour did not apply or the eye-level sky really is
   that colour. I did not spend a run resolving it, and I am not claiming either.
9. **Nothing here is a frame-rate or load-time claim.** Those are
   `docs/aws/first-impression.md`'s numbers, not mine.

---

# IF YOU ONLY DO FOUR THINGS BEFORE YOU HIT RECORD

1. **Press `G` and pick Balanced (or Cinematic).** Clear the site data first if
   you have opened the app on that machine before. Otherwise the app changes its
   own look 25 s into your first take and opens ugly on every take after.
2. **Stay between 80 m and 350 m.** Everything the app does well lives there.
   Below it you get blank ground and tree slabs; above it the Tower disappears
   and the city goes flat.
3. **Do not walk, do not look down, do not go to street level at night.**
4. **Accept the labels.** They are the one thing you cannot switch off, so frame
   tight and keep the horizon out of the middle of the picture — that is where
   they all pile up.

---

*Read-only pass, Acer lane, 2026-08-06. Nothing changed. Every browser reaped.*
