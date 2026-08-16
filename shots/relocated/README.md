# The 25 relocated doors, and the Main Building

Full write-up and every number: `docs/entrances/relocated.md`.

**Judged at 1.70 m of eye height, `applyTimeOfDay(0.30)`, 1440×900, BOTH bearings
on every door.** The instrument is not the crop: at every pose the seven
`entrances-*` layers are toggled off and on and the same 260 px box around the
door's own projected pixel is captured twice, so `doorPixels` is what the door
itself contributes. A crop can be fooled by a bearing (`sweep.md` §3.4: one frame
in five photographed the wrong thing); a toggle cannot. Every run waited for
`austin-entrances` to report LOADED before any frame.

```
mai/     the Main Building's south portal, both bearings, day and night,
         plus the South Mall at 60 m and a raised hero. It did NOT move —
         all seven MAI groups are byte-identical to the pre-NB2 file.
sheets/  contact sheets, one 300 px crop per pose, labelled with doorPixels.
         r1/r2/r3 are the 25 on `main`; nb6/nb6b are the 11 the fix moves.
fix/     the three doors the relocation broke, three ways:
         PRE-*  the pre-NB2 file at its own pre-NB2 pose  (visible)
         plain  the same door on `main` today             (0 px)
         NB6-*  the same door with the fix                (visible again)
drops/   the three dropped doors' walls, four bearings and a look-down.
hero/    the 43 changed pixels in H3-tower, enlarged 4x: MAIN vs pre-NB2.
         It is the Moncrief-Neuhaus door, 2.07 m along its own wall.
```

The headline numbers:

```
                                   BEFORE (A/B px)    ON main       WITH THE FIX
Engineering Discovery  eid 172      5,432 /      0    0 /    0       0 /  4,453
Brackenridge Hall      eid 285          0 / 10,376    0 /    0  31,770 / 29,754
West Campus block      eid 194     15,351 / 13,837    0 /  557  15,567 / 15,241
```

The 342 raw frames are not committed — the sheets carry the same evidence.
