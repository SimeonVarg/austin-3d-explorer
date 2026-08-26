# The first real measurement — seven screenshots, taken by a student

**Date:** 2026-08-26. Docs only; no application code was touched in this round.
Companion to `docs/img-real-corpus.md`, which is the brief. This is the score.

Every number below was produced by the repo's own scorer,
`scripts/verify/image-bench.mjs`, against an answer key transcribed from the
seven images at full resolution by two independent readers and checked by a
third. **The images and the key are gitignored on purpose and stay that way** —
a class schedule is a record of where a named student is at a given hour and
this repo is public. Nothing below quotes a course, a room or an hour from
them. Failures are described by *shape*.

---

## 1. The two numbers

| | scored meetings | all four fields right | precision | wrong answers |
|---|---|---|---|---|
| **synthetic**, the reader's ceiling | 171 | **134** — 78.4% | **100.0%** | **0** of 136 |
| **synthetic**, what lands on the phone | 171 | **131** — 76.6% | **100.0%** | **0** of 133 |
| **real**, the reader's ceiling | 95 | **16** — 16.8% | **64.0%** | **9** of 25 |
| **real**, what lands on the phone | 95 | **16** — 16.8% | **72.7%** | **6** of 22 |

"The reader's ceiling" is `js/schedimg.js` driven directly
(`scripts/verify/schedimg-extract.mjs`). "What lands on the phone" is the whole
shipped import — the real UI, a simulated student who answers **no** question at
all, scored on what is in the store afterwards. The published `131/171` headline
is that second row.

Three of the four rows were run for this document, one after another on a quiet
machine, same scorer, same rules, same tree (`af93a32`, working tree clean,
`git diff origin/main` empty for the module, the scorer and the corpus). **Row 2
is quoted from the previous round, not re-measured here** — it is the one figure
below that this lane did not produce itself.

**Read the last two rows together, because they say two things at once.**

- **The confirm screen threw nothing good away.** 16 correct readings in, 16 out.
  On real images the refusal machinery is not over-refusing.
- **And it caught only a third of the bad ones.** 9 wrong readings in, **6 still
  land on the device** — for a student who answers nothing. **At least four of
  those six were never flagged at all** (`needsConfirm: false`, full confidence),
  so they commit by definition and no question could have saved them.

### The comparison that actually matters

The synthetic corpus is sorted into four conditions. Its clean-screenshot
condition — four images, no camera, no dark mode, no crop — scores **52 of 52,
100%**.

**All seven real images are clean screenshots.** No camera, no angle, no glare,
no dark mode. Same condition. So the honest side-by-side is:

```
  clean screenshots, invented by us     52 / 52     100.0%
  clean screenshots, taken by a student 16 / 95      16.8%
```

That is the finding. It is not "real photos are harder than fake ones" — no
photograph was involved on either side. It is that the fifteen images were
authored by the same people who wrote the reader, and they encode assumptions
the two real apps do not honour.

---

## 2. Precision is the finding, not recall

A low score with nothing wrong is a good result for this feature. That is the
whole premise: an import that confidently invents a room walks a student to the
wrong side of campus, and refusing costs one tap.

**That property did not survive contact with real images.**

- Synthetic: 136 predictions, **0 wrong**, 100.0% precision. Held across two
  full passes in an earlier round and again here.
- Real: 25 predictions, **9 wrong**, 64.0% precision.
- **4 of the 9 were committed silently** — `needsConfirm: false`, full
  confidence, no question, no chip to tap. The other 5 were flagged.
- Through the shipped UI with a student who answers nothing, **6 of the 9 still
  reach the device.** The confirm screen catches three and no more.

All nine are on one image (§4). That concentration is itself the story: the
image is a dense schedule of the kind the app has never been scored on, and one
image is enough to take precision from perfect to two-thirds.

### Do not quote "0 hallucinations" on the real corpus

The scorer counts a *hallucination* as a prediction naming a real meeting of
the schedule that is not on this particular image. It reads that from each
image's `notOnImage` list. **Four of the seven real images are frame-cropped and
their off-window content is genuinely unknown**, so every `notOnImage` list in
the real key is empty — not because nothing is off-image, but because nobody
can enumerate it. The hallucination counter therefore has nothing to match
against and returns 0 by construction. It is not evidence and it must not be
reported as a clean sheet. **The 9 wrong answers are the number.**

