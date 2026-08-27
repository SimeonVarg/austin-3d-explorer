# LFH — Littlefield House

*Official name (UT Austin building register): Littlefield House*

**Why it's in this round's target set:** the single most visually distinctive building on campus (a unique Victorian mansion, National Register of Historic Places) on the northern approach near the Drag/West Mall corridor; the strongest possible proof that "uniform primitives are the null hypothesis" is wrong for at least one high-visibility building.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 75.7 ft (23.1 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 4 floors, 16,135 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/LFH/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 10.8 m, no floor count, class `detached`.

Austin LiDAR: 75.7 ft (23.1 m) -- this is the tallest POINT on the roofline (the corner tower's spire tip), not a storey height; a simple box model reasonably uses the lower main-roof eave line instead, which is closer to the app's own baked 10.8 m. UT Direct: 4 floors. Built 1894, James Wahrenberger architect; listed on the National Register of Historic Places (ref 70000767).

## Where the real entrance is

Marble steps lead to the wraparound double-decker gallery/porch on the south elevation; the door itself is recessed behind the columns and not directly visible in this photograph. NOT in UT's surveyed celebrated-entrance table and NOT given a coordinate in `scripts/bake_entrances.py`'s CELEBRATED table either -- that entry (`fam="V"`) authors the door's SHAPE (recessed behind polished stone Corinthian columns, a 2-storey iron veranda, ~5 stone risers with a thin retrofitted pipe rail, read off a different Commons photograph than the one used here) but explicitly places no `at` coordinate, so its ground position is whatever the building's generic placement pass produced.

`LFH` is **not** in UT's surveyed celebrated-entrance table.

## The window grid, counted off the photograph

*Photographed elevation: the south / southwest corner.*

NO repeating grid. A genuinely asymmetric High Victorian (Second Empire/Queen Anne) composition: a round corner tower under a conical fish-scale-slate roof, a taller square tower with a steep slate pyramidal roof and a gabled dormer, an octagonal bay window, tall paired double-hung windows of VARYING width per bay, all under a two-tier wraparound gallery (cast-iron columns below, stone Corinthian columns above). The single clearest proof in this set that 'uniform primitives' is the wrong null hypothesis for a real chunk of this campus.

**What this app currently draws on this building today:** family `mr` — 6 rows x 5 cols (2-3 storey walk-ups), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (10.8 m) and class (`detached`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:University of Texas at Austin August 2019 10 (Littlefield House).jpg](https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_August_2019_10_(Littlefield_House).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/9/96/University_of_Texas_at_Austin_August_2019_10_%28Littlefield_House%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY-SA 4.0
- **Photographer:** Michael Barera, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `LFH` key.*
