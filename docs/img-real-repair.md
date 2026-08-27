# The real-corpus repair — 16 of 95 to 86 of 95, and why it did not ship

**Date:** 2026-08-26. Ship lane, docs only. The code being described lives on
`acer/img-rooms`, which is **not merged and is left open on purpose**. Companions:
`docs/img-real-baseline.md` (the first real measurement, the 16/95) and
`docs/img-real-corpus.md` (what the two source apps actually look like).

**Nothing below quotes a course, a room, an hour or a name from Simeon's
screenshots.** The images and their answer key are gitignored and stay that way.
Failures are described by shape. Every literal in this file is invented and was
grepped against `scripts/verify/schedule-images/real/truth.json` before it was
written — which is exactly the check that this round proved is not optional. See
§4.

---

## 1. The two numbers, before and after

Both corpora, same scorer (`scripts/verify/image-bench.mjs`), same rules, one
browser harness at a time.

```
                          all four right   predictions   wrong answers
  real, 7 images          16 / 95 -> 86 / 95    25 -> 87      9 -> 0
  synthetic, 15 images   134 / 171 unchanged   136 -> 136     0 -> 0
```

By source app, across the whole round: **UT Registration Plus 16/51 -> 43/51**,
**myUT 0/44 -> 43/44**. The one crop-cut optional meeting went **0/1 -> 1/1**.

(Those two split the 95 between them, and they are the whole population — Simeon
said so, and all seven images bear it out. The intermediate figures quoted in
`HANDOFF.md` §195-196 are per-commit steps within the round, not this table's
endpoints; myUT was at 41/44 and Registration Plus at 18/51 when the last fix
landed.)

**Read the wrong-answers column first.** It is the only column this feature was
ever sold on. The baseline had **9 wrong answers out of 25 predictions, 4 of them
saved silently at full confidence** — the first inventions this feature had ever
produced. There are now **zero**, across 87 predictions, and recall went up at
the same time rather than being traded away for the precision.

**The synthetic corpus did not move.** 134 of 171, 136 predictions, 0 wrong,
per-image table identical row for row. That is the regression guard doing its
job: a fix aimed at two real apps did not cost anything on the fifteen invented
images.

**How the "after" column was verified, because on this feature the number is the
whole claim.** The ship lane re-ran the real corpus itself on the branch tip,
twice, interleaved with nothing else — `python scripts/serve.py 8937` (never
`python -m http.server`, which ignores `Range:`), `SCHEDIMG_BASE` pointed at that
port, one browser harness at a time. **Both runs came back byte-identical,
per-image table included.** The `false+ 0` column holds on *every individual
image*, not merely in aggregate — which is the form of the claim that matters,
since an aggregate zero can hide one image inventing and another declining.

**Which figures this lane measured and which it did not, stated plainly.** The
real-corpus "after" row is this lane's own, twice. The **synthetic row is not**:
it is the branch's record, corroborated by two independent re-runs in the
verification round that each ran it twice with identical results. This lane
started its own synthetic re-run and it had not finished when this was written —
the machine was sharing a CPU with an unrelated heavy Chrome, and the room fix
below made every OCR pass slower. Since the branch is not being merged, the
regression guard is not load-bearing for any decision here; it is context. If you
are the lane that rebuilds this branch, **re-run the synthetic corpus yourself
before merging** rather than inheriting this row.

### What "86 of 95" is and is not

It is `js/schedimg.js` driven directly (`scripts/verify/schedimg-extract.mjs`) —
**the reader's ceiling**, not what lands on the phone. The end-to-end number
(the real UI, a simulated student who answers no question at all) was **not
re-measured on the real corpus this round**, because `img-import-extract.mjs`
hardcodes its image URL and ignores `--dir`. That gap is real and is written up
as R7; it is the one number in this file nobody has.

---

## 2. Where the 70 meetings came from — three causes, in order of size

