# Snapshot and tile publication

The full snapshot workflow used to run for almost every script change, including
unrelated campus bakes. The separate tile workflow could rebase generated tiles
onto newer sources without rebuilding. Both publishers now build the exact event
revision, check the remote branch before work and before publication, and use an
ordinary explicit push. Stale results fail clearly and must be rebuilt from the
current branch. Generated data is never rebased or force-pushed.

## Trigger matrix

| Change or action | Full snapshot | Tiles only |
| --- | --- | --- |
| Push pipeline input on `main` | Runs | Does not run |
| Push `tile.sh` or `config.sh` on a feature branch | Does not run | Runs on that branch |
| Push another pipeline input on a feature branch | Does not run | Does not run |
| Push unrelated campus bake, compiler, verification, app, or generated output | Does not run | Does not run |
| Edit either workflow definition alone | Does not run | Does not run |
| Manual full refresh on `main` | Runs | Does not run |
| Manual full refresh on a feature branch or tag | Job skipped | Does not run |
| Manual tile refresh on a branch | Does not run | Runs on selected branch |
| Manual tile refresh on a tag | Does not run | Job skipped |

The full snapshot already builds tiles, so a main push to `tile.sh` or `config.sh`
has only one publisher. Feature-branch tiling remains available for Windows
development. Workflow-only edits require an intentional manual run; reviewing
publisher code does not itself download Overture or build tippecanoe.

## Audited full-pipeline inputs

- `extract.sh` sources `config.sh` and executes `extract_overture.sql`.
- `enrich.py` uses exported configuration and optional `hero_overrides.json`.
- `tile.sh` sources configuration and reads the new enriched snapshot plus
  `trees.geojson`, `roads.geojson`, `outer_ring.geojson`,
  `roofscape.detail.geojson` and `props.geojson`.
- `bake_detail.py` reads the enriched snapshot plus `parts.geojson`,
  `building_tags.geojson`, `hero_designs.json` and `signs.json`.
- `diff_snapshots.py` reads previous/current enriched snapshots.
- `update_manifest.py` reads snapshot/diff directories and preserves its existing
  foreign manifest keys.
- `bake_roof_anchors.py` reads the selected detailed buildings, `roofscape.geojson`
  and `roofscape.detail.geojson`.

These Python entry points have no local Python-module dependencies. The workflow
lists the actual source inputs individually. Generated snapshots, manifest,
diffs, anchors and archives are transaction state, not automatic refresh triggers.
External Overture/Overpass changes can be picked up with manual refresh.

## Publication and races

Both workflows share a per-branch concurrency group with cancellation disabled
for running jobs. This reduces competing writes; correctness does not depend on
Actions ordering. If two same-SHA manual runs queue, the first may publish. The
second then fails the remote-SHA check before expensive work. If the first produces
no changes, the second can proceed. Rerun from the current branch when a fresh
refresh is required; an outdated queued run does not follow the moving branch.

Any source or data publication that advances the destination during a build
causes the final freshness check to fail. A competing push arriving after that
check causes the normal non-fast-forward push to fail. Neither path overwrites
the newer revision. Even an unrelated intervening commit conservatively requires
a fresh run. Concurrency is not a durable request queue; do not assume every
pending manual request will execute.

The snapshot publisher stages only its dated snapshot, manifest, roof anchors,
five named scene archives and applicable before/after diff. The tile publisher
stages only its configured building archive and the same five scene archives.
Neither sweeps other bakes' data into its commit. Tile runs pin the UTC date once
to keep build and publication paths consistent across midnight.

## Verification and limits

Run `python scripts/verify/snapshot-publisher.py` with Python, PyYAML, Git and Bash
(Git for Windows works). The test reads the real YAML and runs its actual shell
steps against disposable local bare Git remotes. It checks trigger scope and shell
syntax, owned-output publication, branch isolation, stale and wrong-revision
rejection, unchanged outputs, and real competing pushes injected between each
publisher's final check and push. No browser, large data download or hosted
publication is required for these checks.

This patch does not change or comprehensively validate the extraction/bake
results. In particular, `update_manifest.py` may skip an incomplete snapshot and
retain an older latest entry; passing the publisher checks is not proof of a
complete new snapshot. Date-based refresh semantics are unchanged: a second run
on the same UTC day replaces that day's directory. Git retains its history.

Hosted scheduling, token permissions, extraction services and downstream
deployment have not been exercised by the local tests. A successful data commit
is not evidence of deployment; verify the public asset separately. A cancelled
publisher is not a passing data build.
