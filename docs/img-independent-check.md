# img-independent-check — the verdict lane's own reading

**Date:** 2026-08-26 · **Tree:** `41c4555` (= `origin/main`, which is `0e2867a`
plus two doc/data commits) · **Port:** 8971, `python scripts/serve.py`, never
`http.server`.

Seventeen agents built the photo-import feature overnight and said it works.
Four independent checkers and two adversaries then went over it. This file is
the verdict, and it is written from what **this lane ran itself**, not from the
six reports. Where a number below is quoted, it was re-measured here. Where it
was not, it says **NOT CHECKED HERE** in the score line — an unstated gap reads
as a pass, so every gap is stated.

**Bottom line: the feature is real and the headline numbers are honest. One
claim does not survive — "it never invents" — and one published comparison is
framed wrongly.** Neither is a reason to unship; both are reasons not to repeat
those two sentences as written.

---

## The picture

`shots/img-verdict/prod-day-phone.jpg` — a schedule read out of a photograph,
rendered as a walkable day over the real city, on the live production site at a
390x844 phone viewport. Opened and looked at in this pass, not taken on trust:
*Tuesday · 4 classes · 3 walks · 1.8 km on foot*, M 340L in Patton Hall,
`RLP → CMA` flagged **"Tight for this gap"**, footer **"From a photo of a
schedule."** It is a real frame of the real app.

---

## Score card

| # | claim | verdict |
|---|---|---|
| 1 | a student can photograph a schedule and it becomes routable classes | **HOLDS** |
| 2 | 131 of 171 scoring units | **HOLDS** — reproduced twice here |
| 2b | …against a bar of 36 | **NOT CHECKED HERE** — and not reproducible from this repo |
| 3 | 134 if the student answers the questions | **NOT CHECKED HERE** |
| 4 | it never invents — 269 predictions, none wrong | **HOLDS as a benchmark measurement / DOES NOT HOLD as a safety property** |
| 5 | nothing leaves the browser, two instruments | **HOLDS** |
| 6 | si-integration 50 of 50 | **HOLDS** |
| 7 | walkmeter 87.0 / −393.7 / 38 of 38 unchanged | **HOLDS** |
| 8 | `WAYFIND.on` still false in the shipped bundle | **HOLDS** |
| 9 | caveat: the 15 test images are synthesized, not photographs | **HOLDS — and understated** |
| 10 | caveat: the bar was Tesseract.js, not Google Lens | **HOLDS** |
| — | img-bar's "same parser both sides" fairness framing | **DOES NOT HOLD** |

---

## 1. The number — HOLDS

Run here, twice, on this lane's own server, with the untouched scorer and the
untouched corpus:

```
  SCHEDIMG_BASE=http://127.0.0.1:8971 \
  node scripts/verify/image-bench.mjs ./scripts/verify/img-import-extract.mjs

  rep 1   ALL FOUR FIELDS RIGHT  131 / 171  76.6%   precision 100.0%  (133 predictions, 0 matched nothing)
  rep 2   ALL FOUR FIELDS RIGHT  131 / 171  76.6%   precision 100.0%  (133 predictions, 0 matched nothing)

  clean-export  52/52 · angled-photo 23/49 · dark-mode 24/38 · partial-crop 32/32
  hallucinations 0 · three-of-four near miss 0 · false positives 0
```

Identical to `docs/img-verdict.md` line for line, by-condition included. The
headline is not inflated.

**The shape of the 40 misses, which no doc states plainly.** Twelve of the
fifteen images score 100%. **Three score zero — 06, 08 and 11, which are
35 of the 40 misses between them**, and all three are the same case: an
*angled* photo of a Google-Calendar-style week grid (right-tilt, glare, and
dark-mode-tilt respectively). This is not spread-out weakness. It is one
failure mode, sharply localised, and it is the exact case a student
photographing their laptop screen from their chair is most likely to produce.

## 2. The bar of 36 — NOT CHECKED HERE, and not reproducible from this repo

Confirmed by inspection: **no bar extractor is committed** — nothing in
`scripts/verify/` matches `bar`, and `acer/img-bar` is `docs/img-bar.md` and
nothing else. So the bar cannot be re-run by anyone, including this lane. To
the ship lane's credit `docs/img-verdict.md` §2 says this itself, in bold, and
says the bar is "one measured run, reproduced once independently, not three
times". That disclosure holds; the number stays unverified.

## 3. …but the fairness framing of the bar DOES NOT HOLD

