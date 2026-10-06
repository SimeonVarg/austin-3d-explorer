"""Runtime boundary tests; the suite never installs a package."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("photo_setup", HERE / "setup.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def command(self, *args):
        return subprocess.run([sys.executable, str(HERE / "setup.py"), *args],
                              capture_output=True, text=True)

    def test_reuse_checks_real_features_without_writing_runtime(self):
        python = Path(sys.executable).absolute()
        parent = python.parent
        before = {p.name: p.stat().st_mtime_ns for p in parent.iterdir()}
        result = self.command("--reuse-python", str(python))
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertTrue(receipt["reused"])
        self.assertEqual(receipt["packages"], setup.pins())
        self.assertIn("polygon-subtraction", receipt["smoke_tests"])
        self.assertEqual(before, {p.name: p.stat().st_mtime_ns for p in parent.iterdir()})

    def test_checkout_runtime_refused_before_writing(self):
        unsafe = HERE / "runtime"
        result = self.command("--runtime-root", str(unsafe))
        self.assertEqual(result.returncode, 2)
        self.assertIn("outside every Git checkout", result.stderr)
        self.assertFalse(unsafe.exists())

    def test_unknown_existing_directory_never_modified(self):
        with tempfile.TemporaryDirectory(prefix="photo-setup-test-") as folder:
            root = Path(folder)
            import hashlib, platform
            name = "%s-py%d.%d-%s" % (hashlib.sha256(setup.LOCK.read_bytes()).hexdigest()[:12],
                                     sys.version_info.major, sys.version_info.minor, platform.machine())
            runtime = root / name
            runtime.mkdir()
            sentinel = runtime / "important.txt"
            sentinel.write_text("preserve")
            result = self.command("--runtime-root", str(root))
            self.assertEqual(result.returncode, 2)
            self.assertIn("unrecognized existing directory", result.stderr)
            self.assertEqual(list(runtime.iterdir()), [sentinel])
            self.assertEqual(sentinel.read_text(), "preserve")

    def test_check_missing_runtime_never_installs(self):
        with tempfile.TemporaryDirectory(prefix="photo-setup-test-") as folder:
            result = self.command("--runtime-root", folder, "--check", "--offline")
            self.assertEqual(result.returncode, 1)
            self.assertIn("absent or failed checks", result.stderr)
            self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
