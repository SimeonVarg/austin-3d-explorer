#!/usr/bin/env bash
# Shared configuration for the data pipeline.
# Edit these values to change the modeled area or the Overture release used.

# Bounding box: UT core + West Campus + The Drag (Guadalupe).
# Widen if you want more of downtown as backdrop.
export BBOX_MIN_LON="-97.752"
export BBOX_MIN_LAT="30.276"
export BBOX_MAX_LON="-97.726"
export BBOX_MAX_LAT="30.296"

# Overture Maps release to pull. Overture ships monthly; bump this to the latest
# release tag from https://docs.overturemaps.org/release/latest/
# Format is YYYY-MM-DD.N
export OVERTURE_RELEASE="2025-06-25.0"

# Overture S3 bucket (public, no credentials required).
export OVERTURE_S3="s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}"

# Every pipeline run produces a dated SNAPSHOT, never overwrites a previous one.
# This is what makes the "pick a date" / before-after-animation feature possible.
# Override with e.g. SNAPSHOT_DATE=2026-01-01 scripts/extract.sh for a backfill.
export SNAPSHOT_DATE="${SNAPSHOT_DATE:-$(date -u +%Y-%m-%d)}"

# Output locations (committed back to the repo by the GitHub Action).
export DATA_DIR="data"
export SNAPSHOT_DIR="${DATA_DIR}/snapshots/${SNAPSHOT_DATE}"
export BUILDINGS_GEOJSON="${SNAPSHOT_DIR}/buildings.geojson"
export BUILDINGS_ENRICHED="${SNAPSHOT_DIR}/buildings.enriched.geojson"
export BUILDINGS_PMTILES="${SNAPSHOT_DIR}/austin.pmtiles"
export MANIFEST_JSON="${DATA_DIR}/manifest.json"
export DIFFS_DIR="${DATA_DIR}/diffs"

# Default storey height (metres) for the levels->height fallback.
export METERS_PER_LEVEL="3.2"
