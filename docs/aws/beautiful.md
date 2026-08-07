# The five best-looking places in the app — and how to fly to them

Read-only pass on **https://flyover-utx.vercel.app/** (the live site, not
localhost), 2026-08-06. **Nothing in the app was changed.** Every frame below
came out of the live deployment.

---

## First: what "the default hour" actually is

**The app opens at golden hour — sunset.** Measured on the live site, three
separate fresh loads, all agreeing:

```
TOD_DEFAULT_P = 0.5   slider = 0.5   window.__todCurrentP = 0.5
```

The time slider runs 0 = midday, 0.5 = golden hour, 1 = night. **0.5 is peak
golden**: sun about six degrees up in the west-south-west, magenta-to-orange
sky, warm amber on every wall. It is the best light the app has, and you get it
for free without touching anything.

Two more things you should know before you record:

* **You do not have to drag the slider to change the hour.** `?p=` in the URL
  sets it at load. Verified live: `?p=0.92` opened straight into night,
  `?p=0.66` straight into dusk, slider and scene both correct, no drag. This
  matters because dragging the slider runs at about 3 fps and looks terrible on
  tape.
* **`P` (or `?clip=1`) hides the app's own furniture** — the title pill, the
  hint bar, the time slider, the two round buttons. It does **not** hide the
  building name labels. Those are part of the map. Every frame below still
  carries 10–25 of them and there is no switch for it.

---

## The five

All five are at the **default hour**, straight out of the box. Pictures are in
`shots/aws/`.

---

### 1. Home — the sun over West Campus, the Tower in your lap
`shots/aws/C-HERO1-spawn-sunset.png`

The best single frame the app produces at the default hour, and it is the one
it hands you for free. The sun disc sits dead centre on the horizon, the sky
runs magenta at the top to burnt orange at the skyline, the UT Tower is cream
and clock-faced in the bottom-left corner, and the downtown skyline is a small
dark cluster on the far left. Red tile roofs everywhere.

**How to get there: press `R`.** That is it. `R` resets the camera home, and
home *is* this shot. It is also where the opening flight ends, so if you let the
intro play out you are already close.

You are about **160 m up**, over east campus, looking **west-south-west into the
sun**. If you have wandered off: fly until the Tower is in the lower-left of
your frame and the sun is centred ahead of you.

**Watch for:** the label "UT Tower" sits right on the tower's base, and the
left edge clips a label to "ank". Neither is fixable today.

---

### 2. The Drag corridor — Tower left, downtown on the horizon
`shots/aws/C-HERO2-drag-corridor.png`

My favourite composition in the set. The UT Tower stands at the left edge with
its clock faces lit, Guadalupe runs straight down the middle of the frame, the
West Campus high-rises stack up on the right, and the whole downtown skyline —
glass towers with visible window grids — sits on the horizon under the sun.
It reads as one city rather than one campus.

**From home (`R`): rise a little and turn to face due south.** You want to be
about **100 m up**, sitting just north of 24th and Guadalupe, looking straight
down the street. The Tower should be on your far left at eye height and the
downtown cluster small and centre-right on the skyline.

Camera, if you want to match it exactly: standing at −97.74213, 30.28934,
100 m up, bearing 178.

---

### 3. The Tower, big
`shots/aws/C-HERO3-tower-golden.png`

The closest thing to a portrait of the Tower that works at this hour. Cream
limestone, orange clock faces, the Main Mall lawns and the fountain below it,
the sun a bright lens flare top-centre, tile roofs filling the foreground.

**From home (`R`): fly east about 300 m — over the Tower and past it — then
turn back and face west-north-west.** About **100 m up**. The Tower ends up on
the right third of the frame, near enough that you can read the clock.

**Watch for:** this is the busiest frame for labels. The Guadalupe shopfront
names (Starbucks, Potbelly, 7-Eleven, Sweetgreen, Dollar Slice Club…) all draw
in their brand colours as tiny coloured tags across the middle of the picture.
Up close it is a nice detail; at this distance it looks like clutter. If you
want a clean Tower, come in closer so the shopfronts fall out of frame.

---

### 4. The whole city
`shots/aws/C-HERO4-whole-city.png`

The scale shot. From about **780 m up** the entire city runs to a hazy orange
horizon — campus, the downtown cluster, the interstate, and Waller Creek's
green line curling away to the right. It sells "this is really the city, not a
diorama" better than anything else here.

