# Walk feature — progress log

## Where this stands — 2026-08-26 morning, one minute

**Short version: one way the schedule reader could quietly send you to the wrong
building is now closed, and it did not make the app any chattier.**

Some UT building codes are one letter apart and both real — `MEZ` is Mezes Hall
on the South Mall, `NEZ` is inside the football stadium, half a mile away. If
the reader misread one as the other, everything in the app said "yes, that's a
real building" and it was saved at full confidence with nothing said. It only
happened when the class was the **only class on that day** — which is exactly
what a once-a-week discussion section, lab or seminar looks like.

Now it asks, once, with your own picture beside it and the right answer as the
second button: *"Is this building NEZ?"* — `NEZ` (what the picture reads) and
`MEZ` (Mezes Hall). It never rewrites your reading; it only asks.

**It did not start nagging.** Over the fifteen test pictures the app asks
**16 questions in total — exactly the same 16 as before**, picture for picture.
Not one of them is the new question. It only speaks when a class is alone and
its code has a look-alike, and it stays quiet for an ordinary week.

**What is still open on this:** thirteen pairs of look-alike codes exist and the
app can separate five of them. `PAI`/`PAT` are two real teaching buildings 250 m
apart and nothing in this repo can tell them apart — that is written down rather
than papered over.

Picture: `shots/img-confidence/lonely-class-question-phone.jpg`.

---

## Where this stood — 2026-08-25 night, one minute

**Short version: you can now take a picture of your class schedule and the app
reads it, on your phone, without the picture ever leaving it. It works on 131 of
the 171 classes in the test set. It gets zero of them wrong. It is on `main`,
and it is still invisible to the public — the switch that turns the walking
feature on is deliberately still off, and only you flip it.**

### What a student actually gets

They open the app, tap "My class schedule", tap the **Photo** tab, and hand over
a screenshot of their calendar or a photo of their printed schedule. It says
*"Reading your picture on this phone…"* and, twenty seconds later, their own day
is on screen: M 340L in Patton Hall at 9:30, a twelve-to-seventeen-minute walk
to the Communication building marked **"Tight for this gap"**, RTF 305 at 11:00.
The footer says **"From a photo of a schedule."**

The picture is read on the device. There is no upload, no cloud service, nothing
sent anywhere — and that is not a promise, it is measured. Two separate
instruments watched a real import: one inside the browser, one a raw network
socket outside the browser entirely. **Across 174 requests during an import, not
one carried any data at all**, and no new destination was contacted. I also
fired a deliberate fake leak of a real room number at it — the app caught it and
refused to send it.

### The part I care about most: it does not guess

An import that confidently invents a room sends you to the wrong side of campus.
**It made 269 predictions across two full runs and not one of them was wrong.**
When it cannot read something, it says so and asks — showing you the crop of
your own picture with the row circled, and the reason in plain words: *"the day
letters came off the picture faintly — the engine itself was only 50% sure of
them."* And when a reading is too far gone it refuses it outright: *"'MZQ' is
not a building code this app knows; classes do not start at 9:07 am. Take the
picture again, straight on, and this one will read."*

If you skip every question it asks, you lose three classes out of 171 and gain
nothing wrong. That trade is the whole design.

### Our number against the bar

The bar was a normal OCR pipeline pointed at the same fifteen pictures: **36 of
171**, and worse than the number suggests — most of what it produced was wrong,
and it could read buildings and rooms but almost never a day or a time, which is
useless for walking anywhere. **We get 131 of 171 with a student who answers
nothing, 134 if they answer.**

Perfect on every clean screenshot and every cropped one. Two-thirds of the
dark-mode ones. Just under half of the angled ones.

### What is still weak, and I want to be straight about two things

**Photographing your own phone at an angle, when your schedule is a week-grid
calendar, gets you nothing.** Three of the fifteen pictures are exactly that,
and all three score zero. They fail honestly — the app says *"10 classes are
drawn here but I could not read the times"* rather than making something up —
but the only way out is to take the picture again, straight on. That is probably
the single most common photo a student would actually take, so it is the real
weak spot, not a rounding error.

**And the fifteen test pictures are all fakes.** Nobody pointed a camera at
anything. They are web pages rendered and then put through a real perspective
warp with glare and blur and camera noise added — good enough that the geometry
and the blurring are genuine, but there were no photons. **The single most
valuable thing anyone could do for this feature is send me one real photograph
of one real schedule.** Everything else is a guess about how close the fakes
are.

The bar was also not Google Lens — it could not be reached from this machine and
the attempt is written down honestly. It was the strongest OCR that was
reachable. Beating it is a real result; it is not "we beat Google."

### Does the walking record still hold? Yes, exactly.

Re-measured on the merged copy, not on the branch: **87 metres wasted across the
twenty back-to-back class trips**, **394 metres saved on balance**, **all 38
ends arriving at the door UT itself publishes**. Nothing about the walking
directions moved, which is the point — this round added a reader and touched
none of it.

The full automatic check went from 49 of 50 to **50 of 50**, because you
answered the two-doors question and there is one door now.

### Is the whole feature ready to switch on for everyone? Still no — same one reason as before.

**`WAYFIND.on` is still `false`, I did not touch it, and no agent may.** I
checked the live site after this deployed: a stranger gets exactly what they got
yesterday, with no walk or import controls anywhere unless you add `?walk=1`.

The reason to keep it off has not changed and it is not the import. **Two of the
five walking pieces — the stairs and the lighting — were never properly
judged**, and those two are the ones making accessibility promises like
"step-free" and "no mapped streetlight along this route". A wrong distance costs
a detour. A wrong "step-free" claim strands someone at the bottom of a
staircase. (`QUEUE.md` W1.)

**The one thing I would do next, on the import specifically:** when the app
refuses a class it could not read, it currently just drops it — there is no row
to tap and no way back except deleting the whole schedule and re-photographing
it. Keeping the refused class as a stub and offering *"3 classes couldn't be
confirmed — add them?"* would turn the honest failures into four taps. Every
piece it needs is already built.

---

## Where this stood — 2026-08-25 evening, one minute

**Short version: the class-schedule import works now, and it shipped. It is
still invisible to the public — the switch that turns the whole walking feature
on is deliberately still off, and only you get to flip it. There is exactly one
thing left on this, and it is a question for you, not a bug.**

### What changed since this morning

This morning's entry said the import did not work and I refused to merge it.
Two builders fixed the six things that were broken, four separate checkers went
over the result with fresh eyes and their own scripts, and I re-ran everything
myself on the final merged copy before believing any of it. It holds. It is on
`main`.

### What a student gets now when they import their schedule

They hand over the file UT gives them. The app reads it with the good reader
instead of the weak stand-in, so **five of the seven classes in the test file
land instead of two**. Then:

- **They see their own day, not a demo.** Tap through and it is M 340L in
  Patton Hall, RTF 305 in the Communication building, C S 439 at the Gates
  complex — their classes, at their times, in order, with the walks between
  them and how tight each gap is. The old leftover demo can now only appear if
  nobody has ever imported anything, and when it does it is stamped
  **EXAMPLE** and says "sample data, not your schedule" at the bottom.
- **The one class it cannot help with says so, by name.** A lab at MER is
  eleven kilometres north at the Pickle campus, off the edge of the map. The
  app now says *"MER is 11.1 km north of campus — off this map"* instead of the
  wrong sentence it used to give, which was the one meant for a building on
  this campus with no door mapped. It names the class, the room and the reason
  rather than quietly dropping it.
- **The import sticks, and Delete really deletes.** Close the tab, come back,
  the schedule is still there. Tap "Delete my schedule" and it is gone from the
  browser for good — I watched it go, reload it, and stay gone.
- **The privacy promise is now guarded by the shipped app, not by a test rig.**
  This was the part worth the round. The alarm that watches for any of your
  schedule leaving the device used to be asleep during the import, because it
  armed itself off a saved copy that was never saved. It now arms for real:
  **thirty pieces of your schedule watched, a hundred and seven background
  messages inspected, nothing blocked because nothing tried.** I also fired a
  deliberate fake leak at it — the app caught it and refused to send it. Two
  independent instruments, one of them a raw network socket outside the
  browser entirely, saw nothing of a schedule leave the machine.
- **On a phone, the bottom of the panel no longer falls off.** The privacy
  sentence and the Delete button are on screen without scrolling, in the state
  that matters — someone coming back with a schedule already saved. The map
  credit line sits sixteen pixels lower and takes a small swipe to reach. That
  last sixteen pixels is honest and it is the one thing still open (below).

### The one thing left, and it is yours to decide

**There are two buttons on that sheet that say almost the same sentence** —
"Import my class schedule" and "Import your class schedule". They came from two
different pieces built by two people who never spoke, and both were reasonable.
One opens your day, one opens the importer. Nobody collapsed them, on purpose:
which one survives, or whether they become one button, is a taste call and taste
calls are yours.

**The picture is `shots/si/doors/two-doors-vs-one.jpg` and the argument is
written out in plain words in `docs/si-doors.md`** (it recommends one door, and
did not apply it). Picking one door is also worth sixty-six pixels, which is
four times the sixteen the map credit is short — so your answer closes the phone
layout outright as a side effect.

That single open question is why the automatic check reads **49 of 50** rather
than 50. The one failing check is the check that asserts there is one door. It
is red on purpose and it stays red until you answer.

### Buildings the app still cannot walk you to

**Ten, and all ten are at the Pickle campus** about eleven kilometres north,
off the edge of the city this app models. That is down from eleven — the School
of Social Work became routable and this is the first time that improvement is
actually on `main`. Two separate instruments agree on the number, and the import
screen now agrees with them too, because it stopped keeping its own list of
unreachable buildings and started asking the router. It used to remember, and
what it remembered had gone stale.

### Does the walking record still hold? Yes, exactly.

Untouched, and I re-measured it on the final merged copy rather than trusting
the branch: **87 metres wasted across the twenty back-to-back class trips**,
**394 metres saved on balance**, **all 38 ends arriving at the door UT itself
publishes**, and the harness's own drift check at zero. The real-mouse test on
the "Avoid stairs" checkbox passes. Nothing about the walking directions moved.

### Is the whole feature ready to switch on for everyone? Still no — and now for only one reason.

**`WAYFIND.on` is still `false`, I did not touch it, and no agent may.** With it
off, a stranger loading the site gets exactly what they got yesterday: I checked
the live site after this deployed and the walk and import controls are not there
at all unless you add `?walk=1` to the address.

The reason to keep it off is no longer the import — that reason closed today.
It is the old one: **two of the five walking pieces, the stairs and the
lighting, were never properly judged**, and those two are exactly the ones
making accessibility promises like "step-free" and "no mapped streetlight along
this route". A wrong distance costs someone a detour. A wrong "step-free" claim
strands someone at the bottom of a staircase. That is not a promise to ship on a
screenshot. (`QUEUE.md` W1.)

**The one thing I would do next: judge the stairs and lighting pieces.** It is
the only thing standing between this and switching the feature on, and the
schedule import — the part that looked furthest from ready this morning — is
now done.

---

## Where this stood — 2026-08-24, thirty seconds

**The walking directions used to send students the long way round. Across twenty
real back-to-back class trips they wasted 795 metres. They now waste 87.** That
is the whole headline: about nine tenths of the wasted walking is gone.

The worst single trip was Engineering Education and Research to Norman Hackerman
— the app sent you **569 metres for a walk that is 271**, more than double,
because it was aiming at the wrong door. It now routes 272 metres.

The reason it was wrong is that UT publishes its own list of where each
building's real front door is, and we were ignoring it. **All 38 ends of the
twenty trips now arrive at the door UT itself names.** Before, our door was the
right one about a quarter of the time.

Five separate pieces were built for this: **the door** (which door you walk to),
**the pavement** (routing on real sidewalks instead of across grass and asphalt),
**the stairs** (drawing them, pricing them, and offering a step-free way round),
**the lighting** (telling you which of the walk has a mapped streetlight on it),
and **the interface** (the whole answer card, rebuilt for a phone).

**Which of them beat the bar blind? One did — the interface.** This pass was
handed a summary saying none of the five were ever judged, and that turned out to
be wrong; the record in the repository says otherwise, so here is the real state,
piece by piece:

- **The interface — judged blind, and won.** Real Citymapper walking cards were
  put beside ours, shuffled, and scored *before* anyone knew which was which.
  Ours was preferred on both. It also recorded the one thing Citymapper does
  better and we cannot copy: it names the actual street at every turn, and our
  walking map simply has no street names in it to print.
- **The door and the pavement — checked by someone else and confirmed, but
  against ourselves, not against Citymapper.** Both were independently re-run
  from scratch and both reproduced their claims. That is a real check. It is not
  the same as beating an outside product blind, and I have not counted it as one.
- **The stairs — the only verdict on record is a loss.** Round 1 was judged and
  failed. Rounds 2 through 8 were never judged at all.
- **The lighting — never judged, at any round.**

So: one blind win, two confirmed-but-not-blind, one recorded loss with seven
unjudged rounds after it, and one never looked at.

Two things broke on the way in, both found by driving the app rather than reading
the code:

- **The "Avoid stairs" tickbox did not work.** The interface rebuild had pushed
  it off the bottom of the visible card, so clicking it did nothing at all. It
  had been fixed once already by another piece and quietly broken again. Fixed:
  the controls now sit above the long step-by-step list. It ticks.
- **The ruler itself had gone out of true.** The tool that measures the wasted
  metres carries its own copy of the routing maths so it can check itself, and
  two of the five pieces changed that maths underneath it. It was silently
  measuring the wrong thing on fifteen of nineteen trips. Fixed — it now reads
  the real settings off the running page, and its self-check is exact to the
  centimetre on every trip.

**Would I switch it on for everyone? Not yet — but it is close.** The routing is
in good shape, the interface has beaten a real product blind, and nothing else on
the site regressed. The reason to wait is narrow and specific: **the two pieces
that were never properly judged are exactly the two that make promises about
accessibility** — "step-free", "no mapped streetlight along this route". Getting
a distance wrong costs someone a detour. Getting "step-free" wrong strands
someone at the bottom of a staircase. That is the one promise I would not turn on
because it looked right in a screenshot.

Until then it stays where it is: invisible unless you add `?walk=1` to the
address. Nothing on the live site has changed for anyone else.

---

## 2026-08-24 — critic pass, round 3 on the schedule-import "parser" piece: oursWins = false, because there is still no "ours" — nothing changed since round 1

Spawned as the harsh critic for round 3. Fresh context, own port (8951), told
to check out `acer/si-parser` and drive the real `?walk=1` importer blind
against Google Calendar's own bad-file partial-failure reporting.

Checked what actually exists before touching a browser, the same way round 1
did, and got the identical answer. `git fetch origin --prune` then
`git ls-remote origin | grep -i "pars\|si-"`: no `acer/si-parser` on the
remote, then or now. Locally, the branch `acer/si-parser` exists only because
it is byte-identical to `origin/main` — `git diff main acer/si-parser` shows
only the docs/screenshot files round 1's own critic commit (`80747c4`) added;
`js/wayfind.js` is untouched between the two, still exactly 8,238 lines, still
zero hits for `ics`, `vevent`, `vcalendar`, or `schedule` as an importer
keyword (one unrelated hit each for a comment using "schedules" as a verb and
a `lineMetrics` source-add). `index.html` and `_harness.html` carry no new
`<script>` tag. `gh pr list --state all` searched for "parser", "calendar",
"ics", and "import" turns up zero PRs about a schedule importer — the "import"
hits are all unrelated ("recommendations box... mail-app handoff",
storefront/roofscape PRs that happen to contain the substring). `git log --all
--oneline --grep` across every ref on the machine for
`parser|ics|VEVENT|schedule.import` returns only round 1's own commit and the
two recon docs — nothing else, anywhere, has ever touched this piece.

So: two full rounds after round 1 wrote down exactly what to build and where
(`acer/si-parser` off `a902c32`, using `docs/import-bar-apple.md` and
`docs/import-bar-ut.md` as ground truth, plus a Google Calendar recon doc
still to be written), no builder session ever ran. No server to start, no
`?walk=1` import UI to click, no `.ics` fixtures to feed it, nothing to judge
blind against Google Calendar's own partial-failure UI. `WAYFIND.on` is still
`false` and nothing in `js/wayfind.js` changed at all — not a partial attempt,
not a stub, not a dead-end branch. **oursWins = false** — same reason as
round 1: a piece that has still never been built, not a piece that lost on
merits.

**The single biggest gap, stated so a builder can act on it without asking a
question:** nothing has changed since round 1's gap — a builder still needs to
create `acer/si-parser` off current `main` and write the actual `parseICS`
code (Google Calendar `.ics` export, Apple Calendar subscribe/import flow, UT
registration schedule export) that resolves `SUMMARY`/`LOCATION` text to the
`[CODE, lon, lat, ...]` tuples around `js/wayfind.js:3609`, using
`docs/import-bar-apple.md` and `docs/import-bar-ut.md` as the format ground
truth and writing the missing third recon doc for Google Calendar's own
`.ics` format before coding against it. Until a builder round actually runs
and pushes to that branch, every subsequent critic round will read the same:
there is no "ours."

Nothing touched this pass: no server started, no port bound, no file the
builder owns edited. This entry only appends to this doc, on the docs-only
fast path CLAUDE.md rule 4 allows straight to `main`.

---

## 2026-08-24 — critic pass, round 1 on the schedule-import "parser" piece: oursWins = false, because there is no "ours" to look at

Spawned as the harsh critic for round 1 of the class-schedule import (the
Google Calendar / Apple Calendar / UT registration `.ics` importer that turns
"MAI 220, TTh 2pm" into a routable building code). Instructed to check out and
serve `acer/si-parser` at port 8951 and drive it blind against Google
Calendar's own partial-failure behaviour on a bad file.

That branch does not exist. Checked every way I know how before writing this
down: `git fetch origin --prune` then `git branch -a` (local and remote),
`git for-each-ref` grepped for "pars", `gh pr list --state all` and a GitHub
search-issues query for "parser" (0 results), `gh api .../branches` grepped
for "pars", and `git worktree list` across every sibling worktree on this
machine (11 of them) — none is named or contains anything for a parser piece.
The only related work anywhere is two **recon-only** commits already sitting
on `main` (`e29f683`, `f8015d9`), which produced `docs/import-bar-apple.md`
(167 lines) and `docs/import-bar-ut.md` (268 lines) — real-format writeups for
Apple Calendar's subscribe/import flow and UT's registration schedule export.
There is no recon doc for Google Calendar's `.ics` export, and zero lines of
implementation: `js/wayfind.js` (still 8,238 lines, `WAYFIND.on = false`) has
no `parseICS`, no `VEVENT` handling, no schedule-import code of any kind, in
any branch, anywhere.

So there is no server to start, no `?walk=1` UI to drive, no fixtures to test
against a bad-file bar, and nothing to photograph blind against anything.
**oursWins = false** — not a loss on merits, a piece that was never built.

**The single biggest gap, stated so a builder can act on it without asking a
question:** create branch `acer/si-parser` off current `main`
(`a902c32`/`origin/main`) and actually build the importer described in the
brief — a Google Calendar `.ics` export parser, an Apple Calendar
subscribe/import-flow parser, and a UT registration schedule-export parser,
all normalizing to the building-code seam at the `[CODE, lon, lat, ...]`
tuple array around `js/wayfind.js:3609` — using the two recon docs that
already exist (`docs/import-bar-apple.md`, `docs/import-bar-ut.md`) as the
format ground truth, and write a third recon doc for Google Calendar's `.ics`
format before coding against it, since nobody has looked at that one yet.
Nothing the parser piece owns was touched by this pass; no server was
started, no port was bound, nothing was committed to `js/wayfind.js`.

---

## 2026-08-23 — the lighting claim, checked at 43 places instead of six: it holds, and it turned up a live oak sitting on top of a street lamp

The walk feature can already tell you which parts of a route have a streetlight
mapped on them. Up to now that had been checked by flying to six places we
picked ourselves, which is a nice way to check something you already believe. So
this round wrote a script that picks the places instead: it runs twelve real
routes, drops 43 sample points along them — some where the app says there is a
light, some where it says there is none — flies to every one at night, and
compares what the card says with what is actually standing there in the frame.

It holds up. Nowhere the app says "no streetlight" does a streetlight turn out to
be standing there, and every place it says there is one, there is one. The
instrument was wrong four separate times before it was right, though, and each
wrong version produced a confident number: it was looking at a whole frame
instead of the 25 m the claim is about, it was counting green tree leaves as
lamplight, and it was counting the blue emergency call boxes as streetlights
twice over. All four were caught by looking at the picture, not by reading code.

The interesting part is what it found at two of the 43. The card counted a
mapped streetlight and the night frame showed nothing at all — because there is
a big cedar planted directly on top of it. Hiding just the trees brings the lamp
back, brightly; hiding the buildings or the ground does nothing. The tree data
agrees: those lamps are five metres tall standing under a canopy twelve metres
tall centred a metre away. City-wide it is 56 of the 193 streetlights we know
about — nearly a third of them are under a tree. So the card now says it: "24
mapped streetlights along this route · 4 of them are under tree cover."

Then the tempting bit, which did not survive. Since a lamp under an oak lights
the pavement less, the obvious move was to make the "show me a better-lit way"
button prefer routes with lamps in the open. That was built, and then A/B'd over
60 random building-to-building walks — and it changed nothing on any of the 12
routes that actually have a covered lamp, while quietly deleting one good
suggestion on a route that had none. So it ships switched off. The tree count is
worth telling you; it is not worth silently steering you by, and now there is a
measurement saying so rather than an opinion. One line in the file turns it back
on if you want it.

Two smaller things. The lamps thin out in the map tiles below zoom 16, so if you
read "24 streetlights" and then pull back to see the whole walk you are looking
at about a third of them — the little rings we draw at each counted lamp come
from our own list, not the tiles, so those stay complete. And after dark the
card now ends with one line admitting that the soft glow along the roads is
scenery rather than surveyed light, because the audit measured that one time in
five a stretch we call unmapped has decorative glow on it as bright as a real
lamp, and a person who flies down to check is right to wonder. The real fix for
that lives in the night lighting file, which this lane does not own.

Also went looking, properly this time, for a real inventory of Austin's
streetlights to replace our guesswork — the city's whole GIS catalogue, the
public ArcGIS index, and the open-data portal. There isn't one. Worth knowing so
nobody spends another round hunting for it.

Branch `acer/w-lit`. Scripts and every frame are in `shots/walk/lit/`; the long
version with all the numbers is `docs/walk-lit.md` §17-24.

## 2026-08-23 — recon only, no code touched: UT publishes its own official front-door data, and our heuristic is currently wrong most of the time

Went looking for where students actually enter buildings before anyone writes
more entrance-picking code. The OSM side confirmed what the brief expected:
only 20% of OSM's campus entrance tags say `main`, and of the app's 295
buildings, 264 (89%) have zero OSM-sourced door data at all — every door on
them is a guess from the bake script.

The real find was somewhere nobody asked to look: UT Austin's own campus map
(maps.utexas.edu) runs on public ArcGIS data, and buried in it is a
`Celebrated_Entrances` layer — UT Facilities' own hand-surveyed record of the
real front door (and the separate accessible door, when it's a different
door) for 67 campus buildings, with barrier-free and auto-opener flags per
door. Free, public, no login. Checked it against what the app currently ships
as each building's "main" door: for the 66 buildings that could be matched,
the app's door was within 15 m of UT's real one only 27% of the time. The
other 73%, the correct door was already sitting in the app's own data,
placed right, just labelled "secondary" — so the router (which only ever
routes to a `role: main` door once a building has one) was structurally
blind to it. Worst case, Engineering Education and Research Center, sends
you 56 m past the real door.

Also settled the lighting question: `data/ground.geojson` really does have
no `lit` tags, confirmed — but the app already has 532 OSM-sourced street
lamps baked into `data/props.geojson` and just isn't using them for
anything route-related yet, so that's a wiring problem, not a missing-data
one. And the "avoid stairs" toggle already works for the walking path, it
just doesn't know a building's "main" door can itself be up a flight while a
barrier-free door sits on another wall — which UT's own data proves happens
on real buildings (Batts Hall, for one).

Wrote it all up with sources and a live-requeryable method in
`docs/walk-evidence.md`, including a ranked fix list for whichever lane
builds next: import UT's layer as a second source of truth alongside OSM
`entrance=main`, and stop collapsing near-tied derived candidates down to a
single door that's the only thing the router will ever consider. Nothing in
`js/wayfind.js` or the bake changed this round; `WAYFIND.on` untouched.

## 2026-08-23 — the walk interface, rebuilt for a phone: and the first thing found was that the last phone fix had been silently switched off by a comment

Went to make the walking UI good enough to put next to a real transit app at
phone size, took a picture of what we ship today at 390x844 first, and the
picture was worse than anyone thought. The answer bar was a 197-pixel column
jammed on top of the three buttons in the top row, its headline broken over two
lines, and `Show route` wrapping inside its own button. That defect had been
fixed once already — and the fix had stopped working, because the long comment
explaining it accidentally ended twice. CSS read the second half of the
explanation as the name of the rule, decided it was nonsense, and threw the
whole rule away. Everything below only became visible once that was repaired.

What the answer looks like now: the minutes are big, the building you are
walking FROM is printed (until now the app quietly guessed it from wherever the
camera was and never told you), and under the numbers there is a thin strip of
the whole walk with a mark on it for every staircase and every crossing, in the
right place along the route. So "three sets of stairs" stops being a number and
becomes "one near the start and two in the last third", which is the part you
actually plan around. The strip is deliberately flat — it is not a hill profile
and can never become one, we have no elevation data at all.

The part that a maps app cannot copy: when you are actually walking the route in
the 3D city, the bar changes on its own. It shows what is left rather than the
whole journey, an arrow that points at the next turn from wherever you are
facing, how far that turn is, and a dot travelling along the strip. It costs
nothing when you are standing still — it only recomputes while the camera moves.

The search panel got the boring, important things: rows big enough to hit with a
thumb, a visible highlight on the row the Enter key will take, four example
building codes to tap on a first run, a swap button, and a clear X in each
field. The placeholder stopped being cut off mid-word.

Checked by driving the real page, not by reading the diff: the feature still
adds absolutely nothing to the page when it is off, and nothing of it appears in
any of the three recording modes — the gate now walks every element the feature
owns rather than the three it used to name. Fifteen screenshots in
`shots/walk/ui/`, the whole write-up in `docs/walk-ui.md`. Branch `acer/w-ui`.
`WAYFIND.on` untouched.

## 2026-08-23 — walk UI, round 2 (Acer, `acer/w-ui`)

The walking view had an arrow that argued with its own words. It pointed at
where the next turn was, relative to whichever way you were facing — which is
true, and useless next to a line of text saying the route goes left. Photographed
on a phone: a big arrow pointing up-and-right over the words "then left". The
disc now shows the turn itself, and the top line of the bar is the next thing
that happens rather than the whole journey: "13 m, then left", with the minutes
left and the distance left on the line below. The code already knew which way
the turn went and was throwing the answer away two lines before it returned it.
A side effect: looking around with a swipe used to redraw the bar every few
degrees and now costs nothing at all, because nothing up there depends on which
way you face any more.

The other change you can see straight away: "Show route" is on the bar now
instead of hidden behind the little chevron. The camera never moves on its own —
that is deliberate — so the route the bar is describing can be completely off
screen, and until now the only button that would go and find it was also off
screen. There is one copy of it, it is thumb-sized, and it disappears while you
are walking the route because framing it from above is not what you want when
you are standing on it. On a building we cannot route to, it disappears too, but
"Clear" stays, so the bar is no longer a dead end.

Small ones that mattered more than they sound: the coloured marks on the route
strip had nothing anywhere explaining what a colour meant except a tooltip, and
tooltips do not exist on a phone — there is a one-line key now, and the stairs
colour sits inline in the sentence that already counts them. The stop-on-the-way
dot and the crossing dot were two blues six units apart and are now clearly
different. The door you should arrive at got a doorway icon and a bit more
weight, because which door is the one thing this app tells you that Google will
not. And the bar itself stopped pretending to be a single button while holding
five real ones inside it, which no screen reader could ever have made sense of.

One idea was measured and thrown away: padding the "show route" framing around
the answer bar so the route cannot hide behind it. Measured on three routes, the
plain version already puts 100% of the route below the bar, the bar-aware version
changed nothing, and the mirror-image version — pad the bottom instead, which
reads just as sensible — would have hidden half of the two longest routes. That
is written down above `fitTo` so nobody spends another round on it. It also
caught that the old screenshots were being taken before the camera had finished
flying, so every "here is the route framed" picture from round 1 was actually the
opening flight's end pose. This round's fifteen shots wait for the camera to
stop. Write-up in `docs/walk-ui.md`, shots in `shots/walk/ui/`. Branch
`acer/w-ui`. `WAYFIND.on` still false.

## 2026-08-23 — the walk now lists itself, step by step

The walking answer had a bar and a little map-strip of where the stairs and the
crossings fall, and it still had nothing that any other walking app has: the
walk written out in order. Open the details now and you get it — start, walk
33 m, turn right, walk 470 m, turn left, walk 24 m, Welch Hall, north side —
strung on one thread with the same marks the strip uses, so the picture and the
list can never say different things. Nothing in it is made up: it is the drawn
line measured, no street names (we have none) and no "turn left" orders, just a
description of the path already painted on the ground. Two things it learned
the hard way and both were caught by looking at the phone: it opened every walk
with "then a sharp right" before you had moved a metre — that was the little
straight line we draw from the door to the pavement, not a corner anybody has
ever turned — and on the way to DKR it listed twelve turns in 580 m, which is
describing the wiggle of the footpath rather than the walk. A turn only earns a
line now if there is real walking either side of it, and the distances still add
up to the total.

The rest of the round was the two views side by side with a real walking app at
phone size. "Show route" is a solid button instead of a tinted one. There is a
little walking figure in front of the minutes so the bar says what kind of trip
this is before you read a word. The stairs line stopped wrapping raggedly and
now always takes its own line. While you are walking, the bar lost a row and
gained a fact — the direction of the turn after the next one — and it is the
same height (196 px of 844) on every route now instead of 226 on some and 197 on
others. And the "13 m , then left" with the floating comma is gone.

Two defects were found only because the frames got opened and looked at: the
details card was long enough to run under the joystick, so the orange ring drew
straight through the middle of the step list, and two crossing marks on a long
route overlapped into something that looked exactly like an iOS toggle switch
sitting on the strip. The card is now measured against where the drive controls
actually are rather than a guessed number, and the two marks merge into one that
carries the count the card prints. Write-up in `docs/walk-ui.md`, seventeen
shots in `shots/walk/ui/`. Branch `acer/w-ui`. `WAYFIND.on` still false, so
none of this is on for anybody who has not asked for it by URL.

## 2026-08-23 — the walk interface, round 4: there was no button that put you on the pavement, so half the feature was unreachable

Lane `acer/w-ui`. The bar has always had two faces — the answer you read
standing still, and a different readout that appears once you are actually on
the route, with the next turn, which way it goes, and how much is left. Nothing
in the app ever put you on the route. Every picture of that second face for
three rounds was taken by a test script flying the camera down onto the line by
hand; a person holding the phone would have had to find the route from three
hundred metres up and fly down onto it themselves, with nothing telling them
there was anything down there to find.

So there is a **Walk it** button now, and it is the big one. Tap it and you are
standing on the path at eye height, looking down the walk. It is fussier than it
sounds: a building's front door is a point on its wall, and the app answers a
camera standing in a wall by lifting it onto the roof — so the button walks the
route outward until it finds ground with nothing over it, steps a few paces in,
and aims at a point twenty-five metres down the walk so a bend does not take the
path out of frame. Every one of those was wrong first and was found by taking
the picture and looking at it. **Show route**, which frames the line from above,
is the second button now, and **Clear** is an ✕.

