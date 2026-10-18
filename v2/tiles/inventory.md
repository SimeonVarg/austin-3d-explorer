# v2 tiles: the 23 large placement flags (2026-10-17)

A flag is large when the model's ground plan is more than 5 m off the outline its builder followed (centre), or its area is off by more
than 30 %. This file covers only those 23. The full list is in `inventory.json`; the numbers come from `scripts/v2/check_place.py`.
How to read the columns: **off** is in metres; **area** is model ÷ outline; **covered** is the share of the outline under the model;
**outside** is the share of the model that lies outside the outline. None of these is an export error: units, axes and origin match on the
other 279 builds. Each is a question about the build or its outline.

| slug | off | area | covered / outside | likely cause | suggested action |
|---|---|---|---|---|---|
| 100-congress | 20.2 | 0.63 | 0.34 / 0.45 | traced OSM outline (one big box) does not match the tower; the package says the outline is off by up to 18 m, so the builder followed the photo | keep; the outline is the wrong thing |
| music-recital-hall | 24.8 | 0.30 | 0.29 / 0.02 | outline covers the whole music complex; the build is its tall main block only | keep; other wings stay map extrusions (check map_ids does not hide them) |
| ernest-cockrell-jr-hall | 14.2 | 3.17 | 1.00 / 0.69 | the build includes a 7 m terrace or podium (`ecj_terrace`, 7,500 m² box) far past the tower's outline | decide: keep the terrace, or cut it at export |
| legacy-on-rio | 8.3 | 4.24 | 1.00 / 0.76 | outline is one small map part; the build is the whole courtyard block (about 45 x 40 m, 7 storeys) | keep; add the other map parts to map_ids so their extrusions hide |
| unidentified-west-campus-66d719c5 | 15.4 | 0.80 | 0.66 / 0.17 | package says the map outline is about 3 m off the scan; the build followed the scan/photo and is smaller | keep |
| unidentified-79e82c98 | 13.4 | 0.71 | 0.62 / 0.13 | package scan check: map outline is LARGER than the building (69 % of it is roof) | keep; the outline is too big |
| axis-west-campus | 8.2 | 0.70 | 0.67 / 0.05 | model covers about two-thirds of the outline (one block of a larger outline) | check the build: missing wing? |
| embassy-suites-austin-downtown | 7.2 | 0.73 | 0.71 / 0.02 | OSM outline includes the garage and low wings (package note); the build is the slab block | keep |
| townes-hall | 8.1 | 1.17 | 0.97 / 0.17 | a NE wing (12 m) stands outside the outline | check: real wing on another map part? |
| icon | 5.1 | 1.32 | 0.95 / 0.28 | tower parts up to 86 m outside the outline | check the build's position (possible offset) |
| the-independent | 4.6 | 1.41 | 1.00 / 0.29 | tall parts (to 183 m) outside a traced OSM outline that is smaller than the tower | keep; the outline is traced, not surveyed |
| the-austonian | 1.2 | 1.58 | 1.00 / 0.37 | package: the OSM outline is the podium only; the shaft (to 163 m) overhangs it | keep |
| unidentified-north-campus-63e601e8 | 5.2 | 1.40 | 1.00 / 0.28 | main block larger than the outline (scan says the outline fits) | check the build's size |
| almetris-duren-hall | 1.4 | 1.36 | 1.00 / 0.26 | a south wing (21 m) outside the outline: probably another map part | keep; add that part to map_ids |
| patton-hall | 4.2 | 1.36 | 1.00 / 0.26 | package scan check: the outline holds only 74 % of the roof, so the build followed the scan | keep |
| mary-e-gearing-hall | 4.9 | 1.49 | 1.00 / 0.33 | the build closes the courtyard's south side with low (5 m) stone wings and paving | check: is that wing real? |
| collections-deposit-library | 0.8 | 1.44 | 1.00 / 0.31 | a 7 m podium wider than the outline (not in the scan, so unchecked) | check |
| the-quarters-sterling-house | 3.0 | 1.33 | 1.00 / 0.25 | low parts (to 6.6 m) outside the outline: stoops, walls, the L's other leg | keep |
| unidentified-west-campus-a6a65d0c | 0.9 | 1.62 | 0.98 / 0.39 | package scan check: the map outline is a FRAGMENT (the scan roof is 1.56x it) | keep; the outline is too small |
| unidentified-north-campus-08cca10d | 2.0 | 1.91 | 1.00 / 0.48 | a 4.5 m `site_lawn_plane` (3,600 m² box) round the building | cut at export (raise the site rule to 5 m), or keep as a raised lawn |
| texas-cowboys-pavilion | 0.3 | 1.40 | 0.99 / 0.29 | an open pavilion with trellis and lawn beds round it (up to 5.5 m) | keep |
| texas-memorial-museum | 1.8 | 1.33 | 1.00 / 0.25 | low (under 2 m) steps and terraces round the base | keep |
| west-campus-861304d8 | 0.9 | 1.30 | 1.00 / 0.23 | low (under 3 m) parts outside the outline; the building is newer than the 2021 scan | keep |

