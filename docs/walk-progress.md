# Walk feature — progress log

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