---

## 3. Per image

Images are named by source app and variant only.

| image | source app | scored | right | wrong answers |
|---|---|---|---|---|
| 1 | UT Registration Plus, compact chrome | 14 | 5 (35.7%) | 0 |
| 2 | UT Registration Plus, full chrome | 10 | 3 (30.0%) | 0 |
| 3 | myUT, desktop, scrolled | 13 | 0 | 0 |
| 4 | UT Registration Plus, dense (14 courses) | 12 | 0 | **9** |
| 5 | UT Registration Plus, minimal chrome | 15 | 8 (53.3%) | 0 |
| 6 | myUT, phone width | 16 | 0 | 0 |
| 7 | myUT, desktop | 15 | 0 | 0 |
| | | **95** | **16** | **9** |

Image 2 also carries one optional meeting cut by the frame edge, which costs
nothing to miss and was missed.

## 4. Per source app

```
  UT Registration Plus   (4 images)   16 / 51   31.4%    9 wrong of 25 predictions
     ...its three ordinary images     16 / 39   41.0%    0 wrong of 16 predictions
     ...its one dense image            0 / 12    0.0%    9 wrong of  9 predictions
  myUT "My Class Schedule" (3 images)  0 / 44    0.0%    0 predictions of any kind
```

`docs/img-real-corpus.md` predicted myUT would do "much worse". It was right
about the direction and wrong about the reason, and the difference matters for
what gets fixed. It expected the reader to struggle with myUT's habit of
splitting a location across two lines. **The reader never got that far.** On
two of the three myUT images it produced no classes *and no "couldn't read
this" entries either* — total silence, a blank screen with no explanation, on a
page whose text is large, black, high-contrast and trivially legible to a
person.

The two failures do not look alike up close, and the split is worth keeping:

- **UT Registration Plus fails by declining.** It finds the class rectangles,
  puts each on the right day and reads the right start and end off the hour
  ruler, and then cannot read the room. It says so.
- **myUT fails by never starting.** No rectangles, no rows, no message.

---

## 5. Where the losses are — three mechanisms, each with a file and a number

### M1 — myUT's ruled borders weld every cell into one blob. 0 of 44.

**The first version of this section said the cause was a threshold, and it was
wrong.** The threshold was measured, A/B'd, and cleared. What follows is what
the instrumented block finder actually reports. It is written this way on
purpose: the wrong answer was plausible, cheap to believe, and would have cost
the next lane a round.

`findBlocks()` (`js/schedimg.js:1592`) turns a page into class rectangles in
three steps: mark a pixel "on" if its colour is further than
`TUNE.grid.bgDistance` (**58**) from the page's median colour; flood-fill
neighbouring on-pixels into components, joining any two within
`TUNE.grid.colourJoin` (**42**) of each other; then keep a component only if it
is at least `minAreaFrac` of the page **and at least `minFill` (0.72) of its own
bounding box** — "a block is a rectangle".

A probe reimplementing that loop with counters, run on the rectified pages:

```
                        on-pixels  components  too small  not a rectangle  KEPT
  UT Reg Plus image        19.7 %      6 294      6 279          1          14
  myUT, phone width        12.0 %     13 172     13 170          1           1
  myUT, desktop             6.1 %     10 353     10 350          2           1
  myUT, desktop (other)    12.0 %     14 180     14 178          2           0
```

**14 kept on the UT Registration Plus page, and that image has exactly 14 class
blocks.** On that app the finder is not approximately right, it is exactly
right. On all three myUT pages it keeps at most one thing, and that thing is not
a class.

The reason is the third step, not the first. myUT draws **ruled borders between
its cells**, and those rules are further from white than the cells are. So the
rules are "on" at any threshold, every cell touches a rule, and `colourJoin`
welds the entire table into **one page-sized component** — bounding box 679×900
inside an 831×900 analysis image — whose fill is **0.06**, far under the 0.72 a
rectangle needs. It is discarded, and the individual cells were never available
to be kept in the first place.

