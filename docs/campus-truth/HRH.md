# HRH — Homer Rainey Hall

*Official name (UT Austin building register): Homer Rainey Hall*

**Why it's in this round's target set:** see CAL -- part of the same deliberately matched "Six Pack" trio.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 74.5 ft (22.7 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 5 floors, 54,405 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/HRH/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 17.1 m, no floor count, class `university`.

Austin LiDAR: 74.5 ft (22.7 m). UT Direct: 5 floors. Built as one of the "Six Pack".

## Where the real entrance is

Ground-floor door(s), partly hidden by shrubs in the photograph, under a 2nd-floor pedimented window bay; flanked by 2 lantern sconces. UT's survey table lists one door, SW; the final `data/entrances.geojson` places its `role: main` door 4.0 m from that point: correct.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `HRH`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **4.0 m** away (eid 158, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the south elevation.*

2-storey limestone elevation under a red clay tile hip roof with a dormer. Centre bay: a broken-scroll pediment with a carved shell cartouche frames a tall multi-pane French door opening onto a continuous iron Juliet balcony at floor 2, flanked by 2 plainer windows. Left wing: ~4 window bays per floor with a quoined corner pilaster. Same "Six Pack" family as CAL and BAT.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (17.1 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Homer rainey hall.jpg](https://commons.wikimedia.org/wiki/File:Homer_rainey_hall.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/f/f0/Homer_rainey_hall.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** Larry D. Moore, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `HRH` key.*
