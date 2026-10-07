# Journal index

The history that used to live in `HANDOFF.md`, moved byte for byte on 2026-10-04
(the old file was 2.1 MB and nobody could read it). `HANDOFF.md` is now the short
current-state file; read it first.

How the files are cut:
- One file per month, split into `-pN` parts when a month passes about 380 KB.
- Entries are placed by the date in their heading; an undated section follows the
  next dated one. Inside each file entries keep the old file's order, which was
  not strictly chronological, so search by heading, not by position.
- `journal/_manifest.tsv` maps each old section to its file, so the original can
  be rebuilt. `python scripts/split_handoff.py <old HANDOFF.md> --verify` checks it.
- Old references such as "HANDOFF #68" or "HANDOFF section 8" in code comments and
  docs point into these files: grep the number or the heading.

New entries: add a dated entry at the top of the current month's file
(`journal/2026-10.md` for October). Start a new month file when the month turns.

- [`2026-07.md`](journal/2026-07.md) - 1474 lines, 90 KB
- [`2026-08-p1.md`](journal/2026-08-p1.md) - 6085 lines, 371 KB
- [`2026-08-p2.md`](journal/2026-08-p2.md) - 6623 lines, 379 KB
- [`2026-08-p3.md`](journal/2026-08-p3.md) - 6200 lines, 369 KB
- [`2026-08-p4.md`](journal/2026-08-p4.md) - 6368 lines, 376 KB
- [`2026-09-p1.md`](journal/2026-09-p1.md) - 5405 lines, 377 KB
- [`2026-09-p2.md`](journal/2026-09-p2.md) - 1707 lines, 171 KB
- [`2026-10.md`](journal/2026-10.md) - 106 lines, 6 KB
