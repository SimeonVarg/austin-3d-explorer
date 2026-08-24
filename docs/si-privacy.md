# A class schedule is personal data — the storage lane

`acer/si-privacy`, 2026-08-24. One lane of the schedule-import round. It owns
**storage, deletion, and the sentence that tells a student the truth about
both** — `js/wayfind.js` §12 (a new section; nothing existing edited), the
privacy copy in `index.html`, and this file. Four sibling lanes own the three
importers and the import bar. Nothing here needs them to exist, and everything
here has a seam for them (§10).

`WAYFIND.on` is untouched. The whole section sits inside the `if (!ENABLED)
return` at `js/wayfind.js:1320`, so with the feature off it adds no element, no
listener, no wrapper and no storage — §5.G proves that by loading the page
without `?walk=1` and looking.

---

## THE VERDICT, ROUND 5 — read this first

**Round 4's critic found a real hole and it is now closed.** The guard could
not read a `Blob` or a `ReadableStream` request body synchronously, so it
counted those and let them through. The critic fired
`fetch(url, { body: new Blob([schedule]) })` at a bare socket with the guard
armed and watched the schedule arrive verbatim. **A seatbelt with a buckle that
did not close over one shape of passenger.**

Since round 5, while a schedule is stored, **a body the guard cannot read is a
body it refuses.** Proven by running it, not by reading it:

| | disarmed | armed |
|---|---|---|
| `fetch` with a Blob body | canary **read off a raw TCP socket** | refused, socket silent |
| `XMLHttpRequest.send(Blob)` | canary read off the socket | refused, socket silent |
| `navigator.sendBeacon(url, Blob)` | canary read off the socket | refused, socket silent |
| `Worker.postMessage({ payload: Blob })` | accepted | refused |
| `fetch` with a `ReadableStream` body | — | refused |
| a plain bodyless `GET` | 200 | **200 — untouched** |

The instrument is a **bare TCP listener** reading the bytes off the wire, not
the browser automation. That is deliberate: the round-4 finding was partly a
claim about what Playwright can see, and a socket has no opinion about its own
input. §6 has the whole run.

**And one correction the critic is owed back.** It also reported that this
audit's own capture was blind to Blob bodies — that Playwright's `postData()`
returns nothing for one, so the audit could report "zero requests carried
schedule content" while being wrong. **Measured on this machine, that is not
true.** playwright-core 1.62.0 implements `postData()` as
`postDataBuffer()?.toString("utf-8")` — same source, so the two cannot disagree
about *whether* a body is there — and the run below shows both of them reading
the canary out of a Blob. The critic reasoned where it could have measured. The
socket sink stays anyway, because "what the tool can see" is a version-dependent
variable and the point of this section is not to have those.

**What it cost:** nothing. A cold load of the city with a schedule already
stored puts **2,086 to 2,679 worker messages** through the guard across four
runs — the count moves with how many tiles the camera happens to pull — and
blocks **zero** of them in every run, because every request this app makes on
the hot path is a bodyless `GET`. Measured, §6.

**Reproduce the whole thing in three commands:**

```
python scripts/serve.py 8915                 # never python -m http.server
node scripts/verify/harness-drift.mjs        # preflight; PASS, 31/31 scripts
cd scripts/verify && VERIFY_URL=http://127.0.0.1:8915 node r5-blob.mjs
```

`r5-blob.mjs` is in §11 verbatim (this lane may not write `scripts/verify/`).

---

## 1. The promise, and the one sentence that makes it

> **Your schedule stays on this device — saved in this browser only, never
> uploaded anywhere, and Delete wipes it for good.**

Three clauses, because there are exactly three things a student wants to know,
and each is a claim this round can actually back:

| clause | what backs it |
|---|---|
| *saved in this browser only* | one `localStorage` key, `austin3d.schedule.v1` |
| *never uploaded anywhere* | §5.C and §6 — every request during a real import, scanned. Zero. |
| *Delete wipes it for good* | §5.E and §5.F — the real button, then a reload |

No "we may share with our partners", no "we take your privacy seriously", no
link to a policy. It says what happens, in the voice the rest of this feature
already uses (*We can't route inside buildings*; *Nobody was asked about
lighting along this route*). One sentence, because a student reads one sentence.

**Where to change the wording:** `index.html`, the `<template
id="wf-privacy-copy">` block above the `js/wayfind.js` script tag — a one-line
HTML edit (CLAUDE.md rule 11). `js/wayfind.js` carries the identical strings as
`SCHEDULE_PRIVACY_COPY`, because `_harness.html` has no template and must say
the same thing. §5.A asserts the two have not drifted, so changing one and not
the other turns the gate red on purpose instead of quietly shipping two
different promises. The template is not a `<script src>`, so `harness-drift.mjs`
is unaffected — verified, it passes.

![the panel, in the city](../shots/si/privacy/r5-in-the-city.jpg)

---

## 2. What a student sees

Three states, in the footer of the walk sheet — where this feature already puts
the things it has to say about itself.

| nothing stored | a schedule stored | just deleted | after a reload |
|---|---|---|---|
| ![](../shots/si/privacy/2-panel-empty.png) | ![](../shots/si/privacy/r5-panel-saved.png) | ![](../shots/si/privacy/r5-panel-deleted.png) | ![](../shots/si/privacy/5-panel-after-reload.png) |

- The sentence is there **before** anything is imported, not after. A student
  should know where their schedule is going before they paste it in.
- The Delete button only exists when there is something to delete.
- **One tap, no "are you sure".** The brief asked for one tap, and an undo would
  mean keeping the data after telling someone it was gone. If that ever reads as
  too sharp, `SCHEDULE_STORE.deleteNeedsConfirm = true` is the one-line change.
- The state line says **counts and a source**, never a class name — the sheet
  can be open on a phone somebody else is looking at.

---

## 3. What gets stored, and the three things reserved for imports that do not exist yet

One key, `austin3d.schedule.v1`, holding one JSON envelope. A four-class
schedule is 1,397 bytes.

```
{ v, savedAt, term, tz,
  sources: [ { id, kind, label, importedAt } ],
  classes: [ { id, code, room, title, instructor, days[], startMin, endMin,
               unroutableWhy, confidence, src, provenance } ] }
```

Simeon asked for Google Calendar, Apple Calendar and UT's registration export
now, and for a photo of a schedule or a Registration-Plus API to be addable
later **without a rewrite**. Three reservations buy that, and each is something
that would otherwise force every stored schedule to be migrated:

1. **`sources` is a LIST, and each class points at one.** A photo imported on
   top of an existing `.ics` has to *add* to a schedule, not replace it. A
   single `source` string on the envelope cannot express that, and discovering
   it later means a schema change.
2. **`confidence` and `provenance` on every class.** An `.ics` is exact — 1.0,
   and the `VEVENT` UID. OCR is not, and needs somewhere to record which box on
   the image a room number came from, so the student can be shown what to check.
3. **`v` plus a `SCHEDULE_MIGRATIONS` chain.** A v2 reader opens a v1 blob; a v1
   reader hands back `{tooNew:true}` and leaves the data alone rather than
   deleting a schedule it does not understand.

