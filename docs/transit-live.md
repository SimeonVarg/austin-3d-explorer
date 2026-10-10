# Live buses (`js/transit-live.js`)

Live CapMetro bus positions on the map, and "next departures" at a stop, live when the feed
has them and from the baked timetable when it does not. A static page, no key, no server.
It only DOWNLOADS public feeds: nothing about the user (class buildings, schedule, position)
is ever sent anywhere, which keeps the finder's privacy rule intact.

**What a poll reveals, plainly.** Every poll is a plain GET to data.texas.gov (and the baked slice
is a GET to this site). data.texas.gov therefore sees the visitor's IP address and the page's
referrer, as it would for any download, and nothing else: no address it is asked for depends on a
stop, a route, a home or a building, and nothing is sent in a body. `TransitLive.credit` says so
in one sentence next to the attribution, and `scripts/verify/finder-egress.mjs` records every
request of a 5-minute run and checks it.

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
`tripsStaleS`, `horizonMin`, `bakeUrl`, `includeNoTrip`, `staleVehicles`, `staleOpacity`, `showLines`, `beforeLayer`, and every
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

`state()` is `{ok, ageSec, fetchedAt, vehicles, error, timetableExpired}`: `ageSec` is the age of the vehicle
file itself (its header timestamp), `ok` goes false after an error or when it is older than
`vehicleStaleS` (90 s). After an error the poll waits `interval * 2^failures` (capped at 5 min)
and goes back to normal at the first success. A hidden tab polls nothing; it resumes at once
when it becomes visible.

Layers added by `attach(map)`: sources `transit-live-vehicles|stops|lines`, layers
`transit-live-lines` (hidden unless `showLines`), `-stops` (circles from zoom 14),
`-vehicle-halo` and `-vehicles` (circles in the route colour). No image files, no text layer
(the app style has no glyph server we could rely on): vehicle features carry `route` (short
name), `color`, `bearing` and `id` for a popup, and stop features carry `id` and `name`.

## Review fixes (2026-10-10)

An independent review of the first version found real faults; each is fixed and has a test in
`scripts/verify/transit-live.mjs` (the numbers are the review's items).

1. **A stale poll touches nothing.** A request that was in flight when `stop(); start()` ran used to
   reset the busy flag and start a second poll chain whose timer `stop()` could not clear. Now an
   old generation returns before it touches any flag or timer, a timer is always cleared before it
   is replaced, and `stop()` cancels the requests in flight (their timeout timers are cleared and
   they are aborted).
2. **The timeout covers the body.** `timedFetch` reads `r.json()` / `r.arrayBuffer()` inside the
   timeout, so a body that never arrives ends in `state().error = 'timeout ...'` and the next poll
   runs after the back-off.
3. **Protobuf lengths are checked.** Every varint, length, float and double is checked against the
   end of the message being read. `TransitLive.decode(bytes)` returns `{timestamp: 0, vehicles: [],
   trips: [], error}` for a bad message instead of throwing; a poll that gets one counts as failed.
4. **Cancelled trips.** A trip update marked CANCELED is never offered, and it removes the nearest
   unused baked time of the same route and direction within `matchMin` at the stops it lists (one
   baked time per cancellation, so a busy route never loses more than it should). Limit: a
   cancellation that lists no stop times cannot be placed at a stop, so it hides nothing.
5. **Failed or stale vehicles are not drawn.** When the vehicle feed failed or is older than
   `vehicleStaleS`, `draw()` shows no bus (`staleVehicles: 'hide'`, the default). The other value,
   `'dim'`, draws the old ones faded (`staleOpacity`, feature property `old: true`).
6. **Tomorrow's first trips.** `scheduled()` also looks at tomorrow's service key. With this bake it
   changes nothing, and the test proves why: the earliest baked trip of any day key starts at minute
   234 (route 20, weekdays), and the look-ahead is 120 minutes, so at 23:50 there is nothing of
   tomorrow's inside it. A re-bake with a trip at 00:10 would have been missed before.
7. **A bake past its last date.** Once the local date is after `feed.to`, `state().timetableExpired`
   is true, `state().error` says `timetable out of date: the baked schedule ended <date>`,
   `departures()` offers no baked time (live buses still come through, with `scheduled: null`) and
   the finder's line says the timetable has run out of date instead of printing "(timetable)".

**The route search (`js/transit-route.js`), same review.**
8. *Midnight.* 00:15 on Saturday is `{day: 6, minute: 15}` and `{day: 5, minute: 1455}`; `headwayAt`
   tries a time before the service day's first trip (or negative) as the previous day plus 1440, and
   1440 or over as the next day minus 1440. Both forms give the same answer, on the hand-made slice
   and on the real bake.
9. *Walking is the baseline.* `plan()` returns `walk: {lo, hi, m}` (the whole trip on foot by the same
   walking model) and offers a bus only when its midpoint beats the walk's by `ROUTE.busBeatsWalkS`
   (120 s). Two points closer than `ROUTE.sameSpotM` (10 m) get no bus. The finder's line says
   "Walking to X is as quick as any bus" in that case.
10. *Speed.* The transfer neighbours of each stop are worked out once, only lines that reach the end
    are followed, answers are kept per chain of routes, and a candidate whose time cannot make the
    top three is dropped before its legs are built. Measured on the real bake (see the PR): the
    walking-model calls per plan fell from up to 5995 to 560.
11. *Bad data.* A malformed `first`, `last` or `headway` means "not running" (counted in `skipped`),
    never "always running"; `plan(null, ...)` or a slice without stops or routes returns
    `{options: [], reason: 'no timetable'}`; `plan()` never throws.

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
