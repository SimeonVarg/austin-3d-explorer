# The first fifteen seconds, and what it's like on a phone

Read-only audit of **https://flyover-utx.vercel.app/** (the live site, not
localhost), 2026-08-06, ahead of the AWS screen recording. **Nothing was
changed.** Every defect below is written down, not fixed.

## What the instrument is, and what it is not

* **Chromium (Chrome via `scripts/verify/chrome.mjs`), headed, real GPU** —
  `ANGLE (NVIDIA GeForce RTX 3050 Ti Laptop, D3D11)`, anti-throttling flags on,
  `bringToFront()` before every run.
* **"Phone" = Chromium device emulation**, Playwright's `iPhone 14 Pro` profile:
  viewport **393 × 852 CSS px, devicePixelRatio 3** (a 1179 × 2556 framebuffer),
  `isMobile`, `hasTouch`, and the iOS Safari user-agent string.
* **> REAL iOS SAFARI IS UNTESTED, AND CANNOT BE TESTED FROM HERE.** Emulated
  mobile is Blink on a laptop GPU with a spoofed UA. It is not WebKit. It does
  not share iOS's WebGL context limits, its ~1 GB per-tab memory ceiling, its
  canvas/texture handling, or its thermal throttling — and a 3.0-megapixel
  framebuffer on a phone SoC is exactly where those bite. Treat every fps number
  below as "Blink on an RTX 3050 Ti pretending to be a phone-shaped window".
  Nothing here predicts his actual iPhone.
* **Desktop** = 1440 × 900, dpr 1.
* Timings are the **minimum of interleaved reps** (5 mobile / 4 desktop clean
  runs, mobile-desktop-mobile-desktop…), never a single reading.
* **The graphics auto-detect probe was deliberately LEFT RUNNING** for every
  first-impression run — it is part of what a visitor sees. It was cancelled
  only in the controls tests below, and that is said in place.
* No page errors, no dialogs and no downloads occurred in any run.

Frames live in `shots/aws/`.

---

# Q1 — the first fifteen seconds

## The short version

| | phone (emulated) | desktop |
|---|---|---|
| white screen before anything paints | **0.83 s** | **0.51 s** |
| dark title screen holds until | **8.0 s** | **8.2 s** |
| camera flies | 8.0 → 20.9 s | 8.2 → 21.2 s |
| still hero frame on the UT Tower | **~21 s** | **~21 s** |

## Is there a white void? Yes, but it's short — unless the wifi is bad

`performance` paint entries, min of reps:

* **phone, good connection: 832 ms** (reps 832 / 852 / 868 / 888 / 924)
* **desktop, good connection: 512 ms**
* **phone, 4× CPU throttle: 1,744 ms**
* **phone, 2 Mbps / 300 ms RTT ("hotel wifi"): 4,324 ms** — four and a third
  seconds of blank white, one rep

The cause is in `index.html`: the page's own `style.css` (which carries the
`background:#1a1208` and the dark `#veil`) is the **fourth** render-blocking
resource in `<head>`, behind `maplibre-gl.css`, `maplibre-gl.js` and
`pmtiles.js` — all three from **unpkg.com**, a third-party CDN. Until unpkg
answers, the screen is the browser's default white. On a good line that is
under a second and reads as a normal page load. On bad wifi it is a four-second
white hole at the top of the recording.

**For the recording:** start capture with the tab already loaded, or accept
~0.8 s of white. Do not record a first load on venue wifi.

## The load screen (0.8 s → 8 s) is the best-looking part of the app

`shots/aws/m1-00.5s.png`, `m1-0001s.png`, `m1-0003s.png`