Two other things. The little bar showing where the stairs and crossings fall
along the walk **was reading as a slider** — a thin track with a bright round
cap at one end, and while walking a white disc sitting in an amber fill, which
is a volume slider and nothing else. Thickening it did not fix it and neither
did colour. What fixed it is that every mark now cuts a notch clean through the
bar, so it comes apart into the stretches of uninterrupted walking between the
things that happen. No slider is segmented. And while you are walking, the bar
was carrying **two complete trip summaries stacked** — the second one counting
staircases you had already climbed. That row now says what is still ahead of
you instead.

The details panel is opaque now: it was 72 % glass over a rendered city and the
step distances were landing on bright grass.

Numbers, at phone size: after tapping Walk it on both test routes the eye is at
1.70 m, the walking readout arms, and the route covers **100 %** of the middle
of the lower half of the frame — measured by hiding the route, re-photographing,
and diffing, with an A/A control so a moving picture cannot fake it. Three
earlier ways of measuring that all gave wrong answers and are written up in
`docs/walk-ui.md`. The bar is 195 px walking, the same as before, having traded
a stale row for a useful one; no horizontal overflow anywhere; the feature is
still completely invisible in all three recording modes.

## 2026-08-24 — round 1 critic verdict on `acer/w-ui`: oursWins = NO

Fresh context, drove the shipped build on branch `acer/w-ui` (7 commits ahead
of the round-5 entry above) at 390x844 with a real Chromium
(`scripts/verify/chrome.mjs`, both SwiftShader and hardware GL), not the
builder's own screenshots. Confirmed the capture-mode hiding (`.clip` drops
`#wf-root` entirely; `.autopilot`/`.sliderdemo` leave it present but 0 of 64
descendants visible — clean) and re-ran `scripts/verify/walkmeter.mjs` against
this branch's own served app: 19/20 pairs measured, self-check held at 0.00 m
drift on every pair, 795 m total extra walking — same figure round `w-baseline`
reported off unmodified `main`, so nothing in this branch's routing regressed.

The finding that decides the verdict is not cosmetic. Traced `__fly.eye().alt`
every 500 ms after tapping **Walk it** on `JES → WEL` (an ordinary 530 m
class-to-class walk, not an edge case): the camera drops to 1.70 m (real
walking height) as it should, but across two of three independent runs it was
silently ejected back to 900 m — the exact altitude `Show route` uses — within
2-6 seconds, with no input from the user. The bar dutifully reverts to the
pre-walk summary the moment that happens (this is round 5's own "way out" fix
working correctly), but the net effect is that tapping the feature's headline
button, on a real route, does not reliably keep you walking. The two seconds
before ejection also render broken — a band of magenta and a flat olive-green
block cut across the top of the frame, consistent with the camera sitting hard
against or inside the building at the route's start (the same failure class
`scripts/verify/README.md`'s walking-suite section documents for the
*scripted* walker, whose `findStart()` searches outward for open ground before
placing the camera; `walkIt()` in `js/wayfind.js` does not appear to run the
same check before dropping the live camera at the route start). Reproduced
with `?walk=1&from=JES&to=WEL&fit=1&drift=0`, click `.wf-act-go`, sample
`window.__fly.eye().alt` every 500 ms — two frames cited,
`shots/walk/ui/r6-critic-eject-groundview.jpg` (t=2s, still on the ground,
glitching) and `r6-critic-eject-reverted.jpg` (t=4s, back at 900 m, `Walk it`
button restored, headline back to the whole-journey sentence).

Blind side-by-side against real Citymapper product screenshots (their own
"Turn-by-turn directions for Walking" post, phone-cropped) was still run for
the two requested views and it also does not go ours' way on its own terms:
Citymapper's pre-walk sheet has exactly one action (a single green **GO**
pill) and its during-walk view has exactly one instruction in a dedicated
full-width bottom card. Ours puts three same-weight actions (Walk it / Show
route / ✕) in one row of the closed bar and stacks current-turn + remaining
ETA + destination note + next-step preview + two buttons into a single
persistent top card while walking — denser and more capable (no-stairs and
entrance-side callouts Citymapper doesn't have) but not calmer, which was the
brief. That alone would be a real but arguable loss; the camera ejection is
not arguable.

**oursWins = false.**

**Single biggest gap, concretely:** `walkIt()` in `js/wayfind.js` places the
live camera at the route's start point without the open-ground clearance check
`scripts/verify/lib/walker.mjs`'s `findStart()` already does for the scripted
test walker (search outward for a point where `roofAt(p, 7 m) === 0` before
dropping to walking height) — so on at least one ordinary real route the
walking view renders broken for ~2 seconds and then self-ejects back to the
900 m aerial summary within 2-6 seconds of tapping the feature's own primary
button, with no user input. Port the same clearance search into `walkIt()`'s
start placement before this ships.

Not independently re-verified by me, corroborated only from the branch's own
round-5 writeup: the separate, already-documented "`Show route` puts up to
100% of some routes behind the answer bar" defect (measured by round 5, not
fixed, explicitly handed to whoever owns the camera). Still open.

Branch left as found — no files the builder owns were touched. Ran from a
worktree on port 8855, server killed and confirmed free, browser processes
closed, no scratch scripts left in `scripts/verify`. Two frames added under
`shots/walk/ui/` (114 KB combined) because this entry cites them; nothing else
written to the repo.

## 2026-08-23 — the stairs: one was drawn nowhere, and "avoid stairs" was walking people over them

Went after the stairs. Three things were wrong. First, the city was drawing 188
of the 189 staircases OpenStreetMap has mapped on campus — the missing one, on
the plaza at the north-west corner of the PCL, is tagged as a stepped *area*
rather than a stepped path and was falling through a gap in the bake, so the
router happily sent people up a flight the city drew nowhere. It is drawn now,
and every drawn staircase carries the OSM id it came from, so "the route has 3
sets of stairs" and "here are the stairs on the ground" can be checked against
each other by name instead of by eye. That also settles the 179-versus-189
confusion: they were always the same staircases, because touching flights merge
into one drawn shape.

Second, and this is the one that mattered: the **Avoid stairs** toggle was
lying. A walk is the mapped path plus two straight lines we draw ourselves from
the path to each door — and on four buildings (the Computation Center,
Magnetics, Studio Art, CS3) that last line runs straight over a flight of steps.
Out of 140 routes where the app offered a stairs-free way, 11 of them still
walked over a staircase. Batts Hall to the Computation Center was the worst:
ticking the box changed nothing at all, and the card said "No stairs on this
route" while the last thirty metres went down a flight. The avoiding route now
refuses to arrive at a door it cannot reach without steps — it costs 32 more
metres on that one, and 11 of 11 are clean now with no route lost.

Third, you had to know the toggle existed. Every route with stairs on it now
works out the way round at the same time, checks it really is stairs-free, and
hands it back with what it costs — and when there genuinely is no way round
(about one stair route in six) it can say that instead of offering nothing. The
route also now knows *which* staircases it uses, where along the walk each one
starts, and which way you are going over it where OpenStreetMap says. That costs
about a millisecond. The interface for it is written out ready in
`docs/walk-stairs.md` for whoever owns the card — four lanes are in that file
this round and I stayed out of it. Pictures in `shots/walk/stairs/`.
Branch `acer/w-stairs`.

## 2026-08-23 (later) — the stairs, part two: the card now shows them, and the way round is a button with the price on it

Part one put all the facts on the route and left the interface for whoever owned
the card. Nobody did, so this is that — plus four things that only turned up
once there was something to look at.

Ask it to walk from the Art Building to the Tower and it used to say
"Stairs: 7 sets" and give you a checkbox. It now lists them, in order, the way a
transit app lists a leg: which flight, how far into the walk, and which building
it is beside ("620 m in · near WEL"). It says "up the steps" or "down the steps"
where OpenStreetMap has recorded which way is up, and plainly says it does not
know on the rest — that is one flight in eight today, and it is a bug in the
graph bake rather than missing data, so the exact patch is written down.

The way round is now a button with its cost already worked out — "Step-free:
14–19 min · 1.2 km / Avoids all 7 sets · 250 m further" — and when there is no
way round it says so in plain sight rather than in grey footnote text.

Four things the pictures and a 300-route sweep caught:

The offer and the button disagreed. It offered a step-free route on Art Building
→ Tower and then answered "no route that avoids mapped stairs" when you pressed
it. Every number was green while that was on screen; it was found by looking at
the screenshot. There is one step-free implementation now and one assertion that
says so.

Ticking "Avoid stairs" folded the card shut on the same click, so you turned it
on and the answer vanished. One line.

The card claimed it avoided 189 staircases when 21 of those sit on paths the
router cannot reach in any mode. It says 168, and the sentence above it that
contradicted the number is fixed too.

And the step-free route now uses any door rather than insisting on the ranked
front one — which is what UT's own accessible-entrance data says is right, and
which on its own rescued 21 of the 300 routes we tested from having no answer at
all and halved the typical detour. It still comes back to the front door when
the front door is within about forty metres of as good.

Pictures in `shots/walk/stairs/`, including the phone, since that is what he
judges it on. Branch `acer/w-stairs`.

## 2026-08-23 — critic pass on `acer/w-stairs`, round 1: the two checkable claims held, the third couldn't be checked

Independent critic, fresh context, own scripts (not the builder's — those live
in a scratchpad and aren't in the branch). Checked out `acer/w-stairs`, served
it on its own port, drove the real `?walk=1` feature with playwright-core and
real Chrome, not the builder's word.

**Re-derived the two numbers from the raw files myself**, not from the docs:
counted `highway=steps` ways straight out of `data/osm_cache/footways.json`
(189, one of them — `147362093` — tagged `area=yes`) and cross-checked every
`u:"steps"` feature in `data/ground.geojson` (180 polygons, every one carrying
a `wid`, together covering all 189 way ids including the `area=yes` one). Both
match what the branch claims to the digit.

**Ran a fresh 250-pair census** with my own random seed, calling the branch's
own `window.wayfindStairs()` and then independently re-requesting the
avoid-stairs route for every offer to check it myself rather than trust the
card: 97 of 250 pairs had stairs, 84 got a step-free offer, and every single
one of those 84 came back clean on a fresh request — 0 that still crossed a
staircase, 0 where the offered distance didn't match what pressing the button
actually produces, 0 leg-list ordering bugs. Also drove the real UI by hand
(not the API): typed a route with 7 flights, pressed the priced "Step-free"
button, and the headline actually became "No stairs on this route" — and
clicking the "Avoid stairs" checkbox on an open card left it open, both fixes
holding under a real click. Screenshots (desktop + a 393×852 phone frame)
looked, not just asserted: the leg list, the priced button, and the honest
"avoids 168, not 189" caveat all render exactly as the branch's own doc says.

**What I could not check: the Citymapper bar.** The brief asks to judge our
leg list against how Citymapper states steps in its own — I have no device
running the Citymapper app and no web equivalent that produces a real
turn-by-turn leg list for a campus walk; Citymapper's own public pages
describe step-free routing in marketing language and never show the actual
leg-list format, so `docs/walk-stairs.md`'s own comparison table (§R10) is
against that marketing copy, not a captured screenshot. That half of the bar
was never actually fetched, by the builder or by me.

**oursWins: false** — not because anything I could test failed (nothing did),
but because one third of the stated bar was never obtained, and a pass on two
of three isn't a win on the bar as written. The gap for next round: get an
actual Citymapper leg list for a real walking route with stairs in front of a
person (a phone with the app, or a support/help-centre page that shows one)
and diff our card against it directly — until that exists, "matches
Citymapper's format" is asserted, not verified, and shouldn't be treated as
closed.

## 2026-08-23 (round three) — the stairs read like a transit app now, because we finally went and looked at one

The last round was marked down for one reason: we kept saying our list of
stairs was shaped "like Citymapper's" without anybody ever having seen
Citymapper's. So this round started by getting it. Citymapper puts screenshots
of its own app in its public newsroom, and two of them show a walking
direction close up. Their row is three lines: how far away it is, then what you
do, then the name of the thing you do it at — "in 25 m / Turn right onto /
Goldsmith's Row" — with the leg's own size on the right. A third picture, from
their step-free feature, does something we weren't doing at all: it **names the
door it's sending you to**.

So five things changed, all of them because of what was in those pictures.

The list of stairs now leads with how far along the walk each one is, and names
the building instead of its code — "in 630 m / Steps at Robert A. Welch Hall"
where it used to say "Up the steps · 620 m in · near WEL". Every one of 210
staircases across a 300-route sweep got a real name.

The way round now tells you where it puts you down: "Ends at the north side of
Jackson Geological Sciences Building" instead of "It uses a different
entrance." It works out the side from where that door sits among the building's
own doors, and stays quiet when the building only has one. Fifty of fifty
checked out. It deliberately does **not** copy Citymapper's wording ("Best
Step-Free Entrance") — what we checked is that the walk has no steps on it, not
that the door doesn't, and those aren't the same promise.

Three things were only visible by looking at the picture, which is the whole
argument for taking one. The Art Building approach was printing three
near-identical rows in a row — three real staircases, but one thing you
actually do — so they're one row now that says "3 sets of steps". Anything
past 950 m was rounding to "1.1 km", so two different flights twenty metres
apart read as the same row twice. And the card was calling the same building
by its full name at the top and by its three-letter code four lines down.

While measuring the phone I found something bigger and it isn't the stairs'
fault: **the walk card is half the width of the screen on a phone, and runs
about eighty pixels off the bottom.** It's one CSS line — the card is pinned at
the halfway mark and then slid back, which leaves it only half a screen to grow
into. Fixing it makes the card 369 px wide instead of 197 and 634 px tall
instead of 926, so it fits with room to spare. That file belongs to another
lane, so the exact two lines are written down in `docs/walk-stairs.md` §R15
with the before-and-after pictures rather than made here.

Last thing: the safety check that stops a "step-free" route being offered when
it isn't really step-free had never been watched failing properly. Turning the
old switch on made the check *withhold* every bad route, which is it working —
green, not red. So there's a second switch now that removes the check itself,
and with it off the sweep reports 49 bad routes out of 55. That's the number
that check is standing between this feature and the person it's for.

Everything green: eleven checks over 300 routes, fourteen more that click the
real buttons. `WAYFIND.on` is still false — none of this is public yet.
Pictures in `shots/walk/stairs/` (`r3-*`). Branch `acer/w-stairs`.

## 2026-08-23 — the "avoid stairs" answer was walking people down steps, and the check meant to catch it couldn't see them

Every time this feature has said "no stairs on this route", it checked that
claim against the same file it built the route from. This round checked it
against two different files instead — the raw OpenStreetMap survey, and the
staircases the map actually draws — and the claim did not hold up. Out of 122
step-free walks offered across 300 routes, **nine ended by walking along a
mapped flight of steps**, and five more routes said "no stairs" while crossing
one. All of them had passed every test the feature had.

The reason is small and a bit silly. A route is the surveyed path plus two
straight lines we draw ourselves — from the pavement to your starting door, and
from the pavement to the door you're going to. The test asked "does that
straight line *cross* a staircase?", which works fine for a staircase you cut
across and fails completely for one you walk *down*, because a line running
along a flight never crosses it. It also treated a staircase as having no width
at all, when the map draws it three metres wide. So the worst case — the last
stretch to the door running straight down a flight of steps — was the one case
the check was incapable of noticing.

It now measures whether the last stretch lies *along* a staircase, using the
same three-metre width the map draws. Nine false promises became zero, and it
cost two offers out of 122. There is a picture of it: same camera, one setting
flipped — the dashed last stretch coming out of the middle of a lit staircase
while the card cheerfully says "No stairs on this route · no further to walk
than the route with stairs", and then the same view with the walk gone
elsewhere. Two of the four things fixed this round were only ever going to be
found by looking at a frame; the numbers were green for all of them.

Fourteen routes of 300 now have no step-free answer at all, up from seven. That
is honest rather than good — those are buildings whose only doors can be
reached only by stepping over a staircase, and the card says so plainly instead
of offering a walk that does not work. Also written down rather than fixed: the
headline still reads "No stairs on this route" on a card whose own body says
the last stretch crosses one. That line belongs to another lane, so the exact
one-line change is in `docs/walk-stairs.md` §R23. The whole test harness is now
written into that file too, so the next person can re-run every number in it
instead of taking my word for any of them. `WAYFIND.on` is still off; nothing
here is public yet. Branch `acer/w-stairs`.

## 2026-08-23 — the route now knows which of it has a streetlight on it, and shows you (branch `acer/w-lit`)

The city already draws 236 lights — 193 OpenStreetMap street lamps and 43 of
UT's blue-light emergency phones — and the walking router could not see a single
one of them. It can now. Ask for a route after dark and it tells you how many
mapped streetlights are on it, how long the longest stretch with none is, and
how many emergency phones are near it; on the map the route itself goes amber
where a lamp covers it and a cool grey-blue where nothing is mapped, with a
small amber ring drawn round the foot of every lamp it counted. Fly down to one
of those rings at night and the lamp post is standing in it — that was the test,
and it passes in both directions: where it says a lamp, there is a pole and a
pool of light in the frame; where it says none, the street is empty and black.
The marks fade back to a quarter strength in daylight rather than disappearing,
because you might be planning a walk you'll take at nine.

The honest part is how thin the data is, and it changed the design. Only about
9% of the walking network's metres have a mapped streetlight within 25 m, and on
64 of 100 random routes across campus there is no mapped streetlight anywhere at
all. So the feature does not quietly send you the long way round in the name of
safety — that would be steering by who bothered to map a lamp, not by where the
light actually is, and a longer walk after dark has its own cost. Instead, when
a better-lit way does exist, it works out what it costs and puts it on a button:
Kinsolving to the Lab Theatre reads *"A way with more mapped light, no further:
7 streetlights instead of 0"*, and one tap takes it. Where an alternative exists
at all it's a median 2% longer for five more lamps. Nothing says "safe" or "well
lit" anywhere — every sentence is about what the map holds, and it says out loud
that real lighting is denser than OSM's and a mapped lamp can be out.

Two things fell out of the verification worth knowing. Every graphics preset
draws all 236 lights, so the claim can never disagree with the scene because
someone turned quality down. But `js/lod.js`'s detail-distance list names four
prop layers that no longer exist, so it drops the lamp glow at altitude while
never dropping the furniture it thinks it is dropping — written up, not touched,
it's another lane's file. Full write-up and the pictures: `docs/walk-lit.md` and
`shots/walk/lit/`. `WAYFIND.on` untouched.


## 2026-08-23 — the walk now knows where people said it was dark, not just where a lamp is mapped (`acer/w-lit`, round 2)

This morning's pass could tell you how many streetlights OpenStreetMap has
mapped along your route. Its own write-up said the honest problem out loud: 193
lamps for the whole city is obviously an undercount, and somebody should go
looking for more. So this pass went looking — and found something better than
another list of lamps.

In 2017 the City of Austin put up a public map and asked West Campus where it
needed lighting. **262 people dropped a pin and typed why.** *"This street isn't
lit at all at night."* *"The alleyway here is very dark at night."* *"San
Gabriel from 23rd to MLK is very dark."* *"Walking behind 2400 is really
sketchy."* It is a real, official, public city dataset, and nothing in this
project had ever touched it. 182 of those pins are inside the city we draw, 100
with the person's own words attached, and they are now part of the walk feature.

**Why it matters more than the lamps do, for the walk that actually matters.**
West Campus — where you walk home at one in the morning — is exactly where the
lamp data runs out: 58 mapped lamps in the whole neighbourhood, touching 7% of
the walking network. The residents' pins touch 33% of it, more than four times
as much. And the two sources agree: only 3 of the 182 pins have a mapped lamp
anywhere near them. Where people said it was dark, the map has no light either.

So a walk from the CS building home to 2400 Nueces used to say "no mapped
streetlight along this route" and stop there. Now it says that, and then: **"6
spots on this route were reported too dark"**, and quotes one of them, and says
who said it and when. Each of those spots gets a violet diamond on the pavement
you can walk up to.

**It still does not send you the long way round on its own** — that argument
did not change, and this is a 2017 survey of whoever happened to fill in a form.
But the button that offers you a different way now has something to work with in
West Campus, where before it had almost nothing. Over 36 walks home, offering an
alternative went from 17 to 25 — eight routes that now have an option they did
not have — at exactly the same median cost of 24 extra metres. Nothing anywhere
says "safe" or "dark"; every sentence names the City of Austin and the year, and
says plainly that lights may have been added since, because that is what the
survey was for.

**Checked by flying there at night and looking, in both directions.** The test
picked its two spots from the data, not by eye: the pin furthest from any mapped
lamp (563 m — the San Gabriel one) and the pin nearest one (9 m, where somebody
wrote "too dim"). At the first, the frame is black — no pole, no light, nothing.
At the second, a lamp post is standing there in its own pool of light. The claim
and the city agree at both ends. One honest wrinkle found and written up: on
streets with nothing mapped, our own night lighting still paints a soft glow
with no lamp post under it, which could make the feature look wrong even though
the words are careful — that is in `js/night.js`, another lane's file, so it is
written down and not touched.

Also found while looking and left for someone else: **UT publishes 116 emergency
phones and we only draw 43**, and UT publishes its SURE Walk night-escort zones
with the phone number. Both are in `docs/walk-lit.md` §16. Pictures and the full
argument: `docs/walk-lit.md` §9-§16 and `shots/walk/lit/wc-*.png`. `WAYFIND.on`
untouched.

## 2026-08-23 — lit lane, round 4: the lighting box was unreadable, so it got a picture

Three rounds of this lane kept proving the streetlight claim was true and never
once looked at the box it prints in. So I took a photograph of it. On the walk
home into West Campus — the exact walk this whole thing exists for — the
lighting box was **59% of the whole route card, twenty lines, 162 words**, and
"No mapped streetlight along this route" was set in the same grey, at the same
size, as three paragraphs of small print about where the data came from. Nobody
reads that at 11pm, which also means nobody was reading the careful honest bits
either. Before and after are `shots/walk/lit/cardfull-before-GDC-TheCastilian.png`
and `cardfull-after-GDC-TheCastilian.png`.

**Now the first thing in the box is a picture of your walk.** One bar, left to
right, start to door: amber where a streetlight is mapped beside the path, cool
blue where none is, and a violet tick everywhere a resident reported it too
dark. You can see at a glance that a walk is dark at the *start* versus dark at
your *door* — same sentence before, completely different walk. Under it the
count is now the one big line, the small facts share a row, and the three
source paragraphs are behind a single line that still says the two things that
matter out loud: **"Mapped lamps only, and not a safety rating."** Nothing was
deleted; one tap and every date and source is right there. Words on screen
dropped 36-46%, the box shrank by about a fifth, and it gained the picture.

**Then I checked the picture against the real city, at night.** Put a finger on
the bar, read it as a fraction of the walk, fly there, look. Twelve places on
eight routes: everywhere the bar is amber there is a lamp post burning in frame
with our little ring around its foot (`r4-strip-WEL-amber-disc.png`), and
everywhere it is cool there is nothing at all — not one lamp pixel at any of the
eight (`r4-strip-GAR-cool-disc.png`). I also checked the bar can never show more
light than the count claims, over 40 routes: worst case it is off by five
hundredths of a percent, and never in the flattering direction.

**And I went back to a place the last round deliberately skipped.** Round 3
tested "no streetlight here" only where the nearest lamp was more than 60m away
— the easy half. I sampled the hard half, 25 to 60m, at 18 places: **half the
time you can see a streetlight standing there anyway.** The card isn't lying —
it counts lamps within 25m of your path — but it is right in a way that would
get it called wrong. Rather than widen the radius (which would inflate every
number in this feature), a route with no streetlight at all now adds "· 2 more
are mapped within 50 m of it". I measured before writing it: that fires on about
one route in twenty and says one or two, so it costs nothing the rest of the
time. The thing it does *not* fix is written down — a single dark stretch 28m
from a lamp still reads as dark.

Nothing about the routing changed. Every steering number is byte-identical to
last round, the feature still only annotates unless you press the button, and
`WAYFIND.on` is untouched. Full argument and every number: `docs/walk-lit.md`
§25-§31.

## 2026-08-24 — streetlights, round 5 (`acer/w-lit`)

**Last round left one thing hanging and I went and measured it.** The bar in the
lighting box is amber where a streetlight is mapped and cool where none is — but
a cool stretch 28m from a lamp looks exactly like a cool stretch 300m from one,
and last round said somebody should find out whether that matters. It mostly
doesn't: **the average cool stretch on this campus is 228m from the nearest
mapped streetlight**, and only 7.5% of all the cool walking is within 50m of
one. Painting a third colour on the bar would have repainted about 4% of it and
chopped it into more pieces on more than half the routes. So I didn't. That's the
second idea this feature has thrown out by measuring it rather than arguing
about it.

**What the measuring did turn up is how far you can actually see a streetlight.**
I flew to 24 cool spots at night, sorted by how far the nearest mapped lamp is,
and looked: at 25-30m away you can see it 5 times out of 6, at 35-40m 3 times
out of 6, and **at 40-50m you cannot see it at all, 6 out of 6**. The card used
to say "2 more are mapped within 50 m of it" — so it was pointing at lamps
nobody standing there could see. That's now 40m, the distance where seeing one
stops. Exactly one route in sixty changes.

**Then I checked the amber half properly for the first time.** Every round so far
has been hardest on the "no light here" claim and easy on the "there is light
here" one. Twelve amber spots, picked by a script, flown to at night: ten have a
streetlight burning in the frame. **The two that are pitch black both have a live
oak sitting on top of the lamp** — hide the trees and 4,000 pixels of lamplight
appear. That's the thing round 3 found at two places, and it now predicts
perfectly: every tree-covered lamp I looked at throws no light you can see, and
every uncovered one does.

**Which showed up one thing we were getting wrong.** We draw a little amber ring
on the ground at the foot of every streetlight we count — it's the receipt, so
you can stand in one and see the pole. At a lamp with a tree over it that ring
was at full brightness with **no light in it at all**. It's now dimmer for those
— same ring, same shape, just darker, so it reads as "counted, but don't expect
much". Before and after: `r5-ring-covered-before.png` and `r5-ring-covered.png`.

**And I checked last round's rebuilt box on a phone, which nobody had done.** It
was measured on a laptop screen. On a 390px handset the bar still shows all seven
of its amber marks — same as on the laptop — and it never claims more light than
the count, same as on the laptop. The rebuild holds up. One thing that doesn't,
and it isn't mine to fix: **the whole route card is only 153px wide on a phone,
39% of the screen**, so every sentence in it wraps three or four times with empty
space either side. Photo and numbers are in `docs/walk-lit.md` §38 for the lane
rebuilding that card.

Routing untouched again — every steering number identical to round 3.
Full argument, every number and the three instruments that lied to me first:
`docs/walk-lit.md` §32-§41.

## 2026-08-23 — the walk now ends at the door a student actually uses, because UT publishes which one that is

Branch `acer/w-door`. Simeon's complaint was that routes take you to a farther
entrance than you have to go. They did. UT's own campus map publishes a
hand-surveyed list of the real front door of 67 buildings, and this build was
ignoring it — scored against that list, the door we walked you to was the right
one on 16 of the 55 buildings we can route to.

Across twenty class-to-class routes, the walk now ends **4.8 metres** from the
door UT puts on its own map, down from **66.6**, and every single one of the
forty doors is now within 15 m of UT's — it used to be seven of them. Across all
55 buildings the worst door the router might pick is 3.7 m out, down from 29.1.
Some routes got shorter by a lot: Waggener to Hackerman went from 537 m to
295 m. One got longer on purpose — Patterson to Biological Laboratories went up
94 m, because the old route stopped 62 m short of the actual door and left you
to find it yourself.

Three things did it. UT's survey now beats our own scoring wherever it exists.
Where UT names a door we never placed at all, the route goes to UT's coordinate
and snaps onto the nearest mapped path, with the last stretch drawn dashed and
counted like every other unmapped bit. And on the 228 buildings UT does not
cover, a side door is finally allowed to win when it genuinely saves a walk —
but only if it saves more than 55 m, which is what keeps the old back-door bug
from coming back. "Avoid stairs" also learned that a door can be up a flight
even when the path to it is flat, which is a thing UT records per door.

The bake was fixed too, so it survives: 30 doors relabelled and 47 doors placed
that we simply did not have. That part does not reach the router until
`data/walk_graph.json` is rebaked by the lane that owns it — one command, written
down in `docs/walk-door.md` along with the numbers, the pictures, a one-line
copy patch for the door caption, and the one thing not verified this round (no
walking-height photograph of a newly placed door; the ground-level poses died on
the watchdog with several other lanes on the machine). `WAYFIND.on` untouched.

## 2026-08-23 — round 2 of the door pass: the photographs that were missing, one more building reachable, and the thing that turned out not to work

Went back for the three things the last round left open. The doors it placed
from UT's survey had never been photographed from the pavement, so they are now:
the Main Building's west entrance, Biological Laboratories' west steps and the
Seay Building's southwest doors, all shot standing on the ground at eye height.
They are real modelled doorways with steps and glass, on the walls UT names.

Jesse H. Jones Hall was the one building the router still sent you to the wrong
side of, because its entrance is 57 metres from the nearest mapped path and the
old rule refused anything past 45. Rather than argue about it, we stood on the
path and looked: it is an open, paved courtyard between the building's two wings
with the door at the far end, nothing in the way. So the walk now goes up the
courtyard — 700 m to the right door instead of 830 m to the wrong one, with
those last 57 m drawn dashed and counted like every other unmapped stretch.

The Health Learning Building used to answer "we can't take you there", because
we hold no door on it at all and the code gave up before it checked UT's survey.
It routes now, both ways, to UT's own north entrance.

Across every building UT surveyed, the worst door the router might pick is now
2.5 m out, down from 3.7, and all 56 of them are inside 15 m — up from 54 of 55.
The twenty-pair number did not move, and was not meant to: all forty of its
doors were already right.

The interesting failure: the plan was to make the *guessing* better for the 228
buildings UT does not cover. So we held UT's answers out and used the 55
buildings it does cover as a marked exam paper for the guessing rule. Every rule
we tried scored between 27 and 31 metres, and even cheating — picking the best
door we hold — is still 18 metres out, because for 26 of those 55 buildings the
right door simply is not in our data. It is a missing-data problem, not a
ranking problem, and no cleverer rule fixes it. Worth knowing before someone
spends a week on a better guess. The same test does put a number on Simeon's
original complaint though: on a building nobody surveyed, the door we pick is a
median 95 degrees around the building from the one UT names, and 12 times out of
55 it is on the opposite side. Two other UT data sources were checked as
possible fixes and both turned out to be building centres, not doors.

Branch `acer/w-door`. Details, tables and pictures in `docs/walk-door.md`.
`WAYFIND.on` untouched.

## 2026-08-23 — door lane, round 3: the number is checkable now, and it caught a bug

The last two rounds got the walk ending at the right door and wrote the result
down. Read back hard, both had the same hole: **nobody else could check the
number.** The twenty pairs and the thing that measured them lived in a scratch
folder that no longer exists, so "96.8 metres" was a claim, not a measurement.
So the first job this round was to put the ruler in the repo:
`scripts/verify/walk-pairs.json` has the twenty walks and says why each one is
in the list, and `scripts/verify/walkmeter.mjs` drives the real page and scores
them. Anyone can run it now, and it prints the before and the after side by
side because it flips the switches itself rather than trusting an old note.
It comes out at 96.2 metres over twenty pairs against 1,333 before, and all
forty ends of those twenty walks are within 15 m of the door UT itself puts on
the map.

Then measuring the accessibility side found something ugly. **Every walk to or
from the UT Tower failed when you ticked "avoid stairs."** The card just said
"No walking route found." The reason is that the Tower's west entrance had been
attached to the nearest bit of pavement, which happens to be up on the Tower's
own plinth — and every way off that plinth is a staircase. Thirty-seven paths
you can reach from up there without steps, versus ten thousand seven hundred if
you're allowed to climb. So the walk was being started somewhere you couldn't
leave. Fixed: with the toggle on, a door now has to attach to pavement you can
actually walk away from step-free. That costs the Tower about four extra metres
of dashed line and gives back three buildings that used to be unreachable —
the Tower, the Music Recital Hall and Jackson Geosciences. Fifty-five of the
fifty-six UT buildings can now be reached without stairs, up from fifty-two.
The last one, the Jones communication building, genuinely can't: every door we
hold on it is up steps, and pretending otherwise would be a lie.

Pictures in `shots/walk/door/`: `stepfree-mai-before.jpg` is the Tower with "No
walking route found" on the card, and `stepfree-mai-after.jpg` is the same view
with a real step-free walk. `stairsdoor-par-off.jpg` / `stairsdoor-par-on.jpg`
show the toggle moving the Parlin Hall door 41 m from the east side, which UT
records as having neither a ramp nor an automatic opener, round to the west
side, which has both.

Two open questions from earlier rounds are now closed rather than open. Eleven
UT buildings don't route, and that turned out to be fine: ten of them are at the
Pickle research campus eleven kilometres north, outside everything this app
draws, and the eleventh isn't in UT's own campus register either. And Simeon's
sidewalk hunch got a real test — the idea that a footpath which dead-ends at a
building was built to reach its door. It doesn't work here, and the reason is
interesting: campus paths are a mesh, not a set of driveways. Out of eleven
thousand junctions only six hundred are dead ends, so "where the pavement stops"
barely says anything about where a door is. The sidewalks themselves are fine —
92% of them are one connected step-free network. It's the doors that are
missing, which is the third experiment in a row to land there.

Branch `acer/w-door`. Tables, the full harness output and the reasoning are in
`docs/walk-door.md`. `WAYFIND.on` untouched.

## 2026-08-23 -- critic pass on acer/w-door, round 2: the door numbers hold up, the stairs toggle does not

Re-ran scripts/verify/walkmeter.mjs myself, fresh server on a clean port, not
trusting the builder figure: 1,333 m of extra walking over the twenty pairs
before this branch, 96.2 m after; every one of the forty pair-ends lands within
15 m of the door UT itself publishes; mean worst-case door error across all 55
UT-surveyed buildings this build can route to, 29.1 m down to 2.5 m. The door
work is real and it holds. But driving the actual UI (not the wayfindRoute API)
found a break in the exact feature this round measured hardest: click "Avoid
stairs" in the route card and the whole panel snaps shut instead of turning the
toggle on -- the checkbox click bubbles up to the pills own click handler
(js/wayfind.js:1999), which flips state.expanded back to false and collapses
the card before the checkboxs change handler (js/wayfind.js:2225) can stick.
Confirmed three ways, including a real mouse click at the checkboxs exact
pixel coordinates: the box stays unchecked after you click it. The routing fix
behind the toggle is sound -- walkmeter drives it directly and it is clean on
9/9 buildings -- but a person who actually cannot climb stairs, clicking the
control Simeon asked for by name, cannot turn it on. Not shipped as-is.
## 2026-08-23 — the routes were already on the sidewalks; what was crossing the lawns was the last few metres to the door (`acer/w-sidewalks`)

Went in expecting to find the router ignoring the 1,324 sidewalk shapes the
scene draws, and that turned out not to be true — measured against every
polygon in the ground file, 99.9% of the walking network already runs over
pavement the city actually paints. The metres that were crossing grass were
the little straight lines from a building's door out to the nearest path. The
router had been treating those as if they were pavement, so whenever cutting
25 metres diagonally across a lawn saved 25 metres of real walking, it did it.
Burdine Hall was the clearest one: its front door has a path 2 metres away and
another 28 metres away on the far side, and the router kept picking the far
one, drawing a dashed line straight over the roof of the building.

So a door-to-path link now costs four times what a metre of real sidewalk
costs. The router will still use one when there is no alternative — it has to,
that is how you get out of a building — but it will happily walk up to four
extra metres of real pavement rather than invent one. Across twenty
class-to-class walks that cut the invented straight line from 485 metres down
to 164, and cut the metres of route sitting on grass or on bare ground from
308 to 124. Routes got 2.7% longer, which is the honest price and is the right
trade: they are longer because they are no longer taking shortcuts that do not
exist.

The second thing was smaller but it is everywhere. Sidewalks in the scene were
stopping a stride short of every street corner in the city — about 1.4 metres
of bare ground between the end of the pavement and the edge of the road, at
both ends of every crossing, roughly 2.2 kilometres of it in total. The bake
deliberately does not draw crossings (painting 800 crosswalks would put pale
ribbons across every street), but the kerb ramps at each end are not road
markings, they are the sidewalk. They are drawn now, and the resolver still
scrubs off anything that overshoots onto the road, so the streets look exactly
as they did. Ground file grew 50 KB compressed.

Together: 95.4% of a drawn route is on pavement now, up from 93.7%, and 98.6%
is on either pavement or a street it is legitimately crossing. Before-and-after
pictures of four routes and two street corners are in
`shots/walk/sidewalks/`, the full method and every number is in
`docs/walk-sidewalks.md`, and the biggest thing left is written up there too:
the malls and the Six Pack are plazas, the graph only knows their outside edge,
so routes walk around them instead of across — that one needs a change in the
graph bake, which is a different lane's file. `WAYFIND.on` untouched.

## 2026-08-23 (later) — the campus malls were being drawn as lawns, so the route floated over them

Picking up the same branch after the kerb-apron pass. That pass had already
found the important thing — the router was never ignoring the sidewalks, it was
spending invented door links as shortcuts — and it noticed in passing that a
route across the Main Mall scores as "off pavement" because OSM draws a mall as
a ring and the route walks its edge. It worked around that with a ten-centimetre
tolerance. This pass fixed the cause instead.

Forty-four of the pedestrian areas on campus — Main Mall, East Mall, the
Speedway courts, the Jester, Gates and Blanton forecourts — were being drawn as
flat coloured areas, in the same family as lawns and parking lots. Everything
else you walk on in this city is a slab standing 22 cm proud, and the walking
ribbon's height is pinned to that slab, so over a mall the ribbon was floating
22 cm in the air. A mall was also a different colour from the footpaths crossing
it, in the same frame, both concrete. The bake's own rules already said a mall is
a walk; only one branch of the code was putting it elsewhere. One switch.

The share of the twenty test routes lying on a drawn walk went 86.7% to 90.2%,
and eight of the twenty moved — PCL to Patton Hall goes 54% to 78%. It costs
nothing: the ground file is the same size to the kilobyte gzipped, because the
polygons only changed which family they belong to. Two numbers went very slightly
the wrong way (ten metres out of thirteen thousand) and that is written down
rather than hidden. Look at `shots/walk/sidewalks/aprons-2-eastmall.png` next to
`malls-2-eastmall.png`: the Jester forecourt goes from a flat grey slab with the
route running along its edge to paving the same colour as the walks that cross
it. The malls being warmer and raised is a taste call and it is one line to undo.

Also moved the measurement into the repo. `python scripts/bake_ground.py
--walkaudit` routes twenty real class-to-class walks with the app's own cost
model and reports what every metre of the drawn ribbon is standing on. The last
pass's scripts lived in a scratchpad and are gone; this one does not. Still not
fixed, and still another lane's file: the router walks around a mall rather than
across it, because OSM only gives it the rim. `WAYFIND.on` untouched.
## 2026-08-24 — the baseline meter, built: 20 real class-to-class pairs, a real number

The recon above never got turned into an actual measurement before the run
that was doing it died (disk full, not a code failure). This picks that up.
Built `scripts/verify/walk-pairs.json` (20 real building-code pairs a UT
student would actually walk back-to-back — GDC→JES, WEL→PAI, and 18 more,
spread across campus, 5 crossing Speedway, 1 crossing the Drag, 2 confirmed
level-change routes) and `scripts/verify/walkmeter.mjs`, a reusable script any
of the five w-* lanes can point at their own branch to get the identical
measurement. Drove all 20 through the live app's own `wayfindRoute()` API
against unmodified `origin/main`, then compared each app-picked door against
the door UT Austin's own public entrance survey says is correct, using a
from-scratch Dijkstra reimplementation that self-checks against the app's own
reported numbers every single run (drift was 0.00 m on all 19 measurable
pairs this round — the one unmeasurable pair, PHR→BIO, is its own finding:
BIO's UT-verified door was never snapped to the path network in the bake at
all).

The headline number: **795 m of real extra walking**, summed only over the 6
pairs the current door mislabelling actually makes worse, worst single case
EER→NHB at +298 m (screenshotted, matches the measured number to the metre —
`docs/shots/walk-baseline-eer-nhb.jpg`). But the more useful finding for
whoever builds the fix: 9 of the other 19 pairs would get LONGER, not
shorter, if every building were simply forced onto UT's single verified door
— PMA→MEZ alone would get 231 m worse, because MEZ's two real, front-facing
doors sit on different sides of the building and PMA approaches from the side
the "wrong" door already faces. That's a live demonstration of exactly what
`docs/walk-evidence.md`'s own fix list warned about: collapsing a building to
one door, even a UT-verified one, isn't the fix — keeping near-tied
candidates open so the router picks per-trip is. Full writeup, the 20-pair
table, and the re-run instructions are in `docs/walk-baseline.md`.
`WAYFIND.on` still untouched; nothing in `js/wayfind.js` changed this round
either. Pushed as `acer/w-baseline`, self-merged after the self-check passed.

## 2026-08-24 — the walk interface, round 5: the door into the walk had no door out, and the little bar of the journey was still a slider

Lane `acer/w-ui`. Started by re-checking the four things the last rounds said
were fixed, on the shipped build, by driving the page rather than reading the
diff — the arrow that used to argue with its own words, "Show route" being
reachable without opening anything, no route opening with a turn onto a line the
app drew itself, and the phone rule that a doubled comment had once switched
off. All four hold, on three routes each where that made sense.

Then the two things that were wrong. Last round put a **Walk it** button on the
bar so you can stand on the pavement it just drew. Standing there, the only
button left on the bar was the ✕ — and the ✕ throws the route away. So the way
in was a trapdoor: tap the one control you can see and you are at eye level in
the middle of campus with nothing, and both buildings to type again. **Show
route** comes back while you are walking now; it lifts you out and the answer is
still there when you land. Tested end to end on two routes: the camera goes up,
the bar goes back to the whole-journey summary, the route survives and **Walk
it** is waiting again. Fixing that turned up a real bug hiding underneath it —
after the camera flew up, the bar sometimes kept showing the walking readout
from nine hundred metres in the air, and because the camera had stopped moving
nothing was ever going to correct it. It was stuck. It asks again now, a few
times, after any move that ends.

The other one: the little bar of the journey, with a mark on it for every
staircase and every crossing. On a route that has nothing on it — which is most
short walks between two neighbouring buildings — it is an empty band with one
bright round cap at the end, which is a volume slider and nothing else. That is
the third round in a row this one element has had to be argued out of looking
like a control, and the answer this time is to not draw it. If there is nothing
on the walk, the line above it already says so in words. The bar got a fifth
shorter on those routes (195 px down to 156 standing still, 133 while walking)
and did not move by a pixel on the routes that do have something to show.

Two smaller ones. The line that says **"Tight for a 15-minute passing period"**
was worked out once, for the whole walk, and never asked again — so three
minutes from the door it was still warning you about a walk you had nearly
finished. It is about what is left now, and it goes quiet as you get close;
measured walking down one route, it says it at the start and stops saying it
just under halfway. And the step-by-step list — the one thing this bar has that
looks like every other walking app — was behind a bare chevron in the corner
with nothing anywhere saying it was there. The chevron says **STEPS** now.

Photographed at phone size, six frames in `shots/walk/ui/`, and the bar was
checked at 320 px for the first time (it holds; the 21 px of overflow the page
reports at that width is not ours — it is identical with the whole feature
switched off). One thing measured and deliberately **not** fixed, written up
with the numbers: "Show route" frames every route from the same height, 900 m,
because the camera controller's ceiling is 900 m and the fit is asking for
higher — so on some bearings the whole route lands behind the answer bar. That
is not new and it is not the new button's doing (the old path does it too, on a
different route), and the fix is in the camera, which is not this lane's. An
offset on the fit was tried and measured and made it worse, same as round 2's
version of the idea. Branch `acer/w-ui`. `WAYFIND.on` still false, so none of
this is on for anybody who has not asked for it by URL.

