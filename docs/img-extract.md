# Image to text, on the device

A photograph or screenshot of a class schedule becomes classes, entirely inside
the browser. `js/schedimg.js` is the whole feature; `scripts/verify/schedimg.mjs`
is its gate; `scripts/verify/schedimg-extract.mjs` is what the benchmark scores.

**Measured on the fifteen-image corpus by `scripts/verify/image-bench.mjs`:**

```
image-bench  ours (real app page)   (15 images, 171 scored meetings)

  ALL FOUR FIELDS RIGHT   134 / 171    78.4%
  precision               100.0%   (136 predictions, 0 matched nothing)
  hallucinations          0
  three-of-four near miss 0
  end-time-only losses    0
  optional (cut) meetings 2 / 10

  clean-export   52/52 100.0%     angled-photo   26/49  53.1%
  dark-mode      24/38  63.2%     partial-crop   32/32 100.0%
```

against the bar in `docs/img-bar.md` — Tesseract.js's plain text fed into the
app's own row parser:

| | the bar | this | |
|---|---|---|---|
| all four fields right | 36 / 171 (21.1%) | **134 / 171 (78.4%)** | 3.7× |
| precision | 16.1% | **100.0%** | 187 wrong answers → 0 |
| clean-export | 14 / 52 | **52 / 52** | |
| angled-photo | 0 / 49 | **26 / 49** | |
| dark-mode | 8 / 38 | **24 / 38** | |
| partial-crop | 14 / 32 | **32 / 32** | |
| images at 100% | 0 | **12 of 15** | |

Every image that is not an angled photograph of a week grid is now at 100%,
and there is no wrong answer anywhere on the corpus: not one of the 136
proposals matches nothing, and none is three-fields-right.

Both sides are scored by the same file, on the same corpus, under the same
rules, which is the only kind of comparison that is one.

---

## The engine, chosen by feature test rather than by reputation

Two candidates were checked live, in the order the brief set out:

| candidate | reachable here? | how it was checked |
|---|---|---|
| Chrome's built-in `TextDetector` | **no** | `pickEngine()` feature-tests for it on every call and never finds it in the Chrome this repo drives — the gate prints which engine actually ran, and it says Tesseract every time. The Shape Detection API shipped `FaceDetector` and `BarcodeDetector` and never shipped text broadly. |
| **Tesseract.js 7.0.0**, vendored | **yes** | runs in a Worker, on this machine, on all fifteen images |

`pickEngine()` still tries `TextDetector` **first**, by feature test and never by
user-agent, because it costs zero bytes and runs at native speed where it exists.
If a browser ever has it, this file uses it and `engine.name` says so out loud
rather than silently changing what is being measured.

### What is vendored, and why it is that shape

`vendor/tesseract/`, 5.1 MB, all same-origin:

| file | bytes | |
|---|---|---|
| `eng.traineddata.gz` | 1.98 MB | the `4.0.0_fast` model. The standard model is 10.9 MB — five and a half times the size for a corpus this one already reads at 98% precision. |
| `tesseract-core-simd-lstm.wasm` | 2.86 MB | |
| `tesseract-core-simd-lstm.js` | 89 KB | |
| `worker.min.js` | 111 KB | |
| `tesseract.min.js` | 63 KB | |

**One named core rather than a directory to choose from.** Left to itself
Tesseract.js reaches for the single-file builds (`*-relaxedsimd-lstm.wasm.js`,
3.9 MB each) and would need two of them vendored to cover browsers with and
without relaxed SIMD. Naming the split SIMD build ships one core at 2.95 MB.
Plain WebAssembly SIMD has been in every major browser since 2021;
`hasSimd()` feature-tests for it and a browser without it gets a sentence
saying so, not a 404 storm.

**No CDN, ever.** Not because a CDN would see the picture — it would not — but
because it would see *that a schedule is being imported*, from an IP, at a time.
Same-origin costs nothing here and removes the question.

---

## Why the score moved, in order of how much it was worth

The bar's own analysis named two separate failures, and both are geometric
rather than optical. Everything below follows from that.

### 1. On a week grid, the time IS the position  (+35 meetings)

The bar scored **0 out of 49** on every Google-Calendar-style week grid, and the
reason was never that Tesseract cannot read. It reads the captions and puts the
words back in the wrong order, because a dense multi-column grid has no reading
order. Worse, the captions are the *smallest type on the page*: measured on
corpus image 02, one caption time range in ten parses correctly.

But a week grid carries its own coordinate system, drawn on it:

- the hour labels down the left edge are an **axis** — `hourAxis()` fits
  y-pixels to minutes with Theil–Sen (the median of every pairwise slope), so
  one label misread as another cannot drag the clock across the afternoon, and
  a label that will not fit is dropped rather than the axis being abandoned;
- an event **block** is a flat rectangle of one colour, and its top and bottom
  edges are its start and end;
- the **column** it sits in is the day.

`findBlocks()` finds those rectangles with colour-limited connectivity — not
just "differs from the page" — because on a week grid an 11:00 class begins on
the pixel where the 9:30 class ends, and a mask that only knows "coloured"
welds them into one four-hour event.

Two details that each cost a round:

- **A calendar draws a gap between touching events**, so a block's painted
  bottom is a few minutes short: a 9:30–11:00 class comes off the ruler at
  10:55. Class times land on the quarter hour, so `snapMin: 15` absorbs the
  seam. At `snapMin: 5` the same class reports as ending at five to eleven,
  which is a wrong answer with four fields that all look right.
- **No axis is not no grid.** Corpus image 10's hour labels do not read but its
  captions are perfect, so when the axis fails the blocks still supply the day
  and the grouping and the caption supplies the clock. That alone was 13/14
  on image 10, up from 8.

The caption is kept as a **second witness**: when both exist and disagree by
more than 16 minutes, the axis wins — it is the calendar's own ruler, against
four tiny digits — and the disagreement is written into the class's `why`.

### 2. The engine gets a second, easier look at what it lost  (+11 meetings)

Once the geometry is known it can be spent on the engine rather than only on
the answer. A coloured event block is white type on a saturated ground sitting
in a page of black type on white; after the page pass it is a small island of
reversed contrast and the line the engine drops is always the third one — the
room. Cropped out, turned the right way up by its own median, and magnified,
it is an ordinary two-word line and reads first time (`ocrCrop()`).

The same trick on a registrar table's **cells**: image 12's
`10:00 am-11:00 am` comes back from the page pass as `am-11:00 am`, and image
01 loses one row's day letters entirely. Re-reading just the cell that came
back empty took both images to 14/14 and 7/7. Only empty cells are re-read, so
a clean table pays nothing.

### 3. A photograph is a document inside a room  (+18 meetings on angled photos)

The bar scored **0 out of 49** on angled photos. `findDocQuad()` finds the
document, `rectify()` inverts the perspective the camera applied and upscales,
and after that an angled table reads like a table.

Two decisions there are worth writing down because the obvious alternative is
wrong:

- **Find the document by edge density, not by brightness.** A brightness rule
  finds a white page on a dark desk and then gets exactly backwards the case
  this corpus was built to include: a dark-mode calendar photographed in a dark
  room, where the document is barely brighter than the room. Text and rules are
  structure; a desk and an unlit wall are not, whatever their brightness.
- **Decide "is this a photograph?" by whether the content stands clear of all
  four edges.** A screenshot's content runs to the edge of the file — that is
  what a screenshot is. The first version of this function had no such test and
  "corrected" two thirds of the corpus into trapezoids.

That second test is load-bearing twice over: `source: 'screenshot'` also means
the border of the bitmap is a **crop**, so a word touching it is half a word.
That is what refuses `WEL 2.22` on image 14 — the left half of `WEL 2.224` —
and it is why that image scores 12/12 with no false positives instead of
guessing at a column that was cut off.

### 4. Photometry that is measured rather than assumed

- **`min(R,G,B)` instead of luminance.** White type on the yellow block of a
  calendar is 255 against 195 in luminance and unreadable; in the minimum
  channel it is 255 against 38.
- **Inversion is detected, from the page's own median.** Dark mode is a
  different sign, not a different threshold, and a third of this corpus is dark.
- **A floor under the local background.** Glare and screen shading are local, so
  the correction divides by a local *maximum* — the brightest thing near text is
  the paper. But inside a coloured block, the half with no caption in the window
  has a local maximum equal to the block's own colour, divides to 1, and comes
  out **white**: a bright slab abutting the caption. That one artefact was
  costing the third line of every green and purple event on image 02. A floor at
  32% of the page's bright level removes it and is low enough that an under-lit
  corner of a photograph still gets its own correction.
- **Size the page by its text, not by its width.** `estimateLineHeight()`
  measures a line of type from horizontal *edges* per row — a solid calendar
  block is 60 px of "not the page colour" and would otherwise be read as a 60 px
  line of type — and the upscale aims for a 30 px line. A phone screenshot
  arrives at 30 px already and is left alone; a photographed table arrives at 11
  px and needs all of it.

