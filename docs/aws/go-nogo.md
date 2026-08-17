# GO / NO-GO — the morning of the AWS recording

Written 2026-08-17, Acer lane, **read-only**. Everything below was driven against
the **live site** `https://flyover-utx.vercel.app/`. No app file was changed,
nothing was committed, pushed or merged. The only things this pass created are
this file and the pictures in `shots/rehearsal/`.

---

> **AMENDED 2026-08-17, second Acer pass (timing).** The rehearsal below took no
> frame-rate reading at all and said so. It has one now, and one thing in it
> changes: **cinematic does not run at your screen's frame rate — it runs at
> about half of it. So set your recorder to 30 fps, not 60.** Everything else in
> the rehearsal stands. The full numbers are in **TIMING, MEASURED** below, and
> the picture is `shots/gaps/tour-frame-cadence.png`.
>
> **The deploy claim below is still good after the night's merges.** The
> rehearsal fingerprinted the live site against `e10d591`; `main` has since moved
> to `2ba9965`, but **not one byte of `js/`, `index.html`, `style.css` or
> `data/` changed across those commits** — they are shots, docs and bake
> bookkeeping. The site is still the tip of what ships.

# THE DEPLOY IS NOT STALE. **VERDICT: GO — WITH ONE INSTRUCTION.**

**29 front-end files pulled off the live site this morning and compared
byte-for-byte against the tip of `main` (`e10d591`). 29 matched. 0 mismatched.**
That is `index.html`, `style.css` and all 27 of our scripts — every `<script>`
tag in the page. `HANDOFF.md` and `QUEUE.md` match too, and those only exist at
the tip, so the deploy is at the tip and not one commit back.
`Server: Vercel`, `Last-Modified: Mon, 17 Aug 2026 03:23:44 GMT`.

**Everything that merged in the last two days is live and I looked at it:** the
storey bands on the Drag, campus and West Campus, the ground grain, the walking
directions, the relocated BOOST button, the sunset fix. Nothing broke on the way
in. There are **zero JavaScript errors** on any of the seven loads I drove.

---

## The one instruction, and it is the same one as last night

> **Put `?clip=1&preset=cinematic` on every URL you record from.**

Measured this morning on the live site, on a clean browser:

* **With the flags:** interface completely gone (every panel `display:none`),
  **zero building-name labels**, OpenStreetMap credit still visible
  bottom-right, preset locked to cinematic, and the auto-detect probe **frozen**
  so it cannot restyle a take mid-shot. Picture: `shots/rehearsal/flag-clipcin.png`.
* **Without the flags:** I loaded a plain URL twice. The first came back
  **Balanced**, the second came back **Performance** — with the probe still
  armed and nothing on screen to tell you. That is the old brief's number-one
  risk and it is still exactly as described.

**The old `docs/aws/RECORDING-BRIEF.md` is out of date in two ways that help
you** (labels *can* now be switched off; there *is* a preset flag) **and one way
that costs you a shot** (see item 5 below). Read this file, not that one.

### What I confirmed about every URL the brief tells you to use

| URL | does it do what the brief claims? |
|---|---|
| `?clip=1&preset=cinematic` | **Yes.** Chrome-free, label-free, OSM credit present. |
| `?clip=1&tour=1` | **Yes**, and it is the best thing in the app. Watched end to end — see below. |
| `?p=0.92` / `?p=0.62` | **Yes.** Time slider reads 0.92 / 0.62 on load. Night and dusk. |
| `?walk=1` | **Yes**, and it is **OFF by default** — see item 11. |
| `?shot=` | **This does not exist.** There is no such parameter anywhere in the code. A `?shot=` URL is silently ignored. There is still **no way to link to a camera position.** |

---

# TIMING, MEASURED — the two things the rehearsal could not answer

*Second Acer pass, 2026-08-17, read-only, everything below driven against the
live site.* The rehearsal ended by saying **no frame-rate number was taken
anywhere and cinematic was never benchmarked**, and that its scary 45–66 second
load came from one contaminated browser. Both are now measured.

## The instrument, stated before the numbers

