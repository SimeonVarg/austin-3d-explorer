# Austin 3D Explorer — 7 parallel hero-building agent prompts
**Written 2026-07-30, from the Union on 24th build.** Each block below is standalone —
copy ONE block per agent. They are designed to run simultaneously without colliding.

---

## WHY THESE BUILDINGS

The flyover is going on AWS Kiro socials, so the picks are ranked by **how much a
stranger scrolling past recognises them** and **how much visual payoff they give from
the air**, with campus weighted heavily as you asked.

**Individual (4)** — each is either the single most recognisable thing in frame, or big
and complex enough that splitting attention would ruin it:

| # | Building | Why it earns a solo agent |
|---|---|---|
| 1 | **UT Tower + Main Building** | THE icon. If one building carries the video, it's this. Burnt-orange night lighting is a free money shot. Also genuinely hard: tower + wings + observation deck + clock faces + tile roofs. |
| 2 | **DKR Memorial Stadium** | The biggest mass on campus (100k seats). Bowl geometry, the north end tower and the video board read from any altitude — and nothing else gives that sense of scale. |
| 3 | **Moody Center** | The "modern Austin" beat. 2022 arena with a distinctive curved/faceted skin — a strong contrast cut against the limestone campus. |
| 4 | **LBJ Presidential Library** | A pure travertine modernist box on its own plaza. Deceptively simple, which means proportion errors are brutally visible — exactly the kind of thing that needs one agent's full attention. |

**Groups of 3–4 (2)** — buildings that share a site and a material language, so one agent
builds the vocabulary once and applies it:

| # | Group | Why grouped |
|---|---|---|
| 5 | **Arts corridor:** Blanton Museum, Ellsworth Kelly *Austin*, Harry Ransom Center, Bass Concert Hall | One contiguous precinct, shared limestone/white palette. Kelly's *Austin* — white stone, coloured glass — is the single most shareable object on campus. |
| 6 | **The Drag core:** PCL, Gregory Gym, Texas Union, University Co-op | The student heart of campus, all within a block of Guadalupe. Shared 1920s–70s campus vocabulary plus PCL's brutalism as the contrast note. |

**Group of 6–7 (1)** — one typology, one agent, huge skyline payoff:

| # | Group | Why grouped |
|---|---|---|
| 7 | **West Campus tower cluster:** Dobie Twenty21, The Castilian, Skyloft, Moontower, 21 Rio, Inspire on 22nd, Rise | All student high-rises of the same generation and construction logic. Deriving one facade system well transfers to all seven, and together they give the flyover its vertical drama. These are Union on 24th's neighbours — Union is already done and becomes the quality bar. |

**Deliberately not assigned:** the Texas Capitol (already has dedicated
`capitol.js` / `capitol_parts.geojson` / overrides — leave it alone), Union on 24th
(done, pending merge), and the food landmarks (charming but too small to read in a
flyover — a later pass).

---

## HOW THE 7 STAY OUT OF EACH OTHER'S WAY

Every prompt enforces the same isolation contract. **No agent edits a shared file.**

| Resource | Rule |
|---|---|
| Git | Each works in its OWN worktree/branch `hero/<slug>`. Never commit to `main`. |
| Code | Each authors ONLY `js/heroes/<slug>.js` — a new file nobody else touches. |
| Data | Each authors ONLY `data/heroes/<slug>.json`. **Never** edit `data/hero_designs.json`, `scripts/hero_overrides.json`, `js/app.js`, `index.html`. |
| Docs | Each authors ONLY `docs/heroes/<slug>_AUDIT.md`. |
| Renders | Each writes ONLY to `renders/heroes/<slug>/`. |
| Ports | Assigned per agent below — workbench and save-server ports never overlap. |
| Wiring | Each ends by writing a **registration snippet** into its audit doc for Simeon to paste in later. Agents do NOT wire themselves into the app. |

---

# ⬇️ COPY ONE BLOCK PER AGENT ⬇️

---

## AGENT 1 — UT TOWER + MAIN BUILDING

