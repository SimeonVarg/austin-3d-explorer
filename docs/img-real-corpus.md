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

> **Every example in this section is INVENTED.** The seven images are a record
> of where a named student is at a given hour, they are gitignored for that
> reason, and this file is public — so nothing below is copied out of them. Each
> sample reproduces the *shape* of what the app prints (how many lines, what
> separates them, what a field looks like) with made-up codes, rooms, surnames,
> uniques and hours. The structure is the finding; the letters never were.
>
> This paragraph is here because the first draft of this file did not do that,
> and the real strings sat in public git history until they were scrubbed. If
> you extend this section, invent your examples and check them: grep each new
> literal against `scripts/verify/schedule-images/real/truth.json` first. A hit
> is a leak, and history keeps it.

### A. UT Registration Plus (four of the seven)

Coloured blocks on a Mon–Fri grid, hour rows down the left. A block is:

```
D R 347 – Ashford         <- course code, en-dash, instructor surname
8:15am – 9:45am           <- time range, en-dash, lowercase am/pm
VNH 4.117                 <- building code, space, room
```

Three lines, and the third line is what we want. Variations seen across the four:

- **Time and room share a line** when the block is short:
  `11:00am – 12:00pm, KTM 5.309` — comma-separated, *one* line, not two.
- **Header carries a total**, in the form `N HOURS  M COURSES`. Three different
  totals appear across the four images, the largest of them fourteen courses. A
  free integrity check — if we place a number of distinct courses that disagrees
  with that count, we are wrong and can say so.
- **A dense schedule truncates with an ellipsis**: `Q V 310, 60318 – Delacr…`,
  `TAQ 320, 37904 – Ashf…`. The course code survives; the instructor does not.
  Never try to recover a truncated name.
- **Unique numbers appear** in the dense variant: `HCF 208B, 51840 – T…`,
  `DRV 355, 19274 – Halloran`. A five-digit number after the course code is a
  registration unique, not a room.
- **Non-class blocks exist and must be ignored** — a job shift, a meal, a
  student-organisation meeting. They have times and grid positions and look
  exactly like classes. They have **no building code**, which is the tell.
- **An ASYNC / OTHER row sits below the grid** with classes that have *no time
  and no day at all*: `PYX 312L, 25683 – Halloran`, `VNH 317L, 82461 – Vance`.
  These cannot be walked to and must be reported as such, not dropped.
- **Legend chips** (`WAITLISTED`, `CANCELLED`, `CLOSED`) sit on the same row and
  are not classes.
- Both **light** (white page, coloured blocks, dark text) and **dark** app
  chrome appear.

### B. myUT "My Class Schedule" (three of the seven)

Beige/grey cells, thin dotted hour rules, a **SAT column**, orange underlined
course links. A cell is:

```
PYX 370S      <- course code, underlined link, orange
KTM           <- BUILDING CODE ON ITS OWN LINE
B0.412        <- ROOM ON THE NEXT LINE
```

**This is the single most important structural difference and the shipped
reader has never seen it.** The synthetic corpus always wrote a location as one
token. myUT splits building and room across two lines, and in the phone-width
variant it splits the *course code* too:

```
DRV
303
VNH
4.208
```

Four lines, one class. A reader that pairs "the token after the course code" as
the building will get `303` as a building. Also seen:

- **A cell with a building and no room at all** — a bare three-letter code on
  its own, three times across these images. Real, common, and correct: some
  rooms are simply not published. Must not be treated as a failed read.
- **A room with a letter-digit floor**, of the form `B0.412` — a basement. The
  leading `B0` is not a typo and not an OCR error.
- **Times in the compact form** `10:00-11:00AM` — a hyphen, no spaces, one
  am/pm marker for the pair, uppercase.
- **A time-free variant**: one of the three shows a course table
  (`Course | Course Title | Instructor Name | College Unit Code`) *above* the
  grid. Header text that is not a class.
- **Saturday exists** as a column. (See `docs/img-real-baseline.md` §8 — the
  tinted column is a today-highlight, not Saturday, and this file said otherwise
  before the images were on disk.)

---

## 3. Consequences for the reader — the work this creates

1. **Multi-line building/room pairing.** The extractor keeps geometry, which is
   what makes this recoverable, but nothing currently pairs a bare building code
   on one line with a bare room on the next *inside the same cell*. This is the
   first fix and probably the largest single gain.
2. **Week-grid day assignment must work under perspective.** Day comes from
   which column a block sits in. Under a phone-camera warp the columns are not
   axis-aligned, and the current code gives up. This is the 0-of-35 failure.
3. **A block without a building code is not a class.** `Lunch`, `Library Shift`
   and `Rocket Club Meeting` will otherwise become classes with invented
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
