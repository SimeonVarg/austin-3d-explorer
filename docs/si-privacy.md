# A class schedule is personal data — the storage lane

`acer/si-privacy`, 2026-08-24. One lane of the schedule-import round. It owns
**storage, deletion and the sentence that tells a student the truth about
both** — `js/wayfind.js` §12 (a new section, nothing existing edited), the
privacy copy in `index.html`, and this file. Four sibling lanes own the three
importers and the import bar; nothing here needs them to exist, and everything
here has a seam for them (§6).

`WAYFIND.on` is untouched. The whole section is inside the `if (!ENABLED)
return` at `js/wayfind.js:1320`, so with the feature off it adds no element, no
listener, no wrapper and no storage — §5.G proves that by loading the page
without `?walk=1` and looking.

---

## 1. The promise, and the one sentence that makes it

> **Your schedule stays on this device — saved in this browser only, never
> uploaded anywhere, and Delete wipes it for good.**

Three clauses because there are exactly three things a student would want to
know, and each one is a claim this round can actually back:

| clause | what backs it |
|---|---|
| *saved in this browser only* | one `localStorage` key, `austin3d.schedule.v1` |
| *never uploaded anywhere* | §5.C — every request during a real import, scanned. Zero. |
| *Delete wipes it for good* | §5.E and §5.F — the real button, then a reload |

No "we may share with our partners", no "we take your privacy seriously", no
link to a policy. It says what happens, in the voice the rest of this feature
already uses (`We can't route inside buildings`, `Nobody was asked about
lighting along this route`). It is one sentence because a student reads one
sentence.

**Where to change the wording:** `index.html`, the `<template
id="wf-privacy-copy">` block above the `js/wayfind.js` script tag. It is a
one-line HTML edit (CLAUDE.md rule 11). `js/wayfind.js` carries the identical
strings as `SCHEDULE_PRIVACY_COPY`, because `_harness.html` has no template and
must say the same thing; §5.A asserts the two have not drifted apart, so
changing one and not the other turns the gate red on purpose rather than
quietly shipping two different promises.

The template is not a `<script src>`, so `harness-drift.mjs` is unaffected —
verified, it passes: `index.html: 31 scripts / _harness.html: 31 scripts`.

![the panel, in the city](../shots/si/privacy/1-saved-in-the-city.jpg)

---

## 2. What a student sees

Three states, in the footer of the walk sheet — the place this feature already
puts the things it has to say about itself.

| nothing stored | a schedule stored | just deleted | after a reload |
|---|---|---|---|
| ![](../shots/si/privacy/2-panel-empty.png) | ![](../shots/si/privacy/3-panel-saved.png) | ![](../shots/si/privacy/4-panel-deleted.png) | ![](../shots/si/privacy/5-panel-after-reload.png) |

- The sentence is there **before** anything is imported, not after. A student
  should know where their schedule is going before they paste it in.
- The Delete button only exists when there is something to delete.
- **One tap, no "are you sure".** The brief asked for one tap, and an undo
  would mean keeping the data around after telling someone it was gone. If that
  ever reads as too sharp, `SCHEDULE_STORE.deleteNeedsConfirm = true` is the
  one-line change.
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
later **without a rewrite**. Three reservations buy that, and each one is
something that would otherwise force every stored schedule to be migrated:

1. **`sources` is a LIST, and each class points at one.** A photo imported on
   top of an existing `.ics` has to *add* to a schedule, not replace it. A
   single `source` string on the envelope cannot express that, and discovering
   it later means a schema change.
2. **`confidence` and `provenance` on every class.** An `.ics` is exact — 1.0,
   and the `VEVENT` UID. OCR is not, and needs somewhere to record which box on
   the image it read a room number out of, so the student can be shown what to
   check. Bolting that on later rewrites the format.
3. **`v` plus a `SCHEDULE_MIGRATIONS` chain.** A v2 reader opens a v1 blob; a
   v1 reader hands back `{tooNew:true}` and leaves the data alone rather than
   deleting a schedule it does not understand.

`SCHEDULE_SOURCES` already names `image-ocr` and `registration-plus` alongside
the three being built. They are listed before they exist on purpose: it is the
forward compatibility, written down, and it means the delete sweep in §4
already covers what they will write.

**`unroutableWhy` is a string, not a boolean**, and that is because of
`docs/schedule-gaps.md`: eleven codes a real UT schedule can name cannot be
routed to at all. "Unknown code, probably a typo" and "real building, just not
on this map" want different sentences. Re-verified on this branch today, not
taken on trust — see §7.

---

## 4. Delete means gone

`WAYFIND.store.clear()` does four things, and the second is the one that
matters for a feature that is going to grow:

1. removes `austin3d.schedule.v1`;
2. **sweeps every key under the `austin3d.schedule.` prefix, in `localStorage`
   AND `sessionStorage`** — so a source added next month that writes its own
   key is already covered by a delete written today. `austin3d.gfx.v1`
   (`js/graphics.js`) does not match the prefix and is left alone; §5.E and
   §5.F both print the surviving key list to prove it;
3. deletes the IndexedDB database `austin3d-schedule`, **whether or not
   anything has created it**. A photo will not fit in `localStorage`, so the
   OCR pass will need IDB, and delete has to reach it on the day it starts
   existing. Deleting a database that was never created is a no-op;
4. drops the in-memory copy **and the egress guard's watchlist** — the guard
   must not end up holding the last copy of the thing it was guarding.

A `storage` event listener makes a delete in one tab a delete in every tab.

---

## 5. The audit — driving the real thing, not reading the code

Method, in full, so it can be re-run:

