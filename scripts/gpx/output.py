"""Plain reports and SVG maps; only derived candidates may be shared."""

from __future__ import annotations
import html
import json
from collections import Counter

from geometry import xy
from tracks import repository_roots, require_external

COLORS = {"background": "#f4f1e8", "building": "#dfd9cd", "wall": "#bbb3a5", "door": "#847b70",
          "track": "#2277bb", "door_confirmation": "#16835e", "new_door": "#cb4c31",
          "shortcut": "#d49b10", "through_building": "#8d4fba"}


def report(result, scene, settings):
    stats = result["stats"]
    counts = Counter(event["properties"]["kind"] for event in result["events"])
    lines = ["# Walking evidence", "", "This is a local review report, not a survey or an access guarantee.", "",
             f"Read {stats.get('input_points', 0)} points. Kept {stats.get('retained_points', 0)} points in {stats.get('walks', 0)} walks.",
             f"Dropped {stats.get('privacy', 0)} points in private circles, {stats.get('outside_area', 0)} outside the app area, "
             f"{stats.get('poor_accuracy', 0)} poor fixes, {stats.get('vehicle', 0)} vehicle points and {stats.get('invalid', 0)} invalid points.",
             f"Privacy-crossing segments were broken {stats.get('privacy_segment_breaks', 0)} times; no line bridges a private circle.", "",
             "## Door and path evidence", "",
             f"{counts['door_confirmation']} events confirm existing door groups; {counts['new_door']} are NEW wall candidates.",
             f"{counts['through_building']} possible through-building links; {counts['shortcut']} off-graph path candidates."]
    for event in result["events"]:
        properties = event["properties"]
        kind = properties["kind"]
        if kind in ("door_confirmation", "new_door"):
            label = f"confirms door {properties['door_id']}" if kind == "door_confirmation" else "NEW door candidate on a wall"
            lines.append(f"- {properties['action'].capitalize()}: {label}; confidence {properties['confidence']:.2f} ({properties['reason'].replace('_', ' ')}).")
        elif kind == "through_building":
            lines.append(f"- Possible through-building link: door {properties['entry_door_id']} to door {properties['exit_door_id']}, "
                         f"{properties['elapsed_seconds']:.0f} seconds; confidence {properties['confidence']:.2f}.")
        else:
            lines.append(f"- Possible shortcut, stairs or desire line: {properties['length_m']:.0f} metres; confidence {properties['confidence']:.2f}.")
    lines.extend(["", "## Walking times", "",
                  f"The comparison follows the observed, connected graph route, not just the shortest endpoint route. "
                  f"The reference speed is {settings.walk_speed:.2f} m/s; the app range uses its baked speeds, stairs and signal waits.",
                  "Elapsed time includes stops. Off-graph, indoor and disconnected walks are not included in the overall comparison."])
    for index, timing in enumerate(result["times"], 1):
        if timing["comparable"]:
            lines.append(f"- Walk {index}: real {timing['elapsed_seconds']:.1f} s, reference {timing['predicted_seconds']:.1f} s "
                         f"(app range {timing['low_seconds']:.1f}-{timing['high_seconds']:.1f} s), "
                         f"difference {timing['difference_percent']:+.1f}%; confidence {timing['confidence']:.2f}.")
        else:
            lines.append(f"- Walk {index}: real {timing['elapsed_seconds']:.1f} s; no fair graph comparison ({timing['reason'].replace('_', ' ')}).")
    comparable = [timing for timing in result["times"] if timing["comparable"]]
    if comparable:
        real = sum(timing["elapsed_seconds"] for timing in comparable)
        predicted = sum(timing["predicted_seconds"] for timing in comparable)
        lines.append(f"Overall, {len(comparable)} comparable walks: real {real:.1f} s against {predicted:.1f} s reference "
                     f"({(real / predicted - 1) * 100:+.1f}%).")
    else:
        lines.append("No walk had enough connected outdoor evidence for an overall comparison.")
    lines.extend(["", "## What this cannot establish", "",
                  "- One noisy pass usually establishes a building side, not the exact door. Repeated independent passes and photographs are needed.",
                  "- A footprint crossing or a quality collapse can be GPS drift, a covered walkway or a pause; confidence is a heuristic, not a calibrated probability.",
                  "- GPS cannot tell whether a door is LOCKED. Photograph the locked door and its posted-hours sign; those local photos carry time, position and heading.",
                  "- A through-building link is a hypothesis, not a verified indoor layout, opening-hours rule or step-free route.",
                  "- Accuracy extensions are metres when labelled as such; HDOP is dimensionless and is converted with a configurable estimate. Missing accuracy stays unknown.",
                  f"- {stats.get('unknown_accuracy', 0)} accepted-input fixes had unknown accuracy; {stats.get('hdop_estimated', 0)} used an HDOP estimate.",
                  "- Short drives below the sustained-speed window and slow vehicles may remain. Indoor fixes are not suitable for route timing.",
                  "- Footprints use the latest detailed snapshot, Capitol, outer building bodies and the runtime courtyard correction, with excluded buildings removed. Decorative/raised geometry is not a ground-level survey.",
                  "- Candidate paths are smoothed, simplified and grid-rounded, not raw points. They still describe visited places: review locally before publishing.",
                  "- The report, evidence and map are private working files. Only candidates.geojson is designed for public review; it contains no dates, timestamps, tracks or filenames.",
                  "", f"Settings: accuracy <= {settings.max_accuracy:g} m; sustained vehicle speed > {settings.vehicle_speed:g} m/s for "
                  f"{settings.vehicle_seconds:g} s; gap {settings.gap_seconds:g} s; door snap {settings.door_radius:g} m; "
                  f"off-graph > {settings.offgraph_distance:g} m for > {settings.offgraph_length:g} m.", ""])
    return "\n".join(lines)