`docs/img-bar.md:75-81` is titled **"The downstream parsing — the same parser
the feature gets"** and says the OCR text goes into
`window.wayfindParseSchedule(text, {})`, *"which is the exact call
`js/wayfind.js`'s own import screen makes"*, so that the number measures
*reading the image*, not *who bolted on a smarter parser*.

The shipped image path does not use that parser. Checked at source:

```
  grep -n "wayfindParseSchedule\|schedParseRows" js/schedimg.js   ->  zero hits
```

`js/wayfind.js:12101` is the **paste/text** import screen. The photo path is a
different entry point that dynamically imports `js/schedimg.js`, which does its
own word-level bounding-box geometry — document-quad detection, rectification,
photometry, row/column reconstruction — precisely because (its own docstring)
a serialized-text parser "cannot put a word back in its column". That
capability is the main engineering lever between 36 and 131, and it is on
exactly one side of the comparison.

The 131 is still real — it was measured end-to-end through the real UI, here,
twice. What is wrong is the sentence claiming both sides got the same
downstream parsing. **That sentence should be corrected or dropped, not
repeated.** Found by the bench checker; confirmed independently at source here.

## 4. "It never invents" — split verdict

**As a benchmark measurement: HOLDS.** 133 predictions per pass, zero matching
nothing, zero hallucinations, zero three-of-four near misses, on both reps run
here. Nothing was faked.

**As a safety property: DOES NOT HOLD.** Reproduced in this lane, with a
positive control:

The only defence against the engine reading one *real* building code as a
different *real* one is `neighbourDoubt()` in `js/schedconfirm.js:617`. It has
two legs. Leg one, the venue check (`:626`), deliberately cannot fire on
stadiums — the file says so at `:329-334`, and NEZ (North End Zone Building,
inside the football stadium, 803 m from Mezes Hall) is named there as *"the case
this whole check exists for"*. Leg two, the walk check, calls
`adjacentLegs()` (`:566`), which skips every class where `o.day !== cls.day`,
and then `neighbourDoubt()` returns at `:650`:

```js
  const legs = adjacentLegs(classes, cls);
  if (!legs.length) return null;
```

**No same-day neighbour, no doubt, no question.** Measured here against the
real register and the real `data/walk_graph.json` (`@ 2026-07-30T16:47:30Z`,
158 codes), driving the real `js/schedconfirm.js` in a real browser:

| case | NEZ misread… | ask | confidence |
|---|---|---|---|
| **A — control** | with classes either side, same day | **true** — *"MEZ is one stroke from NEZ and is 8 minutes closer to the classes either side of it"* | 0.62 |
| **B — the hole** | alone on its day | **false** — no question at all | **1.00** |
| **C** | alone on Friday, normal MWF load on other days | **false** | **1.00** |

Case A is the positive control: it proves the rig is not blind, and that the
safety net genuinely works when it has legs to stand on. In B and C,
`M.apply()` committed `{building: "NEZ", room: "1.306", day: "Fri",
needsConfirm: false}` — a class 803 m from where the student actually has to
be, at the maximum confidence the model can express, with no crop, no chip and
no "why".

A once-a-week discussion section, lab or seminar is one of the most ordinary
shapes a schedule has. The repo's own gate (`scripts/verify/schedconfirm.mjs`
§2c) tests this exact misread, but only ever inside a **three-class day**, so
it passes green over the gap. The benchmark cannot catch it either: every
scored class in the corpus has same-day company.

**Two honest limits on this finding.** (i) It starts from an evidence object
asserting the engine read `NEZ`; this lane did **not** demonstrate that
Tesseract actually produces `NEZ` from a picture of `MEZ`, so the real-world
rate is unmeasured and may be low. The premise is the repo's own — `MEZ 1.306`
is a real class in the corpus's schedule s3, and `schedconfirm.mjs` §2b already
asserts the pair is one confusable stroke apart. (ii) `MMS`/`NMS` is a second
real pair with the same exposure. Thirteen such pairs exist in the 209-code
lexicon.

So: *"269 predictions, none wrong"* is a true sentence about the corpus.
*"It refuses rather than inventing"* is not a true sentence about the feature.

## 5. Nothing leaves the browser — HOLDS

`VERIFY_URL=http://127.0.0.1:8971 node scripts/verify/img-import.mjs` →
**67 passed, 0 failed**, here, on the real photo path. §6 of that run:

```
  99 requests since the picture was handed over, 29 needles checked
  requests with a body                0
  destinations added by the import    0   (127.0.0.1:8971, tiles.openfreemap.org — both already in use)
  raw socket sink hits                0
  armed canary    -> blocked: [wayfind] blocked: fetch carried stored schedule content
  disarmed canary -> both instruments SAW it, including from inside a Worker
```