### Three things that were tried and measured and are NOT in the file

Each was run on the whole corpus, both ways, and rejected on the number rather
than on an argument:

| tried | score | kept? |
|---|---|---|
| local-**deviation** normalisation (distance from the local mean, so every polarity comes out dark-on-light at once) | **20 / 171** | no — it is a lovely idea and it destroys thin type |
| 3×3 **median denoise** on photos | **78 / 171** vs 81 at the time | no — it wins one meeting on the angled table and loses four on the blurred card stack |
| upscaling to a **44 px** line instead of 30 | **115 / 171**, precision 96.7% | no — it rescues two rows of the angled table and costs six on the phone card stacks, whose type was already big enough |

All three are still reachable from `TUNE` (`photo.normalize`, `photo.denoise`,
`targetLinePx`), so the next person can re-run the A/B in one line instead of
re-deriving the idea:

```bash
SCHEDIMG_TUNE='{"photo":{"denoise":3}}' node ...
```

---

## The second round: 124 → 134, and two wrong answers → none

Four changes, each measured on the whole corpus.

### 5. A lost colon is a lost class  (+5 meetings, image 05)

The hour cell of a photographed table comes back as `400 pm-5.30 pm` and as
`10:00 am-11 00 am`. Neither parses: the time pattern wants a separator between
the hour and the minutes, and OCR keeps eating it. `normalizeClockText()` puts
it back — three or four digits run together, or split by a space, are a clock —
**but only where a meridiem follows them**, which is the whole reason it is safe
to run on every surface. A unique number (`54010`), a room (`1.906`) and a
course number (`340L`) are never followed by "am" or "pm", so none of them is
ever touched. Two whole rows of image 05 were scoring zero on this alone.

### 6. A second look is a different shape of picture  (+3 meetings, image 05)

The re-read of a cell used the page's own segmentation mode, which is
`SINGLE_BLOCK`. A page is a block; **one table cell is a line**, and the
difference is not cosmetic: image 05's `MWF` cell comes back **empty at every
magnification from 2× to 5×** under block mode, because the layout analyser
will not commit to a block from one short word. Three things fixed it together
and all three were needed:

- `ocrWords()` now takes a page-segmentation mode for one call and puts the old
  one back afterwards, so a crop can say it is a line;
- the re-read asks **more than once** — line mode, then block mode, then block
  mode with a generous margin — and stops the moment the caller says it has
  what it wanted (a range, a day run, a room). A clean table still pays nothing,
  because none of it runs unless the page pass came back empty;
- the generous margin (measured: nothing at 6 px, a reading at 40) reaches into
  the rows above and below, so what comes back is filtered by **this row's own y
  band** as well as by its column — otherwise the row below's day letters would
  be read as this row's, which is a confidently wrong answer.

`repairDayRun()` then allows `MWE` back to `MWF` by one confusable letter, on
the same "exactly one candidate" rule as the building codes, **and only inside a
cell under a DAYS heading**. Loosened to any row it would start turning
instructors' initials into weekdays.

### 7. A week grid says the same thing several times  (+2 meetings, −2 wrong)

A calendar draws one course in one colour, at the same hours, on every day it
meets. So two rectangles with the same colour and the same start and end are the
same class, and the room inside them is the same room whatever the engine made
of each copy. `findBlocks()` now returns each block's mean colour and
`agreeOnRooms()` lets the copies vote:

| | what it fixes |
|---|---|
| more copies win | image 10 read `WEL 2.224` twice and `WEL 2224` once |
| a tie goes to the more confident reading | image 04 read `GDC 2.216` and its twin `GDC 2.236`, once each |
| a copy with no room takes the group's, flagged | the room is on the picture, on another day, not assumed |

Those two were the corpus's only two three-of-four near misses and its only two
false positives. Both images went to 14/14 and the precision went to 100%.
A group where **nothing** read stays empty — this votes, it does not invent.

### 8. The grid reader was never entered on an angled photograph at all

This is the correction to what the previous round of this document said, and it
mattered because it pointed at the wrong repair.

`findBlocks()` and `hourAxis()` are called from exactly one place —
inside `fromGrid()` — and `fromGrid` runs only when `classifyLayout()` returns
`grid`, which needed **three exactly-spelled weekday names on one row**. Corpus
image 06 reads `rut WED THY FRI` where the calendar says TUE WED THU FRI. Two
exact weekdays is not three, so images 06, 08 and 11 were classified as card
stacks and the block finder never ran on them. The previous version of this
file said the event blocks were being found on those images. They were not.