def svg_map(result, scene, privacy, width=1800, height=1200):
    positions = [fix.position for walk in result["walks"] for fix in walk]
    if not positions:
        positions = [xy((scene.bounds[0], scene.bounds[1])), xy((scene.bounds[2], scene.bounds[3]))]
    door_positions = [xy(event["geometry"]["coordinates"]) for event in result["events"]
                      if event["geometry"]["type"] == "Point"]
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
             f'<rect width="{width}" height="{height}" fill="{COLORS["background"]}"/>',
             '<text x="45" y="42" font-size="28" fill="#34352f">Walking evidence - local review map</text>']

    def draw_region(region_positions, left, top, region_width, region_height, padding):
        minimum_x = min(position[0] for position in region_positions) - padding
        maximum_x = max(position[0] for position in region_positions) + padding
        minimum_y = min(position[1] for position in region_positions) - padding
        maximum_y = max(position[1] for position in region_positions) + padding
        scale = min(region_width / (maximum_x - minimum_x), region_height / (maximum_y - minimum_y))
        offset_x = left + (region_width - (maximum_x - minimum_x) * scale) / 2
        offset_y = top + (region_height - (maximum_y - minimum_y) * scale) / 2

        def screen(position):
            return (offset_x + (position[0] - minimum_x) * scale,
                    offset_y + (maximum_y - position[1]) * scale)

        def visible(position):
            return minimum_x <= position[0] <= maximum_x and minimum_y <= position[1] <= maximum_y

        def points(section):
            return " ".join(f"{screen(position)[0]:.1f},{screen(position)[1]:.1f}" for position in section)

        lines.append(f'<rect x="{left}" y="{top}" width="{region_width}" height="{region_height}" fill="{COLORS["background"]}"/>')
        for building in scene.buildings:
            for rings in building.polygons:
                if not any(visible(position) for position in rings[0]):
                    continue
                for index, ring in enumerate(rings):
                    lines.append(f'<polygon points="{points(ring)}" fill="{COLORS["building"] if index == 0 else COLORS["background"]}" stroke="{COLORS["wall"]}" stroke-width="1"/>')
        for door in scene.doors:
            if visible(door.position) and not privacy.reason(door.position):
                screen_x, screen_y = screen(door.position)
                lines.append(f'<circle cx="{screen_x:.1f}" cy="{screen_y:.1f}" r="3" fill="{COLORS["door"]}"/>')
        for walk in result["walks"]:
            section = []
            for fix in walk:
                if visible(fix.position):
                    section.append(fix.position)
                else:
                    if len(section) > 1:
                        lines.append(f'<polyline points="{points(section)}" fill="none" stroke="{COLORS["track"]}" stroke-width="2.5"/>')
                    section = []
            if len(section) > 1:
                lines.append(f'<polyline points="{points(section)}" fill="none" stroke="{COLORS["track"]}" stroke-width="2.5"/>')
        labelled = set()
        for event in result["events"]:
            kind = event["properties"]["kind"]
            geometry = event["geometry"]
            section = [xy(geometry["coordinates"])] if geometry["type"] == "Point" else [xy(coordinate) for coordinate in geometry["coordinates"]]
            if not all(visible(position) for position in section):
                continue
            if len(section) == 1:
                screen_x, screen_y = screen(section[0])
                lines.append(f'<circle cx="{screen_x:.1f}" cy="{screen_y:.1f}" r="8" fill="{COLORS[kind]}" stroke="#ffffff" stroke-width="2"/>')
                label_key = (kind, event["properties"].get("door_id"))
                label = f'Door {event["properties"]["door_id"]}' if kind == "door_confirmation" else "New door candidate"
                if label_key not in labelled:
                    lines.append(f'<text x="{screen_x + 13:.1f}" y="{screen_y - 13:.1f}" font-size="20" fill="{COLORS[kind]}">{html.escape(label)}</text>')
                    labelled.add(label_key)
            else:
                lines.append(f'<polyline points="{points(section)}" fill="none" stroke="{COLORS[kind]}" stroke-width="7"/>')

    draw_region(positions, 30, 170, 700, height - 220, 45)
    lines.append(f'<rect x="740" y="150" width="{width - 740}" height="{height - 150}" fill="{COLORS["background"]}"/>')
    lines.append('<text x="790" y="192" font-size="25" fill="#34352f">Door and through-building detail</text>')
    draw_region(door_positions or positions, 790, 220, width - 850, 670, 30)
    stats = result["stats"]
    captions = [f'{stats.get("walks", 0)} walks; {stats.get("retained_points", 0)} filtered fixes.',
                f'Removed: {stats.get("privacy", 0)} private, {stats.get("outside_area", 0)} outside area,',
                f'{stats.get("poor_accuracy", 0)} poor fixes and {stats.get("vehicle", 0)} driving fixes.',
                'Blue is the noisy phone track, not a surveyed line.',
                'Green confirms an existing public door group.',
                'Orange and purple are hypotheses for local review.']
    lines.append(f'<rect x="760" y="920" width="{width - 760}" height="280" fill="{COLORS["background"]}"/>')
    for index, caption in enumerate(captions):
        lines.append(f'<text x="790" y="{960 + index * 32}" font-size="21" fill="#53564e">{html.escape(caption)}</text>')
    lines.append(f'<rect x="0" y="0" width="{width}" height="155" fill="{COLORS["background"]}"/>')
    lines.append('<text x="45" y="42" font-size="28" fill="#34352f">Walking evidence - local review map</text>')
    labels = [("track", "Track (filtered)"), ("door_confirmation", "Doors confirmed"), ("new_door", "New door candidate"),
              ("shortcut", "Shortcut"), ("through_building", "Through-building link")]
    for index, (kind, label) in enumerate(labels):
        legend_x = 45 + index * 340
        lines.append(f'<line x1="{legend_x}" y1="90" x2="{legend_x + 28}" y2="90" stroke="{COLORS[kind]}" stroke-width="7"/>')
        lines.append(f'<text x="{legend_x + 40}" y="96" font-size="19" fill="#34352f">{label}</text>')
    lines.extend(['<text x="45" y="130" font-size="17" fill="#646459">Confidence is provisional. Privacy areas, poor fixes and sustained driving are removed. North is up.</text>', '</svg>'])
    return "\n".join(lines)


def write_outputs(result, scene, privacy, settings, output, roots=None):
    roots = repository_roots(scene.repo) if roots is None else roots
    output = require_external(output, roots, "Output directory")
    for name in ("report.md", "evidence.geojson", "candidates.geojson", "map.svg"):
        target = output / name
        require_external(target, roots, "Output file")
        if target.is_symlink() or (target.exists() and target.stat().st_nlink > 1):
            raise ValueError("Output files must not be symbolic or hard links")
    output.mkdir(parents=True, exist_ok=True)
    contents = {"report.md": report(result, scene, settings), "evidence.geojson": json.dumps(result["evidence"], indent=2, allow_nan=False) + "\n",
                "candidates.geojson": json.dumps(result["candidates"], indent=2, allow_nan=False) + "\n", "map.svg": svg_map(result, scene, privacy)}
    for name, content in contents.items():
        (output / name).write_text(content, encoding="utf-8")
