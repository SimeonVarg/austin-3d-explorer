# Austin 3D Explorer — Full Handoff

> **Purpose:** This document brings a new AI collaborator (Fable 5) fully up to
> speed on the Austin 3D Explorer project — the vision, what was promised, the
> full journey (including the messy parts), the user's feedback and how it was
> handled, every bug fixed, the current state, and what's next. Read it top to
> bottom before touching anything.

---

## ★ FOR FABLE 5 — your environment, mandate, and first steps

**Read this first.** You are a different setup from the previous agent, and that
changes almost everything.

- **You run on the user's actual desktop computer**, with access to his local
  **projects folder**. The previous agent ran in a locked cloud sandbox that
  **could not open the live site in a browser** — that single limitation caused
  most of the pain in this project (guess-and-ship instead of verify). **You do
  not have that limitation.** Use it.
- **First steps:**
  1. **Read the existing `CLAUDE.md` in the projects folder** (the user keeps one)
     — follow whatever conventions/instructions it sets.
  2. **Create a dedicated folder for this project** inside the projects folder and
     work there (clone `SimeonVarg/austin-3d-explorer` into it).
  3. **Establish your own way to verify what the user actually sees — this is your
     responsibility, not something spelled out for you here.** You're on a real
     desktop: you can open the live URL, run a real browser, use dev tools,
     screenshot, run whatever local server or headless setup you like. Figure out
     a reliable loop and use it *before* claiming any fix works. (See §8 for how
     the previous agent worked around not having this — you can do better.)
- **You have full freedom.** Change the **tech stack, architecture, libraries,
  dependencies, tools, hosting — anything** — if it makes the project better or
  easier to verify. Nothing here is sacred. The MapLibre 4.7.1 / PMTiles / Vercel
  choices were pragmatic, not principled, and they caused real problems (see §7,
  §9). If upgrading MapLibre to v5, switching renderers (e.g. three.js/deck.gl),
  changing hosting, or restructuring the app gets to a **beautiful, accurate,
  flyable West Campus faster — do it.** The more you own end-to-end, the better.
- **The goal is the look and feel**, which the debugging churn kept us from. Get
  the engine confirmed working, then spend your energy making it *beautiful*. 

---

## 0. Who's who / how this project is built

- **The user (Simeon)** is building this **entirely from a phone** using the
  **Kiro iOS app** + GitHub. He does not sit at a desktop for this. Explanations
  should be plain and jargon-light; he has repeatedly (and reasonably) asked to
  "dumb it down."
- **Kiro** is an on-device AI coding agent (iOS). It writes the front-end code
  but is **network-locked** — it *cannot* fetch docs, npm packages, CDNs, or test
  anything live. So it's blind to library-version quirks and can't verify. It's
  good for small, self-contained edits driven from the phone.
- **The AI agent (me / now you, Fable 5)** runs in a cloud dev sandbox with the
  repo, shell, and a headless browser. Used for: debugging, anything needing
  knowledge of library behavior, real-world data, research, and **verification**.
  Pushes directly to `main`.
- **Division of labor that we landed on:** agent does debugging/data/research/
  verification; Kiro does small phone-friendly UI tweaks. **Kiro must `git pull`
  `main` before it edits**, or it will clobber agent commits.

---

## 1. The vision (what the user wants)

A **browser-based, flyable, low-poly but geographically accurate 3D recreation of
the UT Austin area** — UT campus, West Campus ("Wampus" = West Campus slang), The
Drag (Guadalupe St), Speedway. Shareable by link, works on mobile.

What he explicitly cares about, in his words:
- **"A beautiful low poly scene with accurate colors and designs on buildings."**
  Not a gray CAD model, not a Google-Maps-looking street map.
- **Accurate** building placement, heights, and shapes.
- **Signs / logos / text on real buildings** — flying down West Campus and seeing
  "Dobie Twenty21," "The Castilian," etc. at the right spots.
- A **day→night slider** (his idea, combining three looks into one axis): drag
  from daytime → golden hour → night, and as it gets dark the **signs glow**.
- It must work on his **phone** with touch controls.

What this is NOT: not a game engine, not photorealistic, not a native app, not
dependent on paid APIs, not manually 3D-modeled (everything is data-driven), and
not a live-updating map (data is baked into dated snapshots).

