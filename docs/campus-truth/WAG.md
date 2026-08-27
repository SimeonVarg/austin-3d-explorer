# WAG — Waggener Hall

*Official name (UT Austin building register): Waggener Hall*

**Why it's in this round's target set:** same South Mall approach; already flagged in the bake script's own comments as "THE REGRESSION FIXTURE" for entrance placement -- worth carrying the same status into facade ground truth.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 84.3 ft (25.7 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 6 floors, 57,538 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/WAG/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 24.8 m, 5, class `university`.

Austin LiDAR: 84.3 ft (25.7 m) -- OSM's height=23m tag undercounts it. UT Direct: 6 floors.

## Where the real entrance is

"WAGGENER HALL" is carved above a central round-arched double door with a wrought-iron grille fanlight, flanked by 2 carved roundels, with a decorative iron grille/balconet above at floor 2. `scripts/bake_entrances.py`'s own comment calls WAG "THE REGRESSION FIXTURE": UT's survey table lists it, OSM independently carries 5 measured `entrance=yes` nodes on 4 sides of the building (more than any other celebrated building), and the final `data/entrances.geojson` places its `role: main` door 2.7 m from UT's own surveyed point: correct.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `WAG`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **2.7 m** away (eid 527, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

OSM `entrance=*` node(s) tagged directly on this building's own footprint:

- `entrance=yes` at 30.284946, -97.737724 (SSW side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.285114, -97.737707 (W side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.285280, -97.737691 (NNW side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.284938, -97.737516 (SSE side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.285266, -97.737483 (NNE side of the building, 0.0 m from the building wall)

## The window grid, counted off the photograph

*Photographed elevation: the principal (south, entrance) elevation.*

A flat, symmetric, unobstructed elevation, and a strong reference photograph. Raised limestone ground floor: 4 tall windows on each side of the entrance (8 total, some shuttered). 3 full brick floors above: 4 regular window bays on each side of a narrower centre bay (so 8 outer windows + 1 narrow centre window per floor -- NOT the same count top to bottom, since the centre bay's ground-floor slot is a decorative grille, not a window), soldier-course brick headers over every opening. The top 'attic' band under the deep bracketed eave ALTERNATES small windows with terracotta relief medallion panels (a Longhorn head, a book, sheaves of wheat, and others) -- it is not a uniform window row at all.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (24.8 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Waggener Hall - UT Austin (54984752686).jpg](https://commons.wikimedia.org/wiki/File:Waggener_Hall_-_UT_Austin_(54984752686).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/b/ba/Waggener_Hall_-_UT_Austin_%2854984752686%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** ajay_suresh, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `WAG` key.*
