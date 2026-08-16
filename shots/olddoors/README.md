# shots/olddoors — the five pre-Gilbert doors, before and after family V

HANDOFF §149. Six poses: the four family-V buildings (ANB 1859, JHH 1888 x2,
LFH 1894, GEB 1904) plus **LCH as the control** — LCH is dated 1894, keeps the
E5 null door on purpose, and its before/after frames are byte-identical.

- `ab-*.png` — before | after, cropped to the doorway. Read these first.
- `before/`, `after/` — the full 1440x900 frames and their manifests.
- `_noise/` — a REPEAT of `before/` on the identical tree. **Read the noise
  floor before quoting any percentage from this directory**: three of the six
  poses disagree with themselves on 24-46% of the frame. Only ANB and JHH-202,
  the two worst, are kept here; the other four repeated at 0.000%.

Every frame: three-quarter view, 22 m standoff, **eye at 1.70 m**, tod 0.30,
graphics auto-detect cancelled. Poses carry a sightline check — the standing
point is walked to the door in 0.5 m steps and rejected if any step lands
inside a footprint that is not the host.
