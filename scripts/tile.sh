#!/usr/bin/env bash
# Step 3 of the data pipeline: pack the big scene layers into PMTiles archives
# the app loads directly from GitHub Pages (no server, no tile requests).
# Requires tippecanoe (>= 2.x, which writes .pmtiles natively).
#
# WHY THIS GREW BEYOND BUILDINGS.
#
# A first-time visitor downloads 28 MB across 26 files before the city appears,
# and every one of those files is the WHOLE CITY, fetched whether or not the
# camera can see it. That is the ceiling on how much detail this project can
# ever have: adding a nicer roofscape or more props makes the site slower for
# everyone. Tiles break that trade — the browser fetches only the tiles under
# the camera, so detail stops costing load time.
#
# The five layers below are 20 MB of the 28 and, crucially, they are the EASY
# 20 MB. Each is handed to MapLibre as a plain `addSource({type:'geojson',
# data:<url>})` with no JavaScript touching it first:
#
#     trees.geojson             9.13 MB   js/app.js
#     roads.geojson             3.70 MB   js/ground.js
#     outer_ring.geojson        2.59 MB   js/outer.js
#     roofscape.detail.geojson  2.27 MB   js/roofs.js
#     props.geojson             2.19 MB   js/props.js
#
# BUILDINGS ARE DELIBERATELY DIFFERENT AND STAY LAST. js/app.js runs passes over
# the whole building collection before it draws: quantiseFacades() clusters
# window colours across all ~3,000 buildings and elects the 14 most populous,
# mergeCapitolScene() splices in 604 more, applyUnion24() rewrites a footprint,
# and the label pass de-duplicates names globally. None of that survives being
# cut into tiles — a tile of West Campus and a tile of downtown would each elect
# their own 14 tones against one shared atlas. That work has to move into the
# Python bake first. It is also only 1.41 MB, five per cent of the payload, so
# it is the last thing worth doing, not the first.
#
# TWO SETTINGS THAT ARE NOT DEFAULTS AND MUST NOT BECOME THEM:
#
#   --maximum-zoom=16 caps every archive at z16. That cap is what fixed the
#   city-wide motion flicker (fill-extrusion-pattern is TILE-anchored and
#   cross-fades between zoom levels; window.PATTERN_TILING pins the GeoJSON
#   sources to the same 16). Lose it and the flicker comes back.
#
#   --simplification=1 --no-simplification-of-shared-nodes, because tippecanoe
#   SMOOTHS GEOMETRY AT LOW ZOOMS BY DEFAULT. That is a visual-quality change
#   hiding inside a delivery change, and it is the one thing here that could
#   make the city look worse — rounded-off corners on distant buildings. 1 is
#   tippecanoe's minimum, not its default.
#
#   -b0 (zero buffer) is NOT used. Extrusions crossing a tile seam need the
#   buffer or they get clipped mid-wall.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/config.sh

mkdir -p "$(dirname "${BUILDINGS_PMTILES}")"

# Shared flags. --no-feature-limit and --no-tile-size-limit because this is a
# dense city and tippecanoe's defaults would silently DROP features to hit a
# size target — a thinned city that looks fine in a screenshot and is missing
# a hundred trees is the worst possible failure here.
TIPPE_COMMON=(
  --force
  --minimum-zoom=13
  --maximum-zoom=16
  --no-feature-limit
  --no-tile-size-limit
  --preserve-input-order
  --simplification=1
  --no-simplification-of-shared-nodes
  --buffer=16
)

tile_layer () {
  local src="$1" out="$2" layer="$3"
  if [ ! -f "${src}" ]; then
    echo "skip ${src} (not present)"
    return 0
  fi
  echo "Building ${out} from ${src}"
  tippecanoe -o "${out}" --layer="${layer}" "${TIPPE_COMMON[@]}" "${src}"
  ls -lh "${out}" | awk '{print "  ->", $5, $9}'
}

# 1. Buildings, into the snapshot, as before. Nothing loads this yet.
echo "== buildings =="
tile_layer "${BUILDINGS_ENRICHED}" "${BUILDINGS_PMTILES}" "buildings"

# 2. The five big scene layers, into data/tiles/ rather than the snapshot —
# they are not snapshot-dated, they are rebuilt from whatever is in data/.
echo
echo "== scene layers =="
mkdir -p "${DATA_DIR}/tiles"
tile_layer "${DATA_DIR}/trees.geojson"            "${DATA_DIR}/tiles/trees.pmtiles"      "trees"
tile_layer "${DATA_DIR}/roads.geojson"            "${DATA_DIR}/tiles/roads.pmtiles"      "roads"
tile_layer "${DATA_DIR}/outer_ring.geojson"       "${DATA_DIR}/tiles/outer.pmtiles"      "outer"
tile_layer "${DATA_DIR}/roofscape.detail.geojson" "${DATA_DIR}/tiles/roofdetail.pmtiles" "roofdetail"
tile_layer "${DATA_DIR}/props.geojson"            "${DATA_DIR}/tiles/props.pmtiles"      "props"

echo
echo "Done. Totals:"
du -ch "${DATA_DIR}/tiles"/*.pmtiles "${BUILDINGS_PMTILES}" 2>/dev/null | tail -1
