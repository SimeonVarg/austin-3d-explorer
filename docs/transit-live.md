# Live buses (`js/transit-live.js`)

Live CapMetro bus positions on the map, and "next departures" at a stop, live when the feed
has them and from the baked timetable when it does not. A static page, no key, no server.
It only DOWNLOADS public feeds: nothing about the user (class buildings, schedule, position)
is ever sent anywhere, which keeps the finder's privacy rule intact.

Files: `js/transit-live.js` (the module, window.TransitLive), `data/transit-live.json` (the
baked slice), `scripts/bake_transit_live.py` (sole writer of that file),
`scripts/verify/transit-live.mjs` + `scripts/verify/fixtures/transit/` (no-browser check).

## The source, and the two-step fetch

CapMetro publishes GTFS-realtime on data.texas.gov (Socrata). Dataset ids: vehicle positions
protobuf `eiei-9rpf` (about 20 KB, we use this one; JSON twin `cuc7-ywmd` is 73 KB), trip
updates protobuf `rmk2-acnw` (about 260 KB; JSON twin `mqtr-wwpy` is 1.16 MB), static GTFS zip
`r4v4-vz24` (34 MB, only the bake reads it).

A browser cannot fetch `https://data.texas.gov/download/<id>/...`: it answers 302 without a
CORS header. Two other addresses do answer `Access-Control-Allow-Origin: *`:

1. `GET https://data.texas.gov/api/views/<id>.json` (3 KB): read `blobId` and `blobFilename`.
2. `GET https://data.texas.gov/api/views/<id>/files/<blobId>?filename=<blobFilename>`.

`blobId` changes at every update (15 to 30 s), so step 1 runs before every read. Checked from
a real browser page on 2026-10-09 (MapLibre page on localhost): both steps passed, the feed
was 10 to 28 s old. Both calls use `cache: 'no-store'`. Cost per poll: vehicles 3 + 20 KB,
trips 3 + 260 KB.

The decoder is about 60 lines inside the module and reads only the fields we use
(GTFS-realtime 2.0): header timestamp; vehicle id, trip (id, route, direction), position
(lat, lon, bearing, speed), current status, stop id; trip update (trip, per stop: stop id,
arrival/departure time, skipped). It does NOT read `delay`; every stop in this feed carries
an absolute `time`. No new library file.

## The terms, read 2026-10-09 (https://www.capmetro.org/developertools)

"Open Data License Agreement and Terms of Use". data.texas.gov shows the licence as "See Terms
of Use", attribution "Capital Metropolitan Transportation Authority". The agreement says:

- CMTA grants a non-exclusive, limited and **revocable** right to use, reproduce and
  redistribute the data (it names vehicle location, service alerts, trip updates, GTFS data sets,
  scheduled service and maps). Redistribution is allowed, so shipping a baked slice in the repo
  is within the grant.
- **No CMTA trademarks or copyrighted materials, "including any confusingly similar variants",
  may be used in association with the data.** So: no CapMetro logo, no CapMetro route-colour
  branding presented as theirs, nothing that looks endorsed. The plain-text name as the source
  is how the portal itself credits the data; we use it only in the credit line, as a
  statement of source, and say we are not affiliated.
- Data is "as is" and "as available", no warranties, no liability. CMTA may change or stop
  the data at any time without notice, and may modify or revoke the agreement by posting a
  new one (continued use is acceptance).
- Texas law governs.

It does **not** require a credit line, a link, or a fixed disclaimer; the portal's attribution
field names the agency, so we credit it. The line the module exposes is `TransitLive.credit`:

> Bus data: Capital Metropolitan Transportation Authority (CapMetro), via data.texas.gov. Not
> affiliated with or endorsed by CapMetro. Provided as is.

Show it wherever buses or departures are shown (a footer line of the panel is enough). The
route colours baked in `data/transit-live.json` are the agency's `route_color` values; today
29 of 44 are one blue, 10 grey and 5 red, and the map layer uses them only as data colours for a bus dot.
Because the right is revocable, treat the feed as optional: the app must still work when it
is gone (the module returns `ok: false` and the scheduled fallback keeps answering).
The third-party Transitland page lists the static feed as "no attribution required, derived
products allowed"; that is a summary, not the agreement, and we follow the agreement.

## What the baked file holds (`data/transit-live.json`)

Baked from feed_version `260826_0956` (valid 2026-08-26 to 2027-01-09), weekday = Wed
2026-10-14, Saturday = 2026-10-17, Sunday = 2026-10-18. Bounding box
(west, south, east, north) = `[-97.765, 30.225, -97.70, 30.31]`: West Campus out to
Mopac, North Campus, UT, downtown, and East Riverside down to Montopolis Dr. 44 routes (those
that touch at least 6 stops in the box) and 659 stops. About 174 KB raw, about 37 KB gzipped.

Fields, as agreed with the route search (fields may be added, never renamed):

```
version, feed {version, from, to, serviceDate, saturday, sunday}, bbox, credit,
stops  {stop_id: [name, lat, lon]},
routes {route_id: {short, name, color "#rrggbb", dirs: [{
   dir, headsign,
   stops    [stop_id...]      ordered, the most common weekday pattern, stops inside the bbox only
   runMin   [0, 1.5, ...]     scheduled minutes from the first listed stop (a mid-morning trip)
   shape    [[lon, lat]...]   the line clipped to the bbox, 5 m tolerance
   first, last, headway [[hour, minutes between buses], ...]   weekday, at the first listed stop
   sat {first,last,headway}, sun {...}                       omitted when the day has no service
   pats, tt                  the whole timetable, see below
}]}}
```

