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

# Output locations (committed back to the repo by the GitHub Action).
export DATA_DIR="data"
export BUILDINGS_GEOJSON="${DATA_DIR}/buildings.geojson"
export BUILDINGS_ENRICHED="${DATA_DIR}/buildings.enriched.geojson"
export BUILDINGS_PMTILES="${DATA_DIR}/austin.pmtiles"

# Default storey height (metres) for the levels->height fallback.
export METERS_PER_LEVEL="3.2"
