# BUR — Burdine Hall

*Official name (UT Austin building register): Burdine Hall*

**Why it's in this round's target set:** one of the tallest, most visible academic buildings (8 floors); the deliberate CONTROL CASE -- a building whose real facade genuinely is close to a uniform punched-window grid, so this set is not skewed entirely toward "everything is bespoke".

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 90.1 ft (27.5 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 8 floors, 101,502 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/BUR/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 12.8 m, no floor count, class `university`.

Austin LiDAR: 90.1 ft (27.5 m). UT Direct: 8 floors.

## Where the real entrance is

Not visible in the photograph used (an upper-corner view; ground level is hidden by trees). UT's survey table lists one door, S; the final `data/entrances.geojson` places its `role: main` door 3.7 m from that point: correct, but this round did not visually confirm it against a ground-level photograph -- flagged as geometry-only confirmation.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `BUR`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **3.7 m** away (eid 394, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the upper NE corner (ground level and doors not shown).*

A 1970 Brutalist brick tower. Deeply recessed, narrow, full-height vertical slot windows, one per structural bay, in a genuinely regular repeating grid: ~11-12 columns counted across the near wing in this photograph, 3 rows visible in the crop (more floors run above and below, out of frame; 8 real floors total per UT Direct). Unlike every other building in this set, Burdine's real facade IS close to a uniform punched-window grid -- worth keeping as the control case: not every building here needs a bespoke fix, and Burdine is the one where the row count (8 real vs 8 assigned) roughly lines up, even though the column count (~11-12 real vs 5 assigned) and the window shape (narrow slot vs square punch) do not.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (12.8 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Burdine Hall UT Austin 2018.jpg](https://commons.wikimedia.org/wiki/File:Burdine_Hall_UT_Austin_2018.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/3/3c/Burdine_Hall_UT_Austin_2018.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** Larry D. Moore, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `BUR` key.*