```
python scripts/serve.py 8915                     # never python -m http.server
node scripts/verify/harness-drift.mjs            # preflight, PASS
VERIFY_URL=http://127.0.0.1:8915 node schedule-privacy.mjs   # the script in §9
```

playwright-core from `scripts/verify/node_modules`, explicit `executablePath`
`C:/Program Files/Google/Chrome/Application/chrome.exe`, one browser, killed at
the end, port confirmed free after. `?walk=1&drift=0&intro=0`,
`window.cancelGraphicsAutoDetect()` at the top of every page, wait for the veil
to go. **34 assertions, five separate runs, all green.** Two of the five were
before the performance rewrite in §8 and three after, and they agree — which is
the point of running it more than once. `harness-drift.mjs` passes before each:
`index.html: 31 scripts / _harness.html: 31 scripts`.

### A. The feature is on and the panel is really mounted

Not "the element exists" — a **box on the screen**. The first attempt at this
script asserted `getComputedStyle(el).display !== 'none'`, which reports
`inline-flex` for an element inside a `display:none` ancestor, and it happily
claimed a button was visible that Playwright then could not click. Every
visibility assertion here is `getBoundingClientRect().width > 0 && height > 0
&& offsetParent`.

### B. A real Google Calendar export goes in

The import under test starts from **actual file bytes** — a `.ics` with
Google's own `PRODID`, `TZID` datetimes and `RRULE;BYDAY`, parsed into the
envelope. Four classes: `MAI 220` (CS 314), `WEL 2.122` (CH 301), and
deliberately `SSW 2.112` and `PX3 1.100`, the two shapes of unroutable building
from §7. The parser in the script is a stand-in — the real ones are sibling
lanes' — and it exists so that what gets stored has the shape a parser hands
over rather than being a hand-written object.

Then it does what a student does next: **routes `WEL → MAI`**, which fetches
the 328 KB walk graph. Real traffic inside the import window, which is the
point.

### C. Every request, scanned

Requests are captured two ways, because one of them has a documented blind
spot. `page.on('request')` for the page; and every `Worker` Playwright reports
gets its own `self.fetch`/`XHR` recorder installed by `evaluate`, because
`scripts/verify/README.md` records a page-scoped CDP session under-reporting a
load by 19 MB of MapLibre worker fetches.

```
captured 153 requests total, 13 from the import onward
hosts: {"127.0.0.1:8915": 5, "tiles.openfreemap.org": 8}
PASS  ZERO requests carried schedule content
```

**The app does talk to a third party** — `tiles.openfreemap.org` serves the
basemap, 8 requests in that window. That is worth saying out loud rather than
implying the page is airtight. What the audit establishes is that none of those
8, and none of the 5 local ones, carried a byte of the schedule.

What "schedule content" means here: every string leaf of the stored envelope
four characters or longer, plus the serialised blob, plus the `CODE ROOM`
composites — 26 strings for this schedule. A **bare three-letter building code
is deliberately not on that list**: `?from=WEL&to=MAI` is a documented URL
feature of this app and the codes are its public vocabulary. The scan is run at
both thresholds and reports the difference; on all three runs there was none.

### D. The negative control — because a zero from a blind instrument is also a zero

This is the assertion that makes §5.C mean anything.

```
PASS  with the guard disarmed the leak request actually went out
PASS  the capture SAW the leak request                    1 request(s)
PASS  the scanner FLAGGED the leak as schedule content    matched "fall 2026…"
PASS  with the guard armed the same request is refused
      [wayfind] blocked: fetch carried stored schedule content (20…(24)).
      The schedule never leaves this device.
PASS  and nothing carrying the schedule reached the wire
PASS  guard counted the block        blocked:1  inspectFailures:0
```

The guard is disarmed, one real `POST /__leak_probe` fires with the schedule as
its body, and the capture and the scanner both catch it. Then it is re-armed,
the identical request is fired again, and it is refused before it reaches the
wire. The instrument is proven to see a leak *and* the guard is proven to stop
one, in the same run, on the same request.

### E and F. Delete, then reload

A **real mouse click** on the real `#wf-priv-del`, then `page.goto` a fresh
document:

```
PASS  no schedule key left in local or session storage    ["austin3d.gfx.v1"]
PASS  store.has() false immediately after the tap
PASS  inventory reports zero bytes stored
PASS  the guard dropped its copy of the schedule too
PASS  the panel says it is deleted
PASS  RELOADED: no schedule key in storage                ["austin3d.gfx.v1"]
PASS  RELOADED: the schedule key reads null
PASS  RELOADED: store.load() returns nothing
PASS  RELOADED: reserved IndexedDB database is not there  []
PASS  RELOADED: the panel is back to its empty state
```

The one surviving key is the graphics preference this app already had.

### G. Off is still off

```
PASS  no WAYFIND.store without ?walk=1
PASS  no window.wayfindStore without ?walk=1
PASS  no privacy panel and no injected CSS with the feature off
PASS  window.fetch is NOT wrapped with the feature off
```

`main` is being screen-recorded. A privacy feature that installs a `fetch`
wrapper on every visitor to a page that does not have the feature turned on
would be a real regression.

### H. And the shipped feature still works

`node scripts/verify/walkmeter.mjs` passes on this branch, twice — before and
after the §8 rewrite — including its **live UI gate**, a real mouse click on
the "Avoid stairs" checkbox:

```
before             checked=false  "2-4 min walk · 240 m · Stairs: 1 set"
after one click    checked=true   "Under 1 min walk · 46 m · No stairs on this route"
after clicking back checked=false "2-4 min walk · 240 m · Stairs: 1 set"
PASS  the checkbox turns the routing on AND back off, and the pill still toggles
PASS  self-check drift 0 over limit, 0 route error(s), UI gate pass
```

