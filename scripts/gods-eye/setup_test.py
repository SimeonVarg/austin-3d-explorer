"""Test setup refusal and cleanup paths without installing or running browsers."""

import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import setup as companion


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "companion"
        self.root.mkdir()
        (self.root / ".git").mkdir()
        self.original = {"name": "synthetic-companion", "dependencies": {"safe": "1.0.0"}}
        self.overrides = json.loads((companion.HERE / "dependency-overrides.json").read_text())
        self.lock = {"lockfileVersion": 3, "packages": {"": self.original,
            "node_modules/dompurify": {"version": "3.4.15", "resolved": "old",
                "integrity": "sha512-old", "license": "MIT"},
            "node_modules/source-map-js": {"version": "1.2.1", "resolved": "old",
                "integrity": "sha512-old", "dev": True},
            "node_modules/safe": {"version": "1.0.0", "resolved": "unchanged"}}}
        self.write_manifests(self.original, self.lock)

    def write_manifests(self, manifest, lock):
        (self.root / "package.json").write_text(json.dumps(manifest))
        (self.root / "package-lock.json").write_text(json.dumps(lock))

    def git(self, command, *args, **kwargs):
        if command[:2] == ["git", "show"]:
            document = self.lock if command[-1].endswith("package-lock.json") else self.original
            return SimpleNamespace(stdout=json.dumps(document))
        if command[:3] == ["git", "remote", "get-url"]:
            return SimpleNamespace(stdout=companion.UPSTREAM)
        if command[:2] == ["git", "rev-parse"]:
            return SimpleNamespace(stdout=companion.REVISION)
        return SimpleNamespace(stdout="")

    def patched_lock(self):
        lock = json.loads(json.dumps(self.lock))
        for package, version in self.overrides.items():
            entry = lock["packages"]["node_modules/" + package]
            entry.update(version=version,
                         resolved=f"https://registry.npmjs.org/{package}/-/{package}-{version}.tgz",
                         integrity="sha512-synthetic")
        return lock

    def test_keyless_environment_overrides_provider_and_launcher_fallback(self):
        inherited = {key: "synthetic-provider" for key in companion.PROVIDERS}
        inherited.update(HOST="0.0.0.0", PORT="9999", GEV_PROJECT_ROOT="/unrelated",
                         OPENSKY_AUTH_MODE="auto")
        with patch.dict(os.environ, inherited, clear=True):
            env = companion.environment()
        self.assertTrue(all(env[key] == "" for key in companion.PROVIDERS))
        self.assertEqual(env["OPENSKY_AUTH_MODE"], "anon")
        self.assertEqual((env["HOST"], env["PORT"]), ("127.0.0.1", "4174"))
        self.assertNotIn("GEV_PROJECT_ROOT", env)
        self.assertEqual(env["PUPPETEER_SKIP_DOWNLOAD"], "1")

    def test_provider_opt_in_retains_only_explicit_values(self):
        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "synthetic", "HOST": "0.0.0.0"}, clear=True):
            env = companion.environment(with_providers=True)
        self.assertEqual(env["GOOGLE_MAPS_API_KEY"], "synthetic")
        self.assertNotIn("CESIUM_ION_TOKEN", env)
        self.assertEqual(env["HOST"], "127.0.0.1")

    def test_checkout_inside_austin_is_refused_before_commands(self):
        with patch.object(companion, "run") as run:
            with self.assertRaises(ValueError):
                companion.setup(companion.AUSTIN_ROOT / "vendor-companion")
        run.assert_not_called()

    def test_wrong_revision_or_remote_is_refused_without_checkout(self):
        for output in [("https://example.invalid/unrelated.git", companion.REVISION),
                       (companion.UPSTREAM, "0" * 40)]:
            with self.subTest(output=output), patch.object(companion, "run") as run:
                run.side_effect = [SimpleNamespace(stdout=value) for value in output]
                with self.assertRaises(ValueError):
                    companion.validate_checkout(self.root)
                self.assertTrue(all(call.args[0][1] in {"remote", "rev-parse"} for call in run.call_args_list))

    def test_untracked_source_stops_setup_before_dependency_changes(self):
        def run(command, *args, **kwargs):
            if command[:2] == ["git", "ls-files"]:
                return SimpleNamespace(stdout="src/local-change.js\n")
            return self.git(command, *args, **kwargs)
        before = (self.root / "package.json").read_bytes()
        with patch.object(companion, "run", side_effect=run), self.assertRaisesRegex(ValueError, "untracked"):
            companion.setup(self.root)
        self.assertEqual((self.root / "package.json").read_bytes(), before)

    def test_approved_override_rerun_is_accepted(self):
        expected = {**self.original, "overrides": self.overrides}
        self.write_manifests(expected, self.patched_lock())
        with patch.object(companion, "run", side_effect=self.git):
            self.assertEqual(companion.dependency_edits(self.root), expected)

    def test_conflicting_override_and_unrelated_manifest_edits_are_preserved(self):
        for edit in [{"overrides": {"dompurify": "0.0.0"}}, {"scripts": {"postinstall": "unreviewed"}}]:
            with self.subTest(edit=edit):
                self.write_manifests({**self.original, **edit}, self.lock)
                before = (self.root / "package.json").read_bytes()
                with patch.object(companion, "run", side_effect=self.git), self.assertRaises(ValueError):
                    companion.apply_overrides(self.root)
                self.assertEqual((self.root / "package.json").read_bytes(), before)

    def test_unrelated_dependency_and_off_origin_tarball_are_refused(self):
        for field, value in [("version", "9.9.9"), ("resolved", "https://example.invalid/payload.tgz")]:
            lock = self.patched_lock()
            package = "safe" if field == "version" else "dompurify"
            lock["packages"]["node_modules/" + package][field] = value
            self.write_manifests(self.original, lock)
            with self.subTest(field=field), patch.object(companion, "run", side_effect=self.git), self.assertRaises(ValueError):
                companion.dependency_edits(self.root)

    def test_failed_dependency_resolution_restores_both_manifests(self):
        before = [(self.root / name).read_bytes() for name in ["package.json", "package-lock.json"]]
        def run(command, *args, **kwargs):
            if command[0] == "npm":
                (self.root / "package-lock.json").write_text("incomplete")
                raise subprocess.CalledProcessError(1, command)
            return self.git(command, *args, **kwargs)
        with patch.object(companion, "run", side_effect=run), self.assertRaises(subprocess.CalledProcessError):
            companion.apply_overrides(self.root)
        self.assertEqual([(self.root / name).read_bytes() for name in ["package.json", "package-lock.json"]], before)

    def test_occupied_port_does_not_stop_or_replace_its_owner(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            with patch.object(companion, "validate_checkout"), patch.object(companion.subprocess, "Popen") as popen:
                with self.assertRaisesRegex(ValueError, "no existing process was stopped"):
                    companion.start_server(self.root, listener.getsockname()[1])
                popen.assert_not_called()
            self.assertGreater(listener.fileno(), -1)

    def test_time_wait_does_not_make_free_port_look_occupied(self):
        with patch.object(companion.socket, "socket") as socket_factory:
            probe = socket_factory.return_value.__enter__.return_value
            companion.free_port(4174)
        probe.setsockopt.assert_called_once_with(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind.assert_called_once_with(("127.0.0.1", 4174))

    def test_cleanup_exited_process_and_exit_between_poll_and_signal(self):
        process = Mock(pid=123456)
        process.poll.return_value = 0
        with patch.object(companion.os, "killpg") as kill:
            companion.stop_server(process)
        kill.assert_not_called()
        process.poll.return_value = None
        with patch.object(companion.os, "killpg", side_effect=ProcessLookupError):
            companion.stop_server(process)
        process.wait.assert_called_once_with(timeout=5)

    def test_cleanup_escalates_only_the_owned_group(self):
        process = Mock(pid=123456)
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("owned-server", 8), 0]
        with patch.object(companion.os, "killpg") as kill:
            companion.stop_server(process)
        self.assertEqual([call.args for call in kill.call_args_list],
                         [(process.pid, signal.SIGTERM), (process.pid, signal.SIGKILL)])

    def test_interrupted_smoke_reaps_browser_owner_then_server_and_restores_signal(self):
        server = Mock(pid=123450)
        server.poll.return_value = None
        server.wait.return_value = 0
        check = Mock(pid=123451)
        check.poll.return_value = None
        check.wait.side_effect = [KeyboardInterrupt, 0]
        previous_handler = object()
        output = Path(self.temp.name).resolve() / "private-evidence"
        with patch.object(companion, "chrome_path", return_value="/synthetic/chrome"), \
                patch.object(companion, "start_server", return_value=server), \
                patch.object(companion.urllib.request, "urlopen") as urlopen, \
                patch.object(companion.subprocess, "Popen", return_value=check) as popen, \
                patch.object(companion.os, "killpg") as kill, \
                patch.object(companion.signal, "signal", return_value=previous_handler) as install_signal:
            urlopen.return_value.__enter__.return_value.status = 200
            with self.assertRaises(KeyboardInterrupt):
                companion.smoke(self.root, 4174, output)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertEqual([call.args for call in kill.call_args_list],
                         [(check.pid, signal.SIGTERM), (server.pid, signal.SIGTERM)])
        self.assertEqual(check.wait.call_args_list[-1].kwargs, {"timeout": 8})
        server.wait.assert_called_once_with(timeout=8)
        install_signal.assert_called_with(signal.SIGTERM, previous_handler)

    def test_output_inside_any_checkout_or_symlink_is_refused(self):
        link = Path(self.temp.name) / "shortcut"
        link.symlink_to(self.root, target_is_directory=True)
        for destination in [self.root / "output", link / "output", companion.AUSTIN_ROOT / "output"]:
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                companion.private_output(destination)
        self.assertEqual(companion.private_output(Path(self.temp.name) / "evidence"), (Path(self.temp.name) / "evidence").resolve())

    def test_tool_explicit_outputs_cannot_override_private_destination(self):
        for arguments in [["--outdir", str(self.root / "output")], ["--outdir"],
                          ["--outdir=/unreviewed"], ["--outdir", "/tmp/private", "--outdir", str(self.root / "output")]]:
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                companion.pinhole_arguments(arguments, self.root)
        destination = Path(self.temp.name).resolve() / "evidence"
        self.assertEqual(companion.pinhole_arguments(["--", "--outdir", str(destination)], self.root),
                         ["--outdir", str(destination)])


if __name__ == "__main__":
    unittest.main()