`SCHEDULE_SOURCES` already names `image-ocr` and `registration-plus` alongside
the three being built — listed before they exist on purpose. That is the
forward compatibility, written down, and it means the delete sweep in §4 already
covers what they will write.

**`unroutableWhy` is a string, not a boolean**, because eleven codes a real UT
schedule can name cannot be routed to in this build, and they are **two
different problems wearing one label** (§7).

---

## 4. Delete means gone

`WAYFIND.store.clear()` does four things, and the second is the one that matters
for a feature that is going to grow:

1. removes `austin3d.schedule.v1`;
2. **sweeps every key under the `austin3d.schedule.` prefix, in `localStorage`
   AND `sessionStorage`** — so a source added next month that writes its own key
   is already covered by a delete written today. `austin3d.gfx.v1`
   (`js/graphics.js`) does not match the prefix and is left alone; §5.E and §5.F
   both print the surviving key list to prove it;
3. deletes the IndexedDB database `austin3d-schedule`, **whether or not anything
   has created it**. A photo will not fit in `localStorage`, so the OCR pass will
   need IDB, and delete has to reach it the day it starts existing. Deleting a
   database that was never created is a no-op;
4. drops the in-memory copy **and the egress guard's watchlist** — the guard must
   not end up holding the last copy of the thing it was guarding.

A `storage` event listener makes a delete in one tab a delete in every tab.

---

## 5. The audit — driving the real thing, not reading the code

playwright-core from `scripts/verify/node_modules`, explicit `executablePath`
`C:/Program Files/Google/Chrome/Application/chrome.exe`, one browser, killed at
the end, port confirmed free after. `?walk=1&drift=0&intro=0`,
`window.cancelGraphicsAutoDetect()` at the top of every page, wait for the veil
to go. `harness-drift.mjs` passes before each run: 31 / 31 scripts.

### 0. The doc's own citations, before anything is measured

A gate reads this file, resolves **every path it cites**, and fails if one does
not exist — either here, or in the branch the doc names next to it. It exists
because round 3 of this document backed its central factual claim with four
citations to `docs/schedule-gaps.md` (does not exist), and nothing caught it
because nothing was looking. The gate caught it on its first run. It also
asserts the sentence quoted in §1 is byte-identical to the one `index.html`
serves and the one `js/wayfind.js` falls back to. Script in §11a.

### A–B. The feature is on, the panel is mounted, and a real schedule goes in

`WAYFIND.store` exists under `?walk=1`; the guard reports installed and armed;
the panel is really on screen (a box with width and height, not a computed
style). A Google Calendar export is parsed and saved through the real
`WAYFIND.store.save()` — the same seam the importer lanes call. The state line
is asserted **not** to contain any class title.

### C. Every request, scanned

Every request during the import window is captured and scanned against the
schedule's own strings — page-level, and worker-level via a recorder injected
into each worker, because `scripts/verify/README.md` documents that a
page-scoped capture cannot see MapLibre's worker fetches and will under-report a
load by 19 MB. **Zero requests carried schedule content.**

### D. The negative control — nine channels, fired disarmed then armed

§9 advertises seven doors. Every one is fired twice: disarmed, to prove the
channel really carries and the instrument really sees it; then armed, to prove
the guard is what stopped it. Each case asserts the two outcomes **differ** and
that the armed one is ours. All nine close.

Three are worth a note, because a lazy test would pass while proving nothing:

- **`WebSocket.send` throws either way.** The socket never connects, so an
  unguarded `send` throws `InvalidStateError`. The test is that the two errors
  are *different* — the guarded one is our block, thrown before `super.send`.
- **`form.submit()` and `form.requestSubmit()` are two different doors.**
  `submit()` fires no `submit` event, so the prototype wrapper and the
  capture-phase listener are separate code with separate bugs available to them.
- **The form test found a bug in the instrument, not the guard.** The first
  version submitted into `target="_blank"`; the request then belongs to a popup,
  the page-scoped capture never sees it, and the *disarmed* control reported
  zero — a clean-looking result that meant the instrument was blind. It submits
  into a hidden same-page iframe now.

Re-run on this round's commit with the fail-closed change in place: **ALL PASS,
unchanged.** The nine-door script is long and unchanged since round 4, so rather
than carry it twice it is recoverable verbatim from this branch's own history:

```
git show 83382d4:docs/si-privacy.md      # §10b of that revision
```

### E and F. Delete, then reload

A **real mouse click** on the real `#wf-priv-del`, then a fresh document:

```
PASS  no schedule key left in local or session storage    ["austin3d.gfx.v1"]
PASS  store.has() false immediately after the tap
PASS  inventory reports zero bytes stored
PASS  the guard dropped its copy of the schedule too
PASS  RELOADED: no schedule key in storage                ["austin3d.gfx.v1"]
PASS  RELOADED: the schedule key reads null
PASS  RELOADED: store.load() returns nothing
PASS  RELOADED: reserved IndexedDB database is not there  []
PASS  RELOADED: the panel is back to its empty state
```

The one surviving key is the graphics preference this app already had.

**The trap in this stage, and how round 5 avoids it.** `r5-blob.mjs` seeds the
schedule with a page-scoped `addInitScript` so the guard is armed from boot.
Reloading *that* page would write the schedule straight back, and "delete
survived a reload" would be testing the seeder — green, and meaningless. The
reload is therefore a **new page in the same browser context**: same origin,
same storage on disk, none of the first page's init scripts.

### G. Off is still off

With `?walk=1` absent: no `WAYFIND.store`, no `window.wayfindStore`, no panel,
no injected CSS, and `fetch`, `XMLHttpRequest.prototype.open`,
`navigator.sendBeacon` and `Worker.prototype.postMessage` are all still the
native functions.

---

## 6. The round-5 change: an unreadable body is refused, not waved through

### What was wrong

`bodyToText()` returns a string for a string, a `URLSearchParams`, a `FormData`
or a small buffer — and `undefined` for a `Blob`, a `ReadableStream`, or a
buffer past `maxBytes`. `inspect()` used to treat that `undefined` as "nothing
to scan", count it, and let the request go. **Unreadable was being treated as
empty.** Every one of round 4's nine channels was fired with a *string* body, so
nothing in the audit had ever exercised the other branch.

### What it is now

`SCHEDULE_STORE.blockUnreadableBodies` (default `true`). While a schedule is
stored, a body the guard cannot read is a body it cannot clear, and it is
refused with the same error the guard uses for a real match — the log says
`a body the guard could not read` rather than a redacted token, because that is
what actually happened. `SCHEDULE_STORE.blockOpaqueWorkerLeaves` is the same
rule for a `Blob` handed to a worker instead of the network; it is a separate
constant because that one sits on MapLibre's per-tile path and the other does
not. Both are one-line flips back to fail-open if a later lane ever needs a
genuine binary upload.

`scanStructured()` had the identical defect one layer in: a `Blob` is an object
with no own enumerable properties, so the walk strolled past one and reported a
clean `hit: null`. It now reports `opaque` and the caller decides.

### The run

A **bare TCP listener** on 127.0.0.1:8916 — `net.createServer`, not `http`,
because a framework can normalise, buffer or drop a body and I would never know.
It records the literal bytes that arrive. The canary strings belong to this run
and nothing else: a class title, an instructor, a room.

