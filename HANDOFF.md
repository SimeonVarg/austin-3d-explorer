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
