# MAI — Main Building ("the Tower")

*Official name (UT Austin building register): Main Building*

**Why it's in this round's target set:** the literal centre of both camera tours -- TOUR dwells on it and quarter-orbits it, AP_TOUR keeps it dead ahead for the first half of the flight -- and the single most recognised building on campus.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 337.0 ft (102.7 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 37 floors, 327,701 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/MAI/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 94.0 m, 2, class `university`.

Wikipedia/UT's own public figure (matches every campus tour and the observation-deck sign): 307 ft (94 m), 27 floors. Two OTHER real sources measured this round disagree with that figure and with each other, and neither is dismissed here, only flagged: Austin's LiDAR building-footprint layer measures the single MAX_HEIGHT-tagged footprint at 337.0 ft (102.7 m); UT Direct's own facilities register page lists the floor count as "37". The app's own baked `final_height` for this building is 94.0 m -- matching the canonical 307 ft figure almost exactly, so the app's HEIGHT is not the problem here.

## Where the real entrance is

Unambiguous: the south portico, a 7-arch limestone loggia beneath the carved inscription "YE SHALL KNOW THE TRUTH AND THE TRUTH SHALL MAKE YOU FREE", reached by a monumental exterior stair. This is both the OSM `entrance=main` node (30.285759, -97.739416) and the coordinate already hand-authored in `scripts/bake_entrances.py`'s CELEBRATED table for MAI, marked [M] "OSM entrance=main". THE BUG: the baked `data/entrances.geojson` places a door 0.6 m from that exact point (eid 448) -- excellent geometry -- but tags it `role: secondary`. The door actually tagged `role: main` (eid 446) sits 56.1 m away on the WNW side, near a service door. UT's own separate hand-surveyed accessible-entrance table (a different, west-side barrier-free door, distinct from the monumental south portico) also does not match eid 446 within its own 12 m tolerance (the nearest candidate, eid 447, sits 7.3 m away and is ALSO tagged secondary). So on this building specifically, the correct door exists in the data twice over and neither copy carries the 'main' tag.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **1** door(s) for `MAI`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **7.3 m** away (eid 447, tagged `role: secondary`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and **mislabelled** — the door closest to UT's own surveyed point is not the one tagged `main`.

OSM `entrance=*` node(s) tagged directly on this building's own footprint:

- `entrance=yes` at 30.285955, -97.739743 (WSW side of the building, 0.0 m from the building wall)
- `entrance=main` at 30.285759, -97.739416 (S side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.285980, -97.738982 (E side of the building, 0.0 m from the building wall)

## The window grid, counted off the photograph

*Photographed elevation: the south portico (entrance) elevation.*

South (entrance) elevation, 3-tier limestone base pavilion, each tier 7 bays wide and counted directly off the photograph: (1) ground -- 7 round arches forming an open loggia, the centre arch the main door; (2) piano nobile -- 7 tall windows on a continuous iron balcony rail, aligned 1:1 over the arches, the centre 3 marked with carved cartouches, the inscription band beneath; (3) attic -- 7 more windows in terracotta-panel surrounds under urn-topped pilasters, below a red-tile hip roof. Above that the tower shaft sets back and narrows: 4 vertical columns of small square windows (one per floor) run up all ~27 floors between blank stone piers, then an open colonnaded observation deck, the clock, and a stepped cupola. NOTHING about this is a uniform NxM grid across one wall plane -- it is three different 1x7 bands stacked over a base block, topped by an unrelated 4-column tower.

**What this app currently draws on this building today:** family `tr` — 9 rows x 5 cols (residential towers), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (94.0 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Main Building (University of Texas at Austin) - DSC08595.jpg](https://commons.wikimedia.org/wiki/File:Main_Building_(University_of_Texas_at_Austin)_-_DSC08595.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/8/8b/Main_Building_%28University_of_Texas_at_Austin%29_-_DSC08595.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC0
- **Photographer:** Daderot, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `MAI` key.*
