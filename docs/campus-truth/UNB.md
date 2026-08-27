# UNB — Union Building (Texas Union)

*Official name (UT Austin building register): Union Building*

**Why it's in this round's target set:** sits on the West Mall plaza between the Drag and the core campus -- the building most students physically enter multiple times a week -- with an unmistakable, unambiguous carved entrance and a rich multi-part facade.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 68.7 ft (21.0 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 5 floors, 171,276 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/UNB/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 11.9 m, no floor count, class `university`.

Austin LiDAR: 68.7 ft (20.9 m). UT Direct: 5 floors, 171,276 gross sq ft.

## Where the real entrance is

Unambiguous in the photograph: "THE EYES OF TEXAS ARE UPON YOU / THE UNION" is carved into the stone base beneath a monumental round arch under a tower with a projecting bracketed roof, on the WEST elevation facing the West Mall plaza; a Longhorn medallion marks a secondary door in the lower west wing. This is, by `scripts/bake_entrances.py`'s own comment, "THE BIGGEST HOLE IN THE SPEC": UNB is NOT in UT's surveyed celebrated-entrance table, has no OSM `entrance=*` node, and the CELEBRATED override for UNB authors no coordinate at all -- its own note reads "No source states which elevation the main door is on... the generic pass places it." This photograph is itself new, useful evidence toward closing that hole: a clear, labelled, unambiguous west-facing entrance, CC-licensed and citable.

`UNB` is **not** in UT's surveyed celebrated-entrance table.

## The window grid, counted off the photograph

*Photographed elevation: the west (entrance, tower) elevation.*

Not a uniform grid. South wing (right of the tower): ground-floor round arcade (~6-7 arches with radiating fanlights) with paired rectangular windows above at floor 2, roughly 1:1 with the arches below. Lower west wing (left of the tower): 3 ground windows plus a door, 3 tall shuttered casement windows above, a roof deck with a balustrade and 2 large ceramic urns. The tower itself: one large arched window/Juliet-balcony opening at floor 3, a band of narrow louvred slit openings near the roofline, a deep bracketed eave.

**What this app currently draws on this building today:** family `mr` — 6 rows x 5 cols (2-3 storey walk-ups), chosen by `js/facades.js`'s `familyFor()` from this building's own baked height (11.9 m) and class (`university`). This is the number the rest of the facade fix should be scored against.

## Reference photograph

- **File:** [File:Union Building - UT Austin (54984999764).jpg](https://commons.wikimedia.org/wiki/File:Union_Building_-_UT_Austin_(54984999764).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/2/28/Union_Building_-_UT_Austin_%2854984999764%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** ajay_suresh, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `UNB` key.*
