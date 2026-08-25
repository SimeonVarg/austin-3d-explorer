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
