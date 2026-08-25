# One door or two? — a question for Simeon

Picture: `shots/si/doors/two-doors-vs-one.jpg` (both panels are the real app at
390x844, the size you judge from).

Nothing has been changed. This is a choice, and it is yours.

## What happened

Two people built two halves of the schedule feature at the same time, and each
added their own way into the walk panel without being able to see the other's.
So the panel now has two rows, one under the other, that read almost the same:

- **"Import my class schedule"** — actually opens **your day**: today's classes
  and the walks between them. If you have never imported anything it shows an
  example day so the screen isn't blank.
- **"Import your class schedule"** — actually opens **the importer**: Google
  Calendar, Apple Calendar, or a paste from UT.

Neither label is wrong about itself. Together they are confusing: they differ by
one word, they sit one above the other, and only one of them imports anything.

## Option A — keep two rows, but rename them

Give each row the word for what it does. Something like **"See my day"** on the
first and **"Import my class schedule"** on the second.

What you get: each row does one thing and says so, and after you have imported,
the day plan is still one tap away from the search panel.

What it costs: two rows, 129 px, in a panel that is already 25 px taller than
the phone has room for. You keep the small swipe at the bottom of the panel that
this pass had to add to keep the Delete button reachable.

## Option B — one row that does both

One row, **"My class schedule"**. The first time you tap it you have nothing, so
it opens the importer. Once you have a schedule it opens your day, and there is a
way back to the importer from inside that screen for when the semester changes.

What you get: 66 px back. That is enough to close the whole fold problem — the
panel goes from 25 px over the space it has to about 40 px under it, so the
privacy line, the Delete button and the map credit all sit on screen with no
swipe at all. And there is exactly one thing on the panel about your schedule,
which is how many things there actually are.

What it costs: a row that goes somewhere different depending on what you have
done before. That can surprise someone who imported months ago and taps it
expecting the importer. Once you have a schedule, importing a new one is one tap
deeper than it is today.

## What I'd do

**Option B.** Two reasons, and the second is the one I'd actually act on:

1. The two labels differ by the word "my" versus "your". Nobody reads that
   difference under a thumb on a moving map. They will tap one, get the wrong
   screen, and go back.
2. It is the only one of the two that makes everything fit. Option A leaves the
   panel taller than the phone, and the thing hanging off the bottom edge is the
   line that promises the schedule never leaves the device. A promise you have
   to swipe for is a weaker promise. I have made it reachable, but B makes it
   simply present.

The wording in the picture ("My class schedule", "Import it, then see today's
walks") is a placeholder so the mock had something to say. If you pick B, the
words are yours too.

## If you pick one

Either is a small change and both live in `js/wayfind.js`:

- **A** is two label edits — `SAY_D.open` (around line 8680) and `SAY_IMP.entry`.
- **B** is hiding one of the two rows and pointing the survivor at whichever
  screen is right for the current state — `dayMount()` and `impInstallEntry()`
  each append one row today.

Say which and it takes ten minutes.

---

## DECIDED — 2026-08-25. Simeon picked **B**.

One row, `My class schedule`. Shipped on `acer/si-onedoor`.

Picture of the result, the real app at 390x844:
`shots/si/doors/one-door-phone.jpg`.

### What it does now

- **Nothing imported yet** — the row reads *"Import from Google, Apple or UT —
  read on this phone, never uploaded"* and opens the importer.
- **Once there is a schedule** — the second line becomes *"Your classes, in
  order, with the walks between them"* and the row opens the day plan. The line
  changes on the `wayfind:schedule` event, which fires on import AND on delete,
  so it can never promise the wrong screen.
- **Getting back to the importer** — a `Change` control in the day panel header.
  This is the whole reason one door is safe: with two rows the importer was
  always one tap from the sheet; with one it is one tap from the day panel
  instead, so a student swapping schedules mid-semester is never stuck looking
  at last term's classes.

### What it bought

The fold problem is closed, not mitigated. The sheet is **430 px tall holding
428 px of content** on a 390x844 phone — it fits, with 2 px to spare, where
before this round it was 25 px over and before the fold fix 157 px over. The
privacy line, "No schedule saved on this device yet." and the OpenStreetMap
credit are all on screen with no swipe at all. Measured, then looked at.

### Reversing it

`WF_DOOR.mode` in `js/wayfind.js` (search for `ONE DOOR OR TWO`). Set it to
`'two'` and both rows come back exactly as they were — the day row is still
built and still carries every one of its listeners, it just is not appended to
the sheet. Nothing else changes. `WF_DOOR.label`, `.hintEmpty`, `.hintHave` and
`.backLabel` are the wording, all in one place (CLAUDE.md rule 11).

### Verified

`scripts/verify/si-integration.mjs` on this branch: **50 passed, 0 failed** —
the first clean run of this gate. The gate it closes is section 8b, *"the sheet
offers ONE way to import a schedule, not two"*, which had been red by design
since the round began, waiting on this decision.

`scripts/verify/walkmeter.mjs`: unchanged — **87.0 m** over the pairs it makes
worse, signed total **-393.7 m**, **38/38** ends at UT's published door,
self-check drift 0.00 m, live UI gate pass.

Zero console errors on the phone page. `WAYFIND.on` is still `false`.
