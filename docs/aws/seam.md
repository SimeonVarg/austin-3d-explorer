# The line across the sky in the wide — what it is, and why I left it alone

Written 2026-08-17, Acer lane, the night before the AWS recording. Everything
here was measured against the **live site** `https://flyover-utx.vercel.app/`
with `?clip=1&preset=cinematic&drift=0&intro=0`, 1600x1000, SwiftShader (the
suite default), graphics auto-detect cancelled. **No rendering code was
changed.** The scripts are `scripts/verify/seam.mjs` (what paints it),
`seam-where.mjs` (which framings show it) and `seam-tour.mjs` (whether the tour
ever gets there); the pictures are in `shots/seam/`.

---

## THE ANSWER FIRST: **NOT FIXED. FRAME AROUND IT.**

**The line is real, it is the horizon, and it is in every frame the app draws —
you just cannot see it in most of them.** The one knob that closes it dissolves
the entire city into fog. Compare these two, both the same pose, both the live
site:

| | |
|---|---|
| `shots/seam/wide-shipped.jpg` | what ships. The line is at 36% down the frame. |
| `shots/seam/wide-hazemax-1.0.jpg` | the line is gone — and so is downtown. |

That second picture is what happens when you turn the haze up until the ground
and the sky meet. It is not a trade worth making, and it is certainly not one to
make at midnight before a shoot.

**Your one line for tomorrow:** *don't hold a shot from higher than about
z14.6 — roughly 370 m. From z15.3 (about 230 m) down, the city itself breaks the
line up and nobody will ever see it.* Home (`R`) is around 140 m, well inside
that. This is the same advice the go/no-go already gave for a different reason
("don't hold a high wide"), so nothing about your plan changes.

**And the good news, which I went and checked rather than assumed: the
60-second tour never climbs.** I traced its camera twice, from the page's own
t=0, across the whole minute. Both runs: **zoom stays between 16.5 and 17.1 the
entire time — it never once goes above z14.6, or even above z15.3.** The tour's
own highest moment is the home pose, and at that pose the step is 15.7 luma
against a spread of 22.9, i.e. straight into the city
(`shots/seam/tour-highest.jpg`). **If the tour carries the video, this defect
cannot appear in it.** The only way to put this line on tape is to fly up
yourself and hold it.

---

## What it actually is

**It is not `#fx-dof`, and it is not any DOM overlay.** That was the first
hypothesis, because this repo has answered a "horizon line" complaint twice
before and both times the answer was a screen-row element — `#fx-dof`, a CSS
blur band pinned to a fixed row, and the old `#haze` bar. Both are gone. I
hid the entire `#sky` stack — `#sky-canvas`, `#sky-ground-haze`, `#sky-glow`,
`#sky-bloom`, `#sky-core` — and **it moved zero pixels of the frame.** `#fx-dof`
is `display:none` with height 0, exactly as `js/graphics.js` says it should be.

**It is the join between the sky and the far ground, and it sits on the
geometric horizon.** Two independent derivations agree on that:

* Solve the camera for where the horizon lands and you get one focal length,
  708 px at this frame height, from **seven** different pitches (60, 66, 70, 72,
  74, 76, 79) — every one of them predicts the row the step was found on to
  within 1 pixel.
* `banding.mjs` computes the horizon its own way and lands on row 362.4 at pitch
  79. The step is at row 362.

A thing pinned to a screen row does not move with pitch. This does. So it is a
horizon, not an artefact — the trouble is that it is a *hard* horizon.

**Why it is hard.** Above the line the sky is `horizon-color`. Below it the
ground fades toward `fogColour()`, and it only gets `HAZE.MAX` of the way there
— 0.58 at the golden hour. The remaining 42% is raw tan ground showing through,
and raw tan is a long way from sunset orange. Measured at the wide, at x=800:

```
row 361 (sky)     #fead4d
row 362 (ground)  #e7a25c        one row, 13.5 luma, the full width of the frame
```

Turn the fog off entirely and the gap opens to `#ffc04c` over `#cc9f6e` — and
0.42 of that gap is, to the pixel, the step you see. The arithmetic closes.

**Both constants behave like doses, which is how I know that is the mechanism:**

| what I changed | step at the horizon | pixels of the frame it moved |
|---|---:|---:|
| nothing (shipped) | 49.9 | — |
| `HAZE_TUNE.SKY_MIX` 0.22 → 0 | 35.2 | 1,572,232 of 1,600,000 |
| `HAZE_TUNE.SKY_MIX` 0.22 → 0.5 | 57.4 | 1,572,055 |
| `HAZE_TUNE.MAX.golden` 0.58 → 1.0 | **1.2** | 1,573,794 |
| fog off entirely | 113.8 | 1,572,111 |
| the whole DOM `#sky` stack hidden | 49.9 (unchanged) | **0** |
| `sky-horizon-blend` 0.86 → 0.3 | 49.2 | 1,595,494 |

(The step column is the one-row change in mean RGB summed over the three
channels; the luma numbers quoted elsewhere come from the same rows. Two
captures of the same page differ by **0 pixels**, so every number above is
signal.)

