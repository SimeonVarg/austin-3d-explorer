# Photo audit: compare the whole picture, with numbers

Read this before you build or grade anything from a photograph. It is for
every lane and every model, at any effort.

**Why it exists.** A run tends to improve the one part it was told about and
leave the rest. On Welch Hall an arcade was rebuilt twice while the wall above
it still had two rows of windows where the photograph shows three, and the
arches were half-circles where the photograph shows a flat curve. Nobody
counted. The owner had to point at each one.

**The rule for owner comments.** A comment from the owner names one defect.
Treat it as a CLASS of defect. In the same pass: fix the defect, add or sharpen
a check below so that the same class is caught on any building, and note it in
"Where each check came from". A comment that changes only one building is half
used.

## The audit

Do it per photograph, with the render from the same camera beside it. Write a
table: one row per check, the number from the PHOTO, the number from the
RENDER, and SAME or DIFFERENT. Measure in pixels and write ratios. Do not write
"looks right".

**0. Is it the right building?** Confirm the photograph shows this building
and which wall, before anything else.

**1. Count first.**
- Storeys. Rows of windows on each wall in view.
- Columns of windows (or bays) across a stretch you can see end to end.
- Repeated parts along the ground: arches, posts, doors, shop fronts.
- Spacing of the rows ÷ spacing of the columns. It needs no scale, and it
  shows at once when bays are too narrow or storeys too tall.

**1b. One real length.** Ratios do not give size. Fix the scale with one
measured length: the wall height from the laser scan, or a wall length from
the map outline. Then every ratio becomes metres.
Read the scan itself, not a summary of it: take the roof heights in a strip
just inside the wall line. And do not trust a fitted camera for size. A camera
fitted to points of the model fits the MODEL: on Welch Hall the fit was 10 px
while the whole building was 2 m too low, because a camera a little nearer
hides a model that is a little small.

**2. Measure each repeated part.** For a window, an arch, a balcony, a post:
- width ÷ spacing (how much of a bay it fills);
- height ÷ width;
- for a curved top: rise of the curve ÷ width, and the height of the straight
  sides. A half-circle has rise ÷ width = 0.5. Most real arches are flatter.
- what is fixed to it: a bar or stone on top, a sill under it, bars across
  the glass (count them and say where).

**3. Never build from a word.** "Round arch", "sash window", "brick tower" are
labels. Build from the numbers of step 2. If the photograph and the label
disagree, the photograph is right.

**4. Bands up the wall.** Where does the material change (plaster to brick,
base to tower, wall to roof)? Give each line as a part of the wall height.

**5. What sits over what.** Is each window over an arch or over a post? Do
upper columns line up with lower ones? Where does the rhythm stop (a blank
stretch, a wider pier, a corner)?

**6. Colour, by measurement.** Take the middle colour of each material in the
photograph and in the render. Light differs, so compare RATIOS between
materials (brick against plaster), and how much the colour varies inside one
material.

**7. Openings.** Is the glass dark or bright? What shows behind an arch or a
shop front?

**8. Roof line.** Flat edge, overhang, slope, things that stand on the roof.

**9. Fixed things.** Pipes, signs, lights, rails, canopies. Count them. Say
where each starts and ends (a pipe that runs to the ground must reach it).

**10. Could not see it.** A part hidden by a tree or outside the frame is
NOT KNOWN. Say so. Build it from the visible pattern and label it INFERRED. Do
not skip the row.

## After the table

- List EVERY row marked DIFFERENT, biggest first. Biggest means the largest
  part of the picture, not the easiest to fix.
- Fix from the top of the list.
- After each round, do the whole table again from new renders. Do not grade
  only the part you changed.
- Report what is still DIFFERENT. Do not leave it out because it is hard.

## Does it work

Tested once, 2026-10-08, on the Welch Hall picture from before the fix, with a
small model at normal effort and the two photographs. The reasons and examples
in this file were cut out first, so the answers were not given away.

- WITHOUT this file it found: three rows against two, the stone block over
  each window, the missing pipes. It MISSED the arch shape, the windows not
  sitting over the arches, and the window width.
- WITH this file it found all of those, with numbers: arch rise ÷ width 0.3
  against 0.5, opening 0.80 of a bay against 0.70, window 0.29 of a bay
  against 0.53, windows drifting off the arches, dark openings against bright.

One building, one run. Test it again when a check is added.

**The table finds differences. Its COUNT is not a score.** Measured the same
day on Welch Hall's courtyard: a small model filled the same 33 rows twice,
from the same camera. Between the two runs the wall it measured had not
changed, and 5 rows about that wall still flipped between SAME and DIFFERENT.
So "15 same, 15 different" against "12 same, 20 different" says nothing. Use
each row as a lead and open the picture for it. To claim that a change made
things better, show the photograph, the before and the after from the SAME
camera.

## Where each check came from

Keep this list. One line per owner comment: date, the comment, the check it
made or sharpened.

- 2026-10-08. "there are three rows of windows, each having a little bar thing
  at the top": checks 1 and 2 (count rows; what is fixed to each part), and the
  rule to redo the whole table after each round.
- 2026-10-08. "look at the angle of the arch from the OG and your new version
  are they the same?": check 2 (rise ÷ width of a curved top, height of the
  straight sides) and check 3 (never build from a word).
- 2026-10-08. The first use of this file on the rebuilt wall found rows 1.26
  times as far apart as columns where the photograph has 1.0 (bays 3.45 m
  that should be 4.3 m): the row ÷ column check in step 1, and step 1b.
- 2026-10-08, found by the main lane, not by the owner: Welch Hall's walls were
  built to 18.2 m from a misread scan summary; the scan grid says about 20.3 m.
  Step 1b (read the scan itself; a fitted camera cannot check size).
- 2026-10-07. Three photographs filed under one building showed another
  building: check 0.
- 2026-10-03. "can't see the sign cuz the tree": check 9, from the camera of
  the photograph, with what blocks the view left in.
