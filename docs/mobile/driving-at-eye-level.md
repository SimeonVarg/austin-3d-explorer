# Driving this city with a thumb, standing on the pavement

**QUEUE Y10 and Y12, first pass. 2026-08-16, Acer lane. No code was changed —
this is the pass that finds out what is wrong.**

The camera floor came down to 1.7 m in §105 and nobody had ever operated the
touch controls from down there. The joystick, the BOOST latch, the look-drag and
the two-finger altitude gesture were all designed for a camera 18 m up, and the
only touch they had ever seen was `collision.mjs` synthesising `PointerEvent`
objects at flying altitude. This is the record of actually driving it.

**The one-line verdict: the joystick is fine and should not be touched. What is
broken at eye level is everything to do with LOOKING — the vertical range is
3.58°, and the trees you walk past lose their crowns.**

---

## THE INSTRUMENT, AND WHAT IT CANNOT TELL YOU

> ### THIS WAS NOT A REAL IPHONE AND NOT REAL SAFARI, AND IT CANNOT BE FROM HERE.
>
> Everything below was measured in **Chromium wearing a phone costume**:
> 393 × 852 CSS px, `deviceScaleFactor` 3 (1179 × 2556 device px),
> `isMobile: true`, `hasTouch: true`, an iPhone user-agent string, and
> `(pointer: coarse)` / `(hover: none)` reported to the page.

**What that emulation genuinely gives, so these findings are SOLID:**

* **Real touch events, through the browser's own input pipeline.** Every gesture
  below went through CDP `Input.dispatchTouchEvent` — not `new PointerEvent(...)`
  dispatched at a DOM node. The page received `touchstart` / `touchend` carrying a
  real `TouchList`, and `pointerdown` with `pointerType: "touch"`; both were
  logged and checked (`navigator.maxTouchPoints` 5, `'ontouchstart' in window`
  true, `matchMedia('(pointer: coarse)')` true). That distinction is load-bearing:
  `js/controls.js` branches on `pointerType === 'touch'` to choose
  `SENS_YAW_TOUCH` over `SENS_YAW_MOUSE`, so a synthetic-mouse harness silently
  measures the wrong sensitivity. It also means `touch-action`, pointer capture
  and synthetic-mouse suppression are all being exercised for real.
* A real viewport, a real device pixel ratio, real CSS media queries — so
  **layout, hit-target geometry and anything measured in pixels is trustworthy.**
* Real camera geometry, real collision, the real MapLibre transform — so
  **every metre, degree and near-plane number below is the app's own answer**,
  read off `transform.cameraToCenterDistance` / `pixelsPerMeter` and
  `window.__fly`, not inferred.

**What it cannot tell you, so none of it is claimed:**

* **Anything about iOS Safari specifically** — different WebGL implementation,
  different memory ceiling, different tile-cache eviction, a different rasteriser,
  and its own reserved gestures (edge swipes, double-tap-to-zoom, overscroll).
* **Frame rate, battery or heat on his actual phone.** There is no thermal
  throttling here. The runs were on this laptop's RTX 3050 Ti through
  ANGLE / D3D11 (`launch(chromium, { gl: 'hardware' })`), headless. That is a
  desktop GPU pretending to be a phone and it says nothing about a phone's
  sustained frame rate.

**Do not read anything here as a prediction about Simeon's iPhone.**

### The rest of the setup, quoted

* Tree: a throwaway worktree at `321dd9e`, served with
  `python scripts/serve.py 8381`. `origin/main` moved to `0f50a02` during the
  pass; the diff between them is **docs only — nothing under `js/`, `index.html`
  or `style.css`** — so every finding here stands on today's `main`.
* `node scripts/verify/harness-drift.mjs` → **PASS, 29 scripts in each file**,
  run from the repo root before any pixel work.
* `window.cancelGraphicsAutoDetect()` at the top of every run. One browser at a
  time, reaped by `chrome.mjs`'s watchdog.