```
You are building a photoreal 1:1 replica of the UNIVERSITY OF TEXAS TOWER and MAIN
BUILDING (110 Inner Campus Drive, Austin TX, 30.2862 N, -97.7394 W) for the Austin 3D
Explorer flyover. Paul Cret, 1937. 307 ft / 27 floors, Indiana limestone over a
cruciform Main Building, four clock faces, an observation deck, a copper-green lantern
crown, and a red tile roof on the Main Building wings. It is lit BURNT ORANGE for wins
and commencement — model that as a night state.

THIS IS THE MOST RECOGNISABLE BUILDING IN THE PROJECT. It will be in the first ten
seconds of a video on AWS Kiro's socials. Proportion errors will be obvious to anyone
who has been to Austin.

== YOUR SANDBOX — DO NOT LEAVE IT ==
Repo: C:\Users\simip\Projects\austin-3d-explorer
Work in a git worktree on branch  hero/ut-tower . NEVER commit to main.
You may CREATE and EDIT ONLY:
  js/heroes/ut-tower.js          (the generator; a standalone ES module)
  data/heroes/ut-tower.json      (your sampled palette + measured parameters)
  docs/heroes/ut-tower_AUDIT.md  (your derivation, evidence and failure ledger)
  renders/heroes/ut-tower/       (your verification renders)
You may READ anything. You may NOT edit js/app.js, index.html,
data/hero_designs.json, scripts/hero_overrides.json, or any file another agent owns.
Six other agents are running right now on other buildings. Touching a shared file
will break them.
Ports: workbench 3021, save-server 3031. Use no other ports.

== THE METHOD THAT PRODUCED THE QUALITY BAR (follow it exactly) ==
The reference build is Union on 24th in C:\Users\simip\Projects\utx-diorama — read
docs/UNION24_AUDIT.md, docs/U24_ROOFTOP_SPEC.md, docs/VISUAL_REFERENCE_PLAYBOOK.md and
PROJECT_OVERVIEW.md (§ STANDING RULES) BEFORE you write any code. They are the distilled
cost of getting one building right.

1. DERIVE THE INVARIANT RULE, NEVER A LIST OF INSTANCES. Find the module, the grid, the
   repeating cell, and the per-instance transform. Then verify the rule REPRODUCES every
   example you can see before you draw anything. A wrong cell means a wrong RULE — fix
   the rule, never patch the cell.
2. MEASURE, NEVER GUESS. Sample exact hex off real pixels. Take ratios INSIDE ONE PLANE
   OF ONE IMAGE — they are immune to lens and distance. Report file + pixel coords +
   numbers in your audit doc for every number you commit to.
   *** NEVER derive a module from an assumed dimension. On Union we divided an ASSUMED
   57 m by a known column count and stretched every cell 9% for weeks. ***
3. ADVERSARIALLY REFUTE BEFORE YOU BUILD. Once you have a candidate rule, actively try to
   break it from different images than you derived it from. On Union, three refuters
   killed a confident facade spec that would have painted ~300 phantom windows. A
   confident derivation that has not been attacked is not evidence.
4. BUILD THE RENDER→SAMPLE→ASSERT LOOP AS CODING STEP ONE. Render headless, read pixels,
   assert. Proof is a fresh render judged head-on, never a green build, never "the edit
   applied so it must be right".
5. DO NOT INVENT DETAIL NO SOURCE SUPPORTS. If you cannot find evidence, say so out loud
   in the audit doc and leave a labelled placeholder. Never quietly make something up.

== GETTING REFERENCE IMAGERY — PRE-AUTHORISED, JUST DO IT ==
Never ask permission to go get better information. Legitimate and expected: web search,
bulk image download, downloading video tours and extracting frames (yt-dlp is installed;
ffmpeg is on PATH: ffmpeg -i clip.mp4 -vf fps=1 out_%04d.png), enumerating a CDN or
gallery JSON feed, chasing a photographer credit for the full published shoot.

*** GOOGLE STREET VIEW STATIC IS YOUR BEST TOOL AND MOST AGENTS MISS IT. ***
A working GOOGLE_MAPS_API_KEY is in C:\Users\simip\Projects\utx-diorama\.env .
Read it inside your script. NEVER print it, log it, or commit it.
  - Probe first (free): /streetview/metadata?location=LAT,LNG&key=... returns status +
    DATE. Only trust panoramas newer than the building's completion.
  - THE TECHNIQUE THAT WORKS: stand ON the building's own frontage and LOOK UP.
    heading = perpendicular INTO the facade, pitch 45/60/75, fov 90, sweep heading ±25°.
    Nothing can obstruct you at the frontage.
  - A stand-off ring at 100-200 m MOSTLY FAILS in dense fabric — trees and neighbours
    block it. We built one on Union and threw most of it away. Use stand-off only where
    you have a genuinely open sightline (a plaza, a field, a wide street axis).
  For UT Tower specifically you also have the South Mall and the Main Mall as long open
  sightlines — those are the rare case where stand-off works beautifully. Use them.

== THE FAILURE LEDGER — these cost real days on Union, do not re-buy them ==
- BUILDING MISIDENTIFICATION IS THE #1 KILLER. It happened FOUR times on Union: a
  neighbour's tower was measured as the subject; a photo filenamed "south elevation" was
  the NORTH elevation. CONFIRM IDENTITY BEFORE MEASURING ANYTHING, using a signed
  feature, a known neighbour, or a compass-anchored north-up aerial. Never trust a
  filename.
- DUPLICATE FILES INFLATE CONFIDENCE. Several "independent" references turned out to be
  the same photograph under different names. Hash your images; two agreeing views that
  are one file is one view.
- GOLDEN-HOUR LIGHT IS NOT MATERIAL COLOUR. A warm taupe podium turned out to be neutral
  #2c2d33 in daylight. Separate lit from shaded samples and state your albedo estimate.
- CLIPPED PIXELS BREAK COLOUR RATIOS. A "reference white" with a 255 channel forced a
  ratio to 1.0 and produced a wrong palette. Check for saturation before anchoring.
- PERSPECTIVE CAN FAKE A PATTERN CHANGE. Apparent window size scales as 1/distance when
  you look up a shaft. Test that explicitly before claiming a facade varies with height.
- "CORRECT BY CONSTRUCTION" IS A TRAP. A mirrored facade looked flawless and was
  backwards. Verify every "free" symmetric variant head-on.
- COUNT THINGS. The owner counts every window. Get counts right.

== VERIFICATION HARNESS ==
Model the Union workbench: a three.js page that builds your generator, plus wb.shot(name,w,h)
which renders SYNCHRONOUSLY and POSTs a PNG to a tiny save-server so you can Read it back.
Copy the pattern from utx-diorama/workbench/ (main.js + save_server.py). Run your workbench
on 3021 and your save-server on 3031. Browser-pane screenshots time out — always verify
via wb.shot + Read, and pixel-sample the render to check colours and counts.
GOTCHA: if your page loads with no console error but `wb` is undefined, that is a THROW
inside your build function, not a syntax error. Re-import the module inside a try/catch in
the page to surface it.

== DEFINITION OF DONE ==
1. docs/heroes/ut-tower_AUDIT.md contains: the derived rule; every measured parameter with
   its evidence (file + coords + number); sampled hex for every material with lit/shaded
   separation; what you REFUTED and how; an explicit list of anything still unverified or
   placeholder; and a short failure ledger of what fooled you.
2. data/heroes/ut-tower.json holds the palette + parameters as data, so a correction is a
   value change, not surgery.
3. js/heroes/ut-tower.js is parametric — counts and modules are named constants derived
   from measurements, never magic numbers.
4. At least 6 verification renders in renders/heroes/ut-tower/: each elevation head-on,
   one aerial, one night state with the burnt-orange lighting, plus a side-by-side against
   your best reference photo.
5. A REGISTRATION SNIPPET at the end of the audit doc showing exactly what Simeon should
   paste into js/app.js to wire you in. DO NOT wire yourself in.
6. Commit to hero/ut-tower with a message that explains what you corrected and why.

Report honestly. If something is still wrong or unverified, say so plainly — that is worth
far more than a claim of completeness.
```

---

## AGENT 2 — DKR MEMORIAL STADIUM

