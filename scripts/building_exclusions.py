import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OVERRIDES = json.loads((ROOT / "data/building_overrides.json").read_text(encoding="utf-8"))["buildings"]
EXCLUDED_IDS = {building_id for building_id, override in OVERRIDES.items() if override.get("exclude") is True}
EXCLUDED_OSM_WAYS = {str(override["osm_way_id"]) for override in OVERRIDES.values()
                     if override.get("exclude") is True and override.get("osm_way_id") is not None}
EXCLUDED_GEOMETRIES = [override["geometry"] for override in OVERRIDES.values()
                       if override.get("exclude") is True and override.get("geometry")]
RETIRED_ENTRANCE_IDS = {entrance_id for override in OVERRIDES.values() if override.get("exclude") is True
                       for entrance_id in override.get("retired_entrance_ids", [])}


def is_excluded(properties):
    if any(str(properties.get(key, "")) in EXCLUDED_IDS for key in ("id", "bid", "pid", "building_id")):
        return True
    return any(str(properties.get(key, "")).removeprefix("way/").removeprefix("w") in EXCLUDED_OSM_WAYS
               for key in ("osm", "osm_id", "osm_way_id"))
