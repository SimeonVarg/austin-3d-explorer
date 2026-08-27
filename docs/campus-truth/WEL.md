# WEL — Robert A. Welch Hall (Chemistry)

*Official name (UT Austin building register): Robert A. Welch Hall*

**Why it's in this round's target set:** a large (430k sq ft), 7-floor building with an unambiguous labelled entrance and strong documentation, anchoring the northeast quad near Speedway.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 107.0 ft (32.6 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 7 floors, 430,256 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/WEL/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 17.2 m, 4, class `university`.

Austin LiDAR: 107.0 ft (32.6 m). UT Direct: 7 floors, 430,256 gross sq ft.

## Where the real entrance is

Unambiguous: "CHEMISTRY" is carved above a round-arched entrance with a wrought-iron grille fanlight and painted sky-blue double doors, and a wall plaque beside the door literally reads "WEL / WELCH HALL". UT's survey table lists THREE doors (E, NW, NE); the final `data/entrances.geojson` places its `role: main` door 4.7 m from the nearest: correct. Worth flagging for whoever owns this next: `scripts/bake_entrances.py`'s own CELEBRATED table has WEL DEMOTED out of tier 1 with the note "the public face is dominated by the later addition and no celebrated portal was found" -- this round's photograph shows a clearly labelled, clearly real entrance that may be exactly that later addition rather than the original 1930s portal celebrated.md describes; the two are not reconciled here.

**UT Facilities' own hand-surveyed "celebrated entrance" table** (`UT_CELEBRATED` in `scripts/bake_entrances.py`, fetched 2026-08-23 from UT's own ArcGIS FeatureServer) lists **3** door(s) for `WEL`. Cross-checked against what `data/entrances.geojson` actually ships: the nearest app-baked entrance is **4.7 m** away (eid 586, tagged `role: main`), within the 12 m match tolerance the bake script's own UT-relabelling stage uses, and correctly labelled `main`.

OSM `entrance=*` node(s) tagged directly on this building's own footprint:

- `entrance=yes` at 30.286273, -97.737390 (SSE side of the building, 0.0 m from the building wall)
- `entrance=yes` at 30.285748, -97.737653 (S side of the building, 0.0 m from the building wall)

## The window grid, counted off the photograph

*Photographed elevation: the entrance tower (central bay).*

The central entrance tower is 4 stacked storeys of single windows in an ornamented Spanish/Churrigueresque pilaster surround (fluted colonettes), rising above "CHEMISTRY", with a small iron balconet at the top window. The flanking brick wings show a plain grid of regular multi-pane (roughly 9-over-9 light) windows, one per bay, evenly spaced brick piers -- full wing width not counted from this photograph.

**What this app currently draws on this building today:** family `mh` — 8 rows x 5 cols (4-7 storey campus halls), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (17.2 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Welch Hall UT Austin Texas 2024.jpg](https://commons.wikimedia.org/wiki/File:Welch_Hall_UT_Austin_Texas_2024.jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/4/47/Welch_Hall_UT_Austin_Texas_2024.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** Larry D. Moore, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `WEL` key.*
