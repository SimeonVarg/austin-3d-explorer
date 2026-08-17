# Recording brief — the honest state of the app

> # ⚠ READ THIS BOX FIRST. This file is eleven days old and five of its instructions have since become wrong.
>
> **`docs/aws/go-nogo.md` is the document to follow tomorrow. This one is the
> detail behind it.** Everything below was true on 2026-08-06; a lot shipped
> since. On **2026-08-17** every URL and every keystroke this file recommends
> was re-driven against the live site on a clean browser. Corrections, worst
> first:
>
> 1. **"The building name labels are the one you cannot switch off" (Q3 item 2,
>    Q5) is NO LONGER TRUE.** `?clip=1` now hides them: **0 of 33 symbol layers
>    visible, 0 labels drawn.** Most of Q3 item 2 is obsolete — it still
>    describes the plain URL correctly, and nothing else.
> 2. **"There is no flag for the graphics preset" (Q5) is NO LONGER TRUE.**
>    `?preset=cinematic` exists, works, and overrides a saved preset without
>    writing itself back. It replaces both "press `G` first" and "clear the site
>    data first" — **you can skip both of those steps entirely.**
> 3. **"`drift=0` … switches parts of the city off. Do not use for filming"
>    (Q5) is BACKWARDS.** It switches nothing off. It stops the camera turning
>    itself on a held shot. Measured: without it, 59° of rotation in 75 seconds.
>    **Use it.**
> 4. **The graphics self-downgrade (Q3 item 1) did not fire once** in five clean
>    plain loads on a quiet machine — the probe measured 18.0 ms and kept
>    Balanced. It is still worth the flag, because tomorrow the machine will
>    also be running a screen recorder and that cost has never been measured.
> 5. **Q1's "the message box lands right on the finished shot" therefore did not
>    reproduce either.** The opening flight was watched end to end five times.
>    Its one real defect is new and is described in `go-nogo.md`: a two-second
>    smear across the downtown towers at the instant the title card lifts.
>
> One thing this file gets RIGHT and the reader should trust: **there is no way
> to link to a camera position.** No `?shot=`, no pose URL of any kind. Driven
> and confirmed — a `?shot=` URL is silently ignored.

**For: the person about to hit record on https://flyover-utx.vercel.app/**
Written 2026-08-06. Everything here was found by looking at the **live site**,
not a local copy. **Nothing in the app was changed, committed, pushed or
merged.** Every defect below is written down and left exactly where it is,
because finding it in a published video would be far worse than reading it here.

This document assembles four read-only passes:
`deploy-status.md`, `first-impression.md`, `beautiful.md`, `embarrassing.md`
(all in this folder), plus a fresh read of the code for Question 5.

---

## Before anything else — what we could and could not test

**We tested Chrome on a Windows laptop with a real graphics card.**
That is the whole instrument. Where "phone" appears below, it means **Chrome
pretending to be a phone**: a 393 × 852 window, three-times pixel density, and a
fake iPhone identity string.

> ### REAL iOS SAFARI WAS NEVER TESTED, AND CANNOT BE TESTED FROM HERE.
> Chrome-in-a-phone-shaped-window is not Safari. Different memory ceiling,
> different 3D graphics behaviour, different video and canvas handling, and no
> heat throttling. **Nothing in this document predicts your actual iPhone.**
> The best evidence about your phone is still your own test on 2026-08-04:
> *performance great, looks amazing, BOOST button visually off.*

Two other honesty notes about the numbers:

* Every timing is the **smallest of several interleaved runs**, never a single
  reading. This app has measured anywhere from 11 s to 65 s for the same page on
  the same quiet machine, so one reading means nothing.
* Where a test **cancelled the graphics auto-detect probe**, it says so. Where a
  test was measuring *what a visitor actually sees*, the probe was deliberately
  **left running**, because the probe is part of the experience.

One small housekeeping note: only two of the four source reports labelled their
own question numbers (1 and 4). The rest were matched to questions by topic.

---

# Q1. What do the first fifteen seconds actually look like?

**Short answer: about a second of white, then eight seconds of a genuinely
beautiful title card, then a twelve-second flight that lands on the UT Tower at
around twenty-one seconds. It is good. The one thing that can ruin it is the
graphics message that lands right on the finished shot.**

### The timeline, measured

| | phone (emulated) | desktop |
|---|---|---|
| blank white before anything paints | 0.83 s | 0.51 s |
| dark title screen holds until | 8.0 s | 8.2 s |
| camera flies | 8.0 → 20.9 s | 8.2 → 21.2 s |
| still hero frame on the Tower | ~21 s | ~21 s |

### The white gap is short on a good line and ugly on a bad one

0.8 s on a phone, 0.5 s on desktop. On a deliberately bad connection (2 Mbps,
hotel-wifi latency) it stretched to **4.3 seconds of blank white**. The cause is
that the app's own stylesheet — the thing that paints the dark background — is
the fourth item to load in the page, behind three files from an outside code
host. Until that host answers, the screen is browser-default white.

**For recording:** start capture with the tab already loaded, or accept ~0.8 s of
white. Do not record a cold first load on venue wifi.

### The load screen is the best-looking part of the app

