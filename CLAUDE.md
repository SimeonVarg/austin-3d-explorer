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
   and the same discovery was written into `HANDOFF.md` twice from two machines.
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
4. **Docs-only commits** (`CLAUDE.md`, `HANDOFF.md`, `docs/`, `QUEUE.md`,
   `MAC_QUEUE.md`) may go straight to `main`. Always pull before pushing.
   **Code goes through branches and PRs** — the PR is the record of why, even
   when you merge it yourself five minutes later.
5. **Pull latest `main`** at the start of every session and before every new
   task, and reread this file and `HANDOFF.md`.
6. **When Simeon tells you something both machines should know about the
   project, write it into this file and push immediately** so the other lane
   sees it. Personal context about Simeon goes in local memory, never here.
7. **When you finish a pass, record what you did and the branch name in
   `HANDOFF.md`.**
8. **File-ownership lanes.** Before touching a file that another lane's open PR
   touches, say so and pick a different task. With self-merge this matters more,
   not less — the other lane can no longer rely on a human noticing the clash.

## The one thing to escalate

9. **Ask him about taste, decide everything else yourself.** If the question is
   "should the city look like this?", show him and let him choose. If the
   question is "is this correct, is this fast, is this the right structure?",
   that is yours — make the call, write down why, merge it. Handing back an
   execution decision he already delegated wastes the delegation.

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
    - Cancel the graphics auto-detect probe at the top of any test
      (`window.cancelGraphicsAutoDetect()`). Note it is a correctness measure,
      not a speed one — measured, it costs nothing.

## Taste

11. **Parameterise every taste value** so Simeon can overrule any aesthetic call
    with a one-line edit. No aesthetic constant buried in a function body.
