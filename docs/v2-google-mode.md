# v2 Google mode: Google's 3D city around our Blender buildings

`v2/google.js`, on from 2026-10-18 (branch `mac/v2-google`). Off unless a Google Maps API key is pasted into the
"Google 3D" control at the bottom of /v2/. The key stays in that browser's localStorage, never in the repo or on our host.

## The terms (read 2026-10-18 from Google's own pages)

Sources, fetched that day:
- Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies (page "Last updated 2026-10-16")
- Photorealistic 3D Tiles: https://developers.google.com/maps/documentation/tile/3d-tiles and .../tile/3d-tiles-overview
- Usage and billing: https://developers.google.com/maps/documentation/tile/usage-and-billing
- Pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Terms of Service: https://cloud.google.com/maps-platform/terms (last modified August 26, 2026)
- Service Specific Terms: https://cloud.google.com/maps-platform/terms/maps-service-terms (no Map Tiles section)
- Core Services list: https://cloud.google.com/maps-platform/terms/maps-services ("Map Tiles API" is on it)

**(a) Our own three.js renderer: ALLOWED.** 3d-tiles-overview: "Photorealistic 3D Tiles are map tiles containing Google's
3D geodata in the OGC 3D Tiles format, allowing rendering with your own or open source 3D Tiles renderers." Condition,
3d-tiles: "you must use a 3D Tiles renderer that supports the display of copyright attribution." Policies: "When you use
the Map Tiles API to display Google Maps using a third-party renderer, you must not overlap or obscure the Google logo with
any other logo". Done with NASA-AMMOS 3DTilesRendererJS 0.5.3 (vendored) and our own attribution line.

**(b) Logo and attribution: REQUIRED, done.** Policies: "Attribution should take the form of the Google Maps logo whenever
possible." Logo rules: official asset, unmodified, outlined version on a busy background, 16 to 19 dp high, clear space
10 dp left/right/top and 5 dp below, accessibility label "Google Maps". Data: "You must aggregate, sort, and display in a
line, all attributions for displayed tiles; usually along the bottom of the rendering." Mixed scenes: "you must clearly
state in your UI attribution string or user flow which part of the scene originates from Google Maps data." Terms of
Service 3.2.2(b): "Customer will not modify, obscure, or delete such attribution." 3.2.2(a): the app's own terms must say
it includes Google Maps content and point to the Google Maps Additional Terms and the Google Privacy Policy.
What v2 shows: the official "Google Maps" logo with dark outline (`v2/google/google-maps-logo.svg`, 18 px high, 10/10/10/5
px clear space, alt "Google Maps"), next to it the credits of the tiles in view in one line, sorted by how many tiles carry
them, and above it, separate: "3D city: Google Maps. The highlighted buildings and the walking route are Flyover's own,
not Google's." The control and `terms.html` section 17 link both Google documents.

**(c) Caching: NONE BEYOND HTTP.** Terms 3.2.3(b): "Customer will not cache Google Maps Content except as expressly
permitted under the Maps Service Specific Terms." (The Service Specific Terms have no Map Tiles exception.) Policies: "you
must not pre-fetch, index, store, or cache any Content except under the limited conditions stated in the terms" and "your
client must respect the max-age value, the stale-while-revalidate value, the must-revalidate directive, and the private
directive". What v2 does: tiles are fetched live by the browser (its HTTP cache follows Google's headers); the renderer
keeps only its working set in memory (cap 650 MB desktop, 240 MB phone) and drops it on close; no service worker, no
IndexedDB, no file. Nothing from Google is ever written to the repo. Policies also forbid non-visual uses: "Image
analysis", "Machine interpretation", "Object detection or identification", "Geodata extraction or resale", "Offline uses".

**(d) "No use with non-Google maps": OSM / City layers must go in Google mode.** Terms 3.2.3(e): "Customer will not use the
Google Maps Core Services with or near a non-Google Map in a Customer Application." Map Tiles API is a Core Service. What
the policies DO allow on top of the tiles: "You may overlay your own 3D objects on Photorealistic 3D Tiles as long as the 3D
objects aren't extracted, traced, or otherwise derived by hand or machine from Photorealistic 3D Tiles", and overlaid
third-party geodata as long as its attribution is kept apart from Google's. So in Google mode v2 hides every layer that
is a map (OSM roads, sidewalks, plain OSM/City extrusions, map trees, the plain ground, the ground lane's City aerial
ground and street layers when they land: anything not on the keep list in `google.js` is hidden). It keeps: Google's
tiles, our Blender models (own 3D objects), the walking route overlay, the sky and the lights.
**Risk to check, owner's call:** a Blender model built partly from Google Earth or Street View captures could count as
"derived" from Google content (Terms 3.2.3(c) "No Creating Content From Google Maps Content"). Models from his own and
public photographs are fine.

**(e) Hiding Google's mesh under our buildings: NOT ADDRESSED by any page; built, can be switched off.** No sentence in
the policies, the Terms or the Service Specific Terms speaks to clipping or hiding parts of the tiles; the only "do not
obscure" rules are about the logo and the attributions. Hiding Google's building where ours stands gives the same picture
as an opaque overlay of our own model, which the policy allows, and changes no Google data. Same for laying Google's
terrain flat (below). Both are draw-time only. `?gclip=0` shows Google's buildings too; `?gterrain=1` shows its real terrain.