Both constants are deliberate and both are documented in `js/sky.js`. `MAX` was
calibrated against the exact high view you said you liked ("*so if i go high
enough ... it looks really nice like their distant and shaded with the sky a
bit*"). `SKY_MIX` exists precisely so the ground does **not** match the horizon
band, because when it does "a horizon band that matches the ground exactly reads
as one flat wall". The seam is the price of both, and both are on `window` if
you ever want to play with them live.

---

## Why I refused to fix it tonight

The bar for touching anything tonight was: **provably invisible everywhere
else.** Nothing here can clear it.

* Every knob that moves the seam moves **98% of the frame**. There is no local
  fix; the haze is the far field.
* The obvious one, `MAX` → 1.0, closes the seam completely and **destroys the
  shot** (`shots/seam/wide-hazemax-1.0.jpg`). Downtown becomes a ghost.
* A targeted version — ramping the ground's haze to full only in the last few
  rows before the horizon — is a shader change to `js/sky.js`, which was
  rewritten 48 hours ago and whose guards were repaired yesterday. And its blast
  radius is *the horizon band of every frame in the video*, at golden hour. That
  is the definition of not-invisible.

So the code is untouched and `main` is exactly what you rehearsed on.

**The four sky guards were run anyway, on unmodified `main`, served locally from
a throwaway worktree:**

```
sky.mjs               12/12 passed
dusk.mjs              PASS  — 0 unexcused of 60 transitions exceed 26
night-silhouette.mjs  PASS  — night separation 22.5, dusk 23.5 (want >= +8)
banding.mjs           PASS  — 9 of 9 assertions, day / golden / night
```

---

## Where it shows, so you can trust the rule

Same live site, same hour, only the camera moving. "Spread" is how much the
colour varies across the width just below the line: low means an empty band and
a visible line, high means city, and the identical step vanishes into it.

| framing | approx height | step (luma) | spread below | reads as |
|---|---:|---:|---:|---|
| z13.9, pitch 79 (the very wide) | ~600 m | 14.0 | 5.8 | **a drawn line** |
| z13.9, pitch 84 | ~600 m | 14.2 | 6.7 | **a drawn line** |
| z14.6, pitch 79 | ~370 m | 14.1 | 6.2 | **a drawn line** |
| z15.3, pitch 79 | ~230 m | 13.0 | 14.7 | the horizon |
| z16.0, pitch 79 | ~140 m | 13.5 | 18.1 | the horizon |
| z16.5, pitch 74 (home) | ~140 m | 14.6 | 22.9 | the horizon |

**The step never changes size. Only whether there is a city in front of it.**
`shots/seam/spawn-shipped.jpg` is home, and the same 14.6-luma step is in it at
row 297 — go and look for it; you will not find it without being told.

By hour, at the wide: **daylight is the worst** (22.6 luma), golden hour is 13.8,
night is 14.3. There is no hour that saves the high wide.

---

## What this pass did NOT establish

* **The tour trace is 21 samples, not a continuous recording.** The tour pins
  the main thread hard enough to starve a 500 ms timer: the samples are spread
  over 123 s with gaps of up to 22.5 s. Two independent runs agree that the
  zoom never leaves 16.5–17.1, and 16.5 is exactly the home zoom, so I believe
  it — but a brief climb inside one of those gaps would not have been caught.
  **Nobody has watched all 22 tour frames specifically looking for this line**;
  I measured the camera, not every frame.
* **The first cut of that tour trace was wrong and said the camera never
  moved.** It started sampling after `networkidle` and the source waits, by
  which time the page clock read 136 s and the 60-second tour had been over for
  a minute. A tour that already finished and a tour that never runs produce the
  identical trace. The fix (an init script, so t=0 is the page's t=0) is in the
  file, along with the reason.
* **The hero poses other than home are reconstructions**, not the committed
  `C-HERO*.png` — those were hand-flown and no pose file survives. H2/H3/H5 in my
  sweep are the right neighbourhood, not the exact frames.
* **The metre figures are derived, not read off the app.** They come from the
  same 708 px focal length; treat them as "roughly", and trust the zoom numbers.
* **No fix was built or tested.** I measured what removing the seam would cost
  and stopped there. Nobody has tried the narrow ramp-at-the-horizon version, so
  "it would be visible" is an argument, not a measurement.
* **One machine, one browser, SwiftShader.** A real GPU antialiases differently
  and could make the step softer or harder by a little. Every number here is from
  the software rasteriser the suite standardises on.
* **Nothing in the verification suite watches this join.** `banding.mjs` samples
  the sky column from `hz - 0.14` down to `hz - 0.01` — it deliberately stops 1%
  of frame height short of the horizon, so it can never see the step. That is a
  scope boundary rather than an allowance left behind by a fix, but it does mean
  a future change to the fog could move this line and no gate would notice.
  Filed as **S3** in `QUEUE.md`, and written up in HANDOFF **§165**.

---

## The pictures, and what each one is for

| file | what it is |
|---|---|
| `shots/seam/wide-shipped.jpg` | **the defect.** The very wide, golden hour, live site. The line is at 36% down. |
| `shots/seam/wide-hazemax-1.0.jpg` | **the argument against fixing it.** Same pose, `HAZE_TUNE.MAX.golden` at 1.0: no line, no city. |
| `shots/seam/spawn-shipped.jpg` | home. The same 14.6-luma step is at row 297. Go and try to find it. |
| `shots/seam/tour-highest.jpg` | the highest pose the 60-second tour ever reaches. It is the home pose. |
| `shots/seam/wide-z15.3.jpg` | the wide from ~230 m — where the city starts breaking the line up. |
| `shots/seam/wide-day.jpg` / `wide-night.jpg` | the same wide at `p=0.18` and `p=0.92`. Day is the worst hour for this. |
| `shots/seam/wide-fog-off.jpg` | fog off entirely, so you can see the raw gap the haze is closing 58% of. |
| `shots/seam/seam.json` | every knockout, with the pixel count each one moved. |
| `shots/seam/seam-where.json` | the pitch and zoom ladder, predicted horizon row against found. |
| `shots/seam/seam-tour.json` | the tour's camera trace. |
| `shots/seam/dom-stack.json` | every overlay element's geometry, opacity and blend mode at the wide. |