---

## 2. What you're looking at RIGHT NOW (current state)

- **Live URL:** https://flyover-utx.vercel.app (Vercel, custom-ish domain).
  Also deployed to GitHub Pages at some point, but Pages was flaky (see §9).
- **Deployment is Vercel via GitHub git integration.** Historically the user has
  sometimes had to manually "Create Deployment"; confirm it auto-deploys on push
  to `main`.
- **A temporary on-screen diagnostics readout** is in the **top-left corner**:
  `loaded:<n>  view:<n>  src:<true/false>  z:<zoom>  err:<count>`. This was added
  so the user can screenshot the app's runtime state (the agent can't load the
  live URL — see §8). **`loaded:` is the real signal** (features in loaded tiles,
  camera-independent); `view:` is queryRenderedFeatures which is view-dependent
  and jumps around for 3D — informational only. **Remove this diag once the user
  confirms buildings render** (`loaded:` ~1482).
- **As of the latest work:** a stack of real bugs was fixed (see §7). The final
  and most stubborn one — buildings appearing only far away / "loading then
  disappearing" — was traced to **Vercel breaking PMTiles byte-range requests**
  and fixed by loading the whole tile file into memory. This was **verified in a
  harness that runs the real app code**: `loaded:1482, view:760, err:0`, dense
  city renders (see `scratchpad` note in §8). **The user was asked to redeploy
  and confirm `loaded:` shows ~1482.** If Fable 5 is picking up here, first thing:
  find out whether that redeploy confirmed the fix.

---

## 3. What was promised vs. delivered (honest ledger)

| Promised | Status |
|---|---|
| Accurate footprints + LiDAR heights | ✅ Delivered. 2,443 buildings, 92% real Overture/LiDAR heights. |
| Every building as a 3D volume at the right spot | ✅ Delivered (data + `fill-extrusion`). |
| Flythrough navigation (desktop + mobile) | ✅ Delivered; had major bugs, now fixed (movement speed, joystick visibility, pinch-zoom). |
| Curated branded signs (names + brand colors) | ✅ Data built: 48 landmarks in `data/signs.json`. Rendering wired; needs live visual confirmation + tuning. |
| Day→night slider with sign glow | ✅ Built (`js/timeofday.js`): day→golden→night keyframes, sign glow ramps up at night, auto-cycle play button. Needs live visual confirmation + palette tuning. |
| Stylized low-poly look (not "Google Maps") | 🟡 Basemap-clutter stripping is built (`cleanupBasemap`), warm palette exists. **Not yet visually confirmed/tuned on the live site** — this is the "fun part" still owed. |
| Terrain / slope (West Campus → Waller Creek) | ⏸️ Built then **disabled** — terrain caused buildings to be culled/float. Deprioritized by the user ("idc about the slope rn"). Revisit later with a draped, non-exaggerated approach. |
| Versioning: date-switcher + "what changed" animation | 🟡 Data foundation done (snapshots + diffs + `manifest.json`); front-end date-switcher/diff-tour code exists (`js/date-switcher.js`, `js/diff-tour.js`) but only one snapshot exists so the picker stays hidden. |

**Bottom line for the user's core ask (a beautiful, accurate, flyable West
Campus with glowing signs):** the *engine and data* are done and (finally)
rendering; the *art/tuning pass* — making it actually look beautiful — has not
really started because rendering bugs ate the time. That's the next chapter.

---

## 4. Tech stack & architecture

- **MapLibre GL JS 4.7.1** (loaded from unpkg CDN in `index.html`) — WebGL map,
  3D `fill-extrusion` buildings, camera. **Version matters** (see the v5-only
  property bug in §7).
- **PMTiles 3.2.1** (unpkg) — single-file vector tile archive of the buildings.
- **OpenFreeMap "liberty"** style (`https://tiles.openfreemap.org/styles/liberty`)
  — the base street map + **glyphs/fonts** (fonts matter — see §7 glyph note).
  Most of its layers are stripped at runtime by `cleanupBasemap`.
- **Three.js** — mentioned in the plan for custom sign/logo billboards but **not
  actually used yet**; signs are currently MapLibre `symbol` layers.
