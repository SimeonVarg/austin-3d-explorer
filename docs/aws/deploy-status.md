# Deploy status before the AWS recording

Written 2026-08-06, ~23:00 UTC, Acer lane. **Read-only report — nothing was
changed, committed, pushed or merged.** Established with `git`, `gh`, `curl` and
the Vercel read API only. **No browser was opened**, so nothing here is a claim
about how the app *looks* or how fast it *loads* — only about what is deployed.

---

## The headline

**Yes. The live site is exactly `main`.** Proven twice, independently, not
inferred.

**Proof 1 — the deploy says so.** Vercel project `fly-over-utx`
(`prj_Nii0xQHDdhg7JM492fNSZX4ubDRM`), current production deployment
`dpl_4RfgMe6coZALEB9cr3y5zh7vUuTU`, state `READY`, target `production`, and its
recorded commit is:

```
0c27b7f91f65174cd4154126b1468c6de650be64   ("The Drag has two candidate walls…")
```

That is character-for-character the tip of `origin/main` right now. It came in
through the GitHub integration on branch `main` (`githubDeployment: 1`), so the
site auto-deploys on every push to `main` — this is not a hand-uploaded copy that
could silently fall behind.

**Proof 2 — the bytes match.** Every front-end file was pulled off
`https://flyover-utx.vercel.app/` and MD5-compared against the same file read out
of `origin/main` with `git cat-file`:

```
32 files checked   0 mismatches
```

That is all 26 files in `js/`, plus `index.html`, `style.css`,
`data/manifest.json`, `data/heroes.geojson`, `data/drag.geojson`,
`data/entrances.geojson`. Including `docs/camera/facade-choice.md`, which exists
**only** in the newest commit — so the deploy is provably at the tip, not one
commit back.

`flyover-utx.vercel.app` is the URL to record. It is a real domain on the
project, it is public, and it is serving `main`.

---

## The GitHub Pages trap: checked, and it is NOT a trap today

The repo does contain `.github/workflows/deploy-pages.yml`, and a **second live
public copy really does exist** at `https://simeonvarg.github.io/austin-3d-explorer/`.

It is **not stale**. Same test, 29 files, 0 mismatches against `origin/main`.
Its deploy for the current commit ran at 09:31 UTC today and passed in 4m06s.

So there are two live copies and both are current. The risk is only in the
future: if a Pages run ever fails while Vercel succeeds, the two drift and
nothing announces it. Record from the Vercel URL and that cannot bite you.

The other Vercel domains — including the branch preview for the un-merged
decision branch — all return `302` to Vercel SSO. They are login-gated, so nobody
can stumble onto the experimental walls. Good.

---

## Workflows: all green

Last 15 runs across all four workflows: **every one succeeded.** No red.

The `build-tiles.yml` after-midnight failure recorded in HANDOFF §39 did not
recur — its last run was 2026-08-04 and passed. `deploy-pages.yml` has passed on
every push to `main` for the last four days.

---

## What is sitting unmerged

**Nothing user-visible is stranded.** I checked every remote branch that is ahead
of `main`, not just the ones with open PRs. Twenty branches are "ahead", but
nineteen of them are ahead by exactly one automated
`Add YYYY-MM-DD snapshot of Austin building data` commit that the data-pipeline
bot pushed onto whatever branch was checked out that day. **None of them carries
any unmerged `js/`, `index.html`, `style.css` or scene data.**

The two open PRs:

- **PR #164 — the decision branch.** Deliberate. Holds the two candidate walls
  for the Drag (`js/drag.js`, `scripts/bake_drag.py`, `data/drag.geojson`). Even
  if it *were* merged, the candidates only activate with a `?cand=` URL flag —
  the shipping city is untouched by design. Nothing here affects the recording.
- **PR #5 — dead.** Opened 2026-07-10, targets branch `add-plan` (not `main`),
  and GitHub reports it `CONFLICTING`. It is documentation, it is nine months of
  drift from reality, and it has no path to merging. Worth closing, but not now,
  and it changes nothing on the tape.

**One loose end worth knowing about (harmless on camera).** Today's building-data
snapshot, `2026-08-06`, landed on the decision branch instead of `main`, because
the bot pushes to whatever branch fired it. The live site therefore loads the
`2026-08-05` snapshot — one day old. **This is invisible in the recording**: the
"Data snapshot: …" line was deliberately removed from the HUD, and the app never
prints the date anywhere else. The only real consequence is that data freshness
stays parked until that branch is resolved.

---

