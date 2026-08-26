# The real corpus — what Simeon's own screenshots teach us

**Date:** 2026-08-26. Simeon supplied **seven real schedule images** after the
photo-import round shipped, in answer to the one thing the independent check
said nobody had: *"all fifteen test images are computer-generated… nobody yet
knows what happens when a real student points a real phone at a real screen."*

He also supplied the context nobody in the round had, and it is the more
valuable half:

> *"people usually look at and have pictures of their schedule from two sources
> — UT registration plus, and myUT course schedule."*

**Two apps. That is the whole population.** Not "any schedule image" — two
specific renderers with two specific layouts. Everything below is read off the
seven images he sent.

---

## 1. The finding that reorders the queue

**Both sources are WEEK GRIDS. Every single one of the seven.**

The shipped reader's known weak spot, named by its own critic at the end of the
extract round, is:

> *"0 of 35 scored meetings on angled photographs of a Google-Calendar-style
> week grid — plausibly the single most common real capture a student will
> actually take."*

That critic was guessing about what students capture. Simeon has now answered
it, and the answer is worse than the guess: it is not *one common* capture, it
is **the only shape either source produces**. The synthetic corpus scored
**52/52** on its clean single-column registrar tables — a layout that, on this
evidence, **no real student ever photographs**.

**So the 131/171 headline is measured on a distribution that does not exist.**
The number is honestly computed and the corpus is honestly labelled; it is the
*relevance* that is wrong, not the arithmetic. Nothing about the reader is known
to work on the real thing until it is run against these seven.

Do not re-derive this. It is the reason the next round exists.

---

## 2. The two layouts, in detail

### A. UT Registration Plus (four of the seven)

Coloured blocks on a Mon–Fri grid, hour rows down the left. A block is:

```
C S 311 – Parikh          <- course code, en-dash, instructor surname
9:30am – 11:00am          <- time range, en-dash, lowercase am/pm
PHR 2.108                 <- building code, space, room
```

Three lines, and the third line is what we want. Variations seen across the four:

- **Time and room share a line** when the block is short:
  `11:00am – 12:00pm, GDC 2.216` — comma-separated, *one* line, not two.
- **Header carries a total**: `11 HOURS  4 COURSES`, `15 HOURS  4 COURSES`,
  `39 HOURS  14 COURSES`. A free integrity check — if we place a number of
  distinct courses that disagrees with that count, we are wrong and can say so.
- **A dense schedule truncates with an ellipsis**: `S W 310, 37220 – Wh…`,
  `LEB 320, 64530 – Quin…`. The course code survives; the instructor does not.
  Never try to recover a truncated name.
- **Unique numbers appear** in the dense variant: `PED 106C, 45672 – R…`,
  `BIO 311C, 23054 – Fritz`. A five-digit number after the course code is a
  registration unique, not a room.
- **Non-class blocks exist and must be ignored**: `Dell Med Work`,
  `Lunch`, `Longhorn Developers Me…`. They have times and grid positions and
  look exactly like classes. They have **no building code**, which is the tell.
- **An ASYNC / OTHER row sits below the grid** with classes that have *no time
  and no day at all*: `GOV 312L, 78430 – Barrymore`, `PSY 317L, 45320 – Etz`.
  These cannot be walked to and must be reported as such, not dropped.
- **Legend chips** (`WAITLISTED`, `CANCELLED`, `CLOSED`) sit on the same row and
  are not classes.
- Both **light** (white page, coloured blocks, dark text) and **dark** app
  chrome appear.

### B. myUT "My Class Schedule" (three of the seven)

Beige/grey cells, thin dotted hour rules, a **SAT column**, orange underlined
course links. A cell is:

```
GOV 370S      <- course code, underlined link, orange
MEZ           <- BUILDING CODE ON ITS OWN LINE
B0.306        <- ROOM ON THE NEXT LINE
```

**This is the single most important structural difference and the shipped
reader has never seen it.** The synthetic corpus always wrote `PAI 3.02` as one
token. myUT splits building and room across two lines, and in the phone-width
variant it splits the *course code* too:

```
UGS
303
UTC
3.134
```

Four lines, one class. A reader that pairs "the token after the course code" as
the building will get `303` as a building. Also seen:

- **A cell with a building and no room at all**: `UGS 018 / EER`,
  `G E 107C / EER`, `UGS 303 / JES`. Real, common, and correct — some rooms are
  simply not published. Must not be treated as a failed read.
- **A room with a letter-digit floor**: `MEZ B0.306` — a basement. `B0` is not
  a typo and not an OCR error.
- **Times in the compact form** `10:00-11:00AM` — a hyphen, no spaces, one
  am/pm marker for the pair, uppercase.
- **A time-free variant**: one of the three shows a course table
  (`Course | Course Title | Instructor Name | College Unit Code`) *above* the
  grid. Header text that is not a class.
- **Saturday exists** as a column and is usually empty, tinted pink.

---

## 3. Consequences for the reader — the work this creates

1. **Multi-line building/room pairing.** The extractor keeps geometry, which is
   what makes this recoverable, but nothing currently pairs a bare building code
   on one line with a bare room on the next *inside the same cell*. This is the
   first fix and probably the largest single gain.
2. **Week-grid day assignment must work under perspective.** Day comes from
   which column a block sits in. Under a phone-camera warp the columns are not
   axis-aligned, and the current code gives up. This is the 0-of-35 failure.
3. **A block without a building code is not a class.** `Lunch`, `Dell Med Work`
   and `Longhorn Developers Meeting` will otherwise become classes with invented
   locations — the exact defect this feature promised not to have.
4. **The header count is a free check.** `4 COURSES` on the page and five
   distinct course codes read means a misread, and the app can say so.
5. **The ASYNC/OTHER row needs its own answer**, the way MER at Pickle got one:
   named, explained, not silently dropped.
6. **Room-less classes are a valid outcome**, not a failure. Route to the
   building's door and say the room is not published.

---

## 4. What is still needed before any of this can be scored

The seven images were sent in conversation and **are not on disk**, so nothing
here has been run yet. They need to land in the repo before the next round can
measure anything.

**PRIVACY, and it is not optional.** One of the three myUT images shows
**Simeon's full name, his EID and his classification** in the "My Information"
panel. This repo is public. That image must be **cropped to the schedule grid
before it is committed**, or kept out of the tracked tree entirely. The same
check applies to every image before it lands: read it, then crop it.

Once they land: build `truth.json` from the images at full resolution — **not**
from a description of them — extend `scripts/verify/image-bench.mjs` to score
the real set separately from the synthetic one, and report the two numbers side
by side without averaging them together. The synthetic number stays for
regression; the real number is the one that means anything.