The positive control is the part that matters: the instruments were proved able
to see a leak before their silence was believed.

**One number to stop quoting: the request count.** It is 165 in
`docs/img-verdict.md`, 136 in the committed `img-import.mjs` run, **99 here**,
and 30 in the privacy checker's from-scratch capture — all on the same corpus
image. It moves with the measurement window and with background map traffic.
The *result* (zero bodies, zero needles, zero new hosts) is stable and is the
claim; the count is not evidence of anything.

## 6, 7, 8. The gates and the ship switch — HOLD

- `node scripts/verify/si-integration.mjs 8971` → **50 passed, 0 failed.**
- `node scripts/verify/walkmeter.mjs` → **PASS**, and from its own
  `out/walkmeter-last-run.json` written by this run: `routeExtraTotalM
  87.01`, `routeExtraSignedM -393.72`, `atDoor 38 / endsScored 38`,
  `selfCheckDriftM 0`. Unchanged, to the decimal.
- **`WAYFIND.on`**: `js/wayfind.js:88` reads `on: false`. Not taken from
  source — the production bundle was fetched and diffed:
  `curl https://flyover-utx.vercel.app/js/wayfind.js` (880,314 bytes, HTTP 200)
  is **byte-identical** to the local file (`diff --strip-trailing-cr`, exit 0),
  and carries `on: false` at line 88. Read live in-page during the browser
  test: `window.WAYFIND.on === false`. Not touched by this lane.

## 9. The synthesized-corpus caveat — HOLDS, and is understated

`manifest.json`'s `_honesty` field is the first thing in the file and could not
be blunter: *"EVERY IMAGE IN THIS DIRECTORY IS SYNTHESIZED. No camera was used
anywhere."* HTML mock → headless Chrome → Pillow warp/blur/glare/noise/JPEG.
Nothing is hidden.

Two things worth adding, both from the bench checker and both fair:

- The glyphs are perfectly antialiased *before* the warp. There is no lens
  point-spread, no sensor moiré, no hand-shake. **76.6% is a ceiling-ish number
  on a friendly proxy**, and the first real phone photo could move it a long
  way. `docs/img-bar.md` says as much; underline it rather than soften it.
- **171 is not 171 different classes.** It is one unit per class-per-day, drawn
  from **4 distinct schedules and 21 distinct classes** replicated across 15
  images (schedule s1 alone appears on 7 of them). `truth.json` states the
  per-meeting definition; the small number of underlying schedules is stated
  nowhere and a skimmer will over-read "171".

## 10. The Google Lens caveat — HOLDS

`docs/img-bar.md:9`: *"Google Lens was not reached. `reachedTheRealThing:
false`."* Stated in bold, ninth line of the file, with the reason. Not buried.

---

## What this lane did NOT check

Stated so the gaps are not mistaken for passes.

- **The bar of 36.** Not reproducible from this repo (§2). Taken on the ship
  lane's own disclosure.
- **The 134 "student answers" figure.** Only the skip-everything floor of 131
  was run here, twice. The bench checker spot-checked the +3 on image 05 and it
  held; this lane did not.
- **The production deploy end to end.** `WAYFIND.on` and the whole of
  `js/wayfind.js` were diffed against the live site, and the cited production
  frame was opened and inspected. A fresh photo import was **not** driven on
  `flyover-utx.vercel.app` in this pass — the production checker did that.
- **Whether Tesseract really misreads MEZ as NEZ from a real image.** §4(i).
  The rate behind the §4 defect is unmeasured.
- **The adversary's `findBlocks()` finding** — that a non-calendar image can
  produce a refusal whose *explanation text* asserts "there are at least 8
  classes drawn on this calendar" when there are none. Reported to `QUEUE.md`
  from that lane's evidence; not reproduced here.
- **Cold-load timing.** The regression checker measured a pre/post A/B
  (9,814 ms vs 11,153 ms minimum, not slower). This lane ran two Chrome
  harnesses concurrently and therefore had no quiet machine; no timing number
  is claimed here at all.
- **Request-count figures** (133/164/143/135/165/18). Not recounted, and per §5
  they should not be quoted by anyone.

## Housekeeping

38 GB free before, 38 GB free after. `.claude/worktrees` does not exist;
`git worktree prune` found nothing; **zero** `worktree-wf_*` orphan branches.
The six long-lived sibling worktrees (`austin-3d-facades`, `-n2campus`,
`-outer`, `-props`, `-roofs`) are pre-existing and were left alone. Server on
8971 killed and the port freed; every node and Chrome process this lane started
was killed. `git status` clean apart from this file. **No code was changed.**
