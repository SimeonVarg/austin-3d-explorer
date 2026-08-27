# BTL — Battle Hall

*Official name (UT Austin building register): Battle Hall*

**Why it's in this round's target set:** one of the four halls the camera flies past on "up the South Mall to the Tower"; a richly documented, non-generic Beaux-Arts facade a generic grid currently flattens.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 73.4 ft (22.4 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 7 floors, 46,348 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/BTL/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 21.5 m, 3, class `university`.

Austin LiDAR: 73.4 ft (22.4 m). UT Direct's facilities register: 7 floors -- but only 2 storeys are visible above grade on the photographed (east) elevation. Battle Hall was built as the university's library and its stack hall is known to carry internal book-stack tiers; that almost certainly accounts for the gap between '7 floors' on paper and 2 storeys on the wall, but this round did not independently verify the stack-tier count, so it is flagged rather than asserted.

## Where the real entrance is

The single central round-arched door on the EAST elevation (facing the South Mall), flanked by wrought-iron lanterns. Confirmed three ways: visible in the photograph, `scripts/bake_entrances.py`'s CELEBRATED table already carries it as `facade="E"` with an authored point marked [D] "centre of the east wall", and the final `data/entrances.geojson` places its `role: main` door 1.4 m from that authored point -- this is one of the entrances the pipeline gets right end to end.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `BTL`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **1.4 m** away (eid 118, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the east (South Mall-facing) elevation.*

East elevation, 2 storeys over a rusticated limestone base, counted off the photograph. Upper floor: 5 tall round-arched Palladian bays -- paired casements with divided lights, a small wrought-iron Juliet balcony under each, a carved roundel medallion above each arch. Ground floor: roughly 4 tall double-hung windows on each side of the central door (~8 total, symmetric), about 2 per upper arch bay -- the row counts do NOT match between floors. Red clay tile hip roof, deep bracketed eave with a polychrome tile frieze.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (21.5 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Battle Hall - UT Austin (54983869707).jpg](https://commons.wikimedia.org/wiki/File:Battle_Hall_-_UT_Austin_(54983869707).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/6/67/Battle_Hall_-_UT_Austin_%2854983869707%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** ajay_suresh, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `BTL` key.*