That is the check for the thing this round is not allowed to break: another
lane's stairs-avoidance work, driven through the real interface, not reasoned
about.

---

## 6. The guard, and exactly what it is not

`installEgressGuard()` wraps the ways bytes leave a page and refuses any that
carries a watched string: **`fetch`, `XMLHttpRequest`, `navigator.sendBeacon`,
`WebSocket` (open and send), `EventSource`, `HTMLFormElement.submit` plus a
capture-phase `submit` listener, and `Worker.prototype.postMessage`.**

It is a **seatbelt, not the safety case.** The safety case is that no code here
sends anything. The guard exists so that if a later lane wires an analytics
call into this file, the call fails loudly instead of quietly working.

**`Worker.prototype.postMessage` is the interesting one.** The guard is
main-thread, and MapLibre fetches tiles inside workers where it cannot reach.
Rather than chase the bytes into the worker, it stops schedule bytes from ever
getting in. A worker cannot send what it was never told.

What it does **not** cover, said plainly:

- **`<img src>` and plain link navigation.** Those are covered by the
  browser-level capture in §5.C, which sees every request regardless of who
  made it — but not by the runtime guard.
- **A fragment of a field.** Whole field values are the tokens. A leak of
  `"Data"` out of `"Data Structures"` would not match. Whole values are what a
  serialiser emits; word fragments are what tile URLs are full of, and watching
  those would block the map.
- **Inspection failures fail OPEN** — the request proceeds — and are counted.
  Failing closed would let a bug in this file break the city. The audit asserts
  `inspectFailures === 0`, which is the right place to catch it; it has been 0
  on every run.

### The seam for the four sibling lanes

Nothing above needs an import bar. When one exists:

```js
WAYFIND.store.mount(el)            // put the sentence + Delete inside the bar
WAYFIND.store.save(parsedDoc)      // the only writer; normalises + stores
WAYFIND.store.load()               // null, the doc, or {tooNew:true}
WAYFIND.store.has() / .clear() / .clearAsync() / .inventory()
WAYFIND.store.onChange(fn)         // returns an unsubscribe
WAYFIND.store.guard.state() / .log()
```

`save()` runs everything through `normaliseSchedule()`, so a photo and an
`.ics` cannot drift into two shapes. Until a bar exists the panel mounts itself
into `#wf-sheet .wf-foot`.

### Patches this lane could not make (it owns storage functions only)

- **`style.css`** — the panel's rules are injected from JS as `#wf-priv-css`
  because this lane does not own `style.css`. They are one array of strings,
  `SCHEDULE_PRIVACY_CSS`, ready to lift into the stylesheet's `#wf-root` block
  verbatim. Nothing else has to change.
- **`scripts/verify/`** — the audit script belongs at
  `scripts/verify/schedule-privacy.mjs`; it is in §9 verbatim. It exits 0/1 on
  its assertions, so it can go straight into a suite.
- **The `OFF_MAP_BUILDINGS` table** proposed by `docs/schedule-gaps.md` §5
  belongs in whichever lane owns the import module, not in storage. `save()`
  stores whatever `unroutableWhy` it is handed and does not invent one.

---

## 7. The eleven unroutable codes, re-derived on this branch

The brief said to re-verify rather than trust. Three independent checks, all
run today on this commit:

1. **`walkmeter.mjs`, live, on this branch:** `UT buildings this build cannot
   route to at all (11): BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB`. The list
   is current.
2. **"Off this map", computed from `data/ground.geojson` and the coordinate
   tables in `js/wayfind.js`** — not from the walk graph the walkmeter reads.
   The rendered city's own footprint is `lat 30.231157 … 30.321774`.

   | code | lon | lat | km from campus centre | inside the rendered bbox |
   |---|---|---|---|---|
   | SV1 | -97.72573 | 30.38245 | 10.78 | no |
   | MER | -97.72828 | 30.38529 | 11.07 | no |
   | FS1 | -97.73200 | 30.38688 | 11.22 | no |
   | FSL | -97.73155 | 30.38737 | 11.28 | no |
   | PX3 | -97.72973 | 30.38732 | 11.28 | no |
   | TCB | -97.72705 | 30.38722 | 11.29 | no |
   | EME | -97.72733 | 30.38959 | 11.55 | no |
   | ROC | -97.72567 | 30.39053 | 11.68 | no |
   | BEG | -97.72535 | 30.39102 | 11.73 | no |
   | BE1 | -97.72699 | 30.39182 | 11.80 | no |
   | **SSW** | **-97.73296** | **30.28048** | **0.89** | **yes** |

   Ten cluster at 10.8–11.8 km north, outside everything this map draws. **SSW
   is not one of them** — it is 0.89 km away, inside the rendered footprint.
   Treating it as "the eleventh Pickle building", which the brief's phrasing
   invites, would be wrong.
3. **UT's own register, `data/ut_buildings.json` (198 codes, retrieved
   2026-08-05):** none of the eleven appear, while `MAI WEL GDC WWH SSB` all
   do — the sanity check that proves the lookup works rather than returning
   empty for everything.

So the brief's two claims hold, with one correction to how they are stated: the
"~11 km north" reason covers **ten**, not eleven, and SSW is absent from the
register for a different reason. `docs/schedule-gaps.md` §2 establishes what
that reason is (demolished September 2024; the school moved to Walter Webb
Hall, which this app already routes to) from live sources; this lane confirmed
the *geometry and the register absence* from local data and did not re-fetch
`utdirect` itself.