* **Noise floor, taken before every pixel claim.** The first attempt read a
  **53.8 luma** spread between two frames of an identical, motionless standing
  pose — the scene was still painting. After a 9 s settle the same three-frame
  floor reads **0.00**, and the BOOST-button box reads **0.00** across three
  frames. Every pixel number below is against a 0.00 floor. The 53.8 is written
  down because it is exactly the reading that would have made a wrong claim look
  solid.

---

# THE RANKED LIST

---

## 1. The entire vertical look is 3.58°, and one thumb-flick spends all of it
### BREAKS THE ILLUSION

At 1.7 m the pitch is trapped between the `dMin`-derived floor **84.42°** and
MapLibre's own `maxPitch` **88°**. That is **3.58 degrees of vertical look,
total.** (`dMin` on this viewport is 17.49 m against the desktop's 18.48 m — a
393 × 852 phone is very slightly *less* restricted than a 1440 × 900 desktop, and
`deviceScaleFactor` makes no difference at all: dpr 1 and dpr 3 both read 17.49.)

`SENS_PITCH_TOUCH` is 0.11 °/px, so the whole range is **33 px of thumb travel** —
roughly 5 mm of glass, on an 852-px-tall screen.

Measured with a real 150 px vertical swipe, three interleaved reps:

```
rep0  swipe down-screen 150 px   pitch 87.00 -> 88.00   (+1.00, hit the cap)
rep0  swipe up-screen   150 px   pitch 88.00 -> 84.42   (-3.58, hit the floor)
rep1  swipe down-screen 150 px   pitch 84.42 -> 88.00   (+3.58, cap)
rep1  swipe up-screen   150 px   pitch 88.00 -> 84.42   (-3.58, floor)
rep2  swipe down-screen 150 px   pitch 84.42 -> 88.00   (+3.58, cap)
rep2  swipe up-screen   150 px   pitch 88.00 -> 84.42   (-3.58, floor)
```

**Every single swipe lands on the opposite stop.** There is no intermediate pitch
a thumb can reach on purpose. The other ~117 px of each swipe is dead travel — the
frame is frozen while the thumb is still moving, which reads as the app having
hung, not as a limit being respected. An earlier probe made this even plainer:
ten consecutive 10 px nudges produced `87.00 → 87.00 → 88.00 → 88.00 …`, i.e. it
was over after the second nudge and the next eight did nothing.

What that costs, stated honestly rather than dramatically: with a 58° vertical
FOV the top of the frame sits **27° above horizontal at the cap and 23.4° at the
floor.** So you can see *some* sky, and you cannot see your feet at all — but the
whole adjustment available to a person standing on the South Mall is under four
degrees, on a device whose only look control is a flick.

*Frames: `shots/mobile/y10-standing-at-a-wall-p87.png` and
`y10-standing-at-a-wall-p88.png`. Those two are 1° apart and between them they
are most of what the look control can do down there.*

This is the same geometry Y4 and Y16 already track. It is listed first anyway
because **on a phone it is a different problem**: a mouse-drag is a deliberate,
bounded gesture; a thumb-flick is not, and the range is now smaller than the
gesture that drives it.

---

## 2. Walk up to a live oak and it turns into a bare pole — this is Y12
### BREAKS THE ILLUSION

**This is the frame to look at: `shots/mobile/y12-canopy-at-the-trunk.png`.**

Standing at 1.7 m on the South Mall, **2.28 m from the trunk axis** of the oak
§108 used (−97.739031, 30.285164), having walked there on the joystick with a real
finger. The tree directly in front of the camera is **a brown pole standing on a
bare pale disc, with no crown at all** — while three oaks further down the same
mall, in the same frame, have full crowns, and the Main Building is behind them.
Nothing in that picture reads as "a limit"; it reads as "the model is broken".

The mechanism is §108's, re-confirmed here on a phone viewport by reading
MapLibre's own transform rather than by arithmetic:

```
nearZ = (transform.cameraToCenterDistance / 50) / transform.pixelsPerMeter
```