Dark brown hand-drawn skyline with the Tower and the Capitol in it, the title,
a real progress bar with real stage text, and **"BUILT BY / Simeon Varghese"** at
the foot. Animates smoothly the whole way. No complaints.

### The flight is a real flight, not a fake zoom

Three camera poses, two eased legs, about 12.6 seconds. It starts low on Congress
Avenue downtown, pulls back over the Capitol, then runs north and settles on the
UT Tower over the South Mall. Verified from the map's own reported position, not
by eye. Default hour is sunset — magenta sky, long warm light.

> **THE OPENING FLIGHT WAS FINALLY WATCHED END TO END, 2026-08-17** — five
> clean plain-URL loads, frames every 1.5 s, in `shots/gaps/opening/`. It is
> good, and the timeline above holds (white 0.6–2.0 s, title card to 8.6–10.2 s,
> flight lands ~20 s at zoom 16.9 / bearing 2° / pitch 72°, just south of the
> Tower facing north). **Two corrections:** the graphics message box below
> **did not fire once** (see Q3 item 1), and the *first* leg of the flight —
> the low Congress Avenue start — happens **behind the title card**, so the
> picture opens already over the Capitol.
>
> **And one new defect, which is now the worst thing in the opening.** For about
> **the first two seconds after the title card lifts**, a ragged dark band is
> smeared across the faces of the downtown towers at the horizon line. It is the
> very first thing on screen; by 3.1 s it is gone for good. Reproduced on a
> dense re-shoot, so it is real. Pictures:
> `shots/gaps/opening/lift-a-p00-0ms.jpg`, `lift-a-p03-1196ms.jpg`,
> `lift-a-p06-3083ms.jpg` (clear). **Start the capture with the tab already
> loaded, cut the first two seconds — or use the tour, whose opening is over
> West Campus and does not have it.**

### The one thing that will ruin the opening shot

**About 25 seconds in, the app measures its own frame rate, decides the machine
is slow, and downgrades its own graphics — with a black message box parked in the
middle of the frame.** It fired in 3 of 4 desktop runs, at 25.6–28.2 s, held for
2.5 s, dead centre in the lower third:

> *"28 fps measured — switched to the Performance preset. Press G to change."*

That is **4.4 seconds after the intro settles** — precisely when a recording is
sitting on the finished hero frame. And it does not just say something; **it
changes how the app looks, mid-shot.** Full detail in Q3, item 1. Fix it before
you roll: press **G** and choose a preset.

### The other thing that can go wrong: an empty city

The app waits for the city under the opening frame to exist before lifting the
title card. That wait **works for a slow network** — on the 2 Mbps test the title
card held for 15 s and the city was fully there when the flight departed. Right
failure mode.

It **does not save you from a busy computer.** With the processor deliberately
slowed 4× (which is roughly "laptop running a pile of other things"), an 18-second
hard ceiling fires, the title card lifts anyway, and the bottom two-thirds of the
frame is **bare tan ground with road stripes and no buildings at all.** On the
clean reference machine this never happened in nine runs.

**For recording: close everything else on the machine first.** That is the entire
mitigation available today.

---

# Q2. Where does it look best, and how do you get there?

**Short answer: the app opens at golden hour by default and that is its best
light. The five best frames are below. But the single thing most worth recording
is the app's own 60-second tour, which flies itself with the interface already
hidden.**

### The default hour is already the good one

Measured live on three fresh loads: the time slider opens at **0.5 — peak golden
hour.** Sun about six degrees above the horizon in the west-south-west, magenta
running to orange, warm amber on every wall. You get it for free.

You can also set the hour **in the URL** rather than dragging the slider (which
runs at about 3 frames per second and looks terrible on tape):

* `?p=0.92` opens straight into night
* `?p=0.62` opens straight into dusk

### The five best places

All five are at the default hour. Pictures are in `shots/aws/`.

1. **Home — the sun over West Campus, the Tower in your lap.**
   (`C-HERO1-spawn-sunset.png`) The best single frame the app makes. Sun dead
   centre on the horizon, Tower cream and clock-faced in the bottom-left,
   downtown a small dark cluster far left, red tile roofs everywhere.
   **How to get there: press `R`.** That is the whole instruction.
2. **The Drag corridor — Tower left, downtown on the horizon.**
   (`C-HERO2-drag-corridor.png`) The best composition in the set. Guadalupe runs
   straight down the middle, West Campus stacks on the right, the downtown
   skyline sits under the sun. Reads as one city, not one campus. From home:
   rise to about 100 m just north of 24th and Guadalupe and face due south.
3. **The Tower, big.** (`C-HERO3-tower-golden.png`) Cream limestone, orange clock
   faces, the Main Mall and fountain below, sun flaring top-centre. From home,
   fly east about 300 m past the Tower, turn back, face west-north-west, ~100 m up.
4. **The whole city.** (`C-HERO4-whole-city.png`) From about 780 m the city runs
   to a hazy orange horizon. Sells "this is really the city, not a diorama".
   **Honest warning: it is beautiful for two seconds and does not survive four** —
   past the middle distance it is one flat tan mass.
5. **DKR with the skyline behind it.** (`C-HERO5-dkr-skyline.png`) Fly east ~1 km
   past San Jacinto, ~170 m up, face south-south-west. **Be straight about this
   one: it works because of the skyline behind the stadium, not because of the
   stadium.** DKR was shot from eight angles and this is the best of them. If the
   video needs a hero stadium shot, that is a build job, not a camera job.