**From home (`R`): hold `E` (or roll the wheel up) until you are very high —
roughly half a mile — then look south-south-west.** Campus should be a small
red-roofed patch just below centre with downtown behind it.

**Be honest about this one:** past the middle distance everything turns into one
flat tan mass. There is no colour variety out there and the roads are the only
thing giving it structure. It is beautiful as a wide, and it does not hold up if
you sit on it for more than three or four seconds.

---

### 5. DKR with the skyline behind it
`shots/aws/C-HERO5-dkr-skyline.png`

The stadium as a big striped bowl in the middle distance, the Moody Center and
its red practice track on the left, and the downtown skyline centred on the
horizon. This is the best DKR frame I could produce and I want to be straight
with you about **why**: it works because of the skyline behind it, not because
of the stadium.

**From home (`R`): fly east about 1 km, past the Tower and past San Jacinto,
until you are north of the stadium — about 170 m up — then face south-south-west.**

**The brutal part.** I photographed DKR from eight angles at the default hour.
From the west and south-west it is a beige slab hidden behind Jester. From close
in you never see into the bowl or onto the field — the green field you can see
in most frames is the practice field next door, not the stadium's. DKR is the
most-asked-for landmark in this app and at the default hour it is the weakest
of the five by a distance. If the video needs a hero stadium shot, that is a
build job, not a camera job.

---

## Two things that are better than the default hour, and cost one URL

The brief asked about Guadalupe after dark and the Capitol at night. Both are
real, and neither is at the default hour, so they are not in the five. Here is
what I found.

### The night Tower is the best-looking frame in the entire app
`shots/aws/C-BONUS-tower-night.png` — **URL: `https://flyover-utx.vercel.app/?p=0.92`**

Burnt-orange floodlight up the Tower, stars overhead, downtown lit on the
horizon, street lamps running the length of Guadalupe, window grids across every
West Campus high-rise. It is better than any of my five. It loads straight into
this — no slider, no drag, and it opens at the home pose, so pressing nothing
gets you the shot.

If the video can carry one night beat, make it this one.

### The Capitol's moment is dusk, not night
`shots/aws/C-BONUS-capitol-dusk.png` — **URL: `https://flyover-utx.vercel.app/?p=0.62`**

At **dusk** the dome and the building are warmly lit against the dark tree
canopy of the grounds, the streetlamps are on, and the sky is still purple and
pink. It is lovely.

At **full night** (`?p=0.92`, `shots/aws/B-13-capitol-night.png`) the dome is
**not lit at all** — it reads as a dull pink silhouette while every office block
around it is glittering with windows. "The Capitol at night" does not earn a
place; **the Capitol at dusk** does. Fly there and face north-north-east from
about 300 m up, or use the `?p=0.62` URL and go south from home about 1.2 km.

At the default golden hour (`shots/aws/D-capitol-tourpose.png`) the Capitol is
fine but small, and the whole frame is one orange tone.

### Guadalupe after dark: real, and half the frame is black
`shots/wampus/final/guadalupe-street-night.png` is the best version of it —
awnings in brand colours, lit window grids above, a warm lamp pool on the
pavement. But standing on the street at night, **the bottom fifth of the frame
is unlit black road**, and `shots/eye/final/04` is worse: nearly half the
picture is a black void. It photographs well as a tight, high crop and badly as
a full frame. Use it as an inserted detail, not as a hero.

---

## The thing I would actually record: the app flies itself

**`https://flyover-utx.vercel.app/?clip=1&tour=1`**

Verified live end to end. This replaces the opening flight with a **60-second
authored tracking shot with all of the app's furniture already hidden** — south
down the Drag, arrive on the South Mall with the Tower ahead, push in on the
Tower, quarter-orbit it, glide east to DKR, push in, then a long settle back
home into the sunset. Default golden hour throughout. Sampled frames:
`shots/aws/TOUR-14s.png`, `TOUR-26s.png`, `TOUR-38s.png`, `TOUR-50s.png`,
`TOUR-60s.png`.

`TOUR-14s.png` is a better frame than two of my five, and it is *moving*, which
is what a video wants.

**Any key or click ends the tour where it is** — so start recording, then hands
off the keyboard for a minute. You can also press `T` at any time to start the
same tour from wherever you are.

---

## Straight talk about the frames as a set

* **Every one of the five is the same colour.** At the default hour the app is
  orange, top to bottom, everywhere. Five golden-hour shots in a row will look
  like one shot. Cut at least one of them against the night Tower or the dusk
  Capitol.
