# SUT — Sutton Hall

*Official name (UT Austin building register): Sutton Hall*

**Why it's in this round's target set:** same South Mall approach as Battle Hall, its architectural companion piece.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 75.0 ft (22.9 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 5 floors, 59,498 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/SUT/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 13.0 m, 3, class `university`.

Austin LiDAR: 75.0 ft (22.9 m). UT Direct: 5 floors; 3 storeys are visible above the ground-floor arcade in the photograph. A '1917' cornerstone is carved into the base, and the deep bracketed eave implies attic space -- plausible reasons for the gap, not verified.

## Where the real entrance is

"SUTTON HALL" is carved into the limestone base at the building's north corner; the door is recessed under the second arch from the corner. `scripts/bake_entrances.py`'s CELEBRATED table already authors this as `facade="N"` -- flagging that the ORIGINAL south entrance was closed and the north one created by a 1982 renovation -- at a point marked [D]. The final `data/entrances.geojson` places its `role: main` door 2.6 m from that authored point: correct.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `SUT`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **2.3 m** away (eid 267, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the north (entrance) + west corner.*

Corner (north + west) view. North (entrance) elevation: 4 round arches at grade (1 door, 3 windows), 4 window bays above at floors 2 and 3, some with small iron Juliet balconies, polychrome tile spandrel panels between floors, brick walls with cast-stone quoins at the corner. The west elevation continues the same rhythm under a colonnaded arcade for at least 6-7 more bays, visible but not fully countable in this photograph -- not claimed as counted.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (13.0 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Sutton Hall (University of Texas at Austin) - DSC08578.jpg](https://commons.wikimedia.org/wiki/File:Sutton_Hall_(University_of_Texas_at_Austin)_-_DSC08578.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/9/94/Sutton_Hall_%28University_of_Texas_at_Austin%29_-_DSC08578.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC0
- **Photographer:** Daderot, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `SUT` key.*
