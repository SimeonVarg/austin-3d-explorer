# MAC LANE — DKR, and only DKR

Rewritten 2026-08-03 evening. The trees lane is closed (PRs #90–92, all merged).
This lane now has **one job**, and it is the one Simeon has asked for more times
than anything else in this project.

## Scope — narrow on purpose

| you own, completely | nothing else writes these |
|---|---|
| `scripts/bake_stadium.py` | |
| `js/stadium.js` | |
| `data/stadium.geojson` | |
| `data/dkr_aerial.png`, `dkr_aerial_geo.json` | reference imagery, already here |

**You may READ anything. You may WRITE only the above.** The Acer lane is working
`js/facades.js`, `js/ground.js`, `js/outer.js`, `js/controls.js`, `js/tower.js`,
`bake_ground.py`, `bake_art.py`, `bake_depth.py`, `bake_roofs.py` and
`bake_props.py` simultaneously. Touching those loses work.

If the fix needs something outside your files — a change to the facade atlas, a
new ground surface — **write the request into `HANDOFF.md` and work around it**,
do not reach across.

**You merge your own PRs.** Branch `mac/*`, verify, `gh pr merge --merge
--delete-branch`. **Never merge red.**

---

## The brief, in his words

> *"can we please redo DKR? make it look like the actual thing. this is now my
> 100th time asking. ill name a few of thousands of problems with it - its wayy
> to tall pretty sure alot of the top perimeter is supposed to be lights but its
> rendering as wall. DO NOT JUST FIX THESE CUZ IM TELLING YOU THEM. right now the
> seating is 0/10 similarity to how it actually is. there are cool entrances on
> the southwest and northwest sides. right now it looks like the colloseum not a
> football stadium. make the lights accurate and make them work at night - now
> the seats become bright yellow and everything else is dull - what? the lights
> are supposed to illuminate everything - if you cant find out by just data alone
> then do research on football stadium mechanics and combine that with real data.
> but anyway the west side has like two really big sections of seating, the north
> and east side also have a second layer but theyre wrapped and smaller and
> connected, and then of course the south side is mainly the screen. theres also
> the longhorn shaped thing at the south side bottom, various seats are colored
> burnt orange vs normal. Like ur current "seats" look like cutouts from a big
> pyramid. anyway embarrased it took so many millions of tokens wasted building
> it for me to look at it online for 1 minute and tell you these things"*

**Read "DO NOT JUST FIX THESE CUZ IM TELLING YOU THEM" as the actual
instruction.** He is saying: he listed a handful of the problems he happened to
notice in one minute, and he expects the pass to find the rest. A pass that
closes exactly these nine bullets and stops has missed the point.

**And read the last sentence as the method.** He found these by looking at
photographs of the stadium for one minute. **Do that first, before touching any
code.** `data/dkr_aerial.png` and `dkr_aerial_geo.json` are already in the repo —
a georeferenced aerial. Start there, get ground-level photographs too, and build
a written spec of the real building before you model anything. The
`VISUAL_REFERENCE_PLAYBOOK` rules apply in full.

---

## M1. The spec, written down, before any geometry

Produce a short written description of the real Darrell K Royal–Texas Memorial
Stadium and put it in the PR: overall dimensions, the height of each deck, what
is on each of the four sides, where the entrances are, where the lights are.
Check every number against the aerial you already have.

**Start with height.** He says it is *way* too tall and that is the easiest thing
to be objectively wrong about. A stadium is a wide, low object; the current model
reads as a tall drum, which is most of why it looks like the Colosseum.

## M2. The bowl, side by side

From his description, confirmed against reference:

- **West** — the main grandstand. **Two really big decks**, and the tall
  press/suite structure above them. This is the tallest side by a lot.
- **North and east** — a **second layer that wraps and connects**, smaller than
  the west decks.
- **South** — **mainly the videoboard**, one of the largest in college football,
  plus the **Longhorn-shaped feature low down at the south end**.
- **Seat colour is not uniform** — some sections are burnt orange and some are
  not. Find out which.

The current geometry is concentric rings at rising heights, which is why it reads
as "cutouts from a big pyramid". **A real bowl is four different sides.** Model
them as four different sides.

## M3. The entrances

**Southwest and northwest**, and he calls them "cool" — they are distinctive
structures, not doorways. Get them.

## M4. Lighting that works like stadium lighting

The current model makes the SEATS emissive — they glow bright yellow at night —
while everything they should illuminate stays dull. That is backwards, and
HANDOFF §27's defence of it as "the LED upgrade" has now been rejected twice.

Real floodlights sit on the **rim, pointing inward and down**:

- the **field** is the brightest surface in the frame
- the **lower bowl** is lit, falling off with height
- the **structure** is edge-lit where the fixtures are
- the **outside** of the stadium is comparatively dark

So: the top of the perimeter becomes **light fixtures** (he specifically says it
is currently rendering as wall), the field takes the light, and the seats stop
being the light source. If the renderer cannot express real illumination —
MapLibre has one global light — then fake it with authored colour values that
follow that falloff, and **say plainly in the PR that it is authored rather than
lit**.

Photograph it at night from outside AND from above, and put both in the PR.

## M5. Check your own work against the picture

Before opening the PR, put a render and a reference photograph side by side from
the same angle. If you would not recognise your render as this stadium, it is not
done. That test is the whole of this item.

---

## The traps

1. **`python -m http.server` cannot test this site.** Use
   `python scripts/serve.py 8124` (8124, not 8123 — the Acer is on 8123).
2. **A missing layer makes every metric look BETTER.** Verify with a picture.
3. **`node scripts/verify/harness-drift.mjs` before any pixel measurement.**
4. **`git pull` before you screenshot** — a stale working copy produced a
   "finished result" tour of the old city on 2026-08-03. Check
   `git rev-list --left-right --count HEAD...origin/main` reads `0 0`.
5. **`build-tiles.yml` fails after 00:00 UTC** until that day's snapshot is
   baked — see HANDOFF §39. Stadium is not tiled, so this should not touch you.
6. **ONE browser at a time.** Eight parallel agents froze this laptop for three
   hours on 2026-08-03.

Useful: `scripts/verify/dkrdiag.mjs` and `fieldprobe.mjs` already exist.
`scripts/verify/pose.mjs` photographs any pose from the command line.

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `node scripts/verify/reap.mjs`
   and kill your server before finishing every pass.
4. **Record every pass in `HANDOFF.md`** with the branch name, including what you
   tried that did NOT work.