* **The labels are the weakest visual thing in the app.** Every frame carries
  10–25 white building names; at zoom-out they overlap, at the edges they clip
  mid-word ("ank", "The Castili"), and `P` does not remove them.
* **From high up, the UT Tower loses its material** and renders as a dark brown
  stub (`shots/aws/A-11-aerial.png`, `A-10-capitol-cong.png`). Do not shoot the
  Tower from far away at this hour — it only looks like the Tower from under
  about 400 m.
* **The intro's landing frame is not one of the best frames.** The opening
  flight ends looking north up the South Mall
  (`shots/aws/A-02-southmall.png`), where the Tower is tiny and distant and the
  foreground is a large flat teal roof. Home (`R`) is a much better place to
  start recording than where the intro leaves you.
* **There is no way to link to a camera position.** `?p=` sets the hour and
  `?tour=1` runs the tour, but there is no URL that jumps to a pose — so every
  direction above has to be flown by hand. Worth adding one day; it would make a
  shot list like this a set of links.

---

# The stills gallery — where the good pictures already live

Yes, one exists, and it is large. `shots/` has about 150 subfolders, but almost
all of them are before/after pairs from a fix and are not usable as B-roll.
Here is what is actually worth looking at.

### Use these

| Folder | What is in it | Why it is a keeper |
|---|---|---|
| **`shots/tour/`** | **36 frames — 12 landmarks × day / dusk / night**, 1600 × 1000 | **The real gallery.** Tower, South Mall, DKR (stadium + field), downtown skyline, Capitol, West Campus, the Drag, Moody Center, Waller Creek, Blanton, wide aerial. `dusk-downtown-skyline.png` — purple sky, the Capitol dome glowing gold, Congress running to downtown — is one of the best pictures this project has ever made. Start here. |
| **`shots/wampus/final/`** | 15 frames, West Campus streets and lobbies, day/night pairs | Eye-level street work that holds up. `guadalupe-street-night.png` and `guadalupe-24th-night.png` are the good ones. |
| **`shots/entrances/final/`** | 26 JPGs, building portals day and night | Detail/insert shots — Main Building's south portal, Battle Hall, Sutton Hall, Gregory Gym's arches. Ignore the ten `before-*` files. |
| **`shots/eye/final/`** | 18 frames, walking height | `01-THE-TOWER-from-the-south-mall-at-eye-level-day.png` is the honest "you can walk here" proof. It is a proof, not a postcard — over half the frame is lawn and pavement. |
| **`shots/aws/`** | this pass | The five heroes are the `C-HERO*` files; `C-BONUS-*` are the night Tower and dusk Capitol; `TOUR-*` are the tracking-shot samples. |

### Skip these

* `shots/eye/final2/`, `shots/night/final/`, `shots/lobbies/final/`,
  `shots/facade/final/` — these are **before/after and defect documentation**,
  named things like `12-DEFECT-callaway-house-tower-unlit-at-night.png`. Useful
  engineering records, wrong thing to put in a video.
* `shots/final/` (2 files), `shots/five/` (2 files) — tiny, superseded.
* Everything else in `shots/` — A/B pairs from individual fixes.

**One caveat on all of it:** the gallery folders were rendered from earlier
builds, at `p = 0.30 / 0.62 / 0.95`, not at today's default `0.50`. They will
not colour-match footage you shoot today. Fine as thumbnails and cutaways;
do not intercut them with live capture and expect the light to agree.

---

## What I could not establish

* **Anything about iPhone or Safari.** Everything here is Chrome on a Windows
  laptop with a real GPU, 1440 × 900. Not tested and not predicted.
* **Whether the five hold up in portrait.** Every frame here is landscape. The
  earlier pass measured that portrait clips labels at both edges and spends the
  top quarter of the screen on sky.
* **What eye level looks like at the default hour.** Jumping the camera to
  walking height by coordinates put it inside a building
  (`shots/aws/B-09-eye-southmall2.png` — a wall filling the frame). Eye level
  has to be *flown* to, not jumped to, and I did not fly it. The existing
  `shots/eye/final/` frames are day and night, not golden hour.
* **How any of this looks with the graphics auto-detect probe left running.**
  I cancelled it for every shot in this pass (`cancelGraphicsAutoDetect()`), so
  every frame is the Balanced preset. If the probe fires on your machine and
  drops you to Performance, the look changes — see `docs/aws/first-impression.md`.