```
You are building a photoreal 1:1 replica of DARRELL K ROYAL–TEXAS MEMORIAL STADIUM
(405 E 23rd St, Austin TX, 30.2837 N, -97.7325 W) for the Austin 3D Explorer flyover.
~100,000 seats, opened 1924 and repeatedly expanded — the north end zone tower, the
south end zone deck, the massive Godzillatron video board, the ribbon boards, the
press/suite towers on the west, and the brick-and-limestone exterior arcades.

THIS IS THE BIGGEST MASS ON CAMPUS. In a flyover nothing else conveys scale like it.
The bowl geometry, the seating rake and the video board are what sell it.

== YOUR SANDBOX — DO NOT LEAVE IT ==
Repo: C:\Users\simip\Projects\austin-3d-explorer
Work in a git worktree on branch  hero/dkr-stadium . NEVER commit to main.
You may CREATE and EDIT ONLY:
  js/heroes/dkr-stadium.js
  data/heroes/dkr-stadium.json
  docs/heroes/dkr-stadium_AUDIT.md
  renders/heroes/dkr-stadium/
NOTE: data/stadium.geojson already exists in this repo — READ it as a starting footprint
but do NOT edit it. You may NOT edit js/app.js, index.html, data/hero_designs.json,
scripts/hero_overrides.json, or any file another agent owns. Six other agents are running
right now. Touching a shared file will break them.
Ports: workbench 3022, save-server 3032.

== THE METHOD THAT PRODUCED THE QUALITY BAR (follow it exactly) ==
The reference build is Union on 24th in C:\Users\simip\Projects\utx-diorama — read
docs/UNION24_AUDIT.md, docs/VISUAL_REFERENCE_PLAYBOOK.md and PROJECT_OVERVIEW.md
(§ STANDING RULES) BEFORE writing code.

1. DERIVE THE INVARIANT RULE, NEVER A LIST OF INSTANCES. For a stadium the invariants are
   the bowl section (rake angle, riser/tread, vomitory spacing), the structural bay, and
   the arcade module. Get the SECTION right and sweep it; do not hand-place seats.
2. MEASURE, NEVER GUESS. Ratios inside one plane of one image are immune to lens and
   distance. Report file + pixel coords + numbers for everything.
   *** NEVER derive a module from an assumed dimension — that error stretched every cell
   of Union's facade 9% for weeks. *** A football field is 120 yd x 53.3 yd INCLUDING end
   zones — that is your free, exact, in-frame scale bar in every aerial. Use it.
3. ADVERSARIALLY REFUTE BEFORE YOU BUILD. Try to break your own rule from different
   images than you derived it from. Three refuters killed a confident facade spec on Union
   that would have painted ~300 phantom windows.
4. BUILD THE RENDER→SAMPLE→ASSERT LOOP AS CODING STEP ONE.
5. DO NOT INVENT DETAIL NO SOURCE SUPPORTS. Label placeholders out loud.

== GETTING REFERENCE IMAGERY — PRE-AUTHORISED, JUST DO IT ==
Never ask permission. Web search, bulk download, video-frame extraction (yt-dlp installed,
ffmpeg on PATH), CDN enumeration, chasing a photographer credit — all expected.
A stadium is unusually well documented: broadcast footage, drone flyovers on YouTube,
UT Athletics media, seating-chart diagrams, and construction/expansion press photos.
A SEATING CHART is effectively a dimensioned plan — find one.

*** GOOGLE STREET VIEW STATIC. *** Key in C:\Users\simip\Projects\utx-diorama\.env —
read it in-script, NEVER print or commit it. Probe /streetview/metadata first for the
panorama DATE (this stadium has been expanded repeatedly; an old pano is a different
building). Technique: stand at the frontage and LOOK UP (pitch 45/60/75, fov 90, sweep
heading ±25°). Stand-off rings fail in dense fabric — but around a stadium you have open
parking and plazas, so stand-off DOES work here. Use both.

== THE FAILURE LEDGER — do not re-buy these ==
- MISIDENTIFICATION IS THE #1 KILLER (4 times on Union — including a photo filenamed
  "south elevation" that was the north). Confirm identity and ORIENTATION before measuring.
  For DKR, orientation is easy to get wrong: confirm which end zone is north.
- VINTAGE MATTERS MORE THAN USUAL HERE. This stadium changed shape in 1998, 2008 and
  2021. Date every image and never mix eras. Say which year your model represents.
- DUPLICATE FILES INFLATE CONFIDENCE — hash your images.
- GOLDEN-HOUR LIGHT IS NOT MATERIAL COLOUR. Separate lit from shaded samples.
- CLIPPED PIXELS BREAK COLOUR RATIOS.
- "CORRECT BY CONSTRUCTION" IS A TRAP — the bowl is NOT symmetric. Verify each end and
  each side head-on rather than mirroring.
- COUNT THINGS. Tiers, vomitories, light masts, suite levels.

== VERIFICATION HARNESS ==
Copy the pattern from utx-diorama/workbench/ (main.js + save_server.py): wb.shot(name,w,h)
renders synchronously and POSTs a PNG you can Read back. Workbench 3022, save-server 3032.
Browser-pane screenshots time out — always verify via wb.shot + Read.
GOTCHA: page loads, no console error, but `wb` undefined = a THROW inside your build
function. Re-import the module in a try/catch to surface it.

== DEFINITION OF DONE ==
1. docs/heroes/dkr-stadium_AUDIT.md: derived bowl section + bay rule; every parameter with
   evidence; sampled hex per material; what you refuted; unverified/placeholder list; the
   YEAR/configuration you modelled; failure ledger.
2. data/heroes/dkr-stadium.json holds palette + parameters as data.
3. js/heroes/dkr-stadium.js is parametric — the bowl is swept from a section, not hand-built.
4. At least 6 renders in renders/heroes/dkr-stadium/: aerial from all four quadrants, one
   at flyover altitude, one field-level, one side-by-side against a reference aerial.
5. REGISTRATION SNIPPET at the end of the audit doc. DO NOT wire yourself in.
6. Commit to hero/dkr-stadium explaining what you corrected and why.

Report honestly. Flag anything unverified rather than claiming completeness.
```

---

## AGENT 3 — MOODY CENTER

