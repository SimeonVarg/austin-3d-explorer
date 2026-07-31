# Reference imagery — arts and presidential precinct

Reference use only. Nothing in here ships in the app.

What is committed is the subset that `docs/PASS_ARTS.md` actually cites, so
every hex and every dimension in that document can be re-derived from this
directory alone:

- `aerial_<slug>_z20.jpg` — Esri World Imagery nadir mosaics, 25 tiles each at
  z20 (~0.129 m/px at this latitude). Every measurement taken off imagery — the
  Bass auditorium and lobby footprints, the two missing Snøhetta petals, the
  roof and cornice colours — comes off these.
- `overlay_<slug>.jpg` — the same tiles with the snapshot footprint drawn on
  them and a 20 m bar, produced by `scripts/overlay_arts_footprints.py`. These
  are what established that the footprint is the WIDEST element of each building
  and that every band therefore insets rather than grows.
- `cited/*.jpg` — the eight photographs the colour samples were taken from,
  re-encoded to 1400 px. Wikimedia Commons; licence and credit per file in
  `INDEX.json`.
- `INDEX.json` — source URL, Commons title, licence and credit for every file.

The full pull is 74 images and 78 MB and is regenerable:

```bash
python scripts/fetch_arts_reference.py     # Commons + Esri, writes the lot here
python scripts/sample_arts_colours.py      # every hex in docs/PASS_ARTS.md
python scripts/overlay_arts_footprints.py  # the footprint overlays
```

The resize to 1400 px moves the sampled medians by 1–3 units — checked, not
assumed: `#f0e9dd` became `#f1eadf`, `#dab596` became `#dbb697`, `#a4a4a1`
became `#a4a4a0`. Nothing in the doc depends on that third digit.
