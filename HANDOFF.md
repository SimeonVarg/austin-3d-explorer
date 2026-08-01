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

---

## 13. July 10 late-night overhaul — detail + visuals pass (supersedes parts of §11-12)

Simeon confirmed buildings load, then asked for the fun part in one shot: max
low-poly building detail (esp. West Campus apartments + UT buildings), drastically
better day/night/sky/landscape, keep signs/glow/controls. What changed:

**Architecture: PMTiles is GONE from the client.**
- Buildings are now a plain GeoJSON source: `data/snapshots/<date>/buildings.detailed.geojson`
  (~1.4 MB raw, ~big-savings brotli'd by Vercel; MapLibre client-tiles it in a worker).
  This also permanently kills the Vercel byte-range/Brotli failure class (§7).
- MapLibre upgraded 4.7.1 → **5.24.0**. v5 notes: `antialias` must live in
  `canvasContextAttributes`; `map.on()` no longer chains; sky needs the horizon
  on-screen — we run `setVerticalFieldOfView(58)` + spawn pitch 64 so the
  `setSky` gradient actually shows. MapLibre has NO ambient-occlusion/flood-light
  (that's Mapbox v3) — night "flood light" is faked with `circle-blur` ground
  pools under signs (`signs-ground-glow` layer).

**Data added (all fetched from OSM Overpass, scripts in `scripts/`):**
- `data/parts.geojson` → baked to `parts.detailed.geojson`: 23 `building:part`
  volumes (incl. the 94 m UT Tower shaft on its 6.4 m base). Base buildings that
  parts replace carry `has_parts=1` and are filtered out of `buildings-3d`.
- `data/trees.geojson`: 498 real campus trees (octagon canopy + trunk extrusions).
- `data/landscape.geojson`: 52 pitches + fountain fills.
- `data/hero_designs.json`: curated real-world palettes for all 48 signed
  landmarks + ~19 OSM-name variants (UT limestone + red tile, Dobie gold glass,
  Skyloft blue, Castilian white...) plus per-`building_class` palette variants.
- OSM colour tags in this bbox are nearly nonexistent (5 buildings, 1 with real
  colours — Sutton Hall). Curated designs + class palettes carry the look; more
  data genuinely does not exist upstream.

**Bake step (`scripts/bake_detail.py <date>`):** merges base buildings + parts +
OSM tags + hero designs; bakes per-feature wall/roof colours for day/golden/night
(`wd/wg/wn`, `rd/rg/rn`) with deterministic per-building shade jitter. Hero
matching is sign-location-based disambiguated by height, then fuzzy-name.
Re-run it after editing `hero_designs.json`, then hard-reload.

**Client rendering:**
- `timeofday.js` v2: one `interpolate` expression with constant-`p` input blends
  each feature's baked colours — per-building identity at every hour. Scene
  keyframes drive sky (v5 `setSky`), light, ground/park/road/water/tree/pitch.
  Parks/landcover get their own GREEN bucket now (they were pavement-tinted).
  Pattern fills (plaza hatching) are hidden — they ignore tints and glow at night.
- Roof caps: top 1.2 m of every building ≥4 m re-extruded in roof colour
  (`buildings-roof`/`parts-roof`) — UT's red-tile roofs read from the air.
- v5 renders wide text halos as solid slabs; the old glow-underlay symbol layers
  are REMOVED (orphaned glow text made colored blocks where labels decluttered).
  Neon = label brand-halo widening at night + ground pools.
- Default time is now p=0.12 (late morning; palette variety visible on load).

**Verification:** everything above was verified in the `_harness.html` preview
loop (day/golden/night screenshots at spawn, UT Tower south-mall shot, West
Campus street shot). Screenshot tip: hidden-tab compositor serves ONE STALE
FRAME — always screenshot twice and trust the second.

---

## 23. July 30 2026 — the Capitol Complex (south of campus)

**The complaint:** "can you get the government buildings south of campus looking
a lot better — check whether they even exist."

**What was actually there.** They existed, and that was the smaller half of the
problem. `scripts/config.sh` models `30.276..30.296`, and that south edge falls
one block NORTH of the Capitol grounds. So the scene held the *back* of the
state complex — the Bullock, Bush, Barbara Jordan, Travis, Stephen F. Austin —
as anonymous tan boxes, and then stopped dead in an empty tan plain exactly
where the **Texas Capitol, its 22 acres of grounds and the Governor's Mansion**
belong. Flying south from campus, the city ended at MLK.

The heights were wrong too, and consistently in one direction: Overture reads
these buildings at roughly half true size. The **14-storey George H.W. Bush
State Office Building was a 24.9 m box** — 1.8 m per floor.

**What was added** (`scripts/fetch_capitol.py` → `scripts/bake_capitol.py`,
six data files, `js/capitol.js`):

| | |
|---|---|
| new modelled strip | `30.2710..30.2762`, full lon span — one block past the grounds |
| buildings | **604** from OSM, 78% with a recorded `height` or `building:levels` |
| the Texas Capitol | its real OSM footprint + **13 building:parts**, plus bespoke dome geometry |
| grounds | 322 areas + 1,480 paths — the Great Walk, the drives, the lawns |
| trees | **306** on the Capitol grounds; `trees.geojson` stopped at 30.27597 |
| corrected | 12 state buildings recoloured, **5 raised** (Bush 24.9 → 50.4 m) |

**The design rule: add nothing new where something exists.** Five of the six
baked files are merged into sources the app already has — `austin-buildings`,
`austin-parts`, `austin-ground`, `austin-trees` — so the new area inherits
facade patterns, ground shadows, label placement and dedup, the collision grid,
the day→night palette, the tree-density knob and the z-order for free and
permanently. Only the dome needed a layer of its own.

**The Capitol's massing is not invented.** OSM models it with building:parts,
and the numbers corroborate from two directions: the drum part carries
`height=75, roof:shape=dome`, the lantern part carries `height=92`, and 92 m is
the documented **302.64 ft** to the tip of the Goddess of Liberty's star. What
IS generative is form — `fill-extrusion` has one roof shape, so the dome, the
24-column drum colonnade, the mansard skirt, the pavilion caps and the Bullock's
rotunda are stacked rings, the same trick `bake_stadium.py` uses for the bowl.

**Things that were measured rather than recalled**
- The Capitol's roof is **pale grey-green standing-seam metal**, not terracotta
  — four clean samples off a z20 nadir tile (`#b7b8aa #aaaa9d #b5b6a7 #8d9085`).
  Worth knowing, because the campus roof pass would have tiled it in clay.
- The dome reads **lighter than the walls** from above (`#c9bba9 #ccb7a0
  #c0af9f`): it is sheet metal painted to match granite, and paint on a curved
  surface facing the sky is not a quarried wall. It has its own colour on purpose.
- The Capitol's **long axis runs east–west**, not north–south. The footprint's
  bbox is 167.9 × 102.6 m, which also settles which dimension the documented
  566 ft belongs to.
- The **granite wall colour is generative and labelled as such.** A nadir tile
  shows roofs; the few vertical strips it shows are shadowed or one pixel wide.
  Sampling those would have been a measurement in name only.

**Five bugs worth not repeating**

1. **`_harness.html` keeps a hand-maintained COPY of index.html's script list.**
   `capitol.js` was added to `index.html` only, and three shot runs "proved" the
   Capitol Complex had not changed. A module missing from the harness renders a
   scene that looks fine and is not the one the site serves. Both files now say so.
2. **The intro cinematic is a `map.flyTo`, not the flight controller.** So
   `__fly.eye().driving` stays **false** for its entire 9 s, the README's
   "wait for `!driving`" returns immediately, and the `jumpTo` after it is
   overwritten a frame later. Two probe runs screenshotted West Campus and were
   nearly read as "the buildings are missing at the Capitol". The fix is
   `?intro=0`; `shot.mjs` now loads with it.
3. **`fill-extrusion-vertical-gradient` on a stacked dome is 18 dark bands.**
   It darkens the bottom of *each* extrusion — right for one 30 m building,
   wrong for eighteen 1.3 m discs. With it on the dome read as a brown cone;
   off, MapLibre's per-facet shading carries the curvature.
4. **The facade quantiser will always lose a landmark's material.** Keeping the
   14 most POPULOUS tones is the right default and it also guarantees that a
   one-off granite on one building folds into whatever tan its neighbours
   average to — which put a pink dome on brown walls. `facades.js` now honours
   `window.FACADE_PROTECTED`: a protected tone keeps its own bucket and its
   *exact* colour, because the point is the material, not the neighbourhood.
5. **Overpass: `out` takes verbosity BEFORE geometry** (`out tags geom`, never
   `out geom tags`), and a tag key with a colon must be quoted
   (`way["area:highway"]`). Both are 400s, and 400 will never fix itself — the
   fetcher now fails fast on it instead of spending six minutes retrying mirrors.

**Two judgement calls, stated rather than hidden**
- **Levels → metres uses 3.6 m for civic/office**, not `config.sh`'s 3.2, which
  is a residential figure. At 3.2 the 14-storey Bush building is shorter than
  the 12-storey apartment blocks on Nueces. Generative, and reported by the bake.
- **The overrides pass may only touch a curated list inside a box around the
  complex.** The first cut matched any snapshot building whose name OSM also
  knew, which quietly raised **Dobie Twenty21 from its curated 82 m hero height
  to 99.2 m** and The Linden to 89.6 — a West Campus edit from a pass with no
  business there. The list is now the permission.

**Corrections are a runtime patch, not a rewrite of the snapshot.**
`data/capitol_overrides.json` is applied in `mergeCapitolScene()` on every load.
`buildings.detailed.geojson` is a generated artefact and a re-run of
`bake_detail.py` would silently undo anything written into it.

**Still owed here:** the Capitol's south portico and its steps; the monuments on
the south lawn (the `historic`/`memorial` nodes are fetched and cached but not
baked); the Bullock's bronze Lone Star; and 7 downtown building *relations*
that Overpass returned without member geometry and the bake skips — all hotels
and condos, none of them government, and the count is reported.

---

## 22. July 30 2026 — the ground pass (make it read like campus)

The complaint: the intro flies past the UT Tower and the ground under it is
empty — flat green, undifferentiated grey, nothing at people scale. It read
like a basemap with buildings pushed up.

### 22.1 The rule that governs this whole pass

**Position factual, form generative, and say which is which.** Every script
here prints its own provenance block. Nothing is scattered for looks.

### 22.2 What was sourced, and from where

| Layer | Count | Position source |
|---|---|---|
| paths/plazas/lawns/water/pitches (`ground.geojson`) | 2,881 | OSM |
| trees (`trees.geojson`) | 2,572 | city survey 878, OSM 489, **aerial imagery 1,205** |
| art / furniture / construction (`props.geojson`) | 501 | OSM |
| pitched roofs (`roofs.geojson`) | 100 buildings | terracotta tile read off aerial imagery |

**`scripts/survey_ground.py` caches every raw Overpass response under
`data/osm_cache/`** so nothing depends on that flaky API twice. Two hard-won
notes: an Overpass union group needs a `;` after it or every mirror answers
400 Bad Request (reads exactly like an outage), and running the queries back
to back earns a 429 then a cascade of 504s — pace them.

### 22.3 The tree problem, and the imagery answer

Neither survey covers the malls: OSM has 498 trees in the bbox and **none** on
them; the City of Austin inventory (Socrata `wrik-xasw`) has 1,566 with species
and trunk diameter and **none** on them either — the city surveys city land and
UT is state property. Its coverage also sits mostly at the eastern edge, leaving
the spawn and the flight corridor with **2 trees between them**.

So `scripts/detect_canopy.py` reads crowns off current nadir aerial imagery —
legitimate, and how OSM itself is made. Canopy separates from lawn on the two
things that actually differ: a crown is **darker** than mown grass and far more
**textured** at 0.26 m/px. `--debug` draws every detection onto the photograph,
which is how they were accepted by eye: crowns land on real trees, the open
South Mall lawn correctly stays empty with live oaks along its edges, and the
roofs and Littlefield Fountain stay untreed.

**NOTE for whoever reads this next: the "USGS LiDAR already in this project" is
Overture's LiDAR-*derived building heights*, not a point cloud.** There are no
vegetation returns to mine. That premise was checked and is false.

### 22.4 Roofs — the loudest generated-look tell

`fill-extrusion` has exactly one roof shape: flat. WHICH buildings have tile
(therefore pitched) roofs is **sourced**: each footprint is scored for
terracotta against the imagery, calibrated on the only ground truth available —
the five buildings OSM tags with `roof:shape`. The SHAPE is generative: stepped
inset facets at a 5:12 pitch. Offsetting a long rectangle inward collapses its
short axis to a line, so an elongated hall grows its own ridge. Reads as a pitch
at flying altitude; reads as steps up close, which is stated, not hidden.

**v2 (July 30) — "the roofs are still flat".** They were, on 96% of campus, for
two mechanical reasons and one rendering one. All three are worth knowing:

1. **The rule was never run.** `data/imagery_cache` held only the 176 z19 tiles
   fetched for an unrelated research task, so the bake reported `no_imagery
   1933` against `tiled 26` and every unscored building fell through to flat.
   Nothing was wrong with the rule; it had no photograph to read.
   `scripts/fetch_roof_imagery.py` derives the tile list from the footprints
   themselves and fills the cache (1,192 tiles). 26 → 76 buildings.
2. **The rule asked the wrong question.** v1 averaged terracotta over the WHOLE
   footprint and needed 0.50. But most of these hips are a tiled BAND around a
   flat membrane deck, so Welch, Calhoun, Hogg Auditorium, Gregory Gym, the
   Blanton, Goldsmith and Gearing all scored 0.30–0.55 and were thrown away —
   by their own decks. v2 walks INWARD from the eave and samples each offset
   ring, so the slope's run is measured per building and stops where the tile
   stops. 76 → 100, and the run is now data instead of an assumption.
   `python scripts/probe_roofs.py --sheet` writes the contact sheet that made
   this obvious; looking at the crops took ten seconds and was worth more than
   any amount of reasoning about the histogram.
3. **Stepped rings render flat, and no amount of pitch fixes that.** Every tread
   is horizontal, MapLibre shades horizontal tops identically, and the result is
   a flat plane with stripes on it — corrugated iron, not a roof. So each step
   is now one quad PER EDGE carrying `az`, the direction that slope faces, and
   `timeofday.js` picks its colour between a baked dark and bright end from the
   LIVE sun (`roofFacetColor`). The four slopes of a hip then differ, the hip
   diagonals appear, and the lighting rotates with the same sun as the shadows.

   Baking that tint into rd/rg/rn instead was tried first and failed in a way
   worth remembering: `bakedColor` LERPS day→golden, the morning sun sits at
   az 98 and the golden one at az 256, and at p=0.25 every facet averaged back
   to flat grey. **Directional shading cannot be baked at fixed hours and then
   interpolated across the day.**

Three geometry bugs found by looking at renders rather than at code:

- **Folded offsets.** A mitred offset turns inside out where a building is
  narrower than twice the offset. The Union's thin wings became spikes that
  rendered as steps floating over a flat plane. `fold_free_run` caps the slope
  at the last offset where the ring is still a true offset (every vertex still
  `d` from the wall that made it). Demanding EVERY vertex be clean dropped 34
  buildings whose single light-well notch folds early — Batts, Parlin, Rainey —
  so the test tolerates a tenth of the ring and `valid_step` cleans the rest.
- **The missing top.** The slope's interior was left on the wall cap while the
  band climbed 3 m above it, so the steps genuinely floated. It is now always
  filled at the top of the slope; its colour is the photograph's call (measured
  membrane grey where the middle is not tile, the building's tile where it is).
- **1 m wall jogs.** Shading by direction turns a staircase-shaped wall into
  alternating bright/dark dashes. The roof is simplified (Douglas–Peucker, 1.1 m
  — under the eave overhang) before offsetting.

Cost: measured with `scripts/verify/roof-perf.mjs`, roofs on vs off over the
halls, interleaved reps. The spreads overlap in both runs — **no measurable
frame cost**, which is the honest reading, not "free".

### 22.5 Two measurement lessons

- **The paths rendered correctly from the first try and were still invisible.**
  Concrete at luma 185 on a ground of 188.5 is 3.5 points of separation. Proved
  with a magenta pass (6.2% of frame) before touching anything, then fixed by
  dropping the catch-all `ground` from a pale sand to a mid warm grey.
- **Tree density is a parameter, not a cull.** Measured: the full set cost
  ~6–7 fps; the ground fills were within noise. Every tree carries `d`, a
  keep-order biased by crown size, so thinning drops small trees first and the
  mean canopy height *rises* 9.3 m → 13.8 m. `GFX.treeDensity` is in the menu.
  Back to 0 dropped-min / 59.4 fps at balanced.

### 22.6 Still missing (asked, not guessed)

Org tents on Speedway, the Jester courtyard interior, construction at the Tower
base and the Catholic Center, food carts, and parked cars are **not placed** —
no source carries them and the brief forbids guessing. See the report.

## 21. July 30 2026 (overnight) — the beauty pass

*(Being written as the night progresses; the morning report finalises it.)*

The brief: nothing is broken, tonight is about beauty. AWS is putting footage of
this app on the official Kiro channels; Simeon picks what to film in the
morning. Bar: a stranger scrolling stops. Branch: `feat/night-beauty`.

### 21.0 THE TOP NEXT ITEM — the snapshot data (deliberately NOT touched tonight)

The biggest real product gap is the data story: two distinct datasets and a diff
of twelve unnamed sheds. It is open-ended data work with uncertain payoff, which
is why the overnight brief explicitly excluded it. **Whoever picks this project
up next: start here.** Make the snapshot dates mean something — real diffs of
real named buildings between real dates — or fold the date UI away until the
data earns it. Nothing tonight touched `data/` or the diff pipeline.

### 21.1 The opening frame (framing pass, main session)

- The app now opens at **p = 0.50, peak golden hour** (`TOD_DEFAULT_P`,
  js/timeofday.js) — it used to open at 0.12, a pale flat morning that hid the
  app's best hour. Chosen against p = 0.47 by rendering both: at 0.47 the sun
  sits just above a portrait frame leaving a halo ring; at 0.50 the disc
  anchors the frame. `?p=<0..1>` overrides the opening hour for filming.
- **Spawn pose faces the sunset**: pitch 74 / bearing 250 (was 64 / 90). At
  pitch 64 a portrait frame kept ~6% sky and the golden-hour sun was BEHIND the
  camera; now the horizon sits about a fifth from the top and the disc, god
  rays and lens ghosts are all in frame. (`SPAWN`, js/app.js.)
- **The intro travels**: it starts low over campus ~430 m east and flies west
  down the 24th St canyon into the tower cluster, settling on the sunset pose —
  two chained easeTo legs, every value in the `INTRO` block (js/app.js).
  Verified frame-by-frame (portrait): towers pass the frame edges, no geometry
  clipping, and with the auto-detect probe cancelled the flight lands on the
  exact spawn pose. The probe used to stomp the ease mid-flight — the fix
  (probe defers while `map.isEasing()`) belongs to graphics.js.
- **The white void is gone**: a brand-dark `#veil` (index.html/style.css) holds
  an authored title card from the first paint until the map's first idle frame
  (capped by `INTRO.maxVeilMs`), then lifts as the flight departs. The first
  thing a visitor ever sees is the city already golden and in motion.
- **`?clip=1` cinematic capture mode**: hides all chrome (HUD, hints, panels,
  joystick, gear, toast) for filming; attribution stays for the license.
- **Phone chrome shrink** (style.css ≤640/≤520 blocks): the time-of-day pill
  dropped from 278 px (a third of a 390×844 frame) to ~210 px; the HUD loses
  the snapshot line on small screens; attribution links dimmed from orange to
  quiet cream. OSM ghost labels no longer smudge the spawn frame — the
  buildings-labels fade ramp now starts below the spawn zoom (16.8→17.5).

### 21.2 Presence (main session)

- **Idle cinema** (`DRIFT`, js/app.js): after 25 s of input silence the camera
  begins a slow tagged-easeTo orbit with the hour creeping forward (bouncing at
  day/night). Any input — or any untagged camera movement — reclaims control
  instantly. Gated out of the pixel harness via `__HARNESS`; `?drift=0` for
  scripted runs. Verified drift-check.mjs 4/4.
- **Landmark orbit** (`ORBIT`, js/app.js): tap a rendered sign label → the
  camera glides to that building and slowly circles it; any input ends it.
  Verified orbit-check.mjs 4/4 (glide lands 0.3 m from the sign). Honest test
  lesson: only RENDERED labels are tappable, and glyphs load late under load —
  the test waits for the label like a human would.
- **The Forty Acres tour** (`TOUR`, js/app.js): T or `?tour=1` flies a ~50 s
  authored route — the Drag, the South Mall with a held push-in dwell on the
  UT Tower postcard, a quarter-orbit, DKR with its own dwell, and a long
  settle home into the sunset. `?clip=1&tour=1` is a pure footage run. First
  cut was rejected by looking (Tower beat sampled mid-swing, Dobie dominated);
  dwell beats fixed it. tour-check.mjs 2/2.
- **Photo mode**: P toggles the same chrome-free view as `?clip=1`, live.

### 21.3 The night city (night workstream, merged)

Windows: five colour temperatures with weights (`WINDOW_TONES`, facades.js) —
warm incandescent through TV-blue — per-pane brightness with a dim tail, 5%
hot panes, and occupancy de-lockstepped from `bucketIdx % 5` to a continuous
per-(family × bucket) hash with per-family baselines (towers dimmest).
Streetlights: 1,201 lamps (482 major sodium / 719 minor warm) sampled from the
basemap's transportation geometry after idle, two circle layers inserted below
the extrusions so towers occlude, opacity ramping p 0.58→0.85 (`LIGHTS`,
night.js). Parking decks go cool-fluorescent after dark. Height falloff inside
a building was SKIPPED honestly: the facade tile repeats in world space every
~20 m of height, so it is not expressible without faking it badly.

**Harness truth learned tonight — the stock silhouette.mjs night check is
racy.** Cross-run evidence: bit-identical PASS values (55.8/21.2) and
bit-identical FAIL values (10.2/16.2) each appeared at MULTIPLE different
commits — the failure follows machine load, not code. Mechanism: its
single-column scan can "hit" a building at its very first row (y=0.05, deep in
the sky at that pose), after which it samples a dark tower wall as "sky". The
corrected ruler is `night-silhouette.mjs` (parts layers in the scan, sky
sampled above the computed horizon, median of 7 columns): night margin +20.9
on the merged tree. Its dusk half races the facade-atlas repaint under load —
`night-dusk-truth.mjs` (steady-state, atlas-byte read) is the reliable dusk
pattern, and the steady-state p=0.66 frame was verified correct by eye.

### 21.4 Light (light workstream, merged)

Filmic tone curve: exposure+contrast+curve baked into ONE SVG
`feComponentTransfer` LUT in the canvas filter chain (CSS clamps between
stages, so a separate brightness() would destroy what the shoulder recovers);
identity mid-band, Hermite toe/shoulder; `TONE` block + `GFX.filmic` slider.
Verified by pixels: golden flat-255 plateau 0.227%→0%, night flat-black
0.96%→0%. Auto-exposure: 40×24 mean-luma meter per frame, open-loop
(pre-grade, cannot pump), EMA τ=900 ms, clamps 0.85–1.20, target follows the
HOUR's authored luma (a fixed mid-grey target would re-grade the intentional
high-key day / dark night); `GFX.autoExposure`. God rays weighted by angle
from horizontal (ink ratio 3.42 vs 1.16 uniform) — glare streaks, not a
starburst. Second-sun ghost killed (sky-ghost ink −34–42% at every bearing).
The auto-detect probe now DEFERS while map.isEasing() (it was stomping the
new intro mid-flight) and is silent unless it actually downgrades. Vignette
tints by hour (`VIG_HOURS`). Clouds carry a lit rim and shaded base; a Belt
of Venus rises anti-solar at dusk (p 0.50–0.70); bright stars twinkle with no
new rAF loop. Perf: interleaved A/B vs a pristine baseline — dropped-min 0
both, p50 18.0 ms both; the whole pass costs less than run-to-run noise.

### 21.5 Motion (motion workstream, merged — with two suite lessons)

Bank roll into turns (native MapLibre roll, capability-checked), FOV kick
under speed, hover bob + landing settle, speed-adaptive pitch, and wall
deflection (damped + steered toward the freer side) — all as derived OUTPUT
offsets around writeToMap; the eye/alt/bearing/pitch state and every
collision guarantee untouched; everything in one `TUNE` block, live-tunable
via `__fly.tune`. Roll and FOV are hard-reset on every hand-back plus a
self-heal on the idle path. The agent died before finalising; its one
COMMITTED increment was merged and re-verified here (motion-feel 19/19,
movement 14/14 ×2, collision 8/8); its uncommitted wall-deflection iteration
was left out — unverified code doesn't ship.

Two movement.mjs defects the feel pass exposed (both now fixed in-file):
the speed ruler measured map.getCenter() — eye + a lead that now breathes
with dynamic pitch — instead of the eye; and __reset was a bare jumpTo that
the controller overwrote while it owned the camera (ownership now lasts ~8 s
after keyup for the bob wind-down), so positions accumulated leg over leg
until the DIAGONAL legs hit the soft data fence — a rock-stable-looking
diagonal/cardinal of 0.73 that was really the fence crushing vel.n. The eye
moved at exactly 56.71 m/s on both headings throughout.

## 20. July 29 2026 (later) — performance, the graphics menu, and a real sky

Five things were reported at once: the desktop was "super laggy"; the phone was
smooth but "roofs glitch out while I'm moving"; the time-of-day slider needed you
to *wait* after moving; the daytime sky was "too deep blue like I'm in space"; and
the whole thing was "too map-like" against a wanted "4K RTX / Minecraft shader"
look, with a menu to customise it.

### 20.1 The lag was fill rate, not JavaScript

Baseline at 2560x1400, flying: **27.9 fps with 53.6% of frames dropped**. The
median frame time was 16.7 ms — sitting exactly on vsync — which is why a median
is a useless performance metric here and everything is now counted in dropped
frames.

Four independent levers each roughly halved the drops. Ranked:

| lever | effect |
|---|---|
| `antialias: false` | 128 -> 53 dropped frames. One flag, the biggest single win. |
| basemap (40 Liberty layers) | 128 -> 54 |
| the DOM overlay stack | 128 -> 55 |
| the 23 widened road-line layers | 128 -> 64 |

`antialias` now defaults **off** and is a menu option with a reload prompt (it
cannot be changed on a live WebGL context). Render scale via `map.setPixelRatio`
— which does exist in 5.24 and works, 1100 -> 550 px verified — is the master
lever and supersedes MSAA anyway, since a scale above 1 supersamples.

**The sky canvas was uploading 13.7 MB every frame and 98.2% of it was empty.**
Everything in that pass was already clipped to `hzPx + 0.018H`; the element was
just full-screen anyway. It is now sized to the sky band (quantised to 96 px steps
so pitching does not reallocate the backing store), measured at **21% of a
full-screen buffer at the spawn pitch and 12% in the test viewport**. Same lesson
applied to the new FX canvas, which renders at half linear resolution because it
holds nothing but soft gradients.

Per-effect cost, measured on a deterministic bearing sweep, median of 3
interleaved runs at 2560x1400: **film grain 4.8 fps, colour grade 3.8, contact
shadows 3.6, distance blur 0.8.** Grain is therefore OFF in `balanced` — it is a
taste effect, not a depth cue — and the contact-shadow blur radii were halved
(84 px was pure overdraw across ~2,400 footprints).

Honest bottom line: **`balanced` with all the new effects runs at about the same
speed as the old build did** (35.3 fps / 106 dropped against 35.3 / 107). Turning
MSAA off buys 45.3 fps / 63 dropped, and the effects spend it back.
`performance` is 49.0 fps / 46 dropped. So what was really gained is *the choice*,
plus a much better-looking scene at parity.

### 20.2 The time-of-day lockout (the easiest real bug)

`style.css` hung `pointer-events: none` on the side panels off `body.flying` — and
`.flying` has a deliberate **4-second idle tail** so the hint always comes back. So
after every burst of flying the slider was dead for four seconds with nothing to do
but wait. That is exactly what was reported.

The protection is real (on a phone a right-thumb look swipe drags the slider into
night) but it only needs to last as long as the gesture. `controls.js` now sets
`body.input-active` on pointerdown and clears it on pointerup; the *fade* still
follows `.flying`, and hover/focus brings the panel back to full opacity.

### 20.3 The roofs — what was fixed, and what was NOT verified

The parapet cap was `base: h - 1.2, height: h + 0.4`. Its side faces were therefore
**exactly coplanar with the wall's over a 1.2 m band, in a different colour**, which
makes the winner undefined. It is now `base: h, height: h + max(1.0, 0.015h)` — the
cap sits ON the wall, shares no surface, and separates the two roof planes by
1.0-1.5 m instead of 0.4 m (scaled with height so the tall buildings, seen from
furthest away, get the most separation).

**This was not reproduced.** `scripts/verify/roofz.mjs` measures speckle density in
the old and new configurations at three poses and finds them within ~1% — and that
null result is expected, not reassuring: swiftshader rasterises with a 24-bit depth
buffer, and MapLibre draws `buildings-roof` after `buildings-3d` with `LEQUAL`, so
on a buffer with enough precision the later layer wins every tie deterministically.
A phone's buffer is often 16-bit. The change is justified on the geometry, not on a
repro. **Needs a real phone to confirm.**

Also fixed while in there: `diff-tour.js` carried its own copy of the
`+0.4 / -1.2` literals in three places. The rule now lives once in
`window.CAP_GEOM`.

### 20.4 The sky was wrong on both halves of the slider

Measured at the top of the visible band, day read **#284e97 — S 58%, L 37%**,
against roughly S 40-55% / L 55-70% for a real sky. Too dark and slightly too
saturated is exactly "deep blue, like I'm in space". And it was FLAT: one colour
across the whole band, because `sky-horizon-blend` was 0.5, which kept the pale
horizon colour so low that at any flying pitch you only ever saw near-pure zenith.

Worse, and not reported: **the day-to-golden half dragged through purple.**
`#21529f -> #6a2a4a` is a lerp through violet, and the rendered sky at p=0.30 —
mid-afternoon — was **#4d3a6c, a dark plum**. The `DUSK` route had already solved
this exact problem for the golden-to-night half in section 18; it just never
covered the first half. It is now one `ROUTES` table across the whole 0-to-1 range.

After: day runs **#5c93cd (S 53%, L 58%) -> #b4d1e8 (L 81%)** across the band — a
real gradient in the reference range — and p=0.30 is a desaturating blue-grey
afternoon instead of plum.

### 20.5 The post-process stack (js/graphics.js)

    downscale + threshold + blur + add  -> bloom       (canvas, from the GL canvas)
    additive wedges from the sun        -> god rays    (canvas)
    ghosts + anamorphic streak          -> lens flare  (canvas)
    masked blur at the horizon          -> aerial DOF  (CSS backdrop-filter)
    exposure/contrast/saturation        -> grade       (CSS filter on #map)
    overlay noise                       -> film grain  (tiled canvas)
    blurred dark line on the footprint  -> contact shadows (a MapLibre line layer)

**The bloom trap, because it cost the most time.** The obvious approach is one
full-screen div with `backdrop-filter: brightness(.45) contrast(4) blur(25px)` and
`mix-blend-mode: screen` — threshold, blur and add, free, in the compositor. **It
does not work.** Chrome paints the filtered backdrop as the element's own content
and the blend mode never adds it back, so you get a crushed, dark, blurred copy
laid *over* the frame. Rendered side by side the whole city went muddy brown and
soft. A screen blend can only ever lighten, so "it got darker" was the proof.

Bloom is now real: copy the GL canvas into a 256-px scratch canvas with
`filter = brightness(t) contrast(4) blur(r)` (one `drawImage` does the downscale,
the threshold and the blur together), then composite it back with
`globalCompositeOperation = 'lighter'`. Needs `preserveDrawingBuffer`, which is
requested at construction only when the saved bloom setting is above zero, so the
performance preset stops paying for it on the next load.

**The threshold is wrong in both directions and a test now pins it.**
`contrast(4)` maps `out = 4*in - 1.5`, so after `brightness(t)` only inputs above
`0.375/t` survive. At t=0.50 golden hour came through as one orange wash that
bleached the mid-distance city white. At t=0.404 nothing in a *daytime* frame
reaches the cutoff (the pale sky tops out near 0.91), so bloom silently did nothing
for half the slider — caught only because `graphics.mjs` samples day and golden
separately. Landed at t≈0.48. The bleaching turned out to be the alpha (0.89, now
0.4), not the threshold.

Contact shadows deserve a note: a blurred dark **line on the footprint outline**
puts half its width inside the building, where the extrusion hides it, and half
outside — a soft occlusion halo at every base. Sun shadow only ever falls on one
side, so this is what actually makes the extrusions stand on the ground instead of
looking pasted onto it. The first attempt, 0.38 alpha on a 5 px line, was invisible
in a side-by-side render: occlusion is a wide gradient, and the blur has to exceed
the line width or all you get is an outline.

### 20.6 The menu

Gear at top right, `G` to toggle, bottom sheet on a phone. Four presets
(Performance / Balanced / Cinematic / Ultra), 16 individual settings, live fps in
the header, persisted to `localStorage`. Built **from JS, not markup**, so
`_harness.html` cannot drift out of sync with `index.html` — that duplication has
already cost one debugging session.

First run measures ~1.4 s of frame times and picks a preset. It is **cancelled by
the first deliberate change**, because a probe that lands 11 seconds in and
silently resets a preset the user just picked is worse than no probe at all (it
also made `graphics.mjs` flaky in exactly that way). Tests and shot lists call
`window.cancelGraphicsAutoDetect()` up front.

Effects at zero are `display: none`, not `opacity: 0` — a zero-opacity full-screen
blend layer is still a full-screen blend to the compositor. Opening the panel adds
`body.gfx-open`, which slides the time-of-day slider and the snapshot picker clear;
the panel otherwise sits exactly on top of both.

### 20.6b The auto-detect probe was measuring nothing

Worth its own note, because it looked like it worked. The probe fired, reported
"60 fps", and **upgraded** to cinematic — on a machine that had just been called
super laggy. Two independent faults:

1. **It measured an IDLE camera.** MapLibre renders nothing when the camera is
   parked, so a flat 16.7 ms means "no work was done", not "there is headroom".
   The probe now nudges the bearing 0.01 deg per frame (skipped if the user is
   already flying, which is representative on its own) and snapshots/restores the
   bearing around itself.
2. **It could upgrade at all.** vsync clamps the measurement at 16.7 ms, so "hits
   60 at balanced" and "could run three times that" are indistinguishable. There
   is only ever evidence for a downgrade. It now steps down to `performance` or
   stays put; cinematic and ultra are opt-in.

And the guard was backwards: it required 12 frames and otherwise said "cannot
judge, keep the heavier preset". A machine too slow to render 12 frames in 1.4 s
is emphatically slow — failing to gather frames IS the measurement. Threshold is
now 4 frames, which only trips on a backgrounded tab.

`window.__gfxProbe()` runs it on demand so a test does not have to wait out the
11 s delay. Waiting is how a broken probe went unnoticed.

**Unrelated pre-existing bug found while verifying this:** the map bearing drifts
on its own while idle — 4.33 deg in 1.6 s with no probe running, `intro=0`, and
`__fly.eye().driving === false` the whole time. Not caused by anything in this
change (the probe's restore actually reduces it). Spawned as a follow-up.

### 20.7 Also fixed in passing

`diff-tour.js` scheduled `setTimeout(hideBanner, 3500)` for its transient messages
with no way to cancel it. Switching snapshots twice inside 3.5 s — which is what
stepping backwards through the list does — let the first message's timer fire on
top of the second selection's *running* tour: banner gone, prev/next/exit
unreachable, tour still active and still overriding building heights. Found by
`difftour.mjs` timing out on a click.

### 20.8 State

Suites green: graphics 27/27, movement 14/14, collision 8/8, sky 12/12,
difftour 11/11, silhouette 2/2. `roofz.mjs` reports and asserts nothing, by design.

Still not done, still needs a human with the phone: **none of this has been tested
on real iOS hardware.** The mobile checks use a synthetic 390x844 viewport with
`hasTouch`. Specifically unverified: the two-finger altitude gesture, the
joystick-plus-look combination, `mix-blend-mode` and `backdrop-filter` over a
WebGL canvas in Safari, and whether the roof change actually cures the reported
glitch.

## 19. July 29 2026 — shipped, plus the backlog

Everything in §15–§18 is **merged to `main` and live**, verified by driving
flyover-utx.vercel.app itself (not localhost): HTTP 200, `window.skyBodies` and
`window.__fly` present, 38 facade patterns registered, collision grid indexed,
45 shadows, 30 signs, snapshot `2026-07-27`, intro landing on the exact spawn
pose, zero page errors. **The verification harness is now in the repo** at
`scripts/verify/` with its own README — it lived in an ephemeral scratchpad
before, which §8 already records as expensive. `_harness.html` is tracked now
too; it was in `.git/info/exclude`, which is how the tooling got lost last time.

### `wn` is fixed at the source
`bake_detail.py` used to mix 30% of the warm `night_window` tint into the WALL,
landing the city on olive-khaki after dark. `js/facades.js` worked around it by
deriving its own night wall and ignoring `wn`. There is now ONE definition:
`bake_detail.py:night_wall()`, verified to produce **byte-identical values to the
old JS derivation across all 2,453 features (0 mismatches, worst channel diff 0)**,
so the workaround could be deleted with a guarantee of no visual change. All three
snapshots re-baked.

### The diff tour had never once run
`diff-tour.js` filtered for `f.geometry.type === 'Point'`, but
`diff_snapshots.py` emits **Polygon** footprints — so every feature was discarded
and it always reported "No changed buildings found in this diff." It also called
`d.includes()` on `manifest.diffs` entries, which are objects now (the same crash
class that took down `date-switcher.js`), and its height tween moved the wall but
not the roof cap, leaving a growing building's parapet hanging in mid-air.
All three fixed; centroids are derived from whatever geometry the diff carries.
Now verified end to end (`scripts/verify/difftour.mjs`, 9/9): banner reads
"1 / 12", camera flies 733 m to the first changed building, `next` advances to
2 / 12, and exit restores both height expressions.

### Trees: an upstream data gap, not a rendering bug — don't re-investigate
Measured: **zero trees within 200 m of spawn**, nearest 373 m, median distance
1,232 m, and over half of all 498 sit in two 400 m cells on the UT campus side.
The spawn is in West Campus, where OSM has no tree data at all.
`fetch_trees_landscape.py` already queries **both** `natural=tree` nodes *and*
`natural=tree_row` ways (interpolated every 8 m), so 498 is everything upstream
has — the same situation §13 records for building colours.
Where trees *do* exist they render well; screenshot the LBJ Library / Sid
Richardson walks at `[-97.7291, 30.2850]` to see hundreds of them.
**Do not synthesise West Campus street trees.** That is inventing geography, and
it contradicts both §1 ("everything is data-driven, not manually modelled") and
the playbook's rule about never inventing structure. If you want them, extend the
Overpass fetch or contribute to OSM.
One real fix applied: every canopy was the identical green, so a cluster read as
stamped copies. Canopy colour now interpolates over `h` (which already varies
7–15 m per tree), so bigger crowns read darker. No data change, one expression.

### Still not verified
**Nothing has been tested on a real iPhone.** Mobile checks use a synthetic
390×844 viewport with `hasTouch`. The joystick-plus-look fix, the two-finger
altitude gesture, and `mix-blend-mode: screen` over a WebGL canvas in Safari are
measured headless but not seen on real hardware. That is the next thing worth
doing, and it needs a human with the phone.

### Deliberately not done
The night dither — banding measured clean (`stepsOf2plus = 0` at every hour;
night shows ~9 px flat runs of single-code steps). Whether that still matters
after the skyglow band and lifted horizon should be **re-measured** before adding
another full-frame layer. `scripts/verify/banding.mjs` does the measurement.

---

## 18. July 29 2026 — sky, second pass (critique-driven)

A 5-agent critique of the sky built in §17 (cinematographer / art-director /
night-specialist lenses, plus a graphics-engineer recon that pulled MapLibre's
actual sky fragment shader out of the dist). It found one outright bug and two
structural defects, all in the default pitch-64 frame. Every number below was
re-measured here before acting on it.

**THE BUG — the horizon glow teleported at dusk.** `useMoon = !B.sunUp &&
B.moon.elev > -2` flips when the sun sets AND the moon crosses −2°, and those
coincide. Reproduced exactly: between p=0.5924 and p=0.5926 — **one frame of the
32 s auto cycle** — the glow's azimuth jumped **176.6°** (western horizon to
eastern) and its alpha dropped 0.459 → 0.168.
Fix: both bodies are now always drawn on independent schedules. The sun's
afterglow decays over its own elevation (`wSun`, reaching zero at −20°) while the
moon's rises over its own; they genuinely overlap from p=0.64, warm west and cool
east on screen together. **Measured worst frame-to-frame change: 0.291 → 0.00054,
a 540× reduction.**

**DEFECT 1 — the haze band was aimed below the horizon.** `#haze` is the only
layer in the sky stack with no blend mode, so it genuinely paints over geometry.
At pitch 64 / H=800 the horizon is at y=48 px and the old 13% stop peaked at
**y=61 — thirteen pixels below it** — laying 0.87 alpha just under the horizon and
still 0.48 at y=130, exactly where mid-distance rooflines live. Re-aimed to hug
the horizon: it now touches ~8 px of the 48 px of visible sky instead of 20, and
mid-distance alpha drops ~70%. This, not the sun bloom, was most of why golden
hour lost the mid-distance city.

**DEFECT 2 — the value ladder was inverted at both ends.**
- Day: road luma 231 > horizon 223 > sky 122. The pavement was the brightest
  thing in a daylight exterior and a wall had 13 codes of separation from the sky
  behind it. Deepened `sky` to `#21529f`, gave the horizon chroma (`#b7daec`),
  dropped the road to `#e2dac7`.
- Night: measured **sky luma 55.8 vs wall 21.2 → separation +34.6**, up from
  about −9 (the city glowed against a *darker* sky). Lifted the night horizon and
  fog, added an omnidirectional city-skyglow band at the horizon, softened the
  vignette.

**Two more real bugs found while implementing**
- *The sky was painting the city.* The horizon washes are ellipses centred on the
  horizon, so half of each landed below it — at dusk an 825×561 px lobe of deep
  red at 0.31 alpha screen-blended the **whole frame magenta, ground included**.
  Fixed by clipping the entire canvas sky pass to `y < horizon + 1.8%`. Light on
  buildings is `setLight`'s job; the sky's job stops at the horizon.
- *MapLibre's extrusion lighting doesn't tint, it DISTORTS — and it was making the
  roofs wine-purple.* Measured at golden hour: a baked roof of `#a1866b` (warm
  tan) rendered **`#543031`** at intensity 0.58 with a saturated light, `#8e5031`
  at 0.18, and `#7d6045` with a neutral light at 0.30. Same mechanism that turned
  the night roofs olive in §17. Day/golden intensity dropped to 0.28/0.30 with
  less saturated light colours; the *position* still comes from the shared sun,
  because that is the coherence shadows depend on.

**And one the critique's own measurement exposed:** the walls darkened on a
`p` schedule that lagged the sun, leaving them 60% golden-lit at p=0.7 when the
sun was already 8° below the horizon — an **inverted dusk silhouette** (sky 75.7
vs wall 88.5). `facades.js` now uses two night factors: `dark` (sun-elevation
driven) for the wall and its glass, `night` (p-driven) for the lit windows, whose
lag is deliberate — city lights come up as the sky finishes darkening. Dusk
separation went **−12.8 → +30.7**.

**Also:** twilight no longer lerps through khaki (a straight golden→night RGB lerp
put the haze at (174,123,87) at p=0.65 and dead-neutral (74,60,62) at p=0.875) —
four `DUSK` tracks route it orange → rose → violet → deep blue with saturation
held up, and their endpoints equal `PRESETS.golden`/`PRESETS.night` exactly so
there is no seam. `applyTimeOfDay` now quantises its expensive half to 1/128 of
p (**1,920 heavy passes per sweep → 128**) while the sky overlay still updates
every frame; and `setSky` drops from 7 properties to 3, since `fog-color`,
`horizon-fog-blend` and `fog-ground-blend` are terrain-only here.

**Banding, measured** (nobody had checked): `stepsOf2plus = 0` at day, golden and
night — every transition is a single code, so there are no hard edges. Night does
show ~9 px flat runs (21 unique colours over 192 px). A dither was deliberately
NOT shipped: its value depends on what the night sliver looks like after the
skyglow band and lifted horizon, and it should be re-measured before adding
another full-frame layer.

**Perf** (min-of-60, not mean — a mean on a busy machine measures the machine;
an earlier mean-based run reported *day* getting 3× slower after a change that
only touches the night path): sky overlay redraw at 900×800 is **1.0 ms night /
0.4 ms golden / 0.2 ms day**. Star halos are blitted from a cached sprite rather
than building ~78 `createRadialGradient` objects per frame.

Suites: sky 12/12, movement 14/14, collision 8/8, plus `duskcheck.mjs` and
`silhouette.mjs` in the scratchpad.

**Rejected, with reasons** (the judge's full list is in the workflow transcript):
pitch-driven `sky-horizon-blend` (rests on unverifiable MapLibre shader
internals, +5.7% day payoff, regresses night); crepuscular rays (most expensive
item, high-pitch-dominant); Milky Way and a high cirrus shelf (both live above
+3°, worth nothing at the default pitch); a directional downtown light dome
(downtown bears 179° against a spawn bearing of 90 — completely off-screen).

---

## 17. July 29 2026 — the sky (js/sky.js)

**Fixed a real incoherence first: there were TWO suns.** `shadows.js` walked its
own arc (az 150→245, elev 64→20) while `setLight` used another (az 205→252,
elev 58→14) — 55° apart at p=0. Shadows pointed one way and the scene was lit
from somewhere else. `skyBodies(p)` in `js/sky.js` is now the single source of
truth for shadow direction, MapLibre's light, and the visible disc. Verified:
`setLight` azimuth matches the shared sun to **0.00°**, and the shadow hulls
point anti-solar to within 2–9° wherever that is measurable.

Shadow opacity and existence now derive from the real solar **elevation** rather
than a hardcoded p, so they can never disagree with where the sun visibly is —
below the horizon there are no shadows at all.

**The geometry fact that drove the whole design.** MapLibre pitch is measured
from straight down, so the view axis is at `(pitch - 90)°` and the top of the
frame is at `(pitch - 90 + fov/2)°`. At the spawn pitch of 64 with a 58° FOV
that is **+3°** — you can see three degrees of sky. A sun disc is therefore
invisible at the default view no matter where you put it. So:
- the **horizon glow** (a wide gradient anchored to the sun's *azimuth* at the
  horizon) and a **low cloud band** carry the default frame;
- the **disc** is the reward for pitching up, or for golden hour;
- the **moon peaks at 24°**, not overhead — a moon high in the dome is a moon
  nobody ever sees at a flying pitch.

**Technique: DOM/canvas overlays with `mix-blend-mode: screen`.** Screen
blending can only ADD light, so a 97 m tower crossing the horizon line is never
painted over — it picks up bloom instead, which is what a bright sky does to a
silhouette. Elements: `#sky-canvas` (520 stars + 22 multi-lobe clouds),
`#sky-glow`, `#sky-bloom`, `#sky-core`. All `pointer-events:none`, all asserted
to be `screen` in the test suite.

**A custom WebGL layer was tried and rejected.** `{type:'custom'}` inserted at
the bottom of the style DOES own the sky — but it also painted over the ground
plane. Proven by rendering it solid magenta: the roads went magenta too, while
the buildings stayed correct. Screenshot-verified, not reasoned about.

**Bugs found and fixed while building it**
- Stars were weighted toward the zenith "to keep the horizon clean". Result: two
  visible stars, because at a flying pitch you only ever see the first ~20°.
  Now biased LOW (`1.5 + rnd^1.5 * 62`).
- Clouds were single blurred ellipses and read as smudges on the glass. Now
  clusters of 3–5 lobes.
- A canvas `createRadialGradient` was built BEFORE `translate`/`scale`, so it
  landed nowhere near the shape it filled. Build gradients after the transform,
  centred on the origin.
- The haze band reached 7% above the horizon, which at the spawn pitch meant the
  haze — not the sky gradient — was most of the visible sky. Pulled to 2.5%.

**Three harness traps worth remembering** (each produced a confident false
failure before being understood):
1. `GeoJSONSource` does not expose `_data` in v5 — use `querySourceFeatures`.
2. After `setData`, the source **re-tiles in a worker**. Sampling 700 ms later
   returned the *previous* hour's shadows and made the test report a 43° error.
   Wait for `idle`.
3. `pitch = 90 + sunElev` is clamped by `maxPitch: 85`, so "look straight at the
   sun" does not put it at screen centre. The disc's 109 px offset was *correct*.
   The fixed assertion predicts the position from the actual pose and matches
   **pixel-exactly** (450,201 predicted, 450,201 measured).

Also: `MAX_LENGTH = 2.4` caps shadow reach on purpose, so below ~22.6° of solar
elevation shadows stop lengthening. Any test asserting "lower sun → bigger
shadows" must encode that cap or it fails on correct behaviour.

Suite: `scratchpad/verify-sky.mjs` — 12/12. Movement 14/14 and collision 8/8
still pass.

---

## 16. July 29 2026 — the movement system rewrite (FLYCAM)

`js/controls.js` was rewritten. A 5-lens audit produced 75 candidate defects; 47
survived adversarial verification. The headline ones were then reproduced and
measured in a headless harness before anything was changed — several
"obvious" readings turned out to be wrong until measured.

**The one structural change.** The camera EYE is now the state; MapLibre's
`center`/`zoom` are OUTPUTS, derived once per frame and written with a single
`map.jumpTo()`. Nothing else in the file calls setCenter/setZoom/setBearing/
setPitch. Steering `center` in degrees is what made a whole family of defects
*expressible*; steering the eye in metres makes them unrepresentable.

**Measured before → after** (headless, 800×560, timing-independent):

| | before | after |
|---|---|---|
| east/west vs north/south speed | 0.854 | **1.000** |
| diagonal (W+D) vs cardinal | 1.445 | **1.001** |
| one tap of Q at spawn | zoom 16.5 → **13.35**, then dead | 16.5 → 16.33, keeps working |
| 4 s of "descend" on E | camera at **9.8 km** | descends normally |
| drag-to-look at fixed zoom | altitude 302 → 187 m | **211 → 211 m** |
| key held while window blurs | flies away forever | released |
| WASD while a slider is focused | camera moves 6.2 m | **0.0 m** |
| assertion suite | 4/14 | **22/22** |

**The five defects that mattered most**
1. `zoomToAlt()` returned Web-Mercator **metres-per-pixel**, not altitude — 1.69
   at the spawn zoom where the camera was really 230 m up. Both Q and E clamped
   to `MIN_ALT` on the first frame and teleported to zoom 13.35; `scrollZoom` is
   off, so on desktop there was **no way back except reloading**.
2. Longitude deltas were never divided by `cos(latitude)`, so E/W ran 13% slow
   and any diagonal heading crabbed ~4° off course — 35 m of drift over 500 m.
3. The input vector was never normalised: W+D was 41% faster than W.
4. On mobile the joystick thumb was counted in `TouchEvent.touches`, so the
   canvas entered pinch-zoom the moment a second thumb landed. **Moving and
   looking at the same time was impossible** — the one scheme the UI advertises.
5. No blur/visibilitychange reset, so alt-tabbing mid-flight left the key down
   and the camera flying forever. Keys are now indexed by `e.code`, not `e.key`
   (macOS Option+W reports `∑` on keydown and `w` on keyup, which latches a
   key-indexed map permanently).

**What's new:** altitude-scaled speed (6 m/s at street level for reading signs,
~40 m/s at spawn, Shift ×2.5); acceleration and glide (τ 0.20 s / 0.45 s);
wheel-to-altitude on desktop; two-finger and double-tap-drag altitude on mobile;
look works anywhere on the canvas (the right-half-only gate is gone); R returns
home; a soft fence at the data edge; chrome that fades while flying and comes
back after 4 s.

**Collision.** A 6 m max-roof grid built from the in-memory snapshot at load
(626 KB, ~155 k cells, footprints *rasterised* not bbox-stamped). Small 6 m probe
on purpose: a large anticipatory probe lifts the camera over the buildings
flanking every West Campus street, which would make "fly down the street and
read the signs" unreachable. Verified: 528 sampled frames of randomised
low-altitude flight with a worst clearance of 18.55 m and never once inside;
a street flight starting at 24 m between 21 m buildings peaks at **24 m** (zero
unrequested lift); flying at the 98 m tower from 140 m out **brakes and stops
6 m from it** rather than entering or climbing over.

**Three traps, all of which cost real time here**
- **MapLibre uses 512-px tiles.** The `156543.03392` constant in every tutorial
  is the 256-px convention and gives exactly **2× the true altitude**. Use
  `C = 40030228.884` and `/(512 * 2^z)`. Two of the audit's own suggested fixes
  contained this error.
- **`map.getFreeCameraOptions()` does not exist in MapLibre 5.24** (that is
  Mapbox). Verified `undefined` at runtime. `map.transform.getCameraAltitude()`
  and `getCameraLngLat()` do exist and were used to check the closed forms.
- **`setPointerCapture` can throw**, and an unguarded call takes the whole
  `pointerdown` handler with it — which silently disables look. Wrap it.

**A bug this rewrite introduced and then caught:** `driving` initially included
`altFloor > 0.05`. Because the floor is a standing *response* rather than an
intent, that pinned `driving` true forever whenever the camera rested over a
building, so the controller would have owned the camera permanently and stomped
on the intro, the R reset and the diff tour. It now compares against the
*resolved* target altitude. Verified: after the 9 s intro, `driving === false`
and `tickMsAvg === 0` — the controller never wrote a frame during the cinematic.

**Also fixed:** `DT_BAIL` was 0.25 s, which was meant to swallow tab-restore gaps
but actually discarded **every frame slower than 4 fps** — measured 8.85 m/s
against a 40 m/s target on a slow renderer. Now 1.0 s, with `DT_MAX` 0.1 s and a
substepped collision walk so a longer step still cannot tunnel through a facade.

**Verification lives in the session scratchpad** (`verify-movement.mjs`,
`verify-collision.mjs`). Both drive the real `index.html`. The key trick: measure
against the camera's **own integrated time** (`window.__fly.simTime()`), never
wall-clock — headless swiftshader runs at 4–20 fps here, so wall-clock speed
measures the renderer, not the movement system. `window.__fly` also exposes
`eye()`, `roofAt()`, `indexed()` and `gridBytes()` for assertions. Seeded tests
must wait for `!driving` **before** placing the camera; the controller owns the
camera while flying and will overwrite an external `jumpTo` on the next frame.

---

## 15. July 29 2026 — the art pass that was still owed (current state)

The July 10 overhaul got the *engine* right and the *look* wrong. This pass was
purely visual, driven by a real render→pixel-sample→assert loop rather than
reasoning (see "verification" below). What changed, and why:

**Facades — buildings have windows now.** MapLibre v5's
`fill-extrusion-pattern` tiles in WORLD space, so a window grid keeps a
constant physical size as you fly. That is the single biggest upgrade available
to a fill-extrusion city, and it's what §14 assumed was impossible here.
The catch: a pattern REPLACES `fill-extrusion-color`, so per-building colour
would be lost. `js/facades.js` fixes that by quantising the 911 baked wall
colours into ~14 adaptive buckets and generating one canvas pattern per
(facade family × bucket) — 38 images in practice. Families are `lo` / `md` /
`tw` / `dk` (low-rise, walk-up, tower, parking deck) picked from height+class.
The atlas is repainted in place (`map.updateImage`) whenever the time-of-day
changes, so glass is cool-dark by day, amber at golden hour, and a varied
scatter of windows lights warm at night.
*The 14-bucket flattening is a feature, not a compromise — 14 deliberate tones
beat 911 muddy near-duplicates.*

**Ground shadows.** MapLibre has no shadow casting, and `fill-translate` isn't
data-driven, so every building would cast the same shadow regardless of height.
`js/shadows.js` builds real geometry instead: per footprint, offset a copy by
`height / tan(sun elevation)` away from the sun and take the convex hull of
both — the swept silhouette. Derived on the client from the GeoJSON that's
already downloading, so it costs zero payload and the sun swings with the
slider (debounced 140 ms).

**Label declutter.** This was the worst offence: ~70 rainbow-coloured labels
covered 60% of every frame and read as a debug overlay. Fixes: OSM names are
gated to zoom ≥16.4 and height ≥12 m, sorted so tall buildings win placement,
and **deduped against the curated signs** ("The Mark" / "The Mark Austin" both
showed). Curated signs are calm cream by day and only take their brand colour
after dark, which is when a lit sign is supposed to be what you notice.
383 named buildings → 184 eligible; visible-at-once dropped by roughly 4×.

**Atmosphere.** `js/atmosphere.js` is a horizon haze band tracking the camera
pitch. **MapLibre's `setSky` fog does not work for this** — sweeping
`fog-ground-blend` from 0 to 1 leaves every ground and building pixel
bit-identical (measured). That fog only paints the sky dome. The DOM band gives
the scene aerial perspective and buries the straight seam where the bbox ends.

**Two measured bugs worth remembering:**
- *Night was olive.* `bake_detail.py` mixes 30% of a warm "lit window" tint into
  the WALL colour (`wn = lerp(dark, night_window, 0.30)`), landing the whole
  city on mid olive-khaki (#63615b, #7b6d53) after dark. Now that windows carry
  the light, `facades.js` derives a proper dark cool wall from `wd` and ignores
  the baked `wn`. (The baked `wn` is still in the data; nothing re-baked.)
- *`setLight` intensity lifts and warms extrusion faces.* At intensity 0.3 the
  baked navy roof `#10121d` rendered `#312c1b` — an olive tarp over the night
  city. At intensity ~0 the baked colour comes through. Night now runs at 0.04.
  If a colour ever renders "wrong but plausible", suspect the light first.

**Also fixed / added:**
- `date-switcher.js` crashed on `d.match is not a function` — manifest `diffs`
  are objects now, not strings. That crash was silently killing **everything
  after it in the init sequence** (sky, shadows, signage, the intro). Init is
  now stage-isolated (`step()` in app.js) so one failure can't cascade.
- A `text-opacity` expression nesting two zoom curves inside a `case` was
  rejected outright ("Only one zoom-based step or interpolate subexpression may
  be used") — and a rejected paint property takes the whole layer with it.
  Zoom-interpolate on the outside, `case` in the outputs.
- The `2026-07-27` snapshot was dead data: no detail bake, not in the manifest.
  Baked and registered; it's now `latest`, which also lights up the date
  switcher and the 12-building diff vs `2026-07-11`.
- Sign ground-glow pools were 60 px at z16 / 380 px at z19 and merged into one
  wash; tightened to 20/150 at 0.2 opacity.
- Cinematic dolly-in on load (9 s, cancels on any input); chrome fades back
  once you take the controls; roads widened into readable ribbons with casings;
  restyled HUD; inline SVG favicon.

**Verification (this is the part to keep).** `scratchpad/shot.mjs` +
`_harness.html` drive the REAL app in headless Chrome and screenshot it.
Critical details:
- The bundled Playwright Chromium on this machine is broken ("side-by-side
  configuration is incorrect"); launch with
  `executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'`.
- `_harness.html` forces `preserveDrawingBuffer: true` so `gl.readPixels` can
  sample **our own output** — assert on hex values, don't eyeball.
- To find which layer owns a pixel, hide layers one at a time and diff. That's
  how the olive was pinned to `buildings-roof`, and how "roads are the problem"
  was disproved (paint every line layer magenta — one render settles it).
- **Data-driven paint expressions and the facade atlas do not land in the same
  frame as the call.** A screenshot taken too soon after a big time-of-day jump
  shows the PREVIOUS state — that's what produced a "black roofs" and
  "brand-coloured day labels" scare that did not reproduce in a fresh session.
  Settle ~4 s, `triggerRepaint`, then screenshot twice and trust the second.

---

## 14. Where the project went next (July 11–12, 2026)

Simeon judged the July 10 overhaul **1/10 vs expectations** — fill-extrusion
prisms can never deliver real facades (Union on 24th's checkered panels,
recessed windows, terraces). The visual ambition moved to a sibling project:
**`Projects/utx-diorama`** — Google Photorealistic 3D Tiles + Blender diorama
stage + a three.js "workbench" where hero buildings are rebuilt procedurally
from architect reference photos. Read **`utx-diorama/PROJECT_OVERVIEW.md`**
for the full journey and its lessons. This repo stays live (flyover-utx.vercel.app)
and untouched; its baked data (`buildings.detailed.geojson`, `signs.json`,
`hero_designs.json`) feeds the diorama's footprint/palette pipelines.

---

## Acer lane, overnight 2026-08-01 — branch `acer/windows-pass`, PR #27

Eleven commits. Full detail in the PR body; the four things worth carrying
forward:

1. **`fill-extrusion-pattern` is TILE-anchored and cross-fades between tile zoom
   levels.** That is the whole cause of the city-wide "glitchy whenever I move".
   Every patterned GeoJSON source must spread `window.PATTERN_TILING`
   (`js/app.js`). If you add a new patterned source and skip it, the flicker comes
   back on that source alone — which is exactly how `js/outer.js` kept it after
   everything else was fixed.

2. **Anything that drives time of day must call `window.applyTimeOfDay`, never a
   module-local copy.** Five passes wrap the window property to retint their own
   geometry. Calling the local original is why the Tower "took five minutes to
   turn orange" — it was never asked to.

3. **`scripts/verify/zfight.mjs` cannot see texture crawl.** It gates candidates
   on a flat 3x3 neighbourhood, which is right for a z-fighting surface and
   structurally blind to a shimmering window grid. Use
   `scripts/verify/shimmer.mjs` for anything that moves under camera motion.

4. **A green test on known-broken code is the only real proof a test works.**
   `retint.mjs`'s first assertion passed on the broken build, because sky and
   ground always did retint and they dominate a frame mean. Always run a new
   assertion against the bug it is meant to catch before trusting it.

Two traps recorded in the scripts themselves rather than here:
`scripts/reseat_authored_roofs.py` (deleting 274 roof facets would have flattened
Gregory Gym and the Union Building to fix a bug they did not have) and
`scripts/bake_detail.py`'s part coverage gate (scaling a part up to
`final_height` is worse than either failure).

**Non-bug, do not chase:** `js/graphics.js` does NOT call the broken
`transform.horizonLineFromTop()`. It reads `F.horizonPx` from `window.skyFrame`,
built by `js/sky.js:166-171` from the correct closed form.