### Two frames better than the default hour, each costing one URL

* **The night Tower is the best-looking frame in the entire app.**
  `https://flyover-utx.vercel.app/?p=0.92` — burnt-orange floodlight up the
  Tower, stars, downtown lit on the horizon, lamps running the length of
  Guadalupe. It loads straight into it at the home pose, so pressing nothing gets
  you the shot. **If the video can carry one night beat, make it this one.**
* **The Capitol's moment is dusk, not night.**
  `https://flyover-utx.vercel.app/?p=0.62` — dome warmly lit against dark trees,
  streetlamps on, sky still purple. At full night the dome is **not lit at all**
  and reads as a dull pink silhouette. Never shoot the Capitol at night.

### The thing actually worth recording: the app flies itself

**`https://flyover-utx.vercel.app/?clip=1&tour=1`**

Verified live, end to end. This replaces the opening flight with a **60-second
authored tracking shot with the interface already hidden** — south down the Drag,
arrive on the South Mall with the Tower ahead, push in, quarter-orbit, glide east
to DKR, push in, long settle back home into the sunset. Golden hour throughout.

**Any key or click ends the tour where it is.** So: start recording, then hands
off the keyboard for a minute. `T` runs the same tour from wherever you are.

### Straight talk about the five as a set

* **They are all the same colour.** Five golden-hour shots in a row will look
  like one shot. Cut at least one against the night Tower or the dusk Capitol.
* **Every frame carries 10–25 building name labels** and there is no switch for
  them. See Q3 item 2 and Q5.
* **There is no way to link to a camera position — CONFIRMED BY DRIVING IT,
  2026-08-17.** `?p=` sets the hour, `?tour=1` runs the tour, `?from=`/`?to=`
  route a walk, but **no URL jumps to a pose.** In particular **`?shot=` does
  not exist**: a `?shot=` URL is accepted, silently ignored, and gives you a
  page identical to the one without it. Do not type one tomorrow. Every shot
  above has to be flown by hand.

### Where the good stills already live

`shots/tour/` is the real gallery — 36 frames, 12 landmarks at day, dusk and
night. `dusk-downtown-skyline.png` is one of the best pictures this project has
made. Also good: `shots/wampus/final/` (street level), `shots/entrances/final/`
(door detail), `shots/eye/final/` (walking height). **One caveat on all of it:**
those folders were rendered from earlier builds at different hours, so they will
not colour-match footage you shoot today. Fine as thumbnails; do not intercut
them with live capture and expect the light to agree.

---

# Q3. What would embarrass you on the tape?

**Short answer: one thing the app does to itself that you must switch off before
you roll, one thing you cannot switch off at all, and a long list that only bites
at eye level, at night, or in the corners of the frame. The two worst are not the
ones you were worried about.**

The app is genuinely good-looking from 100–300 m at golden hour. Most of what
follows is avoidable with framing or a keypress.

### 1. The app downgrades its own graphics on camera — and stays downgraded

> **RE-MEASURED 2026-08-17, and it did not happen.** Five clean plain-URL loads
> on a quiet machine with the real GPU: the probe measured **18.0 ms (56 fps)**
> every time and **kept Balanced. No downgrade, no message box, on any of the
> five.** The code's downgrade threshold is 21.5 ms, so on this machine it is
> not close. **The mitigation still stands and has simply got easier:
> `?preset=cinematic` on every URL** — because tomorrow the machine is also
> running a screen recorder, and that load was never measured. It costs one word
> and the failure it prevents cannot be fixed afterwards.

**This is the worst thing in the report and it is completely avoidable.**

Measured twice on the live site:

* **First visit,** ~25 s in: the message box fires and the app switches itself
  from "Balanced" to "Performance" **mid-shot**.
* **Every visit after:** it opens straight into Performance, **with no message
  and no announcement.** Take 2 does not look like take 1 and nothing tells you.

What the downgrade costs: the whole image renders at 75% and is visibly soft; the
sun flare and light shafts go to zero; contact shadows under every eave switch
off and the city goes flat; view distance halves from 700 m to 350 m; trees thin
out; the outer city loses more than half its buildings. Compare
`shots/aws/B-03` and `B-04` — same pose, same second, and one has a real sun and
the other a flat pale disc.

**Before you record: press `G` and choose Balanced or Cinematic.** Reading the
code confirms this is permanent on that machine — choosing a preset by hand stops
the app ever measuring itself again. **If you have already opened the site on the
recording machine, clear the site data first**, or it will restore Performance
before the app even starts.

### 2. The building name labels. ~~This is the one you cannot switch off.~~ FIXED — `?clip=1` and `P` now hide them.

> **CORRECTED 2026-08-17, driven on the live site.** `?clip=1` (and `P`) now
> switch off every label: **0 of 33 symbol layers visible, 0 labels rendered**,
> against 7 visible and 11 drawn on a plain URL. The six complaints below are
> all still accurate — **but only about the plain URL, which is not what you are
> recording.** In clip mode none of this reaches the tape. `?walk=1` cannot take
> `clip=1`, so the walking clip is the one place the labels are still in shot.

