# GRE — Gregory Gymnasium

*Official name (UT Austin building register): Gregory Gymnasium*

**Why it's in this round's target set:** one of the most structurally distinctive buildings on campus (raked gable, corbel tables, triple-arch entrance), and already has a partial, real fix in data/roofs.geojson this ground truth can be checked against.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 94.3 ft (28.7 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 7 floors, 265,610 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/GRE/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 20.0 m, 3, class `university`.

Austin LiDAR: 94.3 ft (28.8 m). UT Direct: 7 floors, 265,610 gross sq ft.

## Where the real entrance is

Unambiguous: "GREGORY GYMNASIUM" is carved on a stone lintel beneath 3 tall round arches on the west elevation, each with a radiating fanlight of glazing and an ornamental iron security grille, reached by a grand exterior stair. This is the OSM `entrance=main` node (30.284010, -97.736834) and the coordinate already authored in `scripts/bake_entrances.py`'s CELEBRATED table for GRE, marked [M]. The final `data/entrances.geojson` places its `role: main` door 1.0 m from that point: correct.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `GRE`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **1.0 m** away (eid 67, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

OSM `entrance=*` node(s) tagged directly on this building's own footprint:

- `entrance=main` at 30.284010, -97.736834 (W side of the building, 0.0 m from the building wall)

## The window grid, counted off the photograph

*Photographed elevation: the west (entrance) gable elevation.*

NOT a repeating rectangular grid -- a raked Romanesque gable end, counted off the photograph. Above the 3-arch entrance: a stone balcony/balustrade, then TWO level tiers of small round-arched clerestory windows: the lower tier has 9 arches, the upper (higher in the gable) has 7. Each tier is edged by a dogtooth brick corbel-table cornice that runs the length of the gable's raking edges. This corbel-table trim is the same real detail already reproduced in this app's `data/roofs.geojson`, per HANDOFF's Gregory Gym gable/corbel fix -- this photograph is a citable reference to check that fix against.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (20.0 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:University of Texas at Austin August 2019 24 (Gregory Gymnasium).jpg](https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_August_2019_24_(Gregory_Gymnasium).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/a/a2/University_of_Texas_at_Austin_August_2019_24_%28Gregory_Gymnasium%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY-SA 4.0
- **Photographer:** Michael Barera, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `GRE` key.*