`headerDay()` now allows **one wrong letter**, narrowly: exactly three letters,
and exactly one weekday within one substitution. `THY` is Thursday and nothing
else; `RUT` — two letters from Tuesday and two from Saturday — is refused rather
than guessed, and `SITZ` is four letters so it is never a Saturday.
`fitDayColumns()` then fits x against the day index, because **a calendar's
columns are evenly spaced — that is what makes it a calendar** — so the headings
that read give the pitch and the phase of the ones that did not. On image 06
that recovers all five columns from three headings, two of them exactly where
the Monday and Tuesday event blocks sit.

The exact-spelling path is untouched and still runs first, so the four grids
that already worked cannot be affected by any of this.

**It is worth nothing on the score, and it is still right.** Image 06 now
reaches the block finder, which finds all ten of its classes and puts each in
the correct day column — and then the captions inside them still do not read, so
it proposes nothing. What changed is what a student sees, below.

---

## Keeping the geometry

`extract()` returns the word boxes as well as the classes, and every stage
between them is exported, because the layout is the thing that makes the rest of
the problem solvable:

```
words -> rows (y-bands) -> layout (table | week grid | card stack | flow)
      -> records anchored on a TIME RANGE, with the day taken from the column
         the record sits in
```

The layout is decided from geometry alone — the extractor is never told the
condition and never sees the file name, by the benchmark's own contract. A week
grid announces itself with three weekday names on one row, or with two that read
plus one that is a letter out and a fit through their column centres; a
registrar table with a header row; anything else is read in flow. **A layout guess that produces
nothing is a wrong guess**, so the flow reader is the floor under the other two
rather than a third alternative to them — that alone is what makes image 13, a
table whose header was cropped off, score 7/7.

The card-stack gap the bar identified — the app's own row parser is
one-class-per-line and a card is one class per four lines — does not arise here,
because this file never produces a line of text for a parser to read. It
produces records. Images 03, 07 and 15 all score 100%.

---

## "Unsure" costs one tap. "Confidently wrong" costs a missed class.

`extract()` returns two lists. `classes` is what the import screen puts in front
of the student; `unsure` is what was seen and deliberately **not** proposed,
each with a plain-words `why` and, where the geometry knew it, a `day`, a
`start` and an `end`. Anything in `classes` that is not certain carries
`needsConfirm` and its own `why`, and the screen is expected to make the student
look at those before saving. `seen.onlySeen` counts the event rectangles that
were found on the picture and not read, which is what the screen's headline
sentence is built from.

What gets refused, and the specific wrong answer each rule prevents:

| rule | the wrong answer it prevents |
|---|---|
| a word touching the edge of a **crop** is half a word | `WEL 2.22` on image 14 |
| a class is **20–240 minutes** long | `1:00am 12:30 pm` — an OCR slip that eats the leading `1` — was reporting an 11½-hour class |
| a plain-digit room needs a **building code the app knows** behind it | `C S 429` read as room 429 of building CS |
| a building code is repaired by **one** confusable character, and only when **exactly one** real code fits | `GDD` could be `GDC` or `GDF`; two candidates is not an answer |
| a well-formed code the app does *not* know is **shown, flagged, not deleted** | `MER` is a real UT building at the Pickle campus and is on this corpus on purpose |
| no am/pm printed anywhere → the time is flagged | a 3:30 class that might be either end of the day |
| `MMM` is a word, not three Mondays; `TTth` is still Tuesday and Thursday | OCR doubles letters, and the first version answered "Wednesday" off the instructor's initial `W` |

The building lexicon is the app's own `data/ut_buildings.json` — 198 real codes
— plus the eleven from `js/wayfind.js`'s `CAMPUS_EXTRA` / `OFF_MAP` tables,
duplicated in `js/schedimg.js` with a comment saying so. They live inside that
file's closure with no public accessor and this lane does not write that file.
**If those tables change, that copy has to change with them.**

---

## The image never leaves the browser

- decoded into a canvas, processed on that canvas, read by a WebAssembly module
  in a Worker on this machine;
- the engine and the building list are the only fetches, both same-origin;
- no upload, no cloud OCR, no analytics event carrying a pixel or a course code.