```
You are building a photoreal 1:1 replica of the MOODY CENTER arena (2001 Robert Dedman
Dr, Austin TX, 30.2807 N, -97.7325 W) for the Austin 3D Explorer flyover. Opened April
2022, ~15,000-seat arena, Gensler. A distinctive curved/faceted metal-and-glass skin, a
sweeping roof, and a large glazed concourse that glows at night.

THIS IS THE "MODERN AUSTIN" BEAT — a deliberate contrast cut against the limestone
campus. Its value in the flyover is the curved skin catching light, so the surface
geometry and the panel rhythm matter more than interior detail.

== YOUR SANDBOX — DO NOT LEAVE IT ==
Repo: C:\Users\simip\Projects\austin-3d-explorer
Work in a git worktree on branch  hero/moody-center . NEVER commit to main.
You may CREATE and EDIT ONLY:
  js/heroes/moody-center.js
  data/heroes/moody-center.json
  docs/heroes/moody-center_AUDIT.md
  renders/heroes/moody-center/
You may NOT edit js/app.js, index.html, data/hero_designs.json,
scripts/hero_overrides.json, or any file another agent owns. Six other agents are running
right now. Touching a shared file will break them.
Ports: workbench 3023, save-server 3033.

== THE METHOD THAT PRODUCED THE QUALITY BAR (follow it exactly) ==
Reference build: Union on 24th, C:\Users\simip\Projects\utx-diorama. Read
docs/UNION24_AUDIT.md, docs/VISUAL_REFERENCE_PLAYBOOK.md, PROJECT_OVERVIEW.md
(§ STANDING RULES) BEFORE writing code.

1. DERIVE THE INVARIANT RULE, NEVER INSTANCES. For a curved faceted skin the invariants
   are: the generating curve (plan and section), the panel module along it, the facet
   subdivision rule, and the mullion/fin rhythm. Get the CURVE right first — everything
   else hangs off it. Fit the curve to measured points; do not eyeball a spline.
2. MEASURE, NEVER GUESS. Ratios inside one plane of one image are immune to lens and
   distance. Report file + pixel coords + numbers.
   *** NEVER derive a module from an assumed dimension. *** A 15,000-seat arena bowl and
   a standard basketball court (94 x 50 ft) give you in-frame scale bars.
3. ADVERSARIALLY REFUTE BEFORE YOU BUILD. Curved surfaces are where "looks about right"
   hides the most error — attack your curve fit from a different vantage than you fit it.
4. BUILD THE RENDER→SAMPLE→ASSERT LOOP AS CODING STEP ONE.
5. DO NOT INVENT DETAIL NO SOURCE SUPPORTS.

== GETTING REFERENCE IMAGERY — PRE-AUTHORISED, JUST DO IT ==
Never ask permission. Web search, bulk download, video-frame extraction (yt-dlp installed,
ffmpeg on PATH), CDN enumeration, photographer-credit chasing — all expected.
This building is NEW and heavily marketed: Gensler's project page (architect pages carry
the full professional shoot and usually name the photographer — then find that
photographer's portfolio, which has more frames), arena/venue sites, event photography,
drone footage on YouTube, and construction-era progress photos that reveal the structure
under the skin.

*** GOOGLE STREET VIEW STATIC. *** Key in C:\Users\simip\Projects\utx-diorama\.env —
read in-script, NEVER print or commit. Probe /streetview/metadata for the DATE and only
use panoramas AFTER April 2022 — anything earlier is the old Frank Erwin Center that
stood nearby, which would be a catastrophic misidentification. Technique: stand at the
frontage and LOOK UP (pitch 45/60/75, fov 90, sweep ±25°). Around an arena you also have
open plazas and car parks, so stand-off works here too.

== THE FAILURE LEDGER — do not re-buy these ==
- MISIDENTIFICATION IS THE #1 KILLER (4 times on Union). Here the specific trap is the
  FRANK ERWIN CENTER — the round arena Moody replaced, demolished 2024, adjacent site.
  Any pre-2022 imagery or an old satellite tile will show it. Confirm before measuring.
- DUPLICATE FILES INFLATE CONFIDENCE — hash your images.
- GOLDEN-HOUR LIGHT IS NOT MATERIAL COLOUR — and a metal skin is environment-reflective,
  so its apparent colour changes wildly. Separate lit/shaded, state your albedo, and model
  reflectivity rather than baking a gradient.
- CLIPPED PIXELS BREAK COLOUR RATIOS.
- "CORRECT BY CONSTRUCTION" IS A TRAP — verify the curve head-on from more than one side.
- COUNT THINGS. Panel courses, fin spacing, entry bays.

== VERIFICATION HARNESS ==
Copy utx-diorama/workbench/ (main.js + save_server.py): wb.shot(name,w,h) renders
synchronously and POSTs a PNG to Read back. Workbench 3023, save-server 3033.
Browser-pane screenshots time out — verify via wb.shot + Read, and pixel-sample.
GOTCHA: page loads, no console error, `wb` undefined = a THROW inside build. Re-import in
a try/catch to surface it.
NOTE: this scene has NO environment map, so high `metalness` renders NEAR BLACK. Tune
metal materials to the actual light rig, or add a PMREM environment — do not just crank
metalness and wonder why it went dark.

== DEFINITION OF DONE ==
1. docs/heroes/moody-center_AUDIT.md: the generating curve and how you fitted it; every
   parameter with evidence; sampled hex per material; what you refuted; unverified list;
   failure ledger.
2. data/heroes/moody-center.json holds palette + curve control points + parameters as data.
3. js/heroes/moody-center.js is parametric — the skin is generated from the curve.
4. At least 6 renders in renders/heroes/moody-center/: each side, one aerial, one night
   state with the concourse glow, one side-by-side against a reference photo.
5. REGISTRATION SNIPPET at the end of the audit doc. DO NOT wire yourself in.
6. Commit to hero/moody-center explaining what you corrected and why.

Report honestly. Flag anything unverified.
```

---

## AGENT 4 — LBJ PRESIDENTIAL LIBRARY

