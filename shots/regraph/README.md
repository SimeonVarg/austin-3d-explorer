# `shots/regraph/` — eid 292 on DKR, and why it was called dark

Branch `acer/o5-regraph`, 2026-08-16. Server `python scripts/serve.py 8521`
from a throwaway worktree. `harness-drift.mjs` PASS (29/29) before any frame.

## The folders

| folder | instrument | what it is |
|---|---|---|
| `dkr292/` | `scripts/verify/doorwalk.mjs` | a 12-bearing orbit at walking height, plus a look-down. Frames only, no A/B. |
| `dkr292b/` | `scripts/verify/doorwalk.mjs` | the two close bearings and the look-down |
| `px292/` | `doorpx.mjs` (here) | the layer-toggle A/B that actually answers the question |

## `doorpx.mjs` lives here and not in `scripts/verify/`

A red-gates lane owns `scripts/verify/` this round, so this pass could not add
to it. It imports `playwright-core` out of `scripts/verify/node_modules` by
path. Move it into the suite when that lane is done.

**It carries the traps this week paid for**, and they are not optional:

* `?drift=0` — the idle cinema creeps the time of day after 25 s of silence,
  and a moving sun changes every pixel in the box.
* It **waits for `austin-entrances` to report LOADED** and prints how long that
  took. A frame taken before the 6.7 MB file lands is a blank wall that reads
  exactly like a missing door; that race invented 447 phantom pixels once.
* `cancelGraphicsAutoDetect()` before anything else.
* One forced `applyTimeOfDay(m, 0.30)` per pose, because auto-exposure gain
  persists across poses and `aeMeter` only re-meters inside `updateSky`.
* **Noise floor first, per pose.** Every pose shoots `on -> on` with nothing
  changed in between before it shoots `on -> off`. A door count is only read
  against its own pose's floor, never against zero assumed.

## The finding

`docs/entrances/relocated.md` Rank 2 recorded eid 292 as dark from both
bearings at 15 m and at 22 m, on `main` and on the pre-NB2 file, and blamed the
stadium's authored wall.

It is not dark. It is nonzero from **both** opposing bearings at walking
height, each against its own noise floor of 0:

```
  pose               bearing  eyeAlt   door px over24   floor
  292-fromWSW-18m       76      1.70          1,341        0
  292-fromENE-18m      256      1.70            139        0
  292-fromWSW-12m       76     67.00              0        0
  292-fromENE-12m      256     67.00              0        0
```

`292-fromWSW-18m-on.png` vs `-off.png` shows the stoop and the doorway
appearing and disappearing. The ENE reading is a tenth of the WSW one because
from that side the pier immediately east of the leaf hides most of it.

The reason the earlier reading was zero is the aim, not the door. The
instrument aimed along the **building's** outward normal (the stadium's north
wall faces about 337°) and the **door's** own leaf normal is about 256° — it
faces WSW, along the building, into the service canyon rather than out of it.
Those are 81° apart, so both "opposing" bearings were on the wrong side of the
wall. This is the sixth time this week a zero turned out to be the camera.

The 12 m poses report `eyeAlt 67` on both sides: the collision net throws the
eye to 67 m because there is nowhere to stand 12 m from this door. 18 m is the
closest standoff that holds walking height, and it is quoted with every number.