Count: **15 keep** (the outline, not the build, is off, or the extra parts are real low parts); **6 check the build** (axis-west-campus,
townes-hall, icon, unidentified-north-campus-63e601e8, mary-e-gearing-hall, collections-deposit-library); **2 decide on a site piece**
(ernest-cockrell-jr-hall's terrace, unidentified-north-campus-08cca10d's lawn). For legacy-on-rio and almetris-duren-hall, the other map
parts under the model should also go into map_ids so the app hides their extrusions (next run: match by overlap, not by centre point).

## Verdicts, 2026-10-18 (fixed or left, with the reason)

New evidence this pass: `scripts/v2/scan_check.py` puts every model where the tile puts it and compares its plan (parts over 3 m) with the
2021 laser scan's building cells, independent of the map outlines. `cover` = the share of the model's plan that lies on scan building cells
(on 265 of the 303 builds the scan can be read: 236 have cover 0.85 or more). It cannot be read for 38 builds: the model lies outside the
scan raster (downtown) or the scan holds nothing there (built after Jan-Mar 2021). A second cross-check, the above-2.5 m surface of each model
against the roads the app draws, found 25 of 303 builds with more than 3 % of it on a road band (texan-tower 55 %, villas-on-guadalupe 26 %,
skyloft-austin 22 %, unidentified-north-campus-88dcc810 22 %, the-austonian 18 %, the-independent 13 %, ...): the road data or the outline is
off there, or a road passes under the building. Not looked at yet; open.

| slug | verdict | why |
|---|---|---|
| 100-congress | left | scan cannot be read (downtown, outside the raster); the OSM outline is one big box and the package says it is off by up to 18 m |
| music-recital-hall | left | on the scan (cover 0.91); the outline covers the whole music complex, the build is its tall block |
| ernest-cockrell-jr-hall | left, OPEN | cover 0.32: the scan does not put a building where the model stands; the 7 m terrace is also kept. Needs a look at the build's position |
| legacy-on-rio | fixed | on the scan (cover 0.95); the other two map parts under it are now in `map_ids` (overlap rule), so their extrusions hide |
| unidentified-west-campus-66d719c5 | left | on the scan (0.88); the package says the map outline is 3 m off and the build followed the scan |
| unidentified-79e82c98 | left | on the scan (0.95); the map outline is larger than the building |
| axis-west-campus | left | on the scan (0.96); the scan holds a larger block than the build (the other third of the outline is not modelled), so the extrusion under it is hidden only where the model stands |
| embassy-suites-austin-downtown | left | scan cannot be read (downtown); the OSM outline holds the garage and low wings |
| townes-hall | left | on the scan (0.96, IoU 0.71 with the scan); the NE wing is real and stands on another map part |
| icon | left, OPEN | cover 0.36: the scan and the model disagree on where the tower stands. Needs a look |
| the-independent | left | scan cannot be read (downtown); the outline is a traced OSM box, smaller than the tower |
| the-austonian | left | scan cannot be read (downtown); the outline is the podium only |
| unidentified-north-campus-63e601e8 | left | on the scan (0.94, shift 1 m): the main block is larger than the outline, the build is right |
| almetris-duren-hall | left | on the scan (0.93); the south wing is on another map part that the overlap rule did not take (covered under half) |
| patton-hall | left | on the scan (0.95); the build followed the scan where the outline held 74 % of the roof |
| mary-e-gearing-hall | left | on the scan (0.93); the south wing is a modelled courtyard closure, unchecked against a photograph |
| collections-deposit-library | left | no scan (built after it); a 7 m podium wider than the outline, unchecked |
| the-quarters-sterling-house | left | on the scan (0.95); low stoops and walls outside the outline |
| unidentified-west-campus-a6a65d0c | left | on the scan (0.87); the outline is a fragment of the building |
| unidentified-north-campus-08cca10d | left | on the scan (0.93); a 4.5 m lawn slab round the building stays (a raised lawn in a flat-ground app) |
| texas-cowboys-pavilion | left | on the scan (0.95); trellis and beds are real low parts |
| texas-memorial-museum | left | on the scan (0.96, shift 2 m); low steps and terraces |
| west-campus-861304d8 | left | newer than the scan: unverifiable; low parts outside the outline |
| moody-center (new best build) | left | built after the scan: unverifiable; the outline is smaller than the arena's plan (x1.33, 16 m off) |
| dkr-memorial-stadium (new best build) | fixed | the map ring is the pre-2019 stadium (the builder: east wall 9 m, north 14 m, south 20 m beyond it); the model's plan (ground left out) is 47,303 m2 against the ring's 46,178 (x1.02), covers 77 % of the ring, centre 8.9 m off; against the 2021 scan's first returns: cover 0.86, IoU 0.61, best shift (0, +1) m; no named street under it (nearest centreline 8.2 m, DeLoss Dodds Way) |
| ut-tower-main-building (new best build, the owner's accepted remake, 39,221 triangles) | fixed | the plan stands on its map outline (centre 0.36 m off, area x1.05, no flag) and on the 2021 scan (cover 0.90, IoU 0.70, best shift 2 m); no app copy: its tile is 1.63 MB, under the 2 MB line |

Omitted builds: **belo** (its ledger row says the name was never confirmed and it is not placed on the map: left) and **speedway** (a stretch
of road, not a building, no outline: left).
