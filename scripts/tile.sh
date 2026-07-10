#!/usr/bin/env bash
# Step 3 of the data pipeline: pack enriched footprints into a single PMTiles
# archive the app loads directly from GitHub Pages (no server, no tile requests).
# Requires tippecanoe (>= 2.x, which writes .pmtiles natively).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/config.sh

echo "Building ${BUILDINGS_PMTILES} from ${BUILDINGS_ENRICHED}"

tippecanoe \
  -o "${BUILDINGS_PMTILES}" \
  --force \
  --layer=buildings \
  --minimum-zoom=13 \
  --maximum-zoom=16 \
  --no-feature-limit \
  --no-tile-size-limit \
  --preserve-input-order \
  "${BUILDINGS_ENRICHED}"

echo "Done: ${BUILDINGS_PMTILES}"
ls -lh "${BUILDINGS_PMTILES}"