At 1.7 m eye that measures **0.35 m at the 84.42° pitch floor, 0.65 m at pitch 87,
and 0.97 m at the 88° cap** — and it read **0.93 m at the instant of that frame.**
Anything nearer is clipped; and because MapLibre back-face-culls fill-extrusions,
clipping a surface's near face does not show you its inside, **it shows you what
is behind it.** Hence no crown, rather than a hollow crown.

`y12-canopy-3m-out.png` is the same walk 3 m earlier and shows the other half of
the problem: the *next* crown, about 2 m away, renders as one enormous flat green
slab across the bottom third of the frame. Between "an unreadable slab" and "not
drawn at all" there is no distance at which a tree looks like a tree from
underneath.

**Why this matters more than it sounds.** The South Mall is a double row of live
oaks and it is *the* walk on this campus. §108 raised `TRUNK_PAD` 0.6 → 0.9 m so
the *trunk* stops you outside the near plane — and that part works, the trunk in
the frame is solid. But the canopy is deliberately not collided (correctly: people
walk under trees), so **the canopy is always inside the near plane.** Every
tree-lined path on campus is a corridor of naked poles at walking height.
`y10-joystick-walk-works.png` shows the flyover-era version of the same thing:
canopies as flat slabs filling the top half of the frame.

**Walls are on a 3 cm margin, not a comfortable one.** The collision hard net is
`R_CAM_GROUND` **1.0 m**; nearZ at the pitch cap is **0.97 m**. I walked into the
94 m south face of the Main Building on the joystick and it stopped me **0.93 m**
off the collision cell with the wall fully drawn, altitude pinned at 1.70 m the
whole way (`y10-wall-collision-stop.png`). So walls do *not* currently vanish —
but the margin that keeps them visible is three centimetres, and it is there by
luck, not by design. Anything with geometry inside 1 m of the camera — a door
surround, a threshold, a kerb, a bench, a sign — is on the wrong side of it.

---

## 3. BOOST — Simeon's "a bit off visually" is four separate things, now measured
### ANNOYING (and it is the only item he has already named himself)

`y10-boost-off.png` / `y10-boost-on.png`, same pose, against a **0.00 luma**
three-frame noise floor.

**(a) It sits on the joystick ring.** Joystick base 100 × 100 px at (32, 682),
centre (82, 732), radius **50 px**. BOOST is 60 × 44 px at (119.5, 650.5). Its
nearest corner is **53.0 px from the joystick centre** — three pixels outside a
50 px ring. Not near the ring: on it.

**(b) It is on the same side, and therefore the same thumb, as the stick.**
BOOST's centre x is 149.5 on a 393 px screen; the joystick's is 82. Both left of
centre. Sprinting means taking the thumb off the steering.

**(c) Switched off it hides.** The BOOST box reads mean luma **86.0** against a
whole-frame median of **121.2** — the button is **0.71 × its surroundings**, i.e.
darker than the scene it floats on.

**(d) Switched on it is the brightest object in the city.** The same box goes to
**148.1** (a 72 % jump, against a 0.00 floor), **1.21 ×** the frame median, and its
99th-percentile pixel is **246.3 against the whole frame's 99th percentile of
166.2** — equal to the brightest pixel anywhere in the frame (246.6). The
off→on transition is a 0.71 × → 1.21 × swing with nothing in between. That is why
it reads as an alarm rather than a state.

**The touch target is 60 × 44 px** — exactly on Apple's 44 px minimum in height
and under it in nothing, so it is legal but tight, and it is 3 px from a control
you are already holding.

**It does work, and it is a genuine 2.5×.** On open ground, 8 s of held stick:
peak speed **1.36 m/s unboosted, 3.40 m/s boosted — exactly 2.50×**, altitude
pinned at 1.70 both ways. *One clean rep:* the second interleaved rep did not get
moving (the camera had not released from the previous run), so treat 2.50× as one
good observation consistent with the `SPRINT` constant, not as a minimum of reps.
The latch also survives the two-thumb case: tap → `true`; tap again with the stick
held down under a second finger → `false`.

---

## 4. The graphics panel covers the joystick and the BOOST button
### BREAKS THE DEMO (not the illusion — but it is worse on tape)

