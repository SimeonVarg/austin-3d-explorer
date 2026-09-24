# The apartment finder ("Where should I live?")

`js/finder.js` (UI, map), `js/finder-core.js` (arithmetic, no DOM), `finder.css`.
A mix of the two designs the owner picked: the finder panel is the first thing a
visitor meets (option A), and the city shows the same answer (option B).

## What a visitor sees

- **During the intro:** only a small "Where should I live?" pill. The flight is
  untouched. When it lands, the panel opens by itself (desktop: left panel;
  phone: a short bottom sheet). Someone who grabs the controls mid-flight keeps
  the pill; someone who closed the finder is not re-opened next visit. All of
  this is `FINDER.firstVisit` in `js/finder.js`.
- **Inputs:** a searchable list of 42 majors, or "Import my class schedule"
  (the app's own importer), and Walk / Bus / Either.
- **Answer:** every home ranked by the average minutes to that student's class
  buildings, as a range (brisk pace and green lights → slow pace and red lights;
  for the bus, a timed bus → one you just missed). Estimated majors say so in
  plain words. Homes that cannot be reached in the chosen mode are counted, not
  hidden.
- **The city:** the ground coloured by minutes (a thin slab on the pavement,
  fading out by walking height), numbered pins in the same colours, list ↔ pin
  hover sync, a fly-to on selection with the walk (or bus + walk) to the top
  three class buildings, and a compare tray for up to three homes.
- Off under `?finder=0`, and under `?clip=1`, `?autopilot=1`, `?timelapse=1`,
  `?tour=1`, `?sliderdemo=1`, `?livehere=1`. `?finder=1` opens it at once;
  `?major=<id>`, `?mode=walk|bus|either`, `?home=<id>` preselect (read only).

## The data (one bake per file, CLAUDE.md rule 1)

| File | Bake | Source (stays out of the repo) |
|---|---|---|
| `data/finder/homes.json` | `scripts/bake_finder_homes.py` | in-repo: `data/apartments/`, `data/walk_graph.json` `wc`; plus the four East Riverside student complexes (OSM landuse centroids, Overpass 2026-09-22) typed in the script |
| `data/finder/major-buildings.json` | `scripts/bake_finder_majors.py SRC_DIR` | `SRC_DIR/course-buildings.json` from `scripts/finder_course_table.py SRC_DIR` (UT Registrar Fall 2026 course PDF, public: https://utexas.box.com/v/UT20269CSpdf) and `SRC_DIR/catalog-plans/` (2026-27 catalog Plan of Study grids, fetched and cached on first run) |
| `data/finder/transit.json` | `scripts/bake_finder_transit.py PATH/capmetro.zip [YYYYMMDD]` | CapMetro GTFS, https://data.texas.gov/dataset/CapMetro-GTFS/r4v4-vz24 (feed 260826_0956, service date 2026-09-30) |

Order: homes → transit (it times the homes marked `bus`). The majors bake is
independent. The shipped tables reproduce the 2026-09-23 research tables exactly
(all 42 majors' weights; all 16 Riverside home × anchor bus times).

East Riverside student evidence (research 2026-09-23): Village at East
Riverside is listed as student housing on UT's off-campus housing site; the
Estates listing mentions the UT shuttle; Town Lake Student Apartments lease by
the room; The Element Austin prices by the bed. The Domain is not included: no
purpose-built student housing was found there.

## The score

See the header of `js/finder-core.js`. In one line: for each class building,
walking minutes off the walking graph's own cost model, or bus minutes (baked
door-to-campus-stop time ± half a headway, plus the graph walk from the stop);
per mode pick walk, bus, or the faster of the two; weight by the major's
building weights or by the student's meetings per week; rank by the midpoint.

## The schedule stays on the device

The import is `js/wayfind.js`'s own, reused through an **import-only** mode:
the finder sets `window.__wayfindImportOnly` and loads `wayfind.js` a second
time, only when a student presses Import or already has a schedule saved. That
installs the store and the egress guard (§12) as the walking feature does, and
nothing else (no router button, sheet, `/` key, URL grammar or day view).
`WAYFIND.on` stays `false`; `?walk=0` vetoes it. The finder reads only building
codes and meeting-day counts, and its only network calls are GETs of the four
static files it names in `FINDER.data`.

## Checks (no browser)

    node scripts/verify/finder-core.mjs     # hand-computed scoring + real-graph cross-check
    node scripts/verify/finder-static.mjs   # schemas, sizes, network scan, switches

## What the browser pass found (2026-09-24, AMD Radeon iGPU, D3D11)

Driven at 1440x900 and 375x812 (phone emulation), 51 scripted checks, all green
at the end. What they caught, so nobody re-learns it:

- **The panel stood open over the whole intro.** `#finder { display: flex }`
  beats the browser's `[hidden]` rule; the CSS now restates `#finder[hidden]`.
  The state said "pill" the whole time; only the screenshot showed it.
- **Selecting a home did not move the camera.** `js/controls.js` takes the
  camera back, and stops any ease, whenever the eye is above its 900 m ceiling.
  The first fly-to aimed 1.5 km up. Targets are now raised in zoom until the
  eye is under `FINDER.fly.maxAltM` (760 m), and flights use `easeTo` (flyTo's
  zoom-out arc climbs through the ceiling). On a narrow phone, where the routes
  cannot fit under the ceiling, the home stays in frame and the routes run off
  toward campus.
- **The first colour ramp was invisible.** Pale gold to amber on the warm tan
  ground: heat on and heat off looked the same. Now green (near) → yellow →
  red → violet (a long bus ride), opacity 0.55. TASTE CALL, one line:
  `FINDER.ramp`.
- **The East Riverside grid coloured Lady Bird Lake.** Its north edge is now
  just south of the shore (`GRID_BBOX` in the transit bake), 200 m cells.
- Far pins stacked on the horizon behind the title bar: pins more than
  `FINDER.pinMaxKm` (3.2 km) from the middle of the view hide.
- Phone: the pill sits under Explore (it was on the hint line); while the sheet
  is up the joystick, BOOST and hint step aside (and the time slider under the
  tall sheet); the compare tray becomes a table inside the sheet; the sheet
  hides while the import screen is up.
- The big panel and the tray have no `backdrop-filter`: behind a 94%-opaque
  surface it is invisible and re-blurs the city every frame.

Frame rate, headless on the AMD chip, 1280x632 at 1.5x, a fixed 6 s camera
sweep, after two warm-up sweeps, order-balanced (open, closed, closed, open):
idle 60 fps either way (the map does not redraw at rest); moving 22.4 and 22.5
fps with the finder open vs 24.8 and 23.7 closed. Of that, the heat layer is
about 1.5 fps and the pins about 0.7 fps (attribution runs).

Network, with the finder open and a schedule imported and deleted: the finder
itself fetched only its three tables and `data/walk_graph.json`; the importer it
brought up added `data/ut_buildings.json` (its building register) and a second
read of the walk graph. All GETs, no request carried schedule text, and
`wayfindStore.guard.state()` reported installed, armed, 30 strings watched.
