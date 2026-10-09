#!/usr/bin/env python3
"""Install/check the small photo tool runtime, always outside a Git checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import venv

HERE = Path(__file__).resolve().parent
LOCK = HERE / "requirements.txt"

# Run in the chosen interpreter so a successful package install is not mistaken
# for an ABI-compatible runtime. No service, GPU, photo or network is used here.
PROBE = r'''
import importlib.metadata as md, io, json, os, sys
os.environ["PROJ_NETWORK"] = "OFF"
expected = json.loads(sys.argv[1])
actual = {name: md.version(name) for name in expected}
if actual != expected:
    raise RuntimeError("package versions differ from requirements.txt: " + repr(actual))
import numpy as np
import cv2
from PIL import Image
from shapely.geometry import box
from pyproj import CRS, Transformer
pixels = np.zeros((16, 16), dtype=np.uint8)
cv2.fillPoly(pixels, [np.array([[2,2],[13,2],[13,13],[2,13]], np.int32)], 255)
assert np.count_nonzero(pixels) == 144
b = io.BytesIO(); Image.fromarray(pixels).save(b, format="PNG")
assert np.array_equal(np.asarray(Image.open(io.BytesIO(b.getvalue()))), pixels)
assert box(0,0,4,4).difference(box(1,1,3,3)).area == 12
crs = CRS.from_epsg(6578)
assert abs(crs.axis_info[0].unit_conversion_factor - 1200/3937) < 1e-12
t = Transformer.from_crs(4326, crs, always_xy=True)
inv = Transformer.from_crs(crs, 4326, always_xy=True)
lon, lat = inv.transform(*t.transform(-100, 30))
assert abs(lon + 100) < 1e-8 and abs(lat - 30) < 1e-8
print(json.dumps({"python":sys.version.split()[0], "packages":actual,
    "smoke_tests":["opencv-mask", "pillow-png", "polygon-subtraction", "survey-foot-crs-roundtrip"]}))
'''


def pins():
    return dict(line.split("==", 1) for line in LOCK.read_text().splitlines()
                if line and not line.startswith("#"))


def in_checkout(path):
    return any((parent / ".git").exists() for parent in (path, *path.parents))


def probe(python):
    env = dict(os.environ, PYTHONNOUSERSITE="1", PROJ_NETWORK="OFF")
    result = subprocess.run([str(python), "-I", "-c", PROBE, json.dumps(pins())],
                            env=env, text=True, capture_output=True, check=True)
    check = subprocess.run([str(python), "-m", "pip", "check"], env=env,
                           text=True, capture_output=True, check=True)
    answer = json.loads(result.stdout)
    answer["pip_check"] = check.stdout.strip()
    return answer


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reuse-python", type=Path,
                        help="check an existing external interpreter without changing it")
    parser.add_argument("--runtime-root", type=Path,
                        default=Path.home() / ".local" / "share" / "flyover" / "photo-rollout")
    parser.add_argument("--check", action="store_true", help="check only; never install")
    parser.add_argument("--offline", action="store_true", help="disable package-index access")
    parser.add_argument("--wheelhouse", type=Path, help="local wheels, useful with --offline")
    args = parser.parse_args(argv)
    lock_sha = hashlib.sha256(LOCK.read_bytes()).hexdigest()
    if args.reuse_python:
        python = args.reuse_python.expanduser().absolute()
        if in_checkout(python.parent):
            parser.error("the runtime must be outside every Git checkout")
        result = probe(python)
        result.update(python_executable=str(python), reused=True, requirements_sha256=lock_sha)
    else:
        root = args.runtime_root.expanduser().resolve()
        if in_checkout(root):
            parser.error("--runtime-root must be outside every Git checkout")
        name = "%s-py%d.%d-%s" % (lock_sha[:12], sys.version_info.major,
                                  sys.version_info.minor, platform.machine())
        runtime = root / name
        python = runtime / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        marker = runtime / ".photo-rollout-runtime"
        if runtime.exists() and not marker.exists():
            parser.error("refusing to alter an unrecognized existing directory: %s" % runtime)
        try:
            result = probe(python)
            reused = True
        except (OSError, subprocess.CalledProcessError):
            if args.check:
                raise RuntimeError("runtime is absent or failed checks; run setup without --check")
            if not runtime.exists():
                runtime.mkdir(parents=True)
                marker.write_text(lock_sha + "\n")
            venv.EnvBuilder(with_pip=True, clear=False).create(runtime)
            command = [str(python), "-m", "pip", "install", "--disable-pip-version-check",
                       "--only-binary=:all:", "-r", str(LOCK)]
            if args.offline:
                command.append("--no-index")
            if args.wheelhouse:
                command.extend(["--find-links", str(args.wheelhouse.expanduser().resolve())])
            subprocess.run(command, check=True, stdout=sys.stderr)
            result = probe(python)
            reused = False
        result.update(python_executable=str(python), reused=reused, requirements_sha256=lock_sha)
        # Receipt contains a local path; it stays beside the external runtime.
        (runtime / "runtime.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print("Runtime setup failed: %s" % error, file=sys.stderr)
        raise SystemExit(1)
