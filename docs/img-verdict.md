# img-verdict — the ship lane's own reading of the photo-import round

**Verdict: SHIP.** Merged to `main` on 2026-08-25 by the ship lane, after
re-running every number on the merged tree rather than reading them off the
three builders' docs.

This file is the record of what the ship lane measured **itself**. Where a
number here matches a piece doc, it matches because it was reproduced, not
because it was copied. Where it does not match, the discrepancy is written
down.

---

## 1. The three disqualifiers, checked first, on the merged tree

The brief said any one of these failing means do not ship whatever the score
is. None of them failed. Each was checked with the repo's own gate **and** with
an instrument the ship lane wrote from scratch, so a blind spot in the gate
could not be inherited.

### Nothing leaves the browser

| instrument | what it saw |
|---|---|
| `si-integration.mjs` §6 (twice, interleaved) | 14 requests while the schedule was on screen, **0 with a body**; 17 schedule-derived needles, none found; raw TCP sink never contacted; guard `watched=30 quietChecked=107 blocked=0` |
| `img-import.mjs` §6 (the image path specifically) | 136 requests since the picture was handed over, **0 with a body**; 29 needles, none found; **no destination added** — `127.0.0.1`, `tiles.openfreemap.org`, both already in use; sink never contacted |
| the ship lane's own `_ship-netwatch.mjs` | 174 and 168 requests across two full imports of image 01, **0 with a body**; 35 needles drawn from `truth.json` (the answer key, not the app's output, so a misread cannot launder a pass), none found; sink never contacted; **8 engine requests, every one from `127.0.0.1`** |

Both gates also fire a **positive control**: a deliberate leak of a real
imported room, by `fetch`, `sendBeacon` and from inside a Worker. The shipped
guard **blocks** it (`[wayfind] blocked: fetch carried stored schedule
content`), and when the guard is disarmed both instruments — the browser-level
capture and the raw socket outside every browser API — see it. So the
instruments are not blind; there is simply nothing to see.

### The app never outputs a building or a time that is not on the image

Measured, not argued. Across **both** full 15-image bench passes on the merged
tree:

```
  precision   100.0%   (133 predictions / 136 predictions, 0 matched nothing)
  hallucinations        0   (a real class of this schedule, but not on this image)
  three-of-four near miss 0
```

Read by hand as well: on image 01, driven through the real UI by the ship
lane's own script, the device ended up holding **14 of 14** classes
field-for-field identical to `truth.json` — `RLP 0.106 Tue/Thu 09:30–11:00`,
`CMA 6.146 Tue/Thu 11:00–12:30`, `WEL 2.224 MWF 10:00–11:00`, `PAI 3.02 MWF
13:00–14:00`, `GDC 2.216 Tue/Thu 14:00–15:30`, `MER 1.906 Tue/Thu 16:00–17:30`.

The mechanism is `applyGroup()` in `js/schedconfirm.js:1467`: a reading that
nothing believed and nobody confirmed is **refused**, and one over the doubt cap
is left out unless the student explicitly taps "Use it anyway, unchecked".
`shots/img-confidence/confirm-retake-phone.jpg` is the refusal on screen, and it
says why in plain words: *"Not saved: 'MZQ' is not a building code this app
knows; classes do not start at 9:07 am; '2.2%' has characters a room number does
not. Take the picture again, straight on, and this one will read."*

### The cold load is not slower

`index.html` is **byte-identical to `main`** — `git diff origin/main..acer/img-ship -- index.html` is empty — so the OCR engine cannot be on the load path by construction. Confirmed by watching it anyway:

- `img-import.mjs` §1: **110 requests at page load, zero** matching
  `tesseract|traineddata|.wasm|schedimg|schedconfirm|walkgraph`.
- the ship lane's own watch: **87 and 88 requests at page load, zero** matching.
  The engine's 8 requests appear only after a file is picked.

**What the cold load did gain, stated rather than buried:** `js/wayfind.js` grew
from 813,749 to 896,536 bytes raw — **+22,598 bytes gzipped** (268,622 →
291,220, Python gzip level 6, the comparison `docs/perf/payload.md` requires
because `scripts/serve.py` does not gzip and the real site does). That is the
honest cost: **about 22 KB**, not the 4.9 MB engine, which stays in
`vendor/tesseract/` until a student picks a file.

---

## 1b. PRODUCTION, after the deploy landed — not assumed, driven

`flyover-utx.vercel.app`, checked after `main` deployed, **17 of 17**:

| page | result |
|---|---|
| `/` | 133 requests, city renders, **zero console errors**, `WAYFIND.on === false`, **zero** engine requests |
| `?autopilot=1&preset=cinematic` | 164 requests, same, still works |
| `?sliderdemo=1&preset=cinematic` | 143 requests, same, still works |
| `?walk=1` | walk UI present with exactly one import door (`wf-imp-entry`), same, zero engine requests |

Then a **real photograph was imported on the live site**, driven through the
real controls on a 390x844 phone viewport. It put **14 of 14 classes on the
device, field-for-field correct**, and while it did:

```
  165 requests since the picture was handed over
  hosts contacted:  flyover-utx.vercel.app, tiles.openfreemap.org
                    (both already in use before the picture was picked)
  requests with a body:  0
  needles from the answer key found in any request:  0 of 18
  raw socket sink hits:  0
  console errors:  0
```

`shots/img-verdict/prod-check-phone.jpg` is the confirm screen on the live site —
the student's own picture cropped to the row in question, the class named, the
doubt in plain words. `shots/img-verdict/prod-day-phone.jpg` is the resulting
day: *Tuesday · 4 classes · 3 walks · 1.8 km on foot*, M 340L in Patton Hall,
`RLP → CMA` flagged **"Tight for this gap"**, and the footer **"From a photo of a
schedule."**

**One flaw in the ship lane's own instrument, found and fixed mid-check, because
it is exactly the kind of thing this repo has been burned by.** The first
version of the production script declared `const URL = 'https://...'`, which
**shadows the global `URL` constructor**, so every `new URL(r.url).host` threw
and every host collapsed to the same placeholder — making the "no new host"
assertion vacuously true on both sides. It passed, and it meant nothing. Renamed
to `SITE` and re-run; the numbers above are from the fixed run. A green
assertion is not evidence until you can say what would have made it red.

---

## 2. The number, ours against the bar

All three of ours were re-run by the ship lane on the merged tree, on the
untouched corpus, by the untouched scorer. `image-bench.mjs` and
`scripts/verify/schedule-images/` have **zero diff against `main`** — the
goalposts did not move.

**The bar row is NOT the ship lane's own measurement, and is marked so
deliberately.** No bar extractor was ever committed — `acer/img-bar` is
`docs/img-bar.md` and nothing else — so reproducing it means rebuilding it from
prose. The extract critic did exactly that, from the doc alone, and landed on
**36 / 171 on the nose**. The ship lane started a third reconstruction and
**abandoned it**: `createWorker('eng')` pulled the full 5.2 MB LSTM model rather
than the compact one the bar lane's timing implies (39.8 s for fifteen images
against 55 minutes and still running here), so it would not have been the same
instrument even if it had finished. The bar is therefore **one measured run,
reproduced once independently, not three times.** The decision does not turn on
it: at 131 against anything under 100 the comparison is not close, and the
precision gap below is the real argument anyway.

```
                                         all four fields right    precision
  the bar  (docs/img-bar.md)                36 / 171   21.1%        16.1%
  SHIPPED, student answers nothing         131 / 171   76.6%       100.0%
  SHIPPED, student answers                 134 / 171   78.4%       100.0%
```

By condition, shipped, student answers nothing — the floor:

| condition | ours | the bar |
|---|---|---|
| clean export | **52 / 52  (100%)** | 14 / 52  (26.9%), 88 false positives |
| angled photo | **23 / 49  (46.9%)** | 0 / 49  (0.0%), 48 false positives |
| dark mode | **24 / 38  (63.2%)** | 8 / 38  (21.1%), 12 false positives |
| partial crop | **32 / 32  (100%)** | 14 / 32  (43.8%), 39 false positives |
| **false positives, all conditions** | **0** | **187** |

The recall gap is 3.6x. The precision gap is the one that matters for a walking
app: the bar emits 187 predictions that match nothing, and — checked in the
extract round's blind comparison — every prediction it makes on images 03 and 04
carries `days: []` and `startMin: null`. It reads buildings and rooms and cannot
say when. **Ours emits zero wrong answers across 269 predictions over two
passes.**

**Where the 3-meeting gap between 131 and 134 lives:** all of it on image 05,
the angled registrar table. The confirm screen asks four questions there; a
student who skips every one loses three readings, because `applyGroup()` will
not keep what nobody vouched for. That is the asymmetry the feature is built on,
priced: **skipping costs 3 of 171 and buys 0 wrong answers.**

---

## 3. What the ship lane found that the piece docs did not say

- **The round-3 refusal is closed.** The confidence critic refused that round
  because `needsConfirm` / `unconfirmedFields` had **zero consumers** —
  a well-built invariant protecting nobody. On the merged tree
  `js/wayfind.js:10525` reads `unconfirmedFields` and `:12992` reads
  `needsConfirm`, the day view renders a tappable *"Read as "PAI 3.02" — check
  this one"* chip, and `img-import.mjs` §8 proves the chip corrects one stored
  class without redoing the import and that the correction survives a reload.
  The inert deliverable became a control.
- **`si-integration.mjs` is 50/50, not 49/50.** The one gate that was red on
  purpose all round — "the sheet offers ONE way to import a schedule, not two" —
  is green, because Simeon answered the two-doors question and `acer/si-onedoor`
  landed. Nothing red was merged.
- **`schedconfirm.mjs` rewrites five committed JPEGs when it runs.** Not a
  defect, but a lane that runs the gate and then commits will commit five
  byte-different screenshots for no reason. Reverted here; worth a `--shots`
  flag next time someone touches that file.
