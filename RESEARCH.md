# Research Addendum — Making Austin 3D Explorer *Accurate*

> Companion to `PLAN.md`. This document captures research (July 2026) into how to
> make the low-poly recreation **geographically and architecturally accurate**,
> which is the project's stated priority. Read `PLAN.md` for the overall vision;
> read this for the data-and-accuracy strategy that supersedes the original
> "OSM `building:levels`" approach.

---

## TL;DR — What changes vs. the original plan

| Original plan | Problem | Better approach |
|---|---|---|
| Heights from OSM `building:levels` | <20% completeness in most cities; West Campus is a patchwork | **Overture Maps** buildings (LiDAR-derived heights) with OSM fallback |
| Footprints from OSM only | Crowd-sourced, uneven | **City of Austin** LiDAR-digitized footprints + Overture merge |
| Live Overpass query at runtime | Slow, rate-limited, non-deterministic, and the scene would silently drift as OSM changes | **Pre-bake** into dated, versioned snapshots — never a live feed |
| Flat ground | West Campus slopes to Waller Creek | **Terrain DEM** (MapLibre `raster-dem`) |
| No way to see the city age | Buildings do go up/down; a static site would just quietly go stale | **Dated snapshots + diffs** power a date switch and a before/after change animation |
| Trust OSM `name` tag for signs | Names/branding lag reality | **Verify 2026 names/colors/logos** in the (optional) corrections file |
| Do everything on-device (phone) | Overture/DuckDB/tippecanoe are not phone tools | **GitHub Action** runs the whole data pipeline in the cloud, triggered by a button |
| Manual 3D modeling of landmark buildings | Not something you want to do by hand | **Fully automatic:** every building, including landmarks, renders from Overture/OSM data; only optional *numbers* (not shapes) can be corrected |

---

## 1. Data sources (ranked, all free)

### Buildings — footprints + heights
- **Overture Maps – Buildings theme** — 2.6B footprints merging OSM + Microsoft +
  Google + Esri. Crucially, heights are **inferred from USGS 3DEP aerial LiDAR**
  (rooftop elevation minus ground elevation), not guessed from floor counts. This
  is the single biggest accuracy upgrade. Distributed as GeoParquet on S3;
  queryable with DuckDB. Open data (ODbL/CDLA).
- **City of Austin building footprints (2013)** — heads-up digitized from
  2012/2013 orthoimagery + 2012 LiDAR. City-maintained, clean footprints. Good for
  cross-checking Overture in the core.
- **Fallback height chain:** `Overture height` → `OSM height` →
  `OSM building:levels × 3.2 m` → default by `class`.

### Terrain
- **Austin 2021 elevation / contours** (Austin GeoHub) or **USGS 3DEP DEM** — used
  to (a) place buildings on real ground elevation and (b) drive MapLibre terrain so
  the West Campus → Waller Creek slope reads correctly.

### Names, brands, POIs, nature — keep OSM here
- **Overpass API** remains the gold standard for *labels*: `name`, `brand`,
  `addr:*`, `amenity`, plus trees (`natural=tree`), water (Waller Creek), parks
  (Eastwoods). Use OSM for *what things are called*, not *how tall they are*.

### Reference-only (do NOT ship)
- **Google Photorealistic 3D Tiles** — ruled out: contradicts low-poly, needs a
  client-exposed API key, and only **1,000 free 3D-tile events/month** (a public
  link would exhaust it immediately). Use it privately only to eyeball hero shapes.
- **UT interactive campus map** (598 buildings) — reference for footprint/name
  validation: https://experience.arcgis.com/experience/81d900a3c906482e9731a7a71eaaa178

---

## 2. Geometry strategy — fully automatic, no manual modeling

Every building — landmarks included — renders the same way: `fill-extrusion`
from the baked footprint + `final_height`. MapLibre extrudes the footprint
straight up into a flat-topped prism. No one hand-models anything in a 3D tool.

This means "detail" for a given building is purely a function of how good its
*data* is, not of manual effort:
- Where OSM has `roof:shape` / `roof:height`, use it — gets non-flat roofs on
  some buildings for free, still 100% automatic.
- For a short list of landmark buildings (UT Tower, Dobie Twenty21, Gregory Gym,
  etc.), `scripts/hero_overrides.json` lets you correct just the *height number*
  or *display name* if the automatic sources are wrong — still plain data entry,
  not modeling. See `scripts/README.md`.
- If Overture ever adds richer per-building shape data (setbacks, roof
  geometry) it plugs into this same pipeline automatically — nothing about the
  app needs to change to take advantage of it later.

