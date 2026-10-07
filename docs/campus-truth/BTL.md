# BTL — Battle Hall

*Official name (UT Austin building register): Battle Hall*

**Why it's in this round's target set:** one of the four halls the camera flies past on "up the South Mall to the Tower"; a richly documented, non-generic Beaux-Arts facade a generic grid currently flattens.

## Height and storeys

- **Austin LiDAR building-footprint measurement:** 73.4 ft (22.4 m). Source: City of Austin UTILITIESCOMMUNICATION_building_footprints_2017 (ArcGIS FeatureServer; public domain), queried by intersecting this building's own OSM footprint polygon against the FeatureServer (`MAX_HEIGHT` = `ELEVATION` − `BASE_ELEVATION`, both in feet).
- **UT Direct facilities register:** 7 floors, 46,348 gross sq ft. Source: https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/BTL/
- **This app's own baked data** (`final_height` / `num_floors` / `building_class` in `data/snapshots/*/buildings.detailed.geojson`, joined via the building's `bid` in `data/entrances.geojson`): 21.5 m, 3, class `university`.

Austin LiDAR: 73.4 ft (22.4 m). UT Direct's facilities register: 7 floors -- but only 2 storeys are visible above grade on the photographed (east) elevation. Battle Hall was built as the university's library and its stack hall is known to carry internal book-stack tiers; that almost certainly accounts for the gap between '7 floors' on paper and 2 storeys on the wall, but this round did not independently verify the stack-tier count, so it is flagged rather than asserted.

## Where the real entrance is

The east elevation has one central rectangular recessed doorway with teal paneled leaves, a flat stone lintel and flanking lanterns. The September 26 source review corrects the older arched-door claim. The authored Battle model owns this opening; legacy east assemblies 94 and 95 are retired, including the path-inferred doorway occupying a window bay. The historical UT survey proximity score below is location evidence, not evidence for the former arch shape.

UT Facilities lists one celebrated BTL entrance. The older baked survey proximity score is retained in the JSON as historical location evidence; its former eid and shape are not current authored geometry.

## The window grid, counted off the photograph

*Photographed elevation: the east (South Mall-facing) elevation.*

East elevation: seven tall round-arched upper bays, each with a Juliet guard; six rectangular lower sash windows, three on either side of one rectangular central doorway. The upper sash has divided vertical lights, a central transom and fanlight bars. Pale stone arch surrounds enclose a narrow polychrome strip. Red clay hip roof with deep bracketed eave and teal/gold soffit panels. Dimensions and detailed ornament are approximate; west and short elevations are not established by these views.

The previous five-upper/eight-lower count was incorrect. The authored model now owns the east facade; the older `mh` 8-by-5 generic family is only a fallback. See [Battle east facade](../battle-east-facade.md) for the verified scope and remaining limits.

## Reference photograph

- **File:** [File:Battle Hall - UT Austin (54983869707).jpg](https://commons.wikimedia.org/wiki/File:Battle_Hall_-_UT_Austin_(54983869707).jpg)
- **Full resolution:** https://upload.wikimedia.org/wikipedia/commons/6/67/Battle_Hall_-_UT_Austin_%2854983869707%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- **License:** CC BY 4.0
- **Photographer:** ajay_suresh, via Wikimedia Commons

---

*Compiled into `data/campus_truth.json` under the `BTL` key.*
