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
| Live Overpass query at runtime | Slow, rate-limited, non-deterministic | **Pre-bake** into a bundled PMTiles/GeoJSON file |
| Flat ground | West Campus slopes to Waller Creek | **Terrain DEM** (MapLibre `raster-dem`) |
| `fill-extrusion` = "high detail" | Flat-topped prisms look generic | **Hybrid:** extrusions for mass, glTF for ~10 hero buildings |
| Trust OSM `name` tag for signs | Names/branding lag reality | **Verify 2026 names/colors/logos** manually |
| Do everything on-device (phone) | Overture/Blender are not phone tools | **GitHub Action** runs the data pipeline in the cloud |

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

## 2. Geometry strategy — "high detail" done honestly

MapLibre `fill-extrusion` produces flat-topped prisms. That's fine for the
*background city*, but it is **not** "high detail." Split the work:

- **Background buildings (~hundreds):** `fill-extrusion` from baked footprints +
  heights. Cheap, fast on mobile. Use `roof:shape` / `roof:height` where OSM has it
  so not every roof is flat.
- **Hero buildings (~10):** hand-modeled glTF with setbacks, stepped profiles,
  recognizable rooftops (UT Tower, Dobie Twenty21's stepped tower, McCombs' angular
  glass, Gregory Gym). Placed via the MapLibre **Three.js custom layer** (or
  `maplibre-three-plugin`), which shares MapLibre's depth buffer and camera so the
  models sit correctly among the extrusions.

**Hero build workflow (desktop step, one-time):** start from the real footprint,
extrude to the correct height, add setbacks/roof from photos, export glTF. Keep
poly counts low — stylization is the goal, not photoreal.

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

Before modeling heroes, overlay the baked footprints/heights against:
- recent satellite imagery (footprint alignment), and
- the UT interactive campus map (names + which building is which).

Catch bad footprints/heights in data, not in 3D.

---

## 7. Phone-first workflow (Kiro + GitHub)

The accuracy pipeline uses tools that don't run on a phone (DuckDB over Overture
GeoParquet, `tippecanoe`, Blender). Solution: **run the data pipeline in a GitHub
Action** you trigger from Kiro. It fetches Overture for the bbox, builds the
height fallback chain, enriches with OSM names, and commits `data/austin.pmtiles`
back to the repo. You never need a computer for the data step; only the one-time
hero glTF modeling benefits from a desktop (and can be done incrementally).

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
