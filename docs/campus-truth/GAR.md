# GAR — Garrison Hall

*Official name (UT Austin building register): Garrison Hall*

**Why it's in this round's target set:** same South Mall approach; carries a real, sourced, non-generic decorative program (carved founders' names, cattle-brand medallions) worth checking a fix against.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 76.5 ft (23.3 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 5 floors, 51,822 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/GAR/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 12.9 m, no floor count, class `university`.

Austin LiDAR: 76.5 ft (23.3 m) -- OSM's own height=23m tag agrees closely. UT Direct: 5 floors.

## Where the real entrance is

"GARRISON HALL" is carved into the stone frieze above a 3-arch limestone ground-floor arcade. UT's own hand-surveyed celebrated-entrance table (see `UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched from UT's ArcGIS FeatureServer 2026-08-23) lists two doors for GAR, at S and W; the final `data/entrances.geojson` places its `role: main` door 4.2 m from the nearer of the two: correct.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **2** door(s) for `GAR`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **4.2 m** away (eid 571, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

## The window grid, counted off the photograph

*Photographed elevation: the arcaded (entrance) elevation.*

Ground floor: 3 round arches (the arcade), flanked outside the arcade by barred windows. Upper floor, red brick: a projecting 2-storey ornamented oriel-style window bay carved "AUSTIN" at its head, plus plainer cast-stone-surround windows. The distinctive REAL detail the current template cannot express: terracotta medallions of historic Texas cattle-brand marks set into niches between the upper windows (`scripts/bake_entrances.py`'s own CELEBRATED entry for GAR independently cites the same detail: "32 terra-cotta cattle brands"). Red clay tile hip roof.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (12.9 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Garrison hall 2014.jpg](https://commons.wikimedia.org/wiki/File:Garrison_hall_2014.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/6/62/Garrison_hall_2014.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** Larry D. Moore, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `GAR` key.*