```
You are building a photoreal 1:1 replica of the LYNDON BAINES JOHNSON PRESIDENTIAL
LIBRARY AND MUSEUM (2313 Red River St, Austin TX, 30.2856 N, -97.7290 W) for the Austin
3D Explorer flyover. Gordon Bunshaft / SOM, 1971. A monumental travertine box, ten
storeys, on a raised plaza, with cantilevered upper floors, a nearly windowless
travertine skin, deep vertical piers and a great glazed archive hall behind.

THIS BUILDING IS DECEPTIVELY SIMPLE. There is almost no ornament to hide behind, so
PROPORTION IS EVERYTHING — the pier rhythm, the cantilever depth, the plinth height and
the travertine coursing are the entire building. Small errors will be glaring.

== YOUR SANDBOX — DO NOT LEAVE IT ==
Repo: C:\Users\simip\Projects\austin-3d-explorer
Work in a git worktree on branch  hero/lbj-library . NEVER commit to main.
You may CREATE and EDIT ONLY:
  js/heroes/lbj-library.js
  data/heroes/lbj-library.json
  docs/heroes/lbj-library_AUDIT.md
  renders/heroes/lbj-library/
You may NOT edit js/app.js, index.html, data/hero_designs.json,
scripts/hero_overrides.json, or any file another agent owns. Six other agents are running
right now. Touching a shared file will break them.
Ports: workbench 3024, save-server 3034.

== THE METHOD THAT PRODUCED THE QUALITY BAR (follow it exactly) ==
Reference build: Union on 24th, C:\Users\simip\Projects\utx-diorama. Read
docs/UNION24_AUDIT.md, docs/VISUAL_REFERENCE_PLAYBOOK.md, PROJECT_OVERVIEW.md
(§ STANDING RULES) BEFORE writing code.

1. DERIVE THE INVARIANT RULE, NEVER INSTANCES. Here the invariants are the PIER MODULE,
   the floor-to-floor, the cantilever step, the plinth, and the travertine block coursing.
   Establish the module first and let every dimension fall out of it.
   *** NEVER derive a module from an assumed dimension. On Union we divided an ASSUMED
   overall width by a known count and stretched the whole facade 9% for weeks. Measure
   the module directly, then let the overall size be the CONSEQUENCE. ***
2. MEASURE, NEVER GUESS. Ratios inside one plane of one image are immune to lens and
   distance. Report file + pixel coords + numbers for every committed number.
3. ADVERSARIALLY REFUTE BEFORE YOU BUILD. On a building this austere, a plausible-looking
   proportion is the main failure mode — attack your pier rhythm and cantilever depth from
   images you did not derive them from.
4. BUILD THE RENDER→SAMPLE→ASSERT LOOP AS CODING STEP ONE.
5. DO NOT INVENT DETAIL NO SOURCE SUPPORTS. Travertine has a very particular veined,
   pitted texture — if you cannot sample it, say so rather than inventing a stone.

== GETTING REFERENCE IMAGERY — PRE-AUTHORISED, JUST DO IT ==
Never ask permission. Web search, bulk download, video-frame extraction (yt-dlp installed,
ffmpeg on PATH), CDN enumeration, photographer-credit chasing — all expected.
This is a canonical work of American modernism, so it is unusually well published:
architectural surveys, SOM's own archive, the National Archives / LBJ Foundation, the
Library of Congress, HABS documentation (which sometimes includes MEASURED DRAWINGS — if
you find those, they are worth more than any photograph), plus university tour videos.

*** GOOGLE STREET VIEW STATIC. *** Key in C:\Users\simip\Projects\utx-diorama\.env —
read in-script, NEVER print or commit. Probe /streetview/metadata for the DATE.
Technique: stand at the frontage and LOOK UP (pitch 45/60/75, fov 90, sweep ±25°).
This building sits on a large open plaza with long clear sightlines, so stand-off ALSO
works well here — use both, and use the plaza to get true elevations.

== THE FAILURE LEDGER — do not re-buy these ==
- MISIDENTIFICATION IS THE #1 KILLER (4 times on Union). Nearby are Bass Concert Hall,
  the Blanton and Ellsworth Kelly's "Austin" — Agent 5 is working those. Confirm identity
  before measuring, and do not model theirs.
- DUPLICATE FILES INFLATE CONFIDENCE — hash your images.
- GOLDEN-HOUR LIGHT IS NOT MATERIAL COLOUR. Travertine swings from warm cream to cold
  grey with the light. Separate lit/shaded samples and state your albedo estimate.
- CLIPPED PIXELS BREAK COLOUR RATIOS — a saturated "white" reference destroys a palette.
- "CORRECT BY CONSTRUCTION" IS A TRAP. This building looks symmetric; verify all four
  elevations head-on rather than mirroring one.
- COUNT THINGS. Piers per elevation, courses per storey, plinth steps.

== VERIFICATION HARNESS ==
Copy utx-diorama/workbench/ (main.js + save_server.py): wb.shot(name,w,h) renders
synchronously and POSTs a PNG you Read back. Workbench 3024, save-server 3034.
Browser-pane screenshots time out — verify via wb.shot + Read, and pixel-sample.
GOTCHA: page loads, no console error, `wb` undefined = a THROW inside build. Re-import in
a try/catch to surface it.

== DEFINITION OF DONE ==
1. docs/heroes/lbj-library_AUDIT.md: the module and how you measured it; every parameter
   with evidence; sampled hex with lit/shaded separation; what you refuted; unverified
   list; failure ledger.
2. data/heroes/lbj-library.json holds palette + parameters as data.
3. js/heroes/lbj-library.js is parametric — every dimension derives from the module.
4. At least 6 renders in renders/heroes/lbj-library/: all four elevations head-on, one
   aerial, one side-by-side against a reference photo at matched angle.
5. REGISTRATION SNIPPET at the end of the audit doc. DO NOT wire yourself in.
6. Commit to hero/lbj-library explaining what you corrected and why.

Report honestly. Flag anything unverified.
```

---

## AGENT 5 — ARTS CORRIDOR (4 buildings)

```
You are building photoreal 1:1 replicas of FOUR adjacent buildings in UT Austin's arts
corridor for the Austin 3D Explorer flyover:
  1. BLANTON MUSEUM OF ART (200 E Martin Luther King Jr Blvd, 30.2809 N, -97.7376 W) —
     two limestone-and-glass pavilions, Kallmann McKinnell & Wood, 2006.
  2. ELLSWORTH KELLY "AUSTIN" (on the Blanton grounds) — a small white stone chapel-like
     building with coloured glass windows and a totemic wood sculpture, completed 2018.
     *** THIS IS THE SINGLE MOST SHAREABLE OBJECT ON CAMPUS. Its coloured glass is the
     money shot. Get it exactly right — it is small, so it must be precise. ***
  3. HARRY RANSOM CENTER (300 W 21st St, 30.2843 N, -97.7411 W) — a windowless-looking
     travertine box with etched-glass panels depicting scenes, 1972.
  4. BASS CONCERT HALL (2350 Robert Dedman Dr, 30.2860 N, -97.7311 W) — a large
     brick-and-concrete performing arts hall.

These share a precinct and a limestone/white palette, so derive the shared material
vocabulary ONCE and apply it — that is why they are grouped.

== YOUR SANDBOX — DO NOT LEAVE IT ==
Repo: C:\Users\simip\Projects\austin-3d-explorer
Work in a git worktree on branch  hero/arts-corridor . NEVER commit to main.
You may CREATE and EDIT ONLY:
  js/heroes/arts-corridor.js        (may import from js/heroes/arts/*.js which you also own)
  data/heroes/arts-corridor.json
  docs/heroes/arts-corridor_AUDIT.md
  renders/heroes/arts-corridor/
You may NOT edit js/app.js, index.html, data/hero_designs.json,
scripts/hero_overrides.json, or any file another agent owns. Six other agents are running
right now. NOTE: Agent 4 is building the LBJ LIBRARY, which is near Bass Concert Hall.
Do NOT model the LBJ Library.
Ports: workbench 3025, save-server 3035.

== THE METHOD THAT PRODUCED THE QUALITY BAR (follow it exactly) ==
Reference build: Union on 24th, C:\Users\simip\Projects\utx-diorama. Read
docs/UNION24_AUDIT.md, docs/VISUAL_REFERENCE_PLAYBOOK.md, PROJECT_OVERVIEW.md
(§ STANDING RULES) BEFORE writing code.

1. DERIVE THE INVARIANT RULE, NEVER INSTANCES — per building, and ALSO across the group.
   Find what the four share (stone coursing, glazing systems, plinth logic) and factor it
   into a shared module; then each building is that vocabulary plus its own parameters.
   *** NEVER derive a module from an assumed dimension. ***
2. MEASURE, NEVER GUESS. Ratios inside one plane of one image are immune to lens and
   distance. Report file + pixel coords + numbers.
3. ADVERSARIALLY REFUTE BEFORE YOU BUILD, per building. Do not let a rule that fits
   Blanton get applied to Ransom without re-verification.
4. BUILD THE RENDER→SAMPLE→ASSERT LOOP AS CODING STEP ONE.
5. DO NOT INVENT DETAIL NO SOURCE SUPPORTS. For Kelly's "Austin", the coloured-glass
   layout is a specific authored artwork — find the real window arrangement and colours
   and reproduce them; DO NOT improvise a pattern. If you cannot source it, say so.

BUDGET YOUR EFFORT: Kelly's "Austin" and the Blanton deserve the most; Bass Concert Hall
is a large simple mass and needs correct proportion and material more than fine detail.

== GETTING REFERENCE IMAGERY — PRE-AUTHORISED, JUST DO IT ==
Never ask permission. Web search, bulk download, video-frame extraction (yt-dlp installed,
ffmpeg on PATH), CDN enumeration, photographer-credit chasing — all expected.
Museums publish extensively: the Blanton's own site, architecture press, the Kelly estate
and Blanton press kits for "Austin" (which document the glass precisely), plus visitor
photography on Maps and review sites for angles the professionals skipped.

*** GOOGLE STREET VIEW STATIC. *** Key in C:\Users\simip\Projects\utx-diorama\.env —
read in-script, NEVER print or commit. Probe /streetview/metadata for the DATE — "Austin"
only exists after Feb 2018, and the Blanton's plaza was renovated in 2023, so date every
pano. Technique: stand at the frontage and LOOK UP (pitch 45/60/75, fov 90, sweep ±25°).
Open plazas here mean stand-off works too.

== THE FAILURE LEDGER — do not re-buy these ==
- MISIDENTIFICATION IS THE #1 KILLER (4 times on Union — including a photo filenamed
  "south elevation" that was the north). With FOUR similar limestone buildings in one
  precinct this is your biggest risk. Confirm which building every image shows before
  measuring, using a signed feature or a compass-anchored aerial. Never trust a filename.
- DUPLICATE FILES INFLATE CONFIDENCE — hash your images.
- GOLDEN-HOUR LIGHT IS NOT MATERIAL COLOUR. Limestone and travertine swing hugely.
  Separate lit/shaded and state albedo.
- CLIPPED PIXELS BREAK COLOUR RATIOS — especially fatal on white stone. Check saturation
  before anchoring any palette.
- "CORRECT BY CONSTRUCTION" IS A TRAP — verify each elevation head-on.
- COUNT THINGS. Bays, courses, and for "Austin" the exact count and arrangement of the
  coloured glass panels.

== VERIFICATION HARNESS ==
Copy utx-diorama/workbench/ (main.js + save_server.py): wb.shot(name,w,h) renders
synchronously and POSTs a PNG you Read back. Workbench 3025, save-server 3035.
Browser-pane screenshots time out — verify via wb.shot + Read, and pixel-sample.
GOTCHA: page loads, no console error, `wb` undefined = a THROW inside build. Re-import in
a try/catch to surface it.

== DEFINITION OF DONE ==
1. docs/heroes/arts-corridor_AUDIT.md: the SHARED vocabulary plus a per-building section,
   each with derived rule, parameters + evidence, sampled hex, what you refuted, and an
   unverified/placeholder list. Plus a group failure ledger.
2. data/heroes/arts-corridor.json holds the shared palette and per-building parameters.
3. js/heroes/arts-corridor.js is parametric and shares the common vocabulary.
4. At least 8 renders in renders/heroes/arts-corridor/: at least one head-on elevation per
   building, one precinct aerial showing all four in context, a dedicated close study of
   Kelly's "Austin" including its coloured glass, and one side-by-side per building against
   a reference photo.
5. REGISTRATION SNIPPET at the end of the audit doc. DO NOT wire yourself in.
6. Commit to hero/arts-corridor explaining what you corrected and why.

Report honestly per building. Say which ones are strong and which are weak — that is far
more useful than uniform confidence.
```

