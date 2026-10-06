"""Synthetic-coordinate tests for the cross-renderer camera datum contract."""

import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from camera import camera_link, main


class CameraLinkTests(unittest.TestCase):
    def setUp(self):
        self.eye = {"lng": 12.3456789, "lat": 45.6789123, "alt": 27.5,
                    "bearing": -45, "pitch": 70}

    def params(self, **kwargs):
        return {key: values[0] for key, values in parse_qs(
            urlsplit(camera_link(self.eye, 123.25, **kwargs)).fragment
        ).items()}

    def test_eye_position_and_explicit_datum_are_preserved(self):
        params = self.params()
        self.assertEqual(float(params["lon"]), self.eye["lng"])
        self.assertEqual(float(params["lat"]), self.eye["lat"])
        self.assertEqual(float(params["alt"]), 150.75)
        self.assertEqual(params["map"], "esri-imagery")
        self.assertEqual(params["style"], "normal")

    def test_pitch_convention_and_wrapped_bearing(self):
        params = self.params()
        self.assertEqual(float(params["pitch"]), -20)
        self.assertEqual(float(params["heading"]), 315)
        for source, expected in [(0, -90), (90, 0)]:
            with self.subTest(pitch=source):
                self.eye["pitch"] = source
                self.assertEqual(float(self.params()["pitch"]), expected)

    def test_optional_roll_and_photoreal_stack(self):
        self.eye["roll"] = -3.5
        params = self.params(map_stack="photoreal")
        self.assertEqual(float(params["roll"]), -3.5)
        self.assertEqual(params["map"], "photoreal")

    def test_negative_ellipsoid_datum_is_valid(self):
        params = parse_qs(urlsplit(camera_link(self.eye, -40)).fragment)
        self.assertEqual(float(params["alt"][0]), -12.5)

    def test_eye_diagnostics_do_not_become_share_fields(self):
        self.eye.update({"altUser": 28, "vE": 5, "driving": False})
        params = self.params()
        self.assertNotIn("vE", params)
        self.assertNotIn("altUser", params)

    def test_center_pose_cannot_substitute_for_eye(self):
        with self.assertRaisesRegex(ValueError, "missing required fields"):
            camera_link({"center": [12, 45], "zoom": 17, "pitch": 70}, 123)

    def test_missing_or_unknown_datum_is_rejected(self):
        with self.assertRaises(TypeError):
            camera_link(self.eye)
        for datum in [None, "123", True, float("nan"), float("inf")]:
            with self.subTest(datum=datum), self.assertRaises(ValueError):
                camera_link(self.eye, datum)

    def test_invalid_numeric_fields_are_rejected(self):
        for field in self.eye:
            for value in [None, True, "1", float("nan"), float("inf")]:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    camera_link({**self.eye, field: value}, 123)

    def test_coordinate_orientation_and_height_bounds(self):
        bad_values = {"lng": [-180.01, 180.01], "lat": [-90.01, 90.01],
                      "alt": [-0.1], "bearing": [-360.01, 360.01],
                      "pitch": [-0.01, 90.01], "roll": [-180.01, 180.01]}
        for field, values in bad_values.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    camera_link({**self.eye, field: value}, 123)

    def test_overflow_is_rejected(self):
        with self.assertRaises(ValueError):
            camera_link({**self.eye, "alt": 1e308}, 1e308)
        with self.assertRaises(ValueError):
            camera_link({**self.eye, "alt": 10 ** 400}, 123)

    def test_default_is_loopback_and_explicit_app_path_survives(self):
        url = urlsplit(camera_link(self.eye, 123))
        self.assertEqual(url.hostname, "localhost")
        self.assertEqual(url.port, 4174)
        url = urlsplit(camera_link(self.eye, 123, "http://127.0.0.1:4174/reference/"))
        self.assertEqual(url.path, "/reference/")

    def test_unsafe_or_ambiguous_base_urls_are_rejected(self):
        for base in ["file:///tmp/reference", "javascript:alert(1)", "/relative",
                     "http://user:secret@localhost:4174", "http://localhost:0",
                     "http://localhost:70000", "http://localhost:bad",
                     "http://localhost:4174?setup=1", "http://localhost:4174#lat=1",
                     "http://local host:4174", "http://[broken"]:
            with self.subTest(base=base), self.assertRaises(ValueError):
                camera_link(self.eye, 123, base)

    def test_unknown_map_and_non_object_input_are_rejected(self):
        with self.assertRaises(ValueError):
            camera_link(self.eye, 123, map_stack="unknown")
        with self.assertRaises(ValueError):
            camera_link([12, 45], 123)

    def test_cli_prints_only_link_and_requires_datum(self):
        with tempfile.TemporaryDirectory() as directory:
            eye_file = Path(directory) / "synthetic-eye.json"
            eye_file.write_text(json.dumps(self.eye), encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main(["--eye", str(eye_file), "--ground-ellipsoid", "123.25"])
            self.assertEqual(output.getvalue().strip(), camera_link(self.eye, 123.25))
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exit_result:
                main(["--eye", str(eye_file)])
            self.assertEqual(exit_result.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
