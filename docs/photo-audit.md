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

Start with the tools that exist: `scripts/photo-rollout/README.md` has the photo
inventory, the reviewed source packets, the camera check before a job and the
check of the real capture. Use them and the recorded inputs before you build
another pipeline. When they pass, the inputs and the camera agree with each
other. That is not yet a likeness to the photograph. A short list of
overlapping photographs still needs its landmarks looked at, and an extraction
that fails its quality check stays a rejected trial.

**0. Is it the right building?** Confirm the photograph shows this building
and which wall, before anything else. A bearing and distance from an
approximate camera is a lead, never a name: a camera whose yaw is off by
5 degrees moved a tower from one building to its neighbour, and a white tower
that the arithmetic called Dobie Twenty21 is a blue-green glass building in the
map. Confirm by a sign, or by a shape you can match on the reference
photographs of the building. When neither exists the row is "identity not
settled" and nothing is built.

**1. Count first.**
- Storeys. Rows of windows on each wall in view.
- Columns of windows (or bays) across a stretch you can see end to end.
- Repeated parts along the ground: arches, posts, doors, shop fronts.
- Spacing of the rows ÷ spacing of the columns. It needs no scale, and it
  shows at once when bays are too narrow or storeys too tall.

**1a. Count on the most square-on photograph, and never reuse a bay size.**
Before any build, look through ALL photographs of the wall and pick the one
taken most square-on. Count the bays there and measure one bay against the
wall height. An old bay size in the code or the data is not evidence: it is
a guess someone made for a generic wall. Take the rule (what is in one bay,
bottom to top) from that same photograph, not from an oblique one.

**1b. One real length.** Ratios do not give size. Fix the scale with one
measured length: the wall height from the laser scan, or a wall length from
the map outline. Then every ratio becomes metres.
Read the scan itself, not a summary of it: take the roof heights in a strip
just inside the wall line. And do not trust a fitted camera for size. A camera
fitted to points of the model fits the MODEL: on Welch Hall the fit was 10 px
while the whole building was 2 m too low, because a camera a little nearer
hides a model that is a little small.

**1c. Parts that stand in front.** Read the scan OUTSIDE the map outline too,
a few metres past every wall. A map outline is often the tower only. On
Moontower a white box three floors high stands 3.6 m in front of the tower on
both wings and is not in the outline; five builder rounds drew the front flat.

