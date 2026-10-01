"""Stream GPX through privacy filters before matching or detecting events."""

from __future__ import annotations
import math
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from geometry import distance, lonlat, project, xy
from models import Fix, REPO


def repository_roots(repo=REPO):
    roots = [repo.resolve()]
    marker = repo / ".git"
    if marker.is_file():
        text = marker.read_text(encoding="utf-8").strip()
        if text.startswith("gitdir:"):
            gitdir = (repo / text.split(":", 1)[1].strip()).resolve()
            common = gitdir / "commondir"
            if common.exists():
                common_dir = (gitdir / common.read_text().strip()).resolve()
                if common_dir.name == ".git":
                    roots.append(common_dir.parent)
    return roots


def require_external(path, roots, label):
    resolved = Path(path).expanduser().resolve()
    if any(resolved == root or root in resolved.parents for root in roots):
        raise ValueError(f"{label} must be outside every repository checkout")
    return resolved


class Privacy:
    def __init__(self, circles, bounds):
        self.bounds = bounds
        self.circles = []
        if not isinstance(circles, list):
            raise ValueError("Privacy JSON must be a list of circles")
        for circle in circles:
            try:
                latitude, longitude, radius = (float(circle[key]) for key in ("lat", "lon", "radius_m"))
            except (KeyError, TypeError, ValueError):
                raise ValueError("Each privacy circle needs numeric lat, lon and radius_m") from None
            if not all(math.isfinite(value) for value in (latitude, longitude, radius)) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180 or radius <= 0:
                raise ValueError("Invalid privacy circle")
            self.circles.append((xy((longitude, latitude)), radius))

    def reason(self, position):
        longitude, latitude = lonlat(position)
        west, south, east, north = self.bounds
        if not west <= longitude <= east or not south <= latitude <= north:
            return "outside_area"
        if any(distance(position, center) <= radius for center, radius in self.circles):
            return "privacy"
        return None

    def line_safe(self, positions):
        if any(self.reason(position) for position in positions):
            return False
        return not any(project(center, start, end)[0] <= radius
                       for start, end in zip(positions, positions[1:])
                       for center, radius in self.circles)


def local_name(tag):
    return tag.rsplit("}", 1)[-1].lower()


def numeric(text):
    try:
        value = float(text)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def parse_fix(element, settings, session):
    values = {local_name(child.tag): child.text for child in element}
    if not values.get("time"):
        return None
    try:
        timestamp = datetime.fromisoformat(values["time"].strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if timestamp.tzinfo is None:
        return None
    timestamp = timestamp.astimezone(timezone.utc)
    accuracy = None
    source = "unknown"
    names = {"accuracy", "accuracy_m", "accuracymeters", "horizontalaccuracy", "horizontal_accuracy", "hacc"}
    for child in element.iter():
        if local_name(child.tag) in names:
            value = numeric(child.text)
            units = (child.get("unit") or child.get("units") or "m").lower()
            if value is not None and value >= 0 and units in ("m", "meter", "meters", "metres", "cm"):
                value = value / 100 if units == "cm" else value
                accuracy = max(accuracy or 0.0, value)
                source = "extension"
    hdop = numeric(values.get("hdop"))
    if accuracy is None and hdop is not None and hdop >= 0:
        accuracy, source = hdop * settings.hdop_metres, "hdop_estimate"
    if values.get("fix", "").strip().lower() == "none":
        accuracy, source = math.inf, "no_fix"
    return Fix(xy((float(element.get("lon")), float(element.get("lat")))), timestamp,
               numeric(values.get("ele")), accuracy, hdop, source, session)


def read_tracks(paths, privacy, settings):
    stats = Counter()
    chunks = []
    session = 0
    for path in paths:
        current = []
        last_allowed = pending_poor = previous_coordinate = None
        container = 0
        for event, element in ET.iterparse(path, events=("start", "end")):
            tag = local_name(element.tag)
            if event == "start" and tag == "trkseg":
                if current:
                    chunks.append(current)
                current = []
                session += 1
                container += 1
                last_allowed = pending_poor = previous_coordinate = None
            if event != "end":
                continue
            if tag == "trkpt":
                stats["input_points"] += 1
                latitude, longitude = numeric(element.get("lat")), numeric(element.get("lon"))
                if latitude is None or longitude is None or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                    reason = "invalid"
                    position = None
                else:
                    position = xy((longitude, latitude))
                    reason = privacy.reason(position)
                if reason:
                    stats[reason] += 1
                    if current:
                        chunks.append(current)
                    current = []
                    session += 1
                    last_allowed = pending_poor = previous_coordinate = None
                    element.clear()
                    continue
                fix = parse_fix(element, settings, session)
                element.clear()
                if fix is None or not container:
                    stats["invalid"] += 1
                    if current:
                        chunks.append(current)
                    current = []
                    session += 1
                    last_allowed = pending_poor = previous_coordinate = None
                    continue
                if previous_coordinate is not None and not privacy.line_safe([previous_coordinate, position]):
                    if current:
                        chunks.append(current)
                    current = []
                    session += 1
                    fix.session = session
                    last_allowed = pending_poor = None
                    stats["privacy_segment_breaks"] += 1
                previous_coordinate = position
                if last_allowed and (fix.time <= last_allowed.time or (fix.time - last_allowed.time).total_seconds() > settings.gap_seconds):
                    if current:
                        chunks.append(current)
                    current = []
                    session += 1
                    fix.session = session
                    last_allowed = pending_poor = None
                    stats["time_breaks"] += 1
                if fix.accuracy is not None and fix.accuracy > settings.max_accuracy:
                    stats["poor_accuracy"] += 1
                    if last_allowed is not None and pending_poor is None:
                        last_allowed.collapse_after = fix.time
                    pending_poor = fix.time
                    if current:
                        chunks.append(current)
                    current = []
                    continue
                if pending_poor is not None:
                    fix.recovery_before = fix.time
                pending_poor = None
                current.append(fix)
                last_allowed = fix
                stats["unknown_accuracy"] += fix.accuracy is None
                stats["hdop_estimated"] += fix.accuracy_source == "hdop_estimate"
            elif tag == "trkseg":
                if current:
                    chunks.append(current)
                current = []
                container -= 1
                last_allowed = pending_poor = previous_coordinate = None
                element.clear()
        if current:
            chunks.append(current)
    return chunks, stats


def drop_vehicles(chunks, settings, stats):
    walks = []
    session_shift = 0
    for chunk in chunks:
        vehicle = set()
        for start in range(len(chunk) - 1):
            for end in range(start + 1, len(chunk)):
                elapsed = (chunk[end].time - chunk[start].time).total_seconds()
                if elapsed > settings.vehicle_seconds * 2.5:
                    break
                if elapsed >= settings.vehicle_seconds:
                    uncertainty = (chunk[start].accuracy or 15) + (chunk[end].accuracy or 15)
                    displacement = max(0, distance(chunk[start].position, chunk[end].position) - uncertainty)
                    if displacement / elapsed > settings.vehicle_speed:
                        vehicle.update(range(start, end + 1))
        run = []
        for index, fix in enumerate(chunk):
            if index in vehicle:
                stats["vehicle"] += 1
                if run:
                    walks.append(run)
                run = []
                session_shift += 1
                continue
            fix.session += session_shift * 1000000
            run.append(fix)
        if run:
            walks.append(run)
    stats["retained_points"] = sum(len(walk) for walk in walks)
    stats["walks"] = sum(len(walk) >= 2 for walk in walks)
    return walks