`P` and `?clip=1` hide the interface. ~~They do not hide the building names~~ —
those are drawn into the map. Every plain-URL frame carries 10–25 of them and
they are wrong in five ways at once:

* **They draw straight through the landmark.** The best night frame in the app
  has "Biomedical Engineering Building", "Scottish Rite Dormitory", "T. S. Painter
  Hall" and "Pedogna" stamped across the UT Tower's shaft. None of them is the
  building they are sitting on.
* **The same thing gets named twice in one frame** — "DKR Stadium" and "DKR
  Memorial Stadium" 100 px apart over the same bowl; "Target" twice in one frame.
* **They clip mid-word at both screen edges, on desktop as well as phone** —
  "arry Ransom Center", "eorge H.W. Bush State Office", "Garriso", "O'Donnell B".
* **The time-of-day slider parks on top of them** — "21 Ric", "Dobi… ty2…",
  "Robert A. Welch Ha…". (This one *does* go away with `P` / `?clip=1`.)
* **At eye level they collapse into one illegible band** — twenty labels on one
  horizontal line in eight colours, several overlapping into mush.
* **Half are solid white and half are ghosted at about 40%** in the same frame,
  which reads as a rendering fault rather than a hierarchy.

**Nothing here is fixable before the shoot. It is framing or nothing.** Tight
frames carry the fewest labels; keep the horizon out of the middle of the picture,
because that is where they all pile up.

### 3. Look down at walking height and you get launched 48 metres into the air

Measured live, standing on the South Mall at 2.67 m: tilt the view down from 88°
to 45° and the app quietly puts you at **47.99 m**. You were standing on the
grass; now you are looking at rooftops. On a recording it reads as the app
fighting the operator. **Avoidable: at walking height, look level or up.**

### 4. Street level is half blank ground and flat green slabs

**This is the correction most worth hearing.** You have been weighing the 10 m of
"barcode" wall above the Guadalupe shopfronts. The wall is real — but **it is not
what your eye goes to when you actually stand on the Drag.** These are:

1. **The ground** — the bottom 45–55% of every eye-level frame is one flat cream
   or grey plane. No paving joints, no gutter, no kerb, no markings.
2. **The trees** — at 2 m the canopies are enormous flat olive slabs with hard
   polygon edges, and the trunks are plain chocolate rectangles.
3. **The label band**, above.

**Avoidable: do not put walking-height footage in this video.** The app's
strength lives at 100–300 m.

### 5. The night street is a beach

Standing on Guadalupe at night, the road is a **uniform warm sand colour,
brighter than anything else in frame**, covering the bottom half. No lamp pools,
no falloff, no texture. The whole thing reads as a black city floating on a
desert. **Avoidable: no night footage at street level.** Night from 100 m up is
lovely.

### 6. DKR — and good news about the Longhorn

**The logo is fine.** From directly above at 200 m the Longhorn at midfield is a
clean, correct, burnt-orange silhouette, with yard lines, hash marks and orange
end zones. It is **not** broken. (This corrects the project's standing defect
list.) It only smears at oblique angles.

**The bowl is the problem.** The radial stair strips poke out past the edge of
each deck into open air like a comb; there is a black slab where the north
videoboard should be and a black hole in the lower bowl seating; the floor around
the field is a wide blank tan ring. **Shoot DKR from straight overhead or from
far enough that the skyline carries it. Do not fly into the bowl.**

### 7. The UT Tower disappears above about 400 m

At 435 m looking south over campus, **the Tower is not visible at all** — DKR is
labelled, the Union is labelled, and the university's most recognisable object
has gone into the tan. At 329 m it is a featureless cream stub with no clock.
**Keep Tower shots under about 400 m.** The good one is at 98 m.

### 8–14, the rest of the list

* **Lady Bird Lake is grey concrete**, the same flat grey as the roads, and it
  meets the basemap's blue at a hard seam. Unavoidable if downtown is in frame.
* **The Capitol dome is unlit at night.** Shoot it at dusk.
* **The Tower's night floodlight dies to near-black at the base**, the Main
  Building under it is almost pure black, and the window columns read as painted
  stripes rather than glass. Two stray bright blue lights on the ground look like
  a bug. Frame the top half.
* **The clouds read as lens smudges** — orange blobs with bright cores. Keep the
  upper sky out of frame.
* **Lens-flare ghosts smear across the road** at low sun. See the correction in
  the disagreements section below — you can turn these off without losing
  sharpness.
* **Blank roof slabs fill the foreground at 60–90 m** — one featureless plane
  taking 45% of the frame. Fly higher or lower.
* **Past about a kilometre the city is one flat tan carpet.** Unavoidable on any
  wide; just don't hold it.

### The smaller ones, all photographed

A blank lot with a thin orange rim beside Dobie where a building should be;
campus roofs as large flat sage planes that stab through each other; a hard
horizontal seam across the sky where the haze band stops; West Campus at 3 m as a
striped moiré tunnel; a hard two-tone diagonal split down the Speedway roof;
downtown towers with crisp teal window grids standing next to plain untextured
tan boxes of the same height.

### Things we could not establish, said out loud

* **Window-density flicker: not measured.** The instrument cannot separate
  "flicker" from the scene's normal animation in still frames. It needs video.
