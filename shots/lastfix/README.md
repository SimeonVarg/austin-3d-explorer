# `shots/lastfix/` — QUEUE R3 and R5, 2026-08-17

Full working: `docs/entrances/doorway-claim.md`. HANDOFF §163.

`before-345-621/` and `after-345-621/` are `doorstack.mjs` at **1.70 m** of eye
height, five bearings, on the SAME served tree with only `data/entrances.geojson`
swapped. Per bearing: `-both` is what ships, `-onlyA` is eid 345 drawn alone,
`-onlyB` is eid 621 drawn alone.

- **`before-*/B250-both.png` vs `after-*/B250-both.png`** is the frame that kept
  `BURIED_DOOR_CLAIM` switched OFF: the fix works, but it turns Moncrief-Neuhaus's
  four-leaf main portal into a single leaf and it reads thin here.
- **B332 and B070 go the other way** — the after is cleaner at both.
- `B152` is deleted: under 600 px in both arms, the camera is looking at nothing.
- `B232` disagreed with itself between two launches (44,372 px and 562 px) and is
  quoted with that caveat.
- The `-none` control frames (all entrance layers hidden) are deleted to keep the
  commit small; `_manifest.json` carries every pixel count measured against them.

`pinch/` is `pinch-alt.mjs` at 393x852: the phone frame, and `_pinch.json` with
the four driven gestures that closed Y10 item 6 as a non-defect.