**One.** *myUT was returning nothing at all, and the block finder was the reason.*
myUT draws an HTML table with a thin rule between every cell. Every cell touches
a rule, so the flood fill welded the entire table into one page-sized component,
found it was 6% of its own bounding box, and discarded it. Two of three real
myUT screenshots returned literally nothing — no classes and no "could not read
this" either — from a page a person reads at a glance. The fix reads the ruled
grid as a grid. **0/44 -> 41/44.**

The correction inside that fix is the part worth keeping: a rule is **a ridge** —
darker than the picture a few pixels to *each* side — not "a pixel far from the
page colour." Under the second definition every tinted cell answers yes, and a
today-column tint came back as one enormous rule that swallowed the two real
rules on either side of it.

**Two.** *UT Registration Plus draws both polarities on one page.* `photo.grayMode`
has to choose one polarity for a whole image. It chooses `min(R,G,B)`, which is
what keeps white type legible on a dark saturated block — and that app puts a
dark fill with white type beside a light fill with near-black type. Half the page
was being read against the wrong background, and the rooms were the field that
lost. The classes were never missing: they were placed in the right day column at
the right hour off the ruler and then *declined* because the room could not be
read. One field short, not lost. **18/51 -> 43/51.**

**Three.** *The course code was being read as the building* — 4 of the original 9
wrong answers, 3 of them silent. `locFromWords()` walked a block left to right
and returned the first adjacent pair that looked like a location, and a block's
first line is its course code. **Seven UT department prefixes are also real
building codes**, intersected against `data/ut_buildings.json`. Nothing
downstream could catch it, because the building *was* real — the lexicon scored
it 1.00 and `neighbourDoubt()` was never reached. The fix finds the course code
*first* and excludes its words from location matching.

That third one is the shape to remember: **a wrong answer made entirely of real
parts.** Every guard in the pipeline is a plausibility check, and a plausibility
check cannot see it.

---

## 3. What is still weak

- **One dense screenshot is very nearly the whole remaining gap.** Nine meetings
  are still missed and **eight of them are on that single image**, which scores
  4 of 12; the ninth is one meeting on one other image. Its shape — many short
  blocks packed tight, several clipped by the page edge — is what the geometry
  is worst at. **It contributes 0 false positives**, so the failure is a decline,
  not an invention: on that image the reader says nothing rather than guessing.
  Six of the seven images score above 92%, and five of them are perfect.
- **The end-to-end number on real images does not exist** (R7, above).
- **No camera photograph has ever been tested.** All seven real images are clean
  screenshots — no angle, no glare, no dark mode. The reader's known worst case
  is an angled photo of a week grid, and nobody has one. This is still the
  highest-value thing to ask Simeon for.
- **Cost:** the room fix slowed real-image OCR from ~47 s to 79-107 s per image.
  That is fine for a benchmark and is worth watching on a phone.

---

## 4. Why it did not ship

**A leak in the branch's history, not anything about the score.** Commit
`2de2013` copied a five-digit registration number out of one of the seven images
into `scripts/verify/schedimg.mjs` as test-fixture data. Commit `e3878dd`
replaced that line with invented values one commit later — the branch caught
itself — **but the commit remains, and merging is what would put it on `main`.**
It is reachable only from this branch today.

Full write-up, with the method for reproducing the check and the two false alarms
it cleared: `QUEUE.md` §R0. A second leak that the first scrub missed entirely,
live in `main`'s current tree, is §R0b.

**The lesson, in the form that would have prevented it.** The rule was already
written down — invent your literals, and grep each one against `truth.json`
before you commit. It was written *by the same round that then broke it twice*,
and the second break was in the scrub commit that announced the rule.

Both breaks have the same shape. The grep was run over the literals that **look**
personal — names — and not over the ones that are just as personal but look like
data: a five-digit registration number, a two-character truncation, a room, the
name of the place someone works. A rule that depends on noticing which literals
are sensitive is not a rule; it is the same judgement call that already failed,
applied one layer up. **The grep is over every literal a change introduces, or it
is not a check.**

This lane ran that check over its own output before committing, and it caught two
real building-and-room pairs that had been written into this round's drafts while
*explaining the leak*. They were removed before the commit. That is the check
working, and it is the only reason to trust anything above.