---

## 8. What the guard costs, and the two measurements that were wrong first

The guard sits on `Worker.prototype.postMessage`, which is MapLibre's per-tile
path. "It's bounded" is a claim about code, so it was measured — and the first
two attempts were both bad instruments, which is worth recording.

**Wrong measurement #1: whole-map load time, with and without a stored
schedule.** After the first rep every tile was in the HTTP cache, so the later
reps did *zero* guard checks and the guarded condition came out **27% faster**.
That is not a result; it is a cache being mistaken for one.

**Wrong measurement #2: absolute microseconds across runs.** The unguarded
baseline for the identical benchmark moved from 7.4 µs to 68 µs depending on
what the other lanes were doing — the machine sat at 82% CPU with 35 Chrome
processes at one point. Only conditions interleaved inside a single run are
comparable.

So: 4,000 MapLibre-shaped `loadTile` messages through a do-nothing worker, the
two conditions interleaved, **minimum of 8 reps**, machine at ~41% at the end.

| | first version | after the fix |
|---|---|---|
| guard cost per main→worker message | **42.6 µs** | **3.8 µs** |
| 1 MB `Float32Array` payload | no measurable cost | no measurable cost (buffers are skipped, not walked) |

Two things were wrong in the first version:

1. **It wrote a log line per message.** A `performance.now()`, an object, and a
   `shift()` off a full ring buffer — per tile. The log exists to audit egress
   to the *network*, where there are tens of requests and every line is worth
   having. Worker messages are now counted (`quietChecked`) and only logged
   when they actually match, which is the only worker message anyone would read.
2. **It concatenated every string in a message into one haystack, then scanned
   it** — and scanned with a compiled alternation regex, which was the second
   mistake dressed as an optimisation. An alternation retries every branch at
   every start position: ~22 branches over a 60-character tile URL is over a
   thousand attempted matches to conclude "no". It now tests each string leaf
   directly with `indexOf` (one vectorised substring search per token, the
   operation V8 has actually optimised), behind two cheap gates: a haystack
   shorter than the shortest token is rejected outright, and the haystack is
   lowercased once per scan instead of once per token. No concatenation, no
   per-message allocation. Testing leaf by leaf finds exactly the same leaks,
   because every watched token is a whole field value and therefore lives
   inside one leaf if it is there at all.

**In real terms:** a cold load of the city with a schedule stored puts 992
messages through the guard; a cold load plus four camera poses across campus
plus a route puts 5,077 through. At 3.8 µs that is **about 19 ms of guard work
across an entire heavy session** — and only when a schedule is stored at all.
With nothing stored the guard is one `if` and returns.

---

## 9. The audit script, verbatim

This lane may not write `scripts/verify/`. Drop this in as
`scripts/verify/schedule-privacy.mjs` — it exits 0 on pass, 1 on a failed
assertion, and needs only `VERIFY_URL`. This is the exact file that produced
every number in §5, not a paraphrase of it.

