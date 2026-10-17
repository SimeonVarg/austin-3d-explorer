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