---

## AGENT 6 — THE DRAG CORE (4 buildings)

```
You are building photoreal 1:1 replicas of FOUR buildings at the student heart of UT
Austin, all within a block of Guadalupe St ("The Drag"), for the Austin 3D Explorer
flyover:
  1. PERRY-CASTAÑEDA LIBRARY (PCL) (101 E 21st St, 30.2825 N, -97.7383 W) — a large
     1977 brutalist library, a distinctive angular concrete mass. The contrast note.
  2. GREGORY GYMNASIUM (2101 Speedway, 30.2837 N, -97.7369 W) — 1930 red brick and
     limestone with arched openings, later additions.
  3. TEXAS UNION (2308 Whitis Ave, 30.2867 N, -97.7412 W) — 1933 Spanish Renaissance
     revival, Paul Cret, limestone and red tile roof.
  4. UNIVERSITY CO-OP (2246 Guadalupe St, 30.2857 N, -97.7418 W) — the retail landmark
     directly on The Drag.

These span 1930s campus revival to 1970s brutalism, so DO NOT force one vocabulary across
them — derive each properly. What they share is site, scale and the campus limestone.

== YOUR SANDBOX — DO NOT LEAVE IT ==
Repo: C:\Users\simip\Projects\austin-3d-explorer
Work in a git worktree on branch  hero/drag-core . NEVER commit to main.
You may CREATE and EDIT ONLY:
  js/heroes/drag-core.js            (may import from js/heroes/drag/*.js which you also own)
  data/heroes/drag-core.json
  docs/heroes/drag-core_AUDIT.md
  renders/heroes/drag-core/
You may NOT edit js/app.js, index.html, data/hero_designs.json,
scripts/hero_overrides.json, or any file another agent owns. Six other agents are running
right now. NOTE: Agent 1 is building the UT TOWER + MAIN BUILDING, which is close to
Gregory Gym and the Texas Union. Do NOT model the Tower or Main Building.
Ports: workbench 3026, save-server 3036.

== THE METHOD THAT PRODUCED THE QUALITY BAR (follow it exactly) ==
Reference build: Union on 24th, C:\Users\simip\Projects\utx-diorama. Read
docs/UNION24_AUDIT.md, docs/VISUAL_REFERENCE_PLAYBOOK.md, PROJECT_OVERVIEW.md
(§ STANDING RULES) BEFORE writing code.

1. DERIVE THE INVARIANT RULE, NEVER INSTANCES, PER BUILDING. PCL's invariant is its
   concrete bay and window slot rhythm; Gregory's is brick coursing plus arch module;
   the Union's is limestone bay plus tile-roof geometry. Find each module, verify it
   reproduces every visible example, THEN draw.
   *** NEVER derive a module from an assumed dimension — that stretched every cell of
   Union on 24th's facade 9% for weeks. Measure the module directly; let overall size be
   the consequence. ***
2. MEASURE, NEVER GUESS. Ratios inside one plane of one image are immune to lens and
   distance. Report file + pixel coords + numbers. Brick is a gift: a standard US brick
   course is ~2⅔ in with mortar (3 courses ≈ 8 in), giving you a free in-frame scale bar
   on Gregory and the Co-op — use it and say you did.
3. ADVERSARIALLY REFUTE BEFORE YOU BUILD, per building.
4. BUILD THE RENDER→SAMPLE→ASSERT LOOP AS CODING STEP ONE.
5. DO NOT INVENT DETAIL NO SOURCE SUPPORTS. Label placeholders out loud.

BUDGET YOUR EFFORT: PCL and Gregory read biggest in a flyover; the Co-op is small but is
the most-photographed streetfront on The Drag, so its street elevation matters more than
its roof.

== GETTING REFERENCE IMAGERY — PRE-AUTHORISED, JUST DO IT ==
Never ask permission. Web search, bulk download, video-frame extraction (yt-dlp installed,
ffmpeg on PATH), CDN enumeration, photographer-credit chasing — all expected.
UT publishes campus master-plan documents, historic-preservation surveys and archival
photography; the Texas Union and Gregory both have documented histories with elevation
drawings. A HISTORIC SURVEY WITH MEASURED DRAWINGS beats any photograph — look for one.

*** GOOGLE STREET VIEW STATIC. *** Key in C:\Users\simip\Projects\utx-diorama\.env —
read in-script, NEVER print or commit. Probe /streetview/metadata for the DATE; The Drag
has been repeatedly redeveloped, so an old pano may show a demolished neighbour.
Technique: stand at the frontage and LOOK UP (pitch 45/60/75, fov 90, sweep ±25°).
Guadalupe is a wide straight street — a rare case where stand-off along the street axis
ALSO works. Use both.

== THE FAILURE LEDGER — do not re-buy these ==
- MISIDENTIFICATION IS THE #1 KILLER (4 times on Union — including a photo filenamed
  "south elevation" that was the north). Campus has many similar limestone-and-tile
  buildings. Confirm which building every image shows before measuring. Never trust a
  filename.
- DUPLICATE FILES INFLATE CONFIDENCE — hash your images.
- GOLDEN-HOUR LIGHT IS NOT MATERIAL COLOUR. Concrete and limestone swing hugely; red
  brick goes orange at sunset. Separate lit/shaded, state albedo.
- CLIPPED PIXELS BREAK COLOUR RATIOS.
- "CORRECT BY CONSTRUCTION" IS A TRAP — these buildings have additions that break their
  apparent symmetry. Verify each elevation head-on rather than mirroring.
- COUNT THINGS. Bays, arches, window slots, brick courses per storey.

== VERIFICATION HARNESS ==
Copy utx-diorama/workbench/ (main.js + save_server.py): wb.shot(name,w,h) renders
synchronously and POSTs a PNG you Read back. Workbench 3026, save-server 3036.
Browser-pane screenshots time out — verify via wb.shot + Read, and pixel-sample.
GOTCHA: page loads, no console error, `wb` undefined = a THROW inside build. Re-import in
a try/catch to surface it.

== DEFINITION OF DONE ==
1. docs/heroes/drag-core_AUDIT.md: a per-building section, each with derived rule,
   parameters + evidence, sampled hex, what you refuted, unverified/placeholder list.
   Plus a group failure ledger.
2. data/heroes/drag-core.json holds per-building palettes and parameters.
3. js/heroes/drag-core.js is parametric per building.
4. At least 8 renders in renders/heroes/drag-core/: at least one head-on elevation per
   building, one aerial showing the group in context, one street-level view down Guadalupe,
   and one side-by-side per building against a reference photo.
5. REGISTRATION SNIPPET at the end of the audit doc. DO NOT wire yourself in.
6. Commit to hero/drag-core explaining what you corrected and why.

Report honestly per building — say which are strong and which are weak.
```