* **Horizon tilt: measured at ±1.50° when strafing**, and at that size it could
  not be seen in a still. Needs video.
* **A camera drift we found and are retracting.** An early run measured 5.7° of
  yaw and 2.9 m of sink in 5 seconds hands-off. That was the instrument's own
  fault. Repeated properly, **the camera sits perfectly still. There is no drift.**
* **Trees vanishing when you walk into them: did not reproduce.**
* **Pop-in during a fast flight: none found** across a 1.85 km boosted run.

---

# Q4. What is it like on a phone?

**Short answer: flying is smooth, the interface eats about a fifth of the screen,
and there are four things you must not touch. And again — this was Chrome
pretending to be a phone, not a real iPhone.**

### Frame rate (emulated phone / desktop)

The display itself caps out at 55.6 fps, so that is the ceiling, not the app.

* **Still camera:** 55.6 fps both.
* **During the opening flight:** 45.9 fps phone, 35.5 fps desktop.
* **Free-flying with the joystick held:** 53.8 fps. Smooth.
* **Day/night ▶ playing:** **1.6 fps phone, 2.2 fps desktop.** A slideshow.
* **Dragging the time slider:** 3.0 fps phone, 3.6 fps desktop.

### How much it downloads

7.0 MB over 204 requests on the phone, 8.7 MB on desktop (a bigger window pulls
more map tiles). About 8 seconds to a city you can fly, ~21 s to the finished
hero shot. Any input at any moment cancels the flight and jumps to the end.

### Safe to touch while recording

* The joystick / WASD, swipe-to-look, BOOST — 53.8 fps, no stalls.
* **`P` on desktop** — hides the interface instantly, toggles back, no reload.
* Tapping empty scene or a building — verified, nothing happens.

### DO NOT TOUCH

1. **The ▶ day/night play button.** 1.6 fps phone, 2.2 fps desktop, measured
   twice each. Worse: while it runs the machine is too busy to reliably register
   the click that would **stop** it — the test driver timed out twice trying. If
   this gets tapped on tape the recording is ruined and hard to recover.
2. **Dragging the time slider.** 3 fps while dragging. The night result is
   lovely; the journey there is not. Set the hour with `?p=` in the URL instead.
3. **The speech-bubble button, top right.** Opens a feedback form over 47% of the
   phone screen, and it puts the cursor in the text box — on a real phone that
   pops the keyboard up.
4. **The gear button, top right.** The graphics panel covers 70% of the phone
   screen.
5. **"Smooth edges" inside that panel.** It arms a "Reload to apply" button that
   reloads the page — a fresh ~21 s load, on tape.
6. **`R` on desktop** — resets the camera home instantly. Useful deliberately,
   disastrous by accident mid-shot.
7. **Any tap or key in the first 21 seconds** — cancels the opening flight.

### The interface eats about 22% of the phone screen

Title pill, gear button, feedback button, the time-of-day column (24% of screen
height, right edge, sitting on the labels), the hint bar (**405 px wide on a
393 px screen — wider than the phone**), the joystick, the BOOST button, plus the
map credit bar stacked under the hint bar. On top of that the top ~30% of a
portrait frame is empty sky.

**`?clip=1` hides all of it and works on a phone.** `P` does not — a phone has no
keyboard. See Q5.

### The BOOST button — what "a bit off visually" means

Four things that compound: it **overlaps the joystick ring** (its corner sits
53 px from the joystick centre, essentially on the ring); it is on the **wrong
side of the screen**, so the same thumb has to steer and boost; **switched off it
nearly disappears** against a dark building; **switched on it is the brightest
object on screen**, brighter than the sun in the same frame. The jump between
those two states reads as an alert, not a state. It only exists on narrow
layouts, so it is never in a desktop recording.

### Also seen on phone

Labels clip at both edges in portrait ("stgate Tower", "Rio"), and the
time-of-day pill sits on top of three building names at once.

### Not tested, so not claimed

Tapping a landmark label (the slow orbit), the `T` tour on a phone, the
two-finger altitude gesture, the BOOST button in isolation — **and anything at
all about real iOS Safari.**

---

# Q5. Is there a way to hide the interface for a clean recording?

**Yes. It already exists, it is one keypress, and it works today. Press `P`. Or
put `?clip=1` on the end of the URL.**

Both do exactly the same thing — `P` flips the same switch that `?clip=1` sets at
load. Confirmed in the code (`index.html` line 7, `js/app.js` line 2006,
`style.css` lines 180–183).

### What it hides — all of it

The title pill, the hint bar along the bottom, the date pill, the entire
time-of-day column including the ▶ play button, the joystick **and the BOOST
button with it**, the gear button and the graphics panel, the graphics message
box, the speech-bubble feedback button and its panel, and the two engineering
panels. That is every piece of app furniture there is.

### Which one to use

* **`P`** toggles live with no reload — good for lining up a shot with the
  interface visible and then hiding it just before you roll. **Desktop only:** it
  listens for a key press, and a phone has no keyboard. It is also ignored while
  you are typing in a text box, so it will not fire mid-feedback-form.
* **`?clip=1`** applies at page load, before anything paints, so the interface
  never flashes on screen at all — and it **works on a phone**. If you are filming
  the phone, this is the one.
* `?clip=1&tour=1` together is a pure footage run: hidden interface, 60-second
  authored flight, hands off.

