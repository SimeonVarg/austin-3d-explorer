# Data pipeline

Turns real-world data into `data/austin.pmtiles`, the single file the app loads
for accurate footprints + heights. Designed to run **in a GitHub Action** so you
never need a computer (see `.github/workflows/build-data.yml`) — but every step
also runs locally if you have the tools.

## The three steps

| Step | Script | Input → Output | Tool |
|---|---|---|---|
| 1. Extract | `extract.sh` → `extract_overture.sql` | Overture S3 → `data/buildings.geojson` | DuckDB |
| 2. Enrich | `enrich.py` | `+ OSM names + height fallback + hero overrides` → `data/buildings.enriched.geojson` | Python + Overpass |
| 3. Tile | `tile.sh` | → `data/austin.pmtiles` | tippecanoe |

## Configure

Edit `scripts/config.sh`:
- **Bounding box** — the modeled area (defaults to UT + West Campus + The Drag).
- **`OVERTURE_RELEASE`** — bump to the latest tag from
  https://docs.overturemaps.org/release/latest/
- **`METERS_PER_LEVEL`** — storey height for the `levels → height` fallback.

## Height fallback chain (accuracy order)

`enrich.py` fills `final_height` per building, best source first:

1. **Overture `height`** — inferred from USGS 3DEP LiDAR (best).
2. **OSM `height` / `building:height`**.
3. **OSM `building:levels` × `METERS_PER_LEVEL`**.
4. **Overture `num_floors` × `METERS_PER_LEVEL`**.
5. **Class default** (see `CLASS_DEFAULT` in `enrich.py`).

`source_height` on each feature records which one was used, so you can QA which
buildings are guessed vs. LiDAR-measured.

## Hero overrides

`hero_overrides.json` lets you hand-correct recognizable buildings (UT Tower,
Dobie, etc.) by name. These win over every automatic source and set the correct
display name. Add the tallest/most-recognizable West Campus towers here as you
verify their real floor counts. These are also your candidates for hand-modeled
glTF hero geometry (see `RESEARCH.md` §2).

## Run it from your phone (Kiro)

1. Open the repo on GitHub mobile → **Actions** → **Build Austin building data**.
2. **Run workflow** on the `claude/austin-3d-environment-plan-28jgco` branch.
3. It commits `data/austin.pmtiles` back — the app picks it up on next load.
