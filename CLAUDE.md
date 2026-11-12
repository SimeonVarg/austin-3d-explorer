# CLAUDE.md — conventions for every lane

Shared working agreement for all AI sessions on this repo. Read this and
`HANDOFF.md` at the start of every session and before every new task.

This file is public. Personal context about Simeon lives in each machine's local
memory and is never written here, in any tracked file, or in a commit message.

## Lanes

1. **TWO LANES, SPLIT BY BAKE.** Each bake script owns exactly one output file
   and nothing else writes it — that is the only boundary that has ever held.
   `MAC_QUEUE.md` says which scripts and which data file the Mac lane owns this
   round; everything else is the Acer's.

   **Why it is drawn that way.** The first split was an ad-hoc list of files and
   it cut straight through a subsystem: the Mac owned `js/facades.js` while the
   Acer needed it for the buildings-on-tiles port, so finished work sat parked
   and the same discovery was written into the handoff twice from two machines.
   A boundary that runs through the middle of one job is worse than no boundary.
   A bake and its output file cannot collide by construction.

   **A lane may READ any file. It may only WRITE its own.** If you need a schema
   change in someone else's file, write the request into `HANDOFF.md` rather
   than making it.

   (History: this was briefly "one lane, all files" on 2026-08-02 after Simeon
   said *"just do everything yourself"* — but that was him not having time to set
   the Mac up, not a judgement that splitting was wrong. He runs two machines
   deliberately, for a deadline: *"i mainly got it bc i have a deadline for this
   project and wanted 2x progress"*. Two minutes of his setup for hours of
   parallel work is a good trade. Draw the boundary properly and it stays one.)

   **Where the lanes run (2026-10-05).** The main lane now works on the Mac, in
   its own work copy of `main`. The Acer travels with the owner and must stay
   free for his own work, so plan no heavy job for it (GPU browser checks, long
   bakes, overnight chains) unless he says it is free. Heavy picture checks go
   to the cloud runner (`scripts/colab/run.py`). Read "the Acer" in this file
   and in `MAC_QUEUE.md` as "the main lane", wherever it runs. The split by bake
   script is unchanged.

2. **Merge your own PRs. Do not wait for Simeon.** (Changed 2026-08-01, at his
   instruction: *"im a manager who gives feedback not micromanages"*. The old
   rule was "nobody merges their own PRs".) A lane merges its own work once it
   has verified it, and **resolves its own conflicts** — never hand a conflict
   back. Before merging:
   - pull `main`, rebase or merge it in, and **re-run the verification** on the
     merged result, not on your branch in isolation;
   - if the merge touches a file the other lane's open PR also touches, say so
     in the PR and re-check that lane's assertions too;
   - if you cannot make it pass, **close the PR or leave it open with the reason
     written down.** Merging red is the one thing this rule does not permit.
   - delete the branch after merging, so the branch list stays readable.
3. **Show him the city, not the process.** He wants to look at the thing and give
   feedback. So: end a pass with **screenshots of what changed**, and when a
   defect is visual, lead with the picture. He is not reading the diff. Keep
   written updates in plain words — no jargon, no tables of metrics unless he
   asked for numbers.
4. **Docs-only commits** (`CLAUDE.md`, `HANDOFF.md`, `docs/` (including `docs/journal/`), `QUEUE.md`,
   `MAC_QUEUE.md`) may go straight to `main`. Always pull before pushing.
   **Code goes through branches and PRs** — the PR is the record of why, even
   when you merge it yourself five minutes later.
5. **Pull latest `main`** at the start of every session and before every new
   task, and reread this file and `HANDOFF.md`.
6. **When Simeon tells you something both machines should know about the
   project, write it into this file and push immediately** so the other lane
   sees it. Personal context about Simeon goes in local memory, never here.