### Every KEYSTROKE this document recommends — RE-DRIVEN AND VERIFIED 2026-08-17

| key | VERIFIED — what it actually does |
|---|---|
| `P` | **VERIFIED.** Adds `clip` to the `<html>` element — identical to `?clip=1`. Before: `hud` shown, hint shown, time column shown, gear shown, joystick shown. After one press: **all hidden, OSM credit still shown.** Second press restores everything. Pictures: `shots/gaps/brief/key-P-on.jpg`, `key-P-off.jpg`. Desktop only — a phone has no keyboard, so film a phone with `?clip=1`. |
| `G` | **VERIFIED.** Opens the graphics panel (`gfx-open` on the body, panel visible); a second `G` closes it. **You no longer need it before a take** — `?preset=cinematic` does the job without a panel ever appearing on screen. |
| `R` | **VERIFIED, and the pose is exact and identical every time**: zoom 16.5, bearing −110°, pitch 74°, centre 30.2857 / −97.7394. **What changes is your window.** At 1600 × 1000 the Tower sits 86% down the frame; at 1600 × 900 (16:9) its base is on the very bottom edge; at 1600 × 860 and shorter **the Tower is not in the frame at all.** Full ladder and pictures in `go-nogo.md`. **Make the window 16:10 or taller.** |
| `T` | **VERIFIED.** Starts the 60-second tour from wherever you are — the camera left the home pose within two seconds of the press. |

### One trap worth knowing — NOW OBSOLETE, and here is what replaced it

`?clip=1` also hides the graphics message box, so in clip mode you would not see
"switched to the Performance preset" while the downgrade still happened.
**`?preset=cinematic` closes that hole properly: the preset is set before the
probe can ever run, and the flag deliberately never writes itself to the
machine.** Verified on the live site. Use the flag; you do not need to press `G`
and you do not need to clear the site data.

### What it does NOT hide, and there is no switch for either

**1. The building name labels.** These are drawn into the map itself, not into
the interface, so hiding the interface leaves all of them standing — 10 to 25 per
frame. This is where the earlier reports disagree, and the code settles it: `P`
hides the *interface*, not the *picture*. See the disagreements section.

**2. The OpenStreetMap / OpenFreeMap credit, bottom right — and it must stay.**
Say this plainly: **the map data is OpenStreetMap and the credit line is a licence
condition, not decoration.** The stylesheet says so in a comment right next to the
hide rule, and the rule deliberately leaves the credit visible. **Hiding it in an
official AWS video would be a real problem, not a style choice.**

It is already styled to be quiet — 10 px, dimmed, on a dark pill — so it does not
fight the picture. One honest caveat: check it survives the video export. If
compression or a crop makes it unreadable, the answer is to add a credit line in
the video description or a lower third, **not** to remove it from the app.

### Every URL flag that exists today — RE-DRIVEN AND VERIFIED 2026-08-17

**Every row below was loaded against the live site on a clean browser this
morning and the resulting page was read out of the DOM, not assumed. Screenshots
and the raw readings are in `shots/gaps/brief/`.** The list this section used to
carry was out of date in four ways and one of its warnings was backwards.

| flag | VERIFIED — what it actually does |
|---|---|
| `?clip=1` | **VERIFIED.** `hud`, `controls-hint`, `tod-panel` (the whole time column incl. ▶), `gfx-button`, `gfx-panel`, `gfx-toast`, `fb-button`, `joystick-zone` all `display:none`. **And it now hides the building-name labels too — 0 of 33 symbol layers visible, 0 labels drawn**, against 7 visible / 11 drawn on the plain URL. The OpenStreetMap credit **stays** (`OpenFreeMap © OpenMapTiles Data from OpenStreetMap`, bottom right) and that is a licence condition. Picture: `03-clipcin.jpg`. |
| `?preset=cinematic` | **VERIFIED — and this flag did not exist when this brief was written.** Sets the preset at load, overrides whatever the machine has saved, and deliberately does not write itself back. `balanced` and `performance` verified the same way. **Put it on every URL.** |
| `?tour=1` | **VERIFIED.** 60-second authored tracking shot instead of the opening flight. `?clip=1&tour=1&preset=cinematic&drift=0` is the clip that carries the video. |
| `?p=0.92` / `?p=0.62` | **VERIFIED.** Time slider reads exactly 0.92 / 0.62 on load. Night and dusk. |
| `?intro=0` | **VERIFIED.** Skips the opening flight; the city is simply there at the home pose. |
| `?walk=1` | **VERIFIED, and OFF by default** — on a plain URL there are **zero** `wf-*` elements in the page, not hidden, not present. With the flag there are 14. **It needs the interface, so it cannot be combined with `?clip=1`** if you want the answer caption — see the walking section below. |
| `?from=` `?to=` `?fit=1` | **VERIFIED.** `?clip=1&preset=cinematic&from=JES&to=WEL&fit=1` loads, routes, and frames the route with no interface at all. **Caveat: under `clip=1` the answer pill is hidden**, so you get the ribbon with no minutes on it. Picture: `10-deeplink.jpg`. |
| `?drift=0` | **VERIFIED, AND THE OLD WARNING BELOW WAS BACKWARDS.** It switches nothing in the city off. It disables the **idle cinema**: after 25 s of input silence the camera orbits 13° every 12 s, breathes the zoom and creeps the hour. Measured over 75 s of silence: **no flag → 59° of rotation and the hour moved 0.50 → 0.55; with `drift=0` → zero, zero, zero.** **Use it on every held shot.** |
| `?debug=1` | **VERIFIED.** Engineering panel appears. Not for filming. |
| `?shot=` **and every other camera-pose URL** | **DOES NOT EXIST.** Driven: `?clip=1&preset=cinematic&shot=tower` produced a page byte-for-byte indistinguishable from the same URL without it — silently ignored, no error. **There is no way to link to a camera position. Do not try one tomorrow.** Every hand-flown shot in this document has to be flown. |

