#!/usr/bin/env python
"""Does every shipped data file still describe the buildings the app draws?

Everything on this map is DERIVED from building footprints: door groups,
storey bands, roofs, the walking graph's door attachments. If a bake computes
against a footprint file that is not the one on screen, the result is geometry
that is correct against a file nobody sees. That is QUEUE NB5, and the reason
it took a whole pass to answer is that no shipped file recorded which snapshot
it was built from -- the provenance lived in someone's memory.

Now it lives in the data. Every bake that reads a snapshot writes

    { "snapshot": "2026-08-16",
      "snapshot_source": "buildings.detailed.geojson",  # optional
      ... }

at the top of its own output, and this script compares that against
`data/manifest.json` -> `latest`, which is what `js/app.js` loads.

THREE OUTCOMES, because two would lie
-------------------------------------
  PASS             the recorded date IS the manifest date.
  STALE-BUT-EQUAL  the dates differ but the snapshot bytes are identical.
                   Advisory. Re-bake at leisure; nothing on screen can move.
                   This tier is the whole point: most drift in this repo has
                   been a stale label on identical bytes, and calling that a
                   failure trains people to ignore the check.
  FAIL             the dates differ AND the bytes differ. Prints how many
                   buildings were added, removed and moved, so the reader
                   knows immediately whether it is a re-bake or a shrug.

Exit status is 1 if anything FAILed, else 0. `--strict` also fails on
STALE-BUT-EQUAL. `--quiet` prints only the failures and the summary line.

Files with no `snapshot` key are listed as UNSTAMPED, informational only.
That list is the honest measure of how much of the repo this check covers;
it is not a defect in itself, because most of those files never read a
snapshot at all.

Usage:  python scripts/snapshot_parity.py [--strict] [--quiet]
"""
from __future__ import print_function

import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SNAPS = os.path.join(DATA, "snapshots")

# The file a bake is assumed to have read when it records no `snapshot_source`.
# `facade_palette.json` predates the convention and reads this one.
DEFAULT_SOURCE = "buildings.detailed.geojson"

# Never scanned: the manifest defines the answer, and the dated directories are
# the inputs rather than shipped outputs.
SKIP = {"manifest.json"}

# A bake may legitimately pin an old snapshot -- but it has to say why, here,
# in one line, next to the date. A pin with a reason is a decision; a pin
# without one is QUEUE NB5. Keys are file basenames.
PINNED_ON_PURPOSE = {
    # "example.geojson": ("2026-07-30", "why this file must not follow latest"),
}

HEAD_BYTES = 65536      # top-level keys live in the first chunk of every writer


# ------------------------------------------------------------------ scanning
def top_level_strings(path, wanted):
    """Return {key: value} for the wanted top-level string keys of a JSON object.

    Streams and stops early. Written by hand rather than json.load() because
    `entrances.geojson` is 6.75 MB of minified features and this check is meant
    to be instant enough that people actually run it.
    """
    found = {}
    depth = 0
    in_str = False
    esc = False
    tok = []            # current string literal being accumulated
    pending_key = None  # a top-level key awaiting its value
    expect_value = False

    with open(path, "rb") as fh:
        blob = fh.read(HEAD_BYTES)
    text = blob.decode("utf-8", "replace")

    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
                lit = "".join(tok)
                tok = []
                if depth == 1:
                    if expect_value and pending_key is not None:
                        if pending_key in wanted:
                            found[pending_key] = lit
                            if len(found) == len(wanted):
                                return found
                        pending_key, expect_value = None, False
                    else:
                        pending_key = lit
            else:
                tok.append(ch)
            continue

        if ch == '"':
            in_str = True
        elif ch == "{" or ch == "[":
            depth += 1
            if expect_value:            # value is a container, not our string
                pending_key, expect_value = None, False
        elif ch == "}" or ch == "]":
            depth -= 1
            if depth <= 0:
                break
        elif ch == ":" and depth == 1:
            expect_value = True
        elif ch == "," and depth == 1:
            pending_key, expect_value = None, False
    return found


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------- the FAIL case
def describe_delta(old_path, new_path):
    """added / removed / geometry-changed, so a FAIL is actionable on sight."""
    try:
        old = json.load(open(old_path, encoding="utf-8"))["features"]
        new = json.load(open(new_path, encoding="utf-8"))["features"]
    except Exception as exc:                       # noqa: BLE001
        return ["      (could not diff: %s)" % exc]

    def key(f):
        return (f.get("properties") or {}).get("id")

    A = {key(f): f for f in old}
    B = {key(f): f for f in new}
    added = sorted(set(B) - set(A))
    removed = sorted(set(A) - set(B))
    moved = []
    props = {}
    for i in set(A) & set(B):
        fa, fb = A[i], B[i]
        if json.dumps(fa.get("geometry"), sort_keys=True) != \
           json.dumps(fb.get("geometry"), sort_keys=True):
            moved.append(i)
        pa = fa.get("properties") or {}
        pb = fb.get("properties") or {}
        for k in set(pa) | set(pb):
            if pa.get(k) != pb.get(k):
                props[k] = props.get(k, 0) + 1

    lines = ["      features   %d -> %d" % (len(old), len(new)),
             "      added      %d" % len(added),
             "      removed    %d" % len(removed),
             "      geometry   %d changed" % len(moved)]
    if moved:
        lines.append("        %s" % ", ".join(str(m) for m in moved[:6]))
    if props:
        lines.append("      properties %s"
                     % ", ".join("%s:%d" % (k, n)
                                 for k, n in sorted(props.items())))
    if moved:
        lines.append("      -> FOOTPRINTS MOVED. Anything derived from them "
                     "(doors, bands, roofs, walk links) wants re-baking.")
    else:
        lines.append("      -> no footprint moved; check whether this bake "
                     "reads any of the changed properties before re-baking.")
    return lines