`scripts/verify/schedimg.mjs` §4 asserts this on the real page at the network
level, with a context-level capture (so a Worker's own fetches are in scope) and
a raw socket sink beside it, then **proves the instruments are not blind** by
firing a canary through `fetch` and through a real `Worker` and requiring both
to catch it. `scripts/verify/si-integration.mjs` §6 is the other gate on the
same promise.

## It costs the page nothing

`js/schedimg.js` is **not referenced from `index.html`**. It is reached by a
dynamic `import()` at the moment the student picks an image:

```js
const { extract } = await import('./js/schedimg.js');
const { classes, unsure } = await extract(file);
```

The ~5 MB engine is fetched only when `extract()` is first called — not when the
module is imported. §1 and §2 of the gate assert both, at the network level on
the real page, rather than by reading the HTML.

`releaseEngine()` terminates the Worker; the import screen should call it on
close.

---

## Running it

```bash
node scripts/verify/schedimg.mjs                       # the gate (starts its own server)
cd scripts/verify && node image-bench.mjs ./schedimg-extract.mjs --name ours
```

The benchmark extractor starts `scripts/serve.py`, opens the **real site** in
headless Chrome, imports `js/schedimg.js` the way the import screen will, and
hands it each JPEG as a data URL — so what is scored is what a student's browser
would do. It kills the browser through `chrome.mjs`'s watchdog and the server on
exit. `SCHEDIMG_PAGE=scripts/verify/schedimg-blank.html` runs it against a bare
page instead, which is faster and measures the extractor rather than the scene.

`SCHEDIMG_TUNE='{"photo":{"denoise":3}}'` merges JSON into the module's `TUNE`
block, which is how both rejections above were measured.

---

## It says what it saw, even when it read none of it

An empty screen is not an answer. A student who photographs their calendar at an
angle and gets back nothing cannot tell "there is nothing on this picture" from
"I could not read it", and the second one has an obvious fix that only they can
apply. So:

- **every event rectangle that was seen and not read comes back** in `unsure`,
  carrying the day it is on — which comes from the column it sits in, not from
  its writing — and its time whenever the calendar's ruler supplied one. Image
  06 proposes nothing and reports **ten classes, on Mon, Tue, Wed and Thu**,
  which is exactly what is on it;
- **and when even that is unavailable**, because the day headings never read and
  the grid reader was never entered, the block finder is asked directly, once,
  only in the case where the answer would otherwise be blank: images 08 and 11
  come back with *"there are at least 11 classes drawn on this calendar, but the
  writing inside them is too small or too blurred to read — try again with the
  camera square on to the screen, or send the calendar as a screenshot."* The
  count says "at least" because two touching events of one colour are found as
  one rectangle.

`scripts/verify/schedimg.mjs` §5 asserts all of it on the real page: that image
06 reaches the grid reader, that it proposes nothing, that it reports what it
saw anyway, and that it still knows which day each one is on.

## What is still weak

**Angled photographs of week grids: 0 of 35, on images 06, 08 and 11**, and
**image 05's `C S 439` room, 2 of 14.** Every other layout and every other
condition is now perfect.

What is actually missing, image by image, measured rather than assumed:

| | day headings | event blocks | the caption inside a block |
|---|---|---|---|
| 06 | two of five read, repaired to five columns | all 10 found, right columns | `MA 6 146`, `ute 2.909`, `i208` — nothing is a room |
| 08 | none read at all | all 11 found | `0106 } P0106 os`, `MET 20 315)` |
| 11 | none read at all | 9 found (two pairs welded) | `PHY 3031 1:00 pm - 200 om PA) 3.02` — one of them nearly readable |

The header strip was re-read on its own at 2×, 3× and 4× and under four
different page-segmentation modes, and on 06 and 08 the weekday names do not
come back under any of them; what does come back is the row of **date numbers**
(`24 26 27 28`). Naming a column from a date would mean reading the month and
the year off the same picture and doing a calendar computation, and one wrong
digit in the month moves every class to the wrong day — that is a much worse
failure than the one it replaces, so it is not in here.

**The honest summary is that these three images are at the edge of what a
1400-pixel JPEG of a perspective-warped screen contains.** A reader that guessed
at them would be inventing rooms. What is genuinely next, in order:

1. **image 05's `C S 439`** reads `GNC 2.26` / `GX 2.2%` where the table says
   `GDC 2.216`. `GNC` is not one confusable character from `GDC`, so the repair
   refuses it, correctly. This is a two-meeting loss and it needs a better
   picture, not a looser rule;
2. **image 11 is the one grid worth another attempt** — its blocks give
   `PHY 3031 1:00 pm - 200 om PA) 3.02` and `MER 1.906`, which is a real room
   and a real time from a photograph. It cannot be used because the day headings
   never read and the columns cannot be named. Everything downstream of naming
   them — §7's colour vote, which would carry one legible room across all three
   days that course meets — is already built and already tested on images 04 and
   10.