Tapping the gear at eye level opens a panel **393 × 596 px at y = 256 — exactly
70.0 % of the screen.** Proven without eyeballing: `document.elementFromPoint()`
at the joystick's centre returns `SPAN.gfx-group-note`, and at BOOST's centre
returns `SPAN.gfx-name`. **The panel is literally on top of both driving
controls** (`y10-graphics-panel-over-the-joystick.png`).

The gear button itself is **34 × 34 px** — under the 44 px minimum touch target,
and so is the feedback button beside it at 34 × 34.

The recording brief already says do not touch the gear on tape. This is the
measurement behind it, plus the new part: at walking height you also cannot *move
away* while it is open.

---

## 5. `?clip=1` on a phone gives you a frame you cannot walk in
### BREAKS THE DEMO

`?clip=1` hides `joystick-zone` (`display: none`), which takes the joystick **and
BOOST** with it (`y10-clip1-no-way-to-walk.png` — the drive controls are simply
gone). On desktop that is fine, because `?clip=1` leaves WASD. **A phone has no
keyboard.** So the one mode that gives a clean recording is also the one mode in
which a phone cannot move — look-drag still works, walking does not.

The recording brief says "`?clip=1` hides all of it and works on a phone". That
was written about a flyover, where you would not be walking anyway. At eye level
it is now the difference between a shot and a still.

---

## 6. Two-finger altitude only goes up from the pavement, and nothing says so
### ANNOYING

Every gesture below was a real two-finger touch. **All eight MapLibre handlers are
disabled** (`scrollZoom`, `boxZoom`, `dragRotate`, `dragPan`, `keyboard`,
`doubleClickZoom`, `touchZoomRotate`, `touchPitch` — all `false`), so MapLibre is
not fighting the custom controls at all. What is left is the app's own two-finger
code:

```
pinch, fingers apart (spread)  standing at 1.7 m   dAlt  0.00 m   (correct: on the floor)
pinch, fingers together        dAlt +2.95 m   1.70 -> 4.65 m
two fingers dragged up-screen  dAlt +1.68 m   4.65 -> 6.33 m
two fingers rotated            dAlt +0.01 m   dBearing 0.00      (nothing — good)
single tap on the scene        dAlt  0.00 m   dBearing 0.00      (nothing — good)
```

So: **pinching *closed* lifts you off the ground** — which is the opposite of the
universal map convention, where pinching closed zooms *out*, i.e. away. The hint
bar says "two fingers for altitude" and does not say which way, and there is no
marker anywhere for "you are back on the pavement".

*Caveat on my own numbers:* after the first successful lift, my attempts to
re-place the camera at 1.7 m between gestures did not take, because the controller
holds camera ownership for `TUNE.BOB_TIMEOUT` (8 sim seconds) after any input. So
gestures 2–5 were measured starting from ~4.6–6.3 m, not from 1.7 m. Each delta is
still a genuine before/after of that gesture; the starting altitude is not the one
I asked for.

---

## 7. Labels clip at both screen edges and sit on the time slider
### COSMETIC

Already known from the recording brief on the flyover; it is the same at eye level
and slightly worse, because the horizon sits mid-frame and every label projects
into one narrow band (that is QUEUE Y9). In `y10-joystick-walk-works.png` the UT
Tower's label reads "UT To" against the right edge, on top of the time-of-day
column; in `y12-canopy-3m-out.png` the same label reads "wer" against the left
edge. `controls-hint` is **405 px wide on a 393 px screen**, starting at x = −6 —
the earlier measurement, re-confirmed at walking height.

---

# WHAT WORKS — do not let the next phase spend time on these

1. **The joystick is correctly tuned at 1.7 m. Leave it alone.** Full-forward on
   the stick, held by a real finger for 14 s on open South Mall lawn: **1.36 m/s
   sustained, 18.72 m covered, altitude 1.70 m for every one of 56 samples, pitch
   unchanged.** Two controls, same lane, same duration: the **W key on the same
   phone gave 1.36 m/s / 18.89 m**, and **W on a 1440 × 900 desktop gave 1.31 m/s
   / 18.10 m.** Walking pace is 1.4 m/s. `SPEED_MIN = 1.0` and the existing expo
   curve are doing exactly the right thing, and the joystick is indistinguishable
   from the keyboard.