The genuinely scene-breaking flags are `tiles=0`, `outer=0`, `haze=0`,
`fog=screen`, `roofcaps=0`, `bakedfacades=0`, `storeys=0`. **Those switch parts
of the city off — do not use them for filming.** `drift=0` is not one of them
and never was.

### If you wanted the labels gone too — the smallest change, NOT built

You asked for this to be described and not built, so it has not been. Here it is
for whenever you want it.

**File:** `js/app.js`, in the photo-mode function at about line 2001 (and the
same handful of lines on the `?clip=1` load path).

**Roughly what:** when clip mode turns on, walk the map's list of layers and
switch off every layer of type "symbol"; switch them back on when it turns off.
That one rule is enough because the app already hides the basemap's own labels at
startup — so every symbol layer still standing is ours: the three building-name
tiers, the shopfront tags, the artwork labels, the entrance labels and the
wordmarks. **About six lines.** Call it half an hour including a before/after
screenshot to prove it.

**A caveat if you do build it:** with the labels off, the app is a beautiful city
with nothing named in it. For an AWS video that may be exactly right, or it may
lose the "this is really UT" recognition. That is a taste call and it is yours.

---

# Q6. Is the live site actually running the newest code?

**Yes. Proven twice, independently, not inferred.**

**Proof one — the deploy record says so.** The current production deployment on
Vercel is in the READY state and its recorded commit is character-for-character
the tip of `main`. It came in through the GitHub connection, so the site
auto-deploys on every push — it is not a hand-uploaded copy that could quietly
fall behind.

**Proof two — the bytes match.** Every front-end file was downloaded from
`flyover-utx.vercel.app` and compared byte-for-byte against `main`:
**32 files checked, 0 mismatches.** That includes a document that exists only in
the newest commit, so the deploy is provably at the tip and not one commit back.

**`https://flyover-utx.vercel.app/` is the URL to record.**

### Other things checked

* **A second public copy exists** on GitHub Pages and it is also current
  (29 files, 0 mismatches). Both are in sync today. Record from the Vercel URL
  and any future drift between them cannot bite you.
* **All recent build jobs are green.** No failures.
* **Nothing user-visible is stranded unmerged.** Twenty branches are technically
  ahead of `main`, but nineteen are ahead only by an automated data snapshot.
  The one real open pull request holds two experimental wall designs for the Drag
  that only activate with a special URL — the shipping city is untouched by design.
* **Every file the site asks for exists.** 33 asset paths checked, 32 returned
  fine; the one miss is a filename that appears only inside a code comment and
  nothing ever fetches it. **No missing assets.**
* **The site is loading yesterday's building-data snapshot**, because today's
  landed on a side branch. **This is invisible on camera** — the app never prints
  the date anywhere.

### The one outside dependency, and you do not control it

The ground under the city is **not ours**. The app loads its base map from
`tiles.openfreemap.org`, a free third-party host. If that host is slow or down
while you are recording, the ground goes with it and nothing in this project can
save it. Checked today, three times, minimum taken: **healthy, 0.096 s.**

**Re-check it five minutes before you hit record.** Just load the site once and
confirm the ground and roads appear.

---

# Q7. The walking directions — ADDED 2026-08-17, and driven, not read

This feature did not exist when this brief was written. **Six routes were typed
into the deployed site this morning the way a student types them** — click the
arrow top-left, type a code, click the row. Zero JavaScript errors across all
six. Pictures in `shots/gaps/walk/`.

**The URL:** `https://flyover-utx.vercel.app/?walk=1&preset=cinematic&drift=0`
It **cannot take `?clip=1`** if you want the answer on screen — clip mode hides
the pill. So the walking clip has the interface in it. That is the trade.

**A route to have in your fingers before the camera is on:** type `JES`, click
the row; type `GDC`, click the row. It answers
**"5-8 min walk · 470 m · No stairs on this route / Bill and Melinda Gates
Computer Science Complex · The main entrance"**. Then press **Show route ⤡**.

**What the six answered**

| route | answer | the passing-period line |
|---|---|---|
| `JES` → `GDC` | 5-8 min · 470 m · No stairs | *(silent)* |
| The Castilian → `RLP` | 13-19 min · 1.1 km · No stairs | Tight for a 15-minute passing period |
| `PCL` → `GUG` | 11-15 min · 940 m · No stairs | Tight for a 15-minute passing period |
| Dobie Twenty21 → `WEL` | 8-12 min · 720 m · **Stairs: 1 set** | *(silent)* |
| The Castilian → `HTB` | 20-29 min · 1.8 km · No stairs | Longer than a 15-minute passing period |
| `JES` → `ACS` | **"ACS is not walkable in this build yet"** | — |