## 2026-08-24 — w-ui round 6: the walk can keep the camera now, and the bar stopped looking like a segmented control

Picked up round 1's critic verdict on `acer/w-ui` and closed both halves of it.

**The ejection is real and I reproduced it 3 times out of 3** — tap `Walk it` on
`JES → WEL` at phone size, the eye drops correctly to 1.70 m, and two and a half
seconds later it is back up at 158 m with nobody having touched anything. But it
is not the defect it was reported as, and the reported fix would not have worked.
I logged every camera call in the page with its own stack, and the thing that
takes the camera away is **the opening title flight**: it is two legs with a
timer between them, `Walk it` stops the leg that is running and cannot stop the
leg that has not started, so leg two lands on top of the walk. On a deep link
with `&fit=1` there is a second one — the "frame the route" wait is watching for
exactly the quiet that `Walk it` itself produces, and it fits to 900 m, which is
the number in the report. The open-ground search the report asked for was
already there and working: probed at the walk pose, there is nothing over the
eye out to 2 m, and the nearest building mass is 4 m away, which is what a
pavement beside Jester looks like. The "renders broken, magenta banding" frames
are the same story — I re-shot that pose with every building layer hidden, then
every route layer, then every road layer, and the band is identical in all four:
it is the dusk sky and the flattened basemap seen at grazing angle, which is
forced, because the controller pins the camera's pitch to 84–88° at walking
height and a walking camera physically cannot look down. Handed to whoever owns
the sky.

**The fix is written the other way up: the walk owns the camera until you take
it back.** For nine seconds after the tap, anything that lifts the eye off the
pavement with no input in between gets undone; the first touch of anything at
all releases it for good, so it can never fight the person holding the phone,
and it gives up after three attempts rather than flicker. Before: ejected 3/3.
After: 4 runs, two with a real finger and two with a scripted click, still
standing on the pavement twelve seconds later with no input.

**The other half was the look, and the critic was right.** Three buttons in a
row — `Walk it`, `Show route`, `✕` — all wearing the same rounded box with the
same warm border. That is not three actions, it is the shape a phone uses for
one segmented control with three cells. The border and the panel came off the
two that are not the point, so there is now exactly one filled thing in the
whole feature and it is `Walk it`. Nothing is hidden and no word is lost —
`Show route` is still on the frame, still labelled, still a full-size touch
target. While walking, the same change removed a second amber object that had
been competing with the distance to your next turn, which is the only reason the
bar is on screen.

**And the entrance callout now arrives when you do.** `Entrances are on this
side` is the best thing this app says and it was printed for the entire six
minutes of the walk, where it is the longest line on the bar and not yet
something you can act on. It holds until about two minutes out and then appears,
with the building's name brightening beside it. The name is on the bar the whole
way, so nothing is lost.

Fourteen assertions, all green, including the four things the brief asked me to
re-check specifically (the arrow agreeing with the words, `Show route` being
visible, the walk not opening onto a line we drew ourselves, and the phone rule
that a duplicated comment terminator had once switched off), plus the feature
staying invisible in all three capture modes. Frames:
`shots/walk/ui/r6-bar-before-after.jpg`, `r6-walkbar-before-after.jpg`,
`r6-summary.jpg`, `r6-walk.jpg`, `r6-walk-approach.jpg`. Full writeup in
`docs/walk-ui.md` §35–40. Branch `acer/w-ui`, port 8815, server killed and port
confirmed free, no scratch scripts left in `scripts/verify`.

## 2026-08-24 — the walk bar reads as one journey again (`acer/w-ui`, round 7)

No critic came back this round, so I put our two frames side by side with real
Citymapper ones and judged them myself, at phone size.

**The one thing they have that we don't, we are not allowed to have — and that
is the right call.** Every Citymapper frame carries an arrival time: "Arrive
14:38" on the pre-walk sheet, "19 min / 14:38" while you walk. For a student
between classes that is the whole question. I was about to build it, and then
found this project's own honesty audit says in writing that we may never print
an arrival clock, because our minutes are a guess about somebody else's legs and
a clock turns a guess into a promise. So the gap stays open on purpose, and it
is now written down so the next round doesn't spend an afternoon rediscovering
it. The honest version of that answer is already on our bar and I think it is
better than a clock: "Longer than a 10-minute passing period."

**What was actually broken was ours, and we did it to ourselves.** Round 4 put a
little tick beside the building you start from and a little ring beside the one
you're going to, so the answer would read as one journey with a line between
them. Round 5 then deleted that line on every route with nothing on it — which
is most short walks — and nobody looked at what was left. What was left was two
stray marks two rows apart, with the middle of the bar set to a different left
edge, and the tick and the ring not even lined up with each other. It looked
like four unrelated lines of text.

The bar now has a spine: one hairline down the left, from the start mark to the
door mark, with everything about the walk sitting inside it. No new row, no new
word, nothing new claimed — just the two marks we already drew, joined. Before
and after: `shots/walk/ui/r7-bar-before-after.jpg`.

**And one thing on the walking bar was still dressed as a button that isn't
one.** "and then left" — the turn after your next turn — wore an amber disc in
the same row as two real buttons. Last round's rule was that only "Walk it"
gets a fill, and last round's test checked three buttons by name, so it could
not see this. It is a plain grey glyph now, and the test was rewritten to sweep
every element on the bar instead of a list somebody has to remember to update.
`shots/walk/ui/r7-walkbar-before-after.jpg`.

**Twenty-two checks, all green**, including the four the brief asked me to
re-confirm (the arrow agreeing with its words, "Show route" being visible, the
walk not starting on a line we drew ourselves, and the phone rule a duplicated
comment had once switched off), and the feature staying invisible in all three
capture modes. I also ran the same test against the old code first and watched
four of them go red, so they mean something.

**One thing I measured and did not fix, honestly:** tapping "Walk it" still
loses the camera roughly one time in five — the app's opening flight lands on
top of the walk a couple of seconds later and wins. I measured it before my
change and after, on the same machine, and it is the same on both, so I am not
claiming it. I did fix the half of it that is ours: the bar could end up showing
the summary while you were already standing on the pavement, because it stopped
asking where you were 720 ms after the tap and the camera doesn't settle that
fast on a busy machine. It keeps asking now.

Frames: `shots/walk/ui/r7-summary.jpg`, `r7-walk.jpg`, `r7-bar-before-after.jpg`,
`r7-walkbar-before-after.jpg`. Full writeup in `docs/walk-ui.md` §41–46. Branch
`acer/w-ui`, port 8815, one browser, server killed and the port confirmed free,
no scratch scripts left in `scripts/verify`. `WAYFIND.on` is still false.

## 2026-08-24 — round 8 critic verdict on `acer/w-ui`: oursWins = true

Fresh context, no memory of how hard round 7 tried. Checked out `origin/acer/w-ui`
at `806ad8f` into its own worktree, served it on 8855, drove the real `?walk=1`
feature at 390x844 in real Chromium — not the builder's screenshots.