**1d. Find the rule of the wall before you draw it.** Flatten the photograph
of each wall into a straight-on drawing (the private tool `rectify_face.py`
does it from the wall's own edges, with no camera and no model), then say the
rule in one sentence and check it against every tier and column you can see.
A pattern that looks random from the street is nearly never random. Moontower:
white blocks three floors tall, charcoal columns with one window a floor, and
each tier the same layout moved 1.07 m north. The draft had painted it at
random, and no audit row can turn a random wall into the right one.
Two walls that are NOT in one plane hold a fitted camera much better than one
wall: fit it to points from both (Moontower: the tower wall and the box front,
3.4 m apart, fitted to 5.6 px). They do not give the real size by themselves:
keep the one measured length from 1b. Two fits that land on the same spot can
both repeat the same wrong model or the same wrong match. Write down which
points you kept OUT of the fit before you use them as a check.

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

**5b. Depth needs a second line or a second view.** A camera fitted only to
points on ONE wall cannot say how far back that wall stands: the fit moves the
camera to suit any depth. Before you move a wall forward or back, add a ground
line (a curb, a path edge) or a second wall to the fit, and check that the
camera height it gives fits the place the photograph was taken from and a
ground or floor height whose source you can name. A usual hand-held height is
an assumption, not a required range and not a measure of scale (see 5c). And a
frontal photograph cannot show how deep a recess is. For every recess (an
arcade, a porch, a set-back storey) find the oblique photograph, and measure
there: recess depth ÷ pier width, and pier depth ÷ pier width. Compare the
render from that same oblique camera, not from the front.

**5c. Check the camera in the real app before you grade the model.** A small
fitting error is not enough. Check the camera against a ground plane whose
source you can name, and write down whether the camera height and the scale are
MEASURED or ASSUMED. Reject a camera that sits under that ground. Do not turn a
usual phone height into a measured fact: a photograph may be taken from steps
or from an upper floor. Ground of unknown source stays uncertain.
Then project points on the wall, on the ground and on any object in front
through BOTH the fitted camera and the app's real camera, after the same crop
or warp of the picture, and compare. Keep the roll, the building frame, the
picture size and the camera-math version with the capture. A change of version
must never quietly re-read an old pose. When the two agree, the two camera
paths agree. It does not prove that the shape, the real camera or the scale is
right.

**5d. A second photograph checks only the feature that both show.** Look at the
matching landmarks before you call an overlapping photograph a holdout.
Repeated windows give matches that look right and are wrong. A similar table,
or a piece of the same wall, is no evidence for a hidden seat or for one
ornament. Write down which features the second view really confirms. If you
used it to FIT those features, it is no longer an independent check of them.

**6. Colour, by measurement.** Take the middle colour of each material in the
photograph and in the render. Light differs, so compare RATIOS between
materials (brick against plaster), and how much the colour varies inside one
material.

**7. Openings.** Is the glass dark or bright? What shows behind an arch or a
shop front?

**7b. Look in the photograph's own light, and once in the other light.** Shoot
the render with the sun on the wall if the photograph has sun on it, and once
more in shade. A dusk or shaded render hides missing parts: every tone goes
dark, so a wall with no windows and a wall with dark windows look alike. For
each opening, name the pixel colour of the glass in the sunlit render. If it
is the wall colour, the glass is not drawn (it may sit behind a wall sheet).
If it is the sky colour, it mirrors the sky: dark glass in the photograph
needs a dark tone, not the shared glass tone.

**8. Roof line.** Flat edge, overhang, slope, things that stand on the roof.

**9. Fixed things.** Pipes, signs, lights, rails, canopies. Count them. Say
where each starts and ends (a pipe that runs to the ground must reach it).

**9b. A sign's lettering is smooth, never the dot font.** Draw a name or a logo
as outlines (`scripts/sign_outlines.py`, then `outline=load_sign(key)` in the
recipe's writer), in the letter style of the photograph (script, serif, sans;
capitals or mixed case). Zoom the render on every sign before you call a
building done. `scripts/verify/sign-lettering.mjs` fails a recipe with new dot
lettering.

**9b2. A sign is read before it is drawn.** For every sign and every lettered
or carved name: zoom the photographs, open the reference pictures, and write
down the exact words, the case of the letters, the layout (a line under the
name, a small year at its end, a mark beside it) and the letter style. Then
build real letter shapes in that layout. Bars, blocks or strokes that stand
for letters are a miss, however small the sign is in the picture. A sign that
truly cannot be read is said so, with what the reference pictures say it is.
This holds for every way of building (a recipe, a Blender build) and every
model.

*Checks 9c, 9d, 9e, 9f, 9g, 9h, 9i, 9j, 9k, 9l and 9m are generalisations from his reviews, not laws (owner, the same day: "I don't want those to be
hard rules but more so generalizations that it has the freedom to ignore if it thinks what's shown is different").
The photograph wins: when what is shown is different, build what is shown and say so.*

**9c. A thing on a roof or a deck is built as what it is.** Name every distinct
thing you can see up there: cars, a ball court, a pool, a pergola, cooling
units, a stair head. Build each as that thing, simple but recognisable: a car
has a body, a cabin and wheels, never a plain box; a ball court has its lines,
its cage and its hoops. Count them, and say which you could not name.

**9d. Repeated parts keep their own measured size.** Measure each kind of
repeated part through the camera (a window, a balcony, a bay): width, height,
and the gap to the next one, as ratios of the bay. Do not give every balcony one
standard length. A window never touches the window above it unless the
photograph shows that. A closed window is dark glass or a blind, never a blank
patch of the wall's own white.

**9e. Upright things are upright.** Towers, piers and stair cores are vertical
and parallel to each other in the model unless the photograph proves a lean.
Two towers that splay apart are a camera or placement error, not a design.

**9f. A wall has its surface, not one flat colour.** Look at each wall in the
photograph before you paint it. What repeats on its surface is part of the
building: brick courses and their bond, stone blocks, panel or stucco joints,
siding boards, ribs, bands, the darker ring of an arch. Measure it through the
camera (the height and length of one unit, the joint, the two or three
colours) and build it: as its own faces where it is big, as a pattern in the
wall's material where it is fine (a generated pattern, never a piece of a
photograph). Keep the wall's average colour equal to the measured colour. This
is general wall detail, not a rule about brick: the photograph decides how
much. Rule 15 still holds: a pattern that is thinner than a pixel from where
it is seen must not flicker there. This holds for concrete, render and stucco as much as for brick: panel
joints, score lines, bands, tone variation and grain are read on the photograph
at full size and measured, and a smooth wall is smooth only when the photograph
shows it smooth.

**9g. Repeated slanted or stepped parts are measured one by one.** Roof plates,
canopies, crowns, bracket rows and stepped parapets that repeat along a
building: list each one, then measure through the camera where it sits (which
bay, both ends), its width and depth, its low and high edge heights (so the
slope's direction and angle), its overhang and the gap to the next one. Write
the table and build from it. A level plate where the photograph shows a slant,
two plates that cut through each other, or plates spaced by eye are faults.

**9h. Use every angle, not one photograph.** Before building, gather every
photograph of the place (other spots on the same walk, other days, public
pictures) and say which part each one shows best. Solve the camera on the
best one and check depth, heights and hidden parts on the others: what one
view cannot show (the underside and the sky gaps of a tree crown, the far side
of a terrace, a step count) is read from another view, not guessed. Building a
whole scene from one view is a fault when other views exist.

**9i. The roof has what the photograph shows, and nothing else.** Read the
roofline on the photograph at full size (and on the laser scan's levels):
flat or pitched, where each change of height is, what stands on it. Build
those. A slanted roof, a canopy, a crown or a rooftop box that no picture
shows is a fault, even when it "looks right" for the style.

**9j. Windows: the glass is the glass, the room behind it is the app's.**
Which windows are covered by blinds, lit, or lit in a colour is a moment in
one photograph, not a property of the building. Build every pane with the
glass colour of the photograph's uncovered panes and keep the pattern of
covered panes only as data (pane names in the build's notes), so the app can
choose covered, lit and dark panes at night by how often each happens. A
coloured light (for example a red room light) may appear at a realistic rate
in apartment buildings only; campus buildings never show coloured lights.

**9k. The building's own ground comes with it.** What stands on the building's
plaza, court or forecourt in the photograph belongs to the build: raised
planters and their walls, benches, tables and chairs, steps, low walls, bike
racks, lamp posts. Build each as what it is, simple and lean, on the measured
ground. People and moving vehicles stay out.

**9l. The ground storey and where the building meets the ground are checked
like the roof.** Read the base on the photograph at full size: where walls,
columns and openings stand, how deep each recess or parking level goes, where
the grade steps. No hole, open bay or undercut that the photograph does not
show; no recess deeper or set further in than measured. A base hidden by
plants or cars is built plain and closed, and said to be inferred.

**9m. Openings in the wall's shape are built as the photograph shows them.**
Big gaps in the wall geometry (open corners, loggias, balcony slots, recessed
bays, passages) are measured as solids: where each opening is, how deep it
goes, and which way it faces. An opening on a corner faces the way the
photograph shows it (often perpendicular to the main face), not toward the
camera by default. Count them on every face and corner.

*Checks 9i (roof), 9l (ground) and 9m (openings) are run together, on every
face, before the final render: the owner's "three checks", meant to be
holistic.*

**10. Could not see it.** A part hidden by a tree or outside the frame is
NOT KNOWN. Say so. Build it from the visible pattern and label it INFERRED. Do
not skip the row. Leave it plain and say so: do not invent a ground storey, an entrance or a
planting bed that no photograph shows.

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
- 2026-10-09, found by the main lane: Moontower's draft had a flat front and a
  random panel pattern, and 35 of 42 audit rows differed. Steps 1c and 1d (read
  the scan past the outline; flatten the wall and state its rule first).
- 2026-10-09, found by the main lane on the live site: the DKR stadium west
  wall was checked only in a dusk render. By day its window bands were bare
  wall (the glass sat behind one wall sheet) and then sky blue (the shared
  glass tone). Check 7b.
- 2026-10-09, found by the main lane: the DKR stadium west wall was first built
  from an oblique photograph on the generic 6.2 m bay. A near-frontal photograph
  was in the same set all along: it gives 12.6 m bays, ONE tall ribbed panel to
  a bay (not two), slit windows, and a narrow pylon. Check 1a.
- 2026-10-07. Three photographs filed under one building showed another
  building: check 0.
- 2026-10-03. "can't see the sign cuz the tree": check 9, from the camera of
  the photograph, with what blocks the view left in.
- 2026-10-10, found by a builder and the main lane on Norman Hackerman: the
  brick face was placed at three different depths in three drafts (8 m apart)
  from one-wall camera fits, and the rebuilt arcade matched the front
  photograph while the side photograph showed its bays far too shallow.
  Check 5b.
- 2026-10-10. "The canes logo is pixelated I thought that was never gonna happen
  again": a new shop went live with its name in the 5x7 dot font, and the lead
  looked at the whole picture and not at the sign. Check 9b, and
  `sign-lettering.mjs` (the dot font is frozen to the 12 recipes that had it).
- 2026-10-11, found by a builder ranking every building in four whole views: a
  tower named by bearing was a different building than the SKYLOFT sign and its
  window language showed. Check 0 (identity is a lead until a sign or a matched
  shape confirms it) and the rule that an unsettled identity is a row, not a build.
- 2026-10-11. Not an owner comment: the overnight detail trial found a camera
  with a small fitting error that sat UNDER the modelled ground, and a fitted
  camera whose projection did not agree with the app's. Checks 5c and 5d, the
  sharper end of 1d, and the first step in "The audit". The second photograph
  did not prove that it showed the same table, nor the one ornament, and a
  corrected outline still left out most of its inner pattern: the whole-picture
  audit stays required.
- 2026-10-12. The owner compared three models' builds of one five-part
  apartment complex, each made in Blender from the same site photograph, in a
  spoken review. What he marked, by class: one build drew roof cars as plain
  boxes and a ball court as "a little deck-looking thing" while another drew
  the court with its hoops ("I really wish it would do a better job at
  inferencing stuff like the basketball court and cars looking like cars
  instead of blocks"): check 9c. Balconies "too long" in one and "just right"
  in another, windows that "touch the other windows up and down completely",
  and windows "completely covered by the wall ... a white shouldn't be what's
  represented with a closed window": check 9d. "Two vertical towers that kind
  of go off in different angles": check 9e. One build invented what stood at
  the hidden bottom and one "did a better job of just leaving what's at the
  bottom": the sharper end of check 10. He also named the look he wants: clean
  and a little minimal, "the diorama feature", with true detail welcome where
  it is accurate.
- **2026-10-12, at night.** A tower built in Blender came back with bars
  where its name sign is. His words: "there's like weird lines but it should
  say signature with a line under and then 1909 at the end of that line-
  better text recognition from now on": check 9b2. The reference pictures of
  that building held a clear picture of the sign; the builder had not read it.
- **2026-10-12, later the same day.** A brick gymnasium came back from Blender
  with its double stair, rails, arches and windows right and its walls one flat
  colour. His words: "I want the brick pattern ... if there's brick from now on
  I'd like the brick pattern to be there (even 26 west missed some bricks) don't
  write a rule for bricks make it general for wall detail": check 9f. On the
  same building the lower arch "should start a bit higher": it sprang from the
  ground, so it cut the top of the door under it. That is check 9d again (an
  arch keeps its own measured springing height, as a window keeps its sill).
- **2026-10-13 evening.** Two mid-rise apartment blocks came back from a paid
  builder with their slanted roof plates set by eye. His words on the first:
  "Fix the slanted roofs, rn they are overlapping weirdly and aren't spaced
  properly and angles are slightly off"; on the second: "make it slant the left
  tower roof like the OG": check 9g. The rebuild measured seven crowns and seven
  canopies into a table and the overlaps were gone.
- **2026-10-13 evening, same building.** A five-storey block came back with the
  rendered stone of its corner tower drawn as one flat colour. His words: "add
  the smooth stone detail / texture on the left tower that is flat right now":
  check 9f sharpened (concrete, render and stucco too, not only brick).
- **2026-10-14, night.** A street (the campus mall) came back from Blender with
  its paving, centre strip and lamp posts measured well from one photograph,
  and its tree crowns closed into one dark mass overhead. His words: "The top
  looks super weird. Like a gray ceiling ... we need to get better at using
  various angles for stuff like this instead of hyper focusing on one": check 9h.
- **2026-10-14, midday.** A plain seven-storey siding block came back from a
  paid builder with its walls and windows right, slanted roofs where the
  building has none, and one window lit red as in the photograph. His words:
  "the roof details are a bit off with slanted roofs where there shouldn't be
  and details that are not supposed to be there", and on windows: "every single
  window that has like blinds ... the blender model usually copies which ones
  are covered ... we can lean into that direction by like having it random based
  on how many times it appears in real life ... in general there shouldn't be
  colored lights on campus": checks 9i and 9j.
- **2026-10-14, afternoon.** A two-storey concrete building came back with its
  frame, glass and lettering right and its courtyard empty. His words: "Building
  is good. It should have added the structure on the side with the plant, and
  the table + chair ... for next time": check 9k.
- **2026-10-14, afternoon.** A plain office block on a parking level came back
  from a paid builder close to its photograph, with an open hole at a corner of
  the parking level and the lower left cut set too far in. His words: "In
  addition to the roof check, add a ground / lower check. In this example
  there's a hole near the corner that prob shouldn't be there, And the cutoff on
  the left bottom side is a bit too far in": check 9l.
- **2026-10-14, afternoon.** A four-storey brick hall with breeze-block screens
  came back from a paid builder with a good roof, a thin base and its corner
  balcony slots turned the wrong way. His words: "ground check the lower details
  could be improved alot there's some missing recessed entrance detail with
  walls and colors. Add another check for holes in the building ... wall
  geometry with big gaps. Like the corner there's two of them, the closer one is
  done incorrectly - it puts the gaps facing the camera instead of facing
  perpendicular. This makes 3 checks in total that should be somewhat
  holistic": check 9m, and 9i, 9l and 9m run together.
