#!/usr/bin/env python3
"""Hash-bound capture receipts and comparison sheets. All output stays private."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

MIN_BUILDING_FRACTION = 0.01
MAX_FLAT_FRACTION = 0.97
COLOUR_BIN = 8  # Ignore tiny JPEG/noise differences in an otherwise blank frame.
MASK_THRESHOLD = 127
HEADER_HEIGHT = 40
ROLES = ("photo", "before", "after", "trees_off")


class Rejected(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text())


def private_path(path):
    path = Path(path).expanduser().resolve()
    if any((parent / ".git").exists() for parent in (path, *path.parents)):
        raise Rejected("outputs must stay outside Git checkouts")
    return path


def write_json(path, value):
    path = private_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical(value) + b"\n")


def asset(path):
    path = Path(path).expanduser().resolve()
    data = path.read_bytes()
    return {"file": str(path), "sha256": sha(data)}


def verified(record):
    data = Path(record["file"]).read_bytes()
    if sha(data) != record["sha256"]:
        raise Rejected("file changed since capture: %s" % record["file"])
    return data


def image_pixels(data):
    with Image.open(io.BytesIO(data)) as image:
        # Use the stored pixel frame, never rotate camera evidence silently.
        if image.getexif().get(274, 1) != 1:
            raise Rejected("frame has unapplied EXIF rotation")
        if ("transparency" in image.info or
                ("A" in image.getbands() and image.getextrema()[-1] != (255, 255))):
            raise Rejected("frame has transparent pixels")
        return np.asarray(image.convert("RGB")).copy()


def crop_box(crop, pixels):
    h, w = pixels.shape[:2]
    if crop is None:
        return (0, 0, w, h)
    if (not isinstance(crop, list) or len(crop) != 4
            or any(type(v) is not int for v in crop)):
        raise Rejected("crop must be four integer pixel coordinates")
    x0, y0, x1, y1 = crop
    if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
        raise Rejected("crop is outside the frame")
    return tuple(crop)


def quality(frame_data, mask_data, crop=None):
    pixels = image_pixels(frame_data)
    with Image.open(io.BytesIO(mask_data)) as image:
        if image.mode not in ("1", "L"):
            raise Rejected("building mask must be a single-channel image")
        if image.getexif().get(274, 1) != 1 or "transparency" in image.info:
            raise Rejected("mask has unapplied orientation or transparency")
        mask = np.asarray(image.convert("L")).copy()
    if mask.shape != pixels.shape[:2]:
        raise Rejected("mask and frame dimensions differ")
    x0, y0, x1, y1 = crop_box(crop, pixels)
    region = pixels[y0:y1, x0:x1]
    mask = mask[y0:y1, x0:x1]
    # Full pixel population, not a thumbnail which can miss the sole sky panel.
    quant = region.astype(np.uint32) // COLOUR_BIN
    codes = (quant[:, :, 0] * 32 + quant[:, :, 1]) * 32 + quant[:, :, 2]
    dominant = float(np.bincount(codes.ravel(), minlength=32768).max() / codes.size)
    fraction = float(np.count_nonzero(mask > MASK_THRESHOLD) / mask.size)
    if fraction <= MIN_BUILDING_FRACTION:
        raise Rejected("building covers %.3f%%; must exceed 1%%" % (fraction * 100))
    if dominant > MAX_FLAT_FRACTION:
        raise Rejected("frame is %.3f%% one colour bin; maximum is 97%%" % (dominant * 100))
    return {"width": pixels.shape[1], "height": pixels.shape[0],
            "building_fraction": fraction, "dominant_colour_fraction": dominant}


def begin(recipe, camera, camera_tag, settings, output):
    if not camera_tag:
        raise Rejected("camera tag must be nonempty")
    settings_value = read_json(settings)
    if not isinstance(settings_value, dict) or type(settings_value.get("trees")) is not bool:
        raise Rejected("settings must be an object with an explicit boolean trees field")
    result = {"schema": 1, "kind": "capture-inputs", "started_ns": time.time_ns(),
              "recipe": asset(recipe), "camera": asset(camera), "camera_tag": camera_tag,
              "settings": asset(settings), "settings_value": settings_value}
    write_json(output, result)
    return result


def seal(inputs_path, frame, mask, output):
    inputs_record = asset(inputs_path)
    inputs = json.loads(verified(inputs_record))
    if inputs.get("kind") != "capture-inputs" or inputs.get("schema") != 1:
        raise Rejected("unknown capture-inputs receipt")
    for name in ("recipe", "camera", "settings"):
        verified(inputs[name])
    for path in (frame, mask):
        if Path(path).stat().st_mtime_ns < inputs["started_ns"]:
            raise Rejected("output predates capture start: %s" % path)
    frame_record, mask_record = asset(frame), asset(mask)
    metrics = quality(verified(frame_record), verified(mask_record))
    result = {"schema": 1, "kind": "capture", "inputs": inputs_record,
              "frame": frame_record, "mask": mask_record, "quality": metrics}
    write_json(output, result)
    return result


def capture(path):
    record = asset(path)
    value = json.loads(verified(record))
    if value.get("kind") != "capture" or value.get("schema") != 1:
        raise Rejected("unknown capture receipt")
    inputs = json.loads(verified(value["inputs"]))
    if inputs.get("kind") != "capture-inputs" or inputs.get("schema") != 1:
        raise Rejected("unknown capture-inputs receipt")
    for name in ("recipe", "camera", "settings"):
        verified(inputs[name])
    settings = json.loads(verified(inputs["settings"]))
    if settings != inputs["settings_value"]:
        raise Rejected("settings content differs from capture record")
    if type(settings.get("trees")) is not bool:
        raise Rejected("settings must explicitly say whether trees are drawn")
    frame_data, mask_data = verified(value["frame"]), verified(value["mask"])
    metrics = quality(frame_data, mask_data)
    if metrics != value["quality"]:
        raise Rejected("capture quality record is inconsistent")
    return {"receipt": record, "frame": value["frame"], "mask": value["mask"],
            "recipe": inputs["recipe"], "camera": inputs["camera"],
            "camera_tag": inputs["camera_tag"], "settings": inputs["settings"],
            "settings_value": settings, "quality": metrics}


def accept(plan_path, output):
    plan_record = asset(plan_path)
    plan = json.loads(verified(plan_record))
    if plan.get("schema") != 1:
        raise Rejected("plan schema must be 1")
    baseline, candidate = asset(plan["before_recipe"]), asset(plan["after_recipe"])
    if not isinstance(plan.get("sheets"), dict) or not plan["sheets"]:
        raise Rejected("plan must contain at least one sheet")
    sheets = {}
    for tag, sheet in plan["sheets"].items():
        if not tag or not isinstance(tag, str) or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in tag):
            raise Rejected("sheet IDs must contain only letters, digits, hyphens and underscores")
        status = sheet["status"]
        if status not in ("PASS", "CHECK"):
            raise Rejected("camera status must be PASS or CHECK")
        camera_record = asset(sheet["camera_file"])
        settings_record = asset(sheet["settings_file"])
        settings = json.loads(verified(settings_record))
        if settings.get("trees") is not True:
            raise Rejected("comparison settings must enable trees")
        panels = {"photo": {"frame": asset(sheet["photo"]), "camera_tag": tag}}
        for role in ROLES[1:]:
            panel = capture(sheet[role])
            wanted_recipe = baseline if role == "before" else candidate
            if panel["recipe"]["sha256"] != wanted_recipe["sha256"]:
                raise Rejected("%s/%s uses the wrong recipe" % (tag, role))
            if panel["camera_tag"] != tag or panel["camera"]["sha256"] != camera_record["sha256"]:
                raise Rejected("%s/%s uses a different camera" % (tag, role))
            wanted_settings = dict(settings, trees=False) if role == "trees_off" else settings
            if panel["settings_value"] != wanted_settings:
                raise Rejected("%s/%s uses different drawing settings" % (tag, role))
            panels[role] = panel
        dimensions = {image_pixels(verified(p["frame"])).shape[:2] for p in panels.values()}
        if len(dimensions) != 1:
            raise Rejected("%s panels have different frame dimensions" % tag)
        crop = list(crop_box(sheet.get("crop"), image_pixels(verified(panels["photo"]["frame"]))))
        for role in ROLES[1:]:
            p = panels[role]
            p["crop_quality"] = quality(verified(p["frame"]), verified(p["mask"]), crop)
        sheets[tag] = {"status": status, "crop": crop, "camera": camera_record,
                       "settings": settings_record, "panels": panels}
    result = {"schema": 1, "kind": "accepted-comparison", "plan": plan_record,
              "before_recipe": baseline, "after_recipe": candidate,
              "quality_policy": {"min_building_fraction_exclusive": MIN_BUILDING_FRACTION,
                                 "max_flat_fraction": MAX_FLAT_FRACTION,
                                 "colour_bin_width": COLOUR_BIN,
                                 "mask_threshold": MASK_THRESHOLD},
              "sheets": sheets}
    write_json(output, result)
    return result


def verify_manifest(path):
    value = read_json(path)
    if value.get("kind") != "accepted-comparison" or value.get("schema") != 1:
        raise Rejected("unknown comparison manifest")
    # Re-run acceptance into memory and compare the complete result. A manually
    # inserted stale panel, altered camera or weaker threshold cannot slip in.
    import tempfile
    with tempfile.TemporaryDirectory(prefix="photo-accept-") as folder:
        expected = accept(value["plan"]["file"], Path(folder) / "manifest.json")
    verified(value["plan"])
    if expected != value:
        raise Rejected("manifest differs from the accepted plan")
    return value


def sheets(manifest, out_dir):
    value = verify_manifest(manifest)
    out_dir = private_path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = {}
    for tag, sheet in value["sheets"].items():
        x0, y0, x1, y1 = sheet["crop"]
        w, h = x1 - x0, y1 - y0
        canvas = Image.new("RGB", (w * len(ROLES), h + HEADER_HEIGHT), "#eeeeee")
        draw = ImageDraw.Draw(canvas)
        for index, role in enumerate(ROLES):
            # Paste verified bytes, not a second path read that can race a capture.
            panel = image_pixels(verified(sheet["panels"][role]["frame"]))[y0:y1, x0:x1]
            canvas.paste(Image.fromarray(panel), (index * w, HEADER_HEIGHT))
            label = role.replace("_", " ")
            if sheet["status"] == "CHECK":
                label += " | CAMERA NOT PROVEN"
            draw.text((index * w + 8, 10), label, fill="black")
        path = out_dir / (tag + ".png")
        canvas.save(path)  # Lossless panels allow a later independent pixel check.
        outputs[tag] = asset(path)
    receipt = {"schema": 1, "kind": "comparison-sheets", "manifest": asset(manifest),
               "header_height": HEADER_HEIGHT, "roles": list(ROLES), "sheets": outputs}
    # Inputs must still be intact when the complete sheet set is sealed.
    verify_manifest(manifest)
    write_json(out_dir / "sheets.json", receipt)
    return receipt


def verify_sheets(receipt_path):
    receipt = read_json(receipt_path)
    if (receipt.get("kind") != "comparison-sheets" or receipt.get("schema") != 1
            or receipt.get("roles") != list(ROLES) or receipt.get("header_height") != HEADER_HEIGHT):
        raise Rejected("unknown sheet receipt")
    verified(receipt["manifest"])
    manifest = verify_manifest(receipt["manifest"]["file"])
    if set(receipt["sheets"]) != set(manifest["sheets"]):
        raise Rejected("sheet set differs from manifest")
    for tag, sheet in manifest["sheets"].items():
        pixels = image_pixels(verified(receipt["sheets"][tag]))
        x0, y0, x1, y1 = sheet["crop"]
        w, h = x1 - x0, y1 - y0
        if pixels.shape[:2] != (h + HEADER_HEIGHT, len(ROLES) * w):
            raise Rejected("sheet dimensions differ from manifest")
        for index, role in enumerate(ROLES):
            source = image_pixels(verified(sheet["panels"][role]["frame"]))[y0:y1, x0:x1]
            actual = pixels[HEADER_HEIGHT:, index * w:(index + 1) * w]
            if not np.array_equal(actual, source):
                raise Rejected("%s/%s sheet pixels do not match the accepted frame" % (tag, role))
    return {"verified_sheets": len(manifest["sheets"])}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("begin", help="snapshot inputs before rendering")
    for key in ("recipe", "camera", "settings", "out"):
        p.add_argument("--" + key, type=Path, required=True)
    p.add_argument("--camera-tag", required=True)
    p = commands.add_parser("seal", help="validate a fresh frame and bind it to the input snapshot")
    for key in ("inputs", "frame", "mask", "out"):
        p.add_argument("--" + key, type=Path, required=True)
    p = commands.add_parser("accept", help="reject stale or inconsistent comparisons")
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p = commands.add_parser("sheets", help="build lossless sheets only from an accepted manifest")
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p = commands.add_parser("verify", help="check hashes, plan consistency and actual sheet panel pixels")
    p.add_argument("--sheets", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "begin":
        result = begin(args.recipe, args.camera, args.camera_tag, args.settings, args.out)
    elif args.command == "seal":
        result = seal(args.inputs, args.frame, args.mask, args.out)
    elif args.command == "accept":
        result = accept(args.plan, args.out)
    elif args.command == "sheets":
        result = sheets(args.manifest, args.out_dir)
    else:
        result = verify_sheets(args.sheets)
    # Never print private camera contents; detailed receipts remain in the run.
    print(json.dumps({"command": args.command, "ok": True,
                      "count": result.get("verified_sheets", len(result.get("sheets", {})))}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, KeyError, TypeError, ValueError) as error:
        print("Acceptance failed: %s" % error, file=sys.stderr)
        raise SystemExit(1)