# --------------------------------------------------------------------- main
def main(argv):
    strict = "--strict" in argv
    quiet = "--quiet" in argv

    mf = os.path.join(DATA, "manifest.json")
    latest = json.load(open(mf, encoding="utf-8")).get("latest")
    if not latest:
        print("FAIL  data/manifest.json has no `latest`")
        return 1

    names = sorted(n for n in os.listdir(DATA)
                   if n.endswith((".json", ".geojson")) and n not in SKIP)

    passed, stale, failed, unstamped = [], [], [], []
    print("app draws  data/manifest.json -> latest = %s" % latest)
    print("")

    for name in names:
        path = os.path.join(DATA, name)
        got = top_level_strings(path, ("snapshot", "snapshot_source"))
        recorded = got.get("snapshot")
        if not recorded:
            unstamped.append(name)
            continue
        source = got.get("snapshot_source") or DEFAULT_SOURCE

        if name in PINNED_ON_PURPOSE:
            want, why = PINNED_ON_PURPOSE[name]
            if recorded == want:
                passed.append(name)
                if not quiet:
                    print("PINNED           %-28s %s  (%s)" % (name, recorded, why))
                continue

        if recorded == latest:
            passed.append(name)
            if not quiet:
                print("PASS             %-28s %s" % (name, recorded))
            continue

        old_path = os.path.join(SNAPS, recorded, source)
        new_path = os.path.join(SNAPS, latest, source)
        if not os.path.exists(old_path):
            failed.append(name)
            print("FAIL             %-28s %s -> %s" % (name, recorded, latest))
            print("      the snapshot it names does not exist: %s"
                  % os.path.relpath(old_path, ROOT))
            continue
        if not os.path.exists(new_path):
            failed.append(name)
            print("FAIL             %-28s %s -> %s" % (name, recorded, latest))
            print("      the current snapshot has no %s" % source)
            continue

        if md5(old_path) == md5(new_path):
            stale.append(name)
            if not quiet or strict:
                print("STALE-BUT-EQUAL  %-28s %s -> %s   (%s is byte-identical; "
                      "re-bake at leisure, nothing can move)"
                      % (name, recorded, latest, source))
            continue

        failed.append(name)
        print("FAIL             %-28s %s -> %s   (%s DIFFERS)"
              % (name, recorded, latest, source))
        for line in describe_delta(old_path, new_path):
            print(line)

    if unstamped and not quiet:
        print("")
        print("unstamped (%d) - no `snapshot` key, so this check cannot see them:"
              % len(unstamped))
        for i in range(0, len(unstamped), 3):
            print("   " + "  ".join("%-26s" % n for n in unstamped[i:i + 3]))

    print("")
    print("%d pass, %d stale-but-equal, %d FAIL, %d unstamped"
          % (len(passed), len(stale), len(failed), len(unstamped)))

    if failed:
        return 1
    if strict and stale:
        print("--strict: stale-but-equal counts as failure")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
