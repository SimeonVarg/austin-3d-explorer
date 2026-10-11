"""CLI outputs must never replace the evidence their receipts identify."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import test_projection_check

SCRIPTS = Path(__file__).resolve().parent


class EvidenceCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture = test_projection_check.ProjectionTests(); fixture.setUp()
        fixture.pose.update(ground_z=0, local_angles=dict(yaw=0, pitch=0, roll=0, hfov=84))
        values = dict(pose=fixture.pose, plan=fixture.plan, projection=fixture.snapshot,
                      recipe={'frame': {'obb': {'o': [0, 0], 'ax': 1, 'ay': 0, 'mx': 100, 'my': 100}}})
        self.files = {key: self.root / (key+'.json') for key in values}
        for key, value in values.items(): self.files[key].write_text(json.dumps(value))
        self.original = {path: path.read_bytes() for path in self.files.values()}
        self.out, self.view = self.root/'result.json', self.root/'view.json'

    def run_cli(self, script, **args):
        command = [sys.executable, str(SCRIPTS/script)]
        for key, value in args.items(): command += ['--'+key.replace('_', '-'), str(value)]
        return subprocess.run(command, capture_output=True, text=True)

    def pose_cli(self, out, view):
        return self.run_cli('pose_check.py', pose=self.files['pose'], recipe=self.files['recipe'], out=out, view_out=view)

    def assert_preserved(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must not overwrite', result.stderr)
        for path, data in self.original.items(): self.assertEqual(path.read_bytes(), data)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.view.exists())

    def test_pose_each_output_cannot_replace_either_input(self):
        for path in (self.files['pose'], self.files['recipe']):
            for out, view in ((path, self.view), (self.out, path)):
                with self.subTest(out=out.name, view=view.name):
                    self.assert_preserved(self.pose_cli(out, view))

    def test_pose_outputs_cannot_replace_each_other(self):
        self.assert_preserved(self.pose_cli(self.out, self.out))

    def test_projection_output_cannot_replace_any_input(self):
        for key in ('pose', 'plan', 'projection'):
            with self.subTest(key=key):
                self.assert_preserved(self.run_cli('projection_check.py',
                    **{k:self.files[k] for k in ('pose','plan','projection')}, out=self.files[key], limit_px=1))

    def test_aliases_are_rejected_before_either_write(self):
        for hard in (False, True):
            alias = self.root/('hardlink.json' if hard else 'symlink.json')
            if hard: os.link(self.files['recipe'], alias)
            else: alias.symlink_to(self.files['recipe'])
            self.assert_preserved(self.pose_cli(self.out, alias))
        alias = self.root/'output-alias.json'; alias.symlink_to(self.out)
        self.assert_preserved(self.pose_cli(self.out, alias))

    def test_unrelated_output_can_be_replaced_with_hash_bound_result(self):
        self.out.write_text('previous unrelated result')
        result = self.pose_cli(self.out, self.view)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(self.out.read_text())
        self.assertEqual(receipt['input']['file'], str(self.files['pose'].resolve()))
        self.assertEqual(json.loads(self.view.read_text())['camera_math_version'], 2)
        result = self.run_cli('projection_check.py',
            **{k:self.files[k] for k in ('pose','plan','projection')}, out=self.out, limit_px=1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.out.read_text())['status'], 'CONSISTENT')
        for path, data in self.original.items(): self.assertEqual(path.read_bytes(), data)


if __name__ == '__main__': unittest.main()
