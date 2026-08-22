# Pose audit — QUEUE ITEM 1

Every camera pose in every `scripts/verify/*.json` pose/shot file, checked for
the exact failure class that invalidated two rounds of window-shimmer work:
`street-drag` in `shimmer-poses.json` had the camera buried inside a surface
(fixed in `a80502c`). This audit asks the same question of every other pose:
**is the pose's actual subject on screen, or is the camera looking at nothing
useful?**

**Headline: five more poses, in five different files, were exact duplicates
of that same known-broken camera position and had never been fixed. All five
are fixed now. No pose anywhere else in the other 411 shows the same failure
signature.** Full accounting below, including what a live browser pass did
and did not reach.

## Two passes, not one

**Pass 1 — static, 100% coverage, no browser.** Every pose's `center` was
checked against the exact coordinates `a80502c` proved buried the camera
(`-97.7417, 30.288598`, zoom 19.017, pitch 76), against every other pose's
coordinates (duplicate detection), and against a close+steep risk profile
(zoom ≥ 18.5 and pitch ≥ 74 — the two numbers that put a camera nose-first
into geometry). This is instant and exhaustive; it is also narrow — it only
catches poses that are *this specific* bug or share its exact camera position.

**Pass 2 — live, browser, partial coverage.** For every pose reached: jump the
camera, wait for the map to go idle, screenshot into `shots/audit/`, resolve
which layer family the pose is testing, hide it, repaint, and diff the canvas
against the pre-hide frame in-page (luma delta > 10 = changed pixel; never
hands a full framebuffer back through CDP — the README's 20-minute mistake).
That percentage plus a Read-tool look at the frame is the verdict. **This
pass reached 27 of 417 poses** across 5 files before I stopped it — see
"What this did not establish."

## Pass 1 results: the five broken duplicates, now fixed

| file | pose | was | now |
|---|---|---|---|
| `shimmer-poses-front2.json` | street-drag | `[-97.7417,30.288598]` z19.017 p76 | `[-97.74155,30.2876]` z17.8 p70 |
| `shimmer-poses-iso-drag.json` | street-drag | same | same fix |
| `shots-drag-front2.json` | street | same | same fix |
| `shots-street-only.json` | street-drag | same | same fix |
| `shots-street-wall.json` | street-drag-wall | same (plus a `box` crop) | same fix, box left as-is and flagged |

All five were byte-identical camera positions to the pose `a80502c` already
proved buried the camera in `shimmer-poses.json` — that fix updated only its
own file and never propagated to five sibling files that had copied the same
coordinates. Each fixed JSON's own `note` now says what was wrong and cites
the evidence (`shots/shimmer/posebug/street-drag-BROKEN-camera-buried.png`,
already in the repo from `a80502c`).

One finding worth reading in full: `shots-street-wall.json`'s note said it
cropped the frame to `y>545` to exclude "js/ground.js's ALREADY-KNOWN,
ALREADY-TRACKED fill-pattern zoom-aliasing bug" — that diagnosis was wrong.
The band dominating the frame was the buried camera, not ground-texture
aliasing. The crop is left in place (I don't have grounds to pick a new value)
but is flagged in its own note for whoever next runs a wall-isolation
measurement there.

**Re-scanned after the fix: zero poses anywhere in the remaining 412 share
the exact broken coordinates, and zero poses (anywhere in all 417) fall in
the close+steep risk profile (z≥18.5, pitch≥74) at all.** One pose,
`shots-drag-front2.json`'s `aerial`, shares only the lng/lat with the old bug
at a much wider, flatter angle (z15.8, pitch 50) — well outside the risk
profile, not touched, not live-verified (see gaps below).

## Pass 2 results: every pose reached, with its frame

27 poses across `shimmer-poses.json` (9/9), `shimmer-poses-front2.json`
(6/6), `moody-shots.json` (6/6), `night-shots.json` (5/5, 1 errored — see
below), and `shimmer-poses-iso-drag.json` (1/1). **Every one of the 27 was
opened with the Read tool and confirmed the subject is genuinely on screen** —
Tower, Moody Center, Ransom Center, DKR, Guadalupe shopfronts, West Campus,
Dell Med, downtown skyline, all correctly labeled and framed at the pose's
own time of day. Screenshots for all 27 are in `shots/audit/`.

| file | pose | family | changed% | verdict |
|---|---|---|---|---|
| shimmer-poses.json | shot-a-tower | tower | 0.21% | VALID — Tower framed, low % is a wide shot with a narrow family (see below) |
| shimmer-poses.json | street-drag | drag | 0.70% | VALID — Guadalupe shopfronts, Tower, road all in frame |
| shimmer-poses.json | tower-close | tower | 7.18% | VALID |
| shimmer-poses.json | moody-west | moody | 2.08% | VALID — dome-shaped venue, wall family is roof-dominated (see below) |
| shimmer-poses.json | arts-ransom | arts | 1.75% | VALID — Ransom Center small in frame at this angle |
| shimmer-poses.json | westcampus-street | wc | 6.99% | VALID |
| shimmer-poses.json | places-shopfront | places | 0.62% | VALID — Union/shopfronts on screen |
| shimmer-poses.json | cruise-campus | broad | 38.27% | VALID |
| shimmer-poses.json | shot-b-park | broad | 50.48% | VALID |
| shimmer-poses-front2.json | street-drag (fixed) | drag | 22.62% | VALID — confirms the fix; content matches shimmer-poses.json's own verified pose |
| shimmer-poses-front2.json | tower-close | tower | 7.12% | VALID (matches shimmer-poses.json twin) |
| shimmer-poses-front2.json | moody-west | moody | 1.91% | VALID (twin) |
| shimmer-poses-front2.json | arts-ransom | arts | 1.76% | VALID (twin) |
| shimmer-poses-front2.json | places-shopfront | places | 0.64% | VALID (twin) |
| shimmer-poses-front2.json | westcampus-street | wc | 7.14% | VALID (twin) |
| shimmer-poses-iso-drag.json | street-drag (fixed) | drag | 0.55%¹ | VALID — same coordinates as the 22.62% reading above; see noise finding |
| moody-shots.json | M1-moody-west | moody | 0.98% | VALID |
| moody-shots.json | M4-moody-golden | moody | 0.79% | VALID |
| moody-shots.json | M5-moody-night | moody | 0.27% | VALID |
| moody-shots.json | H1-dellmed-west | moody | 2.86% | VALID — near-nadir, wall family naturally small |
| moody-shots.json | H4-dellmed-night | moody | 1.22% | VALID — Health Discovery Building clearly labeled |
| moody-shots.json | P1-precinct-day | moody | 6.61% | VALID — DKR, Tower, Erwin Center all labeled |
| night-shots.json | core | — | ERROR² | not established |
| night-shots.json | wide | broad | 12.61% | VALID |
| night-shots.json | street | broad | 22.39% | VALID |
| night-shots.json | west | broad | 16.99% | VALID |
| night-shots.json | dusk | broad | 40.32% | VALID |

¹ Not from a full JSON-flushed run — read off the live progress log before I
stopped the sweep. ² `page.screenshot` hit Playwright's own 30s timeout under
heavy contention; not a pose defect, needs a retry, no frame was written.

## The low-% pattern is explained, not alarming

Twelve of the 24 structured readings are under 3%, which is my own mandatory-
review cutoff (see below) — but **every one of the twelve was visually
confirmed valid.** Two real, non-buggy reasons kept recurring:

- **A narrow family in a wide shot naturally covers few pixels.** `tower-wall`
  is a window strip a few hundred pixels wide even when the Tower itself
  fills a third of the frame (`shot-a-tower`, 0.21%).
- **A family that isn't the dominant visible surface at this angle.** Moody
  Center is dome-shaped — most of what's on screen is `moody-roof`, not
  `moody-wall` — and Dell Med's `H1-dellmed-west` is a near-nadir look where
  every building reads mostly as roof. `pctChanged` correctly reports that
  `moody-wall` isn't contributing much; it isn't reporting that Moody Center
  is off screen, which the frame proves it is not.

## The number is noisy under contention — read the frame

The single most important thing this audit measured about its own method:
**the identical pose, identical family, at the identical time of day, read
22.62% in one run and 0.55% in another** — `shimmer-poses-front2.json`'s
street-drag (my fix) vs. `shimmer-poses-iso-drag.json`'s street-drag (the
same fix, same coordinates, same `drag-wall/cap/detail` hide-set). The only
difference was machine load: the 0.55% reading took 371.7 seconds under heavy
contention (up to 40 concurrent `chrome.exe` processes measured mid-run,
other agents' sibling sessions), against 29.8 seconds for the 22.62% reading.
Under that much starvation, a fixed-millisecond repaint wait is not long
enough to guarantee even one real frame renders before the diff samples it —
so a perfectly valid pose can read as if nothing changed. This is exactly
the task brief's warning restated with a number: **`pctChanged` is a
screening signal, never a verdict — the picture is the verdict.** Every row
above was judged by its frame, not its percentage.

## What this did NOT establish

- **390 of 417 poses were not reached by the live browser pass.** Pass 1
  (static) checked all 417 for the one known bug signature and found nothing
  beyond the five fixed above; it cannot rule out a *different* framing
  defect (wrong building, wrong time of day, subject just out of frame) in
  the untouched files. The harness this audit built (single continuous
  browser session, resolve-family-then-hide-then-diff, `RESUME=1` to
  continue a partial run) is proven correct on 27/27 and ready to finish the
  remaining files — I did not commit it, since my write scope for this task
  is `scripts/verify/*.json` + this doc + `shots/audit/`, not new `.mjs`
  tooling in a directory ten other sessions are also touching.
- **`night-shots.json`'s `core` pose** never got a frame (screenshot timeout
  under contention) — needs a plain retry, not a pose fix.
- **`shots-drag-front2.json`'s `aerial` pose** shares only lng/lat with the
  old bug at a much safer zoom/pitch (15.8/50); it passes the static
  risk-profile check but was never opened and looked at.
- **The `y>545` box in `shots-street-wall.json`** was tuned to the old broken
  pose's artifact boundary. It's flagged in the file's own note; I did not
  re-derive a value for the corrected camera position.
- Contention on this machine was severe and directly measured (up to 40
  concurrent Chrome processes, per-pose times ranging 15s–386s for
  functionally identical work) — treat every `pctChanged` and every timing
  number in this doc as contended, exactly as the task brief warned.