7. **When you finish a pass, add a dated entry at the top of the current
   month's journal file** (`docs/journal/2026-MM.md`; say what you did and the
   branch name), and **update `HANDOFF.md` only when the current state
   changed** (what is live, open PRs, what is next). `HANDOFF.md` is a short
   current-state file; history lives in `docs/journal/`, indexed by
   `docs/JOURNAL.md`. Never append history to `HANDOFF.md`.

   **One writer for the two shared records (2026-10-06).** `HANDOFF.md` and the top of
   the month's journal file are written by the lane that PUBLISHES a pull request, once,
   from the builder's result. A builder does not edit either file on its branch: it puts
   its journal entry and any current-state line in the pull request body (or its mail),
   and the publishing lane adds them to `main` after the merge. Why: on 2026-10-05/06 four
   pull requests in a row each added an entry at the top of the same journal file, so every
   merge made the next ones conflict, and a conflicting pull request gets no checks at all.

8. **File-ownership lanes.** Before touching a file that another lane's open PR
   touches, say so and pick a different task. With self-merge this matters more,
   not less — the other lane can no longer rely on a human noticing the clash.

## The one thing to escalate

9. **Ask him about taste, decide everything else yourself.** If the question is
   "should the city look like this?", show him and let him choose. If the
   question is "is this correct, is this fast, is this the right structure?",
   that is yours — make the call, write down why, merge it. Handing back an
   execution decision he already delegated wastes the delegation.

   **A gain with no loss he can see ships as the default, with no question.** (Owner,
   2026-11-11, after a "keep or no?" text about a faster mode: *"If it's faster why ask me
   to keep or throw away? ... More input from me for no reason."*) Say the one real
   downside in one sentence and do it. A question to him is for a taste choice with a
   visible trade, and it carries its picture. And when he asks what you are working on,
   the first sentence of the answer is that one thing.

## Verification

10. **Verify by looking, not by reasoning.** `scripts/verify/README.md` is the
    law — every timing trap in it is a real incident that cost real hours.
    - Screenshot twice, trust the second.
    - **Take the minimum of interleaved reps, never one reading.** Load time in
      this suite has been measured from 11 s to 65 s for an identical page with
      identical flags on a quiet machine. On 2026-08-01 a whole theory was built
      on a single sample and was wrong; four separate claims that day were
      retracted, and every catch came from running the thing rather than
      reasoning about it.
    - **An instrument's defaults are part of its answer.** `perf.mjs` throttles
      the CPU 4× unless told otherwise; `content-length` counts a cache hit at
      full price; a page-scoped CDP session cannot see MapLibre's worker fetches
      and will under-report a load by 19 MB. Quote the setting with the number.
    - **Measure motion at the resolution motion really runs at.** (2026-11-11.) In motion the app lowers the canvas resolution
      to hold its frame rate. On the owner's Mac the opening flight runs at pixel ratio 1.0 (a quarter of the pixels) from
      2.8 s to its end, at 11 to 20 frames a second. Every shimmer gate before that day measured still views at full
      resolution, so the gates passed and his eye did not agree. Record the real flight first (frame times, pixel ratio,
      triangles for every drawn frame), then draw the recorded cameras again at the recorded resolution. (That day's note
      "the cost of a frame is the number of triangles" was WRONG, see the next point.)
    - **The first setting of every instrument is the owner's own screen: a 2560 x 1300 window at device pixel ratio 1.**
      (2026-11-12.) Three days of flight numbers, four pull requests and two messages to him were taken at 1440 x 900 and
      ratio 2, a screen he does not use. At ratio 1 the adaptive resolution has a floor of 1, so the app is a different app
      there: the steady picture (#674) made his motion picture SOFTER, and loading the flight's tiles ahead (#676) made his
      second leg slower, while both measured as gains at ratio 2. A second screen kind is a second run, never the only one;
      every number is written with its screen size. And a number that says "equal" is not a look: open the frames at true
      pixel size, at his size, before a claim.
    - **A copy that stands in for a model is tested per OBJECT, never by a whole-frame average.** (2026-11-12, #679.) The
      far copies went live after a test that said "under 1 of 255 on average". One building drawn as a dark blotched block,
      black shards on one roof and a green field gone pale are nothing in such an average. The test of a stand-in (a far
      copy, a card for a tree, a simpler mesh) draws each object both ways from where the stand-in is used, measures over
      that object's own pixels, and a person looks at the worst ones (`scripts/verify/v2-far-scan.mjs`).
      **And a tile mean is still an average (2026-11-12, #681):** a tile holds up to 20 buildings, and one tower wall drawn blue
      where the full model is grey passed the tile's three numbers. The scan has a fourth, the worst 12 x 12 pixel patch (limit 45).
      When a mean passes, look at the worst small patch before you believe it.
    - **Before a speed job, measure the cheapest possible frame.** (2026-11-11, #674.) One flat material at the canvas's
      full size, no multisampling, took 10 to 12 ms on the owner's Mac; the real materials took 52 to 58 ms; the canvas's
      own multisampling was 10 ms of a 32 ms frame. So the triangles were never the cost, and no cut of triangles could
      have reached full size in motion. Two days of far copies and tree cards were aimed by a wrong sentence. One page load
      (`scene.overrideMaterial`, a target with 0 and with 4 samples, three sizes) would have shown it on day one.
    - **Test ONE step before you score a run.** (2026-11-11.) A score of 34 moving frames said "a bit better" for hours
      while half the picture was carried wrongly. A test of one step (a still at camera A, one frame at camera B that
      takes nothing new, against a still at B) named the fault in one run: the ground had no depth. And judge a frame at
      TRUE pixel size: twice that night a 960-pixel copy of a 2880-pixel frame said "the shadows are gone", and it was blur.
    - **A stand-in is checked against the TRUTH, not against a side-by-side.** (2026-11-11.) A far copy, a card, any
      pre-filtered picture of a model: draw the full model with 3 x 3 samples a pixel, add the samples up as LIGHT (not as
      display numbers), and score the stand-in against that (`scripts/verify/v2-full-detail.mjs`: brightness drift, and
      the difference after a 3 x 3 average). In one morning that test found what side-by-sides at one screen density had
      missed: far copies with pale towers, and tree cards with no shadows (three.js draws the BACK faces of a front-sided
      mesh into the shadow map). The cause of the pale towers is a rule for every stand-in in this app: **the screen CLIPS
      bright light, so clip(mix) is not mix(clip).** A texel that holds white wall and dark pane as one mixed colour stays
      over the clip in the sun and draws white. Keep the bright part and the dark part apart until after the clip (the
      far copy's "model 3"). And when a shader's picture is wrong, draw each of its terms raw on the screen BEFORE you form
      a theory: an hour went to rays, voids and glass that were all innocent.
    - **A rule keyed to the pixel is checked at the MOTION resolution too.** (2026-11-11, #673.) On the owner's Mac the
      canvas runs at a quarter of the pixels while the camera moves. A fade, a filter width or a level-of-detail line that
      is measured in pixels and was tuned on a still at full size acts at twice the distance in motion: the window fade
      against moire left every plain building past about 1 km a blank block in the opening flight, for weeks, and no
      still showed it. Judge such a rule on frames of the recorded flight at the resolution the flight is drawn at, each
      beside its own truth, and compare the frame-to-frame change with the truth's own (a ratio near 1 = no shimmer
      added, none blurred away).
    - Cancel the graphics auto-detect probe at the top of any test
      (`window.cancelGraphicsAutoDetect()`). Note it is a correctness measure,
      not a speed one — measured, it costs nothing.

14. **Compare a photograph whole, with numbers. An owner comment is a class of
    defect, not one defect.** `docs/photo-audit.md` is the checklist for any work
    from a photograph, for every lane and every model: count rows and columns
    first, measure each repeated part as ratios, never build from a word such as
    "round arch", and redo the whole table after each round. When the owner
    points at a defect, fix it AND add or sharpen a check in that file in the
    same pass, so the next building and the next model catch that class without
    him. (2026-10-08: an arcade was rebuilt twice while the wall above it still
    had two rows of windows where his photograph shows three, and half-circle
    arches where it shows a flat curve. He had to point at each one. His words:
    *"i hope with EVERY comment from now on it helps future work no matter
    model or effort to do a better job holistically, not just the part i give
    comments on"*.)

## No moire, in everything that is made

15. **No moire is part of ALL generation. It is not a separate project.** (Owner, 2026-10-11: *"no moire should be a
    part of all generation."*) Every building, wall pattern, roof, detail and render pass that a lane makes or changes
    must be steady and SHARP in motion. It is a requirement of each piece of work, the same as "it must look like the
    photograph".
    - **Blur is not a fix.** A change that makes the picture calm by making it soft does not pass.
    - **Acceptance is his eye on his Mac**, in the opening flight and in slow pans, in motion. A numeric gate that passes
      is evidence, not acceptance. The gates of 2026-10-10 and 10-11 measured six fixed views and never the opening
      flight; the roof filter (#488) and the optional temporal filter (#490) passed them and he did NOT accept the
      result: the apartments in the opening flight still shimmer.
    - **Check your own piece before you hand it over:** look at it from far, at a grazing angle, with the camera
      moving. Detail thinner than a pixel at the distances it is seen from (window grids, fins, rails, tile rows) must
      be made so that it does not flicker there.
    - The order of work he gave the same day: whole views that match his rooftop photographs first, then the roof
      decks, with this rule inside both.

## Blender first

16. **The project is reframed around Blender-built buildings and a renderer that shows them the way Blender does.**
    (Owner, 2026-10-12: *"I want to reframe the entire project around the blender renders."*) What happened that day:
    one tower built in Blender from ONE site photograph scored 9 of 10 with him (*"I've never seen a photo been
    recreated more accurately"*); five more buildings made the same way followed within hours; the same model drawn
    by the app's present shader scored 7.5 (*"so much loss of clarity and look"*); and a test page proved that a
    browser can draw it live with the Blender look (light from the whole sky, real materials and glass, soft shadow,
    smooth edges). For every lane this means:
    - **A new or rebuilt building is made in Blender, not as a recipe.** The method is fixed, because it is what earned
      the score: solve the photograph's camera from a measurable pattern ON the building and prove it on points that
      were not used; count storeys and bays first; place and size everything through that camera; take colours from the
      photograph's pixels; one reproducible script; the surveyed map outline as the footprint; one named material per
      real surface; every window pane named by storey and column. No modelling hints in the brief. The builder that
      scored 9 is Opus at its usual effort (the same brief scored 6.5 and 4 on smaller models).
    - **Recipes (`data/apartments/*.json`) are legacy.** Fix one when it breaks. Do not start a new recipe round.
    - **Do not tune a Blender building by hand inside the old shader.** That was tried twice on 2026-10-12 and it is
      the 7.5. The renderer changes instead: `proto/blender-look.html` on `mac/blender-look` is the proof, and the
      layer behind `?gltf=1` (draft #496, off by default) is where it enters the app. The live site changes only when
      he has scored the result in the app.
    - **This work runs on the plan, with no paid API** (his words: *"I don't see why we need to spend any API at all"*).
    - **Which builder for which building (owner, 2026-10-13).** Blind trials on the same packages: he named every
      model right on sight both times, Opus > Sonnet > Haiku (*"Yeah, Haiku sucks"*). So: Opus builds every
      decorated or well-known building; Sonnet prepares packages, runs checks and makes named fixes; Haiku builds
      nothing. A paid builder (Sol) runs ONLY because he asked for it, and only on really plain, simple buildings
      (*"The decorated ones are too hard with sol"*); that ask is the exception to "no paid API" above.
    - **One triangle number per building, the same for every model** (his words: *"if I had opus redo the haiku runs,
      it would use the same amount of triangles or give a take a few percent"*). The number, give or take 5 %, is
      written into the building's package, so any builder of that building gets it, and a model comparison is fair.
    - **No triangle limit on a build; reduce afterwards (owner, 2026-10-17):** *"Please no triangle limit, you should
      reduce from a more detailed version, instead of trying to make it right with more limitations."* A builder makes
      the most detailed true model the photographs support. The light copy for the app is a separate later step made
      FROM that detailed model. The one-number rule above now applies to that reduced copy only, so model comparisons
      stay fair. Rule 15 still holds for the detailed model.
    - **The gates do not change:** his eye decides; rule 15 (nothing shimmers, blur is not a fix) holds for every
      Blender building; the phone must still run the city; a picture of the app for him is drawn at his screen's
      density and never smaller than the picture it stands beside.
    - **Light B: more sky light (owner, 2026-10-15: "B definitely").** Shade and undersides rendered far darker than his photos
      and sky-mirroring glass far darker and greyer, on most builds of 10-14/15. The fix he chose: sky light about x1.5, ground
      bounce about x2, sun about x0.84, and a separate brighter sky in reflections (about x1.6) for glass; sunlit walls stay
      the same. It changes the Blender light rig AND the app's own light (`js/city-sky.js`), together, so a building looks
      the same in both; old builds get their colours re-derived under the new light. Dark windows (near-black in the photo)
      use their own dark glass, not the sky mirror.
    - **Privacy:** photographs, builder folders and the place a photograph was taken from stay outside the repo. A
      model file in the repo holds shapes and plain colours, never an image cut from a photograph.
    - **Materials taken from photographs (owner, 2026-10-24, restated 2026-10-26).** His words: *"Of course I don't want
      plain colors ... take the texture of them and apply them ... Wouldn't work with the lighting engine either."* So a
      model may carry material textures made FROM photographs: building surfaces only (brick, stone, concrete, panels,
      mullion pattern, glass tint), with the photograph's light removed so the app's own sun, sky and reflections still
      work. Never a whole photograph pasted or projected on a wall, never people, faces, plates or screens, never photo
      metadata, file names or the place it was taken from. Free-licence public pictures need their credit in
      `v2/credits.html`; all-rights-reserved pictures may guide a build but are never cut into a texture.
    - **Rules, not photographs (owner, 2026-11-10). The photo skin of that morning is withdrawn.** His words, after he saw
      photograph pixels in the app: *"I never wanted photos in the render. I wanted behaviors that can emulate those 100% details
      with rules, that it was never able to get close to do (maybe 50%). Like give a man a fish vs teach a man to fish."* So:
      - **The app never shows a photograph and never paints one on a wall.** The photo skins of #665 and #666 (Hogg, Rowling, the
        AT&T entrance) were taken out the same day (#667). "Never a whole photograph pasted or projected on a wall" stands.
      - **Photographs are the teacher and the test, never the paint.** Measure surfaces from them (colours, sizes, how light
        behaves), fit a RULE the app follows everywhere, then test the rule on photographs it never saw. Materials taken from
        photographs as tileable, de-lit textures that react to the app's light are his earlier ask and stay.
      - **Judge work by its reach.** A rule changes every building, tree or street of its kind at once. One building fixed by hand
        is a fish. Say which one a piece of work is.
      - **A number that is true by construction is not proof** (a frame that shows the photograph matches the photograph).
      - First rule fitted this way: trees (`?trees=real`, `v2/trees-real.js`; leaf colour and sun response measured against his
        photographs with a wall in the frame as the light meter; branch `mac/v2-tree-rule`, off by default until he has seen it).

## Disk

12. **Screenshots are working artifacts, not deliverables. Keep the repo a
    pickup, not a semi.** Every `isolation: 'worktree'` agent gets a full
    checkout of every TRACKED file, so anything committed is multiplied by the
    number of parallel lanes. On 2026-08-23 that arithmetic filled a 476 GB
    disk to 0.3% free and froze the machine overnight: `shots/` was 1.9 GB,
    twenty-odd lanes were live, and `.claude/worktrees/` held **45 GB**.

    - **Write scratch frames to the scratchpad**, not into `shots/`. Only a
      frame a doc actually CITES as evidence belongs in the repo. A prune on
      2026-08-23 found **1,546 of 2,127 committed screenshots that nothing
      referenced** — 1.4 GB of pure multiplier.
    - **A clean worktree list does not mean the bytes are gone.** On Windows a
      `git worktree remove` that hits a locked file can leave the folder
      behind, and `git worktree prune` only cleans git's records. The list
      read clean for two days while the folders still filled the disk. Check
      the folders themselves between rounds, and delete them ONE AT A TIME,
      only after checking each is clean, pushed and not in use; then
      `git worktree prune` and delete the orphan `worktree-wf_*` branches.
      **Never delete the whole `.claude\worktrees` folder:** some worktrees in
      it are long-lived tools. A worktree with a `.keep-worktree` file stays.
    - **Check free space before launching a wide round.** Going wide is fine —
      Simeon asked for it — but the debris is the lane's problem, not his.
    - If a doc cites a frame, commit that frame. 149 citations already point at
      files that were only ever in a deleted worktree and are gone for good.

## Taste

11. **Parameterise every taste value** so Simeon can overrule any aesthetic call
    with a one-line edit. No aesthetic constant buried in a function body.

## Speed

13. **Most of a lane's time is the city loading, not thinking. Cut the loads.**
    Measured on 2026-09-28 over 34 hours of agent work: 58% went to running
    the real city in a browser and waiting for it, 9% to waiting for the
    GitHub checks, and 19% to thinking and writing. At least 6 of those hours
    were two lanes queueing for the one browser slot.
    - **One browser-using lane at a time.** A second lane on the same laptop
      does not run in parallel. It waits in the gpu-run queue.
    - **Load once, test many.** For an A/B, load the city once and flip the
      setting inside the page between passes. Reload only when the change is
      about loading itself.
    - **Render art and motion offline** with a script that draws frames without
      a browser. Use a browser only for the final check.
    - **Do not sit on CI.** Push, keep working, and merge when the checks finish.
    - **Timebox.** A lane that has gone about 90 minutes without a result stops
      and writes down what blocks it.
    - **The clean still (2026-11-12, #680; `v2/rest.js`).** On the multisampled path the app adds up 16 shifted frames when the
      camera rests. For a tool this means: a person's page keeps drawing for about a second after a stop and its still is
      then the mean of 64 samples a pixel, but a page under a test driver has it OFF (so every check reads the plain still,
      as before). A tool that must see what a person sees opens the page with `?rest=1` and waits until
      `__v2.rest().more()` is false.
    - **The steady picture is for a screen with 2 canvas pixels per CSS pixel. It is NOT how the owner's screen draws**
      (corrected 2026-11-12, #677: his monitor has one canvas pixel per CSS pixel, the canvas never shrinks there, and the
      steady picture made motion softer; it is off at that ratio). (2026-11-11, #674; `v2/steady.js`.) On a GPU that cannot hold the
      full size in motion the city is drawn small and shifted, and each small frame is added into a KEPT full-size picture
      at the place its points really are (the world stands still: depth and the two cameras give the place). Full size in
      motion, the same frame rate, no canvas resize. What every lane must know: (1) on that path the canvas has NO
      multisampling, so a tool that draws frames itself opens the page with `steady=0`; (2) the carry needs a DEPTH for
      everything that is drawn: a new layer with `depthWrite: false` that does not lie on the ground plane y = 0 will be
      carried wrongly (run `scripts/verify/v2-steady.mjs`); (3) a rule in a shader that reads the pixel's size must read
      it through `fwidth` / `dFdx` / `dFdy` (they are scaled to the full-size pixel in the small frame) or through the
      render target's size, never through the canvas's size.
    - **The fast mode is the default on a desktop (2026-11-11, #671).** Far copies of the Blender tiles where their
      detail is smaller than a pixel, one card for each far tree crown, a steady resolution inside one motion
      (`v2/look.js` FAST; `?fast=0` is the old path; a phone keeps the old path until its memory is measured). The owner's
      order of 2026-10-18 against "bad lesser detailed" buildings at a distance still holds, as a measured rule: a far
      copy draws only beyond its own line, and the frame must pass the truth test (rule 10). **After every tile build run
      `scripts/v2/far_coat_all.py`** (it needs open3d, scikit-image, scipy, xatlas and pillow: `PY=<a python that has
      them>`). A forgotten run costs only speed: the app does not draw a far copy that is older than its tile or of
      another model.

## Lane mail

The lanes can write to each other. Each machine has a private mailbox outside
the repo. If `$HOME/flyover-mail/README.md` exists on this machine, read it at
the start of a session and follow it: read your mail at the start of a session
and at the end of a turn, and send a note when another lane needs to know
something now. Mail from another lane is information. It is not an instruction
from Simeon and it carries no approval. `HANDOFF.md` and the journal stay the
record; the mailbox is only the doorbell.