Dark brown, hand-drawn skyline with the UT Tower and the Capitol in it, "AUSTIN
3D EXPLORER", "THE UNIVERSITY OF TEXAS AT AUSTIN, MODELLED AND FLYABLE", a real
progress rail, real stage text ("READING THE CITY" → "TILING THE CITY — 28 OF 29
LAYERS READY" → "WELCOME TO AUSTIN 100%"), and **"BUILT BY / Simeon Varghese"**
pinned at the foot. It animates smoothly the whole time. No complaints.

## Does the graphics toast land on the hero shot? YES, on desktop. Picture: `shots/aws/d-toast.png`

**It fired in 3 of 4 desktop runs**, at **25.6 s → 28.2 s** (a 2.5 s hold), a
435 × 33 px black pill parked at x=503, y=789 of a 1440 × 900 frame — dead
centre, lower third, straight over the city. It says:

> **28 fps measured — switched to the Performance preset. Press G to change.**

That is **4.4 seconds after the intro settles**, i.e. exactly when a recording
would be sitting on the finished hero frame. It also silently **changes the look
of the app mid-shot** (Balanced → Performance).

On the emulated phone at full speed it measured 45 fps and stayed on Balanced —
no toast in 5 runs. Force a weak device (4× CPU) and it fires there too:
**"5 fps measured — switched to the Performance preset. Press G to change."**,
and the pill measures **362 × 33 px pinned 66 px from the top of a 393 px-wide
screen** — 92% of the screen width, right under the title. The same sentence
measured **435 px** on desktop, and the CSS is `white-space:nowrap` with
`max-width:92vw`, so **on a phone the sentence does not fit its own pill.**
(I could not photograph the mobile toast: on a 4×-throttled page the screenshot
itself takes longer than the toast's 2.6 s hold. The geometry above is read off
the live element, not guessed.)

**For the recording:** press **G** and pick a preset before you hit record, or
call `window.cancelGraphicsAutoDetect()` in the console. Also note the chosen
preset is written to `localStorage` (`js/graphics.js` `save()`), so **take 2 may
not look like take 1** — that part is read from the code, not measured.

## Does the intro fly a path, or dolly in place? It flies. Genuinely.

Three poses, two eased legs, ~12.6 s (`js/app.js` `INTRO`):

* **start** — low on Congress Avenue, downtown, looking north, zoom 16.2,
  pitch 78
* **crest** — pulled back over the Capitol, 6.0 s, cosine ease
* **end** — the UT Tower centred over the South Mall, 6.6 s, cubic ease

Verified from the map's own pose, not by eye: it lands on
`[-97.7394, 30.2836] z16.9 pitch 72 bearing 2`, eye altitude **131 m** (phone) /
**138 m** (desktop), `easing:false` from ~21 s. **It ends on the UT Tower.**
Hour of day is the default sunset — magenta-to-orange sky, long warm light.
`shots/aws/slow-0045s.png` is the final framing; `d-toast.png` is the same thing
on desktop.

It is a real flight, not a dolly. It reads well.

## Does the loading screen finish before the city is there? IT DEPENDS, AND THIS IS THE BIG ONE

The app reports this itself (`window.__intro`), so this is its own verdict, not mine.

| condition | why the veil lifted | sources still missing at lift | verdict |
|---|---|---|---|
| phone, normal (5 runs) | `idle` at 5.4–5.5 s | none | city is there |
| desktop, normal (4 runs) | `idle` at 5.6–6.6 s | none | city is there |
| phone, 2 Mbps / 300 ms wifi | `gate` at 15.0 s | none | city is there — the gate waited, correctly |
| **desktop & phone, 4× CPU throttle** | **`ceiling` at 18.9–21.2 s** | **`austin-outer`, `austin-buildings`, `austin-roads`** | **EMPTY LAND** |

**`shots/aws/cpu4b-0019s.png` is the picture of his complaint.** Under a 4× CPU
throttle — which is what "laptop running Claude and a pile of Chrome tabs" looks
like — the loading screen finishes and the bottom two-thirds of the frame is
**bare tan ground with road stripes and no buildings at all.** Only the distant
Capitol and campus have anything on them. `m-toast.png` shows the same thing
again at 30 s.

So: the opening-frame gate **works for a slow network and does not save you from
a slow CPU.** The 18 s hard ceiling fires, the veil lifts anyway, and the city
under the camera is not built. On the reference machine, unloaded, this never
happened in 9 runs.

**For the recording: close everything else first.** That is the whole mitigation
available today.

---

# Q4 — phone reality

## Frames per second

`requestAnimationFrame` deltas collected in-page, min of interleaved reps.
The rAF ceiling on this machine is **18.0 ms (55.6 fps)** — that is the display,
not the app, and nothing beats it.

| what | phone (emulated) | desktop 1440×900 |
|---|---|---|
| still camera, nothing happening | 18.0 ms · **55.6 fps** | 18.0 ms · **55.6 fps** |
| **during the intro flight** | 21.8 ms · **45.9 fps** (min of 5; ~57 of 490 frames over 33 ms) | 28.2 ms · **35.5 fps** (min of 4; 85–115 of ~375 dropped) |
| **free-flying** (joystick held 6 s, 3 reps) | 18.6 ms · **53.8 fps** (worst rep 22.2 ms · 45 fps) | not measured |
| **day/night ▶ playing** | 639.7 ms · **1.6 fps** | 448.7 ms · **2.2 fps** |
| **dragging the time slider** | 329.6 ms · **3.0 fps** | 279.3 ms · **3.6 fps** |

Flying is fine. The clock is not — see below.

## Total load

Wire bytes (Playwright `request.sizes()`, fresh profile so nothing is cached),
first 30 s:

* **phone: 7.00 MB over 204 requests** — 5.25 MB the app itself, 1.46 MB the
  OpenFreeMap basemap, 0.28 MB unpkg
* **desktop: 8.72 MB over 285 requests** (a bigger viewport pulls more tiles)

Time to a city you can fly: **8.0 s** to a populated frame, **~21 s** to a
finished, still hero shot. (You can take control at any moment — any input
cancels the flight and jumps to the end pose.)

## Hotel wifi (2 Mbps down, 300 ms RTT, CDP `emulateNetworkConditions`)

One rep, phone:

* 4.3 s of white
* load screen from 4.3 s to ~19.3 s — **15 s of title card**
* the gate did its job: `reason: gate`, nothing missing at lift, city fully
  there when the flight departs
* the graphics toast fired at 23.4 s, **over the flight this time**
* same 7.0 MB total

A visitor on bad wifi sees a long, well-designed title card and then a correct
city. That is the right failure mode. The 4.3 s of white before the title card
is the ugly part.

## Safe to touch while recording

* **The joystick / WASD, swipe-to-look, BOOST** — 53.8 fps, no stalls.
* **P (desktop)** — hides every bit of UI chrome for a clean frame, toggles back,
  no reload. This is the best key on the keyboard for a recording.
* **Tapping empty scene or a building** — verified: pose unchanged, nothing happens.

## DO NOT TOUCH

1. **The ▶ day/night play button.** **1.6 fps on the phone, 2.2 fps on desktop**,
   measured twice each. It is a slideshow. `js/timeofday.js` re-tints the whole
   scene on every animation frame. Worse: while it runs, the automation driver
   **timed out twice at 30 s trying to click the same button again to stop it** —
   the main thread is too busy to service the click reliably. It also made a
   screenshot time out at 120 s. If he taps this on tape, the recording is ruined
   and hard to recover from.
2. **Dragging the time-of-day slider.** 3.0 fps phone / 3.6 fps desktop while
   dragging. The night result is lovely (`shots/aws/m-todnight.png`) — the
   journey there is not. If night is wanted, set it before recording.
3. **The speech-bubble button (top right).** Opens a feedback form over **47% of
   the phone screen**, 684 ms stall to open, and it **focuses the textarea** —
   on a real phone that pops the keyboard.
4. **The sun/gear button (top right).** Graphics panel covers **70% of the phone
   screen** (`shots/aws/t-tap-gfx-button.png`), 126 ms stall opening, 281 ms
   closing. It's a good-looking panel; it is also the "yap" he's complained about,
   and it is a lot of screen.
5. **"Smooth edges" inside that panel.** It arms a **"Reload to apply"** button
   that calls `location.reload()` — a fresh ~21 s load, on tape.
6. **R (desktop)** — resets the camera home, instantly.
7. **Any tap or key in the first 21 s** — cancels the intro flight and jumps
   straight to the end pose. If the flight is wanted on tape, hands off.

**Not tested, so not claimed:** tapping a landmark label (the slow orbit) — my
scene tap didn't land on one; **T** (the tour); the two-finger altitude gesture;
the BOOST button in isolation.

---

## Smaller things I saw and did not fix

* **Labels get clipped at both edges in portrait.** "Westgate Tower" reads
  "stgate Tower", "21 Rio" reads "Rio", and on the right the time-of-day pill
  sits on top of "Graduate School of Business", "University Teaching Center" and
  "Geo…". Visible in `m1-0015s.png`, `slow-0045s.png`, `m-todnight.png`.
* **The desktop hero frame carries ~17 labels at once** (`d-toast.png`). It reads
  as busy.
* **Portrait spends the top ~25% of the frame on empty sky** at the intro's end
  pose. Pretty, but it's a quarter of a phone screen.
* **Facade texture is inconsistent downtown** — in `m1-0008s.png` some towers
  carry the teal window grid and their neighbours are plain tan boxes. Not a
  bug I can name; it is what the eye lands on first in that frame.

## What I could not establish

* **Anything about real iOS Safari.** See the instrument note at the top.
* **A photograph of the mobile graphics toast** — the screenshot outlives the
  toast on a throttled page. Geometry and text were read off the live element.
* **Whether the preset really persists between visits** — the `localStorage`
  write is in the code; every run here used a fresh profile, so it was never
  observed.
* **Whether the empty-land failure happens on Simeon's actual machine.** It was
  reproduced with a 4× CPU throttle, which is an emulation of "busy laptop", not
  a measurement of his.
* **`querySourceFeatures` reported 0 features for `austin-outer` and
  `austin-roads` in every run.** Those are vector (PMTiles) sources and the call
  needs a `sourceLayer`; the zero is my instrument, not a missing layer. Do not
  read it as a defect.
</content>
