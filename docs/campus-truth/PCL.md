# PCL — Perry-Castañeda Library

*Official name (UT Austin building register): Perry-Castañeda Library*

**Why it's in this round's target set:** the biggest library on campus, heavily walked past; its blank-wall-with-one-window-band reality is the single most extreme rebuttal to "every building gets a window grid", worth having in the set specifically to prove that null.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 118.4 ft (36.1 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 7 floors, 491,578 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/PCL/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 15.8 m, 5, class `library`.

Austin LiDAR: 118.4 ft (36.1 m). UT Direct: 7 floors, 491,578 gross sq ft -- the largest single building by floor area in this set.

## Where the real entrance is

Not visible in the photograph used (an almost entirely blank face, no doors in frame). UT's survey lists one door, N, at (30.282994, -97.737865). The final `data/entrances.geojson` places its `role: main` door 12.3 m from that point -- just OUTSIDE the 12 m tolerance the bake script's own UT-relabelling stage uses, so it is a close miss rather than a clean pass. `scripts/bake_entrances.py`'s CELEBRATED note for PCL adds a real, sourced fact: "the entrance to the library is on the SECOND FLOOR, accessible from a plaza" -- so a ground-wall-only proxy is inherently a little off for this specific building, which is a plausible reason for the miss, not confirmed as the cause.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `PCL`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **12.3 m** away (eid 15, tagged `role: main`), OUTSIDE the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the east/southeast plaza-facing wall (doors not shown).*

THE key finding for this building. Most of the exterior is COMPLETELY BLANK precast-concrete/limestone panel wall with zero windows -- a defining, well-known trait of this building, built for book-stack preservation and security rather than daylight. The one photographed face shows a single recessed band of tall, narrow, deeply shadowed full-height window strips: 13 counted across the top row of the band, with a second row emerging under tree canopy (not fully countable). This directly contradicts any generic 'N rows x M columns over the whole wall' template -- PCL's correct rule is 'blank everywhere except one or two narrow recessed bands'.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (15.8 m) and class (`library`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:University of Texas at Austin August 2019 26 (Perry–Castañeda Library).jpg](https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_August_2019_26_(Perry–Castañeda_Library).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/2/2d/University_of_Texas_at_Austin_August_2019_26_%28Perry%E2%80%93Casta%C3%B1eda_Library%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY-SA 4.0
- **Photographer:** Michael Barera, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `PCL` key.*