The distances are right, the sub-line names the building and which side its
doors are on, stairs are called out, and **the 15-minute line only ever warns —
it never tells you that you will make it.** That restraint is the best thing
about the feature and it is worth saying on camera.

**Where to point the camera**

* **Walking height is the ONE place this feature beats everything else in the
  app at eye level.** `A-walking.jpg` — a cream ribbon with white dashes running
  down the brick of Speedway. The ground was the app's weakest thing at 2 m; the
  ribbon gives it a subject. This is the exception to "no walking-height
  footage".
* **From altitude, film a route that runs along streets.** `E-altitude.jpg` (The
  Castilian → Dell Med) is the best frame this pass produced: an unbroken white
  ribbon across the whole city with "Longer than a 15-minute passing period" in
  red in the pill. `D-altitude.jpg` is nearly as good.
* **Do not film a route that cuts through the middle of campus from altitude.**
  `B-altitude.jpg` — roofs and tree canopies swallow most of the line and it
  reads as three disconnected white scratches.
* **`JES` → `ACS` is a beat, not a bug.** `F-answer.jpg`: it says
  *"ACS is not walkable in this build yet"*, clears the old route off the map,
  and carries *"We can't route inside buildings"* and *"© OpenStreetMap
  contributors · Not affiliated with UT Austin"*. Filming an honest limit is a
  better look than pretending there isn't one.

**63 of the 198 UT register codes still answer "not walkable in this build
yet" (135 route).** Type a building you have already tried before the camera is
on.

---

# Where the four reports disagree with each other

Rather than quietly picking a winner, here is each conflict and what settles it.

**1. "P hides everything" versus "P does not hide the labels."**
`first-impression.md` says `P` "hides every bit of UI chrome for a clean frame".
`embarrassing.md` says `P` does not hide the building names. **The code settles
it: `embarrassing.md` is right.** `P` hides the interface only. The building names
are part of the map and stay. The first report was describing the interface
correctly and reading as a bigger promise than it makes.

**2. Where the opening flight leaves you, and whether that frame is any good.**
`first-impression.md` says the flight "ends on the UT Tower… It reads well."
`beautiful.md` says the landing frame is *not* one of the good ones — and, in a
different paragraph, says the flight ends at the home position. **Those cannot
both be true, and the code shows they are two different places:** the flight ends
just south of the Tower facing **north**; home (`R`) is about 400 m away facing
**west-south-west into the sun**. They point in nearly opposite directions.
**Practical answer: let the intro finish, then press `R`.** That is the postcard.

**3. Whether you can turn off the lens-flare ghosts on the road.**
`embarrassing.md` says turning them off means dropping to the Performance preset
and losing sharpness — "pick one." **The code disagrees.** "Lens flare" is its own
slider in the `G` panel, and you can set it to zero while staying on Balanced,
live, no reload. **You can have sharp and have no ghosts on the road.**

**4. Whether the graphics preset really sticks between visits.**
`first-impression.md` could not observe it (each test run used a fresh browser)
and honestly said so. `embarrassing.md` measured it directly: it does stick.
Not a conflict — the second answers the first.

**5. The DKR Longhorn logo.**
The project's standing defect list has it as broken. `embarrassing.md`
photographed it from straight overhead and it is clean and correct.
**The defect list is out of date on this one.**

**6. Where they agree, believe it.** Both reports caught the graphics
self-downgrade independently, with different setups (one with a visible browser,
one headless), at the same time and with the same message. That is the most solid
finding in this document.

---

# If you only do three things before you hit record

*(REWRITTEN 2026-08-17. The old item 1 — "press `G`, and clear the site data
first" — is obsolete: a flag does it now, before anything paints.)*

**1. Put `?preset=cinematic&drift=0` on every URL you record from, and make the
browser window 16:10 or taller.** `preset=cinematic` stops the app changing its
own look mid-take and needs no panel and no site-data clearing. `drift=0` stops
the camera turning itself — measured, 59° of rotation in 75 seconds of silence
without it. The window shape is what decides whether `R` puts the UT Tower in
your frame at all.

**2. Record `https://flyover-utx.vercel.app/?clip=1&tour=1&preset=cinematic&drift=0`
at least once, and keep your hands off the keyboard for the full minute.** No
interface, no labels, 60 seconds, moving, golden hour, and it cannot go wrong
because nobody is flying it. If one clip has to carry the video, make it that one.

**3. Stay between 80 and 350 metres, and never touch the ▶ play button or drag
the time slider.** Below 80 m the ground is blank and the trees are flat slabs —
*unless there is a route ribbon under your feet, which is the one thing worth
filming down there (Q7)*. Above 370 m there is a hard line across the sky, and
above 400 m the Tower disappears. The ▶ button runs at under two frames a second
and is hard to stop once started — set the hour with `?p=` in the URL instead.

---

*Assembled 2026-08-06, Acer lane, read-only. No code was changed, nothing was
committed, pushed, or merged. No browser was opened for this assembly pass —
Question 5 was answered by reading `index.html`, `style.css`, `js/app.js`,
`js/graphics.js` and `js/controls.js`.*
