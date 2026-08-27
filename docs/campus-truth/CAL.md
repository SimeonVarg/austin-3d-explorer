# CAL — Calhoun Hall

*Official name (UT Austin building register): Calhoun Hall*

**Why it's in this round's target set:** the "Six Pack" trio (with BAT, HRH) is a real, deliberately matched set built together in the 1950s-60s -- a second control case (a family where SHARING one template is architecturally correct) sitting on a heavily walked block between the South Mall and 21st Street.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 74.5 ft (22.7 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 7 floors, 55,077 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/CAL/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 22.1 m, no floor count, class `university`.

Austin LiDAR: 74.5 ft (22.7 m). UT Direct: 7 floors. Built 1967, one of the "Six Pack".

## Where the real entrance is

Ground-floor round-arched arcade on the west (mall-facing) elevation; a campus wayfinding sign reading "Calhoun Hall" stands at the walk. UT's survey table lists one door, S; the final `data/entrances.geojson` places its `role: main` door 8.1 m from that point: correct (within the 12 m tolerance the bake script itself uses).

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `CAL`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **8.1 m** away (eid 254, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the west (arcade, entrance) elevation.*

Ground arcade of round arches (partly tree-obscured in the photograph, ~5-6 visible). Above: a 3-storey block with a slightly projecting stair-tower bay (one tall multi-pane window per floor) beside a wider wing with regularly spaced windows set into shallow vertical piers, tied together by a 2nd-floor iron-railed walkway. Built together with Batts Hall (BAT) and Homer Rainey Hall (HRH) as a deliberately matched trio (the "Six Pack") -- a real case where sharing one template across three buildings would be architecturally honest, unlike the rest of this set.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (22.1 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Calhoun hall 2014.jpg](https://commons.wikimedia.org/wiki/File:Calhoun_hall_2014.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/e/ec/Calhoun_hall_2014.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** Larry D. Moore, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `CAL` key.*
