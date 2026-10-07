# UNB — Union Building (Texas Union)

*Official name (UT Austin building register): Union Building*

**Why it's in this round's target set:** sits on the West Mall plaza between the Drag and the core campus -- the building most students physically enter multiple times a week -- with an unmistakable, unambiguous carved entrance and a rich multi-part facade.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 68.7 ft (21.0 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 5 floors, 171,276 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/UNB/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 11.9 m, no floor count, class `university`.

Austin LiDAR: 68.7 ft (20.9 m). UT Direct: 5 floors, 171,276 gross sq ft.

## Where the real entrance is

The monumental entrance is on the south-facing tower, opening toward the West Mall approach. Earlier notes called it west-facing; that orientation was incorrect. The round arch surrounds a deep orange vault and a smaller wood-and-glass doorway. A projecting balcony sits above it, followed by four tall upper bays and a bracketed timber eave. Two exterior stair flights flank a low central wall and planting, reaching a shared outdoor landing.

`UNB` is **not** in UT's surveyed celebrated-entrance table. The current tower placement follows the existing mapped building model; facade depths and the approach grade are exterior-view estimates, not surveyed dimensions.

## The entrance tower

The south tower has three balcony-level openings: one broad central opening and two narrow flanks. Its four upper bays comprise a louvered left bay and three timber sash bays. The deep entry vault contains a smaller arched wood-and-glass door. Adjacent wings have their own arcade and window patterns; this tower pass does not establish their photographic accuracy.

**Current application model:** `data/apartments/texas-union.json`, owned by `scripts/bake_union.py`, replaces the generic atlas facade. `scripts/campus_union.py` supplies the recessed portal, doors, balcony, four upper bays and bracketed eave. `scripts/campus_union_ground.py`, called by the landscape bake, supplies the connected exterior approach. See [the bounded correction and matched application views](../union-entrance.md).

The former family `mr` assignment (6 rows by 5 columns, derived from an 11.9 m generic footprint height) describes the historical fallback, not the current authored Union. Mapped footprint, existing roof geometry and unmodified wings remain. Carved lettering, insignia, fine weathering and interior traversal remain unimplemented.

## Reference photograph

- **File:** [File:Union Building - UT Austin (54984999764).jpg](https://commons.wikimedia.org/wiki/File:Union_Building_-_UT_Austin_(54984999764).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/2/28/Union_Building_-_UT_Austin_%2854984999764%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** ajay_suresh, via Wikimedia Commons

---

*The corresponding record is under `buildings.UNB` in `data/campus_truth.json`.*
