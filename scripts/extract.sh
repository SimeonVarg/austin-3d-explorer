#!/usr/bin/env bash
# Step 1 of the data pipeline: pull Overture buildings for the bbox into GeoJSON.
# Requires DuckDB (with spatial + httpfs extensions, installed by the SQL script).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/config.sh

mkdir -p "${SNAPSHOT_DIR}"

echo "Extracting Overture buildings for bbox [${BBOX_MIN_LON},${BBOX_MIN_LAT} -> ${BBOX_MAX_LON},${BBOX_MAX_LAT}]"
echo "Release: ${OVERTURE_RELEASE}  |  Snapshot date: ${SNAPSHOT_DATE}"

# DuckDB reads bbox + S3 path from the environment (getenv in the SQL). The output
# path is dated (data/snapshots/<date>/...), so it's substituted in since DuckDB's
# COPY ... TO clause needs a literal path, not an expression.
tmp_sql="$(mktemp)"
sed "s#__OUTPUT_PATH__#${BUILDINGS_GEOJSON}#" scripts/extract_overture.sql > "${tmp_sql}"
duckdb :memory: < "${tmp_sql}"
rm -f "${tmp_sql}"

count=$(python3 -c "import json,sys; print(len(json.load(open('${BUILDINGS_GEOJSON}'))['features']))")
echo "Wrote ${count} building footprints to ${BUILDINGS_GEOJSON}"