**Camera fight (the round 1 critic's original finding): held.** Tapped `Walk it`
on JES→WEL and sampled `__fly.eye().alt` once a second for 14 straight seconds.
It read exactly 1.70 m on all 14 samples — never ejected. One run isn't the four
the builder logged, but it's a real, fresh, independent check and it agrees.

**Every specific claim in round 7's own writeup, checked, held.** The spine —
one hairline from the start tick to the door ring — renders correctly; closeup
at `shots/walk/ui/r8-critic-spine-closeup.png`. Exactly one filled control on
the closed bar (`Walk it`, `rgb(255,198,99)`); `Show route` and the "and then
left" next-turn glyph are both transparent-background, confirmed by reading
computed style off every visible button, not by eye. The feature stays hidden
(`display:none` on `#wf-button`/`#wf-sheet`/`#wf-pill`) under `?clip=1`,
`?autopilot=1`, and `?sliderdemo=1` — all three checked, all three pass.
`walkmeter.mjs` against this branch: 19/20 pairs, 0.00 m self-check drift,
795 m total extra — identical to `docs/walk-baseline.md`, so nothing upstream
of the UI broke either.

**The blind comparison, done for real this time.** Citymapper's own web app
(`citymapper.com/directions`, cookie banner rejected through its actual "Reject
All", not just accepted to get past it) turns out to have no live walking
navigation at all — a pure campus walk there is one line, "12 min · Show Map,"
thinner than anything on our bar. So the true bar — the GO-pill pre-trip card
and the "19 min / 14:38, turn left onto [street]" live card — was pulled instead
from Citymapper's own product blog,
`citymapper.com/news/2266/turn-by-turn-directions-for-walking`, which is the
first time this project has had the *actual* walking-specific screens instead of
a multi-modal marketing composite. Saved neutrally, shuffled, judged before
looking at the mapping: **ours preferred on both pieces.** Pre-walk: ours
carries entrance-side and stairs-on-route information Citymapper's card doesn't
have room for; during-walk: the first-person camera IS the orientation cue,
where Citymapper needs a 2D dot-and-cone to fake it. Real bar images at
`shots/walk/ui/r8-critic-citymapper-gopill-real.png` and
`-turncard-real.png` for whoever runs this next.

**The one gap Citymapper's real card has that ours structurally cannot close
without another lane.** Its turn card names the actual street — "Turn left onto
Rue de l'Échiquier" — twice. Ours never names a path anywhere, not on the live
bar and not in the expanded step list; it's distance-and-icon only ("24 m, then
right"). This is not a UI bug: `data/walk_graph.json`'s edges (`g.e`: `a b w f
s`) carry no name field at all, so there is nothing for `js/wayfind.js` to print.
Whoever owns the sidewalk graph needs to add a name to the edge schema before
any bar round can close this — it's the literal thing Simeon asked for
("sidewalks... identified properly and used to the advantage") and the one
thing the real bar visibly does that ours can't yet.

Ran `harness-drift.mjs` clean before starting. One browser, port 8855 confirmed
free after, no scratch scripts left in `scripts/verify` (six `_critic-*.mjs`
fetch/compare helpers were written and deleted in the same session). `WAYFIND.on`
untouched.
## 2026-08-24 — "there's no step-free way there" was the one thing we'd never checked, and five times in fourteen it wasn't true

Every round so far checked the walks the app *offers* — is this really
step-free, does it really avoid the steps. Nobody ever checked the walks it
*refuses*. When the app says "no step-free route we can find between these
two", that's a much bigger claim than it looks, and it's said to the one person
who can't just go and try it. So this round went and looked.

Built a second, completely separate map of campus straight out of the raw
OpenStreetMap files — every staircase deleted — and asked it, for each of the
fourteen refusals, whether a step-free walk existed anyway. It did. Fourteen
times out of fourteen. (The check earned its keep by failing its own sanity
test first: before it was allowed to accuse anything it had to independently
find the walks the app *had* found, and the first version only managed 111 of
120. Two bugs in the checker, both fixed, then 120 of 120.)

Then the harder question: is that the app's fault or the map data's? Asked the
same thing of the app's own map, and **five of the fourteen were the app's own
fault**. All five were Gearing Hall. It has two doors; both of them are pinned
to a little dead-end scrap of path whose only exit is a flight of steps. Block
the steps and the app is stuck on that scrap, so it concludes there's no way to
the building at all — while the real step-free path runs thirteen metres away.

Fixed by letting a walk leave the path network somewhere other than the two or
three spots the data pre-picked, and **only** as a last resort when the normal
search has already come up empty, so nothing that works today changes (checked:
all 120 existing step-free walks come back identical). The headline case is
Pharmacy Building to Gearing Hall: it used to say there was no step-free way,
and there is one — **eleven metres longer**. Screenshots of the card before and
after are in `shots/walk/stairs/`.

The first attempt at that fix was worse than the bug: three of the five new
walks drew their last stretch **straight through a building**, up to fourteen
metres of it. Caught it by measuring every one of those lines against the real
building outlines, then swept how far the search is allowed to reach and picked
a distance from the middle of the range where all five walks work and none of
them clip a wall. (Uncomfortable thing that fell out of the same measurement:
about one door-line in ten on *every* walk this app draws already cuts through
a building. That's older than this feature and belongs to the map-building
script, but it's written down now instead of nobody knowing.)

The nine refusals left over are genuinely impossible on the app's map and
genuinely possible on the ground — three buildings (Flawn Academic Center, the
Littlefield Home, Texas Student Housing) are marooned on islands whose only
links to the rest of campus are staircases. That's four specific missing
connections in `scripts/bake_walk.py`, written up with the exact IDs for
whoever owns it. Also re-checked the thing this lane is judged on first: all
189 mapped staircases are still drawn, none missing, none invented. The feature
is still switched off; nothing here is public yet. Branch `acer/w-stairs`.

## 2026-08-24 — Stairs, round 6: the walk was step-free and the door at the end of it was not

Every check this lane has ever run stops at the threshold. We prove the route
doesn't climb anything and that our own last straight line doesn't lie on a
flight — and then we deliver somebody to a door nobody ever asked about. UT
publishes the answer itself: for 98 celebrated entrances it says outright
whether each one is barrier-free, and where it isn't, it says why. Gearing
Hall's reads "Access is off 24th Street **up the stairs** and through the
courtyard." Our door sits four feet from that spot and is labelled the main
entrance.

Checked the step-free walks against that survey: of the 38 endpoints at a
building UT has surveyed an accessible entrance for, **20 were going to a
different door** — one of them 63 metres away, round the far side. So the
step-free pass now finishes the job: once it has a clean walk, it tries the
door UT actually names, and takes it if it isn't more than 150 m further. **29
of 38 now, for 353 metres of extra walking spread over 300 routes** — about
31 m on the ones it moves. Nothing that already worked got worse: the number of
walks offered and the number refused don't move at any setting, including with
the limit removed entirely.

The picture is Perry-Castañeda Library to the Physics building. Before, the
ribbon stops at the south side. After, on the same camera, it carries on round
to the north-east corner — which is the entrance UT lists as barrier-free.
Frames are in `shots/walk/stairs/`.

Two things it couldn't fix and one it shouldn't. Waggener Hall's accessible
door can only be reached over a mapped flight on our map, so refusing it is the
feature working. The Computational Engineering building's accessible door is
marooned on a 16-node island. And the big one, which belongs to the
map-building script and not here: **38 of the 60 accessible entrances UT
publishes have no door of ours within eight metres at all** — including Parlin
Hall, where the ramp UT describes simply isn't in our data, so every step-free
walk there arrives at the door UT flags. That list is written up with distances
for whoever owns it.

Also re-checked the thing this lane is judged on first: all 189 mapped
staircases still drawn, none missing, none invented, and all seven of last
round's checks still green. The stopwatch was thrown out — a route proved to do
zero extra work "slowed down" 72 % on a machine with five other lanes running,
which is what that number is worth today. The feature is still switched off.
Branch `acer/w-stairs`.

## 2026-08-24 — stairs, round 7: the app says "up the steps", and nothing used it

The card has always told you which way a flight goes — "up the steps", "down
the steps", off the direction OSM tags. Nobody had noticed that the part of the
app that *chooses* the route never looked at it. Walking up a hill and walking
down it cost the same, so every walk on campus came out identical in both
directions: over 300 pairs driven both ways, the distance matched **300 times
out of 300**, to the millimetre, including the 33 where the map says which way
is up.

The two pictures in `shots/walk/stairs/` are the whole thing. Same camera, same
two buildings, opposite directions. Going one way the walk comes down a 60-metre
flight beside Music Recital Hall. Going the other way, the old app climbed the
same flight — and the two photographs differed by **ten pixels**. Now the
reverse walk goes round the north side instead and the card reads "No stairs on
this route" for 62 metres more.

Eleven walks out of 600 changed. **Every single one got longer, none got
shorter, and not one picked up a staircase it didn't have** — eight dropped
one. Every flight anything walked away from is one the map tags as a climb;
there is nothing else in that list. Two of them are a 64-metre flight the router
swapped for a 6-metre one, which is a trade it simply couldn't see before. Total
extra walking: 449 metres spread across 600 walks, less than a tenth of a
percent.

The step-free walk did not move at all — 243 of them compared field by field,
zero changes, and the number of routes with no way round stayed at nine. Two
ordinary walks stopped touching stairs by themselves, so they no longer need an
alternative offered at all.

The price of a climb is the number that was already in the file — the same one
the time estimate has always used. Worth flagging for Simeon: **making it
higher keeps working.** Pushed hard, the router gets 32 of 34 climbs off the
route instead of 11, but people walk about 80 metres each to dodge flights as
short as two metres. That's a taste call, not a correctness one, so it's one
line to change and the whole ladder is written up.

Two things went red on the way and both deserved to. The pixel test was
measuring the city still loading — it claimed 193,000 "walk pixels" on a frame
where the real answer is about 9,800 — so a noise floor got measured first and
the test now refuses to shoot a scene that is still moving. And the stopwatch
was timing the wrong pair: it compared a route that *changes* between the two
settings, so it "proved" the new code made routing five times faster. Retimed
on a route whose answer is identical either way, it costs 0.06 ms on 7.6.

Re-checked first, before anything was touched: all 189 mapped staircases still
drawn, none missing, none invented, and all seven of round 4's checks still
green. The feature is still switched off. Branch `acer/w-stairs`.

**2026-08-24 — stairs, round 8 (`acer/w-stairs`).** UT publishes an official
list of campus entrances and says, for each one, whether you can get in
without stairs. Round 6 used the half of that list that says "yes, this door is
fine" and moved the step-free walk onto those doors. Nobody ever used the other
half — the entrances UT says are *up a flight of steps*, in its own words:
"Access is off 24th Street up the stairs and through the courtyard." That's
Gearing Hall, and our front door for it sits about a metre from that spot.

So this round asked the question that half of the list is for. Two of our doors
carry a "not accessible" verdict from UT. Two walks out of 123 in the test set
start at one of them — both from Parlin Hall — and the app handed both over with
a green "step-free" tick and said nothing. It now says something: the answer
carries which door, which building, which end of the walk, and whether it's the
only entrance we have for that building. And where a building *does* have
another door, the walk now leaves by that one instead.

The bigger result was accidental and it's the one worth reading. Before
changing anything I asked a question nobody had: **of the entrances UT has
surveyed, how many can a step-free walk on our map actually reach?** 19 of 22.
The three it can't are the same three the last round explained in prose, found
again by a completely different method — which is the strongest cross-check
this feature has. And Gearing Hall's stepped entrance turns out to be one our
own geometry had already ruled out months ago, for reasons that have nothing to
do with UT's list. Two sources that share no data agree on the same door.
They disagree in exactly one place, Parlin Hall, and that's the one this round
now discloses.

The app can also finally say the thing Citymapper says and we couldn't: 25 of
123 step-free walks now name the entrance UT lists as barrier-free, instead of
just promising the walk was flat.

Two more things. A question left open since round 5 — is the step-free walk
longer than it needs to be? — got measured properly and the answer is no: at
best it could be shortened by 292 metres out of 130,000, median 3 metres, for a
third more work every time somebody asks for a route. So that pass is built,
proven, and switched off, with the numbers written down and one line to turn it
on. And the clock stopped charging people for climbing stairs it had just told
them they were walking *down* — eight walks now print a minute less, and none
print more.

Re-checked before anything was touched and again after: all 189 mapped
staircases still drawn, none missing or invented, and all seven of round 4's
checks still green at the same 132 / 123 / 9. The feature is still switched off.
## 2026-08-24 — streetlights, round 6 (`acer/w-lit`): the third colour, and standing on the pavement instead of hovering over it

**The bar in the lighting box has three colours and I had only ever checked
two of them.** Amber means a streetlight is mapped beside your path, cool means
none is, and the little violet ticks are the spots where a West Campus resident
in 2017 dropped a pin and said it was too dark. Five rounds of checking, and the
violet one had been looked at in exactly two places — both picked by hand. So
this round the script picked them: eight of them, off eight different walks, and
flew to every one at night.

**Not one of them has a streetlight standing in it.** The typical violet tick is
**255 m from the nearest mapped lamp** and the closest is 75 m. One of them is a
person who wrote *"Street light does not work"* — and OpenStreetMap has no lamp
within seventy-five metres of where they stood, so the two sources are telling
the same story rather than one of them being checked against the other.

**Then the bigger thing, and it is embarrassing.** Every check this feature has
ever passed was taken from a camera pointed straight down at the ground from
about a hundred metres up. That is a fine way to see whether a lamp exists and a
terrible way to see what a person walking there sees — nothing can stand in
front of anything from directly above. This is a walking app. So I put the
camera **on the pavement, at 1.70 m, looking the way you're walking**, and did
all twenty-four sites again. The claim survives: still nothing at any violet
tick, still nothing at any cool stretch, and at the amber ones there is a lamp
post standing in its own pool of light in front of you
(`shots/walk/lit/r6-lit-04-eye.png` — that's the picture worth looking at).
Three sites out of twenty-four miss, and all three are things this feature had
already written down: one is a lamp with a live oak on top of it, one is a lamp
just past the edge of the radius, and one is the "just outside" band the card
already has a sentence for.

**Getting that pose right took four wrong instruments and every one of them
handed me a confident, wrong number first.** The first version put the camera
*inside a tree* and reported that half the streetlights had disappeared. Another
counted a lamp two hundred metres away as being inside a thirty-five metre
circle. Another asked the map "what lamps are on screen" and got told "none"
while the picture plainly had two lamp posts in it. And one counted the app's own
joystick and BOOST button as streetlight. All four were caught by opening the
frame and looking at it, which is the only thing that has ever caught anything in
this lane.

**What actually shipped is small and it is about reading, not data.** The bar
under "Street lighting" had no key. Amber explained itself, because the count
right underneath it is written in the same amber. But the *cool* colour was
named nowhere on the card — and on the walk home into West Campus the bar is
that one colour end to end, so a person is looking at a flat blue-grey stripe
with nothing anywhere telling them what it means. A legend row doesn't fit; the
whole card is 153 px wide on a phone. So instead each sentence now carries the
mark it is about: a small square of the bar's own colour before the count, and
the bar's own violet tick before "6 spots on this route were reported too dark".
Measured before and after on the same card, at phone width and laptop width:
**not one extra word and not one extra pixel of height**, and the colours are
proven identical by reading them off the screenshot rather than off the source.
Before and after: `shots/walk/lit/r6-key-before-desktop-GDC-TheCastilian.png`
and `r6-key-after-desktop-GDC-TheCastilian.png`.

One idea got measured and thrown away again, which is now three for this lane.
The scene paints soft warm glow along roads that has no surveyed lamp under it,
and the card explains that behind a tap. I set the bar first — if more than a
third of places had real glow with nothing under it, that sentence comes out from
behind the tap — then measured it properly and got **3 in 16**, and for the
violet ticks alone 1 in 8. Under the bar, so nothing changed.

Routing untouched for the fourth round running; every steering number identical
to round 3. Full argument, all the numbers and all six wrong instruments:
`docs/walk-lit.md` §42-§51.

## 2026-08-24 — lighting (acer/w-lit), round 7

Six rounds measured this block's height, its word count and whether its key was
the same colour as its picture. None of them measured whether a person can see
it. I did, off the rendered pixels at both a laptop and a phone width, and every
one of the sixteen sentences was fine — while **three of the marks were not**:
the bar's "nothing is mapped here" colour, the little key square round 6 added
to name that colour, and the START / DOOR labels under the bar. The two colour
ones are the same colour, and it is the one that fills the whole bar on the West
Campus walk home.

The fix is a one-pixel edge, not a repaint. The colour itself is fine at the job
it has — telling a lit stretch from an unlit one — so I framed the bar and framed
the key square instead and left both fills untouched, which also keeps round 6's
proof that the key and the bar match. I swept six candidate edge colours and six
label brightnesses on the real card and took the quietest value that clears with
real margin, not the safest-looking one. Nothing on the card moved: same words,
same height to the pixel. The change is a pixel wide, so I magnified it six times
to check it is actually visible — `shots/walk/lit/r7-edge-ab-zoom.png`, and the
key square goes from a dark smudge to a mark you can read as part of the bar.

Then I went and stood in the city. Two frames of the same walk at night at
walking height with the card open: where the bar is amber there are two lamp
posts in their own pools of light, and where the same walk goes cool there is a
bare path running off into the dark. `shots/walk/lit/r7-scene-ANB-mapped.png` and
`r7-scene-ANB-unmapped.png`. Hiding every mapped lamp in the city takes 25,983
pixels out of the first frame and 7 out of the second.

Two honest corrections. One number in that test was about to go into the document
as a defect — a spot the card calls unlit that seemed to have light in it — and it
was a screenshot taken before the picture had settled; re-run properly it is three
pixels, not three thousand. Which means **every lamp-pixel figure in the previous
six rounds was a single reading of an instrument that swings threefold**; the
conclusions survive because the gaps are thousands-against-single-digits, but the
values should not be quoted. And I found the bar draws its stripes and its tick
marks in two different coordinate systems — real, and measured at under one pixel
on 90 routes, so I wrote the bound down and changed nothing.

Routing untouched for the fifth round running. `docs/walk-lit.md` §52-§58.
## 2026-08-24 — the "Avoid stairs" box you could not tick, and one ruler instead of two

Branch `acer/w-door`. Last round's critic found that the routing behind "Avoid
stairs" was right and the checkbox was unusable, and that turned out to be exactly
true: clicking it shut the panel and did nothing else. Clicking anything inside the
answer card was being read as "close the card", and a checkbox only reports itself
after the click has finished travelling — by which time the card, and the checkbox
with it, had already been thrown away. Fixed, and photographed both ways: on the walk
from Will C. Hogg to the Tower, ticking the box now takes you from a 260 m walk with
a set of steps in it to a 170 m walk with none. The box was hiding a route that is
ninety metres shorter. The panel still opens and closes when you click its own text —
that is now checked too, because it was the obvious thing to break.

The other half was tidying. Two different lanes had each built a thing called
`walkmeter.mjs` measuring two different quantities, which is worse than having none.
They are one script now, on one list of twenty walks, reporting both numbers: how far
out of your way the chosen door sends you, and how far from UT's own published
entrance you end up. Proof it lost nothing: pointed at an untouched copy of `main` it
reprints the baseline lane's headline to the decimal. Against the same twenty walks,
this branch takes the second number from 1152 m to 84 m, with all 38 measurable ends
now landing at the door UT draws on its own map (it was 7), and the first number from
+210 m of wasted walking to 277 m saved. Across every building UT surveyed, the worst
door the router might pick is 2.5 m out, down from 29.

Also re-pulled UT's entrance data live to be sure we are still scoring against what
maps.utexas.edu actually shows: identical, line for line, to the table we ship — the
only "new" row is a duplicate UT has of its own Will C. Hogg entrance. And one honest
finding written down: the door score can be driven to a perfect zero by never using
our own modelled doorways at all, which would score better and look worse, so it was
not done. `WAYFIND.on` untouched.

## 2026-08-24 — critic pass, door round 4: it wins, but avoid-stairs strands a real building

Judged fresh, no memory of how hard round 4 was to build. Checked out
`acer/w-door` on its own port (8851), drove the live page with `?walk=1`, and
did not take a single number on faith.

Re-ran `scripts/verify/walkmeter.mjs` myself, `--baseline`, against the live
server: it reproduced the branch's own claim to the decimal — route-length
extra 795.3 m -> 162.1 m, door-offset extra 1151.6 m -> 83.7 m, every one of
20 pairs ends within 15 m of UT's own published door (38/38, up from 7/38),
self-check drift 0.00 m on every measurable pair. Then went further than
trusting the script: pulled `Celebrated_Entrances_view` straight from UT's own
ArcGIS endpoint myself, live, for four buildings the app claims to know exactly
(WCH, MAI, WEL, CAL) — every coordinate the app reports off `wayfindUTDoors()`
matched the live UT feed to six decimal places, and the two buildings the app
reports as unsurveyed (CBA, UNB) really do have zero rows in UT's own layer.
The door data is not fabricated or stale.

The checkbox: wrote my own Playwright script from scratch (not walkmeter's own
UI-gate code) and clicked the real `label.wf-toggle input[type=checkbox]` at
its real pixel centre on WCH->MAI. Screenshot before: unchecked, "3-5 min walk
· 260 m · Stairs: 1 set". After one real click: checked, "1-3 min walk · 170 m
· No stairs on this route". Click again: unchecked, back to 260 m and Stairs: 1
set. It works, independently confirmed.

**oursWins = true.** Every one of the three bars in the brief — extra metres
to the door a student would use, agreement with the door maps.utexas.edu
itself presents, and a checkbox that actually avoids stairs — beats what
shipped before this round by a wide margin, and I obtained the maps.utexas.edu
bar myself rather than accepting the branch's account of it.

**The gap that should be next**: "Avoid stairs" doesn't just fail to help for
some buildings, it actively stops working for at least one real one. Routing
to CMB (Jesse H. Jones Communication Center - B, an occupied campus building)
with the box unchecked works fine from three different hubs (GDC, PCL, UTC —
790 m / 1.1 km / 1.1 km, 1-2 stair sets). Tick the box on any of those three
and the API returns `{ok:false, why:"noroute"}` — and the real UI, driven with
a real click, shows the user "No walking route found" (screenshotted:
the pill card, GDC to CMB, after clicking Avoid stairs for real — kept only in
the session scratchpad, not committed). This is a dead end a step-free user
can actually hit, not a hypothetical: CMB is one of the buildings the branch's
own round-4 commit already named as still stranded (`stranded before: CMA CMB
JGB MAI after: CMB`), but "the checkbox works" and "the checkbox strands you at
a real building" are two different claims and only the first one got
screenshotted before this round shipped. Next round should trace CMB's
step-free component specifically — which edge or door is cutting it off from
every hub — rather than re-sweeping the global tuning constants, which are
already documented as tried.

Server on 8851 stopped and confirmed free after this pass. No file this branch
owns (`js/wayfind.js`, `data/*`, `scripts/bake_entrances.py`) was touched.

## 2026-08-24 — the last building "Avoid stairs" refused to take you to

Branch `acer/w-door`, round 5. Last round's critic passed the work and then
found one real hole in it: tick "Avoid stairs" and ask for a walk to the Jesse
H. Jones Communication Center B, and the app said "No walking route found" — for
a walk it happily gives you with the box unticked. That is the one person on
campus who cannot just take the steps, being told to go away.

It turned out not to be about that building. The rule we wrote two rounds ago
made sure that when we *invent* a destination point we hang it somewhere a
person can actually reach without steps. It never asked the same question of the
doors we already had on file. Jones B has four of them; the one sitting closest
to the entrance UT publishes — three metres away — opens onto a courtyard whose
every way out, as far as OpenStreetMap knows, is a staircase. So we offered
exactly one door, it was a door nobody could get to, and the router did the only
thing it could.

The fix is a subtraction, not an addition: with the box ticked, a door is only
offered if you can actually walk to it. Nothing else changed — every one of the
twenty test walks measures the same to the decimal, and not one of the 158
buildings routes differently with the box unticked. What did change: the app now
gets you to every single building UT has surveyed without stairs, 56 of 56, up
from 55. Jones B is a ten-to-fifteen minute walk that ends at the east entrance
UT's own accessibility survey certifies — with the last forty metres drawn
dashed, because we genuinely do not have a path mapped there and the card says
so out loud.

Two things this round claimed and then took back, both caught by driving the app
instead of reading it: two other buildings we thought we had rescued had never
been broken (a widening rule was already covering them), and the first "before"
photograph turned out to be the loading screen with the map still four layers
from ready. Every picture now waits the loading screen out and counts how many
pieces of route actually got painted before the shutter — 83 in the after frame,
zero in the before. Also tried and thrown away: sending step-free walkers round
to Jones B's other, reachable door. It fixes that one building and drags
eighteen others 12 to 34 metres off the entrance UT publishes, which is the
exact complaint this whole lane exists to fix. Pictures and the full table are in
`docs/walk-door.md` round 5. `WAYFIND.on` still false.

## 2026-08-24 — the door lane, round 6 (`acer/w-door`): one way in became eight

Round 5's critic came back empty, so this round went hunting for its own gap.
It turned out not to be about which door the app walks you to — that part has
been right since round 4 — but about how you walk up to it. When UT publishes an
entrance our own data never mapped, the app builds a target at UT's coordinate
and hangs it on the single nearest bit of pavement. One bit. So no matter which
direction you were coming from, you had to reach that one spot before you could
reach the door, and the walk went round the houses to get there. Every real door
in the city already gets several — the app picks whichever suits your walk — and
this was the only kind of door that did not.

It does now. Across every UT building, walked from three different starting
points in both modes — 416 trips — 127 of them got shorter, five got a few metres
longer (the router will trade a little pavement to skip a road crossing, and
always has), none broke, and about a kilometre and a half of walking came off the
total. On the twenty measured pairs the extra walking the door choice costs you
fell from 162 m to 142 m and the credit it earns you went from 277 m to 354 m,
while the door you arrive at did not move by so much as a centimetre — same
entrance, better approach. The best single case is in the pictures: from the
University Teaching Center to Garrison Hall, 320 m and a staircase became 200 m
and no stairs, ending at the other entrance UT publishes on that building — the
one you were always closer to.

The part worth reading twice is what this round refused. Letting the app pick
freely among all the nearby pavement scored much better — 68 m of extra walking
instead of 142 — but the last few metres to one of these doors is a straight
dashed line over ground nobody has surveyed, and the further round the building
that line starts, the more of it goes through the building. That is the one thing
we are not allowed to do. So every one of those lines, on all 416 trips, was
measured against the real building outlines: unbounded, the number of walks whose
last stretch cuts through a building went from 70 to 115. Bounded the way it now
ships, it is 76. The better score was available and it was not worth the picture,
and the whole trade-off table is in `docs/walk-door.md` round 6 so the next person
can disagree with the call rather than rediscover it. The same measurement also
found that 23 of UT's 84 doors already had this problem before this round
existed, and wrote down the fix — it belongs in the entrance bake, not the router.
`WAYFIND.on` still false.

## 2026-08-24 — critic pass, door round (after round 6): it still wins, and the "UT door" it's scored against is sometimes the wrong point

Fresh critic, port 8851, no memory of how hard rounds 4-6 were. Re-ran
`scripts/verify/walkmeter.mjs --baseline` myself against a clean server on this
branch's HEAD (`994e705`, round 6): it reproduced the branch's own numbers to
the decimal — route-length extra 795.3 m -> 142.1 m, signed total +209.5 m ->
-354.3 m, door-offset extra 1151.6 m -> 83.7 m, 38/38 pair-ends within 15 m of
UT's published door, self-check drift 0.00 m, live UI gate PASS. Then drove the
checkbox myself through the real API and the real page: 250.7 m / 1 stair set
with the box off, 162.7 m / 0 stair sets on, and two real screenshots of the
real card (WCH -> Tower) with a real click in between — unchecked "3-4 min walk
· 250 m · Stairs: 1 set", checked "1-3 min walk · 160 m · No stairs on this
route · Avoids 189 mapped staircases." The checkbox genuinely avoids stairs.

**The gap.** UT's own `Celebrated_Entrances_view` carries two different
coordinates per row — a `Longitude`/`Latitude` attribute pair and a separate
point `geometry` — and this branch (rounds 1-6, `js/wayfind.js` and
`scripts/bake_entrances.py`) reads only the attribute pair. Queried the SAME
Experience Builder widget that maps.utexas.edu itself loads
(`experience.arcgis.com/experience/81d900a3c906482e9731a7a71eaaa178`,
layer `Celebrated Entrance`, id `194a972f836-layer-6`) directly through its own
`queryFeatures()`, live: for MAI the attribute pair is 30.286186/-97.739719 but
the point the map actually draws is 30.286023/-97.739757 — **18.5 m away**. For
EER, attribute 30.288143/-97.735633 vs geometry 30.288310/-97.735657 — **18.75
m away**. A 69-row sample of the whole layer (`Longitude`/`Latitude` present
and non-null) found 15 buildings 10 m+ apart between the two coordinates,
2 of them 20 m+ (MBB at 39.4 m), and only 19 of 69 under 1 m agreement. Round
4's "97/97 matched, worst 0.07 m" check never caught this because it compared
the branch's own copy of the attribute field against a fresh pull of the same
attribute field — an internal-consistency check, not a check against what
maps.utexas.edu actually renders on screen.

This means "38/38 ends at the right door" and "worst single pair 10.9 m" are
scored against the wrong ground-truth point for an unknown-but-real subset of
the 20 pairs — EER and MAI both appear in the headline pair set (EER->NHB is
the baseline doc's worst offender; WCH->MAI is walkmeter's own UI-gate pair).
**The fix**: in whichever bake/table-building step reads
`Celebrated_Entrances_view`, take the row's `geometry.x`/`geometry.y`, not the
`Longitude`/`Latitude` attribute fields, and re-run `walkmeter.mjs` to see how
much of the 83.7 m residual door-offset was real and how much was measurement
error.

**oursWins = true anyway.** All three bars in the brief — extra metres to the
door a student would use, agreement with the door maps.utexas.edu actually
presents, and a checkbox that actually avoids stairs — still land far ahead of
doing nothing, even accounting for a coordinate source that inflates the
precision claim by 10-20 m on a handful of buildings; none of it reverses which
side of the building the router sends you to. The through-building residual on
invented-door last stretches (76/619 legs, documented in round 6 as unchanged
and unfixed by this round) is real and already written up with a concrete fix
design in `docs/walk-door.md` round 6 §6 — still open, not this round's find.

Server on 8851 killed and port confirmed free. Touched only this file
(`docs/walk-progress.md`) — no file `acer/w-door` owns.

## 2026-08-24 — door round 7: the critic was right about the coordinate, and fixing it was worth 64 metres

The critic's find held up under a fresh check from scratch. UT's entrance layer
gives every door two positions — a pair of ordinary columns and the point the
map actually draws — and they are a median 2.7 m apart, fifteen buildings are
more than 10 m apart, and one is 39 m apart. Rounds 1 to 6 read the columns. The
map draws the other one, and two of the buildings that disagree are ends of the
headline pairs, so the lane had been marking its own homework against a point
maps.utexas.edu does not show. Switched to the drawn point: the extra walking the
door choice costs you across the twenty pairs fell from 142 m to **78 m**, the
credit it earns went from 354 m to **405 m**, and — the line that matters most,
because it cannot be moved by rewriting the table — the independent oracle whose
doors were matched by hand offline went from 434 m to **349 m** and from 15 to
**19** of its thirty ends landing on the right door. Still 38 of 38 pair-ends at
UT's own door, still 56 of 56 buildings inside 15 m, avoid-stairs still clean on
all nine buildings, the checkbox still passes a real mouse click each way, ruler
drift still 0.00 m.

What it did not do is make the doors better, and this round says so out loud
rather than banking a win it did not earn. Both coordinate fields were scored
against a referee neither of them controls — how far each sits from the wall of
its own building — and it is a dead heat: geometry nearer on 18 rows, the columns
nearer on 23, a tie on 25, 2.37 m against 2.58 m on average. There are pictures
of that in `docs/walk-door.md`: standing at each of the Main Building's two
candidate coordinates at eye level, the old one puts you square in front of the
monumental west entrance and the new one 18 m south on the plaza. We use the
published point because it is the published one, not because it is the better
door.

The interesting damage was elsewhere. Moving Jones Hall's door by **two metres**
knocked the building out of the app entirely — 0 m from UT's door became 59.9 m,
and nothing failed to say so. The cap that decides whether a door far from any
mapped path is still routable had been set to 58 because Jones Hall's own gap was
57, "plus a metre". A constant fitted to the last digit of one building's
coordinate. Rather than re-fit it, the whole distribution was measured with the
cap lifted: 38 of the 39 invented doors need 41.6 m or less, Jones Hall needs
58.8 m, and nothing at all lies in between. So this number decides exactly one
building and every value above 58.8 admits the same set. It now reads 75 — chosen
for headroom, not fit, with more slack than the worst disagreement between UT's
own two fields, so the next data refresh cannot silently strand a building the
way this one did. Jones Hall is back at 0 m. `WAYFIND.on` still false. Branch
`acer/w-door`.

## 2026-08-24 — critic pass, door round (post-round-7), oursWins=true

Fresh critic, port 8851, no memory of rounds 1-7. Did not read the diff first;
drove `?walk=1` cold, then checked the branch's own claims from scratch rather
than accepting them.

**Independently re-ran `walkmeter.mjs --baseline`** against a clean checkout of
HEAD (`8d32030`) served on 8851: it reproduced the round's own numbers to the
decimal against the "doors off" baseline (main, no correction) — route-length
extra 795.3 m -> 78.5 m, signed total +209.5 m -> -404.6 m, door-offset extra
1144.0 m -> 81.4 m, 8/38 -> 38/38 pair-ends within 15 m of UT's door, the
independent pair-file oracle 1080.3 m -> 349.0 m and 7/30 -> 19/30, mean
worst-case door error across all 55 UT-surveyed buildings 29.8 m -> 2.3 m,
17/55 -> 56/56 inside 15 m, self-check drift 0.00 m, live UI gate PASS.

**Independently queried UT's live `Celebrated_Entrances_view` layer myself**
(not through the branch's tooling — a raw `curl` against
`services9.arcgis.com/.../Celebrated_Entrances_view/FeatureServer/0/query`) for
EER and MAI, the two buildings the round's coordinate-source fix hinges on.
Both rows' `geometry.x/y` matched `js/wayfind.js`'s baked `UT_CELEBRATED` rows
for those codes to the sixth decimal (EER 30.288310/-97.735657, MAI
30.286023/-97.739757), confirming the branch is really reading the field
ArcGIS renders position from and not misquoting its own source.

**Drove the feature myself with a standalone Playwright script**, independent
of `walkmeter.mjs`, calling `window.wayfindRoute('WCH','MAI',...)` directly and
screenshotting the live 3D scene both times: unchecked gave `stairSets:1`,
"2-4 min walk · 230 m · Stairs: 1 set", a visible ribbon descending the Tower's
east side; checked gave `stairSets:0`, "3-5 min walk · 270 m · No stairs on
this route," and the ribbon visibly moved to the other side of the Tower in
the screenshot. The subject is on screen and the checkbox genuinely changes
which door and which path it draws, not just the label.

**oursWins = true.** All three things this piece is judged on beat doing
nothing by a wide, independently-reproduced margin, and the avoid-stairs
checkbox demonstrably avoids stairs on a real click through the real API.

**The single biggest remaining gap:** the independent pair-file oracle —
doors matched to UT's rows by hand, offline, so it can't be moved by rewriting
a table — still lands on the wrong door for **11 of its 30 ends (37%)** even
after this round's fix, and round 6's own diagnosis is almost certainly why:
23 of 84 UT doors have their nearest walkable node on the *far side of a wall*
from the door itself (`docs/walk-door.md` round 6 §6), so the router's last
stretch snaps to a node that can't actually see the door. That defect was
found in round 6, a concrete fix was designed (a per-door 24-bucket
"clear-reach profile" baked in `scripts/bake_entrances.py`, gating
`usableNodesNear()`), and it is still unbuilt three rounds later. Compounding
it: round 7 moved 54 of 97 doors by up to 39 m switching coordinate fields,
but the through-building residual on invented last-stretches (measured in
round 6 at 76 of 619 legs, 12%, using the OLD coordinates) was never
re-measured against the new ones — nobody knows today whether that number
went up, down, or stayed put. Next round should build the clear-reach-profile
fix (it is the highest-leverage undone item in the doc) and re-run the
through-building intersection check against the current baked table before
claiming that number still holds.

Server on 8851 killed, port confirmed free. Touched only this file
(`docs/walk-progress.md`) — no file `acer/w-door` owns.
## 2026-08-24 — the malls were painted but their EDGES were not, and the edge is where the router walks (`acer/w-sidewalks`)

Round 2 finished by saying the last problem — the walking line running along the
outline of a mall rather than across it — was a routing problem and not
something the ground could fix. That was wrong, and this round found out by
measuring instead of guessing. Of every metre of route sitting on unpainted
ground, **not one was more than five metres from pavement, and seven eighths of
it was within five centimetres.** Nothing was missing. The route was walking
along a seam.

The seam is this: OpenStreetMap draws the campus malls as closed shapes, and the
part of the app that builds the walking network turns a closed shape into a
line you can walk — around the edge. The part that paints the ground drew only
the shape. So for seven kilometres of mall edge, the router was sending students
down a line the scene painted nothing under, and half the width of the drawn
ribbon hung out over bare dirt. It is exactly the kerb-ramp problem the first
pass fixed at street corners, in the one place that pass could not see it.

So the edge of a mall is now painted as what it is — a walk, at the same 2.4 m
this file has always used when nobody says otherwise, in the mall's own colour.
The share of the twenty test routes lying on drawn paving goes **90.2 % to
93.4 %**, and the metres over bare ground drop from 534 to 128. Ten routes
improved, ten stayed the same, **none got worse**. On the twenty pairs the
baseline lane froze for everybody (`--pairs house`, so this lane's number can
sit beside the others') it is **90.2 % to 95.0 %**, eleven better and none
worse: Winship→Main goes 71 % to 100 %, RLP→Garrison 71 % to 98 %.

The honest version of the headline is the one about the ribbon rather than its
centreline — how much of the drawn strip a person actually sees is off the
paving — and that goes **4.2 % to 1.2 %**.

It costs 8 KB gzipped. Two things were checked hard rather than assumed. First,
that this is not a lie about grass: 87 % of the new paving went over ground the
scene painted as *nothing*, 12 % trims a lawn edge by up to a metre, and the
malls themselves were not made one square metre bigger. Second, that it does not
put a halo round every mall — look at `shots/walk/sidewalks/rim-city-before.png`
next to `rim-city-after.png` and they are indistinguishable, while
`rim-pcljes-before/after` shows the change close up. Re-running the bake with
the new switch off reproduced the old file byte for byte, so the whole change is
that one switch. Full method, the two rejected explanations, and what is left
for the door and graph lanes: `docs/walk-sidewalks.md` §12–§16. `WAYFIND.on`
untouched.

## 2026-08-24 — acer/w-sidewalks, round 4: the other half of the question, and 5.75 km of sidewalk nobody can walk on

Three rounds of this lane all answered "is there paint under the walking line",
and that is now 99 %. But the thing this lane is supposed to prove has two
halves, and nobody had ever measured the second one: **how much of a route runs
along a real sidewalk that actually exists in the map, and how much is a line
this project drew itself.** So that got built, and it comes out at **98.5 % real
on this lane's twenty test walks and 97.5 % on the twenty the baseline froze for
everybody** — and every single invented metre, in all forty walks, is the short
dashed hop between a door and the nearest path. **Not one metre of the routed
part is made up.** The instrument was checked three ways before any of that was
believed, including running it against the old router, where it correctly
reports two and a half times as much invented line.

The obvious next move was to lean harder on the door-link penalty, and it was
measured and **rejected**: the absolute best case removes 18 more metres of
invented line and costs 223 metres of extra walking, and on the harder fixture
it makes every route 11 % longer. Simeon's own complaint is that routes take you
farther than you have to go, so that trade is the wrong way round.

Then the more interesting question — his actual sentence, *"so many sidewalks
are not being utilized properly"* — got a number for the first time. Walking all
**161 km** of surveyed campus footway instead of just the test routes:
**5.75 km of sidewalk is painted in the city, is in the walking graph, and the
router can never use it**, because it sits on a piece of network disconnected
from everything else. Confirmed two independent ways. Fourteen places; the worst
one in the middle of campus is **321 m of pavement 45 m from the UT Tower**, and
**175 m of it is two metres from the network it should be joined to**. That is
not this lane's file to fix — `scripts/bake_walk.py` owns the joining — so it is
written up with coordinates and the exact gap widths as a request, not a change.
The mirror-image question, "is any sidewalk the router uses missing paint", came
back at **54 m across the whole campus** once the crossings-over-streets (which
are deliberately never painted) are separated out. The ground file is done.

Finally, the picture. Every frame this lane has ever taken was from straight
overhead, which is the one angle that cannot see whether the walking ribbon is
lying on the pavement or hovering over it — the exact defect round 2 fixed. So
these are taken standing on the route at eye level:
`shots/walk/sidewalks/eye-mainmall.png` on the Main Mall looking at the Tower,
`eye-eastmall.png` outside Jester, `eye-speedway.png` by the geology building.
Next to each is the same camera with the route switched off, so you can see
exactly which pixels are the ribbon, and one with the ribbon deliberately raised
a metre — where it turns into a kerb-height wall you cannot miss. The camera can
see the mistake; the shipped ribbon does not have it. No pixel of the city
changed this round and `js/wayfind.js` was not touched. Method and every number:
`docs/walk-sidewalks.md` §17–§21. `WAYFIND.on` untouched.

**2026-08-24, later — `acer/w-sidewalks`, round 5.** Eight kilometres of real
campus sidewalk were being painted as street, and the walking route was being
drawn on the asphalt as a result. The cause: the bake trims every pavement slab
back where a road runs, and it works out how wide a road is by counting its
lanes — a guess — while the sidewalk itself is surveyed. Where the survey puts a
sidewalk close to the kerb, which is where sidewalks are, the guess swallowed it
whole and the pavement vanished. Now the trim is not allowed to take the middle
of a walk somebody actually surveyed. On Robert Dedman Drive the route used to
run down a bare traffic lane; it now runs on a paved strip along the kerb, and
the before/after pair is in `shots/walk/sidewalks/kerb-greaf2-nadir-*`. Measured
over twenty class-to-class trips, the share of the drawn route standing on real
pavement went from 93.4 % to 96.2 % on this lane's own pairs and from 95.0 % to
96.8 % on the shared ones, with the amount standing on nothing at all unchanged
to the metre — which is the check that says no pavement was invented. Two things
this lane said last round turned out to be wrong and are corrected in writing:
the 5.75 km of "switched-off" sidewalk mostly cannot be honestly reconnected,
because almost every gap under four metres is a street with no crossing mapped;
and a before/after screenshot pair has to come out of one browser session, not
two. `js/wayfind.js` untouched again, `data/roads.geojson` byte-identical,
`WAYFIND.on` still false. Everything: `docs/walk-sidewalks.md` §22–§26.
## 2026-08-24 — `acer/w-sidewalks` round 4 critic: it wins, verified independently

Reviewed `acer/w-sidewalks` (round 4 of 5, HEAD `6c50c1d`) against `origin/main`
as the bar, on the two things the brief actually asks for — is the router on
real pavement, and does the drawn ribbon look like it's on real pavement.
Nothing taken on the builder's word; every number below was re-run by hand and
every picture below was looked at directly, blind where a visual call was
being made.

**The number, re-measured.** Swapped `data/ground.geojson` for `origin/main`'s
own file and set the audit's link-cost constant back to 1.0 (what `main`
actually ships), then ran the branch's own `scripts/bake_ground.py
--walkaudit` against it — the same tool, pointed at the bar instead of taken
on faith. On the harsher "house twenty" fixture: pavement coverage
(`ON A DRAWN WALK`) goes **85.71% → 96.83%**, bare ground **7.52% (695 m) →
1.63% (154 m)**, and share of each route running on a real OSM footway
feature rather than an invented line goes **95.38% (mean-per-route 93.07%) →
97.46% (mean-per-route 95.53%)**. The 8.24 km "sidewalk painted as street"
defect independently reproduced too: main's own file carries 8.27 km of
non-crossing surveyed sidewalk with carriageway paint under it; the branch's
is 0.07 km. All four numbers matched the doc's own claims to within rounding.
`walkmeter.mjs` was also run against the branch and is NOT a fair second
opinion here — its self-check (browser vs. its own Dijkstra reimplementation)
fails on 14 of 19 pairs with drifts up to 38 m, because that script was built
for `main`'s router and doesn't know about this branch's `LINK_COST_MULT`; its
"903 m extra" figure is a different, uncalibrated instrument and was not used
to judge this round.

**The picture, checked blind.** Took my own screenshots of both `main` and the
branch at `?walk=1`, plus a blind shuffle of the branch's own committed
before/after pair at a street corner (kerb apron). Pixel-diffed rather than
eyeballed at low res, which caught me misreading the corner on first look —
zoomed in, the apron is a real, if narrow (0.9–1.8 m), strip of paving that
appears at every crossing corner and along the Robert Dedman Drive kerb where
the ribbon used to sit directly on bare asphalt with a lane-marking dash for
company. It's a genuine geometry change, not a screenshot that happens to look
different.

**Verdict: ours beats the bar, not a tie.** Decisive margin on the measured
axis (+11 pts pavement coverage, +2 pts provenance, an 8 km defect closed to
0.07 km), and the visual claim holds up under blind, zoomed inspection rather
than just at a glance.

**Biggest gap left, concretely:** ~2.1% of the twenty routes' drawn ribbon
still stands on a marked street crossing, and there `WAYFIND.routeBaseM` =
0.22 m (right for a paved path) leaves the ribbon floating 22 cm above the
`roadarea` fill, which sits at z=0. Painting more pavement can't fix this —
crossings are deliberately never painted as pavement (§2's own argument). The
fix is a per-feature base picked in `ribbonPolys()` in `js/wayfind.js`: use
0.22 m over a `patharea`/mall/rim segment, 0 m over a `roadarea` crossing
segment. Every sibling lane is currently in `js/wayfind.js`, which is
presumably why this round left it alone three times running (§10, §14, §26)
— it should be the first change made once the file is free.

## 2026-08-24 — the five lanes merged, and the number went 795 m to 87 m (`acer/w-integrate`, PR #223 MERGED, branches deleted)

The integration pass. All five walk lanes — door, sidewalks, stairs, lit, ui —
merged onto `main`, their collisions resolved, and the result re-measured with
the baseline meter. `WAYFIND.on` is still false and this pass did not touch it.

**The number.** `walkmeter.mjs`, same twenty pairs, same UT ArcGIS oracle:
extra metres over the pairs the router makes worse went **795.3 m → 87.0 m**,
and the signed total — which the baseline warned was the real constraint,
because nine of nineteen pairs got LONGER when forced onto UT's single door —
went **+209.5 m → −393.7 m**. So the merged router is net shorter across the
twenty, not just better on the bad ones. All 38 ends now land at the door UT
publishes; EER→NHB, the baseline's worst at 569 m for a 271 m walk, routes at
272 m.

**The premise this pass was given was out of date.** It said the baseline meter
had never been built. It had — the baseline lane landed it on `main` as
`docs/walk-baseline.md` + `walkmeter.mjs` after the brief was written. Checked
before building a second one.

**Two real collisions, and neither was resolved by picking a side.**
`scripts/bake_ground.py`: sidewalks and stairs both rewrote the same
`area == "yes"` branch, but they key on different `highway` values — a closed
`pedestrian` way is a mall whose rim is a walk, a closed `steps` way is a
terrace to be drawn as a polygon — so both arms are kept and `ground.geojson`
was REGENERATED rather than hand-merged (41 rim walks, 1 steps terrace, 1,604
kerb aprons, all three lanes' counters non-zero). `legBetween()`: door and
stairs redefined it with different signatures, which is the one place two lanes
genuinely contradicted; `fromEntry`/`toEntry` and `mk` do different jobs and
both are carried.

**Two defects the merge exposed, both found by driving the app.** The
"Avoid stairs" checkbox was unusable — and measuring it three ways showed this
was NOT a merge artifact: `w-door` alone passes the gate, `w-ui` alone fails it.
The interface rebuild put a step-by-step list at the top of a height-capped
scrolling card, which pushed the checkbox below the visible edge, so the click
went through to the map. The frame shows the card clipped mid-word. It had
reintroduced exactly the defect `w-door` fixed and its critic flagged twice. The
controls now sit above the itinerary. And the meter itself had drifted off the
router: sidewalks' `linkCostMult` and stairs' `stairClimbCostMult` changed the
cost model after the meter was written, so it optimised a different currency and
its self-check failed on 15 of 19 pairs with drifts to 27 m — every "extra
metres" it printed on those branches was uncalibrated. It reads both terms off
the page now; drift is 0.00 m on all 19.

**Judgement — and the brief for this pass was wrong about it, twice over.** It
said the critic returned nothing for all five and that no piece had a blind
result. The commit record says otherwise, so it was read rather than taken:

- `w-ui` **06dd719, round 8: a genuine blind win.** Citymapper's own product
  frames were pulled as the bar (their web app has no live walking navigation to
  drive), shuffled, and judged before the mapping was revealed — ours preferred
  on both pieces. It also recorded the one gap it cannot close: Citymapper names
  the street at every turn and `data/walk_graph.json`'s edges carry no name
  field at all.
- `w-door` **bd73cc6, post-round-7 `oursWins=true`**, and `w-sidewalks`
  **da63da4, "it wins, verified independently"** — both independently
  reproduced from a clean checkout, but judged against `origin/main`/doing
  nothing, NOT blind against Citymapper. Real checks; not blind wins.
- `w-stairs` **bdff3f8, round 1 `oursWins=false`** (Citymapper bar unfetched) is
  the ONLY verdict this lane ever got. Round 3 fetched the bar, but that was the
  builder; rounds 2–8 were never judged.
- `w-lit` — **no verdict at any round.**

One blind win, two confirmed-but-not-blind, one recorded loss with seven
unjudged rounds after it, one never looked at.

**Gate, photographed:** `autopilot`, `sliderdemo` and `clip` all correct at
390×844 with touch and the walk UI not painted in any of them; plain page 0
console errors; OSM attribution visible in all five modes; and the detector is
not vacuous — under `?walk=1` it does report `wf-sheet` painted. Suite on the
merged result: `harness-drift` PASS, `movement` 14/14, `collision` 8/8,
`coplanar --gate` clean after an accepted baseline move (entrances 1627→1786 is
`w-door`'s 148 new doors; pairs-per-door went DOWN 1.147→1.140 and the
two-buildings-one-doorway case is unchanged at 5), `walkmeter` exit 0.

**Recommendation: do not flip `WAYFIND.on` yet.** The routing is ready and the
gate is clean, but stairs and lit are unjudged and they are the two that make
accessibility claims. A wrong distance costs a detour; a wrong "step-free"
strands someone. That is the claim not to ship on a screenshot.

## 2026-08-24 — recon only, no code: what UT itself actually exports

Went and looked for UT's own class-schedule export, ahead of building the
three-source schedule-import lane (Google/Apple/UT). No code changed; the
full writeup is `docs/import-bar-ut.md`.

The short version: UT's own registrar page spells out, in public writing with
no login needed, that every class listing's location is "the building and
room where the class meets. Buildings are abbreviated with three letters" —
the same three-letter codes this app already routes on. A real, currently-
shipping student extension (UT Registration Plus, 50,000+ users, not an
official UT tool) confirmed the exact shape by example: `LOCATION:UTC 3.102`,
`CMA 6.146`, `JGB 2.302` — code, space, room, nothing fancier. UT itself does
not appear to publish a native calendar/.ics export of a personal schedule
anywhere public — the actual registration system (`utdirect.utexas.edu`)
bounces straight to a UT EID login wall, and I stopped there rather than
guess what's past it. And "RIS" turns out to mean Registration Information
Sheet (your registration time and holds), not a schedule tool at all — the
brief's guess on that name was wrong.

Also re-checked the two claims behind the 11 unroutable building codes,
independently. Ten of them (BE1, BEG, EME, FS1, FSL, MER, PX3, ROC, SV1, TCB)
really are Pickle Research Campus, about 11 km north of the map — confirmed
against UT Direct's own PRC building list, so the right fix there is telling
someone that class is off-map, not routing to it. The eleventh, SSW, is NOT
missing from UT's register the way the brief said — it's a real, registered
main-campus building (UT Direct lists it as `SSW - 0625` under the main-
campus code, not Pickle), at coordinates that match this app's own
`UT_CELEBRATED` door rows for SSW almost exactly. So SSW being unroutable is
a bug in this app's own routing graph, not a missing UT record — a smaller
and different fix than the brief assumed.

## 2026-08-24 — recon only, no code touched: what Apple Calendar's own subscribe flow actually promises (ahead of the class-schedule-import feature)

Read five of Apple's own support-guide pages end to end for what "subscribe
to a webcal:// link" and "import an .ics file" really do, ahead of anyone
building the three-source schedule import Simeon asked for (Google Calendar,
Apple Calendar, UT's registration export). No real screenshot was possible —
no Mac or iPhone in this session, and the Claude Browser pane errored on
every screenshot attempt with "the Browser pane is not displayed", then
partway through started showing pages this session never navigated to
(UT's registrar and login pages), which turned out to mean the pane is
shared with another concurrent task — so it was dropped and everything below
comes from direct `WebFetch` reads of `support.apple.com`, quoted close to
verbatim with the URL for each claim. Write-up: `docs/import-bar-apple.md`;
`shots/import/bar-apple/NOTE.md` explains why there are no images in that
folder rather than leaving it silently empty.

The useful finding for the seam Simeon named ("MAI 220, TTh 2:00pm" → a
building CODE): both of Apple's two import paths — a live `webcal://`
subscription and a downloaded `.ics` file — end up as the same plain ICS
`VEVENT` blocks, no structured building/room field, just a `LOCATION` string
whatever the source chose to put there. So the actual code that turns a
location string into a CODE doesn't care which of the three sources produced
the file; it only has to be fed by three different front-ends now (a
Google Calendar export, an Apple Calendar export, UT's own export) and,
later, by a fourth and fifth (OCR, a Registration-Plus API) without being
rewritten — which is exactly the shape Simeon asked for.

Two things worth carrying into the build: subscriptions are read-only by
Apple's own explicit statement ("You can't edit calendars you are subscribed
to"), so a subscribed schedule can't be hand-corrected on the phone the way
an imported one-time snapshot could; and refresh on a subscription is a
client-side poll on an interval Apple's own pages describe as a menu but
never itemize the choices for, not a push — so neither "subscribe" path
(this recon's Apple reading, or Google's, going by third-party sources since
Google wasn't fetched this pass) gives same-day visibility into a UT
schedule change. If the feature ever promises "always up to date," a webcal
subscription alone doesn't deliver that promise on its own schedule.

Nothing in `js/wayfind.js` touched, `WAYFIND.on` untouched.

---

**2026-08-24, acer lane, `acer/si-gaps` — the eleven buildings the router had
no answer for.** A schedule import hands the router a building code, so the
eleven UT codes that came back with nothing were the feature's real ceiling.
Re-checked the list first (`walkmeter.mjs` still said the same eleven), then
measured each one two ways: how far UT's own surveyed door is from the nearest
piece of mapped pavement, and whether the app draws a building there at all.
The answer split them three orders of magnitude apart. Ten are 10.8–11.8 km
north at the Pickle Research Campus with no pavement within nine kilometres —
the brief's claim about those was right. The eleventh, **SSW, the School of
Social Work, is on this map**: UT's two published doors land 0.4 m and 2.5 m
from the wall of a building we already draw, 37 m from the path network. It was
not a pavement problem and not a door problem — the code simply was not in any
index the search could reach, because our copy of UT's building register is
missing that row, so it answered the same word a typo gets.

**SSW now routes** (JES → SSW, 660 m; PCL → SSW, 755 m) through the same
mechanism that already made HLB work — walk to UT's own coordinate when we have
no door of our own. `walkmeter`'s "cannot route to at all" count went **11 → 10**,
routable buildings scored 56 → 57 with all 57 landing inside 15 m of UT's own
door, step-free reachability 56/56 → 57/57, and the avoid-stairs door check
9/9 → 10/10 clean. **All twenty baseline pairs are identical across all seventeen
measured fields — 340 comparisons, no differences** — and the live UI gate still
passes. The ten Pickle codes now return a specific `why: 'offmap'` carrying the
building's name, campus, distance and direction, through a new
`window.wayfindOffMap()`, so the import lane gets a real reason instead of
silence. Across the whole 209-code surface a schedule can name, codes answering
`notfound` went **11 → 0**.

Nothing was re-baked. The obvious fix — add SSW to `entrances.geojson` and
re-run the bake — was tried and rolled back after measuring what it dragged in:
`data/walk_graph.json` on `main` is stale (`snapshot: 2026-08-16` against the
app's `2026-08-24`), and a clean re-bake with no input changes at all moves
+50 doors and +69 nodes. That is a real finding for whoever owns
`scripts/bake_walk.py`, not something to smuggle in under a one-building fix,
so the graph is left byte-for-byte `main`'s. Four other things found and
deliberately not fixed — a now-stale line in `walkmeter.mjs`, the missing copy
for an off-map building, the stale bake, and two buildings the search list greys
out even though they route — are written up with exact patches in
`docs/si-gaps.md`. Frames: `shots/si/gaps/`. `WAYFIND.on` untouched; the change
is additive only, five hunks, no deletions.

---

## 2026-08-24 — critic verdict on the schedule-import "UI" piece, round 3: `acer/si-ui` does not exist, oursWins = false

Assigned to drive `acer/si-ui` at phone size against a Google-Calendar-import
and Apple-subscribe bar. It does not exist to drive. Checked four independent
ways before concluding that: `git branch -a` and `git ls-remote --heads
origin` locally, `gh api repos/SimeonVarg/austin-3d-explorer/branches`
directly against GitHub, and `gh pr list --state all` — no branch, no open or
merged PR, named `si-ui` or anything close to it, anywhere. The stray local
branches `acer/si-parser`, `acer/si-gaps`, `acer/si-privacy` that do exist in
this machine's `.git` were never pushed to GitHub either (confirmed via the
same `ls-remote`), and `si-parser`'s own tip commit already records the
identical finding for its piece: *"acer/si-parser does not exist anywhere,
oursWins=false."* `js/wayfind.js` on all three of those stray branches is
byte-identical to `main` (8,238 lines, no `.ics`/import code anywhere) — no
lane has actually started building the import UI, parser, gaps handling, or
privacy piece; only two docs-only recon writeups exist
(`docs/import-bar-apple.md`, `docs/import-bar-ut.md`, both already on `main`
per the entries above), and the Apple recon's own note says it never obtained
a real bar screenshot either.

Drove `main` itself instead, since that is what `acer/si-ui` would have been
built on top of and it is the only honest stand-in for "what a user would
meet." Served on port 8953 (`python scripts/serve.py 8953`, confirmed freed
after), `npm install` run fresh in `scripts/verify` (its `node_modules` was
absent, per this file's own recurring warning), real Chrome via
`playwright-core`/`chrome.mjs`, 390×844, `?walk=1&drift=0`,
`window.cancelGraphicsAutoDetect()` called, waited for the loading veil.
`window.WAYFIND.on` is `false` and `?walk=1` correctly opens the panel
(`#wf-root` present, `wf-sheet` painted, the whole existing "WALK TO CLASS"
card visible in a real screenshot) — so the walking feature itself is intact
and reachable, confirming no regression there. But a full inventory of every
button in that DOM (`wf-button`, `wf-close`, `wf-x`, `wf-swap`, four `wf-eg`
example chips, `wf-chev`, `wf-act-go` "Walk it", `wf-act-show` "Show route",
`wf-act-clr`) and a case-insensitive scan of every element's id/class/
aria-label/title and every leaf node's text for `import|schedule|calendar|
\.ics|google cal|apple cal` returns **zero matches** and **zero
`input[type=file]` elements**. There is no button, icon, modal, paste box, or
upload control anywhere that would let a student get "MAI 220, TTh 2:00pm"
into this app. Nothing to screenshot next to a bar because there is nothing
on our side to photograph — `shots/import/bar-google/` and
`shots/import/bar-apple/` (which already existed, holding only `NOTE.md`)
were left as found; no blind comparison was possible or attempted, per house
rule, rather than staged against a placeholder.

**oursWins = false.** Not "loses on comparison" — there is no comparison to
run. **The single biggest gap, concretely:** the schedule-import feature
described in the brief (three intake paths — Google Calendar, Apple Calendar,
UT registration export — feeding one `parseScheduleText(...)  →
[{code, days, start, end}]` seam, per `docs/import-bar-apple.md`'s own
recommendation) has zero lines of UI or parsing code anywhere in this
repository, local or remote. Whoever picks this up next needs to actually
build a first version — even the simplest version, a single "Import schedule"
button opening a paste-box that runs an `.ics`/text parser against the
existing `UT_ENTRANCES`/`UT_CELEBRATED` code table — before there is anything
for a round-3 UI critic to judge. The two recon docs already on `main` (UT
location-format confirmed as `{CODE} {ROOM}`, Apple's two paths both bottom
out in plain ICS `VEVENT`/`LOCATION` text) are ready to build against; nobody
has used them yet.

Verified independently: the 11-unroutable-codes claim from the brief. Ten
(BE1, BEG, EME, FS1, FSL, MER, PX3, ROC, SV1, TCB) are genuinely ~11 km north
at Pickle Research Campus — already confirmed in the recon entry above against
UT Direct's own PRC building index, re-spot-checked here by reading the same
`UT_CELEBRATED` coordinates directly out of `js/wayfind.js` on `main`: all ten
sit at latitude ~30.38-30.39 against main-campus ~30.28-30.29. SSW is not
missing from UT's register — same conclusion as the recon entry, re-confirmed
by finding `SSW` present in `js/wayfind.js`'s own `UT_CELEBRATED` table on
`main` with coordinates (30.280477, -97.732959 / 30.280797, -97.732860)
already there; its unroutability, if real, is this app's own routing-graph
bug, not a missing building record — did not chase that bug down further,
since it belongs to a different piece than "UI."

Left `main` untouched except this entry (docs-only, per CLAUDE.md rule 4);
no branch existed to leave as found. Server on 8953 killed and the port
re-confirmed free (`Get-NetTCPConnection` empty). No scratch scripts left in
`scripts/verify` — the one written to drive this check was deleted after use.
One frame kept because this entry cites it:
`shots/import/main-walk1-mobile.png` (the panel `main` actually renders,
proving the "nothing to import with" finding rather than asserting it).

---

## 2026-08-24 — the schedule importer's parser (`acer/si-parser`)

There is now a class-schedule importer, or at least the half of it that does
the reading. Give it a calendar file from Google, from Apple, or from UT
Registration Plus, or a `webcal://` subscribe link, or just a block of text
typed by hand, and it comes back with the same answer every time: a list of
classes, each pinned to a UT building code the walking router already knows how
to route to. Three ways in, one thing out. The parsing lives at the end of
`js/wayfind.js` and added 1,185 lines without deleting a single one, which
matters because four other lanes were editing that file at the same time.

The part worth caring about is what happens when a file is wrong, because a
real schedule usually is. The bar was Google Calendar's own import — one bad
row must never kill the file. So the test file has one good class surrounded by
eight broken ones: a typo'd building code, a class with no room at all, a date
with a letter O typed for a zero, a street address instead of a building, a
class at the Pickle Research Campus eleven kilometres north, a building UT knows
about and this app does not, and a file that just stops in the middle of an
event. The good class still comes through, the answer reads *"Imported 1 of 9
classes. 8 could not be used,"* and each of the eight gets a plain sentence
naming the class and saying what to do — *"MAII 220 is not a UT building code.
Did you mean MAI (UT Tower)?"* rather than a shrug.

One near-miss is worth recording because it was the exact accident this
codebase already had a warning against. The first version let that typo `MAII`
slip past the building-code check and into the loose name search, which
helpfully decided `maii` was close enough to `mail` and routed a history
lecture to the Comal Mail Service Building — confidently, with correct
distances. It only surfaced because the test asserts the *sentence a student
reads*, not just that something failed. The fix was to make the parser suggest
a near miss and never apply one.

Two things the brief said turned out to be wrong, and running it rather than
believing it is what caught both. It was right that ten codes are off the map
at Pickle (measured 10.8–11.8 km from the Tower's own door). It was wrong that
SSW is missing from UT's records — SSW is 0.9 km away on the main campus with
two surveyed doors sitting in this repo already; what it is missing from is
*our* building list, which is a much smaller fix, and the exact patch is written
into `docs/si-parser.md` for whoever owns that file. And the brief missed a
twelfth building, HLB, which the app *labels* unroutable and then routes to
perfectly well at 1,339 m. So "is it routable" cannot be read off a flag; the
importer routes for real before it promises anything.

Verified by driving the real app: 209 assertions, all green, and thirteen
class-to-class walks routed out of the three clean schedules. The Monday walk
from the Gates Computer Science Complex to Welch Hall — a real leg out of a real
parsed calendar — is photographed twice, fitted and down on the ribbon, in
`shots/si/parser/`. The proof that the route is actually painted and not merely
present in a data structure got rebuilt three times before it was honest: the
first two versions needed a threshold picked after seeing the answer. The one
that shipped measures the renderer's own noise first (it moves 0 pixels when
nothing changes) and then removes the route from an unmoved camera (1,437
pixels move). Nothing left running: server on 8911 stopped, port confirmed free.

The drop zone, the error list and the import bar itself are still to build —
that is the interface lane's half. Everything it needs is five functions and a
paragraph in `docs/si-parser.md`. Nothing here is wired into the shipped app;
`WAYFIND.on` is untouched and still false.

---

## 2026-08-24 — the schedule-import screen exists now, and it says what failed (`acer/si-ui`, round 4)

The last critic's verdict on this piece was that there was nothing to judge:
no branch, no code, no button, no paste box anywhere in the repo. That is
closed. `acer/si-ui` now carries the screen a student adds their class
schedule on, behind `?walk=1` like the rest of the walk feature, with
`WAYFIND.on` still `false` so `main` is unchanged for anyone who has not
asked for it.

It has three ways in, and each one is shaped by what the two recon lanes
actually found rather than by what a calendar import usually looks like.
**Google** leads with a file, because Google's export is a download — and it
hands you a `.zip`, which every guide forgets and which now has its own
sentence on screen when you pick one. **Apple** leads with an address,
because Apple's flow is a `webcal://` subscription the OS registers, and the
address is the thing a student already has; the field takes `webcal://` or
`https://` and swaps the scheme itself. **UT** leads with a paste box,
because `docs/import-bar-ut.md` looked hard for a first-party UT `.ics` feed
and could not find one, so a URL field there would have been a control that
cannot work. Underneath, all three land in one place: Google's export,
Apple's export and Apple's live feed are the same ICS payload, so there is
one decoder behind all of them and the tabs differ only in what they tell you
to go and fetch.

The half that took the work is the other screen — what did **not** import. A
real schedule names a real building and some of those this router cannot
reach, so the brief's "11 unroutable codes" was re-checked rather than
believed: every code in the app's own tables was put to the live page's
`wayfindSearch` after the graph loaded, and it is **twelve**, not eleven.
`HLB`, Dell Med's Health Learning Building, has zero walkable doors and is
not in the brief's list — and it is not off-map, it is on main campus. The
Pickle claim holds for all ten. The "SSW isn't in UT's register" claim is
false; SSW is a registered main-campus building this codebase already has
coordinates for, so its unroutability is our graph's gap, not UT's. That is
three different pieces of news and the screen now says three different
things, because telling a student their real building 400 m away "couldn't be
imported" is the wrong-building failure with the lights off.

Six defects were found by photographing it at 390 x 844 and reading the
frame, not by reasoning about the code. The failures were listed *under* the
six that worked, so a phone showed nothing but ticks. The error message was
the last child of a scrolling body, so pressing Import on an address that
cannot be fetched appeared to do nothing at all — and the re-render wiped the
address too. Then, with that fixed, the message said "choose the file
instead" while the file button was scrolled off the bottom of the same frame.
A course number was being read as a room (`RHE 306` became a building), and a
day abbreviation nearly was too — `MW 3:00 pm` is two capitals, a space and a
digit, which is a UT room's exact shape. All fixed, all now asserted rather
than eyeballed, and written up with the pictures in `docs/si-ui.md`.

It is invisible on every recording surface — `?clip=1`, `?autopilot=1` and
`?sliderdemo=1` were each loaded with the import screen **opened on purpose**
first, and all five of the feature's elements measure zero. That needed one
edit to the `.clip` rule in `style.css`: the old rule listed three ids and
carried a comment saying every element this feature adds is a child of one of
them, "which is why the rule has not had to grow". The import panel is a
fourth child of `#wf-root`, because a panel that covers the search sheet
cannot live inside it. It is listed now and the comment says why, since that
sentence is exactly what would have let this ship visible in the AWS
recording.

Nothing above §9 of `js/wayfind.js` was edited and no existing function was
touched — the block is appended whole and the entry row is a DOM append onto
the sheet, so the four other lanes in this file have nothing to collide with.
Image-OCR and a Registration-Plus API are deliberately **not** built, per
Simeon; both have a named seat in the source and a one-function contract, so
adding either later is a decoder plus one table row and touches no placement,
no failure taxonomy and no line of the screen. Branch `acer/si-ui`, pushed,
not merged. Server on 8913 killed and the port confirmed free.
## 2026-08-24 — critic round 4 verdict on `acer/si-parser`: oursWins = true, one real gap found in the auto-sniff path

Fresh context. `acer/si-parser` finally exists (e855af3, "Schedule import, the
parsing half"), so this is the first round that could actually review it.
Checked out the branch fresh from `origin`, served it on 8951, drove the real
`?walk=1` page with `playwright-core` and real Chrome — not the builder's own
screenshots.

**Confirmed additive-only independently**, not from the commit message: `git
diff origin/main...acer/si-parser -- js/wayfind.js` shows zero deleted lines,
1185 added, everything else in the repo untouched except two new docs files,
six new fixture files and two shot files.

**Re-ran the builder's own gate rather than trusting its printed number**:
`schedule-fixtures/schedule-parse.mjs` against a freshly served copy of this
branch — 209/209 assertions, independently reproduced.

**Then built four fixtures of my own from scratch** — different building
codes than the builder ever used (BUR, CBA, SZB, GDC, SEA, PAR, ANT), a
different malformed-date shape (an ISO-8601-style `2026-08-28T09:00:00`
pasted into `DTSTART` instead of the builder's letter-O typo), a genuinely
empty `LOCATION:` property (not merely an absent one), a `LOCATION` forced to
fold across real 75-octet lines by a long real Austin address with the code
in parens at the very end, and a manual-paste ambiguity trap with a building
code (`SEA`) sitting both as a plausible course prefix AND as the correct
answer next to a decoy course-shaped token — to make sure I wasn't grading the
builder's own tuned inputs. All of it resolved and routed correctly: every
clean event became a real leg through `wayfindScheduleCheck`'s actual
`computeRoute()` path, every bad row failed with the specific right problem
code and a suggestion where one existed (`WEK`→`WEL`, `CBQ`→`CBA`), and the
DST-aware `UNTIL` conversion landed on the correct Chicago calendar date on a
`RRULE` I wrote myself. Independently re-verified the doc's central factual
claims by calling the functions directly rather than reading the write-up:
`HLB` resolves and **routes** despite `resolved.routable` never being asked
first, `SSW` fails `BUILDING_NOT_WALKABLE`, a Pickle code fails
`BUILDING_OFF_MAP`, and both `webcal://` and `webcals://` rewrite to the same
`https://` feed. Looked at the two committed screenshots with the Read tool
per house rule — both really do show a drawn card and route (GDC→Welch,
140 m, "No stairs on this route"), not a buried camera.

**The one thing that doesn't hold up: the auto-sniff path is blind to the
exact failure the builder's own docs call "the single likeliest real-world
'bad file.'"** `wayfindParseSchedule(text, opts)` is documented to auto-detect
`kind` when it's omitted, via `schedLooksLikeICS()`, which only checks for the
literal substrings `BEGIN:VCALENDAR` / `BEGIN:VEVENT`. An HTML sign-in page —
`docs/si-parser.md`'s own `not-a-calendar.ics` fixture, modelled on the UT EID
wall — contains neither, so it auto-detects as `'rows'` and is fed to
`schedParseRows`, which has no "this isn't a schedule at all" check. The
result, reproduced verbatim with the builder's own fixture through the public
entry point exactly as documented (`wayfindParseSchedule(text, {})`, no kind
forced): **nine `LOCATION_MISSING` errors, one per line of markup**, each
reading `Line 3 ("<head><title>Sign in with your UT EID</title></head>") names
a course but no building` — a wrong, actively misleading sentence (there is no
course on that line at all) instead of the crafted, correct message that
exists specifically for this case: *"That is not a calendar file... you
probably saved the sign-in page instead of the .ics."* That crafted message is
only reachable if the caller manually forces `kind:'ics'` — which is exactly
what the builder's own gate does (`EXPECT['not-a-calendar.ics'].kind` is
hardcoded `'ics'` and the harness passes it straight through), so 209/209
green never actually exercised the code path a real unqualified call takes.
This is the failure mode CLAUDE.md's house rule about a passing critic not
being proof exists for: the gate is green and the exact scenario it was built
to catch still gets through when called the documented way.

**Why this doesn't flip the verdict.** The brief's bar is Google Calendar's
own import UX, and I went and got the actual wording rather than assuming it
(`support.google.com` via WebFetch, cross-checked against a second query):
Google's own partial-failure message is **"Processed x of y events,"** a bare
count with no per-row reason ever surfaced, for any failure, of any kind. Even
in the one scenario where this branch's own wording goes wrong, it still
names every failing line individually with a problem code and an actionable
hint — which is more than Google's bar gives a student on any bad file, ever.
The defect is real and worth a fast follow-up (teach `schedLooksLikeICS`, or a
sibling check in `schedParseRows`, to recognise `<!DOCTYPE`/`<html` and reuse
the existing `FILE_NOT_CALENDAR` message instead of running the row parser on
markup), but it is a wording bug on top of a design that already clears the
stated bar, not a bar-losing one.

**oursWins = true.**

**Single biggest remaining gap, concretely:** `schedLooksLikeICS()` in
`js/wayfind.js` (used by `wayfindParseSchedule` to pick `'ics'` vs `'rows'`
when `opts.kind` is omitted) only tests for `BEGIN:VCALENDAR` / `BEGIN:VEVENT`
substrings, so any non-calendar text that lacks those literal tokens —
starting with the HTML sign-in page the builder's own docs name as the most
likely real bad file — is silently routed into `schedParseRows` and reported
as a schedule full of buildingless "courses" instead of hitting
`FILE_NOT_CALENDAR`'s purpose-built message. Fix the sniff (or add the same
markup check inside `schedParseRows`) and then change the test harness's
`EXPECT['not-a-calendar.ics']` to call `wayfindParseSchedule(text, {})` with
no forced `kind`, so the gate can no longer go green while blind to the one
scenario it exists to catch.

**What I actually looked at or measured:** the branch's own 209-assertion gate
re-run fresh (pass); four fixtures I wrote myself covering every category the
brief named (bad code, missing location, malformed date, multi-line address),
run against the live page via `wayfindParseSchedule`/`wayfindScheduleCheck`/
`wayfindScheduleFrom`; a direct call reproducing `HLB`/`SSW`/Pickle-code
behaviour; both `webcal://` and `webcals://` rewrite; the builder's own
`not-a-calendar.ics` fixture re-run through the *undecorated* public entry
point (the defect above); the two committed screenshots opened and read, not
assumed; `git diff origin/main...acer/si-parser` read directly for the
additive-only claim. Branch left as found — deleted the four scratch `.mjs`
scripts I wrote into `scripts/verify` before finishing, and reverted the two
`shots/si/parser/*.png` files that the builder's own gate script rewrote when
I re-ran it (same camera, same fixture — not a real change, just noise from
running their own script). Server on 8951 killed, port re-confirmed free by
`netstat`. No files the builder owns were edited.

---

## 2026-08-24 — critic round 3 on the privacy piece (`acer/si-privacy`), oursWins=true

Drove `acer/si-privacy` for real on port 8955, own browser, own scripts — not the
builder's `schedule-privacy.mjs`. Server on 8955, `npm install` run fresh in
`scripts/verify` (empty `node_modules`), `harness-drift.mjs` PASS first.

Both halves of THE BAR hold under independent testing, and harder than the
builder's own audit tried: imported a schedule with a distinct canary string
under `?walk=1&drift=0&intro=0`, routed GDC→PAR to generate real traffic, and
scanned all 153 captured requests (page + worker fetches) — zero carried any
schedule content, and the canary string appeared in none of them at any phase.
Then went further than the builder's negative control, which only fired a
`fetch`: a raw `XMLHttpRequest.send()` and a `navigator.sendBeacon()` carrying
the schedule were both thrown/refused by the guard (`XMLHttpRequest carried
stored schedule content`, `sendBeacon` returned `false`), and neither request
reached the wire. Delete: a real click on `#wf-priv-del`, then `page.goto` a
fresh document — no `austin3d.schedule.*` key in local or session storage, no
reserved IndexedDB database, panel back to "No schedule saved on this device
yet." With `?walk=1` absent, `window.fetch` is the untouched native function —
the feature installs nothing on a page that doesn't have it on. Screenshots
taken and looked at with the Read tool at every stage (loaded city, panel with
2 classes and the exact source label passed in, empty state after reload) —
the subject was on screen and the builder's own `shots/si/privacy/3-panel-saved.png`
and `4-panel-deleted.png` match what an independent run actually produces, not
just what the doc claims. Also reran `walkmeter.mjs` clean (own process,
independent of the builder's figures): the stairs-avoidance live-click gate
still passes and the 11-unroutable-building list is unchanged, so this branch
does not regress the sibling lane's work.

The one real problem: `docs/si-privacy.md` §7 backs its central factual claim —
"SSW... demolished September 2024; the school moved to Walter Webb Hall" — with
four citations to `docs/schedule-gaps.md`, a file that does not exist anywhere
in this repo's history, on any branch. It doesn't just lack a citation; the
actual sibling analysis that exists, `docs/si-gaps.md` on `origin/acer/si-gaps`,
independently measured UT's own surveyed SSW doors at 0.4 m and 2.5 m from a
building footprint this app already draws (37.4 m from the walk graph, versus
9.6–10.6 KM for the ten real Pickle buildings) and concludes the opposite: SSW
is a real, current, main-campus building UT surveys doors for, missing only a
row in our own register — a one-line fix, not a demolition. `si-privacy`'s
storage design itself doesn't depend on this (this lane correctly doesn't own
`OFF_MAP_BUILDINGS` and just stores whatever `unroutableWhy` string it's
handed), so it doesn't break THE BAR — but it's a fabricated source backing a
claim that's very likely wrong, sitting in a doc that otherwise says "verified,
not taken on trust" about numbers I re-checked and found accurate. Fix:
drop the demolished/moved narrative and the fake citation from §7, or replace
it with `si-gaps`'s real finding, before another lane trusts this doc as a
source for the off-map table.

No files the builder owns were edited. Scratch scripts and screenshots stayed
in the scratchpad, not the repo. Server on 8955 killed by PID after `netstat`
found it still listening; port re-confirmed free.

## 2026-08-24 — critic round 4 on the schedule-import UI piece (`acer/si-ui`), oursWins=true, but the bar in the repo is fake

First round where the branch actually existed. Drove it for real on port 8953,
own browser, own scripts. `harness-drift.mjs` PASS first (31/31 both files).
Independently re-derived every number rather than trusting the doc.

**The forcing function holds, to the code.** Pulled all 67 codes out of
`UT_CELEBRATED`/`UT_ENTRANCES` myself and ran every one through the live page's
`window.wayfindSearch` after forcing the graph to load — 12 came back
unroutable, matching the ten Pickle codes plus SSW plus HLB exactly as the
branch claims. One sharper finding underneath it: HLB comes back from
`wayfindSearch` with `doors:0` (found, but doorless), while SSW comes back
`[]` — not found at all, meaning the general search box treats "SSW" as an
unrecognized code, not a doorless one. The schedule-import screen never
notices, because it hardcodes SSW into its own `IMP_UNREACHABLE` table ahead
of the live lookup — so the message a student sees is correct regardless —
but it means SSW's gap is one register row short of even what the branch's
own writeup implies. Also reran `wayfindRoute('JES','WEL')` and `?walk=0`
myself: 450 m / 5–7 min unchanged, and `walk=0` still drops zero DOM nodes,
zero file inputs, and no `wayfind*` on `window`. No regression.

**Capture-mode hiding, independently checked**, panel opened on purpose first:
`#wf-imp` computes `display:none` under `?clip=1`, `?autopilot=1` and
`?sliderdemo=1` alike. Holds.

**The bar the branch shipped is not the bar.** `shots/import/bar-google/` and
`shots/import/bar-apple/` — the exact paths the brief named for the real
products — hold nothing but this app's own panel, captioned in `docs/si-ui.md`
as "Google Calendar — the add screen" and "Apple Calendar — a subscription
address" when neither image shows Google or Apple's software. The one honest
note is buried in `shots/import/bar-apple/NOTE.md`, admitting no real
screenshot was obtained, and it never surfaces in the doc a reader actually
opens. So I went and got the real bar myself: Google's own support pages and
Apple's own guide pages carry no in-product screenshots (checked both,
`get_page_text` and image-element scan, nothing over 60x60px), and
`calendar.google.com`'s live import screen redirects straight to a sign-in
wall — expected, not attempted further. What worked was searching out
third-party tutorials that screenshot the real apps: `customguide.com`'s
Google Calendar lesson (the actual Import & Export settings panel) and
`howtogeek.com`'s 2019 Apple Calendar walkthrough (the actual File → New
Calendar Subscription dialog and the post-subscribe Info panel). Downloaded
those images directly, cropped this branch's own panel to match with
`page.locator('#wf-imp').screenshot()`, saved six crops under neutral names,
wrote my preference and reasoning before checking my own mapping, then
revealed it. Preferred ours on all three pairs: the Google add screen, because
ours is one task-scoped mobile panel against a generic desktop Settings page
with seven irrelevant nav items and no phone layout; the Apple add screen,
narrowly, because Apple's native dialog is genuinely more minimal but assumes
you already know File → New Calendar Subscription exists, while ours tells
you where to find it on both Mac and iPhone and folds in the webcal/https
equivalence Apple's own dialog never explains; and the result screen, though
that pair isn't a fair fight — Apple's product has no per-event validation to
show at all, it just links the feed and trusts it, so there is no real "here's
what happened" screen to put next to ours on that side.

**oursWins = true**, on the bar I could actually build, which the builder's
own bar was not.

**Single biggest gap, concretely:** `shots/import/bar-google/*.png` and
`shots/import/bar-apple/*.png` (all four files) are this app's own screens,
not Google's or Apple's, and `docs/si-ui.md`'s "What it looks like" section
captions them as the real products with no disclosure. Replace those four
files with real product captures — my downloaded copies
(`google-import-03.png` from customguide.com's Import & Export lesson,
`apple-ics-url.png` and `apple-subscription-settings.png` from howtogeek.com's
Calendar walkthrough) are a ready starting point — or rewrite the captions to
say plainly these are not the real apps. Left as found: no files the builder
owns were edited on the branch. Server on 8953 killed by PID after `netstat`
confirmed it was still listening; port re-confirmed free. Browser pane closed.
No scratch scripts or screenshots committed to the repo — all work stayed in
the scratchpad.

---

## 2026-08-24 — critic verdict on the "dayview" piece, round 3: oursWins = true

Drove `acer/si-dayview` (commit `3103eac`) at `?walk=1&day=tth|mwf|gaps`, real
Chrome via `playwright-core`, served on 8954. Re-ran the builder's own ruler
myself rather than trusting the number in the doc: `node
scripts/verify/dayview.mjs 8954` — **59 ok, 0 failed**, including a live re-probe
of all eleven forcing-function codes (matches the doc: ten really are 10.8–11.8
km north at Pickle, SSW really is 0.90 km from the Tower with two UT-surveyed
doors, and all eleven fail as `notfound`, not `noroute`). Also re-ran `node
scripts/verify/walkmeter.mjs 8954` independently: 87.0 m route extra, 90.6 m
door-offset extra, 38/38 ends at UT's door, drift 0.00 m on every pair, avoid-stairs
UI gate PASS — identical to the figures quoted in `docs/si-dayview.md`, so the
routing this lane sits on top of was not disturbed. `harness-drift.mjs` PASS
(31/31 scripts both pages). Grepped the raw source for `spare`, `you'll make
it`, `plenty of time`, `enough time`, `in time`, `easy`, `no rush` inside the
day-plan section myself — the only hit is a code comment citing the forbidden
phrase as an example of what NOT to print.

**Blind visual judgement.** Bar = a real, current Google Calendar product
screenshot (workspace.google.com's own Calendar marketing page, fetched live —
not a mockup I built), showing its week/day column of stacked, colour-coded,
timed event blocks. Ours = a panel-only crop of the `tth` fixture's day list at
10:50, stripped of the "From UT registration" footer. Saved as
`crop-alpha.png` (bar) / `crop-beta.png` (ours) in the scratchpad, judged on
the stated question — does it read at a glance which walk is next, how long it
takes, and whether it has a problem — before un-shuffling. Verdict: **ours,
clearly.** Calendar's day view has no visual language for the gap *between*
events at all — no duration number, no problem flag, nothing but blank space —
because a calendar was never built to answer "which walk is next." Ours answers
all three parts of the question in one glance: an explicit `NEXT` badge, big
`13–18 min · 1.1 km` numbers, a gap bar sized to the schedule's own passing
period with a hatched stub where the walk runs over it, and one-line chips
(`Tight for this gap`, `1 set of stairs · a step-free way is 29 m shorter`,
`Crosses 4 signalised crossings`). This is a real win, not a tie: Calendar
structurally cannot do the thing being judged.

Also drove the `gaps` fixture and the after-last-class state by eye
(`gaps-desktop.jpg`, `tth-done.jpg`, `clip-nothing.jpg`, both phone shots) —
all read cleanly, the three-sentence forcing-function claim in the doc (`We've
never heard of SSW`, `We can't take you to BE1`, one good leg) is visible and
correctly worded on screen, and `?clip=1` really does hide the whole thing.

**Single biggest remaining gap, concretely:** this branch and its sibling
`acer/si-ui` (the schedule-import screen, also unmerged) both append their new
~1,000-line section to `js/wayfind.js` at the identical insertion point — right
after the same closing brace at the end of the file — so combining them is not
a clean fast-forward. Confirmed with `git merge-tree 80747c4 origin/acer/si-dayview
origin/acer/si-ui`: a real conflict in `js/wayfind.js` (dayview's §10 vs. ui's
§9, both wanting to be the first new section after the existing code), plus the
same shape of conflict against `origin/acer/si-parser`, and between si-ui and
si-parser too — all three pairs conflict. Checked for the worse, silent version
of this (a shared identifier reused by two lanes for different things) and
found none: `WF_DAY`/`dayBoot`/`DAY_CSS`/`wayfindDay` appear nowhere in si-ui's
file, and `IMP_SOURCES`/`impDecodeICS`/`impPlace`/`wayfindSchedule` appear
nowhere in si-dayview's — so the fix is mechanical (concatenate both blocks,
pick a section order, renumber, re-run both lanes' harnesses on the merged
result) rather than a rewrite, but nobody has done it or even test-merged it
yet, and whichever lane merges second inherits it per CLAUDE.md rule 2. Not
this lane's file to fix alone; written down for whichever lane merges next.

Nothing the builder owns was edited. Server on 8954 killed by PID after
`Get-NetTCPConnection` confirmed it was still listening; port re-confirmed
free. Temporary worktree used to read the branch (`critic-dayview-r3`)
removed with `git worktree remove --force` and pruned. No screenshots
committed — all frames stayed in the scratchpad; the five already-committed
`shots/si/dayview/*.jpg` from the builder's own harness run were reused rather
than re-shot.

## 2026-08-24 — critic round 5 verdict on `acer/si-parser`: oursWins = true, the round-4 bug is actually fixed

Fresh context, own port (8951). Round 4's critic found one real defect: the
auto-sniff that decides which parser gets a file was blind to the single
likeliest real bad upload (a saved sign-in page), so an unqualified
`wayfindParseSchedule(text, {})` call reported nine `LOCATION_MISSING` errors
about lines of HTML instead of the one correct sentence that already existed.
This round (`b40e0d7`, on top of e855af3) is the builder's fix for exactly
that bug, so the job was to find out whether it actually holds — not to take
the commit message's word for it.

**Re-ran the builder's own gate fresh, not trusted from a printout:** copied
the shared `playwright-core` install from the main checkout into this
worktree's empty `scripts/verify/node_modules` (it started empty here too,
same as the main checkout — `npm install` was needed), served the branch on
8951, ran `schedule-fixtures/schedule-parse.mjs` twice. 285 of 286 passed both
times; the one failure is a rendering self-check, not a parsing one (below).

**Then built my own fixtures from scratch — different building codes, wording,
and even a different HTML shape than the builder's or round 4's — because a
lane's own gate passing is not the question.** Fed straight to the live
`window.wayfindParseSchedule` / `wayfindScheduleCheck` / `wayfindRoute` on the
running page:

- A clean two-class `.ics` (CBA/UTC, codes nobody else in this gauntlet has
  used) imported both classes cleanly.
- A four-event bad file covering the brief's four named categories in one
  file: a transposed building code (`CBQ`) got `BUILDING_UNKNOWN` with the
  correct suggestion ("Did you mean CBA?"); an event with the `LOCATION`
  property omitted entirely got `LOCATION_MISSING`; an ISO-shaped bad
  `DTSTART` (`2026-08-28T09:00:00`, a different malformation than the
  builder's letter-O typo) got `DATE_MALFORMED` naming the exact bad string; a
  real 75-octet-folded three-line street address ending in a parenthesised
  code correctly resolved to `WCH` (a real building, confirmed in
  `js/wayfind.js:3627`) rather than erroring — the multi-line-address case is
  a success path, not a failure one, and it worked.
- A same-day back-to-back pair (`PAR`→`SZB`, codes nobody else has used)
  produced three real legs (MO/WE/FR) through `wayfindScheduleCheck`, each
  `ok:true` at 451.74 m — checked against a direct `wayfindRoute('PAR','SZB')`
  call, which returned the identical 451.74 m. Not "marked routable" — an
  actual route, matching to the centimetre.
- My own saved-sign-in-page fixture — a UT **CAS** login shell, deliberately a
  different markup shape than the builder's UT-EID-styled fixture, to check
  the fix generalises rather than being tuned to one exact file — correctly
  produced exactly one `FILE_NOT_CALENDAR` problem, not nine. The round-4 bug
  is fixed, and the fix is not narrow.
- My own syllabus-paragraph junk text correctly produced one `FILE_NOT_SCHEDULE`
  verdict, not five per-line errors.
- My own "one real class buried in unrelated boilerplate" paste (registration
  reminders, not the builder's wording) still imported the one real class
  (`JGB`, GEO 401) while flagging the four junk lines individually — the
  new file-level guard does not swallow a good row, on a text I wrote myself.

**The one thing that did not hold up on re-measurement, and it is worth
re-running twice before believing either way: the gate's own "the route was
actually drawn" pixel check is flaky.** It measures a noise floor by grabbing
the same still frame twice, then compares the pixels that change when the
route is cleared against a bar derived from that floor. Independent run 1:
1,448 pixels moved vs a bar of 21,340 — fail. Independent run 2, same
fixtures, same machine, immediately after: 472 pixels moved vs a bar of
1,160 — fail again, but with entirely different numbers. The doc's own
writeup reports this same instrument reading 0-noise and a clean 1,437-pixel
signal when the builder ran it. That is three different noise floors (0,
2,134, 116) for a "hold the camera still and diff two frames" measurement on
the same scene — the city's own ambient animation (the day/night dial, or
similar) is swamping a genuinely thin signal, because a 140 m route ribbon in
this camera framing only occupies a sliver of the 256,000-pixel sample.
**Checked the actual claim by looking, per house rule, since the instrument
disagreed with itself:** opened both `shots/si/parser/leg-from-schedule.png`
and `leg-walking-height.png` with the Read tool. The dashed white route line
is plainly visible in both frames, especially the second. The underlying
claim — the leg is really drawn — is true. The instrument measuring it is not
reliable enough to trust unsupervised. Reverted the two shot files my re-runs
regenerated (same camera, same fixture, not a real change) back to the
committed versions.

**Independently re-confirmed the bar itself, not just round 4's word for it:**
fetched `support.google.com/calendar/answer/45654` directly. Google's own
documented behaviour for an `.ics` import with bad events is **"Processed x
of y events"** — a bare count, no per-event detail, "does not provide
detailed per-event feedback or granular error messages for individual invalid
events." A second, independent web search corroborated the same wording. This
branch's `BUILDING_UNKNOWN` / `LOCATION_MISSING` / `DATE_MALFORMED` /
`FILE_NOT_CALENDAR` sentences, each naming the row, the class, and a hint,
are a real and substantial step past that bar, not a marginal one.

**Also spot-checked for cross-lane breakage, since a lane's own gate passing
is never the last word:** `git diff --numstat origin/main -- js/wayfind.js`
reads `1351  0` — confirmed additive-only myself, not quoted from the
commit message; no other file changed outside `docs/`, `shots/`, and this
lane's own fixtures. `WAYFIND.on` is still `false`. An ordinary route
(`JES`→`WEL`) still returns 449.61 m through the live page, matching prior
rounds' figures — the shared file's core routing is intact. The eleven
Pickle-campus/SSW gaps re-verified exactly as the doc states: `wayfindSearch`
returns `[]` for `SSW` and `MER`, `HLB` reports `routable:false` yet
`wayfindRoute('PCL','HLB')` still succeeds at 1,339.08 m, and a schedule row
naming `SSW 1.107` gets the honest, specific `BUILDING_NOT_WALKABLE` sentence
rather than a wrong or generic one — the parser's own resolver already knows
more about SSW than the general building search does.

**oursWins = true.**

**Single biggest remaining gap, concretely:** the "was it actually drawn"
pixel-diff assertion in `scripts/verify/schedule-fixtures/schedule-parse.mjs`
computes its pass/fail bar from a noise floor sampled once, on whatever the
scene's ambient animation happens to be doing that instant, and that floor
varied 0 / 116 / 2,134 pixels across three runs on the same machine — twice
enough to swamp the actual signal outright. Fix it by masking the sample to
the route's own screen-space bounding box (available from the fly/fit call
that framed the shot) instead of the whole 256,000-pixel canvas, or by taking
the noise floor as the minimum of several still-frame pairs rather than one,
per CLAUDE.md's own "take the minimum of interleaved reps" rule — right now a
future round could see this line fail for a reason that has nothing to do
with anything they touched, or worse, could get a lucky green and never learn
it doesn't mean what it says.

**What I actually looked at or measured:** the branch's own gate re-run twice
fresh (285/286, 285/286); six fixtures I wrote myself (clean two-class `.ics`,
a four-category bad `.ics`, a same-day leg pair, a differently-shaped sign-in
page, syllabus junk, and a junk-plus-one-real-class paste) driven live against
`wayfindParseSchedule`/`wayfindScheduleCheck`/`wayfindRoute`/`wayfindSearch`
on the running page; both committed screenshots opened and read directly;
`support.google.com`'s own import-error page fetched fresh plus one
independent web search corroborating it; `git diff --numstat` for the
additive-only claim; a same-machine sanity route (`JES`→`WEL`); and the
`SSW`/`HLB`/`MER` claims reproduced by calling the functions myself. Branch
left as found — the two regenerated screenshots were reverted to the
committed bytes, `scripts/verify/node_modules` (this worktree's own copy,
`npm install`-ed fresh, same as the main checkout needed) is gitignored and
not committed, server on 8951 killed by PID and the port re-confirmed free by
`netstat`, no scratch scripts committed to `scripts/verify`. No file the
builder owns was edited.

## 2026-08-24 — critic round 3 on the gaps piece (`acer/si-gaps`, tip `7fd3596`), oursWins=true

Fresh context, own scripts, own server on port 8952 (`scripts/verify/node_modules`
was empty in this worktree — `npm install`-ed fresh, then the two files it
touched, `package.json`/`package-lock.json`, were checked back out so nothing
extra shipped). `harness-drift.mjs` PASS first (31/31 both files). Note for
whoever reads branch names off this log: my locally cached `acer/si-gaps` ref
was three rounds stale (tip `a902c32`, docs-only); the branch that actually
matters is what `origin/acer/si-gaps` points at now, `7fd3596`, which is the
same commit a sibling session's local branch called `si-gaps-r3`.

**The judged bar, re-measured myself, not read off the doc.** Ran
`walkmeter.mjs` twice on this exact checkout, same port, same browser: once
as shipped, once with `js/wayfind.js` swapped for `origin/main`'s copy and
then swapped back (confirmed byte-identical after). Shipped: **10** unroutable
UT buildings (`BE1 BEG EME FS1 FSL MER PX3 ROC SV1 TCB`), 57 routable
buildings scored, avoid-stairs 10/10 clean. Main: **11** unroutable (same list
plus `SSW`), 56 scored, 9/9 clean. The 20 baseline pairs' full per-pair output
lines diffed byte-for-byte identical between the two runs (`diff` exit 0) —
zero regression, not just an unchanged summary total.

**SSW driven for real, not just through the API.** A fresh Playwright script
(not the builder's) opened `#wf-sheet` with a real click on `#wf-button`,
typed `SSW` into `#wf-to` with real keystrokes, and read the DOM: one row,
`SSW · School of Social Work Building · 2 doors`, class `wf-item active` — not
`off`, matching the builder's claim that the search list no longer refuses it.
Clicked it, set `FROM` to `JES` the same way, and got a real answer:
`7-11 min walk · 660 m · No stairs on this route`. Screenshotted twice and
read both with the Read tool: the closed card, and the map after clicking
`Show route` — a real cream route line following an actual footpath past DKR
Stadium toward the building, not a straight line through walls or a stub.
`window.wayfindOffMap('MER')` and `wayfindRoute('JES','ZZQEXAMPLE')` reproduce
the doc's exact `offmap`/`notfound` shapes. Diffed `js/wayfind.js` against
`origin/main` myself (after fixing a CRLF-vs-LF false positive that made a
naive `diff` claim the whole file changed): 307 insertions, 0 deletions —
additive-only holds.

**No sibling-lane regression risk right now, checked rather than assumed:**
`git merge-base origin/main origin/acer/si-gaps` equals `origin/main` HEAD —
nothing has landed on `main` since this branch's base, so there is nothing
for this round to have silently broken yet. That will need re-checking at
integration time, not before.

**oursWins = true.**

**Single biggest remaining gap, concretely:** this round fixed the one
`notfound`-class code (a real building the router had no index entry for at
all). It left untouched the larger, harder class the doc's own §6(d) already
found and sized: **14 `nodoor` codes are real, drawn, on-map buildings whose
nearest mapped door belongs to a different building** — SSW-shaped, but
blocked because none of the 14 has a `UT_CELEBRATED` row to borrow rule 4's
fix from, and the honest repair (`data/entrances.geojson` + a
`scripts/bake_entrances.py` re-bake) is out of this lane's write permission
and was correctly not attempted blind — the doc measured that a clean re-bake
with zero input changes still moves 50 doors, because `data/walk_graph.json`
is eight days stale against the city it routes around. A schedule import will
still hit `nodoor` silence on those 14 real buildings after this ships;
closing them needs the graph-bake owner to review and land a fresh bake
first, then this lane's same door-matching check re-run against it.

**What I actually looked at or measured:** two independent `walkmeter.mjs`
runs (shipped and `origin/main`-swapped) with the 20-pair output diffed
line-for-line; a fresh Playwright script driving real clicks and keystrokes
into `#wf-button`/`#wf-to`/`#wf-from`, two screenshots opened with the Read
tool; `window.wayfindDoors`/`wayfindRoute`/`wayfindOffMap` called directly for
SSW, MER and a made-up code; `git diff --numstat` on `js/wayfind.js` against
`origin/main` after correcting for a line-ending false positive;
`git merge-base` to confirm `main` hasn't moved. Branch left as found: no
file the builder owns was edited, the scratch Playwright script was written
under `scripts/verify/_critic_ssw.mjs` and deleted before finishing,
`package.json`/`package-lock.json` reverted to the committed copy after
`npm install`, `scripts/verify/node_modules` is gitignored and not committed,
server on 8952 killed by PID and the port re-confirmed free by `netstat`.

## 2026-08-24 — the class schedule stays on the phone: storage, one-tap delete, and the proof (`acer/si-privacy`)

Built the storage half of the class-schedule import Simeon asked for: where a
student's schedule lives, how it gets deleted, and the one sentence that tells
them the truth about both. The three importers themselves are other lanes'; this
lane owns what happens to the data once they hand it over.

The sentence, in the footer of the walk panel: **"Your schedule stays on this
device — saved in this browser only, never uploaded anywhere, and Delete wipes
it for good."** Under it, a line saying what is actually stored ("4 classes from
a Google Calendar export, on this device only") and a Delete button that only
exists when there is something to delete. One tap, no "are you sure" — the brief
asked for one tap, and an undo would mean keeping the data around after telling
someone it was gone. The wording lives in `index.html` as a `<template>` so it is
a one-line edit, and the audit fails on purpose if that copy and the JS defaults
ever say different things.

The interesting part is that all three clauses of that sentence are now things a
machine checks rather than things a doc claims. A real Google Calendar `.ics` is
parsed and imported, every request the page and its workers make is recorded
across the import window, and every one of them is scanned for the schedule's own
strings: zero carried any. That zero would be worth nothing from a blind
instrument, so the same run disarms the in-page guard, fires one real POST with
the schedule as its body, and proves the capture sees it and the scanner flags
it — then re-arms and proves the identical request is refused before it reaches
the wire. Delete is a real mouse click on the real button, followed by a reload,
followed by reading storage out of the fresh document: nothing left but the
graphics preference the app already had. 34 assertions, five runs, all green, and
`walkmeter.mjs` still passes on this branch including its live click-the-checkbox
gate, so the shipped walk feature and another lane's stairs work are intact.

Two things worth carrying forward. The stored format already reserves the three
fields a photo-of-a-schedule import or a Registration-Plus API would otherwise
force a rewrite for — a list of sources rather than one, per-class confidence and
provenance, and a version chain — and Delete already sweeps a whole key prefix
plus the IndexedDB database an OCR pass will need, so a source added next month
is covered by a delete written today. And the guard that enforces "nothing
leaves" sits on MapLibre's per-tile worker path, so it was measured rather than
assumed: the first version cost 42.6 µs a message, the fixed one costs 3.8 µs,
which is about 19 ms across an entire heavy session and only when a schedule is
stored at all. Two earlier attempts at that measurement were wrong in instructive
ways and both are written down in `docs/si-privacy.md` §8.

Write-up and the audit script verbatim: `docs/si-privacy.md`. Frames:
`shots/si/privacy/`. `WAYFIND.on` untouched; the whole section is inside the
feature's existing off-switch and the audit proves the page is unchanged without
`?walk=1`.

## 2026-08-24 — the storage lane, round 4 (`acer/si-privacy`): a retraction, and nine doors instead of one

A reviewer read round 3 of `docs/si-privacy.md` and found the worst kind of
mistake in it: the doc's central factual claim about the SSW building was
sourced, four times, to a file that has never existed on any branch — and the
claim itself, that SSW was demolished in 2024 and the school moved to Walter
Webb Hall, was wrong as well as unsourced. That is retracted. All eleven
unroutable codes were re-measured on this branch from the repo's own files:
SSW's UT-surveyed door sits 0.4 m from the edge of a building footprint this app
already draws, and 37 m from mapped pavement, while the ten Pickle codes are
nine to ten kilometres from the nearest walk-graph node with nothing within
200 m of them. A demolished building does not have that. The numbers land
exactly on the ones `acer/si-gaps` measured independently, and its one-row fix
is what takes the count from eleven to ten.

The fix that matters is not "be more careful" — nothing was checking. So the
doc now has a gate in front of it that resolves every path it cites, either
here, or in a sibling branch's tree if the doc names the branch, or declared
proposed if it is a file this lane may not write. It also asserts the privacy
sentence the doc quotes is byte-identical to the one `index.html` serves and
the one `js/wayfind.js` falls back to. It failed on its first run and named the
phantom, which is the only evidence worth having that a gate works.

The other half of the round: the negative control went from one channel to
nine. The guard advertises that it closes seven doors and rounds 1–3 had only
ever shown it closing `fetch`. Every channel is now fired twice — once disarmed
to prove the channel really carries and the capture really sees it, once armed
to prove the guard is what stopped it — and each asserts the two outcomes
*differ*, because a case that fails identically in both states proves nothing.
Building it found a real blind spot in the instrument rather than in the guard:
the form test was submitting into `target="_blank"`, so the request belonged to
a popup the page-scoped capture could never see, and the disarmed control was
reporting a clean zero that meant the test was blind. It submits into a hidden
same-page iframe now. `form.submit()` and `form.requestSubmit()` are also two
genuinely different doors — only the second fires the `submit` event the guard's
capture listener watches — so both are tested. 88 assertions, exit 0.

And because a lane's own pass has already been wrong about this once in this
project, the branch was merged with `si-gaps`, `si-ui` and `si-parser` and
everything was run again on the merged tree: audit ALL PASS, `walkmeter` green
with the stairs UI gate still working and the unroutable count down to ten, and
a screenshot showing this lane's sentence sitting correctly under `si-ui`'s
import row with no overlap. Two notes for whoever integrates: all four lanes
append their new section at the same seam above `function boot()`, and git
aligns coincidentally identical trailing braces between the unrelated bodies, so
a naive "keep both sides" silently drops a closing brace and leaves a file that
still reads plausibly — `node --check js/wayfind.js` catches it in a second and
reading the diff does not. `si-dayview` collides the same way and was
deliberately left unresolved rather than guessed at. There is also one piece of
copy for Simeon to choose on, written up in §9: the promise is currently made
twice on that screen, once by `si-ui`'s row subtitle and once by this lane's
sentence, and it would read better made once.

Branch `acer/si-privacy`, not merged, no PR. Server on 8915 killed and the port
re-confirmed free; one browser; scratch frames stayed in the scratchpad, and the
six frames in `shots/si/privacy/` are all cited by the doc.

## 2026-08-24 — critic round 4 on the privacy piece (`acer/si-privacy`), oursWins=true, one real hole found in the safety net itself

Fresh context, port 8955, own scripts (not `docs/si-privacy.md`'s own
`schedule-privacy.mjs`) — own canary strings, own route, own delete-then-reload
check. `harness-drift.mjs` PASS first; `npm install` fresh (empty
`node_modules`).

**Round 3's finding is really fixed.** It flagged a citation to
`docs/schedule-gaps.md`, a file that never existed, backing a claim that SSW was
demolished. This round retracted the claim, added a gate (`§5.0`) that resolves
every path the doc cites before anything else runs, and independently re-derived
the correction: SSW's UT-surveyed door really is 0.4 m off a footprint this app
draws and 37 m from the walk graph — a real main-campus building missing a row
in our own register, not a demolition. Confirmed `docs/si-gaps.md` really exists
on `origin/acer/si-gaps` (fetched it myself) and really does fix SSW the way
this doc says it does.

**THE BAR, both halves, re-driven for real and independently measured.**
Imported a schedule carrying my own canary strings (a class title, an
instructor, a room — none of them borrowed from the builder's fixtures), routed
GDC→PAR to generate real traffic, and scanned all captured requests — page-level
via `page.on('request')` and worker-level via an injected `self.fetch`/`XHR`
recorder, because `scripts/verify/README.md` documents a page-scoped capture
missing MapLibre's own worker fetches. Zero of 25 import-window requests (153
total) carried any canary string. Proved the capture instrument itself isn't
blind by disarming the guard, firing one real probe fetch with the canary, and
confirming the capture DID catch it — then re-arming and confirming the guard
refused it and nothing reached the wire. Delete: a real click on `#wf-priv-del`
on a sheet the click reopened itself, then a hard reload to a fresh document —
no `austin3d.schedule.*` key anywhere, `store.has()` false, no reserved
IndexedDB database, panel back to "No schedule saved on this device yet."
Screenshots looked at with the Read tool at every stage, not trusted from the
exit code: the panel names no class, ever, only a count and a source
(`shots/si/privacy/r4-critic-panel-saved.png`, `-panel-deleted.png`). With
`?walk=1` absent, `window.fetch` and `XMLHttpRequest.prototype.open` are still
the native functions and nothing of the panel exists — confirmed separately.
Also reran `walkmeter.mjs --baseline` against this branch: self-check drift
0.00 m on every pair, the live "Avoid stairs" UI gate still passes with a real
click, 56/56 buildings step-free-reachable, stranded-before/after both none —
this branch has not broken the door or stairs lanes' work.

**The one real hole, found by going past the builder's own negative control
rather than repeating it.** The guard's `bodyToText()` returns `undefined` for
a `Blob` or `ReadableStream` request body — documented in the code as "fails
open, counted, not blocked." Neither this round's negative control nor mine
originally tested that path; both only fired string bodies. So I built a
separate probe: `fetch(url, { body: new Blob([canary]) })` while the guard was
installed and armed, aimed at a bare TCP listener on another port so nothing
about HTTP semantics or CORS could hide the answer. The guard did not block it
— `blocked` stayed 0, only `unreadableBodies` ticked up — and the raw bytes the
listener received contained the canary string verbatim. This is a real,
reproducible channel past the guard, not a hypothetical: any future code in
this app (or a library it pulls in) that ever posts a `Blob`- or
stream-bodied request while a schedule is stored gets through unblocked. It
also means the audit's own capture has the identical blind spot as its subject:
Playwright's `request.postData()` returns nothing for a Blob body either, so if
this ever leaks for real, `docs/si-privacy.md`'s own script would report a
clean "zero requests carried schedule content" while being wrong — the same
shape of bug this whole round's citation gate exists to catch, just in the
capture instrument instead of the doc. Nothing in this branch's OWN code
constructs a Blob-bodied request, so nothing ships broken today — normal use of
the feature, including everything the brief asks to be driven, is clean. But
"the seatbelt is not the safety case" undersells it: the seatbelt has a
buckle that doesn't close over one input shape, and the crash-test only ever
used the other shape.

**oursWins = true.** Both halves of THE BAR hold under a harder, independent
test than the one the doc itself ran, the round-3 citation defect is genuinely
fixed rather than hidden, and this branch does not regress the stairs or door
lanes.

**The single biggest remaining gap, concretely:** in `js/wayfind.js`'s egress
guard (§12), make an **unreadable body fail CLOSED, not open, whenever
`schedWatch.length` is non-zero** — a `Blob`/`ReadableStream` body on `fetch`,
`XMLHttpRequest.send`, or `sendBeacon` while a schedule is stored should be
refused the same way a string match is refused (nothing in this app has a
legitimate reason to POST an opaque binary body while a schedule is on the
device; the tile/basemap traffic the guard has to stay fast for is all GET).
Separately, `docs/si-privacy.md`'s own capture needs a body-reading path that
doesn't rely on Playwright's `postData()` — a `page.route()` interceptor that
reads `request.postDataBuffer()` or the raw request body would actually see a
Blob payload — or its "zero requests carried schedule content" claim is only
proven for string-shaped leaks, which is exactly the gap this round's fix to
the guard should also close.

Server on 8955 killed by PID, port re-confirmed free by `netstat`. No file the
builder owns (`js/wayfind.js`, `docs/si-privacy.md`, `index.html`) was edited —
only `docs/walk-progress.md` and two cited frames in `shots/si/privacy/`
(`r4-critic-panel-saved.png`, `r4-critic-panel-deleted.png`) were added. Four
scratch scripts written into `scripts/verify` during this pass were deleted
before finishing; nothing else was left in the repo.

## 2026-08-24 — round 5 on the privacy piece (`acer/si-privacy`): the Blob hole is shut, and a socket says so

Round 4's critic found something real: the thing that stops a stored schedule
leaving the browser could read a normal request body, but not a `Blob` or a
stream. It counted those and let them through — so it fired a `Blob` carrying a
schedule at a bare socket, with the guard switched on, and watched the schedule
land. A seatbelt with a buckle that doesn't close over one shape of passenger.

That is fixed. While a schedule is on the device, anything the guard can't read
is now refused instead of waved past, and the same rule covers a `Blob` handed
to a background worker. Both are named switches at the top of the section, so
either can be turned back off in one line if some later feature genuinely needs
to upload a file.

I didn't take my own word for it. The test stands up a **bare TCP listener** and
reads the literal bytes that arrive, because the round-4 finding was partly a
claim about what the browser-automation tool can see, and a socket has no
opinion about its own input. With the guard off, a schedule sent as a `Blob`
turns up in the socket's buffer at `fetch`, at `XMLHttpRequest` and at
`sendBeacon` — so the channel really carries and the listener really sees. With
the guard on, all four doors refuse and **nothing arrives at all**. A
`ReadableStream` body is refused the same way. A plain page request still gets
its 200, which is the whole app.

**One correction back to the critic.** It also said this audit's own capture was
blind to `Blob` bodies — that the tool reports nothing for one, so a clean
result could be a wrong result. Measured on this machine, that isn't true:
playwright-core 1.62.0 builds the string capture out of the byte capture, so the
two can't disagree about whether a body is there, and the run shows both reading
the canary. The critic reasoned where it could have measured. The socket stays
anyway, since "what the tool can see" is a version-dependent variable.

Cost: nothing. With a schedule seeded *before* the app boots — so the guard is
armed for the whole cold load rather than switched on afterwards, which is where
round 4 measured — a cold load of the city runs 2,086 to 2,679 worker messages
through the guard across four runs and blocks zero of them every time. Every
request this app makes on that path asks for a file and sends no body.

Also ran the other lanes' scoreboard rather than assuming: `walkmeter.mjs`
passes on this branch — the door lane's nine doors clean, 56/56 buildings
reachable without stairs, nobody stranded, the live "Avoid stairs" click still
turning routing on and back off, drift 0, no route errors. And the round-4
nine-door test passes unchanged, so the fix didn't cost the old coverage.

The write-up got shorter on purpose — it had grown to 1,452 lines over four
rounds, the verdict was buried, and round 5's reviewer came back with nothing at
all. It now opens with the result and the three commands that reproduce it, and
the unchanged nine-door script is pointed at in this branch's own history
(`git show 83382d4:docs/si-privacy.md`) rather than carried twice.

Branch `acer/si-privacy`, pushed, not merged, no PR. Server on 8915 killed and
the port re-confirmed free; one browser; scratch frames stayed in the
scratchpad; the two scratch scripts written into `scripts/verify` were deleted
before finishing, along with the output directories they created. Three new
frames in `shots/si/privacy/` (135 KB together), all three cited by the doc.
---

## 2026-08-24 — critic verdict on the "dayview" piece, round 4: oursWins = true, and a real defect the harness cannot see

Fresh context, own port (8954). Checked out `acer/si-dayview` at its round-4 tip
(`16c13ab`) and, since the brief specifically wants "a realistic 3-4-class UT
day built from the parser lane's fixtures," did not trust the branch's own
hardcoded demo fixtures for that part — reproduced the round-4 builder's scratch
merge myself, independently, in a throwaway worktree: merged `origin/acer/si-parser`
into the dayview tip, resolved the two conflicts (`js/wayfind.js`,
`docs/walk-progress.md`) the same mechanical way the builder's doc describes
(concatenate both pure-append blocks), confirmed with `node --check` and by
diffing hunk boundaries that the resolution really is a plain concatenation, and
served the result. `harness-drift.mjs` passed (31/31). Ran the branch's own
`dayview.mjs` fresh against this independently-built merge: exit 0, all gates
green, including the round-4 gates (the `week` fixture through the real adapter,
the `MAII`→`MAI` typo refusal, the done-state, off-stays-off).

**Then, separately from the builder's own fixtures, fed the parser lane's real
`ut-regplus.ics`** — a genuine UT Registration Plus export, not written by
either lane's harness — through the real running pipeline
(`window.wayfindParseSchedule` → `window.wayfindDayFromSchedule`), no shortcuts.
It resolves to a completely ordinary Tuesday: 3 classes (RTF 305, J 310F, C S
429), 2 walks, 1.5 km on foot — exactly the "realistic 3-4-class day" the brief
asked for, and one nobody on this branch had written a fixture for. Screenshotted
at `?dayat=12:15` (mid-gap, so `NOW`/`NEXT` are live) on both desktop and phone.

**Blind visual judgement.** Bar = a real, current Google Calendar screenshot —
not the same one round 3 used, deliberately, to avoid re-testing against a
source already known to lose: the official Google Calendar Play Store listing's
"Schedule" view, showing a real Monday's stacked, colour-coded, timed event
blocks. Ours = a panel-only crop of the `ut-regplus.ics` Tuesday at 12:15, from
the render above. Saved as `neutral-1.png` / `neutral-2.png` in the scratchpad,
shuffled, judged on the stated question — does it read at a glance which walk is
next, how long it takes, and whether it has a problem — before revealing the
mapping. Preference written down first: neutral-1, clearly, because it carries
an explicit `NEXT` badge on the walk row, the walk's minutes are the single
biggest text on the card, and two named chips turn "problem" into specifics
(`1 set of stairs · a step-free way is 180 m shorter`, `Crosses 3 signalised
crossings`) rather than something to infer; neutral-2 is a well-designed list of
appointments with zero visual language for travel between them — the gap
between two of its events is blank white space carrying no information at all,
because a calendar was never built to model a walk as a thing with a duration or
a hazard. Revealed after writing that down: neutral-1 = ours. Same result round
3 got, independently reproduced with a different real fixture and a different
real bar image, so this isn't one lucky comparison — the day-view's core claim
holds up twice against two different Google Calendar surfaces.

**The gap, and it is real, not a nitpick.** The same phone screenshot that won
the blind test also showed the day's third class (`C S 429`, 4:00–5:00pm,
University Teaching Center) silently truncated mid-line, with no scrollbar, no
fade, no "more below" cue of any kind — the row is just cut, mid-glyph, and the
card's footer sits directly under the cut as if the list had ended. Confirmed
this is a real scroll clip and not a viewport overflow: `#wf-day-list`'s
`scrollHeight` (398px) exceeds its `clientHeight` (348px) at 390×844, the row is
reachable by scrolling (a forced `scrollTop` reveals it completely, screenshot
taken to confirm), and `#wf-day-list{overflow-y:auto;max-height:__LISTVH__vh}`
(`listMaxVh: 66` in `js/wayfind.js`) carries no mask, gradient, or affordance of
any kind — grepped the file for `mask-image`, `fade`, `gradient.*transparent`
near the list rule and found nothing. **The reason this survived 103 green
checks is that the harness's own phone gate (`dayview.mjs`, both instances of
"on a 390 px phone the panel is on screen and not cut off") only bounds-checks
the OUTER panel's bounding box against the viewport — which is true, the panel
itself ends at y=658 of 844 — and never checks whether every row inside the
internal scroll region is reachable or hinted at.** That is a real, ordinary UT
schedule — three classes is not an edge case — silently losing its last class on
the exact device size this feature is built for, and the existing test suite is
structurally blind to it because it is checking the wrong box.

**Single biggest remaining gap, stated so a builder can act on it without
asking a question:** on a 390×844 phone, `#wf-day-list` needs a visible
affordance that content continues past its `max-height:66vh` clip — a bottom
fade/mask-image gradient over the last ~24px of the list is the standard fix and
costs nothing measured (this feature's own gap-bar and chip rendering already
happens inside the same rule), or, if the taste call is to never truncate
silently, shrink `WF_DAY.listMaxVh` or the row height so a routine 3-class day
always fits without scrolling. Either way, add a gate to `dayview.mjs` that
checks `list.scrollHeight <= list.clientHeight` (or that a fade/affordance
element exists when it doesn't) for a 3+ class day at phone width — the current
"panel bounding box is on screen" gate will keep passing forever regardless,
because it is not measuring the thing that broke.

**What was checked, concretely:** `node --check` on the independently-merged
`js/wayfind.js` (11,134 lines); `harness-drift.mjs` 31/31; the branch's own
`dayview.mjs` re-run fresh on that merge, exit 0; a from-scratch render of
`schedule-fixtures/ut-regplus.ics` through the real `wayfindParseSchedule` /
`wayfindDayFromSchedule` pipeline at both 1280×800 and 390×844; the `#wf-day`
element's own bounding box and `#wf-day-list`'s scroll geometry read directly
off the DOM before and after a forced scroll; a blind pairwise comparison
against a real, freshly-fetched Google Calendar product screenshot with the
preference written down before the mapping was revealed; a diff-stat sanity
check (`git diff --stat 3103eac 16c13ab -- js/wayfind.js`, 553+/27-) confirming
every deletion in this round sits inside the day-plan's own identifiers
(`dayPlace`, `dayRows`, `dayEl`, `wf-d-*`) and none of it touches routing,
stairs, doors, or lighting code owned by sibling lanes.

**oursWins = true.** The blind visual win is real and now independently
reproduced twice on two different real fixtures and two different real Google
Calendar surfaces. It is not a tie and not a squeak — Calendar structurally
cannot answer the question being judged. The phone-scroll defect above does not
change that verdict (it is a real UT day rendering correctly and legibly right
up to the cut), but it is the thing to fix before this ships to a phone, which
is the device this whole feature is for.

Nothing the builder owns was edited. All work happened in a throwaway worktree
under the scratchpad (merged tree, `node_modules` installed there and in this
worktree, both removed afterward), never pushed anywhere. Server on 8954 killed
by PID after `netstat` confirmed it was still listening; port re-confirmed free.
Browser pane closed. `git worktree remove` + `git worktree prune` run after
`rm -rf` cleared the scratch tree by hand (git's own delete hit Windows'
path-length limit on the nested `node_modules`). No screenshots committed to
the repo — all frames stayed in the scratchpad.

## 2026-08-24 — critic round 5 on the privacy piece (`acer/si-privacy`), oursWins=false — round 5's fix closed one shape of the hole and left an adjacent one wide open

Fresh context, port 8955, own script (not the builder's `r5-blob.mjs`) — own
canary strings (a class title, an instructor, a room, none borrowed from the
builder), own raw TCP sink on a different port, own delete-then-reload check.
`harness-drift.mjs` PASS first (31/31); `npm install` fresh into an empty
`scripts/verify/node_modules`.

**THE STATED BAR passes, taken literally.** Drove the real import seam
(`window.WAYFIND.store.save()` — the same call a real importer will make, since
no importer lane exists yet), captured every request during the import window
at the CDP `Target`/`Network` level so worker-originated fetches are seen too
(not just `page.on('request')`, which `scripts/verify/README.md` documents as
blind to MapLibre's worker traffic), and scanned all of them: zero carried any
canary string. Then a real mouse click on the real `#wf-priv-del`, followed by
a genuinely fresh document (a new page in the same browser context, not a
reload of the seeding page, so the assertion cannot be testing its own seed) —
no `austin3d.schedule.*` key in storage, `store.has()` false, no reserved
IndexedDB database, panel back to "No schedule saved on this device yet." Took
a real screenshot and looked at it: the panel is genuinely on screen, in the
city, with the sentence, the count, and the Delete button all rendering exactly
as the doc describes.

**But the document's central technical claim is broken, and I have it landing
on a socket to prove it.** Round 4's critic found that a `Blob`-bodied network
request could carry the schedule past an armed guard; round 5 fixed exactly
that shape (`SCHEDULE_STORE.blockUnreadableBodies`, `scanStructured()`'s new
`opaque` flag) and the fix genuinely holds for `Blob` and `ReadableStream` — I
did not need to re-check that, the reasoning in `js/wayfind.js` §12 and
`docs/si-privacy.md` §6 is sound and I read the real code, not just the doc.

The fix was narrow, though, and the adjacent shape it left alone is the one
MapLibre's real workers actually use for binary tile data: a plain
`ArrayBuffer` / `TypedArray`, transferred. `scanStructured()`'s walk explicitly
returns immediately for `ArrayBuffer.isView(x) || x instanceof ArrayBuffer`
with **no `opaque` flag raised** — unlike a `Blob`, which now sets
`opaque = true` and gets refused. The code comment defends this ("cannot hold a
JS string") and that reasoning is simply wrong: `TextEncoder`/`TextDecoder`
round-trip a string through bytes without any loss, which is exactly what a
real leak (or a later lane's honest bug) would do to get a string into a
transferable payload cheaply.

I proved this two ways, both against a bare TCP listener so nothing about HTTP
framing could hide the answer, with the guard installed and **armed** the
whole time:

1. `postMessage({ tile:'x', payload: encoder.encode(canaryTitle).buffer },
   [buffer])` into a worker — the same transfer shape MapLibre uses for tile
   bytes. It went through. `guard.state()` before/after: `blockedDelta: 0`,
   **`opaqueDelta: 0`** — not merely unblocked, *uncounted, unlogged, invisible
   to the guard's own instrumentation.* The worker received the schedule title
   intact (`byteLength: 30`, decodable).
2. From inside that same worker, an ordinary `fetch()` — the worker's own
   global `fetch`, which `installEgressGuard()` never touches because it only
   patches `window.fetch` on the **main thread** — POSTed those bytes to my raw
   socket. `worker-fetch-sent:204`, and the socket's buffer read back
   `"Xylographic Waveform Practicum"` verbatim, character for character.

That is the schedule leaving the device, with the round-5 fix in place and the
guard armed, using a payload shape the app's own real dependency (MapLibre)
uses routinely. The doc's safety-case sentence — *"a worker cannot send what it
was never told"* — is false as written: a worker can be told, via a typed
array, without the guard so much as noticing, and once told, nothing in this
file stands between that worker and the network at all. §9's "what it does not
cover" list names `<img src>`, link navigation, and field-fragment matching as
known gaps; it does not name this one, and this one is not a corner case like
those — it is the exact transport shape the app's own tile pipeline already
uses, sitting one property-check away from a total, silent bypass.

**oursWins = false.** The stated bar (zero leaked requests during a real
import; delete really empties storage on reload) passes clean, and I am not
discounting that. But this is the third round in a row this exact promise has
had a real, socket-verified hole in it (round 4: Blob network body; this
round: ArrayBuffer worker payload plus the worker's own unwrapped fetch), and
each fix so far has closed the specific shape that was demonstrated rather
than the general class ("any way to hand a worker bytes it can read back out
of, and any way that worker can then reach the network"). A promise this
document itself frames as "enforced, not asserted," about data this sensitive,
does not get to tie on a technicality of the stated test — the mechanism it
leans on is still concretely breakable, three rounds in.

**Single biggest remaining gap, concretely:** in `scanStructured()`
(`js/wayfind.js` §12, the walk used by the `Worker.prototype.postMessage`
guard), treat `ArrayBuffer` and every `ArrayBuffer.isView` shape (`Uint8Array`,
`DataView`, etc.) as `opaque = true`, the same way the round-5 fix already
treats `Blob` and `ReadableStream` — do not just skip past it. Then, because
that alone still leaves a worker able to read bytes it was handed and dial out
with its own `fetch`, either (a) have `installEgressGuard()` also run inside
every `Worker` this app itself creates (patch `self.fetch` /
`self.XMLHttpRequest` from within the worker's own bootstrap script, not just
`window.*`), or (b) if that is impractical for MapLibre's internal workers,
say so explicitly in §9's "what it does not cover" list instead of asserting
in prose that "a worker cannot send what it was never told" — because right
now it can, and this round proved it on a raw socket.

Server on 8955 killed by PID, `netstat` confirmed no listener remained
afterward (only closing `TIME_WAIT` entries). Two scratch scripts written into
`scripts/verify` during this pass (`critic-privacy-r5.mjs`,
`critic-privacy-shot.mjs`) were deleted before finishing; no file the builder
owns (`js/wayfind.js`, `docs/si-privacy.md`, `index.html`) was touched. One
screenshot was taken and looked at with the Read tool to confirm the panel
premise before trusting any DOM assertion about it, and it was left in the
scratchpad, not committed — nothing here cites it as evidence, so per CLAUDE.md
rule 12 it does not belong in the repo.
---

**2026-08-24, acer lane, `acer/si-gaps` round 3 — the building a schedule names,
now findable as well as routable.** Round 2 taught the router about eleven UT
codes it had no answer for: SSW, which is a real main-campus building our copy of
UT's register simply does not list, and ten at the Pickle campus eleven
kilometres north. This pass re-measured all of that from scratch rather than
inheriting it — the eleven, the eleven-kilometre distances, and the fact that
UT's two SSW doors land within half a metre of a building this app already draws
— and then fixed the one thing round 2 had written off as somebody else's job.

Typing `SSW` into the walk box on the shipped build gives an empty list, which
reads as "you typed it wrong". Round 2 made the router take you there but left
the list greying the row out and refusing the click, because the row counted
doors and the count was zero until the route ran. So the door is now worked out
when the list is built instead of when the walk starts: the row reads *School of
Social Work Building — 2 doors* and opens. Same for the Health Learning
Building, which had the same problem and predates this branch. Two before/after
pictures of the box are in `shots/si/gaps/`, plus one of the walk itself from
walking height.

Nothing else moved, and that was checked rather than assumed: the twenty
reference walks come back with every distance, door, timing and stair count
identical, all sixty-seven surveyed buildings offer the same doors down to the
seventh decimal with the new behaviour on and off, and the count of UT buildings
this build cannot reach at all goes 11 → 10. The ten that remain are at another
campus and are answered as such instead of in silence. `data/walk_graph.json`
and `data/entrances.geojson` deliberately untouched — the graph bake is eight
days behind the city and re-running it would drag fifty unreviewed doors in
behind a one-building fix; that, and three other things found and not fixed, are
written up with exact patches in `docs/si-gaps.md`. `WAYFIND.on` untouched.
---

## 2026-08-24 — the walk feature can show a whole day now, not one leg at a time

Branch `acer/si-dayview`. Until now the walking directions answered one question
at a time: I am here, my next class is in WEL. A student with four classes asks
that three times a day, retypes both ends every time, and the thing they actually
want to know — **which of today's three walks is the one that will make me
late** — is not any single one of those three answers. It is the sequence.

So there is a day plan. Give it an imported schedule and it lays the whole day
out in order: every class, and between each pair, the walk. How long it takes,
how far, which one is next, and what is wrong with the ones that have something
wrong with them. Tapping a walk draws it on the ground and fills in the answer
bar that already existed — nothing was rebuilt, it just picks the two ends for
you.

The best picture of it is `shots/si/dayview/mwf-desktop.jpg`: a Monday with three
walks, and you can see which one has the problem before reading a word, because
each walk gets a little bar showing the gap the timetable leaves and the walk
drawn inside it. Two of them sit comfortably inside their ten minutes. The third
runs off the end of its bar.

The one rule this stuck to hardest: **it warns and it never reassures.** That was
already the law for the single-leg card and it is easier to break on a day view,
because it would be so natural to print "12 minutes spare" on every row. It does
not, anywhere, and there is a check that greps the whole screen for that kind of
sentence on every run. What it does print is the gap the timetable itself holds —
which is a real improvement on the old card, because that one had to *assume* a
fifteen-minute passing period, and a schedule actually knows. On a Monday-
Wednesday-Friday day with real ten-minute gaps, that is the difference between
one warning and three.

Three things were found only by opening the pictures and looking at them, none of
which was red in any test: the same twelve-word explanation of why a building is
out of reach was on screen three times in a five-row panel; a 43-metre walk
printed "0–1 min" where the answer bar says "Under 1 min"; and on a laptop the
last class of the day sat permanently one scroll below the fold, which rather
defeats a thing whose whole argument is that you can see the day.

The forcing function was re-checked rather than taken on trust. Eleven UT
building codes still cannot be routed to. Ten of them really are ten to twelve
kilometres north at the Pickle Research Campus, measured off UT's own surveyed
door for each one. **The eleventh, SSW, is not — it is 900 metres from the Tower,
on main campus, with two surveyed doors already sitting in this codebase.** And
all eleven fail in a way nobody had noticed: the app has never heard of the codes
at all, rather than failing to find a path. So SSW is a smaller and different fix
than anyone had written down, and it is upstream of the walking graph. Written
down, not made — that file belongs to another lane.

Nothing about the routing moved: the ruler reads the same 87 metres of wasted
walking it read before, all 38 ends still land at UT's own door, and the "avoid
stairs" tickbox still works under a real mouse click. The change is 1,025 lines
added to `js/wayfind.js` and **not one line removed**, which is deliberate with
four other lanes inside that file. Everything is behind `?walk=1` as before and
`WAYFIND.on` is untouched. Details, the fixtures, and every number:
`docs/si-dayview.md`; the ruler is `scripts/verify/dayview.mjs` (59 checks, all
green).

---

## 2026-08-24 — the day plan takes a real imported schedule, and doing that found two bugs

Branch `acer/si-dayview`, round 4. Round 3 built the panel that lays a whole day
out. This round plugged it into an actual import, and plugging it in is what
turned up the things nobody's own harness could see.

**It reads a parsed schedule now.** `wayfindDayFromSchedule(schedule, {day})`
takes the shape the parser lane publishes — a whole week — and shows one of its
days. Round 3 had written down what a day looks like and left the conversion to
whoever called it, which meant nothing had ever made the trip end to end.
`?walk=1&day=week` is that trip.

**A class the importer could not place used to disappear.** If your calendar had
a 2:00pm class with the room field left blank, the panel quietly deleted it —
and then showed a two-hour gap your day does not have, while the header still
said "3 classes". It looked complete and it was wrong. Every class with a time
is on the day now; the ones with no building say so, in the importer's own
words, and the walks either side say they can't be taken.

**A typo in a building code used to send you to the wrong building.** `MAII 220`
is a real mis-typing of `MAI 220` and it is sitting in the parser lane's own
test file. The panel was handing that code to the search box's forgiving
type-ahead — the thing that lets you type "wel" and get Welch — and drawing a
confident 10-14 minute walk to the UT Tower for a class that is not in it. Every
number on that row was measured correctly. The building was wrong and nothing
was red. A code off a schedule is exact now: a near miss is offered as a
question on the row ("Did you mean MAI (UT Tower)?") and never as a route. That
bug could only be found by running the two lanes together, because every fixture
written on this branch spells its codes correctly.

**Three things it now says at a glance.** A line across the list at the current
time, which is the one thing Google Calendar's day view has that this did not —
everything above the line has happened. The header names the walk that is tight
("WEL to ART is the tight one") instead of only counting them, which matters
most on a phone where the header is all you can see. And the tight row itself
gets a faint warm wash, so scanning the list finds the problem before you read a
word. Plus the day's total on foot on the top line.

**What was checked.** `scripts/verify/dayview.mjs` — 59 checks in round 3, 103
now, all green, and the new ones are the ones that would have caught this
round's bugs. The eleven unroutable codes were re-probed live again and the
figures are unchanged (ten at 10.8-11.8 km north at Pickle; SSW 0.90 km from the
Tower with two UT-surveyed doors, so the brief's second claim is still false).
Separately, the two lanes were merged in a scratch tree and the parser's own
four `.ics` files were driven all the way to this panel — 17 checks, none
failed. That merge is not pushed; what is now known rather than assumed is that
the resolution is a plain concatenation, that it compiles, and that the halves
work together. Full account and every number: `docs/si-dayview.md`.

Still behind `?walk=1`, `WAYFIND.on` untouched, and the whole branch is two pure
inserts into `js/wayfind.js` with zero lines changed or removed anywhere else.
---

## 2026-08-24 — the schedule parser, round 5: fixing the bug the test could not see (`acer/si-parser`)

Short version: a student who uploads the wrong file used to get nine wrong
sentences. Now they get one right one.

The importer's job is to read a schedule and tell you plainly what it could not
use. Last round it did that well for a *calendar* with broken rows. But the
likeliest wrong file a student uploads is not a broken calendar — it is a saved
web page, because the export link bounced them through a UT EID sign-in wall and
they saved that instead. There was already a good sentence written for exactly
that case: *"That is not a calendar file. If you saved it from a page that asked
you to sign in, you probably saved the sign-in page instead of the .ics."* The
problem was that nothing could reach it. Handed a saved sign-in page, the
importer decided it must be typed-out text, read it a line at a time, and
reported nine errors — one per line of HTML — each saying *"Line 3 (...) names a
course but no building."* There is no course on that line. It was nine lies
about a file it had already been taught how to describe.

The uncomfortable part is that the test suite was green over it, and green for a
specific reason: the test told the importer what kind of file it was looking at.
The one fixture that most needed the importer to work that out for itself was
the one fixture it never had to. So the test has been changed to stop helping:
every fixture now goes in with no hint at all, which is how the app will really
use it, and each bad-file case carries a hard ceiling of **one** error message
so "one error per line" cannot come back.

Three things were fixed underneath. The importer now tells three kinds of text
apart instead of two — a calendar, a paste, and a web page — and it catches a
web page both when it starts with the usual markup and when it is only a
fragment copied out of a course site. A pasted line that names no course now
gets the sentence written for that case instead of one written for a different
case. And a paste where *nothing* looks like a class — someone's syllabus, a
page of registration boilerplate — is turned down once with a single sentence
rather than line by line.

That last one introduced a risk worth naming, because it is the same risk the
whole feature is built to avoid: a verdict on a whole file can swallow a good
class. So there is now a fixture that is five lines of junk with one real class
buried in the middle, and it must still import that one class and name the five
junk lines individually. One good row cancels the verdict.

Also re-measured the list of buildings that cannot be routed to, rather than
carrying last round's numbers forward: still exactly eleven, ten of them at the
Pickle Research Campus 10.8–11.8 km north, plus SSW. And corrected something
this lane's own write-up had overstated. It had flatly called the brief's claim
about SSW "false"; checking each source properly, it is half true — SSW really
is missing from our copy of UT's building register (198 rows, no social-work
entry under any name), but UT's own entrances survey does know it, with two
surveyed doors already sitting in this repo. Which matters, because it changes
the fix from "handle a building nobody has a record of" to "copy one row across
from the table next door."

The whole lane is still strictly additive to the shared file: 1,351 lines added
to `js/wayfind.js`, none deleted, which is worth knowing with five lanes writing
into it. 286 assertions pass, up from 209. The Monday walk out of a real parsed
Google calendar — Gates Computer Science to Welch Hall, 140 m, no stairs — was
re-photographed against this code and looked at. Nothing here is switched on:
`WAYFIND.on` is still false and the import bar itself is the interface lane's
half. Server on 8911 stopped and the port confirmed free; the scratch script
written to reproduce the bug was deleted.

One thing worth passing on to the other lanes, because it cost a run here and
will cost someone else one: `scripts/verify/node_modules` in the main checkout
went empty mid-session, and every worktree that borrows it lost its browser
driver at the same moment — the failure reads as `Cannot find package
'playwright-core'`, which looks like your own setup being wrong rather than
someone else's `npm install` in progress. It is shared, mutable, and not
covered by the file-ownership split. If your harness dies that way, it is
probably not you.
## 2026-08-24 — the import screen, round 5: honest names, a screen that fits, and a race that made it lie (`acer/si-ui`)

The round-4 critic said this piece won its blind comparison but that the
screenshots it shipped were fake. It was right, and it was the first thing
fixed. `shots/import/bar-google/` and `shots/import/bar-apple/` held **this
app's own screens** under names like `si-google-add.png` and
`si-apple-result.png` — a reviewer opening `bar-apple/si-apple-add.png` would
read that as a picture of Apple Calendar. The honest admission existed, in a
`NOTE.md` nobody linked, and the file names said otherwise. Names beat notes.
Every frame is `ours-*` now, each folder carries a `README.md` at its top level
saying plainly that no capture of Google's or Apple's real product is in this
repo and why (Google's import screen is behind a signed-in account; Apple
Calendar is macOS/iOS software this harness cannot drive), and the same
statement sits above the pictures in `docs/si-ui.md` instead of two directories
away.

Then three defects, and only one of them was visible in a frame.

**The result screen was hiding most of the count it was quoting.** Round 4's
own committed evidence shows it: nine events in, *6 of 9 classes placed*,
`PLACED 6` — and then one placed row whole, the second cut through its middle
by the edge of the scroller, and four more below the fold with nothing anywhere
on the panel to say they exist. `+ N more` never fired, because six is exactly
`IMP.resultPeek` and nothing had been truncated, and the button underneath said
`Use these 6`. Two fixes: `+ N more` became a real full-width `Show N more`
button at thumb size, and the peek stopped being a fixed number. How many
placed rows fit depends entirely on what is above them — three failures whose
reasons each wrap to two or three lines eat about 210 px of a 373 px body — so
it is measured now: render, count the rows that landed whole, re-render with
the list cut to what fits and a real control under it. `Use these 6` and
`Show 6 more` add up to the 6 the headline claims, and both are on screen.

**Importing too fast said every class was unreachable.** This one was not
visible in any frame and was not being looked for; it fell out of running the
same UT paste twice in a script and getting two different answers. The panel
starts loading the walking graph when it opens, deliberately, so the fetch
overlaps the student reading the instructions — but nothing waited for it.
Paste twelve real UT rows, press Import inside two seconds, and the screen said
*Couldn't place 12 · Nothing here can be routed to* for a schedule with seven
routable classes in it. Five seconds later, the same rows gave *7 of 12 classes
placed*. Same input, same build, two answers, the wrong one delivered as
confidently as the right one, and nothing on screen suggesting waiting. The
import awaits the graph now; the two `window.wayfindImport*` helpers return
promises for the same reason.

**A cut edge looked exactly like a finished edge.** The panel body is the one
child that yields height, so on a phone it is nearly always shorter than its
contents, and it clipped them against a crisp border with no mark of any kind.
Worst on the error screen, which scrolls the body to its end **on purpose** so
the control the message names sits under the message — and the end landed
mid-line, leaving the bottom halves of the letters of "…Subscription Calendar"
under the tab divider looking like a rendering fault. Each end that has content
past it is faded now and an end that has nothing past it keeps its hard edge,
which is what makes the fade mean anything. It is a CSS mask rather than a
gradient overlay because the panel is glass over a live 3D city and there is no
colour this stylesheet can name that would hide the text under an overlay.
Measured rather than eyeballed: in the top 78 px of the scroller, 317 pixels
change to a maximum of 131/255 with the shade on versus off; below the fade
band, in the same strip, 0 pixels change, maximum delta 1/255.

Two of the fixes were themselves wrong first, and both were caught by measuring
instead of reasoning. The fit loop stopped as soon as the rows fitted — and the
`Show 6 more` it had just added landed below the fold, which is the identical
defect this panel had already fixed once when an error message named a file
button the same frame was hiding. And the loop chained one
`requestAnimationFrame` per shrink, which reads perfectly sensibly and measures
badly: a UT paste with five failures was still visibly mid-shrink four seconds
after the result rendered. It is one synchronous loop now, at most seven
layouts of one small panel.

**35 assertions, all passing, on the branch after `origin/main` was merged into
it — not before.** Including the two the existing feature makes:
`wayfindRoute('JES','WEL')` still returns *"5-7 min walk · 450 m · No stairs on
this route"*, the same 450 m round 4 measured; and `?walk=0&from=JES&to=WEL`
still leaves zero of this feature's elements, zero `input[type=file]`, no
`wayfind*` function on `window` and no `wayfind*` map source, measured six
seconds after the map exists. On `?clip=1`, `?autopilot=1` and `?sliderdemo=1`
everything measures zero **with the import screen opened on purpose first** —
"hidden because nobody opened it" is not the claim. `harness-drift.mjs`: 31
scripts in both files, unchanged, because §9 needs no new `<script>` tag.

Seventeen frames committed, 4.4 MB, every one of them cited by `docs/si-ui.md`
and none of them named after somebody else's product. Three scratch drivers
lived in `scripts/verify/_si-ui-*.mjs` and were deleted after the runs; scratch
frames stayed in the scratchpad. Branch `acer/si-ui`, pushed, not merged.
Server on 8913 killed and the port confirmed free.

## 2026-08-24 — critic pass, round 5 on the schedule-import UI (`acer/si-ui`): oursWins = true, and a real gap found at a phone size nobody had tested

Fresh context, own port (8953), own scripts, no memory of how hard this round
was to build. Checked out `origin/acer/si-ui` at `305ca80` and drove the real
`?walk=1` panel with playwright-core and real Chrome — not the builder's own
screenshots, and not `docs/si-ui.md`'s word for any of it.

**Every claim I could re-derive, I re-derived myself, and all of them held.**
The forcing function: pulled the same 12 codes and called `window.wayfindSearch`
myself after the graph loaded — 10 PRC codes plus SSW came back `[]` and HLB
came back `{doors:0}`, matching the branch's sharper claim exactly (this cost
one false start: calling `wayfindSearch` before the graph finishes its own
~3 s background load returns `[]` for everything, including codes that do
resolve once it's warm — an instrument-timing trap worth naming for whoever
tests this file next). `wayfindRoute('JES','WEL')` still returns *450 m / 5-7
min*, unchanged. `?walk=0` still drops every `wf-*` id, every `wayfind*`
function, and every `input[type=file]` — zero of each, checked fresh. Capture
hiding held on `.clip`, `.autopilot` and `.sliderdemo` alike, panel opened on
purpose first, measured as zero bounding-box rather than trusted from
`display:none` alone. The race fix holds under a real reproduction, not just
the builder's word: opened a fresh page, opened the panel, pasted twelve UT
rows and hit Import at both 300 ms and 8 s — identical `7 of 12 classes
placed` both times. The `Show 6 more` control is real, not decorative: 0 rows
visible before the click, 6 after. The real entry point works too — a literal
`page.click('#wf-imp-entry')` on the actual search-sheet row opens the panel,
not just the `window.wayfindImportOpen()` API the doc's own screenshots use.

**The blind comparison was re-run from scratch, not inherited from round 4.**
The panel changed shape this round (the fold fix, the race fix, the shade), so
round 4's verdict doesn't automatically carry over. Fetched the same class of
real bar this branch was honest about never obtaining itself: Google's own
`customguide.com` Import & Export lesson (the real Settings panel, and the
real "Imported 10 out of 10 events." dialog) and `howtogeek.com`'s Apple
Calendar walkthrough (the real "Enter the URL of the calendar" dialog and the
real post-subscribe sidebar). Cropped this branch's own `#wf-imp` panel at four
matching moments, saved all eight images under neutral `pairX-A/B.png` names,
shuffled the ours/bar assignment with `Math.random()` into a JSON file I did
not read, wrote a preference and reasoning for all four pairs from the images
alone, then revealed the mapping. **Preferred ours on all four, and every
preference turned out to be ours**: the Google add screen, because it explains
where the .ics actually comes from and is phone-shaped where Google's own
Settings page is a generic desktop panel; the Google result, because it names
each failure and why where Google's dialog is a bare "10 of 10" count with no
room for a real partial failure to explain itself; the Apple add screen,
because it covers Mac and iPhone and the webcal/https equivalence Apple's own
minimal dialog assumes you already know; the Apple result, because it says
something at all next to a native UI that just checks a calendar in a sidebar
and calls it done.

**oursWins = true.**

**The single biggest remaining gap, concretely, and it is a real one this
round did not find.** The fold/shade fix this round shipped was verified only
at 390×844 and desktop 1280×800. `impFitList()` in `js/wayfind.js` only ever
shrinks the number of visible `.wf-imp-row.ok` (placed) rows to make room —
it never touches the `.wf-imp-row.bad` (failure) rows above them, and its exit
condition (`rows.length <= IMP.minPeek`) gives up the moment zero placed rows
remain, without ever checking whether the `Show N more` button itself ended up
inside the visible body. On an iPhone SE / iPhone 8-class phone (375×667,
common and untested this round) with the branch's own nine-event Google
fixture — the exact fixture used for every screenshot in `docs/si-ui.md` —
this reproduces the precise defect class the round's own writeup says it
fixed: the third failure reason (`RHE 306`, no room) and the entire `PLACED 6`
/ `Show 6 more` control render **100 px below the visible fold**
(`moreTop:481` against `bodyBottom:381`, measured), reachable only by a scroll
nothing on screen asks for except a 16 px CSS fade that is easy to miss at
this size (confirmed present in computed style, `linear-gradient(to top,
transparent 0px, black 16px)`, but visually subtle in an actual frame). Fix:
make `impFitList()` also account for the height the failure rows are
consuming — either by giving the failure list its own scroll allowance
independent of the placed list, or by including `.wf-imp-row.bad` in what the
fit loop is allowed to measure against — and add 375×667 to whatever
viewport set this branch's own verification runs next time; 390×844 alone
missed this.

**What I looked at or measured:** the live page, not the diff — `js/wayfind.js`
and `style.css` were read only to understand `impFitList`/`impShade` after the
375×667 reproduction, never edited. Ten screenshots and one JSON results file
in the scratchpad (not committed — CLAUDE.md rule 12; nothing here is cited by
a doc, so nothing came into the repo). Five real bar images downloaded
directly from `customguide.com` and `howtogeek.com`. Server on 8953 killed by
PID, port reconfirmed free (`netstat` empty). One browser. Nothing the builder
owns (`js/wayfind.js`, `style.css`, `index.html`, `_harness.html`) was edited;
every scratch script (`scripts/verify/_critic-si-ui-*.mjs`, thirteen of them)
was deleted before finishing. This entry is the only change on top of
`305ca80`.

## 2026-08-24 — round 6 on the privacy piece (`acer/si-privacy`): the walk is closed by default now, and the socket stayed silent

Round 5's critic put a class title through a worker and onto a raw TCP socket
with the guard armed, and the guard did not even count it. The line was
`if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return;` — skip, no
flag — defended by a comment saying a buffer "cannot hold a JS string".
`TextEncoder` makes that false in one line.

**Did not patch the third shape.** Rounds 4 and 5 each shut exactly the shape
that had been demonstrated (a `Blob` body, then a `Blob` leaf) and left the next
one open, so this round inverted the default instead. `scanStructured()` now
recognises a closed list of node kinds it can genuinely read — string, array,
plain object, binary, `Map`, `Set`, `RegExp`, `Error`, `Date`, wrappers — and
**flags everything else as unread**. A `Blob`, a `File`, an `ImageData`, an
`ImageBitmap` and every cloneable type the platform grows next all land in that
default without needing a line of their own, because what they have in common is
that a `for...in` walk sees nothing on them. Adding a type to the platform can
make this guard over-refuse; it cannot make it under-refuse.

**Binary is scanned, not skipped and not blocked, because blocking it was never
available.** Measured first: one cold load pushes 4,742 `Uint8Array` leaves and
22.5 MB of real MapLibre tile bytes through `Worker.postMessage`, median leaf
4 KB. So `scanBytesForSchedule()` matches the watched tokens' bytes against the
buffer's bytes, allocating nothing — no decode, no lowercase copy — in UTF-8 and
UTF-16LE, behind a 65,536-entry two-byte prefilter.

**A second silent bypass nobody had reported, found while fixing the first.**
The walk gave up at `maxNodes`, returned `complete: false`, and every caller
dropped it on the floor. 21 of this app's own messages per cold load exceed the
old 4,000-node cap. Twenty-one payloads a load were sailing past uninspected
with nothing recorded. Running out now refuses.

**Two more holes this round found in its own probes rather than a critic's.**
`fetch('/collect?t=' + encodeURIComponent(title))` and a `URLSearchParams` form
body both sailed past an armed guard, because a percent-encoded canary does not
contain the canary — now retried decoded, gated on the string containing a `%`
or `+` so tile URLs pay nothing. And `MessagePort` / `BroadcastChannel` were
never inspected at all, which would have been the round-7 finding; a cold load
makes zero calls to either, so closing them cost nothing measured.

**Proved the way it was broken.** Bare TCP listener, guard's counters read
before and after each probe, own canaries. Armed: the ArrayBuffer transfer
refused, `blocked +1`, 30 bytes scanned, socket received **0 bytes**. Disarmed:
the same probe went through, the worker's own `fetch` returned 204, and the
socket read `Zygomorphic Percussion Seminar` verbatim — which is what makes the
armed result mean anything. Sixteen more shapes in the table, all refused,
including a real 16 KB MapLibre tile buffer that **still crosses untouched**.

**And the map still draws.** Cold load with a schedule already on the device,
guard armed, driven across five pan-and-zoom steps: `blocked: 0`,
`truncatedScans: 0`, `scanThrows: 0`, `inspectFailures: 0`, 19,165 buffers and
**141 MB** of tile bytes read by the guard and passed, `styleLoaded: true`,
`tilesLoaded: true`. Frame committed at `shots/si/privacy/r6-map-guarded.jpg`.

**One correction the first cap needed.** `workerScanNodes` was set to 400,000
from a census taken on a page that loaded and then sat still, and it **blocked
one of MapLibre's own payloads** the moment the camera moved. Re-measured under
a punishing drive: 634,093 nodes in the largest real payload. Cap is 8,000,000
now. The map came back red and that is why the number changed, not because the
reasoning improved.

**What it costs, and this round cannot say "nothing".** Minimum of three
interleaved reps, time inside `Worker.prototype.postMessage` across a cold load:
827 ms with a schedule stored against 261 ms with none — about 570 ms of extra
main-thread work spread over a whole load, ~0.22 ms per message, to read ~20 MB.
Only on a device that has a schedule. Two optimisation theories were measured
and were wrong: widening the prefilter from 256 to 65,536 entries bought 6%, not
the predicted order of magnitude (64 KB does not fit in L1, and bit-packing it
to 8 KB was worse than both); and hoisting the walk out of a per-call closure
made no difference at all (215 ms → 216 ms). Both are written into §8 rather
than quietly dropped.

**Also fixed the fabricated citation §7 has been carrying.** Round 3 sourced
"SSW was demolished" to `docs/schedule-gaps.md`, which was on no branch at the
time. That file is real now — rescued onto `main` on 2026-08-24 (`ed74cc3`) —
and read directly it does argue demolition. But `docs/si-gaps.md` on
`origin/acer/si-gaps` checked that conclusion and it is wrong: our
`data/ut_buildings.json` is a 198-code snapshot, UT files SSW under its own
main-campus path, and UT's two published SSW doors land 0.37 m and 2.45 m from a
footprint this app already draws. SSW is a real current building our register
copy is one row short of; the sibling lane fixed it and took the count 11 → 10.
§7 now says that, with the sources it can actually open.

Branch `acer/si-privacy`, pushed, not merged and no PR. `js/wayfind.js` passes
`node --check`; `harness-drift.mjs` PASS 31/31; the doc's own citation gate
(§11a) ALL PASS, 20 paths resolved. Nothing outside this lane's files was
touched except this log. Every scratch script and every scratch frame stayed in
the scratchpad; one frame is committed because §6 cites it. Server on 8951
killed and the port re-confirmed free.

## 2026-08-24 — round 7 on the privacy piece (`acer/si-privacy`): round 6 fixed half the default, and an array walked the rest of the way out

Round 6 said it had stopped patching shapes and inverted the default. It had
inverted half of it. The walk asked *which node kinds do I recognise* and got
that right; it never asked *what does recognising one mean*. So the array branch
still read `for (let i = 0; i < x.length; i++)` — an index loop, which is not
what a structured clone does to an array — and this went out:

```js
const a = [1, 2, 3];
a.note = classTitle;
worker.postMessage({ a });     // guard armed → blocked: 0, opaque: 0
```

`structuredClone` carries a tacked-on property, the worker decoded it, and its
own `fetch` put the title on a raw TCP socket verbatim. `blocked: 0,
opaqueWorkerLeaves: 0` — **uncounted and unlogged**, the exact reading round 5
got from the ArrayBuffer hole that round 6 existed to close, sitting inside the
one branch round 6's own comment called fully read. Five variants leaked: an
array in an object, a bare top-level array, an `Array` subclass, a sparse array,
and a whole object tree hanging off an array property.

**Fixed by the rule rather than the case.** For every kind the walk claims to
read, it now reads exactly what the clone algorithm reads. For `Array` and for a
plain object that is the same thing — own enumerable properties — so they are
one loop now and an array is no longer the special case that got optimised into
being wrong.

**A second hole, in the half of the guard nobody was looking at.** Round 6 built
a byte scanner that reads UTF-8 *and* UTF-16LE and wired it to one of the two
doors. `fetch(sink, { body: utf16leBufferOfTheTitle })` came back **204** on the
socket with the guard armed, while the same title UTF-8-encoded was refused.
Network bodies now go through the same byte scan, and `inspect()` takes the body
as the caller had it rather than a string the caller already flattened.

**Four doors that were never inspected at all**, each returning `checked: 0`
against an armed round-6 guard: `window.postMessage`,
`iframe.contentWindow.postMessage`, `navigator.serviceWorker.register(url)`,
`RTCDataChannel.send`. The iframe one carries a fact worth keeping — **a
same-origin child iframe is a separate JavaScript realm with its own
intrinsics**, so patching our `Window.prototype` never reaches it and its own
`fetch` reaches the network the way a worker's does. The guard now follows the
reference into any child realm this page holds a handle on.

**Proved the way it was broken.** Bare TCP listener, own canaries, counters read
before and after each probe. Armed: all seventeen shapes refused and the socket
received nothing. Disarmed: every one of them put `Palaeobotanical Ensemble
Studio` on that socket verbatim, which is what makes the armed column mean
anything. `<img src>` still reaches the wire and is still a named residual in §9,
not a surprise.

**And the map still draws.** Guard armed, schedule stored, six pan-and-zoom legs:
`blocked: 0`, `truncatedScans: 0`, `scanThrows: 0`, `inspectFailures: 0`,
**15,351 buffers and 122.5 MB of real tile bytes read and passed**,
`styleLoaded`/`tilesLoaded` true. Frame at `shots/si/privacy/r7-map-guarded.jpg`.

**What it costs — and the two measurements disagree, so both are written down.**
On the real city there is **no result**: three interleaved reps each way, guard
time across an identical drive, 0.250–0.271 ms/message against 0.213–0.273, and
overlapping spreads mean no result. Isolated on a fixed payload it is real: a
600,000-element numeric array is **103.4 ms/message against 13.6**, 7.6×. Both
are true because MapLibre's real payloads are binary and the byte scan of ~120 MB
dwarfs the walk. The obvious speed-up — `Object.keys(x).length !== x.length` as a
"has extras" test — was rejected for being **unsound**, not slow: an array with
both a hole and an extra has the two cancel (`length` 3, keys `['0','1','note']`),
and that shape is now a probe so nobody reintroduces it.

**§7's citation was already right.** Round 6 had fixed the fabricated
`docs/schedule-gaps.md` reference; re-read both sources this round to confirm it.
`docs/schedule-gaps.md` is real on `main` (`ed74cc3`) and does argue demolition;
`docs/si-gaps.md` on `origin/acer/si-gaps` checks that and shows SSW is a current
main-campus building our 198-code register is one row short of, with UT's two
published doors 0.37 m and 2.45 m from a footprint this app already draws. §7
says that, and the doc's own citation gate is ALL PASS at 21 paths.

Branch `acer/si-privacy`, pushed, **not merged and no PR**. `node --check` clean;
`harness-drift.mjs` PASS 31/31; the storage path re-driven end to end after the
`inspect()` rewiring (panel empty → save → real click on Delete → a genuinely
fresh document finds nothing → feature off is still off), 9/9. Nothing outside
this lane's files touched except this log. Every scratch script and frame stayed
in the scratchpad; one frame is committed because the doc cites it. Server on
8951 killed and the port re-confirmed free.

## 2026-08-24 — round 8 on the privacy piece (`acer/si-privacy`): the same bug for the fifth time, so this round fixed the shape of it

Rounds 4, 5, 6 and 7 each found one hole, and read like four different
oversights. They are one: **a check that exists, is correct, and is wired to one
of the two doors.** So round 8 stopped asking what shape is unhandled and asked,
for every capability the guard has, which doors it is wired to. Two answers came
back wrong and both put a class title on a raw TCP socket with the guard armed.

**One. The decode retry was wired to the network door only.** Round 6 found that
a percent-encoded canary does not contain the canary — and fixed it in a
*second* function, called from the URL and body paths. The worker walk kept
calling the raw one, and so did the top-level string branch and the `RegExp`,
`Error` and boxed-`String` branches. `worker.postMessage({ t:
encodeURIComponent(title) })`: **ten shapes crossed at `blocked: 0, opaque: 0`**
— uncounted and unlogged, the identical reading round 5 got from the
ArrayBuffer hole and round 7 got from the array hole — and six of the ten landed
`Thaumaturgical Marimba Rhetoric` on the listener verbatim after the worker
decoded them.

**Two. Request headers had never been inspected by anything, ever.** `inspect()`
is handed a method, a URL and a body, and nobody had ever handed it the headers.
`fetch(sink, { headers: { 'X-Sched': title } })`, the same through a `Headers`
object, and `xhr.setRequestHeader` all came back 204 at `blocked: 0` with the
title on the wire. Not exotic — attaching a context header is what every
analytics library does, which is the exact scenario this guard exists for. Worth
naming what nearly hid it: `fetch(new Request(url, { headers }))` **was**
refused, by round 5's unreadable-body rule on the Request's stream body, having
never looked at a header. A guard can pass a probe for the wrong reason.

**The fix is the shape, not the cases.** There is now exactly ONE function
anybody can call to ask whether a string carries the schedule, and it does the
whole job. The raw test still exists, is not exported, and has precisely one
caller: that function's own retry. Wiring the weak version to a new door is no
longer possible, because the weak version has no name a caller can reach. The
byte scanner cannot decode its haystack — percent-decoding 120 MB of tile bytes
a load is not a thing to do on the tile path — so **the needle carries the
encodings instead**, which costs nothing in the hot loop and almost nothing in
the prefilter. And `inspect()` takes a LIST of header sources, never one,
because `fetch(new Request(u, {headers}), {headers})` has two and picking either
is how this class of bug starts.

Two more doors of the same family closed while the file was open, both strings
that reach the wire and neither ever scanned: a **WebSocket's subprotocols**
(they travel as `Sec-WebSocket-Protocol` in the handshake) and an
**`RTCDataChannel`'s label** (carried in the SDP, so the name alone is a leak
that never calls `send`).

**Proved the way it was broken.** Bare TCP listener, own canaries, the guard's
counters read before and after each probe. Armed: all fourteen shapes and all
six channels refused, and the socket received nothing. Disarmed: every one of
them carried and the socket read the canary back — which is what makes the armed
column mean anything. Round 7's own probe re-run unchanged on round 8's code:
**no shape leaks**, and the only channel still on the wire is `<img src>`, which
is a named residual in §9 rather than a surprise.

**And the map still draws.** Guard armed, schedule stored, six pan-and-zoom
legs: `blocked: 0`, `truncatedScans: 0`, `scanThrows: 0`, `inspectFailures: 0`,
`unreadableHeaders: 0`, **15,413 buffers and 120.1 MB of real tile bytes read and
passed**, `styleLoaded`/`tilesLoaded` true. Frame at
`shots/si/privacy/r8-map-guarded.jpg`.

**What it costs, and the A/B is a true one this round.** `--baseline` serves the
round-7 `js/wayfind.js` to the page and changes nothing on disk, so the only
difference is the round-8 diff — and the R7 rows self-check, because they carry
no `headersScanned` field at all. On the real city there is **no result**: three
interleaved, counterbalanced reps each way, 0.261–0.332 ms/message against
0.244–0.298, and overlapping spreads mean no result. Isolated it is real:
20,000 string leaves cost **1.30×** when the new gate never fires and 2.63× when
it fires on every one — and 1.30× is the row this app pays, because MapLibre's
payloads are binary and a byte scan of 120 MB does not notice 0.3 µs a leaf.

**One prediction in the doc was wrong and the correction is written next to
it.** The header change was written up as costing nil, because this app sets one
header on one request in its whole source. True of the source, false of the
traffic: measured, the guard reads headers on **248–411 requests per drive**,
because MapLibre passes a headers object on essentially every tile fetch.
Nothing is broken by it, but the claim had been read off the code instead of
run.

**§7's citation is still correct** — round 6 replaced the fabricated
`docs/schedule-gaps.md` reference and round 7 re-checked it; re-read both
sources again this round. `docs/schedule-gaps.md` is real on `main` (`ed74cc3`)
and does argue demolition; `docs/si-gaps.md` on `origin/acer/si-gaps` checks it
and shows SSW is a current main-campus building our 198-code register is one row
short of. The doc's own citation gate is ALL PASS at 22 paths.

**A landmine for whoever integrates these five branches.** `js/wayfind.js` is
committed with LF endings and `core.autocrlf` is true on this machine, so an
editor that writes CRLF turns a 230-line change into a **19,932-line whole-file
diff** that `git status` will not warn about until you touch the file. It read
as a full rewrite here until the file was converted back to LF, at which point
the same edits diffed as 230 insertions and 34 deletions. Check
`git diff --stat` before committing this file, and if it is four figures, that
is why — not your edit.

Branch `acer/si-privacy`, pushed, **not merged and no PR**. `node --check`
clean; `harness-drift.mjs` PASS 31/31; the storage path re-driven end to end
after the `inspect()` rewiring (panel empty → save → real click on Delete → a
genuinely fresh document finds nothing → feature off is still off), 9/9. Nothing
outside this lane's files touched except this log. Every scratch script and
frame stayed in the scratchpad; one frame is committed because the doc cites it.
Server on 8951 killed and the port re-confirmed free.


## 2026-08-25 — all five schedule-import lanes merged and driven end to end (`acer/si-combined`, pushed, NO PR)

The five pieces merge cleanly and the feature does not work. That sentence is
the whole result, and both halves of it are measured.

**The merge is clean.** `si-gaps` → `si-dayview` → `si-parser` → `si-ui` →
`si-privacy` onto a fresh branch off `origin/main`. Four of the five append a
whole new section to `js/wayfind.js` at the same anchor, so every conflict was
"two complete sections, one insertion point" and every one was resolved by
keeping both in merge order. Checked rather than claimed: of the 307 / 1546 /
1351 / 1243 / 1834 lines the five branches add to that file, exactly **one** is
not in the merged result, and it is one this pass deliberately changed. No two
lanes declare the same name in the shared scope — no top-level collisions, no
`window.*` collisions, none with `main` either.

**The CRLF landmine is real and now root-caused.** It fired on the privacy
merge: a 1,834-line change presenting as 14,519 insertions / 12,685 deletions.
The cause is not `core.autocrlf` by itself — it is a **raw 0x00 byte** sitting
in a string literal in the privacy section's dedup key. Git calls any file
containing a NUL binary, and binary files are exempt from autocrlf
normalisation, so for that one file the round trip silently stopped happening.
It is also why `grep` answers "Binary file js/wayfind.js matches". Replacing the
raw byte with its six-character escape (identical string value, checked in node)
made the file text again and the diff went to a clean 1,834 insertions, 0
deletions. That is the only line of anyone's code this pass altered.

**What the merged tree actually does, driven through the real UI on a phone.**
A real UT Registration Plus .ics, six classes, four on Tuesday, one of them at
`MER 1.906` on the Pickle campus. The import screen reads it, places 5 of 6, and
names the sixth: *"Microelectronics & Engineering Research — Pickle Research
Campus, about 11 km north of here, outside the city this app models."* That is
`si-gaps`'s fact in `si-ui`'s sentence across a branch boundary with no
coordination, and it is the best thing in the round. The day view, given a
schedule in the shape it accepts, lays out the whole Tuesday in order with the
next leg marked, and clicking a leg draws the ribbon and prints the answer bar
the single-leg feature already shipped — same numbers as the row it came from.
Nothing leaves the device: every request made while the schedule was on screen,
captured at context level and on a raw socket, and scanned for seventeen strings
out of the fixture, came back clean — after the instrument was shown catching
the same strings fired through `fetch`, `sendBeacon` and a real `Worker` with the
guard disarmed.

**And then the seams.** Four lanes each wrote a hook for a lane that did not
exist yet, and when the real one arrived it had a different shape:

* the import screen calls `wayfindParseSchedule` and keeps the answer only if
  `Array.isArray(r)` — the parser ships it `async` returning an object, so the
  test never passes and **every import in this tree is read by the fallback
  decoder si-ui wrote for the case where the parser had not landed**. On the
  parser's own `manual-paste.txt` that is 2 classes placed instead of 5;
* the day view reads `schedule.events`, the import publishes `schedule.classes`
  — so `wayfindDayFromSchedule(window.wayfindSchedule)` returns `why: 'empty'`,
  and the day-plan button, whose label says *"Import my class schedule"*, shows a
  **hard-coded demo of four classes that are not yours**;
* **nothing calls `WAYFIND.store.save()`.** After a successful import
  `localStorage` holds only the graphics key. A reload loses the schedule,
  *Delete my schedule* has nothing to delete, and the egress guard — which arms
  its watchlist off the *stored* schedule — is on its fast path with
  `watched=0` during the one event it was built for;
* si-ui carries its own hard-coded unreachable list that still says SSW has no
  door, which is the exact building `si-gaps` spent round 3 fixing. The search
  box takes you there; the import screen says it cannot;
* `dayPlace()` tests `entry.routable` before `entry.offMap`, and `si-gaps` put
  the Pickle codes into `search()`, so the day view now gives a Pickle building
  the *wrong* excuse — "nothing is mapped to walk to" instead of "11 km north";
* and both lanes appended their own way in to the same sheet, so it now offers
  two buttons that say almost the same sentence, with 157 px past the fold on a
  390x844 phone taking the privacy line, the Delete button and the OSM credit
  with them. Measured in the page: 494 px of content in a 337 px sheet with
  `overflow-y: hidden`; without this round's three additions the same content is
  279 px and fits.

None of that is a lane doing bad work, and no attempt was made to fix it here —
wiring five separately-judged pieces together with unreviewed integration code
would be the one thing this process exists to avoid. `docs/si-integration.md`
has each defect with its line number, its measurement and the change it needs,
so the wiring can be built as its own piece and put through the same bar.

**The gate, on the merged tree.** `harness-drift.mjs` PASS 31/31.
`walkmeter.mjs` PASS with every number reproducing the record — 87.0 m route
extra, 90.6 m door extra, 38/38 ends at the right door, 0.00 m self-check drift
on all twenty pairs, live UI gate pass. "UT buildings this build cannot route to
at all" goes **11 to 10** against `origin/main`'s recorded eleven; the ten that
remain are all at Pickle. `wayfindRoute('WEL','PAI')` still returns 291 m on a
page nobody imported on. `?clip=1`, `?autopilot=1&preset=cinematic` and
`?sliderdemo=1&preset=cinematic` at 390x844 with touch show no walk UI, no
day-plan button, no import row and no privacy footer, with zero console errors,
and all three are photographed. The plain page carries none of the feature in the
DOM at all and the OSM attribution is visible. `WAYFIND.on` untouched.

39 gates pass, 11 fail, and every failure is a seam between two lanes rather
than anything inside one. Branch `acer/si-combined` pushed. **No PR and not
merged to main** — that is the next stage's call, and on this evidence the
answer to "is it safe to ship" is no, not yet. New in this branch:
`scripts/verify/si-integration.mjs`,
`scripts/verify/schedule-fixtures/integration-tuesday.ics`,
`docs/si-integration.md`, and eleven frames the doc cites. One browser, killed on
exit; server on 8971 stopped and the port re-confirmed free.
