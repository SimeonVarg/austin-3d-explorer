# What `data/entrances.geojson` actually costs — and why I am not touching it

QUEUE **W3**. Diagnosis only; no code changed, no data changed.
Acer lane, 2026-08-05, branch `acer/entrances-payload`.

**Answer: leave it alone.** The wire cost is 348 KB and the main-thread cost is
115 ms on a quiet CPU. Neither of the two proposed fixes collects most of that,
one of them cannot fire at all, and the file is not what Simeon is complaining
about — measured, it delays the buildings by 180 ms out of a 9.5 s boot.

The rest of this document is the measurement, because "it's fine" is worth
nothing without it.

---

## 0. Every instrument, and its settings

Quote the setting with the number or the number is about a different machine.

| instrument | what it was set to |
|---|---|
| local server | `python scripts/serve.py 8273`. **Does not gzip** — verified: `Accept-Encoding: gzip` on `/data/entrances.geojson` comes back with `Content-Length: 5568333` and no `Content-Encoding` header. Every local byte figure for this file overstates the wire by **16.0x**. |
| live server | `https://simeonvarg.github.io/austin-3d-explorer/`, `curl -I -H "Accept-Encoding: gzip, deflate, br"`, 2026-08-05. |
| parse bench | `parse-cost.mjs` (scratch). No map. Same-origin page, each file fetched to a **string once** so the network is out of the loop, then `JSON.parse` / `structuredClone` / `JSON.stringify` in **interleaved** reps — one rep of every file, then the next — so no file gets a cold heap and another a warm one. **7 reps, minimum reported.** |
| boot A/B | `ent-ab.mjs` (scratch). `?intro=0&drift=0`, `?entrances=0` for the OFF arm (js/entrances.js's own lever, so both arms are ONE build), `gl: hardware`, viewport 1440x900, `Network.setCacheDisabled: true` on both arms, `window.cancelGraphicsAutoDetect()` called the moment the style is up. **4 interleaved reps ON/OFF/ON/OFF, minimum reported.** |
| CPU throttle | `Emulation.setCPUThrottlingRate`. Stated per table. `1` = none. `4` is `perf.mjs`'s default and is stated as 4x wherever it appears. |

**The spread, so you know what the minimums are protecting you from.** Individual
readings of "every `austin-*` source loaded" in the boot A/B ranged from
**12,108 ms to 236,684 ms** on the same page, same flags, same machine. One
sample from that distribution is not evidence of anything.

---

## 1. Bytes

| | bytes | note |
|---|---|---|
| on disk / from `serve.py` | **5,568,333** | 11,890 features. No compression. |
| **from GitHub Pages, live** | **348,345** | `Content-Encoding: gzip`. **This is what a visitor pays.** |
| local `gzip -9` | 334,535 | where QUEUE's "326.7 KB" came from. Pages ships **4.1 % more** than this — it does not use `-9`. Quote 348 KB, not 327 KB. |

Compression ratio **15.98x**, which is the first real fact about this file: it is
enormously repetitive. 56.2 % of its raw bytes are `properties`, and all 11,890
features carry the same 16 keys, including the host building's full `nm` on every
stair nosing.

**Share of the payload, with the denominator that matters.**

| denominator | entrances is |
|---|---|
| all `data/` the app references, raw | 9.8 % |
| all `data/` the app references, gzipped | 4.4 % |
| **the flat JSON the main thread parses, raw** | **31.2 %** of 17.84 MB |
| **the flat JSON the main thread parses, gzipped from Pages** | **15.8 %** of 2,205,147 B |

The 4.4 % figure in QUEUE W3 is true and misleading. Five layers — trees, roads,
outer, roofdetail, props, and between them four of the six largest files — go
through PMTiles, so their bytes are decoded from protobuf **in the worker** and
never touch the main thread's JSON parser. Against the 19 files that are still
flat GeoJSON,
entrances is the second largest after `ground.geojson` and about a sixth of the
wire.

---

## 2. Main-thread JSON cost — the number nobody had taken

`parse-cost.mjs`, 7 interleaved reps, **min / median / max ms**.

**No CPU throttle:**

| file | raw KB | `JSON.parse` | `structuredClone` | `JSON.stringify` |
|---|---|---|---|---|
| **entrances.geojson** | 5,438 | **32.0** / 33.0 / 58.4 | **83.0** / 85.6 / 138.1 | 27.1 / 28.5 / 36.5 |
| ground.geojson | 5,071 | 39.5 / 43.9 / 52.3 | 99.6 / 117.1 / 139.3 | 48.8 / 49.6 / 53.2 |
| roofs.geojson | 1,649 | 12.3 / 12.4 / 22.9 | 33.6 / 35.8 / 54.9 | 29.3 / 29.6 / 45.0 |
| places.geojson | 996 | 6.3 / 6.4 / 11.0 | 15.0 / 15.2 / 19.9 | 6.5 / 6.6 / 7.2 |
| art.geojson | 607 | 4.2 / 4.4 / 4.9 | 10.7 / 10.7 / 15.1 | 3.4 / 3.6 / 4.7 |

**CPU throttled 4x** (`perf.mjs`'s default; the closest this suite gets to "his
laptop running Claude and quite a few Chrome tabs"):

| file | raw KB | `JSON.parse` | `structuredClone` | `JSON.stringify` |
|---|---|---|---|---|
| **entrances.geojson** | 5,438 | **195.8** / 258 / 276.7 | **488.5** / 600.6 / 690.7 | 144.3 / 191.6 / 197.7 |
| ground.geojson | 5,071 | 183.5 / 302.5 / 359 | 585.5 / 826.8 / 954.3 | 245.4 / 290.8 / 316.9 |
| roofs.geojson | 1,649 | 63.8 / 96.2 / 108.7 | 184.9 / 237.5 / 286.2 | 165.6 / 201.2 / 221.6 |

### Why `structuredClone` is in that table, and why it is the bigger half

MapLibre 5.24's `GeoJSONSource` branches on what you hand it, in
`_getLoadGeoJSONParameters` (read out of the shipped
`maplibre-gl@5.24.0/dist/maplibre-gl.js`):

- given a **URL string** it sets `params.request` — **the worker** does the fetch
  and the parse, and the main thread pays nothing;
- given a **parsed object** it sets `params.data = obj` and sends it through
  `actor.sendAsync` → `Worker.postMessage`, and the **structured-clone
  serialisation of that object happens on the main thread**.

`js/entrances.js:930` hands it the object. So the main-thread bill is
`parse + clone`, i.e. **115 ms unthrottled and 684 ms at 4x**, of which the
clone is 72 %.

**Corroborated in the live app, not just in the bench.** `ent-ab.mjs` wraps
`Worker.prototype.postMessage` and times every call. Largest single call:

| run | ENT ON | ENT OFF |
|---|---|---|
| 4-rep A/B, min across reps, 1x | **53 ms** | 19 ms |
| single earlier rep, 1x | 144 ms | 66 ms |
| single rep, 4x throttled | 1,929 ms | 440 ms |

Same direction, same order of magnitude as the 83 ms / 489 ms bench. That is
three independent readings of the same handoff.

---

## 3. Boot A/B — with the file and without it

`ent-ab.mjs`, hardware GL, cache disabled, auto-detect cancelled, `?intro=0`,
**4 interleaved reps, minimum**, served by `serve.py` on 8273 (so uncompressed —
the fetch numbers here are *worse* than a visitor's).

| | ENT ON | ENT OFF | delta |
|---|---|---|---|
| style loaded | 1,089 ms | 1,137 ms | −48 ms |
| **every `austin-*` source loaded** | **12,736 ms** | **12,108 ms** | **+628 ms** |
| `austin-buildings` loaded | 9,639 ms | 9,459 ms | **+180 ms** |
| **main thread blocked** (`longtask` total) | **3,704 ms** | **3,010 ms** | **+694 ms** |
| largest single `postMessage` | 53 ms | 19 ms | +34 ms |
| `austin-entrances` loaded | 10,788 ms | — | |
| entrance geometry first hit-tested | 12,674 ms | — | |
| fetch to response headers | 3,481 ms | — | see below |
| `Response.json()` wall time | 3,811 ms | — | **not the parse** |

Three of those numbers need reading correctly.

**`Response.json()` 3,811 ms is not a parse time.** `js/entrances.js` awaits
`fetch()` (which resolves at the *headers*) and then `r.json()`, so `r.json()`
has to stream the remaining 5.5 MB in before it can parse a byte. Almost all of
that 3.8 s is body download over a connection queue. **The parse is 32 ms.** Do
not quote 3,811 ms as parse cost — that mistake is exactly the shape of the ones
`scripts/verify/README.md` is written about.

**Fetch-to-headers 3,481 ms is a localhost artefact.** HTTP/1.1 to one origin
gives Chrome six connections, and this page asks for ~25 files at once, so the
entrances request sits in a queue. GitHub Pages is HTTP/2 and multiplexes. This
number does not transfer.

**Entrance geometry "first hit-tested" is what it says, not a pixel read.** It is
the first 150 ms poll at which `map.queryRenderedFeatures` over a 240 px box at
the screen centre (z17.5, pitch 60, over central campus) returns a feature from
`entrances-portal` / `-glass` / `-detail`. It is a render-path query, so it means
the geometry is built and in the frame — but I did not confirm doors by eye at
that pose, and at z17.5 a 3 m portal is a few pixels wide (see §6). The pixel
proof that this layer draws at all is HANDOFF §89's `shots/entrances/final/`.

The useful thing about it is the comparison: **12,674 ms against an all-sources
time of 12,736 ms in the same run.** The doors arrive *with* the city, not after
it. `austin-entrances` was ready at 10,788 ms and was never the last source in
any of the four ON reps.

---

## 4. It is not what Simeon is complaining about

> *"on my laptop (running claude and quite a few chrome tabs) the downtown
> buildings arent loaded even when loading screen completes"*

The veil lifts on `INTRO.needs` in `js/app.js:1545` —
`austin-outer`, `austin-buildings`, `austin-ground`, `austin-roads` — plus a
`minVeilMs` floor of 7,000 ms and a `maxVeilMs` ceiling of 18,000 ms.
**`austin-entrances` is not in that list and cannot hold or release the veil.**
`js/loader.js` does count it in the progress rail's denominator, so it moves the
bar, but nothing in the rail decides when the screen goes.

Its measured effect on the source he is actually missing is **+180 ms on
`austin-buildings` out of a 9,459 ms minimum: 1.9 %.** Deleting the entire file
would not have fixed his frame.

---

## 5. The three options, priced

### Leave it alone — RECOMMENDED

Cost 0. Foregone saving: 348 KB of wire (15.8 % of the flat JSON, 4.4 % of all
data), 115 ms of main thread unthrottled, 684 ms at 4x, 628 ms of
all-sources-ready.

### Tile it through PMTiles — NO

**It would not collect the parse, which is the half that a tiled layer is
supposed to remove.** `initEntrances` (js/entrances.js:906–930) fetches the whole
file and `JSON.parse`s it **before** it decides between `tileSource('entrances')`
and the flat source, because the sign-band tones, the inscription point source
and the 22 West Campus wordmark points are all derived on the main thread from
the full feature list. So tiling as the note at line 924 anticipates would:

- keep the 348 KB fetch **and** the 32 ms / 196 ms parse;
- **add** the tile fetches on top;
- collect only the clone: 83 ms at 1x, 489 ms at 4x.

And it is the expensive option to build:

- `TILES.maxzoom` in `js/tiles.js` is a single global **16**, and this module's
  own header (§2) refuses maxzoom 16 / tolerance 0.5 in writing, because the
  median piece is a **0.35 m** stair nosing and the smallest is **0.06 m**, and
  at z16 one tile pixel is ~2.4 m of ground. Entrances would need its own
  maxzoom-18 archive and a per-layer maxzoom that `js/tiles.js` does not have.
- MVT quantises coordinates to the tile extent. At the default 4096 and z18 that
  is ~3.7 cm per unit at this latitude, so a 6 cm nosing survives as ~1.6 units.
  Not obviously safe; would need its own verification pass.
- `scripts/tile.sh` and `build-tiles.yml` changes, i.e. a CI round trip that
  HANDOFF §39 records **failing after 00:00 UTC even after building correctly**.

Five files and a CI risk and a geometry-fidelity risk, to buy at most 489 ms of
main thread and *more* bytes. No.

### Gate it by zoom — CANNOT FIRE

`ENT.minZoom` is **15.2**. Every camera the app uses during boot is above it:

| pose | zoom |
|---|---|
| `SPAWN` (js/app.js:28) | 16.5 |
| `INTRO.start` | 16.2 |
| `INTRO.crest` | **15.45** — the lowest point of the whole flight |
| `INTRO.end` | 16.9 |

A gate at the layer's own threshold never fires during a boot or an intro, so it
defers nothing. To defer past the flight the **draw** threshold would have to go
above 16.9, which takes the doors out of the default view — a taste change
nobody asked for, on a pass a product manager has already seen.

---

## 6. Two things I checked and rejected on the way

**Shrinking the file in the bake is not worth it, because gzip already ate the
redundancy.** Three property keys — `dt`, `n`, `src` — are read by nothing in
`js/entrances.js` (`bid` *is* read, at lines 986 and 1216, so it stays).
Dropping those three:

| | raw | gzipped |
|---|---|---|
| now | 5,568,333 | 342,096 (local `-6`) |
| without `dt`/`n`/`src` | 5,094,875 (**−8.5 %**) | 337,544 (**−1.3 %**) |

8.5 % off the parse is about **3 ms** unthrottled. Even the aggressive version —
strip every key the paint expressions do not read — is raw −37 % / gzip −11.9 %,
i.e. ~12 ms, and it breaks `entrancesStats()` and the wordmarks. Not worth a bake
run.

**If the boot budget ever does bite, the cheap lever is none of the three.** Move
the inscription/wordmark point derivation and the sign-tone scan into
`scripts/bake_entrances.py` as a small side file, then hand the source the URL
**string** `'data/entrances.geojson'` instead of the parsed object. MapLibre then
takes the `params.request` branch, the worker does the fetch and the parse, and
the main thread pays **zero** — the whole 115 ms / 684 ms, with no new archive,
no CI, and no risk to 6 cm geometry. That is one edit in `js/entrances.js` plus a
bake emit. **Not recommended now**: the measured cost does not justify reopening
a pass that merged three days after the project was submitted.

---

## 7. What did NOT work

1. **The 4x-throttled whole-app A/B is unusable on this machine and I am
   throwing it out.** Under `Emulation.setCPUThrottlingRate: 4` the page took
   **419,777 ms** (ON) and **295,017 ms** (OFF) to reach all-sources-ready, never
   finished loading every source in either arm, and the browser died on rep 2.
   The 4x numbers in §2 are from the isolated bench, which throttles cleanly
   because it is 40 ms of arithmetic and not a 20-source map. **There is no
   throttled whole-app reading in this document** and I am not going to invent
   one from the unthrottled delta.
2. **A full-viewport `queryRenderedFeatures` on every `render` event kills the
   renderer.** The first version of the paint probe did that over three
   fill-extrusion layers at 60 Hz and took the browser down twice with
   "Target page, context or browser has been closed" and no crash event. Polling
   a 240 px centre box at 150 ms is stable. If a probe kills Chrome without
   logging anything, suspect your probe before you suspect the page.
3. **`serve.py` hands `.md` back as `application/octet-stream`**, so
   `page.goto('/data/README.md')` **downloads** instead of navigating and
   Playwright throws "Download is starting". A directory listing (`/docs/`) is
   `text/html` and same-origin, which is what the bench uses. Relative `fetch()`
   from there resolves against `/docs/`, so the paths must be absolute or you
   will `JSON.parse` a 404 page.
4. **I could not photograph a door to back the first-paint number.** z17.5 shows
   nothing at door scale; a z20 pose at a measured Welch Hall door
   (`-97.737664, 30.285747`) put the camera inside the roof from both bearings I
   tried. Pose-hunting is not what W3 is for, so I stopped — but it means §3's
   `12,674 ms` rests on the renderer's hit-test rather than on pixels, and it is
   labelled that way above. HANDOFF §89's `shots/entrances/final/` is the pixel
   evidence that the layer draws.

---

## 8. One line for QUEUE

**W3 is answered: leave `data/entrances.geojson` alone.** 348 KB from Pages
(15.8 % of the flat JSON), 115 ms of main thread unthrottled, +180 ms on the
buildings source, and it does not gate the loading screen. Tiling would keep the
parse and add bytes; a zoom gate cannot fire below the poses the intro uses.
