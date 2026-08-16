# NB2 — the Moody Center's doors, before and after

Judged at **1.70 m of eye height**, `applyTimeOfDay(0.30)`, 1440x900, **both
bearings on every door**. Full numbers in each `_manifest.json`.

**The instrument is not the crop.** At every pose the entrance layers are
toggled off and on and the same 260 px box around the door's own projected
pixel is captured twice; `doorPixels` is how many pixels the door contributes.
Zero means the door renders nothing there, whatever is in front of it. A crop
can be fooled by a bearing (`sweep.md` §3.4: one frame in five photographed the
wrong thing) and `queryRenderedFeatures` is unusable at this pitch.

**Both arms came off the SAME server with the one file swapped**, which is the
tighter A/B and cannot drift, and both waited for `austin-entrances` to report
LOADED before any frame was taken.

```
                 BEFORE      AFTER
MCA-eid574-A        0 px    33,768 px     the main door
MCA-eid574-B        0 px    32,982 px
MCA-eid575-A        0 px    28,387 px
MCA-eid575-B         —      28,344 px
MCA-eid576-A         —      15,605 px
MCA-eid576-B         —      20,329 px
MCA-eid577-A         —      26,939 px
MCA-eid577-B         —      25,832 px
MCA-eid578-A         —      28,122 px
MCA-eid578-B         —      28,258 px
```

`—` means no clean before frame exists for that pose. The before arm was cut
short to buy the after arm, and an earlier before run was **discarded** rather
than trusted: its process outlived the data-file swap, so frames after
13:28:59 could not be shown to be looking at the old doors. What is here was
re-shot afterwards against the pre-fix file with nothing else running.

Two `-oldcam` frames were taken and deleted as uninformative: they aim the OLD
camera station at the OLD door position on the NEW data, so the box is centred
on a spot the door has moved 12 m away from, and 0 px there means nothing.

Why: `docs/entrances/buried.md`. Rule: `scripts/bake_entrances.py`.