```js
/**
 * schedule-privacy.mjs — does a student's class schedule actually stay on the
 * device, and does Delete actually delete it?
 *
 * Two questions, and neither is answerable by reading js/wayfind.js:
 *
 *   1. During a real import, does ANY request leave this page carrying
 *      schedule content? Answered by recording every request the page and its
 *      workers make across the import window and scanning each one's URL and
 *      body for the schedule's own strings.
 *   2. Does the Delete control empty storage? Answered by clicking the real
 *      button with a real mouse, reloading the page, and reading storage from
 *      the fresh document.
 *
 * THE PART THAT MAKES ANSWER 1 MEAN ANYTHING. "Zero requests carried the
 * schedule" is what a blind instrument says too. So the run includes a
 * NEGATIVE CONTROL: it disarms the in-page guard, fires one real POST whose
 * body is the schedule, and asserts the capture SAW it and that the scanner
 * FLAGGED it. Then it re-arms and fires the identical request again and
 * asserts the guard blocked it and nothing reached the wire. A zero is only
 * worth reporting next to a one.
 *
 * Usage (repo root, own port, own browser):
 *   python scripts/serve.py 8915
 *   VERIFY_URL=http://127.0.0.1:8915 node schedule-privacy.mjs [--shots DIR]
 *
 * Exit 0 all assertions passed, 1 an assertion failed, 2 could not run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8915';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = (() => {
  const i = process.argv.indexOf('--shots');
  return i > 0 ? process.argv[i + 1] : path.join(process.cwd(), 'shots-out');
})();
fs.mkdirSync(SHOTS, { recursive: true });

const fails = [];
const notes = [];
const ok = (cond, label, extra) => {
  console.log((cond ? '  PASS  ' : '  *FAIL ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails.push(label);
  return cond;
};

// ── the schedule, as a real Google Calendar export ────────────────────────────
// Real shape (Google's own PRODID, TZID form, RRULE BYDAY, LOCATION as a free
// string with no structured building field — docs/import-bar-apple.md §the
// finding). Two of the classes are deliberately in buildings this map cannot
// route to: SSW (demolished 2024) and PX3 (Pickle campus, 11 km north), per
// docs/schedule-gaps.md.
const ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/Chicago:20260826T140000',
  'DTEND;TZID=America/Chicago:20260826T153000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
  'SUMMARY:CS 314 Data Structures',
  'LOCATION:MAI 220',
  'UID:4b1f9c0a-utexas-cs314@google.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/Chicago:20260824T100000',
  'DTEND;TZID=America/Chicago:20260824T110000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'SUMMARY:CH 301 Principles of Chemistry',
  'LOCATION:WEL 2.122',
  'UID:9d33ae71-utexas-ch301@google.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/Chicago:20260825T163000',
  'DTEND;TZID=America/Chicago:20260825T180000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
  'SUMMARY:SW 310 Introduction to Social Work',
  'LOCATION:SSW 2.112',
  'UID:1a7c55be-utexas-sw310@google.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/Chicago:20260828T090000',
  'DTEND;TZID=America/Chicago:20260828T120000',
  'RRULE:FREQ=WEEKLY;BYDAY=FR',
  'SUMMARY:ASE 379 Rocket Propulsion Lab',
  'LOCATION:PX3 1.100',
  'UID:c0e2d418-utexas-ase379@google.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

/**
 * A DELIBERATELY MINIMAL ICS -> schedule mapping. The real parser is a sibling
 * lane's; this exists so the import under test starts from actual file bytes
 * rather than from a hand-written object, and so the thing being stored has
 * the shape a parser will hand over.
 */
function parseIcs(text) {
  const classes = [];
  const days = { MO: 'Mo', TU: 'Tu', WE: 'We', TH: 'Th', FR: 'Fr', SA: 'Sa', SU: 'Su' };
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const g = (re) => { const m = block.match(re); return m ? m[1].trim() : null; };
    const loc = g(/^LOCATION:(.*)$/m) || '';
    const bits = loc.split(/\s+/);
    const start = g(/^DTSTART[^:]*:(\d{8})T(\d{4})/m) ? block.match(/^DTSTART[^:]*:\d{8}T(\d{2})(\d{2})/m) : null;
    const end = block.match(/^DTEND[^:]*:\d{8}T(\d{2})(\d{2})/m);
    const by = g(/BYDAY=([A-Z,]+)/);
    classes.push({
      id: g(/^UID:(.*)$/m),
      code: bits[0] || null,
      room: bits.slice(1).join(' ') || null,
      title: g(/^SUMMARY:(.*)$/m),
      days: by ? by.split(',').map(d => days[d] || d) : [],
      startMin: start ? Number(start[1]) * 60 + Number(start[2]) : null,
      endMin: end ? Number(end[1]) * 60 + Number(end[2]) : null,
      confidence: 1,
      provenance: { kind: 'ics-uid', ref: g(/^UID:(.*)$/m) },
    });
  }
  return {
    term: 'Fall 2026', tz: 'America/Chicago',
    sources: [{ id: 'g1', kind: 'google-ics', label: 'a Google Calendar export' }],
    classes: classes.map(c => Object.assign(c, { src: 'g1' })),
  };
}

const DOC = parseIcs(ICS);

/** The guard's own rule: whole string leaves of 4+ chars, plus the blob. */
function tokensOf(doc, minLen) {
  const out = new Set();
  const add = (s) => {
    if (typeof s !== 'string') return;
    const t = s.trim().toLowerCase();
    if (t.length >= minLen) out.add(t);
  };
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'string') return add(v);
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === 'object') return Object.keys(v).forEach(k => walk(v[k]));
  };
  walk(doc);
  for (const c of doc.classes) if (c.code && c.room) { add(c.code + ' ' + c.room); add(c.code + '-' + c.room); }
  add(JSON.stringify(doc));
  return Array.from(out);
}
const PRIVATE = tokensOf(DOC, 4);            // the guard's watchlist rule
const STRICT = tokensOf(DOC, 3);             // adds the bare building CODEs

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
  try { browser.process()?.kill('SIGKILL'); } catch (e) {}
  try { browser.close(); } catch (e) {}
  if (code != null) process.exit(code);
};
const watchdog = setTimeout(() => { console.error('watchdog'); reap(124); }, 420000);
process.once('SIGINT', () => reap(130));
process.once('uncaughtException', e => { console.error(e); reap(1); });
process.once('unhandledRejection', e => { console.error(e); reap(1); });

const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// EVERY request the page makes, tagged with the phase it happened in.
let phase = 'boot';
const wire = [];
page.on('request', r => {
  let body = null;
  try { body = r.postData(); } catch (e) { body = '[unreadable]'; }
  wire.push({ phase, where: 'page', method: r.method(), url: r.url(), body });
});
// AND the workers. A page-scoped listener cannot see a MapLibre worker's own
// fetches (scripts/verify/README, the 19 MB under-report), so each worker gets
// its own recorder installed the moment Playwright reports it.
const workerFetches = [];
page.on('worker', async (w) => {
  try {
    await w.evaluate(() => {
      if (self.__wfRec) return;
      self.__wfRec = [];
      const orig = self.fetch;
      self.fetch = function (i, init) {
        try {
          self.__wfRec.push({
            url: (i && i.url) || String(i),
            method: (init && init.method) || 'GET',
            body: init && typeof init.body === 'string' ? init.body : null,
          });
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      const op = self.XMLHttpRequest && self.XMLHttpRequest.prototype.open;
      if (op) {
        self.XMLHttpRequest.prototype.open = function (m, u) {
          try { self.__wfRec.push({ url: String(u), method: String(m), body: null }); } catch (e) {}
          return op.apply(this, arguments);
        };
      }
    });
    workerFetches.push({ url: w.url(), worker: w });
  } catch (e) { /* worker died before we attached */ }
});

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  schedule-privacy — ' + BASE);
console.log('  ' + DOC.classes.length + ' classes, ' + PRIVATE.length + ' watched strings');
console.log('════════════════════════════════════════════════════════════════\n');

const URL_WALK = `${BASE}/index.html?walk=1&drift=0&intro=0`;

async function settle() {
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 150000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  // The veil: app.js REMOVES it after its transition, so "gone" is the state.
  await page.waitForFunction(() => {
    const v = document.getElementById('veil');
    return !v || getComputedStyle(v).opacity === '0' || v.classList.contains('lift');
  }, null, { timeout: 150000 }).catch(() => notes.push('veil never reported lifted'));
  await page.waitForTimeout(2500);
}

await page.goto(URL_WALK, { waitUntil: 'domcontentloaded', timeout: 150000 });
await settle();

console.log('── A. the feature is really on, and the panel is really mounted ──');
const boot = await page.evaluate(() => ({
  hasStore: !!(window.WAYFIND && window.WAYFIND.store),
  guard: window.WAYFIND && window.WAYFIND.store && window.WAYFIND.store.guard.state(),
  key: window.WAYFIND && window.WAYFIND.store && window.WAYFIND.store.KEY,
  panel: !!document.getElementById('wf-priv'),
  btn: !!document.getElementById('wf-button'),
}));
ok(boot.hasStore, 'WAYFIND.store exists under ?walk=1');
ok(boot.guard && boot.guard.installed, 'egress guard installed at boot');
ok(boot.panel, 'privacy panel mounted into the walk sheet');
console.log('    key=' + boot.key + '  guard=' + JSON.stringify(boot.guard));

// The copy in index.html and the defaults in js/wayfind.js must not fork.
const copyCheck = await page.evaluate(() => {
  const s = window.WAYFIND.store;
  const live = s.copy(), def = s.defaultCopy;
  const diff = Object.keys(def).filter(k => live[k] !== def[k]);
  return { live, diff };
});
ok(copyCheck.diff.length === 0, 'index.html copy == js/wayfind.js defaults (no drift)',
  copyCheck.diff.length ? 'differs: ' + copyCheck.diff.join(',') : '');
console.log('    line: ' + JSON.stringify(copyCheck.live.line));

// Open the sheet with a real click so the panel is where a student sees it.
await page.click('#wf-button');
await page.waitForTimeout(1800);
// REALLY visible: a box on the screen, not merely a computed display. An
// element inside a `display:none` ancestor still reports its own display, and
// that is exactly the check that let the first run of this script claim a
// button was there while Playwright could not click it.
const VIS = `(id) => { const e = document.getElementById(id); if (!e) return false;
  const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !!e.offsetParent; }`;
const emptyText = await page.evaluate((vis) => {
  const p = document.getElementById('wf-priv');
  // eslint-disable-next-line no-eval
  const visible = eval(vis);
  return p ? { text: p.innerText.replace(/\s+/g, ' ').trim(), delVisible: visible('wf-priv-del'), panelVisible: visible('wf-priv') } : null;
}, VIS);
ok(!!emptyText && emptyText.panelVisible, 'the privacy sentence is really on screen (a box, not a computed style)');
ok(!!emptyText && /No schedule saved/i.test(emptyText.text), 'empty state says nothing is stored');
ok(emptyText && emptyText.delVisible === false, 'no Delete button when there is nothing to delete');
await page.screenshot({ path: path.join(SHOTS, '1-empty-full.png') });
await page.locator('#wf-sheet').screenshot({ path: path.join(SHOTS, '1-empty.png') }).catch(() => {});

// ── B. the import ────────────────────────────────────────────────────────────
console.log('\n── B. import a real Google Calendar export, watch the wire ──');
phase = 'import';
const wireBefore = wire.length;
const saved = await page.evaluate((doc) => window.WAYFIND.store.save(doc), DOC);
ok(saved && saved.ok, 'save() accepted the parsed schedule', JSON.stringify(saved));
await page.waitForTimeout(600);

const savedState = await page.evaluate((vis) => {
  const p = document.getElementById('wf-priv');
  // eslint-disable-next-line no-eval
  const visible = eval(vis);
  return {
    text: p ? p.innerText.replace(/\s+/g, ' ').trim() : null,
    delVisible: visible('wf-priv-del'),
    stored: (localStorage.getItem(window.WAYFIND.store.KEY) || '').length,
    has: window.WAYFIND.store.has(),
    guard: window.WAYFIND.store.guard.state(),
  };
}, VIS);
ok(savedState.stored > 0, 'schedule is in localStorage', savedState.stored + ' bytes');
ok(savedState.has === true, 'store.has() true after import');
ok(savedState.delVisible, 'Delete button is visible once there is something to delete');
ok(/on this device only/i.test(savedState.text || ''), 'panel says it is on this device only');
console.log('    panel: ' + savedState.text);
console.log('    guard: ' + JSON.stringify(savedState.guard));
await page.screenshot({ path: path.join(SHOTS, '2-saved-full.png') });
await page.locator('#wf-sheet').screenshot({ path: path.join(SHOTS, '2-saved.png') }).catch(e => notes.push('2-saved crop: ' + e.message));

// Now do what a student does next: route between two of the classes. Routing
// FETCHES the walk graph — real traffic inside the import window, exactly what
// should be captured and exactly what must not carry the schedule. It also
// CLOSES the sheet, which is why the panel shot is taken above and not here.
const routed = await page.evaluate(async () => {
  const r = await window.wayfindRoute('WEL', 'MAI');
  return { ok: !!(r && r.ok), why: r && r.why };
});
console.log('    routed WEL->MAI during the import window: ' + JSON.stringify(routed));
await page.waitForTimeout(4000);
phase = 'post-import';

// Pull the workers' own logs.
for (const w of workerFetches) {
  try {
    const rec = await w.worker.evaluate(() => self.__wfRec || []);
    for (const r of rec) wire.push({ phase: 'worker', where: 'worker:' + w.url.split('/').pop(), method: r.method, url: r.url, body: r.body });
  } catch (e) { notes.push('worker log unreadable: ' + w.url); }
}

// ── C. the scan ──────────────────────────────────────────────────────────────
console.log('\n── C. every request captured, scanned for schedule content ──');
function scan(list, toks) {
  const hits = [];
  for (const r of list) {
    const hay = ((r.url || '') + ' ' + (r.body || '')).toLowerCase();
    for (const t of toks) if (hay.indexOf(t) !== -1) { hits.push({ r, t }); break; }
  }
  return hits;
}
const importWindow = wire.filter(r => r.phase !== 'boot');
console.log('    captured ' + wire.length + ' requests total, ' + importWindow.length + ' from the import onward');
const byHost = {};
for (const r of importWindow) { const h = (() => { try { return new URL(r.url).host; } catch (e) { return r.url.slice(0, 24); } })(); byHost[h] = (byHost[h] || 0) + 1; }
console.log('    hosts: ' + JSON.stringify(byHost));
const privHits = scan(importWindow, PRIVATE);
const strictHits = scan(importWindow, STRICT);
ok(privHits.length === 0, 'ZERO requests carried schedule content',
  privHits.length ? privHits.slice(0, 3).map(h => h.r.method + ' ' + h.r.url.slice(0, 80)).join(' | ') : '');
if (strictHits.length !== privHits.length) {
  console.log('    note: ' + (strictHits.length - privHits.length) + ' request(s) matched only a bare 3-letter');
  console.log('    building code, which is this app\'s public vocabulary (?from=WEL&to=MAI):');
  for (const h of strictHits.slice(0, 4)) console.log('      ' + h.t + '  <-  ' + h.r.url.slice(0, 100));
}

// ── D. the negative control: prove the instrument is not blind ───────────────
console.log('\n── D. negative control — fire a real leak, watch it get caught ──');
phase = 'leak-disarmed';
const before = wire.length;
const disarmed = await page.evaluate(async () => {
  window.WAYFIND.store.guard.__disarmForAudit();
  const doc = window.WAYFIND.store.load();
  try {
    await fetch('/__leak_probe', { method: 'POST', body: JSON.stringify(doc) });
    return { sent: true };
  } catch (e) { return { sent: false, err: String(e.message || e) }; }
});
await page.waitForTimeout(1200);
const leaked = wire.slice(before);
const leakHits = scan(leaked, PRIVATE);
ok(disarmed.sent === true, 'with the guard disarmed the leak request actually went out');
ok(leaked.length >= 1, 'the capture SAW the leak request', leaked.length + ' request(s)');
ok(leakHits.length >= 1, 'the scanner FLAGGED the leak as schedule content',
  leakHits.length ? 'matched ' + JSON.stringify(leakHits[0].t.slice(0, 24) + '…') : 'MISSED IT — the zero above is worthless');

phase = 'leak-armed';
const before2 = wire.length;
const rearmed = await page.evaluate(async () => {
  window.WAYFIND.store.guard.arm();
  const doc = window.WAYFIND.store.load();
  try {
    await fetch('/__leak_probe', { method: 'POST', body: JSON.stringify(doc) });
    return { sent: true };
  } catch (e) { return { sent: false, err: String(e.message || e) }; }
});
await page.waitForTimeout(1200);
const blockedWire = wire.slice(before2);
ok(rearmed.sent === false, 'with the guard armed the same request is refused', rearmed.err || '');
ok(scan(blockedWire, PRIVATE).length === 0, 'and nothing carrying the schedule reached the wire');
const gs = await page.evaluate(() => window.WAYFIND.store.guard.state());
ok(gs.blocked >= 1, 'guard counted the block', JSON.stringify(gs));
ok(gs.inspectFailures === 0, 'guard inspected every request without erroring');

// ── E. delete, for real, with a real click ──────────────────────────────────
console.log('\n── E. one tap on the real Delete button ──');
phase = 'delete';
// Routing closed the sheet, so open it the way a student would before the tap.
const sheetShut = await page.evaluate(() => {
  const s = document.getElementById('wf-sheet');
  return !!(s && s.classList.contains('hidden'));
});
if (sheetShut) { await page.click('#wf-button'); await page.waitForTimeout(1200); }
ok(await page.evaluate((vis) => eval(vis)('wf-priv-del'), VIS),
  'the Delete button has a real box on screen before the click');
await page.click('#wf-priv-del');
await page.waitForTimeout(1200);
const afterDel = await page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  for (let i = 0; i < sessionStorage.length; i++) keys.push('session:' + sessionStorage.key(i));
  return {
    text: (document.getElementById('wf-priv') || {}).innerText,
    keys,
    scheduleKeys: keys.filter(k => k && k.indexOf('austin3d.schedule.') !== -1),
    has: window.WAYFIND.store.has(),
    inv: window.WAYFIND.store.inventory(),
    guardWatch: window.WAYFIND.store.guard.state().watched,
  };
});
ok(afterDel.scheduleKeys.length === 0, 'no schedule key left in local or session storage',
  JSON.stringify(afterDel.keys));
ok(afterDel.has === false, 'store.has() false immediately after the tap');
ok(afterDel.inv.bytes === 0, 'inventory reports zero bytes stored');
ok(afterDel.guardWatch === 0, 'the guard dropped its copy of the schedule too');
ok(/Deleted/i.test(String(afterDel.text || '')), 'the panel says it is deleted');
console.log('    remaining localStorage keys: ' + JSON.stringify(afterDel.keys));
await page.screenshot({ path: path.join(SHOTS, '3-deleted-full.png') });
await page.locator('#wf-sheet').screenshot({ path: path.join(SHOTS, '3-deleted.png') }).catch(() => {});

// ── F. and it is still gone after a reload ──────────────────────────────────
console.log('\n── F. reload, and look again from a fresh document ──');
phase = 'reload';
await page.goto(URL_WALK, { waitUntil: 'domcontentloaded', timeout: 150000 });
await settle();
await page.click('#wf-button');
await page.waitForTimeout(1800);
const afterReload = await page.evaluate(async () => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  let dbs = [];
  try { dbs = (await indexedDB.databases()).map(d => d.name); } catch (e) { dbs = ['<unlistable>']; }
  return {
    keys,
    scheduleKeys: keys.filter(k => k && k.indexOf('austin3d.schedule.') !== -1),
    raw: localStorage.getItem('austin3d.schedule.v1'),
    has: window.WAYFIND.store.has(),
    load: window.WAYFIND.store.load(),
    watched: window.WAYFIND.store.guard.state().watched,
    dbs,
    text: (document.getElementById('wf-priv') || {}).innerText,
  };
});
ok(afterReload.scheduleKeys.length === 0, 'RELOADED: no schedule key in storage', JSON.stringify(afterReload.keys));
ok(afterReload.raw === null, 'RELOADED: the schedule key reads null');
ok(afterReload.has === false, 'RELOADED: store.has() false');
ok(afterReload.load === null, 'RELOADED: store.load() returns nothing');
ok(afterReload.watched === 0, 'RELOADED: guard watchlist empty');
ok(!afterReload.dbs.includes('austin3d-schedule'), 'RELOADED: reserved IndexedDB database is not there',
  JSON.stringify(afterReload.dbs));
ok(/No schedule saved/i.test(String(afterReload.text || '')), 'RELOADED: the panel is back to its empty state');
await page.screenshot({ path: path.join(SHOTS, '4-reload-full.png') });
await page.locator('#wf-sheet').screenshot({ path: path.join(SHOTS, '4-reload.png') }).catch(() => {});

// ── G. OFF still means off ──────────────────────────────────────────────────
// The whole module returns on line one without ?walk=1, and this section is
// inside that return. `main` is being screen-recorded; a privacy feature that
// installs a fetch wrapper on every visitor of a page that does not have the
// feature turned on would be a real regression, not a small one.
console.log('\n── G. with the feature off, none of this exists ──');
phase = 'off';
const offPage = await browser.newPage({ viewport: { width: 900, height: 600 } });
await offPage.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'domcontentloaded', timeout: 150000 });
await offPage.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 150000 });
await offPage.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await offPage.waitForTimeout(2500);
const off = await offPage.evaluate(() => ({
  store: !!(window.WAYFIND && window.WAYFIND.store),
  globalStore: typeof window.wayfindStore,
  panel: !!document.getElementById('wf-priv'),
  css: !!document.getElementById('wf-priv-css'),
  fetchPatched: /schedWatch|blocked:/.test(String(window.fetch)),
}));
ok(off.store === false, 'no WAYFIND.store without ?walk=1');
ok(off.globalStore === 'undefined', 'no window.wayfindStore without ?walk=1');
ok(off.panel === false && off.css === false, 'no privacy panel and no injected CSS with the feature off');
ok(off.fetchPatched === false, 'window.fetch is NOT wrapped with the feature off');
await offPage.close();

// ── H. nothing broke ────────────────────────────────────────────────────────
console.log('\n── H. the app itself ──');
const mapOk = await page.evaluate(() => !!(window.__map && window.__map.isStyleLoaded() && window.__map.getLayer('buildings-3d')));
ok(mapOk, 'the city still loads and buildings-3d is still there');
const realErrors = pageErrors.filter(e => !/__leak_probe|blocked: fetch/i.test(e));
ok(realErrors.length === 0, 'no page errors', realErrors.slice(0, 2).join(' | '));

console.log('\n════════════════════════════════════════════════════════════════');
for (const n of notes) console.log('  note: ' + n);
console.log(fails.length === 0 ? '  ALL PASS (' + SHOTS + ')' : '  ' + fails.length + ' FAILED:\n   - ' + fails.join('\n   - '));
console.log('════════════════════════════════════════════════════════════════\n');

fs.writeFileSync(path.join(SHOTS, 'wire.json'), JSON.stringify({
  totals: { captured: wire.length, importWindow: importWindow.length, hosts: byHost },
  privateTokens: PRIVATE.length,
  importWindowRequests: importWindow.map(r => ({ phase: r.phase, where: r.where, method: r.method, url: r.url, bodyBytes: r.body ? r.body.length : 0 })),
}, null, 1));

clearTimeout(watchdog);
reap(fails.length === 0 ? 0 : 1);
```

`WAYFIND.store.guard.__disarmForAudit()` exists **only** for that control.
Nothing in the app calls it. A "zero requests carried the schedule" result
means nothing unless the instrument is shown catching one, and the honest way
to show that is to fire a real leak and watch it get caught.

---

*Server on 8915 served and freed within this session; one browser, killed at
the end. Screenshots in `shots/si/privacy/` are the four cited above plus the
wide frame — 198 KB total, and every one of them is referenced by this file
(CLAUDE.md rule 12). `WAYFIND.on` untouched. Nothing outside
`js/wayfind.js` §12, the `index.html` template, `docs/si-privacy.md`,
`docs/walk-progress.md` and `shots/si/privacy/` was written.*