**Lowering the threshold does not help, and this was measured twice.** Dropping
`bgDistance` from 58 to 24 makes the cells "on" (on-pixels go 12% → 39%) and the
kept count does not move: still 1, 1 and 0. Scored across the whole real corpus
at `bgDistance: 24` the result is **identical to three significant figures — 16
/ 95, 25 predictions, 9 wrong, and the same seven per-image rows.** Nobody
should spend a round on that constant.

This is also why two myUT images emit no error message at all: the "I can see
classes here and could not read them" fallback (`js/schedimg.js:2341`) calls the
same `findBlocks()` and needs `minBlocksToMention` (2) rectangles to speak. It
gets one and zero.

**So the fix is not a constant, it is a second segmentation path.** The rules
that defeat the flood fill are the same rules that make this page trivially
easy: a ruled table hands you the cell boundaries directly. Detect the
horizontal and vertical rules and cut on them, rather than trying to find solid
colour rectangles that this app does not draw.

### M2 — with no weekday header row in frame, the day is unrecoverable. 29 of 44.

`classifyLayout()` (`js/schedimg.js:1076`) decides a page is a week grid **only
by reading weekday words**: three that read cleanly, or two plus a column fit.
There is no fallback to column position. Two of the seven real images are
scrolled or cropped such that **the day header row is not in the frame at all**
— one of them has no chrome whatsoever, just grid. Both are classified `cards`,
which routes to a reader that looks for a day *word* inside each cell, and both
report "no day was readable" for every class whose location it did in fact
recognise internally.

Those two images are 29 of the 95 scored meetings. The third myUT image *does*
have its header row and *is* correctly classified as a grid — and still scores
zero, because M1 leaves it with no rectangles to place. **Neither fix works
alone on this app: M1 without M2 rescues one image, M2 without M1 rescues none.**

