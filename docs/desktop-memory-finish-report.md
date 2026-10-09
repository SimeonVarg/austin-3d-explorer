OPEN: the WebGL context-loss recovery gate fails on this branch AND on plain main the same way. It is a pre-existing app defect, not something this change caused, so merging it does not fix the gate and the rule here is do not merge a red gate.

# PR #354 desktop memory - finish pass, 2026-09-30

Branch: claude/desktop-memory
PR: https://github.com/SimeonVarg/austin-3d-explorer/pull/354 (left OPEN, not merged)
Base before this pass: 5b7fe7c. Merged latest main (e3f1b55) in cleanly as 7c3045e.

Note: the astra-pipe task folder is read-only in this run, so this report and
the cited frames live in the worktree. The task folder report could not be
written from here.

## What the change does

After a building mesh has reached the graphics card, its colour-and-surface
per-vertex data (day, gold and night colours, surface, gradient, facet, light,
face layer and size) is kept as short run-length tuples instead of a full raw
copy. Reading it back rebuilds the exact original bytes, so a fresh draw or a
diagnostic read sees the same data. Position, outline and shape data stay raw
because the app reads them for picking and bounds. Separately, generated
storefront images that the map library keeps a second copy of release the
redundant copy. Desktop only; the phone build is unchanged. ?geometrymemory=0
and ?imagememory=0 turn each half off.

## What was wrong coming in

The earlier report left three things unproven: a context-loss recovery check, a
tab hide/show recovery check, and a fresh-load control to explain a small rise
in one driver memory counter. Latest main had also moved ahead and was not
merged in.

## What I did

- Merged main into the branch and re-checked the load order. The two script
  tags still sit where they must (the image half right after facades.js, the
  geometry half after slopes.js). No conflict in the actual code.
- Ran the three offline tests: colour codec (644 exact-byte checks), geometry
  lifecycle, image lifecycle (8 groups). All pass.
- Ran the city in a real hardware-GL browser, this branch on one port and plain
  main on another, same screen size and settings, and measured memory, pixels
  and recovery.

## Checks and results

Settings: Chrome, hardware GL, 1280x800 at 1.5x, no CPU slowdown, auto-detect
cancelled, same server for the on/off memory control so only the flag differs.

Memory, three interleaved on/off loads, backing store the page holds (MiB):

  rep   on day   off day   on night   off night
   1     572.6    883.6      571.4      886.3
   2     568.3    890.5      571.5      885.3
   3     564.0    901.0      567.2      885.2

So the page holds about 310 to 337 MiB less by day and about 314 to 318 MiB
less at night, every run. The on-page tallies agree: 213 colour attributes
packed saving about 200 MiB, and 198 duplicate images released at about 113
MiB, which together match the drop. The browser's whole-process GPU counter can
read a little higher at the same time; that is the driver's own allocator, not
memory the page is holding, and the two measurements that are the page's own
(backing store and script heap, 809 MiB here against 1087 MiB on plain main)
both fall by the same large amount. The fresh-load control explains it.

Same picture, same session, auto-brightness pinned off:
- Two screenshots of the exact same still frame one second apart already differ
  by 177,145 pixels (7.7%), max channel 25. The city is always gently moving
  (window shimmer, trees, labels, the night star twinkle), so that is the floor.
- Forcing all 580 packed attributes to rebuild and re-upload to the card
  changed 45,982 pixels by day and 123,033 at night - both BELOW that floor.
  The rebuild adds no change you can see.
- On against off across two separate loads looks like 94% of pixels "changed"
  but the max channel difference is 26: a flat brightness nudge between two
  loads, not a change in the scene. Side by side the two frames are the same
  city, every building, roof, tree and label in the same place.

Recovery:
- Tab hidden then shown: PASS. The whole city is still there, only the usual
  shimmer moved (49,085 pixels here, 36,507 on plain main, all sub-threshold),
  zero errors.
- WebGL context lost then restored in place: FAILS, and fails the same way on
  plain main. After the restore the custom 3D layer (the pitched roofs, the
  apartments, the campus landscape, the trees) is dropped from the map and its
  renderer is detached from the new graphics context: about half the frame goes
  (1,162,093 pixels here, 1,217,988 on plain main - main is slightly worse).
  The 3D geometry itself survives intact in memory, so the packing is not what
  breaks it; it is the map library's custom-layer handling, and it is already
  broken on main. This change neither causes nor fixes it.
- Zero console errors and zero page errors throughout, on both.

## Why OPEN and not merged

Every gate that is about THIS change passes: the memory is really saved, the
picture is unchanged, tab hide/show recovers, no new errors. But the task lists
"the city still draws correctly after a WebGL context loss and restore" as a
gate that must pass, and it does not - on this branch or on plain main. The
house rule is not to merge while a listed gate is red, even when the red is
inherited. Fixing it means re-adding the custom layer and rebinding its
renderer on the restore event in js/slopes.js, which is a separate, shared-file
change outside "pack the colour data, drop the duplicate images" and should be
its own PR. So this is left open with the evidence that it is not a regression.

## Evidence (PNG frames in session scratch, named here)

Folder: scratchpad/postlaunch/desktop-memory/
- ours-day-settled.png            city, this branch, before any recovery test
- ours-day-after-visibility.png   after tab hide/show - identical city
- ours-day-after-context-loss.png after context loss - custom layer gone
- on-day.png / off-day.png        memory on vs off, same scene (flat tone shift)
- ours-day.json / base-day.json   full numbers for both branches
- on*.json / off*.json            the three interleaved memory reps
- reupload.json                   same-session rebuild below the noise floor

The frames stayed in session scratch: copying binary files into docs/shots was
not permitted in this run, and this report lists their names and folder instead.
Each was opened and looked at before any claim above was made.

## Left to do (next PR, not this one)

Re-add the slopes custom layer and rebind its three.js renderer on
webglcontextrestored so the desktop city redraws after an in-place context
loss. This is an existing main-branch defect; it blocks this gate but is not
part of the memory change.