* **Live site**, headed Chrome, on the machine's real GPU — the run prints its
  own renderer so this cannot go unchecked: `ANGLE (NVIDIA GeForce RTX 3050 Ti
  Laptop, Direct3D11)`. Canvas 1920×1080, device pixel ratio 1.
* **This display's refresh is 55.6 Hz, not 60.** Chrome hands `requestAnimation
  Frame` an 18.0 ms tick here, so **18 ms is an on-time frame, 36 ms is a frame
  one refresh late**, and every reading lands on a multiple of 18. Numbers are
  quoted against 18.0 ms, never against a textbook 16.67.
* **Minimum of interleaved reps, never a mean.** Each preset was rotated through
  the running order so no preset systematically got the quiet machine.
* **The machine was NOT quiet and this is the honest limit on everything here.**
  Two sibling verification suites ran on the same laptop all night; Chrome
  process count sat between 16 and 35 and total CPU between 2% and 100%. Those
  siblings render on SwiftShader — they compete for CPU, not for the GPU — which
  is why the medians below barely move between a 2% rep and a 96% rep. The CPU
  reading of the rep each number came from is quoted beside it.
* Instrument flags on the timing runs: `?drift=0` (the idle attract loop flies
  the camera itself after 25 s of silence) and `?intro=0`. The tour was started
  with `window.__startTour()` from an already-settled home pose, so no page-load
  tiling lands inside a frame-rate window.

## 1. THE FRAME RATE. Cinematic does not hold this screen — and balanced does not fix it.

**The 60-second tour, 1920×1080, best of three interleaved reps:**

| preset | frames on time (18 ms) | one refresh late (36 ms) | two or more late | median frame | at CPU |
|---|---|---|---|---|---|
| **cinematic** | **45.9%** | 38.8% | 15.4% | **35.2 ms** | 16.7% |
| **balanced** | **22.6%** | 60.2% | 17.2% | **35.9 ms** | 5.8% |
| performance | 62.1% | 33.4% | 4.5% | 18.1 ms | 15.6% |

Picture: **`shots/gaps/tour-frame-cadence.png`.**

**Read that table twice, because the obvious fix is not a fix.** The rehearsal
offered "`?preset=balanced` is the same flag with one word changed" as the
escape hatch if cinematic stuttered. It is not an escape hatch: **balanced is
measurably worse than cinematic on the tour**, and its median is the same 36 ms.
Switching costs you the look and buys you nothing.

**Cruise and walking height, same instrument, best of three:**

| | cinematic | balanced | performance |
|---|---|---|---|
| cruise, 216 m over campus | 35.6 ms (cpu 20.6%) | never got a quiet rep | **18.0 ms** (cpu 4.6%) |
| standing at 2.0 m, South Mall | 35.5 ms | **18.0 ms** (cpu 90.3%) | **18.0 ms**, p95 18.1 |

So balanced *is* genuinely cheaper than cinematic **at eye level** — but the
brief already tells you not to put walking-height footage in this video, and on
the tour, which is the shot that matters, the two are the same.

**Shrinking the window does not rescue it either.** Cinematic on the tour at
1600×900 came back at 36.0 ms (cpu 21.7%) — identical to 1920×1080. The tour's
cost is not fill rate; it is how much city cinematic draws (`renderDistance`
1100 m against balanced's 700 m, full tree density, higher field of view). At
eye level, where far geometry is not the bottleneck, 1280×720 *did* drop
cinematic to 18.0 ms.

### What this means for tomorrow, plainly

1. **Keep `?preset=cinematic`. The rehearsal's instruction stands.** Nothing you
   can switch to makes the tour smoother without making it uglier — only
   `performance` reaches full frame rate, and `performance` is the soft, flat,
   half-view-distance look this whole brief exists to keep off the tape.
2. **Set the recorder to 30 fps, not 60.** The app is delivering roughly 28–31
   frames a second. A 60 fps capture of a 28 fps source records every frame
   twice and makes the unevenness a *visible* pattern; a 30 fps capture absorbs
   most of it.
3. **Close everything else on the machine before you roll**, including anything
   that is quietly running in the background. And note that **the screen
   recorder itself takes CPU and GPU** — that cost is on top of everything
   measured here and was not measured.

### Said straight: what this number is not

These are **frame arrival times, not a viewing.** Nobody has watched the tour as
an exported video file. 46% of frames on time with 39% one refresh late
describes a picture alternating between 55 and 28 fps rather than sitting
steadily on either, and the honest word for that is uneven rather than smooth —
but how much survives a 30 fps encode is a question a measurement cannot answer
and an eye can. **If you have ten minutes in the morning, record thirty seconds
of the tour and watch it back before you record the real thing.** That is worth
more than anything in this section.

## 2. THE LOAD. The scary number reproduces — but not for the reason the rehearsal gave.

Five interleaved reps per arm, clean profile (a fresh browser context: no
extensions, no cache, no saved settings). The app's own veil gate has a **7.0 s
floor and an 18.0 s hard ceiling** (`js/app.js` INTRO), and the opening flight
is a further **12.6 s** of authored camera move — `leg1Ms` 6000 + `leg2Ms` 6600.
**That flight is the opening shot, not the load.** An earlier pass counted it as
load time; this one does not.

| | white gap before anything paints | navigation → city on screen | the app's own gate wait |
|---|---|---|---|
| **clean profile, cold cache** | 1.1 – 5.2 s | **10.4 – 57.3 s** | 7.1 – 17.7 s |
| clean profile, second load | 0.7 – 2.1 s | 6.8 – 38.4 s | 5.1 – 23.2 s |
| clean profile, CPU throttled 4× | 1.9 – 13.1 s | 33.0 – 137.8 s | 19.2 – 31.2 s |

**The minimum is the answer to "what does a first-time visitor wait": about
10.4 seconds to a fully built city**, plus 12.6 s of flight, so **the finished
hero frame lands around 23 seconds.** That is the good case, and it is the
rehearsal's 8–17 s band confirmed.

**The bad case is the finding.** That same clean, extension-free profile took
**57.3 seconds** on a rep where the machine was busy. So:

> **The rehearsal blamed browser extensions for its 45–66 second load. On this
> evidence that attribution is wrong.** A profile with no extensions at all
> reproduced 57 s purely because the laptop was busy, and the deliberately
> CPU-throttled arm reached 137 s. **"Record from a fresh profile" is fine advice
> but it is not the advice that protects you. "Close everything else first" is.**

A fresh profile is still worth doing for a different and completely real reason
— a machine that has opened the app before has a saved preset in it — but see
the correction immediately below, which makes even that optional.

**And the thing everyone was actually afraid of did not happen once.** Across
**fifteen loads**, including three deliberately crippled at 4× CPU throttle and
one that took 57 seconds, **not a single opening frame showed bare ground.** The
gate is doing its job: the price of a busy machine is *waiting*, not an empty
city. Two frames as proof, both the first thing on screen after the load screen
lifts:

* `shots/gaps/opening-frame-clean-10s.png` — the 10.4 s load. Full downtown.
* `shots/gaps/opening-frame-busy-57s.png` — the 57.3 s load. **Also full
  downtown**, from the same clean profile on a hammered machine.

## 3. A correction that saves you a step: you do NOT need to clear site data

The older `RECORDING-BRIEF.md` says to clear the site data first if you have
ever opened the app on the recording machine. **Driven, not read:** a saved
`performance` preset was planted in the browser exactly the way a previous visit
leaves one, and then the recording URL was loaded.

* plain URL → app came up on **performance** (renderScale 0.75, view distance 350 m)
* `?clip=1&preset=cinematic` → app came up on **cinematic** (renderScale 1, view
  distance 1100 m), and **localStorage still said `performance` afterwards** —
  the flag overrides the saved value and deliberately never writes itself back.

**So the flag alone is enough. Put `?preset=cinematic` on every URL and skip the
clearing step.**

---

# THE 60-SECOND TOUR: I WATCHED THE WHOLE MINUTE. IT IS GOOD.

Nobody had sat through it since a dozen passes landed. I ran it on a clean
browser and photographed it every ~4 seconds — **22 frames, all of them in
`shots/rehearsal/tour/`.** I looked at every one as a stranger.

**Not one frame is a dud.** The beats are: settle over West Campus → swing south
down the Drag → arrive on the Mall with the Tower and the fountain (`t05`) →
push in and quarter-orbit the Tower (`t06`–`t08`) → glide east and hold on DKR
and the Moody Center (`t09`, `t10`) → turn back with the Tower centred and the
whole downtown skyline behind it (`t12`) → long settle home into the sun
(`t13`+). Golden hour throughout, no interface, no labels, credit visible.

**`shots/rehearsal/tour/t12.png` is the best single frame this pass produced** —
UT Tower dead centre, downtown skyline stacked behind it, DKR at the left edge,
sunset sky. If one still has to sell the project, it is that one.

**If one clip has to carry the video, it is still this one.** Start it, take your
hands off the keyboard for a minute, and it cannot go wrong because nobody is
flying it.

**One honest scare, and its resolution.** On my *first* two runs — in a normal
Chrome with browser extensions loaded and the automation attached — the tour's
DKR beat came up as **bare tan ground with the football field floating in an
empty plain and no stadium at all.** That frame would have been a disaster on
tape. On a clean browser I could not reproduce it in a full 22-frame run: `t09`
and `t10` both show a properly built stadium and a dense city. **The difference
was not the app, it was the browser** — the extension-loaded Chrome took **45–66
seconds** to finish loading; the clean one took **8–17 seconds**. See item 4.

---

# RANKED — most likely to embarrass him, worst first

### 1. The app still downgrades its own graphics if you forget the flag
**AVOIDABLE.** Picture: `shots/rehearsal/flag-plain2.png` (plain URL, came back
on Performance).
A plain load runs a probe that decides your machine is slow and permanently
switches the app to Performance — softer image, no sun flare, no contact
shadows, half the view distance. It happened on one of my two plain loads this
morning. **How to avoid: `?preset=cinematic` on every URL.** It also has to be on
*every* URL, because the flag deliberately does not save itself to the machine.

### 2. Eye level is still the weakest thing in the app
**AVOIDABLE.** Pictures: `shots/rehearsal/SOUTHMALL-eyelevel-day2.png`,
`shots/rehearsal/GUAD-eye-day.png`.
Standing on the South Mall the Tower reads fine and the grass now has real
grain — but the oaks are **stacked blocky slabs with hard tiers** and they form a
wall across the middle of the frame, and the building wall on the right is the
**vertical stripe** (known, confirmed, refused as geometry — the second picture
is that stripe filling an entire frame). **How to avoid: do not put
walking-height footage in this video.** The app's strength is 100–350 m.

### 3. The very wide has a hard line drawn across the sky
**AVOIDABLE.** Picture: `shots/rehearsal/H4-city.png`.
From high up there is a **straight horizontal seam running the full width of the
frame** where the haze band stops, and everything past the middle distance is one
flat tan carpet in a single orange tone. It is the weakest of the five heroes.
**How to avoid: don't hold a high wide. Two seconds, then cut.**

### 4. A slow browser can put bare ground under the opening flight
**AVOIDABLE, and this is the one to act on before coffee.**
Pictures: the bare-ground frames are described above; the clean run is
`shots/rehearsal/tour/t09.png` and `t10.png`.
On an extension-loaded browser the load screen sat for **45–66 seconds** and the
first seconds after it lifted were **flat tan ground with no buildings**. On a
clean browser: **8–17 seconds and never bare.** **How to avoid: record in a fresh
Chrome profile (or incognito) with every other app closed, and start the capture
with the tab already loaded.**

### 5. Pressing `R` does not give you the frame the old brief promises
**AVOIDABLE.** Picture: `shots/rehearsal/H1-spawn.png` — this *is* the shot, and
it is excellent: Tower cream with orange clock faces low-left, Main Mall, sun
centred on the horizon, downtown far left, red tile roofs everywhere.
But home faces **west-south-west**, and **how much of it you get depends on the
shape of your window** — in a short, wide window the Tower falls out of the
bottom of the frame entirely, which is what happened on two of my runs.
**How to avoid: after `R`, look at the screen and confirm the Tower is actually
in shot before you roll.**

### 6. DKR is still the weakest landmark
**UNAVOIDABLE as a hero shot; AVOIDABLE as a problem.** Picture:
`shots/rehearsal/H5-dkr.png` — from the north-east half the frame is bare
east-Austin with no buildings in it.
**How to avoid: show DKR only the way the tour shows it** (from the west, middle
distance, campus in the foreground — `tour/t09.png`, `t10.png`, where it reads as
a proper stadium bowl). Do not fly into the bowl and do not shoot it from the
east.

### 7. The vertical stripe on close walls — confirmed, exactly where we thought
**AVOIDABLE.** Picture: `shots/rehearsal/GUAD-eye-day.png`.
Horizontal banding is fixed and the storey bands read as floors from altitude.
The **vertical** stripe is still there and is only visible close up. Refused as
geometry on purpose; real windows are weeks of work. **How to avoid: stay above
~80 m and it is invisible.**

### 8. A soft flare ring sits in the middle of a lot of golden-hour frames
**Effectively UNAVOIDABLE in clip mode.** Visible in `tour/t02.png`,
`H1-spawn.png` and most sunset frames as a faint circle low-centre.
It is subtle at video bitrates and I would not hold up the shoot for it. The
slider that kills it lives in the `G` panel, which clip mode hides.

### 9. A blank tan lot lands in the corner of the arrival frame
**AVOIDABLE.** Picture: `shots/rehearsal/tour/t05.png` — bottom-left ~15% of that
frame is one empty tan plane beside Dobie. It is in the tour and it goes by in
about two seconds. Nothing to do; just know it is there.

### 10. The night Tower's base goes near-black, and there is a stray blue light
**AVOIDABLE.** Picture: `shots/rehearsal/TOWER-night-night.png` — which is
otherwise **gorgeous**, and is still the best night beat in the app: burnt-orange
lit shaft, lit windows across the whole city, stars. The Main Building under it
is almost pure black and there is one small blue-white dot on the ground
left-of-centre. **How to avoid: frame the top two-thirds.**

### 11. If you film the walking feature, the labels come back
**AVOIDABLE.** Picture: `shots/rehearsal/flag-walkon2.png`.
`?walk=1` needs the interface, so it cannot be combined with `?clip=1`, and with
the interface come the building names — one of which ("Moody Bank Tower") clips
at the left edge of that frame. The panel itself is clean and its captions are
honest ("Campus paths from OpenStreetMap, 30 July 2026", "We can't route inside
buildings", "Not affiliated with UT Austin").
**Confirmed: a normal visitor sees none of it.** On a plain URL there are
**zero** walking elements in the page at all — not hidden, not present.

### 12. 63 buildings still say "not walkable in this build yet"
**UNAVOIDABLE.** Read off the live data file this morning:
**135 routable of 198 in the register.** **How to avoid the awkward moment: type
a building you have already tried** before the camera is on.

---

## The shots I took, and where they are

All in `shots/rehearsal/`, all from the live site at cinematic, chrome-free.

| file | what it is | verdict |
|---|---|---|
| `H1-spawn.png` | home, sunset, Tower low-left | **the postcard** |
| `H2-drag.png` | Guadalupe down the middle, downtown on the horizon | **strong** |
| `H3-tower.png` | campus wide with the Tower | fine, Tower too small — get closer |
| `H4-city.png` | the very wide | weakest — sky seam, flat tan |
| `H5-dkr.png` | DKR from the north-east | **don't use this angle** |
| `CRUISE-crest-day.png` | downtown towers in the foreground, campus beyond | good cruise frame |
| `TOWER-night-night.png` | the night Tower | **best night frame** |
| `SOUTHMALL-eye-day.png` / `-eyelevel-day2.png` | South Mall at eye level, day | blocky trees, striped walls |
| `SOUTHMALL-eye-night.png` | South Mall at eye level, night | not for the video |
| `GUAD-eye-day.png` / `-night.png` | the vertical stripe, full frame | evidence, not footage |
| `GUAD-street-day2.png` | the Drag from above the shopfronts | usable |
| `tour/t00…t21.png` | the whole 60-second tour | **all keepers; `t12` is the best** |
| `flag-*.png` | one frame per URL flag, as proof | — |

---

## What this pass did NOT establish — read this before you trust the rest

*(The first two entries are the rehearsal's. Both were answered by the second
pass on 2026-08-17 — see **TIMING, MEASURED** above. They are kept, struck
through, so the record shows what was open and what closed it.)*

* ~~**No frame-rate number was taken, anywhere.** Nothing here says the app is
  fast, and **`cinematic` was not benchmarked.** If it stutters on his machine,
  `?preset=balanced` is the same flag with one word changed.~~ **ANSWERED, and
  the fallback was wrong:** cinematic runs at ~28 fps and balanced runs no better
  on the tour. Keep cinematic, record at 30 fps.
* ~~**The 45–66 second load is one browser, with extensions, with automation
  attached.** The clean number is 8–17 s and I did not take a minimum of
  interleaved reps for either.~~ **ANSWERED, and the diagnosis was wrong:** a
  clean profile with no extensions reproduced 57 s on a busy machine. The
  variable is machine load, not extensions. Clean minimum 10.4 s.
* **Real iOS Safari was not tested and cannot be tested from here.** Nothing in
  this document predicts his phone. The tour was never watched at phone width
  either.
* **DKR's south end — the two stacked front doors — was never photographed.**
  It is assumed still there, visible only up close at that one corner.
* **The plain, no-flags opening flight was not watched end to end** on a clean
  browser. Only the tour was.
* **The walking feature was opened, not driven.** I confirmed the panel appears,
  prefills, and carries honest captions; I did not type a building and walk a
  route.
* **One browser, one Windows machine, a real GPU, and siblings running on the
  same box the whole time.**

### And what the SECOND pass (timing) did not establish

* **The tour has never been watched as an exported video file.** The frame-rate
  section is arrival times. Whether 46%-on-time reads as "cinematic" or as
  "juddery" on a finished 30 fps encode is an eye question, not a number
  question, and nobody has looked.
* **The screen recorder's own cost was not measured.** Every frame time here is
  the app alone. OBS or Game Bar capturing 1080p sits on top of it.
* **`balanced` never got a quiet rep at cruise altitude** — every attempt landed
  on a machine at 90%+ CPU. Its cruise number is the one hole in the table.
* **The machine was never quiet.** Two sibling verification suites held the CPU
  between 80% and 100% for most of the night. The medians were stable from 2% to
  96% CPU, which is the evidence that the frame-rate finding is GPU-bound and
  real — but a genuinely idle machine was never available and every number here
  is therefore a floor, not a ceiling.
* **The walking route was still never driven**, the plain no-flags opening flight
  was still never watched end to end, and nothing about the phone changed. Those
  three gaps from the rehearsal are still open.

---

## If he only does one thing before coffee

**Close everything else on the laptop, open a fresh Chrome profile, and paste
`https://flyover-utx.vercel.app/?clip=1&tour=1&preset=cinematic` — if the ground
and the buildings are there within about fifteen seconds, everything in this
document holds and he can roll.** (Measured: 10.4 s on a quiet machine, 57 s on
a busy one, and the buildings were there either way. The order of that sentence
is deliberate — *closing things* is the part that buys the fifteen seconds, not
the fresh profile.)

**And set the recorder to 30 fps before the first take.** That is the one thing
in this document that cannot be fixed after the fact.

---

*Rehearsal pass 2026-08-17: read-only, no app file written.*

*Second pass (timing) 2026-08-17, Acer lane: also read-only. **No app file was
changed and nothing was merged into the site.** Everything was driven from a
throwaway worktree off `origin/main`; the five measurement scripts it used
(`aws-fps`, `aws-cost`, `aws-load`, `aws-hist`, `aws-chart`, `aws-preset-override`)
lived in that worktree and went with it. The only things this pass added to the
repository are the timing sections above and the three frames in `shots/gaps/`.*

*One housekeeping note for whoever reads this next: the `shots/rehearsal/`
pictures referenced throughout the rehearsal sections are **on the Acer's disk
and were never committed.** This file was untracked too until the timing pass
committed it. If you are reading this on another machine, the rehearsal's image
links will not resolve; the three in `shots/gaps/` will.*
