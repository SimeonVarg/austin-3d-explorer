# QUEUE

Work that is agreed and specified but not started. Anything in here should be
pickable up by any lane without asking Simeon a question first — if it needs a
decision from him, it does not belong here yet.

Ordered by value. Take from the top.

---

## 1. Verify suite on GitHub Actions, triggered from your phone

**Why:** the only real benefit a cloud box would have bought is getting the suite
off your laptop, and Actions does that for free. See `docs/CLOUD.md` §4. A job
cannot be left running, so there is nothing to forget and nothing to bill.

**What:** `.github/workflows/verify.yml`, `workflow_dispatch` so it is a button
in the GitHub mobile UI — copy the shape of `build-data.yml`, which already
carries the "Phone-friendly: trigger this from Kiro / the GitHub mobile UI"
comment.

- `ubuntu-latest`, GitHub-hosted. **Not** self-hosted — this repo is public and a
  self-hosted runner would let a stranger's pull request run code on your machine.
- `CHROME_PATH=/usr/bin/google-chrome`; `chrome.mjs` already probes that path, so
  no code change is needed.
- `python -m http.server 8123` and `VERIFY_URL=http://127.0.0.1:8123` — the
  README records that three agents once served on 8099 from different worktrees
  and requests went to whichever bound first.
- Matrix-shard the scripts so they run in parallel. Wall clock becomes the
  slowest single script rather than the sum.
- Upload `scripts/verify/shots/` as an artifact, and put the pass/fail table in
  the job summary so it is readable on a phone without downloading anything.

**Blocked on:** the "page is not defined" regression — 15 scripts still crash
instantly. Wiring broken scripts into CI just teaches you to ignore red builds.
That fix is the Mac lane's.

**Check first:** the free plan caps concurrent jobs (commonly cited as 20). Do
not design a 40-way matrix before confirming it.

---

## 2. Point the timing scripts at hardware GL and re-run every A/B

**Why:** `chrome.mjs` now supports `VERIFY_GL=hardware`, but the 17 `*-perf`
scripts that were silently running on the CPU renderer have never produced a
trustworthy number. Every frame-time comparison in `HANDOFF.md` that came from
them is suspect.

**What:** add `gl: 'hardware'` (or run with `VERIFY_GL=hardware`) to each of
`arts-perf`, `drag-perf`, `facade-perf`, `ground-perf`, `ground-tex-perf`,
`moody-perf`, `outer-perf`, `perf`, `perf2`, `perf3`, `post-perf`, `roof-perf`,
`roofscape-perf`, `stadium-perf`, `tower-perf`, `westcampus-perf`, `light-perf`.
Then re-run the A/Bs that decided something and correct any conclusion that
changes. Note in `scripts/verify/README.md` that a headed run now defaults to
hardware.

**Do not** switch the ~100 pixel-assertion scripts. Measured: hardware and
software renderers differ on 26-42% of pixels, worst channel delta 192/255.

---

## 3. Name the remaining buildings from a real source

**Why:** 2,069 of 2,453 buildings have no name.
`scripts/name_buildings.py` already exhausted every offline source in the repo
and recovered 32. OpenStreetMap is mined dry — a different source is the only way.

**What:** scrape UT's official building directory
(`utdirect.utexas.edu/apps/campus/buildings`) and the Wikipedia list of UT
buildings. Firecrawl's free tier covers the fetch (YC student deal). The actual
work is matching directory entries to footprints by address or coordinate, which
no tool does for you. Write results into `data/building_names.json`, which
`js/app.js` already reads at load — **not** into the snapshot, which a re-bake
would wipe.

---

## 4. Two roofs are buried inside their own buildings

**Why:** `scripts/reseat_authored_roofs.py` reports them and deliberately refuses
to move them, because lifting a roof on a guess is how you end up putting DKR's
deck on top of a floodlight mast.

**What:** an unnamed building (`3fb4507f`) is 12.00 m buried and the Austin
Recreation Center 6.35 m. Work out why — most likely `final_height` changed under
a roof baked against the old value — and fix the cause rather than the symptom.

---

## 5. The zoom-change shimmer

**Why:** capping every patterned source at `maxzoom: 16` fixed the flicker while
flying (WASD is now at the floor), but a pure zoom change still crawls — 38.3%
against a 26.2% floor. Q/E shimmers while held.

**What:** the fade is driven by the display zoom crossing an integer, not by
which tile the geometry came from, so a source setting cannot reach it. The
plausible fix is two pattern tiers switched by zoom — a softened tile on a far
layer, the sharp one on a near layer. Costs about ten more atlas images and the
per-image repaint recurs on every time-of-day step, so measure before committing.

---

## 6. Split HANDOFF.md

**Why:** it is ~91 KB and every session reads all of it. Simeon has already
approved this as an idle-time chore.

**What:** a short current-state file plus `docs/JOURNAL.md` for the history.
Keep the hard-won rules (the numbered list at the end) in the short file — those
are the part that stops mistakes repeating.
