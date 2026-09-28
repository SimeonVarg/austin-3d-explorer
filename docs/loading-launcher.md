# Loading screen and mode launcher

The loading screen's art is an inline vector drawing in a Monument Valley style: the UT Tower lit orange over the Main Building and South Mall on floating islands, with a West Campus apartment island and downtown floating nearby. The owner approved this drawing and every word of the loading screen and launcher on 2026-09-28. No raster assets, video, extra requests or scene geometry are added. Colours, typography and layout tokens are at the end of style.css. In js/loader.js, COPY at the top holds every loading-screen and launcher string, ART below it holds the drawing's colours and animation timings (each becomes a CSS variable on the SVG), and TUNE holds the progress weights and the slow-load thresholds.

The bar reports completed work rather than elapsed time. Its shares are map/style/tiles (20), parsed data (20), authored buildings (45), rendered lighting (5), and final reveal (10). These are work weights, not a claim that every file or building takes the same time. Building counts come from the actual loaded catalogue and completed model names. Final completion additionally checks readyToReveal(), including the visible replacement handoff. Data failures and an unfinished walking graph cannot report completion. Walking is optional and reports its real state only when requested. The app's existing reveal deadlines remain; an incomplete reveal is labelled on the persistent mode button rather than relabelled 100%. No timed percentage floor remains. The bar never slides back: the raw reading dips when the app discovers more data files mid-load and when the opening camera re-requests map tiles under the veil (measured 2026-09-28: 20% down to 3% early on, and 90% down to 80% for the last 12 s before reveal), so the bar and percentage hold the highest reading while the stage list shows the real state ("drawing streets", "64 / 65 files"). `window.__loading.history` keeps both `percent` (raw) and `shown`. Main-thread blocks can pause the numerical readings; the drawing's small pulses (halo, stars, fountain glint, path) are CSS opacity only and stop under reduced motion. The time line under the bar promises no duration: it counts elapsed seconds, and after 40 s on desktop or 50 s on a phone it switches to the slow phrasing.

The launcher ("Where to?") is available while loading and afterward through the Switch modes pill, including in photo modes. It uses a native modal dialog with labelled radios, settings, keyboard focus, Escape and focus restoration. Launching reloads with mutually exclusive mode flags cleared; the page tells the user about the reload. Lighting and graphics can be retained or explicitly selected. WAYFIND.on remains false.

## Mode inventory

- Free roam: normal city flight, touch navigation and existing landmark Explore panel.
- Apartment hunt (beta), livehere=1: existing apartment comparison against classes, weekly walks and street previews. Apartment finder is already included in this checkout.
- Campus tour, tour=1 / T: authored flight through the Drag, South Mall, Tower and DKR.
- Autopilot, autopilot=1: automatic route with takeover controls.
- Day to night, timelapse=1: moving tour with changing sunlight.
- Sunset spot, sliderdemo=1: parked campus view progressing from sunset to night.
- Photo mode, clip=1&drive=1 / P: clean scene view retaining touch flight controls and a reachable mode launcher.
- Walk to class (beta), walk=1: explicit opt-in walking directions; slash opens search after activation.
- Lighting, p=0/.5/1: daylight, golden hour, night; also adjustable through the existing time slider.
- Graphics, preset=performance/balanced/cinematic/ultra: increasing detail/effects/resolution; each is described in the chooser.
- Other useful existing controls remain in place: automatic small-touch phone profile (lite=1 forces it), no idle orbit (drift=0), landmark arrivals, reset R and normal camera controls. These are preferences/navigation rather than distinct launcher experiences.

Test fixtures, diagnostics, renderer kill switches, recovery modes and harness flags are excluded. Walking and apartment import privacy behavior is unchanged.

## Verification

Sixteen CPU checks in the pipeline work folder execute actual progress and URL construction code, including failures, late handoff, opt-outs and preservation of runtime lighting/settings. Syntax checks for all four changed JavaScript files and harness parity (48 scripts) pass. Browser loads complete all 196 authored buildings and 68 tracked files without JavaScript errors. The launcher opens with eight choices, has no horizontal overflow and closes with Escape. WAYFIND remains off. Existing mode implementations were audited; every complete mode journey was not re-tested.

Measurements use fresh Chromium sessions, hardware ANGLE on AMD Radeon integrated graphics, --force_low_power_gpu, no CPU throttle, cancelled graphics auto-detection and the same city assets. Desktop is 1280 x 800 at DPR 1; phone is 390 x 844 at DPR 1 with touch/mobile emulation, confirmed automatic performance profile, and all authored models retained. Baselines intercept only the five changed source files with their original versions. Runs alternate before/after and release the shared browser queue between sessions. Durations below are the instrumented reveal times, excluding screenshot recording.

- Desktop pair 1: 35.992 s before / 35.094 s after; pair 2: 45.390 / 37.768. Minimum: 35.992 / 35.094.
- Phone pair 1: 54.095 s before / 47.224 s after; pair 2: 35.396 / 51.025; pair 3: 50.103 / 65.656; pair 4: 61.765 / 25.243. Minimum: 35.396 / 25.243.

The first two phone pairs suggested a regression, so two additional interleaved pairs captured browser CPU metrics. Layout plus style took less than 0.4 seconds in each of those four runs. The full four-pair minimum does not show a regression, but the large spread on this shared machine does not establish a speedup. All observations, including the slow ones, remain in task 020-loading/work/*/result.json. The 40 s desktop / 50 s phone slow-load thresholds come from these runs; the screen no longer shows them as a promised duration. The combined loader/CSS source is roughly 7.6 KB smaller; no extra download or scene geometry is introduced.

Final labelled desktop/phone comparisons, launcher image and animated full-load comparison are in task 020-loading/out. The animation samples each complete load into equal ten-second sequences plus a settled hold: it shows progression, not relative speed. Raw frames and helper scripts stay in work. Physical iPhone Safari/Chrome, thermal behavior and device memory remain unverified. The illustration is stylized rather than a photographic rendering; blocked main-thread model construction can still briefly freeze textual progress.