- **Hosting:** Vercel (primary), GitHub Pages (set up, flaky).
- **No build step** — plain static HTML/CSS/JS. Deploys by serving repo root.

### Front-end files (`/`, `/js`)
- `index.html` — loads libs, defines the DOM (map, HUD, joystick, time-of-day
  slider, date panel, diff banner, debug panel, **diag readout**), includes the
  js modules.
- `style.css` — all styling. Note: mobile detection is **width-based**
  (`max-width:1024px`), NOT `(hover/pointer)` media queries (that bug hid the
  joystick — see §7).
- `js/app.js` — **main entry**. Loads `data/manifest.json`, registers the PMTiles
  archive **into memory** (the Vercel fix), creates the map, adds building layers,
  wires everything, runs the diagnostics readout. Camera **SPAWN** is set here.
- `js/controls.js` — flythrough. Desktop: WASD/arrows/Q-E + drag-look. Mobile:
  left **joystick** to move, right-half **swipe** to look, two-finger **pinch**
  to zoom. Movement speed is zoom-scaled.
- `js/signs.js` — curated branded landmark signs from `data/signs.json`
  (`signs-glow` colored halo underlay + `signs-label` white text). Glow opacity
  is driven by the time-of-day value.
- `js/timeofday.js` — the day→night system. `cleanupBasemap(map)` strips the
  OpenFreeMap clutter; `applyTimeOfDay(map, p)` interpolates sky/light/building
  colors/ground/sign-glow between DAY(0)→GOLDEN(0.5)→NIGHT(1); slider + auto-cycle
  UI. (Note: `map.setSky` is a **no-op in v4.7.1** — sky gradient isn't actually
  applied at this MapLibre version; light + colors do apply.)
- `js/date-switcher.js` — snapshot date dropdown (hidden while only 1 snapshot).
- `js/diff-tour.js` — "what changed" fly-to-and-animate mode (future-facing).

### Data files (`/data`)
- `data/manifest.json` — `{ snapshots:[...], latest, diffs:[...] }`. The app reads
  `latest` and loads that snapshot. **Don't hardcode dates.**
- `data/snapshots/2026-07-10/austin.pmtiles` — the baked buildings (~0.6 MB,
  2,443 buildings). Also `.geojson` + `.enriched.geojson` alongside.
- `data/signs.json` — 48 curated landmark signs: `{ label, category
  (landmark|apartment|food), color (brand hex), height, priority }` with real
  coordinates pulled from the baked data.

### Data pipeline (`/scripts`, `/.github/workflows`)
- Runs **in a GitHub Action** (`.github/workflows/build-data.yml`) triggered from
  the phone (Actions → Run workflow). Steps: extract Overture buildings for the
  bbox (DuckDB) → enrich (height fallback chain + OSM names via Overpass + manual
  `hero_overrides.json`) → tile to PMTiles (tippecanoe) → diff vs previous
  snapshot → update manifest → commit back to the repo.
- `scripts/config.sh` — bbox (UT + West Campus + The Drag) + `OVERTURE_RELEASE`
  (auto-detects latest).
- Height accuracy: Overture LiDAR → OSM `height` → OSM `building:levels`×3.2 →
  Overture floors → class default. Each building tagged with `source_height`.
- Full rationale in `RESEARCH.md`; overall plan in `PLAN.md`.

---

## 5. The bounding box & spawn

- **Bbox:** `min_lon -97.752, min_lat 30.276, max_lon -97.726, max_lat 30.296`
  (UT core + West Campus + The Drag).
- **Spawn** (`SPAWN` in `app.js`): `center [-97.7434, 30.2857], zoom 16.5,
  pitch 60, bearing 90` — placed inside the West Campus tower cluster (Dobie,
  Castilian, Skyloft, Moontower, Ion nearby), looking east toward campus.

---

## 6. The journey — how we got here (chronological)

1. **Planning review.** The repo started as just `PLAN.md`. The agent researched
   and added `RESEARCH.md` (accuracy strategy: Overture LiDAR heights over OSM
   levels; pre-baked dated snapshots; no manual modeling; terrain; tightened
   scope) and a **phone-triggerable GitHub Action data pipeline**.
