# v2 water (off unless `?water=1`)

The owner, 2026-10-24, about his Mount Bonnell photographs of Lake Austin: *"i need the app to look like that also ...
water should look identical"*. This is the water layer. It is OFF for everyone until he has looked at it.

## What it is

- **Data:** `v2/data/water/osm_water.json`, OpenStreetMap water areas (Lady Bird Lake, Lake Austin up to Mount Bonnell,
  the wide creek reaches, ponds over 1,500 m2), cut into 500 m squares so the camera can skip the water it cannot see.
  It is an ODbL file of its own ("(c) OpenStreetMap contributors"); nothing else is mixed into it. Made by
  `scripts/v2/water_bake.py`.
- **Look (`v2/water.js`, every value in `WATER`, rule 11):**
  - a planar mirror, one per water level (v2's ground is flat, so one today), drawn at half the canvas (0.35 on a phone)
    with 4x multisampling on desktop. It shows only the sky, the plain buildings, the Blender models and the trees.
  - the mirror pass runs only while water in view is nearer than 1.5 km (0.9 km on a phone); farther water mirrors the
    computed sky, so a view with the lake far off pays nothing for it.
  - three layers of wind waves (6.5 m, 2.2 m and 23 m, from the south, Austin's usual wind), mipmapped so far water reads
    calm and the sun's glitter widens with distance instead of sparkling pixel by pixel (rule 15: no blur, no crawl).
  - Fresnel (water's 2 % straight on), a dark navy-teal water body, the sun's glitter from the scene's own sun, and bright
    reflected points pulled into vertical streaks by the waves (`STREAK`).
  - no shoreline foam and no shallow-water tint: his photographs show neither.
- **Night:** v2 has no night mode yet. The streak mechanism is in place (any bright point the mirror sees is torn into a
  vertical streak); shoreline lights in the mirror need v2's night lights first.

## Calibration (his midday photograph of Lake Austin from the Mount Bonnell lookout)

Mount Bonnell is outside v2's loaded area (see below), so the calibration uses a proxy camera over Lady Bird Lake with
everything that sets the water's colour matched: 75 m above the water (the lookout's height over the lake), the same
lens and field of view, the same pitch (from the far shore's row in the photo), the same distance to the far shore (350 m)
and the sun on the same side (behind-left).
Rows of the two frames are then the same view angles, so region colours compare directly.

| Region (same rows) | Photo (sRGB) | App with water | Difference |
|---|---|---|---|
| open water, far (300 m) | 68, 94, 115 | 74, 101, 125 | +8 % brightness (red +10 %): the app's haze adds about 6 % of the horizon colour at 350 m |
| open water, middle | 69, 96, 118 | 70, 97, 120 | +1 % |
| open water, near (160 m) | 68, 95, 116 | 68, 93, 113 | -1 % |
| sky 20 degrees up (exposure check) | 172, 195, 220 | 169, 196, 222 | 0 % |
| reflected far shore | 67, 76, 79 | 150, 153, 147 | +104 %: the app's far shore has no tree canopy to mirror |

Ripple texture (luma spread inside the water, row means removed): photo 10-13, app about 6. The rest of the photo's texture
is clouds in the mirror (the app's sky has none) and the boat's wake.

## What else differs in the frame (not water)

His Mount Bonnell frame is about a quarter hills, a quarter canopy, a quarter water and a quarter sky. The app at the same
camera is half sky: it has no terrain (the ground is flat; the lookout is 84 m above the lake and the west bank rises to
228 m at 2.2 km, USGS elevations), almost no canopy outside the City's street-tree inventory, no lakeside houses or docks,
and no clouds. The water cannot fix those.

## Reaching Mount Bonnell

The lookout is about 3.3 km west and 4 km north of v2's origin; the camera's limit is 2.6 km west and 2 km north. Missing:

| Piece | Today | What exists |
|---|---|---|
| Camera reach | eye kept inside x -2600..2600, z -2000..4200 | a bounds change |
| Water | Lake Austin is already in the data (26 squares) | done |
| Ground photo | only the baked z13 aerial (about 19 m a pixel) there | City 2025 aerial: bake z15-z16 for the area, z17-z20 already stream live |
| Terrain | none (flat ground) | TxGIO 2021 lidar DEM, 1 ft GeoTIFF tiles, 135 MB each, CC0; about 6 tiles for the lookout's view |
| Canopy | none (street trees end about 30.30 N) | TxGIO 2021 lidar points (vegetation classes), 0.6-0.7 GB a tile, CC0 |
| Houses, docks | none | the same lidar (building class) plus OSM outlines; docks from the aerial |
| Two water levels | one plane | Lady Bird Lake 130.6 m and Lake Austin 150.2 m, once terrain exists |

## Speed

AWS L4 (NVIDIA L4), `v2-frame.mjs --uncapped --reps 3 --water --q "|water=1"`, minimum of 3 interleaved reps, frame interval
with vsync off (the page's real cost per frame), desktop 2880x1800:

| View | Water off | Water on |
|---|---|---|
| opening view | 4.1 ms | 4.1 ms |
| street level, Guadalupe at 21st | 3.5 ms | 3.7 ms |
| DKR close / West Campus | 2.5 / 2.2 ms | 2.6 / 2.4 ms |
| street level on Lady Bird Lake's shore | 3.5 ms | 5.6 ms (+60 %) |
| Lady Bird Lake from 75 m | 3.3 ms | 6.2 ms |

Every desktop case holds 60 Hz many times over. Where the lake is in view the mirror pass costs about half a frame more;
that is over the ~10 % asked for, and the reason phones get no mirror by default: on the L4's phone profile (CPU 4x) the
pass took the lake shore from 11.4 to 22.1 ms, past 60 Hz. A still camera reuses the mirror, so the extra cost is paid
only while the camera moves. Without water in view the layer costs nothing measurable.

Motion (rule 15): a 0.05-degree-a-frame pan at street level with the waves frozen, share of water pixels that flip back
and forth: 0.55 % without the sun's glitter, 1.3 % with it; the trees and sky above the shore read 1.6 % by the same
measure and the bare aerial 0 %. `?waterglitter=0` turns the glitter off.
