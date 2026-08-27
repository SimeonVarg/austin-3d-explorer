# GOL — Goldsmith Hall (School of Architecture)

*Official name (UT Austin building register): Goldsmith Hall*

**Why it's in this round's target set:** directly on Inner Campus Drive next to Battle Hall; a real, heavily used building (labelled "ARCHITECTURE", visible bike traffic) with solid Commons coverage.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 78.6 ft (23.9 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 5 floors, 84,041 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/GOL/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 11.5 m, no floor count, class `university`.

Austin LiDAR: 78.6 ft (24.0 m). UT Direct: 5 floors.

## Where the real entrance is

"ARCHITECTURE" is carved above a recessed door with an iron security gate; heavy bike parking in the photograph confirms this is the door actually used. UT's survey table lists two doors, SW and NW; the final `data/entrances.geojson` places its `role: main` door 1.3 m from the nearer point: correct. `scripts/bake_entrances.py`'s own CELEBRATED note adds a real fact this round did not re-derive: Goldsmith wraps a courtyard and has a second, inward-facing entrance in addition to the street doors.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **2** door(s) for `GOL`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **1.3 m** away (eid 90, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the east (Inner Campus Drive, entrance) elevation.*

The long west wing (around the corner from the entrance) has a regular row of multi-light double-hung windows at both ground and 2nd floor, evenly spaced (~7-8 visible per floor before tree cover). The entrance bay itself: 2 tall multi-pane windows flank the door at 2nd floor, with a partly visible carved tablet higher up. Full grid for the courtyard-facing elevation not photographed this round.

**What this app currently draws on this building today:** family `mr` — 6 rows x 5 cols (2-3 storey walk-ups), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (11.5 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Goldsmith Hall.JPG](https://commons.wikimedia.org/wiki/File:Goldsmith_Hall.JPG)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/d/de/Goldsmith_Hall.JPG?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY-SA 3.0
- **Photographer:** Guðsþegn, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `GOL` key.*