- **The extract round's "biggest gap" recommendation is already refuted by
  measurement in `docs/img-extract.md`.** That critic proposed clustering event
  blocks' x-centres into day columns instead of relying on header OCR. On image
  06 the columns **already work** — `schedimg.mjs` shows `layout: grid`, ten
  blocks found in the right columns, *"and it still knows which day each of them
  is on, from the column — Mon Wed Tue Thu"*. The blocker on 06 is not the
  column fit; it is that the captions read `MA 6 106`, `ute 2.909`, `i208` —
  nothing that is a room. Building the column clusterer would not move 06 or 08.

---

## 4. What is still weak, measured

**Angled photographs of a week-grid calendar: 0 of 35.** Images 06, 08 and 11 —
every one an angled shot of a Google-Calendar-style week grid — score exactly
zero. That is **20% of the whole corpus** and, as the extract critic put it, it
is plausibly the most common capture a student will actually take: photographing
their own phone at an angle.

They fail honestly rather than wrongly — the reader reports what it saw
(*"10 classes are drawn here but the hour scale did not read"*) instead of
guessing a room. But the recovery path is *"take the picture again"*, and
`docs/img-extract.md` measured, at 2x/3x/4x under four page-segmentation modes,
that the weekday names simply are not in those JPEGs. **These three are at the
legibility floor of the image, not at a gap in the code.**

**Two other honest caveats, which no headline number should be quoted without.**

1. **All fifteen corpus images are synthesized.** No camera was used anywhere.
   The four "angled phone photos" are real projective warps of an HTML mock with
   synthetic glare, defocus, sensor noise and JPEG at q74–78 — genuine geometry
   and genuine degradations, but there were no photons, and none of them is a
   photograph of a real screen or a screenshot of UT's real registration system.
   What *is* real is the data: schedules s1 and s2 are field-for-field
   transcriptions of the repo's own `.ics` fixtures. **76.6% is a number on a
   synthetic corpus.** The first thing a real photograph could do is move it.
2. **The bar is not Google Lens.** `docs/img-bar.md` records
   `reachedTheRealThing: false` — Lens could not be reached from this machine
   (no connected signed-in Chrome; the sandboxed browser has no file upload; the
   one indirect route was refused as cross-origin data smuggling before it ran,
   correctly). The bar actually run is **Tesseract.js 7.0.0, PSM 6, raw text
   into the app's own production parser** — the strongest thing reachable, not a
   guess at what a bigger name would score. It is a real bar and beating it is a
   real result, but it is a substitute bar and this file will not pretend
   otherwise.

`171` is scoring units, where a unit is one class on one day — a TTh course is
2, an MWF course is 3 — because an importer has to place a class on a day at a
time to be useful.

---

## 5. The one thing to do next

**Give a class the import dropped a way back that is not "re-photograph
everything."** Today `applyGroup()` refuses a reading nothing believed, which is
right, but a refused class then has no day-view row and no chip to tap — it is
simply gone, and the only recovery is deleting the schedule and starting over.
That is exactly the population behind the 131-vs-134 gap, and it is the whole
of what a student gets from images 06, 08 and 11.

Every part this needs already exists from the integrate round: the `WF_FIX`
sheet, its building type-ahead that names `WEL` back as "Robert A. Welch Hall"
and refuses `ZZQ`, and `impPlace`. What is missing is keeping a lightweight
record of the refusal (course, day and time only) instead of discarding it, and
one line on the result screen: *"3 classes from your photo couldn't be confirmed
and weren't saved — add them?"* opening the same sheet in a new-class mode.

That is worth more than another point of OCR recall, because it converts the
feature's honest failures into something a student can finish in four taps
instead of a retake.

---

## 6. Reproducing every number in this file

```
python scripts/serve.py 8933                       # NEVER python -m http.server

node scripts/verify/image-bench.mjs --selftest                       # 171/171
node scripts/verify/image-bench.mjs ./scripts/verify/img-import-extract.mjs \
     --name shipped-skip                                             # 131/171
SCHEDULE_ANSWER=lead node scripts/verify/image-bench.mjs \
     ./scripts/verify/img-import-extract.mjs --name shipped-lead     # 134/171

node scripts/verify/si-integration.mjs 8933        # 50 passed, 0 failed
node scripts/verify/img-import.mjs      8933       # 67 passed, 0 failed
node scripts/verify/schedimg.mjs        8933       # 26 passed, 0 failed
node scripts/verify/schedconfirm.mjs    8933       # 101 passed, 0 failed
node scripts/verify/walkmeter.mjs       8933       # 87.0 m / -393.7 m / 38 of 38
```

`walkmeter.mjs` on the merged tree returns **87.0 m** total over pairs it makes
worse, **-393.7 m** signed, **38/38** ending at the right door — unchanged from
`main`, which is the point: this round added a schedule reader and moved nothing
about the walking.

Every run above was done on `acer/img-ship` with `main` merged in, not on a
piece branch in isolation. `WAYFIND.on` is `false` at `js/wayfind.js:88` and is
absent from the diff. No file has a NUL byte. Server, browsers and ports were
all released afterwards.
