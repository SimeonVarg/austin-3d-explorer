#!/usr/bin/env python3
"""Exercise the actual publisher shell steps against disposable local Git remotes.

Requires Python, PyYAML, Git and Bash (Git for Windows is supported). No network,
Overture extraction, tippecanoe or browser is used.
"""
import fnmatch
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
BASH = (r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt"
        else shutil.which("bash"))
DATE = "2026-09-26"
PREV = "2026-09-25"


def workflow(name):
    # BaseLoader keeps GitHub's YAML key `on` a string on YAML 1.1 parsers.
    return yaml.load((ROOT / ".github/workflows" / name).read_text(),
                     Loader=yaml.BaseLoader)


DATA = workflow("build-data.yml")
TILES = workflow("build-tiles.yml")


def step(spec, name):
    return next(s["run"] for j in spec["jobs"].values()
                for s in j["steps"] if s.get("name") == name)


def git(cwd, *args):
    result = subprocess.run(["git", *args], cwd=cwd, text=True,
                            capture_output=True, check=True)
    return result.stdout.strip()


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="snapshot-publisher-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "worker"
        self.other = self.root / "other"
        git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        git(self.root, "clone", str(self.remote), str(self.repo))
        git(self.repo, "config", "user.name", "Publisher test")
        git(self.repo, "config", "user.email", "test@example.invalid")
        git(self.repo, "config", "core.autocrlf", "false")
        self.write("source.txt", "initial\n")
        self.write("scripts/config.sh", (ROOT / "scripts/config.sh").read_text())
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "Initial sources")
        git(self.repo, "push", "origin", "main")
        self.sha = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "switch", "--detach", self.sha)
        git(self.root, "clone", str(self.remote), str(self.other))
        git(self.other, "config", "user.name", "Concurrent test")
        git(self.other, "config", "user.email", "test@example.invalid")
        self.env = dict(os.environ, GITHUB_SHA=self.sha,
                        GITHUB_REF="refs/heads/main", SNAPSHOT_DATE=DATE,
                        PREVIOUS_SNAPSHOT=PREV)

    def write(self, name, value="generated\n"):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as output:
            output.write(value)

    def run_step(self, spec, name, prefix=""):
        return subprocess.run([BASH, "--noprofile", "--norc", "-c",
                               prefix + step(spec, name)], cwd=self.repo,
                              env=self.env, text=True, capture_output=True)

    def require_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def remote_sha(self):
        return git(self.remote, "rev-parse", "refs/heads/main")

    def outputs(self):
        paths = [f"data/snapshots/{DATE}/{name}" for name in
                 ("buildings.geojson", "buildings.enriched.geojson",
                  "buildings.detailed.geojson", "parts.detailed.geojson",
                  "austin.pmtiles")]
        paths += ["data/manifest.json", "data/roof_anchors.json",
                  f"data/diffs/{PREV}_to_{DATE}.geojson"]
        paths += [f"data/tiles/{name}.pmtiles" for name in
                  ("trees", "roads", "outer", "roofdetail", "props")]
        for path in paths:
            self.write(path)
        self.write("data/campus_buildings.json", "unrelated bake\n")
        self.write("data/tiles/unowned.pmtiles", "unrelated archive\n")
        return paths

    def advance_remote(self):
        (self.other / "source.txt").write_text("new sources\n")
        git(self.other, "add", "source.txt")
        git(self.other, "commit", "-m", "New source revision")
        git(self.other, "push", "origin", "main")
        return self.remote_sha()

    def test_trigger_matrix(self):
        push = DATA["on"]["push"]
        self.assertEqual(push["branches"], ["main"])
        self.assertIn("workflow_dispatch", DATA["on"])
        self.assertIn("workflow_dispatch", TILES["on"])
        self.assertEqual(TILES["on"]["push"]["branches-ignore"], ["main"])
        self.assertEqual(TILES["on"]["push"]["paths"],
                         ["scripts/tile.sh", "scripts/config.sh"])
        self.assertEqual(DATA["jobs"]["build"]["if"],
                         "github.ref == 'refs/heads/main'")
        self.assertEqual(DATA["concurrency"], TILES["concurrency"])
        self.assertEqual(DATA["concurrency"]["cancel-in-progress"], "false")
        for path in ("scripts/extract.sh", "scripts/extract_overture.sql",
                     "scripts/config.sh", "scripts/enrich.py",
                     "scripts/hero_overrides.json", "scripts/tile.sh",
                     "scripts/bake_detail.py", "scripts/diff_snapshots.py",
                     "scripts/update_manifest.py", "scripts/bake_roof_anchors.py",
                     "data/parts.geojson", "data/building_tags.geojson",
                     "data/hero_designs.json", "data/signs.json",
                     "data/trees.geojson", "data/roads.geojson",
                     "data/outer_ring.geojson", "data/roofscape.geojson",
                     "data/roofscape.detail.geojson", "data/props.geojson"):
            self.assertTrue(any(fnmatch.fnmatchcase(path, p) for p in push["paths"]), path)
        for path in ("scripts/campus_goldsmith.py", "scripts/bake_stadium.py",
                     "scripts/verify/compiler.mjs", "scripts/compile_scene.py",
                     "js/sky.js", "data/campus_buildings.json",
                     "data/manifest.json", "data/tiles/trees.pmtiles",
                     f"data/snapshots/{DATE}/buildings.geojson",
                     ".github/workflows/build-data.yml"):
            self.assertFalse(any(fnmatch.fnmatchcase(path, p) for p in push["paths"]), path)
        for spec in (DATA, TILES):
            job = next(iter(spec["jobs"].values()))
            self.assertEqual(job["steps"][0]["with"]["ref"], "${{ github.sha }}")
            for item in job["steps"]:
                if "run" in item:
                    result = subprocess.run([BASH, "-n"], input=item["run"],
                                            text=True, capture_output=True)
                    self.require_success(result)

    def test_current_snapshot_publishes_only_owned_outputs(self):
        self.require_success(self.run_step(DATA, "Reject an outdated source revision"))
        expected = self.outputs()
        self.require_success(self.run_step(DATA, "Commit baked data"))
        published = git(self.remote, "diff", "--name-only", self.sha, "main").splitlines()
        self.assertEqual(sorted(published), sorted(expected))

    def test_snapshot_dispatch_on_feature_branch_rejected(self):
        self.outputs()
        self.env["GITHUB_REF"] = "refs/heads/codex/example"
        for name in ("Reject an outdated source revision", "Commit baked data"):
            self.assertNotEqual(self.run_step(DATA, name).returncode, 0)
        self.assertEqual(self.remote_sha(), self.sha)

    def test_stale_before_start_and_after_build_rejected(self):
        for spec, publish in ((DATA, "Commit baked data"), (TILES, "Commit")):
            self.require_success(self.run_step(spec, "Reject an outdated source revision"))
        self.outputs()
        newer = self.advance_remote()
        for spec, publish in ((DATA, "Commit baked data"), (TILES, "Commit")):
            for name in ("Reject an outdated source revision", publish):
                result = self.run_step(spec, name)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("::error::", result.stdout)
        self.assertEqual(self.remote_sha(), newer)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.sha)

    def race(self, spec, publish):
        self.outputs()
        # Inject a real competing push after the workflow's ls-remote check,
        # immediately before its ordinary push. No production snippet is edited.
        self.env["RACE_REPO"] = self.other.as_posix()
        prefix = '''git() {
          if [ "$1" = push ]; then
            printf 'racing sources\\n' > "$RACE_REPO/source.txt"
            command git -C "$RACE_REPO" add source.txt
            command git -C "$RACE_REPO" commit -m "Racing source revision"
            command git -C "$RACE_REPO" push origin main
          fi
          command git "$@"
        }
'''
        result = self.run_step(spec, publish, prefix)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("[rejected]", result.stderr)
        self.assertEqual(self.remote_sha(), git(self.other, "rev-parse", "HEAD"))
        self.assertNotEqual(self.remote_sha(), git(self.repo, "rev-parse", "HEAD"))
        self.assertEqual(git(self.remote, "show", "main:source.txt"), "racing sources")

    def test_snapshot_check_push_race(self):
        self.race(DATA, "Commit baked data")

    def test_tile_check_push_race(self):
        self.race(TILES, "Commit")

    def test_tiles_can_publish_to_their_feature_branch_only(self):
        branch = "codex/tile-test"
        git(self.repo, "switch", "-c", branch)
        git(self.repo, "push", "origin", branch)
        self.env["GITHUB_REF"] = "refs/heads/" + branch
        expected = [p for p in self.outputs() if p.endswith(".pmtiles")]
        self.require_success(self.run_step(TILES, "Reject an outdated source revision"))
        self.require_success(self.run_step(TILES, "Commit"))
        self.assertEqual(self.remote_sha(), self.sha)
        published = git(self.remote, "diff", "--name-only", self.sha, branch).splitlines()
        self.assertEqual(sorted(published), sorted(expected))

    def test_wrong_checked_out_revision_rejected(self):
        self.env["GITHUB_SHA"] = "0" * 40
        for spec, publish in ((DATA, "Commit baked data"), (TILES, "Commit")):
            for name in ("Reject an outdated source revision", publish):
                self.assertNotEqual(self.run_step(spec, name).returncode, 0)
        self.assertEqual(self.remote_sha(), self.sha)

    def test_unchanged_outputs_do_not_create_another_commit(self):
        self.outputs()
        self.require_success(self.run_step(DATA, "Commit baked data"))
        first = self.remote_sha()
        self.env["GITHUB_SHA"] = first
        self.require_success(self.run_step(DATA, "Commit baked data"))
        self.require_success(self.run_step(TILES, "Commit"))
        self.assertEqual(self.remote_sha(), first)


if __name__ == "__main__":
    unittest.main(verbosity=2)
