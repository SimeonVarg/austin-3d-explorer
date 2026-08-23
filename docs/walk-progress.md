# Walk feature — progress log

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
