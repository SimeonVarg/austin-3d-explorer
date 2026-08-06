# The Drag at eye level: pick a wall

Acer lane, 2026-08-06. This is the taste question `facades-at-two-metres.md` §6
said to ask, with the two candidates built and photographed so it can be
answered from pictures rather than from a description.

**Look at these two first. The words below only matter after you have.**

* `shots/facade/final/CHOOSE-the-drag-at-eye-level.png`
* `shots/facade/final/CHOOSE-from-600m.png`

---

## What you are choosing between

Standing on the pavement of Guadalupe, the shopfront is genuinely good — awnings,
recessed glass, doors, tenant signs. Above it there are ten metres of wall that
reads as a vertical barcode, and it is the first thing your eye goes to. Three
options:

**Leave it.** Costs nothing. The barcode stays.

**Storey lines.** Give the wall real horizontal structure and nothing else: a
base course where it meets the sign band, a floor line between storeys, a cornice
under the parapet — cut as actual stone, so they hold their height in metres no
matter where you stand. No windows. The wall stops being a barcode and becomes a
plain, calm building. **A few days.** One bake, one new wall texture, no new
machinery, and it works everywhere in the city the same way.

**Real windows.** All of the above plus an opening in every bay — a head, a
sill, a pane, one pane in three lit after dark. This is the one that reads as a
*building* rather than as a surface. **Weeks, and it changes how the city
loads.** One block cost 292 KB; the Drag, campus and West Campus together come to
roughly 190,000 windows and 190 MB, which needs a whole loading strategy the app
does not have yet.

---

## What the pictures actually show

**By day the middle option does most of the work.** The barcode is gone, the wall
is calm, and it reads as a plain masonry building — which is what most of
Guadalupe honestly is. The right-hand option is better, but the gap between
"barcode" and "quiet wall" is much bigger than the gap between "quiet wall" and
"windows".

**By night that reverses, and this is the thing I would not have predicted.**
Take the barcode away and there is nothing left up there for the streetlamps to
catch — the storey-lines wall goes almost black. The windows wall is the only one
of the three with anything happening above the shopfront after dark. If the Drag
at night matters to you, that is the argument for paying for windows.

**Neither one touches the flyover.** From 600 m the whole of both candidate walls
is seventeen pixels of a 1.3-million-pixel frame. They change 4.4 % of the frame
at walking height and 0.007 % of it from cruising height — six hundred times
less, measured against a noise floor of zero. This is a walking-camera feature
and it costs the view from above nothing.

---

## What I would do, and why

**Ship storey lines now. Do not start windows this month.**

Three reasons.

1. **It is most of the win for a twentieth of the work.** The defect is that a
   forty-metre wall has no horizontal structure at all. Storey lines are exactly
   the missing horizontal structure. Windows are a further refinement of a
   problem that is already solved by then.
2. **It scales and windows do not.** Storey lines are about three features per
   building — the Drag, campus and West Campus together come to roughly 3 MB,
   the same order as things the app already ships, one bake, no new loading
   story. Windows at the same coverage are ~190 MB and need PMTiles, a minimum
   zoom, a level-of-detail scheme and a fresh performance pass. That is a
   project, not a pass, and it would eat the rest of the month.
3. **Doing storey lines does not throw away any windows work.** The windows
   candidate is literally the storey-lines candidate plus openings. Nothing is
   wasted if you ship one and add the other later; the second half is additive.

The honest cost of taking my advice is the night wall. Accept it for now and it
is fixable more cheaply than full geometry later — the storey lines are already
the right places to hang light, so a lit band or a scatter of glowing panes on
that wall is a much smaller job than 190,000 modelled openings.

**If you disagree, disagree about night.** That is the real trade here, and it is
yours: a calm wall that is dead after dark, versus a month of work for a wall
with lit windows in it. Everything else on this page points the same way.

---

## What is true about these pictures, and what is not

* Both candidate walls exist and were photographed in the running app. They are
  on **one block of Guadalupe** — eight buildings, roughly W 23rd to W 24th plus
  the Co-op — and they are off unless the page is asked for them. Nothing about
  the app you can open right now has changed.
* The three frames in each row came from **one page load at one camera pose**,
  with the wall swapped by a filter. Everything below the sign band is
  byte-identical between them; the only pixels that differ by anything visible
  are on the wall itself.
* **Auto-exposure is switched off in these frames**, and that is a real
  difference from the running app. Left on, its brightness gain landed anywhere
  between 0.85 and 1.20 depending on which frame happened to be shot first, and
  three panels of a row graded differently is not a comparison. Off, all six
  frames are gain 1.000.
* **The picture is of a mock-up, not of a finished feature.** The window
  proportions, bay spacing, course depths and the share of lit panes are all
  first guesses. Judge the *kind* of wall, not the exact rhythm — every one of
  those numbers is a one-line change.
* This says nothing about campus or West Campus. The Drag has its own wall code;
  the campus halls are painted by a different module and need the same treatment
  separately.