---

## AGENT 7 — WEST CAMPUS TOWER CLUSTER (7 buildings)

```
You are building photoreal 1:1 replicas of SEVEN student high-rises in West Campus,
Austin TX, for the Austin 3D Explorer flyover. Together they give the flyover its
vertical drama — the dense tower cluster just west of the UT campus.

  1. DOBIE TWENTY21 (2021 Guadalupe St, 30.2846 N, -97.7420 W) — 27 floors, 1972 tower.
  2. THE CASTILIAN (2323 San Antonio St, 30.2866 N, -97.7434 W) — 1960s-70s tower.
  3. SKYLOFT (507 W 23rd St, 30.2864 N, -97.7440 W)
  4. MOONTOWER (called out in the project's hero list; West Campus, verify address)
  5. 21 RIO (2101 Rio Grande St, 30.2843 N, -97.7452 W)
  6. INSPIRE ON 22ND (once verified; West Campus)
  7. RISE (West Campus; verify address)
Verify every address and identity yourself before modelling — several West Campus towers
have been renamed or rebranded, and the project's own gazetteer at
austin-3d-explorer/research/union24th-area/buildings.json and DOSSIER.md has confirmed
addresses and neighbour relationships. READ THOSE FIRST.

*** THE QUALITY BAR IS UNION ON 24TH, WHICH IS THEIR NEIGHBOUR AND IS ALREADY DONE. ***
Read C:\Users\simip\Projects\utx-diorama\docs\UNION24_AUDIT.md and U24_ROOFTOP_SPEC.md.
That is the standard. Do NOT model Union on 24th — it is finished and owned elsewhere.

These are all the same TYPOLOGY — student high-rises with a parking podium, a repeating
residential facade module, and a rooftop amenity deck. So derive the SHARED SYSTEM once
(podium screen + tower module + amenity crown) and then parameterise per building. That
is why seven are in one session.

== YOUR SANDBOX — DO NOT LEAVE IT ==
Repo: C:\Users\simip\Projects\austin-3d-explorer
Work in a git worktree on branch  hero/west-campus-towers . NEVER commit to main.
You may CREATE and EDIT ONLY:
  js/heroes/west-campus-towers.js   (may import from js/heroes/wct/*.js which you also own)
  data/heroes/west-campus-towers.json
  docs/heroes/west-campus-towers_AUDIT.md
  renders/heroes/west-campus-towers/
You may NOT edit js/app.js, index.html, data/hero_designs.json,
scripts/hero_overrides.json, or any file another agent owns. Six other agents are running
right now. Touching a shared file will break them.
Ports: workbench 3027, save-server 3037.

== THE METHOD THAT PRODUCED THE QUALITY BAR (follow it exactly) ==
Read docs/UNION24_AUDIT.md, docs/U24_ROOFTOP_SPEC.md, docs/VISUAL_REFERENCE_PLAYBOOK.md
and PROJECT_OVERVIEW.md (§ STANDING RULES) in utx-diorama BEFORE writing code.

1. DERIVE THE INVARIANT RULE, NEVER INSTANCES. For each tower: the facade CELL (one bay x
   one floor), its internal composition, and the per-instance transform. Verify the rule
   reproduces every visible bay BEFORE drawing. A wrong bay means a wrong RULE.
   *** NEVER derive a module from an assumed dimension. On Union we divided an ASSUMED
   57 m depth by a known 16 columns and stretched every cell 9% — undetected for weeks,
   and it corrupted the massing too. MEASURE THE MODULE DIRECTLY, then let the overall
   envelope be the CONSEQUENCE. When we finally did that on Union the envelope moved from
   80 m to 82.1 m. ***
2. MEASURE, NEVER GUESS. Ratios inside one plane of one image are immune to lens and
   distance — prefer them. A floor-to-floor of ~3.2 m is a reliable starting scale bar for
   this typology, but CONFIRM it per building.
3. ADVERSARIALLY REFUTE BEFORE YOU BUILD, PER BUILDING. On Union, refuters killed a
   confident facade spec that would have painted ~300 phantom windows, and later killed
   THREE successive readings of one courtyard wall. With seven buildings the temptation to
   copy a rule across is enormous — refute each transfer explicitly.
4. BUILD THE RENDER→SAMPLE→ASSERT LOOP AS CODING STEP ONE.
5. DO NOT INVENT DETAIL NO SOURCE SUPPORTS. Label placeholders out loud.

BUDGET YOUR EFFORT: seven buildings in one session means you cannot do Union-level depth
on all of them. Prioritise (a) correct massing and height for ALL seven — this is what a
flyover shows — then (b) a correct facade module for all seven, then (c) fine detail on
the two or three that read biggest. Say clearly in the audit which got which level.

== GETTING REFERENCE IMAGERY — PRE-AUTHORISED, JUST DO IT ==
Never ask permission. Web search, bulk download, video-frame extraction (yt-dlp installed,
ffmpeg on PATH), CDN enumeration, photographer-credit chasing — all expected.
Student housing is heavily marketed: leasing-syndication galleries (Apartments.com, Zillow,
RENTCafe, ApartmentList) host the largest photo sets — pull image URLs out of the gallery
markup / JSON-LD / og:image rather than just reporting the page. Property Instagram
accounts and YouTube apartment tours often walk the amenity decks. On Union, a krpano
VIRTUAL TOUR (tours.atlasbayvr.com) turned out to be the single richest source — 197
panoramas, cube faces downloadable directly. LOOK FOR A VIRTUAL TOUR for each property.

*** GOOGLE STREET VIEW STATIC — YOUR HIGHEST-VALUE TOOL. ***
Key in C:\Users\simip\Projects\utx-diorama\.env — read in-script, NEVER print or commit.
  - Probe /streetview/metadata?location=LAT,LNG&key=... FIRST. It is free and returns the
    panorama DATE. West Campus has post-2024 coverage on W 24th and Rio Grande; other
    streets are 2011-2016. Only trust panoramas newer than each building's completion.
  - THE TECHNIQUE THAT WORKS: stand ON the building's frontage and LOOK UP —
    heading perpendicular INTO the facade, pitch 45/60/75, fov 90, sweep heading ±25°.
    Nothing obstructs you at the frontage.
  - A STAND-OFF RING MOSTLY FAILS HERE. We built a 13-station ring at 114-213 m around
    Union and threw most of it away: West Campus is dense, so live oaks, power lines and
    neighbouring low-rises block the sightline. Distance alone is not enough.

== THE FAILURE LEDGER — do not re-buy these ==
- MISIDENTIFICATION IS THE #1 KILLER. It happened FOUR times on Union, in this exact
  neighbourhood: Waterloo Tower (signed, ~30 storeys, NE) was measured as the subject;
  Villas on 24th (pale precast, big window grid, east across Rio Grande) was framed
  instead of Union; and a photo filenamed "south elevation" was the NORTH elevation.
  With SEVEN similar towers in a few blocks this is your dominant risk.
  CONFIRM IDENTITY BEFORE MEASURING ANYTHING, using signage, a known neighbour, or a
  compass-anchored north-up aerial. Never trust a filename.
- DUPLICATE FILES INFLATE CONFIDENCE. On Union several "independent" references were the
  same photograph renamed. Hash your images before counting agreement.
- GOLDEN-HOUR LIGHT IS NOT MATERIAL COLOUR. A podium screen we read as warm taupe is
  neutral #2c2d33 in daylight; its apparent light/dark banding was directional, measuring
  2.0:1 at dusk against 1.35:1 at midday. Separate lit/shaded, state albedo, and never
  bake a lighting effect as base colour.
- CLIPPED PIXELS BREAK COLOUR RATIOS. A "reference white" containing a 255 channel forced
  a ratio to 1.0 and produced a wrong palette on Union.
- PERSPECTIVE CAN FAKE A PATTERN CHANGE. Apparent window size scales as 1/distance when
  looking up a shaft. Test explicitly before claiming a facade varies with height — on
  Union the honest answer turned out to be that it did NOT.
- "CORRECT BY CONSTRUCTION" IS A TRAP. A mirrored facade looked flawless and was
  backwards for weeks. Verify every symmetric variant head-on.
- COUNT THINGS. The owner counts every window and will notice.

== VERIFICATION HARNESS ==
Copy utx-diorama/workbench/ (main.js + save_server.py): wb.shot(name,w,h) renders
synchronously and POSTs a PNG you Read back. Workbench 3027, save-server 3037.
Browser-pane screenshots time out — verify via wb.shot + Read, and pixel-sample the render
to check colours and counts.
GOTCHA: page loads, no console error, `wb` undefined = a THROW inside build, not a syntax
error. Re-import the module in a try/catch in the page to surface it.
NOTE: no environment map in this scene — high `metalness` renders NEAR BLACK. Tune to the
light rig or add a PMREM env.

== DEFINITION OF DONE ==
1. docs/heroes/west-campus-towers_AUDIT.md: the SHARED typology system, then a per-building
   section with derived rule, parameters + evidence, sampled hex, what you refuted, and an
   unverified/placeholder list. State the DEPTH LEVEL reached per building. Plus a group
   failure ledger.
2. data/heroes/west-campus-towers.json holds shared + per-building parameters.
3. js/heroes/west-campus-towers.js is parametric off the shared system.
4. At least 10 renders in renders/heroes/west-campus-towers/: one head-on elevation per
   building, one cluster aerial showing all seven with correct relative heights, one
   flyover-altitude view, and side-by-sides against references for the three strongest.
5. A RELATIVE-HEIGHT CHECK: one render of all seven from a single distant vantage, with
   your measured heights tabulated in the audit. Wrong relative heights are the most
   visible possible error in a cluster.
6. REGISTRATION SNIPPET at the end of the audit doc. DO NOT wire yourself in.
7. Commit to hero/west-campus-towers explaining what you corrected and why.

Report honestly per building. Say which are strong and which are weak — uniform confidence
across seven buildings would not be believable.
```

---

## AFTER THEY FINISH — your merge checklist

1. Each agent leaves a **registration snippet** in its audit doc. You paste those into
   `js/app.js` yourself, one at a time, so nothing collides.
2. Review each audit's **"unverified / placeholder"** list before trusting a building.
3. Watch for **relative height errors** across buildings from different agents — that is
   the one class of error no single agent can catch. Do one combined aerial and compare.
4. Union on 24th still needs your explicit go-ahead before it replaces the current
   `Union on 24th` entry in the explorer.
