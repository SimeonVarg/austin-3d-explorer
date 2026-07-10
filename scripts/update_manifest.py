#!/usr/bin/env python3
"""Rebuild data/manifest.json from what's actually on disk.

The front end reads this file to build the date picker (data.snapshots) and to
know which before/after change-animations are available (data.diffs). Run
after every pipeline run, once the new snapshot (and, if applicable, its diff
against the previous snapshot) has been written.
"""
import json
import os

DATA_DIR = "data"
SNAPSHOTS_DIR = os.path.join(DATA_DIR, "snapshots")
DIFFS_DIR = os.path.join(DATA_DIR, "diffs")
MANIFEST_PATH = os.path.join(DATA_DIR, "manifest.json")


def list_snapshots():
    if not os.path.isdir(SNAPSHOTS_DIR):
        return []
    return sorted(
        d for d in os.listdir(SNAPSHOTS_DIR)
        if os.path.isdir(os.path.join(SNAPSHOTS_DIR, d))
    )


def list_diffs():
    if not os.path.isdir(DIFFS_DIR):
        return []
    diffs = []
    for fname in sorted(os.listdir(DIFFS_DIR)):
        if not fname.endswith(".geojson") or "_to_" not in fname:
            continue
        from_date, to_date = fname[: -len(".geojson")].split("_to_")
        with open(os.path.join(DIFFS_DIR, fname)) as f:
            changed_count = len(json.load(f)["features"])
        diffs.append(
            {
                "from": from_date,
                "to": to_date,
                "file": f"diffs/{fname}",
                "changed_count": changed_count,
            }
        )
    return diffs


def main():
    snapshots = list_snapshots()
    manifest = {
        "snapshots": snapshots,
        "latest": snapshots[-1] if snapshots else None,
        "diffs": list_diffs(),
    }
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"manifest.json: {len(snapshots)} snapshot(s), {len(manifest['diffs'])} diff(s)")


if __name__ == "__main__":
    main()
