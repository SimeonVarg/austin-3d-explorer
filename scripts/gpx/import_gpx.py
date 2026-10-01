#!/usr/bin/env python3
"""Turn local GPX walks into door, path and walk-time evidence (standard library)."""

from __future__ import annotations
import argparse
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from evidence import analyze
from models import PRIVACY_DEFAULT, Settings, read_json
from output import report, write_outputs
from scene import Scene
from tracks import Privacy, repository_roots, require_external


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tracks", nargs="+", type=Path)
    parser.add_argument("--privacy", type=Path, required=True,
                        help=f"External local JSON circles (suggested name: {PRIVACY_DEFAULT}); explicitly use [] if none")
    parser.add_argument("--out", type=Path, required=True, help="External private working directory")
    for name, value in vars(Settings()).items():
        parser.add_argument("--" + name.replace("_", "-"), type=float, default=value)
    args = parser.parse_args(argv)
    try:
        roots = repository_roots()
        paths = [require_external(path, roots, "Raw input track") for path in args.tracks]
        privacy_path = require_external(args.privacy, roots, "Privacy file")
        output = require_external(args.out, roots, "Output directory")
        settings = Settings(**{name: getattr(args, name) for name in vars(Settings())})
        if any(not math.isfinite(value) or value <= 0 for value in vars(settings).values()):
            raise ValueError("All thresholds must be finite and positive")
        scene = Scene()
        privacy = Privacy(read_json(privacy_path), scene.bounds)
        result = analyze(paths, scene, privacy, settings)
        write_outputs(result, scene, privacy, settings, output, roots)
        print(report(result, scene, settings))
    except (ValueError, OSError, ET.ParseError, KeyError, TypeError) as error:
        if isinstance(error, (OSError, ET.ParseError, KeyError, TypeError)):
            print("Import failed: unreadable or malformed local input/data; no raw input was copied.", file=sys.stderr)
        else:
            print(f"Import refused: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
