# The schedule-image benchmark

Fifteen images of a UT class schedule, an answer key, and a scorer. Every later
stage of the photo-import round is measured on this, and both sides of every
comparison have to be measured by the same file
(`scripts/verify/image-bench.mjs`) or the comparison is not one.

## What these images actually are — read this before quoting a number

**All fifteen are synthesized. No camera was used anywhere.**

Each one starts as a hand-written HTML mock rendered in headless Chrome
(`tools/pages.mjs`). Four of them are then put through a perspective warp, a
graded defocus blur, a glare gradient, a monitor pixel-grid moire, a
white-balance shift, sensor noise, a vignette and JPEG compression
(`tools/photo.py`), and four are cropped.

So the phrase **"angled phone photo" in this corpus means a render that has been
put through a camera-shaped transform, not a photograph of a screen.** The
geometry is real projective geometry and the blur, noise and compression are
real degradations, but there were no photons. `manifest.json` repeats this per
image; nothing here should ever be described as a screenshot of UT's
registration system or of Google Calendar either, because it is not one.

**What is real is the data.** Every building code is one `js/wayfind.js` already
knows — from `data/ut_buildings.json`, UT's own 198-code register, or from the
Pickle off-map table. Every course number is a real UT course number. Two of the
four source schedules are transcriptions of `.ics` fixtures this repo already
ships. `tools/schedules.mjs` states, per schedule, exactly what was transcribed
and what was changed.

## The four conditions

| condition | images | what it tests |
|---|---|---|
| `clean-export` | 01 02 03 04 | full-quality screenshots — desktop table, week grid, phone cards |
| `angled-photo` | 05 06 07 08 | keystone, defocus, glare, moire, noise, low JPEG quality |
| `dark-mode` | 09 10 11 | light text on dark, which inverts a naive threshold |
| `partial-crop` | 12 13 14 15 | top half, bottom half, a day column cut mid-word |

Images 11 and 15 sit in two conditions at once (dark + angled, dark + cropped);
each is counted once, under the condition named in `condition`, and the second
is listed in `alsoConditions`.

## truth.json — the answer key

One entry per **class meeting**, meaning a course on one day. A TTh course is
two entries and an MWF course is three, because a schedule importer has to place
a class on a day at a time before it is any use to anyone. **171 scored meetings
across the fifteen images**, plus 10 optional ones.

Four fields all correct is one hit: `building`, `room`, `day`, `time` — and
`time` means start *and* end, because the end time is what decides when you
leave for the next class. Three of four is a miss.

Each entry carries:

- `required` — the whole element is inside the image. These are what the score
  is out of.
- `visible: partial` — the crop cut through this one. Finding it earns credit;
  missing it costs nothing. This is where "unsure costs one tap, confidently
  wrong costs a missed class" is encoded as arithmetic.
- `onImage` — the fraction of the element's box inside the image, **measured in
  the live page**, not estimated. Every element that displays a meeting carries
  a `data-meet` attribute; `tools/corpus.mjs` reads its bounding box in Chrome
  and intersects it with the crop rectangle. A hand-typed answer key for a crop
  is a guess about a pixel boundary.
- `notOnImage` — meetings of the same schedule that this image does not show.
  Emitting one of these is a **hallucination** and the scorer counts it as its
  own category, separately from an ordinary wrong answer.

## Then every image was looked at

The derived boundary is only half the job — it says what is geometrically on the
image, not what a human can read. So all fifteen were opened and read, twice,
and four things were changed because of what was on screen rather than what the
numbers said:

1. **Image 05** was shot at yaw -23 / pitch 9. Every field was on the image, so
   the derived truth said all six rows were scorable — but the projection put
   the left end of each table row more than half a row-pitch below its own right
   end, so `M 340L` lined up with the row *above* its own room. A careful human
   could not have got those rows right. Angle reduced to yaw -17 / pitch 5.
2. **Image 08**'s glare at strength 0.78 erased two classes off the top row
   entirely. Reduced to 0.55 and moved up onto the headings.