```
── 1. what the new rule cost on a cold map load with a schedule stored ──
    {"checked":2666,"quietChecked":2596,"blocked":0,"unreadableBodies":0,"opaqueWorkerLeaves":0}
  PASS  the guard really did inspect worker traffic during the cold load   2596 worker messages
  PASS  the new fail-closed rule blocked NOTHING the app itself does
  PASS  no request this app makes has a body the guard cannot read
  PASS  no worker payload this app posts contains a Blob or a stream

── 2. BLOB probe, disarmed: does it carry, and can the instrument see it? ──
    fetch              -> sent            socket saw: ["Ferroelectric Hysteresis Seminar","Okonkwo-Halvorsen","Cryptographic Protocol Design"]
    xhr                -> sent            socket saw: [ …the same three… ]
    sendBeacon         -> returned true   socket saw: [ …the same three… ]
    worker-postmessage -> posted          socket saw: []
    postData()       saw the Blob canary: true
    postDataBuffer() saw the Blob canary: true
  PASS  socket and capture AGREE about the disarmed leak — neither instrument is blind

── 3. BLOB probe, armed: is it refused, and does the socket stay silent? ──
    fetch              -> threw: [wayfind] blocked: fetch carried stored schedule co   socket saw: []
    xhr                -> threw: [wayfind] blocked: XMLHttpRequest carried stored sc   socket saw: []
    sendBeacon         -> returned false                                               socket saw: []
    worker-postmessage -> threw: [wayfind] blocked: Worker.postMessage carried store   socket saw: []
  PASS  fetch: ARMED — NOTHING reached the socket   []
  PASS  xhr: ARMED — NOTHING reached the socket   []
  PASS  sendBeacon: ARMED — NOTHING reached the socket   []

── 4. the other unreadable shape: a ReadableStream body ──
  PASS  a ReadableStream body is refused the same way a Blob is

── 5. the rule did not break ordinary traffic ──
  PASS  a bodyless GET is untouched with a schedule stored   ok 200
  PASS  the guard counted its opaque refusals   blockedOpaque=5
  PASS  still no inspector failures
```

The **disarmed half is the load-bearing half**. Without it, "armed, nothing
reached the socket" is equally consistent with a probe that never fired, a sink
that was not listening, and a guard that works. Disarmed, the canary is sitting
in the socket's buffer — so the channel carries, the sink sees, and the only
thing that changed between the two rows is the guard.

### Cost, measured on the right window

Round 4's cost number was taken *after* the map had loaded, so the guard had
spent the whole cold load on its fast path with an empty watchlist — the wrong
window. `r5-blob.mjs` writes the schedule into `localStorage` at document-start,
before the app boots, so `scheduleLoad()` finds it during boot and **every**
worker message of the cold load is inspected.

**Four runs, not one**, because this suite has been burned by single readings
before (`scripts/verify/README.md`): 2,596 / 2,654 / 2,679 / 2,086 worker
messages. The count moves with how many tiles the camera pulls, which is why the
number to read is not the count but what happened to it — **blocked 0,
unreadableBodies 0, opaqueWorkerLeaves 0, inspectFailures 0, in every run.** The
new rule never fires on this app's own traffic, because every request on the hot
path — tiles, glyphs, sprites, style JSON, the baked city data — is a bodyless
`GET`.

---

## 7. The eleven unroutable codes — and a correction this doc owes the reader

**Round 3 of this doc got SSW wrong in the worst available way: a confident
reason with a citation to a file that has never existed.** It said SSW was
demolished in September 2024 and sourced that to `docs/schedule-gaps.md` (does
not exist) — not on this branch, not on any other, not at any point in this
repo's history. Retracted. What follows is the measurement that should have been
there.

`walkmeter.mjs` on this branch: `UT buildings this build cannot route to at all
(11): BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB`.

**Ten of them are 9.6–10.6 km from the nearest node of `data/walk_graph.json`,
with no footprint anywhere near them — the Pickle Research Campus, genuinely off
this map. SSW is 37 m from mapped pavement and its UT-surveyed door sits 0.4 m
off the edge of a footprint this app draws today.** Three orders of magnitude
apart: these are two different problems, and a demolished building does not have
that geometry. SSW is genuinely missing from `data/ut_buildings.json` — but that
file is a snapshot retrieved 2026-08-05, not an authority, and round 3 slid from
*absent from our snapshot* to *does not exist*.

**A sibling lane reached the same numbers independently and acted on them.**
`docs/si-gaps.md` (on `origin/acer/si-gaps`) measured SSW's doors at 0.37 m and
2.45 m from the same footprint, found UT filing SSW under its own main-campus
path, and fixed it with one table row — taking the count from 11 to 10. Verified
this round by reading that branch's tree directly; its numbers and the ones above
agree. This lane stores whatever `unroutableWhy` string it is handed and does not
own that table, so nothing here changes.

---

## 8. What the guard costs, and the two measurements that were wrong first

The guard sits on `Worker.prototype.postMessage`, which is MapLibre's per-tile
path. "It's bounded" is a claim about code, so it was measured — and the first
two attempts were both bad instruments, which is the part worth recording.

**Wrong measurement #1: whole-map load time with and without a stored
schedule.** After the first rep every tile was in the HTTP cache, so the later
reps did *zero* guard checks and the guarded condition came out **27% faster**.
That is not a result; it is a cache mistaken for one.

**Wrong measurement #2: absolute microseconds across runs.** The unguarded
baseline for the identical benchmark moved from 7.4 µs to 68 µs depending on
what the other lanes were doing — 82% CPU and 35 Chrome processes at one point.
Only conditions interleaved inside a single run are comparable.

So: 4,000 MapLibre-shaped `loadTile` messages through a do-nothing worker, the
two conditions interleaved, **minimum of 8 reps**.

| | first version | after the fix |
|---|---|---|
| guard cost per main→worker message | **42.6 µs** | **3.8 µs** |
| 1 MB `Float32Array` payload | no measurable cost | no measurable cost (buffers are skipped, not walked) |

Two things were wrong in the first version. It **wrote a log line per message** —
a `performance.now()`, an object, and a `shift()` off a full ring buffer, per
tile; worker messages are now counted and only logged when they match. And it
**concatenated every string in a message into one haystack and scanned it with a
compiled alternation**, which was the second mistake dressed as an optimisation:
an alternation retries every branch at every start position, so ~22 branches over
a 60-character tile URL is over a thousand attempted matches to conclude "no". It
now tests each string leaf with `indexOf` behind two cheap gates. Same leaks
found, because every watched token is a whole field value and lives inside one
leaf if it is there at all.

**In real terms:** at 3.8 µs, the ~2,100–2,700 messages of a cold load are
**about 8–10 ms of guard work**, and only when a schedule is stored at all. With
nothing stored the guard is one `if` and returns.

---

## 9. The guard, and exactly what it is not

`installEgressGuard()` wraps the ways bytes leave a page and refuses any that
carries a watched string: **`fetch`, `XMLHttpRequest`, `navigator.sendBeacon`,
`WebSocket` (open and send), `EventSource`, `HTMLFormElement.submit` plus a
capture-phase `submit` listener, and `Worker.prototype.postMessage`.**

