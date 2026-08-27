# BAT — Batts Hall

*Official name (UT Austin building register): Batts Hall*

**Why it's in this round's target set:** see CAL -- part of the same deliberately matched "Six Pack" trio.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 84.8 ft (25.9 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 5 floors, 39,143 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/BAT/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 20.5 m, no floor count, class `university`.

Austin LiDAR: 84.8 ft (25.8 m). UT Direct: 5 floors. Built as one of the "Six Pack".

## Where the real entrance is

"BATTS HALL" is carved on a limestone tablet above a recessed wood double door. UT's survey table lists THREE doors for BAT (SW, E, N); the final `data/entrances.geojson` places its `role: main` door 0.8 m from the nearest surveyed point: correct, and the closest match in the whole set.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **3** door(s) for `BAT`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **0.8 m** away (eid 431, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the entrance pavilion (west elevation).*

The photograph shows the entrance pavilion only -- tree canopy hides the long wings, and that limit is stated rather than papered over. Ground floor: 2 twelve-light windows flank the door. 2nd floor (this bay only): 3 tall multi-pane windows on a continuous iron Juliet balcony rail. The full-facade grid for the wings is NOT resolved by this photograph -- flagged, not guessed.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (20.5 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Batts hall 2014.jpg](https://commons.wikimedia.org/wiki/File:Batts_hall_2014.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/6/63/Batts_hall_2014.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** Larry D. Moore, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `BAT` key.*
