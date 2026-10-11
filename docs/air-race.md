# Air Race: the spec (frozen before code, 2026-10-10)

A separate page, `air.html`, on the same repo, so it draws the same city and gets every map update with no sync step.
The main page (`index.html`) loads nothing new and behaves the same. The game lives in the air because that is where
the model is strong (40,000 houses, 196,000 trees, downtown heights within 0.4 m) and weak up close (walls). Nothing
in it depends on a street-level wall.

## The feel, in three sentences

You are a small glider craft, always moving, and the whole game is a line through the real skyline: dive to gain
speed, bank hard, thread a ring between two towers. It should feel like a wingsuit with a drone's obedience: no
stalling, no crashing out, a soft push away from roofs and ground. Frame rate is the game, so the picture is
simplified to what reads at 60 to 100 m/s.

## Controls

| | Keyboard | Mouse | Touch |
|---|---|---|---|
| Bank (turn) | A / D or left / right | hold the button and drag sideways from where you pressed | drag anywhere (virtual stick) |
| Pitch | W dive, S climb (up / down arrows the same) | drag up / down (up = dive; I toggles it) | drag up / down |
| Boost | Shift or Space (hold) | right button | BOOST button |
| Brake | C or Ctrl (hold) | middle button | BRAKE button |
| Restart | R | R | RESTART button |
| Day / night | N | N | N button |

## The flight model (numbers: the `AIR` object, `js/air/params.js`; metres, seconds, degrees)

One scalar speed along the nose. Speed chases a target (cruise 62, boost 98, brake 34 m/s) with a time constant; a
dive adds `G` (12 m/s^2) times sin(pitch) to speed, a climb takes it away, and speed above the target bleeds off with
a 3.5 s time constant (so a dive is a gift you spend). Top speed 135, bottom 24 (no stall). Bank follows the stick to
62 degrees; yaw rate is 38 deg/s times sin(bank), softened at speed. Pitch rate 55 deg/s, +45 / -60 degrees limits,
and it self-levels with no input. The floor: ground plus 22 m and roofs plus 14 m (probed 1.4 s ahead with a 14 m
radius) as a soft spring and a sideways push, never a crash. Fixed step 120 Hz, so the same inputs give the same
flight on every machine. Chase camera 24 m back and 7 m up, 0.12 s position lag, bank follows 40%, field of view
58 to 70 degrees with speed.

## The course ("Skyline", `data/air/courses.json`)

23 rings, built by `scripts/air/place-gates.mjs` from the real data (footprints and heights of the campus snapshot,
the Tower, West Campus, the downtown outer ring, the Capitol and the stadium). Start high over the UT Tower, down the
Drag, between two West Campus towers (Dobie and Ion), across to downtown, a slalom through three real gaps (Indeed and One
American, 415 Colorado and Frost, Austonian and JW Marriott), around the Capitol dome, finish through a gate over
Darrell K Royal Stadium. 6.3 km, about 80 s for a clean run. Every gate: ring radius 16 to 30 m, centre in clear
air at least 12 m (`AIR.gates.margin`) from every building, reachable from the previous gate by the real flight
model (the autopilot flies the whole course in the test).

## Scoring and timing

3-2-1 countdown, then a running clock. Each gate shows a split against your best (or the ghost). A gate crossed
outside its ring, or skipped, adds `AIR.penaltyS` = 3.0 s and turns red. Finish card: time, penalties, splits, a
"copy link" button. Best time is kept in this browser only.

## The share link (no server)

The run is sampled at 5 Hz as local east / north / up, predicted from the two samples before, the miss stored in 1 m
steps as 4-bit nibbles, then base64url. Orientation is rebuilt from the path. Stored: course id, sample rate, time,
penalties. The link is `air.html#g=...`; opening it shows the sender's ghost craft and their time to beat. A 90 s
run is about 1,000 characters (limit 2,000). Round trip error is stated and tested (`scripts/verify/air-ghost.mjs`).

## Frame budget per tier (measured numbers go in the pull request, not here)

| Tier | Target | How |
|---|---|---|
| Discrete GPU desktop | 60 fps | the "air" budget below |
| Integrated / old laptop | 30 fps | air budget + render scale 0.75 |
| Phone | "it runs" | the existing LITE phone tier, air budget on top |

The air budget drops what cannot be read at speed: name labels, signs, street props, campus planting detail,
sculpture, entrances, the live-here and walk layers, finder, shop interiors, wall surface grain; and keeps what the
air shows: building shapes and heights, roofs, trees, ground colour, sky, sun. Everything is a switch in
`js/air/budget.js`, off by default for the main page because the main page never loads it.

## Not in the slice

Multiplayer, accounts, a leaderboard server, more than one course, collisions that end the run, a course editor,
phone polish beyond "it runs", sound (unless it costs under an hour: synthesised only), a graphics menu.