`first`/`last` are GTFS clock strings: after midnight they keep counting (`"24:35"` is 00:35
the next morning). `headway` entry `[h, m]` means "from hour h on, a bus every m minutes"
(median gap inside each hour; an hour with one departure keeps the previous value).

`pats` + `tt` are the scheduled fallback. A pattern is the in-box stops one kind of trip serves
(`s`, absent = the direction's `stops`), a run offset in minutes from the first one (`o`) and a
headsign (`h`). `tt.wk|sa|su` lists, per pattern, `"gap gap/dev ..."`: minutes since the previous
trip start (the first is the start itself, minutes after the start of the service day) and,
after a slash, `dev`, the whole minutes the trip's run time differs from the median. Offsets are
the median over the pattern's trips and are stretched by the per-trip dev. Measured against
every real trip in the feed: mean error 0.4 min, 95% within 1.6 min, worst 5 min.

## Using it (what the lead wires)

```html
<script src="js/transit-live.js"></script>
```
```js
TransitLive.start();                    // vehicles every 20 s while the tab is visible
TransitLive.attach(map);                // plain MapLibre layers, call again after a style swap
TransitLive.on(s => ...);               // s = TransitLive.state(), after every poll
TransitLive.wantTrips(true);            // while a stop panel is open (trip updates are 260 KB)
TransitLive.departures('1042', 3);      // [{route, short, color, dir, headsign, minutes, live, scheduled, tripId?}]
TransitLive.departures('1042', 5, {route: '1', dir: 1});   // optional filter
TransitLive.data().then(d => ...);      // the baked JSON, fetched once, shared with the route search
TransitLive.stop(); TransitLive.detach();
TransitLive.credit;                     // the credit line to print next to anything shown
```

`start(opts)` / `config(obj)` override any parameter at the top of the file: `intervalMs` (20000),
`tripsIntervalMs` (30000), `trips` (false), `backoffFactor`, `backoffMaxMs`, `vehicleStaleS`,
`tripsStaleS`, `horizonMin`, `bakeUrl`, `includeNoTrip`, `showLines`, `beforeLayer`, and every
colour and size of the layers (`vehicleRadius`, `vehicleHaloColor`, `stopRadius`, ...).
Trip updates are off by default because of their size; turn them on only while a stop's
departures are on screen. `start()` loads the baked file first (it filters the vehicles to the
baked routes and box); with no baked file the vehicles are returned unfiltered and
`state().error` says so.

Item meanings in `departures()`: `live: true` comes from the trip-update feed (`tripId` is set,
`scheduled` is the nearest baked time of the same route and direction within 20 minutes, or
`null`); `live: false` is the baked timetable. For a route and direction with live data at that
stop, baked times are shown only after the last live time, so one bus is never listed twice.
`minutes` is rounded, 0 means due. `route` is the GTFS route id (it equals `short` for every
baked route; use `short` for display).

`state()` is `{ok, ageSec, fetchedAt, vehicles, error}`: `ageSec` is the age of the vehicle
file itself (its header timestamp), `ok` goes false after an error or when it is older than
`vehicleStaleS` (90 s). After an error the poll waits `interval * 2^failures` (capped at 5 min)
and goes back to normal at the first success. A hidden tab polls nothing; it resumes at once
when it becomes visible.

Layers added by `attach(map)`: sources `transit-live-vehicles|stops|lines`, layers
`transit-live-lines` (hidden unless `showLines`), `-stops` (circles from zoom 14),
`-vehicle-halo` and `-vehicles` (circles in the route colour). No image files, no text layer
(the app style has no glyph server we could rely on): vehicle features carry `route` (short
name), `color`, `bearing` and `id` for a popup, and stop features carry `id` and `name`.

## Limits, said plainly

- One agency (CapMetro bus). No rail, no other operators, no walking legs, no trip planning.
- The feed has outages and gaps. Some vehicles appear with no `trip` (not in service, or the
  assignment is missing): they have no route, so they are dropped unless `includeNoTrip`.
- A live bus can run far from its baked time (it is the point of live data). The `scheduled`
  label on a live item is a nearest-time guess within 20 minutes, not a trip id join
  (the baked slice does not keep trip ids, to stay small).
- The timetable is one weekday, one Saturday and one Sunday of the feed. School breaks,
  holidays and a new feed (CapMetro replaces the feed every service change) are not modelled.
  The feed is valid until 2027-01-09; rebake with a newer zip and in-session dates:
  `python3 scripts/bake_transit_live.py PATH/TO/capmetro.zip 20270203 20270206 20270207`.
- Service-day maths uses local midnight in `America/Chicago`; on the two daylight-saving
  nights the scheduled times after 02:00 can be an hour off.
- The last in-box stop of a trip may be a real terminus; it is listed as a departure anyway.
- Phones: the trip-update file is 260 KB per poll. Keep `trips` off unless a stop is open.
- The right to the data is revocable (see the terms). If it goes, the layer shows nothing and
  `departures()` still answers from the baked timetable until the baked feed expires.