2. **Collision holds under touch.** Walked into the Main Building's 94 m south
   face on the stick: stopped at 0.93 m, altitude peak 1.70 m, speed peak
   1.36 m/s, never lifted, never penetrated. Walked past a live oak: stopped
   outside the trunk, trunk solid in frame.
3. **Yaw is fine.** 150 px of thumb = **27.0° every time** across three reps
   (0.18 °/px = `SENS_YAW_TOUCH` exactly). A full-width swipe is ~71°. No
   wildness, no drift, no sensitivity problem on the horizontal axis.
4. **The old joystick-vs-look bug is genuinely dead.** A thumb on the stick plus
   a second finger swiping the canvas does not turn into a pinch, and BOOST can be
   tapped by a second finger while the stick is held.
5. **A bare tap on the scene does nothing.** Verified: `pointerType: "touch"`,
   exactly one synthetic `click`, camera unchanged.
6. **No page errors in any run**, across five browser sessions and every gesture
   above.
7. **The pose is stable when you let go.** Placed at 1.7 m and left alone for
   11 s with no input: altitude 1.70, pitch 87.00, `altFloor` 0, `driving` false,
   at every one of eleven one-second samples — on the phone at dpr 3, the phone at
   dpr 1, and the desktop. There is no drift.

---

# WHAT THIS PASS DID NOT ESTABLISH

* **Anything at all about real iOS Safari**, and nothing about frame rate,
  battery or heat on a real phone. See the instrument section. Do not let any
  number here be quoted as a phone number.
* **The double-tap-and-drag altitude gesture — completely untested.** `TAP_MS` is
  280 ms and `lastTapAt` is stamped on `pointerdown`, so the test needs two
  pointerdowns inside 280 ms. **The smallest gap this instrument could produce
  was 2,012 ms** (measured in-page: 7,151 / 3,489 / 2,012 ms for asked gaps of
  0 / 60 / 120 ms) because every CDP dispatch is a round trip under load. An
  earlier run appeared to show the gesture "failing" and swinging the pitch 15–19°
  instead — that was my instrument missing the double-tap, not the app. **Nobody
  has tested this gesture. It stays open.**
* **BOOST's 2.5× is one clean rep, not a minimum of reps.** The second interleaved
  rep never got moving.
* **The look-drag was not compared against flying altitude.** My attempt to place
  the camera at 160 m for the comparison did not take (it read back 1.7 m), so the
  "at altitude this feels different" half of Y10 is unmeasured.
* **The feedback button was never opened.** My selector search did not find it by
  id and I did not fall back to a coordinate tap. The recording brief's earlier
  desktop-era measurement (47 % of the screen, focuses a text box) is unretested
  at walking height.
* **The time-of-day slider was not dragged at walking height.** Its known 3 fps
  cost was measured on the flyover, not from the pavement.
* **Night and dusk were not driven on a phone at all.** Everything here is the
  default daylight `p`.
* **Only one wall was walked into.** The 3 cm margin between `R_CAM_GROUND` and
  nearZ is arithmetic plus a single observation, not a survey. Somebody should
  walk into thirty walls before anyone claims walls are safe.
* **No pixel sweeps were run** (`zfight`, `coplanar`, `facade-parity`). Nothing
  here changed a pixel — but that is reasoning, not looking.
* **The step-up runaway I saw once and could not reproduce.** An early run that
  started on a building footprint climbed 1.7 → 108 m and accelerated to 27 m/s
  over 12 s of held stick. On the open lane it never recurred, and with no input
  at all the pose is perfectly stable, so I could not separate "a real runaway
  when you start inside geometry" from "my harness placed the camera somewhere
  illegal". Written down rather than claimed. If anyone sees the camera climbing
  on its own, this is the note.