**(f) Cost.** Pricing, "Map Tiles API: Photorealistic 3D Tiles" (Enterprise): free usage cap **1,000** billable events a
month, then **$6.00 per 1,000** (to 100,000). The billable event is the ROOT request: "Every tile request (2D Tiles, Street
View Tiles, and root tile requests for Photorealistic 3D Tiles) counts", and "Timed session tokens allow for up to three
hours of renderer tile requests from a single root tileset request" with "Unlimited renderer-originating tile requests
per day". 2D Map Tiles: 100,000 free a month, then $0.60 per 1,000 (v2 does not use 2D tiles). So one page load with Google
on = 1 billable event (one more after 3 hours). A CEO demo of a few sessions plus testing is a few dozen events: **$0**,
inside the free cap. Billing must still be enabled. Set a daily quota (below) so a leaked key cannot run up a bill.

## What Google mode shows

Google's photorealistic mesh everywhere, with our Blender buildings standing in it; where one of our buildings stands,
Google's own copy of it (and its trees and cars within 2 m) is not drawn above 0.6 m. Far from our loaded tiles Google's
buildings fill the city. The walking route rides 0.8 m over Google's ground. Not shown in Google mode: OSM roads,
sidewalks, plain extrusions, map trees, City aerial ground.

## Accuracy: how Google's mesh is put on our coordinates

1. **Frame.** v2's frame (`v2/geo.js`) is equirectangular on the equatorial radius. It is NOT metric: north-south it is
   0.41 % long, east-west 0.09 % (13.5 m and 1.8 m at the far tiles). All our layers share it, so they agree with each
   other; Google's mesh is metric. Google's ECEF mesh goes to a local east/up/south frame at the origin, then a 9-term
   quadratic (fitted at startup from `geo.js` itself) maps it to v2. Fit error: 0.001 m over the tiles' area, 0.002 m over
   10 x 11 km.
2. **Height (vertical datum).** v2 is flat at y = 0. Google is WGS84 ellipsoid heights with the real terrain (Tower ground
   179.0 m NAVD88, DKR field 160.7, lake 131.5). y = 0 = the origin's ground = 179.016 m NAVD88 + GEOID18 -25.884 m (NGS
   API) + NAD83(2011) to ITRF -1.233 m (NGS 2016 Helmert) = **151.899 m ellipsoidal**. Each Google vertex is then lowered by
   the 2021 lidar bare-earth height at its spot (`v2/google/ground-dem.bin`, 8 m cells, CC0, NOT Google data), so Google's
   ground lies on y = 0 like ours and nothing floats or sinks. Last, a draw-time ground check (`ANCHOR`) compares Google's
   ground at open road points in view with the lidar and removes the remaining constant (Google's own height bias), held
   in memory only; `?gclamp=0` turns it off.
3. **Proof, without a key** (`scripts/verify/v2-google.mjs`): a stand-in tileset of 30 m posts in ECEF on the real ground
   at DKR's field corners, the Tower's base corners, Guadalupe & 24th, Congress & 6th, The Venue and Frost Bank Tower,
   loaded through the same library, frame map, flattening and shader. Geometry: 0.000-0.001 m off across, base 0.000-0.13 m
   (the 0.13 is DKR's bowl edge, ground curvature under a 2 m post). On screen from straight above: 0.005 m off at every
   post (pixel 0.105 m).
4. **What this cannot prove:** Google's own georeferencing, and our data's datum. The 2021 lidar is NAD83(2011); Google is
   WGS84/ITRF; they differ here by about 1.2 m up and 1 to 2.5 m across. Our Blender placements were checked against OSM
   outlines and the lidar (scan cover 0.86-0.90, centres 0.4-2 m), so a systematic 1-2 m horizontal offset between Google
   and our buildings is possible and can only be seen with a key. `?gshift=east,south` (metres) nudges Google's layer if
   the owner sees one. An automated measurement of Google's mesh was NOT built: the policies forbid geodata extraction and
   machine interpretation of tile content.

## Getting a key (owner, 10 minutes)

1. https://console.cloud.google.com : make or pick a project; Billing: link a billing account (required even for the free cap).
2. APIs & Services > Library: enable **Map Tiles API**.
3. APIs & Services > Credentials > Create credentials > API key. Edit it:
   - Application restrictions: **Websites**; add `https://flyover-utx.vercel.app/*`, and for local tests
     `http://localhost:8457/*` and `http://127.0.0.1:8457/*` (the port you serve on).
   - API restrictions: **Restrict key** to **Map Tiles API** only.
4. Google Maps Platform > Quotas: Map Tiles API, root tileset requests per day: set about 200.
5. Open https://flyover-utx.vercel.app/v2/ , click "Google 3D", paste the key, "Use this key". "Forget key" removes it.

## First-test checklist (what he should see)

- [ ] The city fills in with Google's photorealistic 3D within a few seconds; at the bottom: the white-and-outlined
      "Google Maps" logo, the credits line next to it ("Google" and data providers), and the line saying what is ours.
- [ ] No grey OSM roads, plain boxes or blob trees anywhere; our detailed Blender buildings stand in Google's city.
- [ ] Tower, DKR, an apartment: no doubled building (Google's copy hidden), no floating or sunken base, no ghost walls.
- [ ] Look along a long straight wall of ours: Google's neighbouring kerb/ground lines up within about a metre. If
      everything is off by the same few metres in one direction, report it (fix: `?gshift=`), do not judge buildings yet.
- [ ] Pan slowly at a grazing angle: Google's photo texture stays steady (no crawl); tiles may pop in detail as they load.
- [ ] Pick an apartment and a class: the route shows on Google's streets.
- [ ] Reload: one root request per load in Google Cloud > Metrics. Turn off / Forget key: v2 is exactly as before.
- [ ] If it says "Google refused the key": the API is not enabled, billing is off, or the site address is not allowed.

## Not measured

Frame time and memory with real Google tiles (no key was available to any lane). Frame cost of the shader patch alone is
small; Google's tiles themselves are the cost. Phone: same code, smaller memory cap, coarser detail (24 px error).