It is a **seatbelt, not the safety case.** The safety case is that no code here
sends anything. The guard exists so that if a later lane wires an analytics call
into this file, the call fails loudly instead of quietly working.

**`Worker.prototype.postMessage` is the interesting one.** The guard is
main-thread, and MapLibre fetches tiles inside workers where it cannot reach.
Rather than chase the bytes into the worker, it stops schedule bytes from ever
getting in. A worker cannot send what it was never told.

What it does **not** cover, said plainly:

- **`<img src>` and plain link navigation.** Covered by the browser-level
  capture in §5.C, which sees every request regardless of who made it — but not
  by the runtime guard.
- **A fragment of a field.** Whole field values are the tokens. A leak of
  `"Data"` out of `"Data Structures"` would not match. Whole values are what a
  serialiser emits; word fragments are what tile URLs are full of, and watching
  those would block the map.
- **A throw inside the inspector fails OPEN** — the request proceeds — and is
  counted. Failing closed *there* would let a bug in this file break the city.
  The audit asserts `inspectFailures === 0`; it has been 0 on every run.
- **An unreadable body no longer fails open.** That was round 4's finding and §6
  is the fix. This bullet used to say the opposite, and it was wrong.

---

## 10. The seam for the sibling lanes, and the patches this lane could not make

Nothing above needs an import bar. When one exists:

```js
WAYFIND.store.mount(el)            // put the sentence + Delete inside the bar
WAYFIND.store.save(parsedDoc)      // the only writer; normalises + stores
WAYFIND.store.load()               // null, the doc, or {tooNew:true}
WAYFIND.store.has() / .clear() / .clearAsync() / .inventory()
WAYFIND.store.onChange(fn)         // returns an unsubscribe
WAYFIND.store.guard.state() / .log()
```

`save()` runs everything through `normaliseSchedule()`, so a photo and an `.ics`
cannot drift into two shapes. Until a bar exists, the panel mounts itself into
`#wf-sheet .wf-foot`.

**A lane's own audit passing is not evidence that the lane did not break
somebody else** — in the previous round of this project one lane's own critic
returned a clean verdict on a commit that had silently broken another lane's
stairs fix. So `walkmeter.mjs` was run on this branch after the round-5 change,
and it is the other lanes' scoreboard, not this one's:

```
9/9 clean; 9 of them would have offered a stepped door with the toggle off
reachable step-free from a hub   56/56   56/56   (utVirtualStepFree off -> on)
stranded before: none   after: none
buildings still outside 15 m: none
LIVE UI GATE — a real mouse click on the "Avoid stairs" checkbox
  before  "2-4 min walk · 240 m · Stairs: 1 set"
  after   "Under 1 min walk · 46 m · No stairs on this route"
PASS  self-check drift 0 over limit, 0 route error(s), UI gate pass
```

The door lane's nine doors and the stairs lane's toggle are untouched — which is
what you would expect from a change confined to §12, but expecting is not
checking. The same run is where §7's list of eleven comes from, live on this
branch rather than quoted from a previous round.

**Merged with the siblings and re-run there.** Merged with `acer/si-gaps`,
`acer/si-ui` and `acer/si-parser`: `js/wayfind.js` auto-merges against
`si-gaps`; against `si-ui` and `si-parser` it conflicts only at the append point
and both blocks are kept whole; `node --check` passes; `harness-drift.mjs`
passes; the full audit passes; `walkmeter.mjs` passes with the stairs UI gate
still green and the unroutable count 11 → 10.

