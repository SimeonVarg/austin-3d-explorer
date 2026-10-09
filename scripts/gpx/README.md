# Local GPX walking evidence

This offline command turns daily phone tracks into door-side evidence, possible
shortcuts, through-building hypotheses and measured walking times. It does not
change app data automatically. Python 3.9 or newer is sufficient: the shipped
tool and tests use only the standard library. No browser, server, network service,
plotting library or package installation is needed.

## Run a day

Keep raw GPX and privacy configuration in a private folder **outside all repository
checkouts**. The suggested name is `privacy-circles.json`. Its JSON is a list of
circles, each with numeric `lat`, `lon` and `radius_m`. Define each private place
and a generous radius locally. Never copy those coordinates into this repository.
An intentional empty configuration is `[]`; privacy configuration is required.

From the repository root, substitute external paths:

```bash
python3 scripts/gpx/import_gpx.py <private-folder>/day.gpx --privacy <private-folder>/privacy-circles.json --out <private-folder>/day-evidence
```

Several GPX files can be passed before the flags. Files and GPX `trkseg` boundaries
remain separate; no invented trip connects them. Point times must include a time
zone. Missing/invalid times, non-increasing times and gaps longer than 120 seconds
break a walk. Coordinates, elevation, time, HDOP and recognised accuracy extensions
are read; unsupported extensions are ignored.

## Four outputs

- `report.md`: plain-language local findings and per-walk/overall time comparisons.
- `evidence.geojson`: **private** filtered fixes, times/quality, events and matched
  routes. Never publish this file.
- `candidates.geojson`: derived door points, simplified path lines and schematic
  through-building links only. No dates, timestamps, raw fixes, filenames, device
  identifiers, names or privacy-circle centres. New door points/path vertices are
  grid-rounded; confirmations use the existing public door location. Through-link
  durations are rounded to five seconds, not absolute times.
- `map.svg`: **private** plain SVG with footprints, doors, filtered track and
  colour-labelled events. View locally; do not publish it.

Only `candidates.geojson` is designed for public review, **not automatic publication**.
It still describes visited places. Review lines and building sides locally before
sharing. None of the outputs belong in this repo by default. Raw GPX, privacy JSON
and private working reports must never be committed or uploaded.

## Privacy comes first

Before quality filtering, matching or detection, every point outside the app area
or inside a private circle is discarded. The app area comes from the outer-context
bounding box in `data/manifest.json`, not an expanded GPS envelope. Removed points
break continuity: matching, through-links and times cannot bridge them. A segment
whose endpoints are outside a circle is also broken if its line crosses the circle.
Candidate geometry is checked again after simplification/rounding. Redacted point
coordinates/times and circle centres are never written to outputs; only counts
of removed fixes remain.

The CLI refuses GPX, privacy files and outputs inside the current checkout or its
primary checkout. Resolved paths prevent `..` and symlink escapes; existing linked
output files are refused. Keep unrelated repositories out of the private folder
too. `.gitignore` is a last defence, not permission to put tracks in the repo. Tests
generate synthetic data in external temporary folders; no raw fixtures are tracked.

## Evidence and limits

- Fixes above 30 m estimated horizontal error are discarded. Recognised extension
  elements: `accuracy`, `accuracy_m`, `accuracyMeters`, `horizontalAccuracy`,
  `horizontal_accuracy`, `hacc`, with metre or explicit centimetre units. HDOP
  falls back to a configurable 5 m multiplier: **HDOP itself is not metres**.
  Missing quality remains unknown; unrecognised extension formats stay unknown.
- Sustained driving is displacement over 20-50 seconds above 3 m/s, subtracting
  endpoint uncertainty. Individual GPS speed spikes do not classify a drive.
  Slow vehicles and short drives can remain.
- A five-point median suppresses jumps. Candidate edges are connected by bounded
  shortest-path searches and scored as a sequence using fix-to-edge distance and
  observed displacement. Disconnected walks receive no fabricated connections.
- Footprints use the latest detailed snapshot loaded by `js/app.js`, Capitol and
  outer building bodies, with excluded buildings removed. Polygon holes and
  multipolygons work. The runtime courtyard correction is read from its app
  configuration. Decorative, raised and indoor geometry is not a ground survey.
- Doors are grouped by `eid` from actual `k=door` geometry in
  `data/entrances.geojson`, not presumed point features. Sustained interior footprint
  crossings or quality collapse/recovery at walls generate scored hypotheses.
  Existing doors on the **same building** within 25 m are confirmed; otherwise a
  new wall candidate is reported. Narrow passages may be missed.
- Entry/exit at distinct doors or sides of the same building within five minutes
  creates a possible through-link with elapsed time. Its line is schematic, not a
  surveyed corridor. Privacy breaks, drive cuts, file boundaries and large gaps
  prevent pairing across missing trips.
- Outdoor runs farther than 12 m from every graph edge and longer than 20 m become
  shortcut/stair/desire-line candidates. Lines are smoothed, simplified and rounded
  to a 5 m grid; building interiors are excluded.
- Real time is the timestamp difference, including stops. Comparable connected
  outdoor routes use the matched route at 1.35 m/s and the app baked 1.1-1.4 m/s
  range, stair speed/fixed cost and signal waits. Indoor/building events, wall-quality
  gaps, off-graph and disconnected routes are excluded from the overall number.
  Overall time sums real/reference seconds before calculating a ratio. A noisy
  day does not establish a universal walking-speed correction.

Confidence is a heuristic score, **not a calibrated probability**. A wall crossing
can be drift; a quality collapse can be a canopy. One pass usually establishes the
building side. Repeated independent passes and photographs narrow it to a door.

**GPS cannot tell that a door is LOCKED.** Photograph the locked door and its
posted-hours sign instead. Those local photos carry time, position and heading,
but remain private until reviewed. This tool does not read photographs or infer
opening hours, permissions, safety or step-free access.

## Tuning and synthetic tests

`--help` lists every threshold. Examples: `--max-accuracy 25`, `--gap-seconds 90`,
`--vehicle-speed 3`, `--vehicle-seconds 20`, `--door-radius 25`,
`--offgraph-distance 12`, `--offgraph-length 20`, `--walk-speed 1.35`. Lower error
thresholds lose wall evidence; larger snaps increase wrong-door risk.

```bash
python3 scripts/gpx/test_gpx.py
```

The full synthetic day samples the real graph at 1.35 m/s with Gaussian 5 m
open-space and 15 m wall-adjacent error. It adds a known entry, through-building
walk, unmapped-wall candidate, shortcut, drive, poor indoor fixes and privacy
cluster. Checks cover privacy/vehicle removal, known door within 10 m, shortcut,
walk time within 10%, four CLI outputs and the public schema. Additional checks
cover multiple seeds/files, gaps, accuracy units, polygon holes, baked stair/signal
costs, noise-only movement and linked-output refusal.
