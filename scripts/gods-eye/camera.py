#!/usr/bin/env python3
"""Convert an explicit Austin eye pose into a God's Eye View camera link.

The input is an eye position, such as window.__fly.eye(), not map.getCenter().
Austin uses height above its flat model ground. God's Eye View uses WGS84
ellipsoidal height, so the caller must supply the ellipsoidal height of that
model-ground datum. A mean-sea-level elevation is not interchangeable with it.

The link transfers position and orientation. Field of view is not part of the
upstream share format, and a link alone does not establish matched framing.
This script only prints a URL; it performs no network or browser operations.
"""

import argparse
import json
import math
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit


DEFAULT_BASE = "http://localhost:4174"
MAP_IDS = {"esri": "esri-imagery", "photoreal": "photoreal"}


def _number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number")
    try:
        number = float(value)
    except (OverflowError, ValueError):
        raise ValueError(f"{field} must be a finite number") from None
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return number


def _ranged(value, field, minimum, maximum):
    number = _number(value, field)
    if not minimum <= number <= maximum:
        raise ValueError(f"{field} must be between {minimum} and {maximum}")
    return number


def _numeric_text(number):
    return str(int(number)) if number.is_integer() else repr(number)


def _base_parts(base):
    if not isinstance(base, str) or any(char.isspace() for char in base):
        raise ValueError("base must be an HTTP(S) URL without whitespace")
    try:
        parts = urlsplit(base)
        port = parts.port
        host = parts.hostname
    except ValueError:
        raise ValueError("base must be a valid HTTP(S) URL") from None
    if parts.scheme not in {"http", "https"} or not host:
        raise ValueError("base must be an HTTP(S) URL with a host")
    if parts.username is not None or parts.password is not None:
        raise ValueError("base must not contain credentials")
    if port is not None and port == 0:
        raise ValueError("base port must be between 1 and 65535")
    if parts.query or parts.fragment:
        raise ValueError("base must not contain a query or fragment")
    return parts


def camera_link(eye, ground_ellipsoid, base=DEFAULT_BASE, map_stack="esri"):
    """Return a pose link using an explicitly supplied model-ground datum.

    ``eye`` requires numeric lng, lat, alt, bearing and pitch. Its alt is in
    metres above Austin's model ground; pitch is degrees from straight down.
    Optional roll is in degrees. Other eye diagnostics are ignored.
    ``ground_ellipsoid`` is that model ground's known WGS84 ellipsoidal height
    in metres, not an automatically sampled roof or an MSL elevation.
    """
    if not isinstance(eye, Mapping):
        raise ValueError("eye must be a JSON object with an explicit eye pose")
    required = {"lng", "lat", "alt", "bearing", "pitch"}
    missing = sorted(required.difference(eye))
    if missing:
        raise ValueError("eye is missing required fields: " + ", ".join(missing))
    lon = _ranged(eye["lng"], "lng", -180, 180)
    lat = _ranged(eye["lat"], "lat", -90, 90)
    alt = _number(eye["alt"], "alt")
    if alt < 0:
        raise ValueError("alt must be nonnegative metres above model ground")
    bearing = _ranged(eye["bearing"], "bearing", -360, 360)
    pitch = _ranged(eye["pitch"], "pitch", 0, 90)
    roll = _ranged(eye.get("roll", 0), "roll", -180, 180)
    ground = _number(ground_ellipsoid, "ground_ellipsoid")
    ellipsoid_alt = _number(alt + ground, "resulting ellipsoidal altitude")
    if map_stack not in MAP_IDS:
        raise ValueError("map must be esri or photoreal")
    parts = _base_parts(base)
    params = {
        "v": "2",
        "lat": _numeric_text(lat),
        "lon": _numeric_text(lon),
        "alt": _numeric_text(ellipsoid_alt),
        "heading": _numeric_text(bearing % 360),
        "pitch": _numeric_text(pitch - 90),
        "roll": _numeric_text(roll),
        "style": "normal",
        "map": MAP_IDS[map_stack],
    }
    return urlunsplit(parts._replace(fragment=urlencode(params)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--eye", required=True, type=Path, help="explicit eye JSON file")
    parser.add_argument(
        "--ground-ellipsoid", required=True, type=float,
        help="known WGS84 ellipsoidal height of Austin's model-ground datum, in metres",
    )
    parser.add_argument("--base", default=DEFAULT_BASE, help="God's Eye View server URL")
    parser.add_argument("--map", dest="map_stack", choices=MAP_IDS, default="esri")
    args = parser.parse_args(argv)
    try:
        eye = json.loads(args.eye.read_text(encoding="utf-8"))
        link = camera_link(eye, args.ground_ellipsoid, args.base, args.map_stack)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(link)


if __name__ == "__main__":
    main()