**Bottom line:** if a landmark isn't well-represented by the data, it's a plain
box like everything else — that's an acceptable outcome, not a gap to fill by
hand.

---

## 3. Signs & labels — the authenticity trick, done right

Signs are flat billboard planes at real GPS coordinates. To make them *accurate*:
- **Verify current (2026) names** — West Campus rebrands constantly. Examples to
  re-check: Dobie → **Dobie Twenty21**, plus Rise, The Castilian, The Villas,
  Skyloft, Moontower, 26 West, Villas on Rio, etc.
- **Correct colors + logos** — pull real brand colors; a recognizable color block
  reads as "real" even without a photo.
- **Correct placement** — anchor each sign to the right facade and a plausible
  height, not the footprint centroid.

---

## 4. Terrain — don't ship flat ground

West Campus slopes down toward Waller Creek; flat ground looks wrong near the
creek and Dean Keeton. MapLibre has native terrain via a `raster-dem` source +
`setTerrain`. Bake a small DEM tile set for the bounding box from Austin/USGS
elevation data and enable hillshade for subtle relief.

---

## 5. Scope — tighten "downtown Austin"

- **High detail:** UT core + West Campus + The Drag (Guadalupe).
- **Low-detail backdrop only:** the actual downtown skyline (Frost, the
  "Jenga"/Independent tower) as simple extrusions on the horizon.
- Detailing all of downtown will blow the time budget without adding to the
  UT/West-Campus experience that is the point.

**Working bounding box** (UT core + West Campus + The Drag):
`min_lon -97.752, min_lat 30.276, max_lon -97.726, max_lat 30.296`
(edit in `scripts/config.sh` if you want to widen it.)

---

## 6. Validation loop

Before trusting a snapshot, overlay the baked footprints/heights against:
- recent satellite imagery (footprint alignment), and
- the UT interactive campus map (names + which building is which).

Catch bad footprints/heights in the data, using `source_height` (see
`scripts/README.md`) to see which buildings were guessed vs. LiDAR-measured.

---

## 7. Versioning — snapshots instead of a live feed

Explicitly **not** a live map. Every pipeline run bakes a fixed, dated snapshot
(`data/snapshots/<date>/`) and never overwrites a previous one. This is what
makes two things possible:

- **A date switch** — view the city as it was baked on any past run, not just
  "now."
- **A change animation** — when a run finds a previous snapshot, it
  automatically diffs the two (matched by Overture's stable building id) and
  writes every building that appeared, disappeared, or changed height to
  `data/diffs/<from>_to_<to>.geojson`. The front end can fly to each one and
  animate `old_height → new_height`.

`data/manifest.json` indexes all snapshots and diffs for the front end to read.
See `scripts/README.md` §"Versioning" for the exact file format and
`scripts/diff_snapshots.py` / `scripts/update_manifest.py` for the
implementation. The front-end date picker + animation UI itself is not built
yet — the data side is ready for it.

---

## 8. Phone-first workflow (Kiro + GitHub)

The accuracy pipeline uses tools that don't run on a phone (DuckDB over Overture
GeoParquet, `tippecanoe`). Solution: **run the data pipeline in a GitHub Action**
you trigger from Kiro. It fetches Overture for the bbox, builds the height
fallback chain, enriches with OSM names, diffs against the last snapshot, and
commits everything back to the repo. You never need a computer for any of it —
there is no separate modeling step that requires a desktop.

See `.github/workflows/build-data.yml` and `scripts/` for the concrete pipeline.

---

## Sources
- Austin GeoHub / building footprints (LiDAR-digitized): https://geohub.austintexas.gov/ ·
  https://data.austintexas.gov/dataset/Building-Footprints-Year-2013/7bns-7teg
- Overture Maps buildings (LiDAR-derived heights): https://docs.overturemaps.org/guides/buildings/ ·
  https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/overture-maps-data-in-arcgis
- OSM vs Overture: https://giscarta.com/blog/openstreetmap-vs-overture-maps-which-is-right-for-your-project
- OSM building-attribute quality: https://www.sciencedirect.com/science/article/pii/S0360132323003220
- MapLibre + Three.js custom layer: https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/
- MapLibre 3D extrusions: https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/
- Google Photorealistic 3D Tiles billing: https://developers.google.com/maps/documentation/tile/usage-and-billing
- UT Libraries GIS / Texas GeoData Portal: https://guides.lib.utexas.edu/gis
- UT interactive campus map: https://experience.arcgis.com/experience/81d900a3c906482e9731a7a71eaaa178
