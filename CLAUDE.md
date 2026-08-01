# CLAUDE.md — conventions for every lane

Shared working agreement for all AI sessions on this repo. Read this and
`HANDOFF.md` at the start of every session and before every new task.

This file is public. Personal context about Simeon lives in each machine's local
memory and is never written here, in any tracked file, or in a commit message.

## Lanes

1. **Two machines, one lane each.** The Acer works on `acer/*` branches, the Mac
   on `mac/*`, cloud sessions on `cloud/*`. **One session per machine** — no more
   five-worktree fan-outs. Quality was mid and the machine choked.
2. **Nobody merges their own PRs.** Simeon merges, one at a time.
3. **Docs-only commits** (`CLAUDE.md`, `HANDOFF.md`, `docs/`) may go straight to
   `main`. Always pull before pushing. **Code goes through branches and PRs.**
4. **Pull latest `main`** at the start of every session and before every new
   task, and reread this file and `HANDOFF.md`.
5. **When Simeon tells you something both machines should know about the
   project, write it into this file and push immediately** so the other lane
   sees it. Personal context about Simeon goes in local memory, never here.
6. **When you finish a pass, record what you did and the branch name in
   `HANDOFF.md`.**
7. **File-ownership lanes.** Before touching a file that another lane's open PR
   touches, say so and pick a different task.

## Verification

8. **Verify by looking, not by reasoning.** `scripts/verify/README.md` is the
   law — every timing trap in it is a real incident that cost real hours.
   - Screenshot twice, trust the second.
   - Take the minimum of interleaved reps, never the mean.
   - Cancel the graphics auto-detect probe at the top of any test
     (`window.cancelGraphicsAutoDetect()`).

## Taste

9. **Parameterise every taste value** so Simeon can overrule any aesthetic call
   with a one-line edit. No aesthetic constant buried in a function body.