**This is not the item QUEUE.md already refuted.** That entry ("do not build
this") is about clustering block x-centres to *rescue an angled photo whose day
headers already read*. This is the different case where the header row is not on
the picture at all, and the answer key's own human readers solved it exactly the
way the code cannot: by counting six equal columns and mapping them Mon–Sat.

### M3 — the course code is read as the location. 4 wrong answers, 3 of them silent.

`locFromWords()` (`js/schedimg.js:1446`) walks a block's words **left to right**
and returns the first adjacent pair that looks like a location, where "looks
like" is `plausibleLoc()` (`:1440`): a code the register knows, or anything with
a dot in the room.

A UT Registration Plus block's **first** line is the course code. When a course's
department prefix happens to also be a real building code, the title line
matches before the real location line is ever reached, and the result passes
every downstream guard — the code is real, so the lexicon scores it 1.00, so
nothing asks. On the dense real image this fires **four times**; three of the
four are committed at full confidence with no question at all, pointing at a
real UT building that is not theirs. (The fourth is flagged only because its own
copy of the caption was unreadable and the room was borrowed from another day —
the wrong location itself raised no doubt.)

The collision is not a freak. Intersect a list of UT department prefixes with
this repo's own register (`data/ut_buildings.json`, 198 refs) and **at least
seven prefixes come back as real building codes** — a one-line check, and worth
re-running rather than taking on trust, since the exact set is what a fix has to
survive.

This is the same *class* of defect as IMG0 (a real-but-wrong building committed
silently) reached by a completely different route, and it is the one that should
frighten us: the safety net catches invented codes and cannot catch this.

### The rest of the nine

Three more shapes, all on the same dense image:

- **Two are a real class whose room lost its decimal point and whose time drifted
  45 minutes.** One of the two is silent — the fourth and last of the silent
  ones. The other was flagged, and the reason text it printed is the interesting
  part: it says in so many words that the caption reads one time and the
  rectangle is drawn at another, **and then it used the rectangle**. That
  preference is backwards when the caption parses cleanly.
- **Two are one building letter misread into a code that does not exist.** The
  app caught that and asked — the safety net working exactly as designed. They
  still score as wrong answers because the time was off as well.
- **One is a location, a day and a time invented for a class that has none
  printed.** That app puts unscheduled and asynchronous courses in a strip below
  the grid with no day, no time and no room anywhere on the page. The reader gave
  one of them all four. It flagged the building as unknown, so the student would
  be asked — but it was still returned.

Running through all of them on that image: **times come out 15 to 45 minutes
late**, consistently.

---

## 6. What went right, and should not be lost in the noise

- **Nothing crashed.** Seven for seven, no throw, no timeout, including a
  `.webp`, which is a file type the corpus had never contained.
- **Non-class blocks were correctly ignored.** The dense image carries six
  personal, non-class blocks that look exactly like classes — same rectangles,
  same times, same grid positions. **None of them appears anywhere in the
  output.** `docs/img-real-corpus.md` named this as a thing that would break and
  it did not.
- **Day and time from geometry works.** On the three ordinary UT Registration
  Plus images, every block the reader saw was put in the correct day column and
  given the correct start and end from the hour ruler. Where those images lose,
  they lose the *room* and nothing else.
- **Refusal still works where it is reachable.** The three ordinary UT
  Registration Plus images produced **16 predictions and all 16 were exactly
  right**. The other 23 meetings on those pages were declined, in words, rather
  than guessed at. Zero wrong answers across all three.

---

## 7. What this measurement does NOT cover — read this before quoting it

1. **No camera.** All seven are clean screenshots. The known 0-of-35 weakness on
   angled photographs of a week grid is **untested on real data** and remains
   exactly as unknown as it was. Do not let "we measured on real images" stand
   in for it.
2. **No dark mode.** Both apps ship a dark chrome; neither is in the corpus.
3. **One student, one term, two apps.** Seven images is a floor, not a
   distribution. Two of the three behaviours the corpus doc predicted for UT
   Registration Plus (the async strip, the non-class blocks) are exercised by
   **one image each**, so those two results will move on a single frame. Report
   them per-image, never averaged.
4. **The answer key infers day on 29 of 95 meetings.** Two images have no
   weekday header in frame, so their day column mapping is reasoned from column
   count, occupancy pattern and a same-term image that *does* carry headers. It
   is well cross-checked and it is still an inference. If a future reader
   disagrees about days on those two, re-litigate the column mapping before
   concluding the reader is wrong.
5. **Four images are frame-cropped**, so off-window content is unknown and
   hallucination cannot be scored — see §2.

---

## 8. Corrections to `docs/img-real-corpus.md`

The brief was written from the images before they were on disk. Four of its
structural claims are wrong at the pixel level, and two of them would send the
next lane in the wrong direction. The brief stands otherwise.

1. **The tinted column is a today-highlight, not Saturday.** The brief says
   myUT's Saturday column is "usually empty, tinted pink". In one image the
   tinted column is indeed the sixth. In another it is the **fourth of six**, a
   weekday, and it has classes in it. Every myUT image tints exactly one
   full-height column and it is a different weekday in each. A reader that uses
   the tint to find Saturday will assign the wrong day to a whole image.
2. **The building/room line split is a wrapping artefact, not a myUT layout
   rule.** The brief calls the split "the single most important structural
   difference". At desktop width myUT writes the location on **one** line,
   exactly like the synthetic corpus — and one myUT image prints both forms, in
   the same column at the same width, purely because one string is longer. There
   is no myUT branch to write; there is one cell grammar that has to accept both.
3. **Two of the three myUT images print no time inside the cell at all.** The
   brief documents myUT's compact time form and flags the time-free variant as
   the exception. It is the majority. On those pages the time exists only as the
   rectangle's extent against the hour ruler.
4. **The "N HOURS" half of the header total is semester credit hours, not
   meeting time**, and it will not reconcile against a grid. The "N COURSES"
   half is a real free check but only in one direction: reading *more* distinct
   courses than the header claims is proof of a misread; reading *fewer* may
   just mean the async strip is scrolled horizontally, which it can be.

Two more things a reader has to survive, neither of which is in the brief:

5. **The hour label sits below its own rule**, by about 18 px in both myUT
   images, not on it. Getting this backwards shifts every class by exactly 30
   minutes and still produces clean, plausible-looking times — a silent whole-
   image loss that will not look like a bug.
6. **A block can print its location line twice**, identically. A reader that
   pairs location lines will emit two meetings for one class.

## 9. One register gap

The seven images between them name **23 distinct building codes**. Checked
programmatically against `data/ut_buildings.json` (198 refs): **22 are in the
published register and one is not.** That one exists only in the extras table
inside `js/wayfind.js` (line 2667) and is a real, currently-taught building.
Anything that validates a read against `ut_buildings.json` alone will reject a
correct reading of a real building — a 1-in-23 false-refusal rate on this
sample.

---

## 10. How to re-run this

```
python scripts/serve.py <PORT>          # never python -m http.server

# the reader's own ceiling
SCHEDIMG_BASE=http://127.0.0.1:<PORT> \
node scripts/verify/image-bench.mjs ./scripts/verify/schedimg-extract.mjs \
     --dir scripts/verify/schedule-images/real --name ours-real

# the same reader on the synthetic corpus, for the side-by-side
SCHEDIMG_BASE=http://127.0.0.1:<PORT> \
node scripts/verify/image-bench.mjs ./scripts/verify/schedimg-extract.mjs \
     --name ours-synth

# what actually lands on the phone, through the real UI
node scripts/verify/image-bench.mjs ./scripts/verify/img-import-extract.mjs \
     --dir scripts/verify/schedule-images/real --name shipped-real
```

**That last command does not work as written today, and it fails loudly rather
than quietly, which is the only good thing about it.**
`img-import-extract.mjs:166` builds the image URL from a **hardcoded**
`/scripts/verify/schedule-images/` and ignores `--dir` entirely, so every real
image comes back 404 and all seven rows read `EXTRACTOR THREW`. The number in §1
was produced with a `_`-prefixed scratch copy of that file with the one path
changed, which was deleted afterwards. Making line 166 derive its URL from the
`--dir` the bench was given is a two-line fix and belongs to whoever next opens
that file — until then the shipped-import number cannot be re-measured on the
real corpus without repeating the workaround.

**The answer key was round-tripped through the scorer before any of this was
believed**: an oracle that returns the key's own rows scores **95 / 95 at 100.0%
precision**, so 16/95 is the reader's number and not a scoring artefact. Note
that `image-bench.mjs --selftest` reports failures against this corpus — they
are its own `asUt()` reshaping helper mangling a meeting that has a building and
**no room**, a shape the synthetic corpus never contained and the real one does.
That is a limitation of the self-test's synthetic reshaping, not of the scorer or
the key, and the direct round-trip above is the check that settles it.

Run them one at a time. Two of these harnesses driving headless browsers on the
same machine at once takes both past `chrome.mjs`'s 30-minute watchdog and kills
them mid-corpus; that happened once while producing this document and cost a
full run.

**The block-finder numbers in §5 M1 came from a scratch probe, and it is worth
rebuilding rather than trusting this file.** `js/schedimg.js` publishes its whole
pipeline on `window.SCHEDIMG` (`:2404`) — `decode`, `findDocQuad`, `rectify`,
`findBlocks`, `TUNE` and the rest — precisely so a verify script does not have to
guess which stage produced a defect. Import the module into the page with
`schedimg-extract.mjs`'s exported `session()` and `importModule()`, rectify each
image, then run your own copy of the `findBlocks` loop with counters on
components / too-small / not-a-rectangle / kept. The whole probe is about forty
lines and it is what turned a wrong diagnosis into the right one.

**A worked lesson, recorded because it nearly shipped.** The first draft of M1
blamed `TUNE.grid.bgDistance`. The pixel measurement supporting it was correct —
myUT's cells really are 30–44 from a white page against a threshold of 58 — the
*inference* was not. Two checks killed it: sweeping the threshold from 58 down to
10 and watching the kept-rectangle count not move, and rescoring the whole real
corpus at 24 for a byte-identical result. **A measured constant plus a plausible
story is still a guess.**

---

## 11. The one-line answer to the question that started this

*Do these images help?* Yes — they are the most valuable thing anyone has added
to this feature. They turned a 78% into a 17% and a perfect precision record
into a two-thirds one, and every one of the three mechanisms behind that is
named, located to a line, and reproducible from a forty-line probe. **None of it
was visible from inside the fifteen images we made ourselves** — and one of the
three had a wrong, plausible, pixel-supported explanation until the images were
there to test it against.