2. **User feedback:** wanted *no live updates* (baked snapshots + a future
   date-switch/before-after animation) and *no manual 3D modeling* (data-driven
   only). The plan + pipeline were reworked to match (dated snapshots, diffs,
   `manifest.json`; `hero_overrides.json` as plain-data corrections).
3. **Ran the pipeline.** Several Action failures, each fixed (Overture release
   auto-detect, DuckDB geometry type, first-run commit path). Result: **2,443
   buildings, 92% real LiDAR heights** — a strong, accurate dataset.
4. **Kiro built Phase 1** (the flythrough app) in a PR; agent merged it to `main`
   after confirming it carried the real data. (Repo default branch was
   `add-plan`; work now lives on `main`.)
5. **Deploy struggles:** GitHub Pages env protection, then Vercel. Got a live URL.
6. **Visual reality check.** The user pointed out it looked like a "Google Maps
   preview," not the promised beautiful low-poly scene, and that signs/logos were
   missing. Agent explained the gap honestly (the art layer wasn't built) and
   proposed the **one day→night slider** concept; user chose "do all of it."
7. **Styling + signs built** (`timeofday.js`, `signs.js`, `cleanupBasemap`, 48
   curated signs). **Then a long, painful debugging stretch** on rendering bugs
   (see §7): buildings vanishing, only far buildings showing, movement dead on
   mobile, no joystick. Multiple fixes missed the mark before the root causes
   were nailed with a proper harness.
8. **The verification breakthrough** (see §8): the agent built a harness that runs
   the *real app code* locally and screenshots it, then reproduced Vercel's exact
   tile-serving failure and proved the fix. Buildings render (`loaded:1482`).

---

## 7. Every bug fixed (technical, with root causes)

1. **Overture release placeholder** — pipeline pointed at a non-existent release
   date. Fixed: auto-detect the latest release from the public bucket.
2. **DuckDB geometry type** — current Overture serves `GEOMETRY` (not WKB blob);
   `ST_GeomFromWKB` errored. Fixed: pass geometry straight through.
3. **First-run commit** — pipeline staged `data/diffs` which doesn't exist on the
   first run. Fixed: stage the whole `data` dir.
4. **Terrain source** — Kiro used `demotiles.maplibre.org` (a demo endpoint with
   **no Austin coverage**), so terrain silently did nothing. Switched to AWS
   Terrarium tiles. **Then terrain was disabled entirely** because terrain + sky +
   3D extrusions culled the buildings and made them float on slopes. Slope is
   deprioritized; revisit later.
5. **Buildings never rendered (the big one):** `buildings-3d` used
   `fill-extrusion-ambient-occlusion-intensity`/`-radius`, which are **MapLibre
   v5-only**. The app loads **v4.7.1**, where those are invalid, so `addLayer`
   rejected the whole layer — **our buildings never rendered at all**; the gray
   ones on screen were OpenFreeMap's own. Fixed: removed them, used
   `fill-extrusion-vertical-gradient`. (This is also why it looked like Google
   Maps — our palette was never on screen.)
6. **Mobile movement dead** — `MOVE_SPEED` was ~300× too fast (~13 km/s); any
   joystick nudge flung the camera into empty land. Fixed: sane, zoom-scaled speed.
   User asked to keep it slow-ish for now.
7. **No joystick on mobile** — joystick + mobile hint were gated on
   `@media (hover:none) and (pointer:coarse)`, which mis-detects iPhones
   (especially "Request Desktop Website"). Fixed: **width-based** media query,
   joystick visible by default.
8. **Pinch-to-zoom** added (two-finger), single-finger look suppressed while
   pinching.
9. **Basemap gray-building flash** — the basemap's own buildings flashed before
   being hidden. Fixed: run `cleanupBasemap` on `styledata` (before first paint).
10. **Vercel breaks PMTiles (the final root cause of "buildings only far away /
    load then disappear"):** Vercel serves the `.pmtiles` file **Brotli-compressed
    with no byte-range support** (`content-encoding: br`, no `accept-ranges`).
    PMTiles reads tiles via HTTP byte-ranges, so only coarse far tiles loaded and
    the source flapped. **Fixed: download the whole ~0.6 MB archive once and read
    tiles from an in-memory `FileSource`** — no range requests, host-agnostic.
    Proven: against a Vercel-mimicking server, range-based rendered 0 buildings,
    in-memory rendered 238; full app in harness = `loaded:1482, err:0`.
11. **Diagnostics readout** added (temporary) so the deployed app self-reports.
12. **[Fable 5, July 10] Buildings STILL didn't render live after #10 — missing
    fonts killed every tile.** Both sign layers requested the fontstack
    `Open Sans Semibold/Bold, Arial Unicode MS Bold`, which **does not exist on
    OpenFreeMap's glyph server** (404). When a glyph fetch 404s, MapLibre
    discards the ENTIRE vector tile that needed it — fill-extrusion buildings
    included — and marks the tile loaded-but-empty with **no error event**
    (`err:0`, `src:true`, `loaded:0`). The previous harness never caught this
    because it stubbed all glyph requests with empty-but-valid responses (§8's
    glyph gotcha) — the stub masked the live failure. Fixed: both layers use
    `Noto Sans Bold` (OpenFreeMap serves only Noto Sans Regular/Bold/Italic —
    any new text layer must stick to those). Verified against the real font
    server on a desktop browser: `loaded:1072 view:294 err:0`, buildings and
    branded signs render; live files confirmed byte-identical after deploy.

---

## 8. The verification tool (critical — read this)

**The agent's sandbox cannot load the live Vercel URL in a browser** — outbound
browser traffic is blocked by a restrictive proxy (`ERR_TUNNEL_CONNECTION_FAILED`),
and the Vercel deployment also has an auth wall. The agent *can* fetch file
contents (via the Vercel API tool) but cannot run the live page.

This caused real pain: several fixes were shipped on reasoning alone and missed.
The user (rightly) demanded a reliable verification method instead of guess-and-
ship.

**The solution — a local harness that runs the REAL app code and screenshots it:**
- A local static server serves the actual repo (`index.html`, `app.js`, all js,
  `data/`), optionally serving the `.pmtiles` under **Vercel's exact bad
  conditions** (Brotli + no range) to reproduce live behavior.
- **Playwright** (headless Chromium, already installed at
  `/opt/pw-browsers/chromium`, launch with `--use-gl=swiftshader
  --no-proxy-server`) loads the page and **intercepts external requests**:
  serves local vendored `maplibre-gl.js`/`pmtiles.js` for the unpkg CDN, returns a
  **stub basemap style** for OpenFreeMap, and returns empty-but-valid **glyphs**
  (fonts) so symbol layers don't error.
- **Route order gotcha:** Playwright applies the *most-recently-added* route
  first, so register broad `abort`s BEFORE specific `fulfill`s.
- **Glyph gotcha:** if fonts are blocked/aborted, MapLibre errors the *whole tile*
  (buildings included). Serve empty 200 glyphs, not abort. (This is what made an
  earlier harness look falsely broken.)
- It then reads the on-screen `#diag` text and takes a screenshot — so the agent
  verifies with its own eyes before shipping.

**Use this harness to verify every rendering change before pushing.** The scripts
were built in the session scratchpad (ephemeral); if it's gone, rebuild it from
this description — it's worth it. Pattern that proves buildings load:
`loaded:1482  view:700+  src:true  err:0`.

**Also:** the on-screen `#diag` readout lets the *user* verify on their real phone
by screenshotting it. Keep that loop until rendering is confirmed on the live site.

---

## 9. Deployment notes / gotchas

- **Repo:** `SimeonVarg/austin-3d-explorer`. Work is on **`main`**. (Original
  default was `add-plan`; a Phase-1 PR was merged into `main`. Make sure `main` is
  the GitHub default branch so Kiro/Vercel/Pages all agree.)
- **Vercel:** serves the app; **it Brotli-compresses `.pmtiles` and breaks ranges**
  — that's why the in-memory tile loading exists. Do NOT go back to range-based
  PMTiles loading on Vercel. If you ever host tiles elsewhere, a range-supporting
  host (GitHub Pages, jsDelivr, R2/S3) would also work, but in-memory is simplest.
- **GitHub Pages:** was enabled but returned 403 when checked; treat as unreliable
  unless re-verified.
- Redeploy after each push; confirm Vercel actually rebuilt (it has occasionally
  needed a manual "Create Deployment").

---

## 10. The user's feedback and how it was handled (READ THIS)

The user was patient but became (justifiably) frustrated. Honoring this section is
the difference between a good and bad collaboration going forward.

- **"Dumb it down."** Repeatedly asked for plain-English explanations. He is not a
  developer and works from a phone. **Explain simply, lead with what to do.**
- **Kiro can't debug.** When Kiro couldn't find bugs, we established Kiro is
  network-locked and blind to library behavior. **Route real debugging to the
  agent.** He asked directly whether to "just use Kiro for small changes" — yes.
- **"Wait 2 seconds" was a bad call.** The agent guessed the sparse buildings were
  "progressive loading" and told him to wait. He'd had it open for **minutes**.
  He called it out. **Lesson: don't rationalize a symptom to avoid admitting you
  can't see it. Own the gap.**
- **"You said you can verify — but you couldn't tell buildings still disappear."**
  He caught that the agent claimed verification ability while missing an obvious
  live bug. The honest answer: the harness at the time couldn't render the real
  basemap and the agent had under-prioritized a flash it had flagged. **Be
  precise about what you can and cannot verify.**
- **"You need a reliable verification tool. I'm not here to waste sessions on
  figuring out HOW to debug, let alone debugging."** This was the turning point.
  The agent stopped guessing and **built the real-code harness** (§8), then used
  it to find the actual root causes (v5 props, Vercel compression, glyph tile
  errors). **This is the standard now: reproduce and verify locally before
  shipping. No guess-and-ship.**
- He also noted, pointedly, that the agent itself had said *"you can't even do the
  fun part"* — i.e., all this debugging kept us from the actual goal (making it
  beautiful). **He wants to get to the styling/aesthetics.** Respect that; don't
  let infrastructure churn keep eating the sessions.

**How to work with him going forward:** verify with the harness + screenshot
before claiming a fix; explain plainly; be honest about limits; and push toward
the *look and feel*, which is what he actually cares about.

---

## 11. What's next — the fun part (finally)

Assuming the in-memory fix is confirmed on live (`loaded:` ~1482):

1. **Remove the temporary diagnostics readout** (`#diag` in `index.html`,
   `updateDiag`/`setInterval` + error capture in `app.js`, `#diag` CSS).
2. **Confirm and tune the look** using the harness screenshots:
   - The **day→night slider** (`timeofday.js`) — verify day/golden/night read
     well; tune the palette so it's genuinely "beautiful low-poly," not muddy.
     Note `setSky` is a no-op at v4.7.1, so the **sky gradient isn't actually
     rendering** — consider upgrading to MapLibre v5 (which also unlocks ambient
     occlusion for nicer shading) OR add a CSS/gradient sky behind the canvas.
   - **Signs** (`signs.json` + `signs.js`) — confirm the 48 landmark labels land
     on the right buildings and **glow at night**; tune sizes/colors; expand the
     list; consider real logos as billboard images later.
   - **Building color/variety and lighting** — make landmarks (burnt-orange
     accent) pop; add per-building variation so it's not monotone.
3. **Consider upgrading MapLibre to v5** — would enable real sky + ambient
   occlusion (nicer depth), but re-test everything in the harness first (v5 has
   API differences; that version mismatch already bit us once).
4. **Terrain, redone** (optional) — reintroduce the West Campus→Waller Creek slope
   with extrusions draped on terrain and no exaggeration, verified in the harness
   so it doesn't cull buildings again.
5. **Versioning UI** (later) — once a 2nd snapshot exists, surface the
   date-switcher and the "what changed" fly-through (`diff-tour.js`).

---

## 12. Quick reference

- **Live:** https://flyover-utx.vercel.app
- **Repo:** `SimeonVarg/austin-3d-explorer` (branch `main`)
- **Data:** 2,443 buildings, snapshot `2026-07-10`, 92% LiDAR heights; 48 signs.
- **Libs:** MapLibre GL JS **4.7.1**, PMTiles **3.2.1**, OpenFreeMap liberty.
- **Spawn:** `[-97.7434, 30.2857]`, zoom 16.5, pitch 60, bearing 90.
- **Golden rule:** verify rendering changes in the local real-code harness (and/or
  the on-screen `#diag`) **before** telling the user it's fixed.
  quick aside from simeon editing from github - i changed main branch to default from add-plan