## What is actually on the tape — the last 12 things that shipped

Newest first. Plain English, one line each.

1. **You can walk.** The camera floor dropped from 18 m to 1.7 m, so you can
   stand on the South Mall instead of hovering three storeys up. (#159)
2. **The night sky stopped being painted over the buildings.** Stars and clouds
   used to draw straight across solid brick — 51% of a wall at one pose. Now they
   sit behind the city where they belong. (#160)
3. **The night street is lit again.** At walking height the road had gone almost
   black because the light pools shrank to a fixed pixel size. The carriageway
   went from darker than the frame to brighter than it. (#161)
4. **You stop when you reach a tree.** 7,559 trunks you used to walk straight
   through are now solid. Canopies stay walk-through on purpose, so tree-lined
   paths still work. (#162)
5. **The Drag's walls, measured.** No visual change — this pass proved the close-
   up wall comes from a different layer than everyone assumed, which is why the
   earlier fix plan would not have worked. (#163)
6. **Every UT building now has a real founding year**, straight from UT's own
   register — 198 codes, so the architecture eras stop being guesswork. (#158)
7. **Grayson House stopped looking see-through.** It never was; the camera was
   standing inside its neighbour. (#155)
8. **The black tower beside the lit ones** turned out to be two parking decks,
   not a broken building. (#154)
9. **All 24 West Campus lobbies photographed**, day and night. (#153)
10. **One label per shop**, instead of the same tenant named twice. (#152)
11. **Secrets can never reach the public repo** — `.env` and scraper config are
    now ignored. (#157)
12. **The lobby guard broken four ways on purpose**, to separate real failures
    from ones that were just the old 18 m camera floor. (#156)

The last commit on `main` (the one deployed) is documentation and screenshots
only — the decision sheets for the Drag wall. **It changed nothing visual.**

---

## Everything the site asks for actually exists

I pulled every `data/…` path referenced anywhere in `js/` or `index.html` off the
live site — 33 paths. **32 returned HTTP 200.** The one 404, `data/dkr_aerial.png`,
is a false alarm: it appears only inside a code comment in `js/facades.js:364`
citing where a colour was sampled from, it is gitignored on purpose (7.3 MB bake
input), and nothing fetches it. **No missing assets.**

Spot-checked and serving fine: `austin.pmtiles` (744 KB), the enriched buildings
file (1.4 MB), `roads.geojson` (3.9 MB raw). Brotli compression is on for all of
them. Cache policy is `public, max-age=0, must-revalidate`, so a reload
revalidates rather than re-downloading — fine for a recording.

---

## The one outside dependency, and it is up

The basemap under the city is **not ours**. `js/app.js` loads its style from
`https://tiles.openfreemap.org/styles/liberty` — a free third-party host. If that
host is slow or down while you are recording, the ground goes with it and there
is nothing in this repo that can save it.

Checked just now, three reps, minimum taken (instrument: `curl`, no throttling,
this laptop, warm network): **HTTP 200, 0.096 s, 43 KB.** It is healthy right
now. Re-check it five minutes before you hit record — it is the single thing in
the stack you do not control.

---

## What I could NOT establish

Say these out loud rather than assuming them:

1. **Whether the app actually renders correctly.** No browser was opened this
   session — another agent had it. Byte-identical files prove the *right code* is
   deployed; they prove nothing about what it draws.
2. **Load time and frame rate.** Not measured. `QUEUE.md` K1 still reads
   *"nobody has measured frame rate or load time in about thirty-five merges"*
   and that is unchanged.
3. **iPhone / real Safari.** Untested and untestable from here. Chromium device
   emulation is not iOS Safari — different memory limits, different WebGL, no
   thermal throttling. Simeon's own phone test on 2026-08-04 is still the best
   evidence: *performance great, looks amazing, boost button visually off.*
4. **The known-open visual defects**, which are recorded but were not re-checked
   today and are presumably still on the tape:
   - `QUEUE.md` Y5 — the wall above the Drag's shopfronts reads as a barcode at
     eye level. **This is the one blocked on your choice.** At flyover height it
     does not show.
   - Y4 — you still cannot look down at your own feet (pitch floor).
   - Y6–Y14 — open, including labels sized by zoom rather than metres and dusk at
     eye level.
   - From the older list: the DKR Longhorn logo, the UT Tower night flood, and
     the graphics auto-detect sticking on "performance".

**Bottom line for the recording: the deploy is clean and current. The risks are
in what the camera sees at eye level, not in what is deployed.**