![the panel under the sibling lane's import row](../shots/si/privacy/6-with-the-import-bar.png)

**Two things the integrator should know**, neither of them a defect in any one
lane:

1. **All four lanes append a new top-level section at the same seam**, just above
   `function boot()`, so an N-way integration hits one conflict at one point. The
   resolution is concatenation, and there is a trap in it: git aligns
   coincidentally identical trailing lines (`return null;`, `}`, `};`) across two
   unrelated bodies, so a naive "keep both sides" **silently drops a function's
   closing brace** and leaves a file that still reads plausibly. It happened here
   twice. `node --check js/wayfind.js` catches it in a second; reading the diff
   does not.
2. **`acer/si-dayview` collides the same way and was left unresolved here.**
   Picking the right resolution belongs to whoever owns the integration, not to
   this lane guessing. Flagged, not fudged.

**Patches this lane could not make** (it owns storage functions only):

- **`style.css`** — the panel's rules are injected from JS as `#wf-priv-css`.
  They are one array of strings, `SCHEDULE_PRIVACY_CSS`, ready to lift into the
  stylesheet's `#wf-root` block verbatim. Nothing else has to change.
- **`scripts/verify/`** — `scripts/verify/r5-blob.mjs` (proposed) and
  `scripts/verify/si-privacy-claims.mjs` (proposed) are in §11 verbatim. Each
  exits 0/1 on its assertions, so either can go straight into a suite.
- **`scripts/verify/walkmeter.mjs`** — it prints, under its own list, *"SSW is
  not in UT's own register"*. That parenthetical carries round 3's wrong
  implication; the accurate wording is *"SSW is on main campus and is missing
  from our register snapshot"*, and `si-gaps` removing SSW from the list makes
  the clause moot anyway.
- **One copy overlap, and it is Simeon's call, not this lane's.** In the frame
  above the promise is made **twice**: `si-ui`'s row says *"Google, Apple or UT —
  read on this phone, never uploaded"* and the sentence below says *"never
  uploaded anywhere"*. Both true, neither wrong, but stacked they read like a
  page protesting. The cheap fix is for the import row's subtitle to drop its
  privacy clause and let the one sentence carry the promise once — which is the
  whole argument of §1. That subtitle is `si-ui`'s copy.

---

## 11. The audit scripts, verbatim

This lane may not write `scripts/verify/`. Both scripts are below in full; each
exits 0 on all-pass and 1 otherwise. The nine-door negative control from round 4
is unchanged and recoverable from `git show 83382d4:docs/si-privacy.md` rather
than carried here twice.

### 11a. `si-privacy-claims.mjs` — the gate on this document

```js
/**
 * claims-check.mjs — does docs/si-privacy.md cite anything that does not exist,
 * and does the promise it quotes still match the promise the app makes?
 *
 * WHY THIS EXISTS. Round 3's critic found this doc backing its central factual
 * claim with four citations to `docs/schedule-gaps.md` — a file that has never
 * existed on any branch. Nothing caught it because nothing was looking. A
 * fabricated citation is not a typo; it is a claim with no source presented as
 * a claim with one, and the only durable fix is a gate rather than a promise to
 * be more careful.
 *
 * Two checks, both cheap:
 *   1. EVERY relative path this doc cites resolves — either in this worktree,
 *      or, if the doc marks it `(on BRANCH)`, in that branch's tree. A citation
 *      that names its branch is honest; one that does not and does not exist is
 *      the defect.
 *   2. The privacy sentence the doc QUOTES is byte-identical to the one
 *      index.html serves and the one js/wayfind.js falls back to. A doc that
 *      quotes a promise the app no longer makes is the same defect wearing
 *      different clothes.
 *
 * Usage:  node claims-check.mjs <repo-root>
 * Exit 0 all checks passed, 1 a check failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.argv[2] || process.cwd();
const DOC = path.join(ROOT, 'docs', 'si-privacy.md');
const text = fs.readFileSync(DOC, 'utf8');

const fails = [];
const ok = (cond, label, extra) => {
  console.log((cond ? '  PASS  ' : '  *FAIL ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails.push(label);
  return cond;
};

console.log('\n── 1. every path this doc cites resolves ──');

// A CITATION IS PROSE, NOT CODE. Fenced blocks hold the audit scripts verbatim
// and their console output, and both are full of paths that are examples,
// placeholders or runtime strings — not this document citing a source. Strip
// them first, or the gate reports the sample paths in its own listing.
const prose = text.replace(/```[\s\S]*?\n```/g, '');

// Citations look like `docs/foo.md`, ../shots/si/privacy/x.png, js/wayfind.js,
// data/ut_buildings.json. Pull them out of backticks AND out of image links.
const cited = new Set();
for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
  const s = m[1].trim();
  if (/^(docs|js|data|scripts|shots)\/[\w./-]+$/.test(s)) cited.add(s);
}
for (const m of prose.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  cited.add(m[1].trim().replace(/^\.\.\//, ''));
}

// A citation may legitimately point at something that is not in THIS tree, but
// the doc has to SAY which, right next to the citation:
//   `docs/x.md` (on origin/acer/y)   — a sibling lane's file, checked in that tree
//   `scripts/verify/x.mjs` (proposed) — a file this lane may not write, not yet real
//   `docs/x.md` (does not exist)      — named because the doc is DISCUSSING a
//                                       phantom citation, not making one
// Anything else that does not resolve is the round-3 defect: a claim wearing a
// citation's clothes. The declaration has to sit next to the FIRST mention, so
// a later bare repeat inside the same discussion is fine but a bare citation
// somewhere else in the file is not.
// The window spans newlines because markdown wraps, and backticks around the
// branch name are optional — a rule nobody can satisfy is a rule that gets
// switched off.
const declOf = (p) => {
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const near = (tail) => new RegExp('`' + esc + '`[\\s\\S]{0,120}?' + tail);
  const br = text.match(near('\\(on `?(origin/[\\w./-]+)`?\\)'));
  if (br) return { kind: 'branch', branch: br[1] };
  if (near('\\(proposed\\)').test(text)) return { kind: 'proposed' };
  if (near('\\(does not\\s+exist\\)').test(text)) return { kind: 'phantom' };
  return null;
};

const inTree = (branch, p) => {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-tree', '--name-only', branch, p], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (e) { return false; }
};

const missing = [];
for (const p of Array.from(cited).sort()) {
  const here = fs.existsSync(path.join(ROOT, p));
  const d = declOf(p);
  if (here) { console.log('    ok   ' + p); continue; }
  if (d && d.kind === 'branch') {
    if (inTree(d.branch, p)) console.log('    ok   ' + p + '   (declared on ' + d.branch + ', and really there)');
    else missing.push(p + '  — declared on ' + d.branch + ' but NOT in that tree');
    continue;
  }
  if (d && d.kind === 'proposed') { console.log('    ok   ' + p + '   (declared proposed, not yet written)'); continue; }
  if (d && d.kind === 'phantom') { console.log('    ok   ' + p + '   (named as a phantom the doc is correcting)'); continue; }
  missing.push(p + '  — does not exist here, and the doc declares no branch and does not call it proposed');
}
ok(missing.length === 0, 'no citation points at a file that does not exist',
  missing.length ? '\n         ' + missing.join('\n         ') : cited.size + ' paths checked');

console.log('\n── 2. the sentence the doc quotes is the sentence the app makes ──');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'wayfind.js'), 'utf8');

const htmlLine = (html.match(/<span data-k="line">([^<]+)<\/span>/) || [])[1];
// SCHEDULE_PRIVACY_COPY.line is written as two concatenated string literals, so
// take everything between `line:` and the next key and glue the literals back.
const jsLine = (() => {
  const at = js.indexOf('const SCHEDULE_PRIVACY_COPY');
  if (at < 0) return null;
  const m = js.slice(at).match(/line:\s*([\s\S]*?),\s*\n\s*deleteBtn:/);
  if (!m) return null;
  return (m[1].match(/'([^']*)'/g) || []).map(s => s.slice(1, -1)).join('');
})();
// The doc quotes it as a blockquote in §1, wrapped across lines.
const quoted = (() => {
  const m = text.match(/>\s\*\*(Your schedule stays[\s\S]*?)\*\*/);
  return m ? m[1].replace(/\n>\s*/g, ' ').replace(/\s+/g, ' ').trim() : null;
})();

console.log('    index.html   : ' + JSON.stringify(htmlLine));
console.log('    wayfind.js   : ' + JSON.stringify(jsLine));
console.log('    si-privacy.md: ' + JSON.stringify(quoted));
ok(!!htmlLine && !!jsLine && htmlLine === jsLine, 'index.html and js/wayfind.js say the same sentence');
ok(!!quoted && quoted === htmlLine, 'the doc quotes that sentence exactly, not a paraphrase of it');

console.log('\n' + (fails.length === 0 ? '  ALL PASS' : '  ' + fails.length + ' FAILED:\n   - ' + fails.join('\n   - ')) + '\n');
process.exit(fails.length === 0 ? 0 : 1);
```

### 11b. `r5-blob.mjs` — the browser audit and the socket sink

```js
/**
 * r5-blob.mjs — round 5. The one thing round 4's critic proved was broken.
 *
 * Round 4 fired nine channels with STRING bodies and the guard closed all nine.
 * Then the critic did the thing nobody had done and fired a `Blob`, and the
 * canary landed on a raw socket verbatim while the guard's `blocked` counter
 * stayed at zero. `bodyToText()` returns `undefined` for a Blob, and
 * `undefined` was being treated as "nothing to see".
 *
 * It also found the audit's own instrument had the SAME blind spot:
 * Playwright's `request.postData()` returns null for a Blob body, so the round-4
 * script would have reported a clean "zero requests carried schedule content"
 * while the schedule was going out of the machine.
 *
 * So this script does not trust the browser automation to tell it what left.
 * It stands up a BARE TCP LISTENER and reads the literal bytes that arrive.
 * A socket cannot have a blind spot about its own input.
 *
 * Three things get proven, in this order:
 *   1. THE INSTRUMENT IS HONEST NOW. With the guard disarmed, a Blob probe
 *      reaches the socket, `postData()` is shown to MISS it (the round-4 bug,
 *      reproduced), and `postDataBuffer()` is shown to CATCH it.
 *   2. THE HOLE IS CLOSED. With the guard armed, every Blob probe is refused
 *      and the socket receives nothing.
 *   3. THE FIX COST NOTHING. A schedule is seeded BEFORE the app boots, so the
 *      guard is armed with a watchlist for the whole cold map load, and the
 *      count of opaque worker payloads is measured rather than assumed.
 *
 * Usage:
 *   python scripts/serve.py 8915
 *   cd scripts/verify && VERIFY_URL=http://127.0.0.1:8915 node r5-blob.mjs
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8915';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SINK_PORT = Number(process.env.SINK_PORT || 8916);
const SHOTS = process.env.R5_SHOTS || '.';

const fails = [];
const ok = (cond, label, extra) => {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '   ' + extra : ''));
  if (!cond) fails.push(label);
};

// ── the canary ───────────────────────────────────────────────────────────────
// Deliberately not borrowed from any other script in this lane: if one of these
// strings shows up on the socket it came from THIS run's stored schedule and
// nowhere else.
const CANARY_TITLE = 'Ferroelectric Hysteresis Seminar';
const CANARY_PROF = 'Okonkwo-Halvorsen';
const CANARY_ROOM = 'MAI 220';
const SCHEDULE = {
  v: 1,
  term: 'Fall 2026',
  tz: 'America/Chicago',
  sources: [{ id: 'google-ics', label: 'a Google Calendar export' }],
  classes: [
    { code: 'MAI', room: '220', title: CANARY_TITLE, instructor: CANARY_PROF,
      days: ['TU', 'TH'], start: '14:00', end: '15:30', src: 'google-ics' },
    { code: 'GDC', room: '2.216', title: 'Cryptographic Protocol Design', instructor: CANARY_PROF,
      days: ['MO', 'WE'], start: '09:00', end: '10:00', src: 'google-ics' },
  ],
};
// What must never appear on a socket. Whole field values, matching the guard's
// own >= 4 character rule.
const CANARIES = [CANARY_TITLE, CANARY_PROF, CANARY_ROOM, 'Cryptographic Protocol Design'];

// ── the bare TCP listener: ground truth about what actually left ─────────────
// Not an HTTP server from `http`, because a framework can normalise, buffer or
// drop a body and I would never know. This reads the socket.
const sinkBytes = [];
const sink = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    sinkBytes.push({ at: Date.now(), text: buf.toString('utf8') });
  });
  sock.on('error', () => {});
  // Answer so the browser does not sit in a retry loop. CORS-open so a fetch
  // resolves rather than rejecting for a reason unrelated to the guard.
  setTimeout(() => {
    try {
      sock.end('HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\n' +
        'Access-Control-Allow-Methods: POST, OPTIONS\r\n' +
        'Access-Control-Allow-Headers: content-type\r\nContent-Length: 0\r\n\r\n');
    } catch (e) {}
  }, 60);
});
await new Promise((res, rej) => {
  sink.once('error', rej);
  sink.listen(SINK_PORT, '127.0.0.1', res);
});
const SINK = `http://127.0.0.1:${SINK_PORT}`;
console.log(`\n  raw TCP sink listening on ${SINK}`);

/** Everything the socket has received since a mark, as one string. */
const sinkSince = (mark) => sinkBytes.filter(b => b.at >= mark).map(b => b.text).join('\n');
const canariesIn = (text) => CANARIES.filter(c => text.indexOf(c) !== -1);

// ── the browser ──────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--force_high_performance_gpu',
    '--enable-unsafe-swiftshader'],
});
let killed = false;
const reap = (code) => {
  if (killed) return; killed = true;
  try { sink.close(); } catch (e) {}
  try { browser.process()?.kill('SIGKILL'); } catch (e) {}
  try { browser.close(); } catch (e) {}
  if (code != null) process.exit(code);
};
const watchdog = setTimeout(() => { console.error('watchdog'); reap(124); }, 600000);
process.once('SIGINT', () => reap(130));
process.once('uncaughtException', e => { console.error(e); reap(1); });
process.once('unhandledRejection', e => { console.error(e); reap(1); });