3. **Image 11**'s reflection sat over the 9:30 and 11:00 Tuesday blocks and
   erased both. Moved onto the day headings, where it is still the brightest
   thing in the frame.
4. **Image 14**'s cut was walked down twice. At 42% of the block the Friday
   sliver still showed the whole time range and the whole room, so the condition
   was not being tested at all; at 22% only the time was cut. At 16% Friday
   reads `GOV 312L / 10:00 am / WEL 2.22` — cut mid-string, which is the case
   that has to be refused rather than guessed at.

In each case the fix was to the image, not to the answer key. **An image whose
truth claims four correct fields that nobody can read is not a hard image, it is
a wrong answer key**, and it would have scored every later stage on noise.

## The scorer

```bash
cd scripts/verify
node image-bench.mjs --selftest                 # proves the scorer discriminates
node image-bench.mjs ./my-extractor.mjs --name ours --json ours.json
```

An extractor module default-exports `(imagePath, meta) => predictions[]`. `meta`
is `{ file, path, bytes }` — deliberately **not** the condition and **not** the
answers, because a feature does not get told the photo is blurry before it reads
it.

Predictions are accepted in whatever shape a lane already emits — `building` or
`code`, `location: 'WEL 2.224'` as one string, `days` as an array or as UT day
letters (`TTh`, `MWF`), times as `'09:30'`, `'9:30 am'`, `'0930'` or minutes
past midnight. That is what makes the same file usable on both sides of a
comparison without either side being rewritten to be measured.

It reports, overall and per condition and per image:

- **all four fields right**, out of the required total — the headline;
- **precision**, because an extractor that emits a confident wrong room is worse
  than one that says it is unsure;
- **hallucinations** — a real class of that schedule, on an image that does not
  show it;
- **three-of-four near misses**, scored as misses but counted separately, so a
  wrong room and a class not seen at all do not look the same;
- **end-time-only losses** — of the misses, how many had the right start.

### The self-test, and why it is not optional

A scorer that returns 100% to everything passes silently forever. So
`--selftest` runs five built-in extractors against the real corpus and asserts
twelve things about the results:

- an **oracle** that returns the answers in a *different shape* from the one
  truth stores them in (combined location string, UT day letters, `9:30 am`
  times) must score 171/171 with zero false positives — proving the
  normalisation does its job rather than proving a string equals itself;
- a **one-digit room error** on every row must score **0**, and must be reported
  as 171 three-of-four near misses rather than as silence;
- a **greedy** extractor that also emits every cropped-off meeting must keep
  full recall, lose precision, and have the extras counted as hallucinations;
- the **parser lane's shape** (`code`, day array, `startMin`) must score
  identically to the oracle;
- **right start, wrong end** must score 0 and still cost precision — the start
  is credited only as a diagnostic.

That last one is a bug this file already had: the first version consumed the
prediction when it checked the start, which quietly excused an extractor for the
field it got wrong.

## Rebuilding

```bash
cd scripts/verify
CORPUS_SCRATCH=/some/scratch node schedule-images/tools/corpus.mjs
```

Needs `playwright-core` (`npm install` in `scripts/verify`), a real Chrome, and
Python with Pillow and numpy. It rewrites all fifteen JPEGs, `truth.json` and
`manifest.json` together, so the answer key can never drift from the image.

`CORPUS_SCRATCH` should point outside the repo. Without it the intermediate PNGs
land in `.build/` here — they are gitignored, but they are 60 MB and every
worktree would carry them if they were not.

**Total: 1.14 MB for fifteen images**, against a 4 MB budget. These files are
tracked, and a tracked file is copied by every parallel worktree.

## Privacy

A class schedule is personal data and a picture of one is that plus a picture of
the student's screen. Nothing in this directory is a real student's schedule —
the courses come from fixtures and UT's public register, there is no name and no
EID on any image, and the "printed" date is the day the corpus was built.

`image-bench.mjs` makes no network calls and never will: it reads local JPEGs
and calls a function. An extractor that uploads the image is a privacy failure
whatever it scores, and `scripts/verify/si-integration.mjs` section 6 is the
gate that catches it at the socket.
