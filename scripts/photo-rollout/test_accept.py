"""Synthetic failure cases; never reads a real photo, camera or recipe."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("photo_accept", HERE / "accept.py")
accept = importlib.util.module_from_spec(spec)
spec.loader.exec_module(accept)


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="photo-rollout-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.before = self.json("before.json", {"blocks": [1]})
        self.after = self.json("after.json", {"blocks": [2]})
        self.camera = self.json("camera.json", {"outW": 100, "outH": 100, "pitch": 60})
        self.settings = self.json("settings.json", {"trees": True, "hour": 12, "shadows": True})
        self.settings_off = self.json("settings-off.json", {"trees": False, "hour": 12, "shadows": True})
        self.photo = self.frame("photo.png", 4)
        self.plan = {"schema": 1, "before_recipe": str(self.before), "after_recipe": str(self.after),
                     "sheets": {"view-a": {"status": "PASS", "camera_file": str(self.camera),
                       "settings_file": str(self.settings), "photo": str(self.photo),
                       "before": str(self.captured("before", self.before, self.settings, 1)),
                       "after": str(self.captured("after", self.after, self.settings, 2)),
                       "trees_off": str(self.captured("trees-off", self.after, self.settings_off, 3))}}}
        self.plan_path = self.json("plan.json", self.plan)
        self.manifest = self.root / "manifest.json"

    def json(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        return path

    def frame(self, name, offset=0):
        y, x = np.mgrid[:100, :100]
        pixels = np.stack([(x * 7 + offset) % 256, (y * 5 + offset) % 256,
                           ((x + y) * 3 + offset) % 256], axis=-1).astype(np.uint8)
        path = self.root / name
        Image.fromarray(pixels).save(path)
        return path

    def mask(self, name):
        pixels = np.zeros((100, 100), dtype=np.uint8)
        pixels[25:75, 25:75] = 255
        path = self.root / name
        Image.fromarray(pixels).save(path)
        return path

    def captured(self, name, recipe, settings, offset=0, camera=None):
        inputs = self.root / (name + "-inputs.json")
        accept.begin(recipe, camera or self.camera, "view-a", settings, inputs)
        frame = self.frame(name + ".png", offset)
        mask = self.mask(name + "-mask.png")
        receipt = self.root / (name + "-capture.json")
        accept.seal(inputs, frame, mask, receipt)
        return receipt

    def accept(self):
        self.plan_path.write_text(json.dumps(self.plan))
        return accept.accept(self.plan_path, self.manifest)

    def test_complete_pipeline_and_cli(self):
        self.accept()
        accept.sheets(self.manifest, self.root / "pairs")
        result = subprocess.run([sys.executable, str(HERE / "accept.py"), "verify",
                                 "--sheets", str(self.root / "pairs/sheets.json")],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["count"], 1)

    def test_changed_render_rejected(self):
        self.frame("after.png", 19)
        with self.assertRaisesRegex(accept.Rejected, "changed since capture"):
            self.accept()

    def test_changed_mask_rejected(self):
        Image.new("L", (100, 100), 255).save(self.root / "after-mask.png")
        with self.assertRaisesRegex(accept.Rejected, "changed since capture"):
            self.accept()

    def test_recipe_changed_after_capture_rejected(self):
        self.after.write_text('{"blocks":[99]}')
        with self.assertRaisesRegex(accept.Rejected, "changed since capture"):
            self.accept()

    def test_old_candidate_capture_rejected(self):
        other = self.json("older.json", {"blocks": [0]})
        self.plan["sheets"]["view-a"]["after"] = str(self.captured("older", other, self.settings))
        with self.assertRaisesRegex(accept.Rejected, "wrong recipe"):
            self.accept()

    def test_different_camera_rejected(self):
        other = self.json("other-camera.json", {"outW": 100, "outH": 100, "pitch": 55})
        self.plan["sheets"]["view-a"]["after"] = str(self.captured("other", self.after, self.settings, camera=other))
        with self.assertRaisesRegex(accept.Rejected, "different camera"):
            self.accept()

    def test_camera_tag_mismatch_rejected(self):
        path = self.root / "after-inputs.json"
        data = accept.read_json(path)
        data["camera_tag"] = "other-view"
        path.write_text(json.dumps(data))
        receipt = accept.read_json(self.root / "after-capture.json")
        receipt["inputs"] = accept.asset(path)
        (self.root / "after-capture.json").write_text(json.dumps(receipt))
        with self.assertRaisesRegex(accept.Rejected, "different camera"):
            self.accept()

    def test_different_hour_rejected(self):
        other = self.json("other-settings.json", {"trees": True, "hour": 17, "shadows": True})
        self.plan["sheets"]["view-a"]["after"] = str(self.captured("other", self.after, other))
        with self.assertRaisesRegex(accept.Rejected, "different drawing settings"):
            self.accept()

    def test_trees_off_may_change_only_trees(self):
        other = self.json("other-settings.json", {"trees": False, "hour": 12, "shadows": False})
        self.plan["sheets"]["view-a"]["trees_off"] = str(self.captured("other", self.after, other))
        with self.assertRaisesRegex(accept.Rejected, "different drawing settings"):
            self.accept()

    def test_frame_predating_begin_rejected(self):
        inputs = self.root / "fresh-inputs.json"
        accept.begin(self.after, self.camera, "view-a", self.settings, inputs)
        os.utime(self.root / "after.png", ns=(1, 1))
        with self.assertRaisesRegex(accept.Rejected, "predates capture start"):
            accept.seal(inputs, self.root / "after.png", self.root / "after-mask.png", self.root / "fresh.json")

    def test_input_change_during_render_rejected(self):
        inputs = self.root / "fresh-inputs.json"
        accept.begin(self.after, self.camera, "view-a", self.settings, inputs)
        self.after.write_text('{"blocks":[3]}')
        with self.assertRaisesRegex(accept.Rejected, "changed since capture"):
            accept.seal(inputs, self.frame("fresh.png"), self.mask("fresh-mask.png"), self.root / "fresh.json")

    def test_blank_and_nearly_blank_rejected(self):
        mask = (self.root / "after-mask.png").read_bytes()
        for noisy in (False, True):
            pixels = np.full((100, 100, 3), 128, dtype=np.uint8)
            if noisy:
                pixels[::2] += 1  # Would defeat an exact-colour-only count.
            path = self.root / "blank.png"
            Image.fromarray(pixels).save(path)
            with self.assertRaisesRegex(accept.Rejected, "one colour bin"):
                accept.quality(path.read_bytes(), mask)

    def test_mask_presence_is_not_self_reported(self):
        mask = self.root / "empty.png"
        Image.new("L", (100, 100), 0).save(mask)
        with self.assertRaisesRegex(accept.Rejected, "building covers"):
            accept.quality((self.root / "after.png").read_bytes(), mask.read_bytes())

    def test_exactly_one_percent_fails(self):
        pixels = np.zeros((100, 100), dtype=np.uint8)
        pixels.flat[:100] = 255
        mask = self.root / "small.png"
        Image.fromarray(pixels).save(mask)
        with self.assertRaisesRegex(accept.Rejected, "must exceed 1%"):
            accept.quality((self.root / "after.png").read_bytes(), mask.read_bytes())
        pixels.flat[100] = 255
        Image.fromarray(pixels).save(mask)
        self.assertAlmostEqual(accept.quality((self.root / "after.png").read_bytes(), mask.read_bytes())["building_fraction"], .0101)

    def test_mask_size_must_match(self):
        mask = self.root / "wrong-size.png"
        Image.new("L", (99, 100), 255).save(mask)
        with self.assertRaisesRegex(accept.Rejected, "dimensions differ"):
            accept.quality((self.root / "after.png").read_bytes(), mask.read_bytes())

    def test_crop_cannot_hide_missing_building(self):
        self.plan["sheets"]["view-a"]["crop"] = [0, 0, 20, 20]
        with self.assertRaisesRegex(accept.Rejected, "building covers"):
            self.accept()

    def test_camera_check_is_retained(self):
        self.plan["sheets"]["view-a"]["status"] = "CHECK"
        data = self.accept()
        self.assertEqual(data["sheets"]["view-a"]["status"], "CHECK")
        accept.sheets(self.manifest, self.root / "pairs")
        self.assertEqual(accept.verify_sheets(self.root / "pairs/sheets.json")["verified_sheets"], 1)

    def test_stale_panel_rejected_even_if_sheet_hash_updated(self):
        self.accept()
        accept.sheets(self.manifest, self.root / "pairs")
        path = self.root / "pairs/view-a.png"
        with Image.open(path) as image:
            image = image.copy()
        image.paste(Image.new("RGB", (100, 100), "skyblue"), (200, accept.HEADER_HEIGHT))
        image.save(path)
        receipt_path = self.root / "pairs/sheets.json"
        receipt = accept.read_json(receipt_path)
        receipt["sheets"]["view-a"] = accept.asset(path)
        receipt_path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(accept.Rejected, "sheet pixels do not match"):
            accept.verify_sheets(receipt_path)

    def test_edited_manifest_rejected(self):
        data = self.accept()
        data["quality_policy"]["max_flat_fraction"] = 1.0
        self.manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(accept.Rejected, "differs from the accepted plan"):
            accept.verify_manifest(self.manifest)

    def test_private_output_guard(self):
        with self.assertRaisesRegex(accept.Rejected, "outside Git"):
            accept.write_json(HERE / "unsafe.json", {"camera_tag": "view-a"})
        self.assertFalse((HERE / "unsafe.json").exists())

    def test_bad_cli_returns_nonzero(self):
        result = subprocess.run([sys.executable, str(HERE / "accept.py"), "seal",
                                 "--inputs", str(self.root / "after-inputs.json"),
                                 "--frame", str(self.root / "missing.png"),
                                 "--mask", str(self.root / "after-mask.png"),
                                 "--out", str(self.root / "bad.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Acceptance failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
