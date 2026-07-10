# Data pipeline

Turns real-world data into a dated **snapshot** of Austin's buildings that the
app loads for accurate footprints + heights. Designed to run **in a GitHub
Action** so you never need a computer (see `.github/workflows/build-data.yml`) —
but every step also runs locally if you have the tools. Nothing here is a live
feed: each run bakes a fixed, dated file. Nothing updates in the background.

## The pipeline

| Step | Script | Input → Output | Tool |
|---|---|---|---|
| 1. Extract | `extract.sh` → `extract_overture.sql` | Overture S3 → `data/snapshots/<date>/buildings.geojson` | DuckDB |
| 2. Enrich | `enrich.py` | `+ OSM names + height fallback + known-building corrections` → `.../buildings.enriched.geojson` | Python + Overpass |
| 3. Tile | `tile.sh` | → `.../austin.pmtiles` | tippecanoe |
| 4. Diff | `diff_snapshots.py` | previous snapshot + new snapshot → `data/diffs/<from>_to_<to>.geojson` | Python |
| 5. Manifest | `update_manifest.py` | scans `data/snapshots` + `data/diffs` → `data/manifest.json` | Python |

Steps 4–5 only need to run in the GitHub Action (they compare against whatever
was already committed); running steps 1–3 locally is enough for a one-off test.

## Configure

Edit `scripts/config.sh`:
- **Bounding box** — the modeled area (defaults to UT + West Campus + The Drag).
- **`OVERTURE_RELEASE`** — leave as `latest` (auto-detects the newest release
  that exists in Overture's bucket). Only pin a `YYYY-MM-DD.N` tag for a fixed,
  reproducible source. `OVERTURE_RELEASE_FALLBACK` is used if detection fails.
- **`METERS_PER_LEVEL`** — storey height for the `levels → height` fallback.
- **`SNAPSHOT_DATE`** — defaults to today (UTC); override for a backfill run.

## Height fallback chain (accuracy order)

`enrich.py` fills `final_height` per building, best source first:

1. **Overture `height`** — inferred from USGS 3DEP LiDAR (best).
2. **OSM `height` / `building:height`**.
3. **OSM `building:levels` × `METERS_PER_LEVEL`**.
4. **Overture `num_floors` × `METERS_PER_LEVEL`**.
5. **Class default** (see `CLASS_DEFAULT` in `enrich.py`).

`source_height` on each feature records which one was used, so you can QA which
buildings are guessed vs. LiDAR-measured.

## Known-building corrections (`hero_overrides.json`)

Fully automatic and fully optional — no 3D modeling, no manual work required to
use this pipeline. `hero_overrides.json` is just a short list of `{name,
height}` pairs for a handful of landmark buildings (UT Tower, Dobie, etc.) where
the automatic sources are wrong or missing, pre-filled with reasonable public
figures. It's plain data: edit a number if you spot one that's off, or leave the
file alone entirely — everything else renders automatically from Overture/OSM
either way, as a simple extruded volume like the rest of the city.

## Versioning — snapshots, diffs, and "what changed"

Every run writes to `data/snapshots/<YYYY-MM-DD>/` instead of overwriting the
last run. Nothing is ever deleted or replaced.

If a previous snapshot exists, the pipeline also compares it against the new
one (`diff_snapshots.py`, matched by Overture's stable building id) and writes
`data/diffs/<from>_to_<to>.geojson` — every building that was added, removed, or
changed height by more than 1 m.

`data/manifest.json` indexes all of this for the front end:
```json
{
  "snapshots": ["2026-01-01", "2026-07-10"],
  "latest": "2026-07-10",
  "diffs": [
    { "from": "2026-01-01", "to": "2026-07-10", "file": "diffs/2026-01-01_to_2026-07-10.geojson", "changed_count": 4 }
  ]
}
```

The intended front-end feature (not yet built): a date switch to view the city
as of a given snapshot, plus a "what changed" mode that flies to each building
in a diff file and animates it between `old_height` and `new_height`.

## Run it from your phone (Kiro)

1. Open the repo on GitHub mobile → **Actions** → **Build Austin building data**.
2. **Run workflow** on the branch you're working from.
3. It commits the new dated snapshot (and a diff + updated manifest, if a
   previous snapshot exists) — the app picks up `manifest.json` on next load.
