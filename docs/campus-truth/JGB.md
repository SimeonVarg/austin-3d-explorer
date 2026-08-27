# JGB — Jackson School of Geosciences

*Official name (UT Austin building register): Jackson Geological Sciences Building*

**Why it's in this round's target set:** another large (200k sq ft) modern building with a clean, well-documented, genuinely regular grid -- a second "close to uniform is actually fine here" data point, distinct in era and material from Burdine.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 107.4 ft (32.7 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 7 floors, 200,215 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/JGB/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 16.7 m, 7, class `university`.

Austin LiDAR: 107.4 ft (32.7 m). UT Direct: 7 floors, 200,215 gross sq ft.

## Where the real entrance is

"Jackson School of Geosciences" is on a stone tablet above a glass storefront-style ground-floor entrance with a red address plate ("305"), on the north/northwest side. UT's survey table lists one door, SW, at (30.285622, -97.735839). THE BUG, precisely measured this round: the nearest app door to that surveyed point is only 11.5 m away (within the bake script's own 12 m tolerance) -- but it is tagged `role: secondary`, not `main`. The same mislabelling pattern as Main Building, on a different building.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `JGB`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **11.5 m** away (eid 495, tagged `role: secondary`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and **mislabelled** — the door closest to UT's own surveyed point is not the one tagged `main`.

OSM `entrance=*` node(s) tagged directly on this building's own footprint:

- `entrance=exit` at 30.286086, -97.735788 (NNW side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.285932, -97.736036 (WNW side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.285602, -97.735953 (SW side of the building, 0.0 m from the building wall)

## The window grid, counted off the photograph

*Photographed elevation: the entrance (north/northwest) elevation.*

A plain modern brick grid: 2-light (roughly 1-over-1) rectangular windows, one per bay, with soldier-course brick lintels and sills. ~4-5 window columns counted per floor in the photographed near wing (partly tree-obscured, and the building turns a corner setback beyond the frame), 4 full window rows visible below a cropped-off top floor. Of the whole set, this is the one building whose real grid is closest in shape to the app's current 8-row x 5-column template: 8 rows is one off the real 7 floors, and 5 columns sits at the low end of the ~4-5 counted here -- flagged as the single plausible near-match, not a confirmed one, since the full width of every wing was not counted.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (16.7 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Jackson School of Geosciences UT Austin 2019.jpg](https://commons.wikimedia.org/wiki/File:Jackson_School_of_Geosciences_UT_Austin_2019.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/3/3f/Jackson_School_of_Geosciences_UT_Austin_2019.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** Larry D. Moore, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `JGB` key.*