// An EXPLICIT context, not `browser.newPage()`. §8 needs a second page that
// shares this one's storage but none of its init scripts, and the default
// context refuses `newPage()`.
const context = await browser.newContext({ viewport: { width: 1180, height: 800 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

// TWO CAPTURES, ON PURPOSE, so the difference between them is MEASURED rather
// than assumed. Round 4's critic asserted that `postData()` is blind to a Blob
// body and that the audit was therefore only ever proving string-shaped leaks.
// That is checkable, so it gets checked instead of believed — and the raw
// socket above settles the question either way, because it depends on no
// Playwright behaviour at all.
const seenByPostData = [];
const seenByBuffer = [];
page.on('request', (r) => {
  let body = null;
  try { body = r.postData(); } catch (e) { body = null; }
  seenByPostData.push({ url: r.url(), method: r.method(), body });
});
// Registered LATER, after the cold load — intercepting every tile of a city
// would slow the load into the watchdog for no gain, and the cost measurement
// in §1 wants an unmolested load anyway.
let routing = false;
const installBufferCapture = () => page.route('**/*', async (route) => {
  if (routing) {
    const req = route.request();
    let buf = null;
    try { buf = req.postDataBuffer(); } catch (e) { buf = null; }
    seenByBuffer.push({
      url: req.url(), method: req.method(),
      body: buf ? buf.toString('utf8') : null,
      bytes: buf ? buf.length : 0,
    });
  }
  try { await route.continue(); } catch (e) {}
});

// ── SEED THE SCHEDULE BEFORE THE APP BOOTS ──────────────────────────────────
// This is what makes §3's cost measurement real. If the schedule is saved after
// the map has loaded, the guard spent the whole cold load on its fast path with
// an empty watchlist and the "it costs nothing" claim is measured over the
// wrong window. Written straight into localStorage at document-start, so
// `scheduleLoad()` finds it during boot and every worker message of the cold
// load is inspected.
await page.addInitScript(([key, doc]) => {
  try { localStorage.setItem(key, JSON.stringify(doc)); } catch (e) {}
}, ['austin3d.schedule.v1', SCHEDULE]);

const URL_WALK = `${BASE}/index.html?walk=1&drift=0&intro=0`;
await page.goto(URL_WALK, { waitUntil: 'domcontentloaded', timeout: 150000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 150000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForFunction(() => {
  const v = document.getElementById('veil');
  return !v || getComputedStyle(v).opacity === '0' || v.classList.contains('lift');
}, null, { timeout: 150000 }).catch(() => console.log('    note: veil never reported lifted'));
await page.waitForTimeout(3000);

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  r5-blob — ' + BASE + '  (sink ' + SINK + ')');
console.log('════════════════════════════════════════════════════════════════');

// ── 0. the premise: is the subject actually there? ──────────────────────────
console.log('\n── 0. the schedule really is loaded and the guard really is armed ──');
const boot = await page.evaluate(() => {
  const s = window.WAYFIND && window.WAYFIND.store;
  return {
    hasStore: !!s,
    has: s ? s.has() : null,
    guard: s ? s.guard.state() : null,
    classes: s && s.load() ? s.load().classes.length : 0,
    mapLayer: !!(window.__map && window.__map.getLayer && window.__map.getLayer('buildings-3d')),
  };
});
ok(boot.hasStore, 'WAYFIND.store exists under ?walk=1');
ok(boot.has === true, 'the seeded schedule survived boot and loaded', boot.classes + ' classes');
ok(boot.guard && boot.guard.installed && boot.guard.armed, 'guard installed and armed');
ok(boot.guard && boot.guard.watched > 0, 'guard is watching the schedule strings', 'watched=' + (boot.guard && boot.guard.watched));
ok(boot.guard && boot.guard.policy && boot.guard.policy.blockUnreadableBodies === true,
  'policy: an unreadable body is refused, not counted and waved through');
ok(boot.mapLayer, 'the city itself loaded (buildings-3d present)');

// ── 1. the cold-load cost of the new rule, MEASURED ────────────────────────
console.log('\n── 1. what the new rule cost on a cold map load with a schedule stored ──');
const g0 = boot.guard;
console.log('    ' + JSON.stringify({
  checked: g0.checked, quietChecked: g0.quietChecked, blocked: g0.blocked,
  unreadableBodies: g0.unreadableBodies, opaqueWorkerLeaves: g0.opaqueWorkerLeaves,
}));
ok(g0.quietChecked > 0, 'the guard really did inspect worker traffic during the cold load',
  g0.quietChecked + ' worker messages');
ok(g0.blocked === 0, 'the new fail-closed rule blocked NOTHING the app itself does');
ok(g0.unreadableBodies === 0, 'no request this app makes has a body the guard cannot read');
ok(g0.opaqueWorkerLeaves === 0, 'no worker payload this app posts contains a Blob or a stream');
ok(g0.inspectFailures === 0, 'the inspector never threw');

// ── 2. the probes ───────────────────────────────────────────────────────────
// Each door twice: disarmed (does the channel carry, does the socket see it?)
// then armed (is it refused, and does the socket stay silent?).
const PROBE = `(async (name, sink, text, shape) => {
  const url = sink + '/__r5_' + shape + '_' + name;
  const mk = () => shape === 'blob'
    ? new Blob([text], { type: 'text/plain' })
    : text;
  switch (name) {
    case 'fetch':
      try { await fetch(url, { method: 'POST', body: mk() }); return 'sent'; }
      catch (e) { return 'threw: ' + String(e.message || e); }
    case 'xhr':
      try { const x = new XMLHttpRequest(); x.open('POST', url, true); x.send(mk()); return 'sent'; }
      catch (e) { return 'threw: ' + String(e.message || e); }
    case 'sendBeacon':
      try { return 'returned ' + navigator.sendBeacon(url, mk()); }
      catch (e) { return 'threw: ' + String(e.message || e); }
    case 'worker-postmessage':
      try {
        if (!self.__r5w) {
          const src = 'self.onmessage=function(){};';
          self.__r5w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        }
        self.__r5w.postMessage({ tile: 'x', payload: mk() });
        return 'posted';
      } catch (e) { return 'threw: ' + String(e.message || e); }
  }
  return 'unknown';
})`;

const isOurBlock = (s) => /\[wayfind\] blocked:/.test(String(s));
const isRefusal = (v) => isOurBlock(v) || v === 'returned false';
const NETWORK_DOORS = ['fetch', 'xhr', 'sendBeacon'];
const ALL_DOORS = [...NETWORK_DOORS, 'worker-postmessage'];

async function fireOnce(name, shape, armed) {
  await page.evaluate((arm) => {
    const g = window.WAYFIND.store.guard;
    if (arm) g.arm(); else g.__disarmForAudit();
  }, armed);
  const mark = Date.now();
  routing = true;
  const bufBefore = seenByBuffer.length;
  const pdBefore = seenByPostData.length;
  let res;
  try {
    res = await page.evaluate(([fn, n, s, t, sh]) =>
      // eslint-disable-next-line no-eval
      eval(fn)(n, s, t, sh), [PROBE, name, SINK, JSON.stringify(SCHEDULE), shape]);
  } catch (e) { res = 'threw: ' + String(e.message || e); }
  await page.waitForTimeout(1100);
  routing = false;
  return {
    res,
    hitSocket: canariesIn(sinkSince(mark)),
    byBuffer: seenByBuffer.slice(bufBefore),
    byPostData: seenByPostData.slice(pdBefore),
  };
}

await installBufferCapture();

console.log('\n── 2. BLOB probe, disarmed: does it carry, and can the instrument see it? ──');
const disarmedBlob = {};
for (const name of ALL_DOORS) {
  const r = await fireOnce(name, 'blob', false);
  disarmedBlob[name] = r;
  console.log('    ' + name.padEnd(20) + ' -> ' + String(r.res).slice(0, 58) +
    '   socket saw: ' + JSON.stringify(r.hitSocket));
}
for (const name of NETWORK_DOORS) {
  const r = disarmedBlob[name];
  ok(r.hitSocket.length > 0,
    name + ': DISARMED — a Blob body really does reach the wire, canary read off the raw socket',
    JSON.stringify(r.hitSocket));
}
ok(String(disarmedBlob['worker-postmessage'].res) === 'posted',
  'worker-postmessage: DISARMED — a Blob payload really is accepted by postMessage');

// THE ROUND-4 BUG IN THE INSTRUMENT: reproduced and REPORTED, not asserted.
// Whether `postData()` is blind is a fact about the Playwright build on this
// machine, and asserting a specific answer would make this script fail for a
// reason that has nothing to do with the app. What must hold either way is
// that the round-5 capture DOES see the bytes.
const pdSawCanary = disarmedBlob['fetch'].byPostData
  .some(r => r.body && canariesIn(r.body).length > 0);
const bufSawCanary = disarmedBlob['fetch'].byBuffer
  .some(r => r.body && canariesIn(r.body).length > 0);
console.log('    postData()       saw the Blob canary: ' + pdSawCanary +
  (pdSawCanary ? '' : "   <- round 4's blind spot, reproduced"));
console.log('    postDataBuffer() saw the Blob canary: ' + bufSawCanary);
ok(bufSawCanary === true,
  'the round-5 capture can read a Blob body — postDataBuffer() carries the canary',
  JSON.stringify(disarmedBlob['fetch'].byBuffer.filter(r => r.bytes).map(r => r.bytes)));
ok(disarmedBlob['fetch'].hitSocket.length > 0 && bufSawCanary,
  'socket and capture AGREE about the disarmed leak — neither instrument is blind');

console.log('\n── 3. BLOB probe, armed: is it refused, and does the socket stay silent? ──');
const armedBlob = {};
for (const name of ALL_DOORS) {
  const r = await fireOnce(name, 'blob', true);
  armedBlob[name] = r;
  console.log('    ' + name.padEnd(20) + ' -> ' + String(r.res).slice(0, 58) +
    '   socket saw: ' + JSON.stringify(r.hitSocket));
}
for (const name of ALL_DOORS) {
  const r = armedBlob[name];
  ok(isRefusal(r.res), name + ': ARMED — the guard refuses the Blob', String(r.res).slice(0, 72));
  ok(String(r.res) !== String(disarmedBlob[name].res),
    name + ': ARMED and DISARMED really behave differently',
    JSON.stringify(disarmedBlob[name].res).slice(0, 26) + ' vs ' + JSON.stringify(r.res).slice(0, 34));
}
for (const name of NETWORK_DOORS) {
  ok(armedBlob[name].hitSocket.length === 0,
    name + ': ARMED — NOTHING reached the socket', JSON.stringify(armedBlob[name].hitSocket));
}

// ── 4. a ReadableStream, the other unreadable shape ─────────────────────────
console.log('\n── 4. the other unreadable shape: a ReadableStream body ──');
const streamProbe = await page.evaluate(async ([sink, text]) => {
  window.WAYFIND.store.guard.arm();
  const body = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  });
  try {
    await fetch(sink + '/__r5_stream_fetch', { method: 'POST', body, duplex: 'half' });
    return 'sent';
  } catch (e) { return 'threw: ' + String(e.message || e); }
}, [SINK, JSON.stringify(SCHEDULE)]).catch(e => 'evaluate threw: ' + e.message);
await page.waitForTimeout(900);
console.log('    stream fetch -> ' + String(streamProbe).slice(0, 90));
ok(isOurBlock(streamProbe), 'a ReadableStream body is refused the same way a Blob is',
  String(streamProbe).slice(0, 72));

// ── 5. and a plain GET still works, because that is the whole app ──────────
console.log('\n── 5. the rule did not break ordinary traffic ──');
const getProbe = await page.evaluate(async (base) => {
  window.WAYFIND.store.guard.arm();
  try {
    const r = await fetch(base + '/js/wayfind.js', { cache: 'reload' });
    return 'ok ' + r.status;
  } catch (e) { return 'threw: ' + String(e.message || e); }
}, BASE);
ok(/^ok 200/.test(String(getProbe)), 'a bodyless GET is untouched with a schedule stored', String(getProbe));
const afterGuard = await page.evaluate(() => window.WAYFIND.store.guard.state());
ok(afterGuard.blockedOpaque > 0, 'the guard counted its opaque refusals',
  'blockedOpaque=' + afterGuard.blockedOpaque);
ok(afterGuard.inspectFailures === 0, 'still no inspector failures', JSON.stringify(afterGuard));

// ── 6. the socket's whole transcript, scanned once at the end ──────────────
console.log('\n── 6. everything the socket ever received, scanned as one blob ──');
const all = sinkBytes.map(b => b.text).join('\n');
console.log('    ' + sinkBytes.length + ' socket reads, ' + all.length + ' bytes total');
// The disarmed probes DELIBERATELY put the canary there, so the end-state
// assertion is about the armed window only — already asserted per-door above.
// This one records the total for the reader.
console.log('    canaries present in the full transcript (disarmed probes included): ' +
  JSON.stringify(canariesIn(all)));

// ── 7. screenshots of the panel, before and after the tap ─────────────────
console.log('\n── 7. the panel, and a real click on Delete ──');
routing = false;
await page.unroute('**/*').catch(() => {});
await page.click('#wf-button');
await page.waitForTimeout(1400);
const VIS = `(id) => { const e = document.getElementById(id); if (!e) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; }`;
const savedPanel = await page.evaluate((vis) => {
  const el = document.getElementById('wf-priv');
  return { text: el ? el.innerText : null, visible: eval(vis)('wf-priv'), del: eval(vis)('wf-priv-del') };
}, VIS);
ok(savedPanel.visible, 'the privacy panel has a real box on screen');
ok(savedPanel.del, 'the Delete button has a real box on screen');
const namesAClass = SCHEDULE.classes.some(c => (savedPanel.text || '').indexOf(c.title) !== -1);
ok(!namesAClass, 'the panel names no class — a count and a source only', JSON.stringify(savedPanel.text));
await page.screenshot({ path: path.join(SHOTS, 'r5-panel-saved.png'), clip: await clipOf(page, 'wf-priv') });
// And the same thing in the city, because a cropped panel is not what a
// student looks at. JPEG on purpose: this is a 1180x800 photograph of a 3D
// scene and a PNG of it is ~1 MB in a repo every lane gets a full copy of.
await page.screenshot({ path: path.join(SHOTS, 'r5-in-the-city.jpg'), type: 'jpeg', quality: 72 });

await page.click('#wf-priv-del');
await page.waitForTimeout(1200);
const afterTap = await page.evaluate(() => ({
  text: (document.getElementById('wf-priv') || {}).innerText,
  has: window.WAYFIND.store.has(),
  inv: window.WAYFIND.store.inventory(),
  guard: window.WAYFIND.store.guard.state(),
}));
ok(afterTap.has === false, 'store.has() false right after the tap');
ok(afterTap.inv.bytes === 0, 'inventory reports zero bytes stored');
ok(afterTap.guard.watched === 0, 'the guard dropped its copy of the schedule too');
await page.screenshot({ path: path.join(SHOTS, 'r5-panel-deleted.png'), clip: await clipOf(page, 'wf-priv') });

// ── 8. reload into a fresh document and look again ────────────────────────
console.log('\n── 8. reload, and look again from a fresh document ──');
// THE TRAP HERE, AND WHY THIS IS A NEW PAGE RATHER THAN A RELOAD. The schedule
// was seeded by a page-scoped `addInitScript`, so reloading THIS page would
// write it straight back and the "delete survived a reload" assertion would be
// testing the seeder instead of the delete — a green result that means nothing.
// A new page in the SAME context shares the origin and the storage but carries
// none of this page's init scripts, so it is a genuinely fresh document looking
// at the same disk.
const page2 = await context.newPage();
await page2.goto(URL_WALK, { waitUntil: 'domcontentloaded', timeout: 150000 });
await page2.waitForFunction(() => window.WAYFIND && window.WAYFIND.store, null, { timeout: 60000 })
  .catch(() => {});
await page2.waitForTimeout(2500);
const reloaded = await page2.evaluate(async () => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  let dbs = [];
  try { dbs = (await indexedDB.databases()).map(d => d.name); } catch (e) {}
  return {
    keys,
    raw: localStorage.getItem('austin3d.schedule.v1'),
    has: window.WAYFIND ? window.WAYFIND.store.has() : null,
    watched: window.WAYFIND ? window.WAYFIND.store.guard.state().watched : null,
    dbs,
    panel: (document.getElementById('wf-priv') || {}).innerText || null,
  };
});
ok(!reloaded.keys.some(k => k && k.indexOf('austin3d.schedule.') === 0),
  'RELOADED: no schedule key in storage', JSON.stringify(reloaded.keys));
ok(reloaded.raw === null, 'RELOADED: the schedule key reads null');
ok(reloaded.has === false, 'RELOADED: store.has() false');
ok(reloaded.watched === 0, 'RELOADED: guard watchlist empty');
ok(!reloaded.dbs.includes('austin3d-schedule'),
  'RELOADED: reserved IndexedDB database is not there', JSON.stringify(reloaded.dbs));
ok(/No schedule saved/i.test(reloaded.panel || ''),
  'RELOADED: the panel is back to its empty state', JSON.stringify(reloaded.panel));

ok(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 2).join(' | '));

async function clipOf(p, id) {
  const box = await p.evaluate((i) => {
    const e = document.getElementById(i);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 };
  }, id);
  return box || { x: 0, y: 0, width: 600, height: 300 };
}

console.log('\n════════════════════════════════════════════════════════════════');
console.log(fails.length ? '  ' + fails.length + ' FAIL' : '  ALL PASS');
for (const f of fails) console.log('    - ' + f);
console.log('════════════════════════════════════════════════════════════════\n');
clearTimeout(watchdog);
reap(fails.length ? 1 : 0);
```
