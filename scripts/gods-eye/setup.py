#!/usr/bin/env python3
"""Install and run the reviewed God's Eye View as a separate local companion."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

UPSTREAM = "https://github.com/bilawalsidhu/gods-eye-view.git"
REVISION = "a08a53cf9469eb991f708bd3d042c327a2347e3c"
HERE = Path(__file__).resolve().parent
AUSTIN_ROOT = HERE.parents[1]
DEFAULT_CHECKOUT = Path.home() / "Projects" / "gods-eye-view"
DEFAULT_OUTPUT = Path.home() / ".local" / "share" / "austin-gods-eye" / "output"
PROVIDERS = (
    "GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_SERVER_API_KEY", "CESIUM_ION_TOKEN",
    "OPENAI_API_KEY", "AISSTREAM_API_KEY", "FIRMS_MAP_KEY", "TOMTOM_API_KEY",
    "OPENSKY_CLIENT_ID", "OPENSKY_CLIENT_SECRET", "LL2_API_TOKEN",
    "OPENSKY_USERNAME", "OPENSKY_PASSWORD", "OPENSKY_CREDENTIALS_FILE",
)


def environment(with_providers=False):
    env = os.environ.copy()
    env["PUPPETEER_SKIP_DOWNLOAD"] = "1"
    if not with_providers:
        env.update({key: "" for key in PROVIDERS})
        env["OPENSKY_AUTH_MODE"] = "anon"
    # Do not let an unrelated launcher set this service's host/port or project.
    env.update(HOST="127.0.0.1", PORT="4174")
    env.pop("GEV_PROJECT_ROOT", None)
    return env


def run(command, root, env=None, capture=False):
    return subprocess.run(command, cwd=root, env=environment() if env is None else env, check=True,
                          text=True, capture_output=capture)


def checkout_path(value):
    root = Path(value).expanduser().resolve()
    if root == AUSTIN_ROOT or AUSTIN_ROOT in root.parents:
        raise ValueError("companion checkout must be outside the Austin repository")
    return root


def validate_checkout(root):
    root = checkout_path(root)
    if not (root / ".git").is_dir():
        raise ValueError("expected the separate God's Eye View git checkout; run setup")
    remote = run(["git", "remote", "get-url", "origin"], root, capture=True).stdout.strip()
    if remote.rstrip("/").removesuffix(".git") != UPSTREAM.removesuffix(".git"):
        raise ValueError("existing checkout has a different upstream; it was left alone")
    revision = run(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    if revision != REVISION:
        raise ValueError("existing checkout is not at the reviewed revision; it was left alone")
    return root


def dependency_edits(root):
    """Accept only the pinned manifests and the two reviewed dependency fixes."""
    overrides = json.loads((HERE / "dependency-overrides.json").read_text())
    original = json.loads(run(["git", "show", f"{REVISION}:package.json"], root, capture=True).stdout)
    manifest = json.loads((root / "package.json").read_text())
    expected = {**original, "overrides": {**original.get("overrides", {}), **overrides}}
    if manifest not in (original, expected):
        raise ValueError("checkout has unreviewed package.json edits; it was left alone")
    original_lock = json.loads(run(["git", "show", f"{REVISION}:package-lock.json"], root, capture=True).stdout)
    lock = json.loads((root / "package-lock.json").read_text())
    if not isinstance(lock, dict) or not isinstance(lock.get("packages"), dict):
        raise ValueError("checkout has an invalid dependency lock; it was left alone")
    original_packages = original_lock.get("packages", {})
    if lock.keys() != original_lock.keys() or lock["packages"].keys() != original_packages.keys():
        raise ValueError("checkout has unreviewed dependency lock edits; it was left alone")
    for key in lock:
        if key != "packages" and lock[key] != original_lock[key]:
            raise ValueError("checkout has unreviewed dependency lock edits; it was left alone")
    for path, entry in lock["packages"].items():
        prior = original_packages[path]
        if entry == prior:
            continue
        package = path.removeprefix("node_modules/")
        if package not in overrides or not isinstance(entry, dict):
            raise ValueError("checkout has unreviewed dependency lock edits; it was left alone")
        version = overrides[package]
        unchanged = {key: value for key, value in entry.items() if key not in {"version", "resolved", "integrity"}}
        prior_unchanged = {key: value for key, value in prior.items() if key not in {"version", "resolved", "integrity"}}
        if (unchanged != prior_unchanged or entry.get("version") != version
                or entry.get("resolved") != f"https://registry.npmjs.org/{package}/-/{package}-{version}.tgz"
                or not isinstance(entry.get("integrity"), str)
                or not entry["integrity"].startswith("sha512-")):
            raise ValueError("checkout has unreviewed dependency lock edits; it was left alone")
    return expected


def apply_overrides(root):
    manifest_path = root / "package.json"
    lock_path = root / "package-lock.json"
    manifest = dependency_edits(root)
    before_manifest, before_lock = manifest_path.read_bytes(), lock_path.read_bytes()
    try:
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        run(["npm", "install", "--package-lock-only", "--ignore-scripts"], root)
        dependency_edits(root)
    except BaseException:
        manifest_path.write_bytes(before_manifest)
        lock_path.write_bytes(before_lock)
        raise


def setup(root):
    root = checkout_path(root)
    if not root.exists():
        root.parent.mkdir(parents=True, exist_ok=True)
        # Clone only the code needed by the pinned companion, no Austin data.
        run(["git", "clone", "--depth", "1", "--filter=blob:none", UPSTREAM, str(root)], root.parent)
        run(["git", "fetch", "--depth", "1", "origin", REVISION], root)
        run(["git", "checkout", "--detach", REVISION], root)
    validate_checkout(root)
    changed = run(["git", "diff", "--name-only", "HEAD"], root, capture=True).stdout.splitlines()
    if set(changed) - {"package.json", "package-lock.json"}:
        raise ValueError("checkout has source edits; setup leaves them alone")
    untracked = run(["git", "ls-files", "--others", "--exclude-standard"], root, capture=True).stdout
    if untracked.strip():
        raise ValueError("checkout has untracked source files; setup leaves them alone")
    apply_overrides(root)
    run(["npm", "ci", "--ignore-scripts"], root)
    run(["npm", "audit", "--audit-level=low"], root)
    doctor(root)


def doctor(root, with_providers=False):
    validate_checkout(root)
    script = """import { inspectSetup, formatSetupReport } from './scripts/setup-doctor.mjs';
const report = inspectSetup({includeKeychain:false, authoritativeEnvironment:true});
console.log(formatSetupReport(report, {readyMessage:'Ready. Run the Austin companion serve command, then open http://localhost:4174.'}));
if (!report.ready) process.exitCode = 1;"""
    run(["node", "--input-type=module", "-e", script], root, environment(with_providers))


def free_port(port):
    if not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    try:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", port))
    except OSError:
        raise ValueError(f"port {port} is already in use; no existing process was stopped") from None


def start_server(root, port, with_providers=False, log=None):
    validate_checkout(root)
    free_port(port)
    env = environment(with_providers)
    env["PORT"] = str(port)
    return subprocess.Popen(
        ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
        cwd=root, env=env, stdout=log, stderr=log, start_new_session=True,
    )


def stop_server(process):
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait(timeout=5)
        return
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def chrome_path():
    candidates = [os.environ.get("CHROME_PATH"), os.environ.get("PUPPETEER_EXECUTABLE_PATH"),
                  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                  shutil.which("google-chrome"), shutil.which("chromium")]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise ValueError("set CHROME_PATH to an installed Chrome or Edge")


def private_output(value, root=None):
    """Keep rendered evidence out of any public checkout, including worktrees."""
    output = Path(value).expanduser()
    if root is not None and not output.is_absolute():
        output = root / output
    output = Path(output).expanduser().resolve()
    if output == AUSTIN_ROOT or AUSTIN_ROOT in output.parents or any(
            (ancestor / ".git").exists() for ancestor in (output, *output.parents)):
        raise ValueError("render output belongs outside public git checkouts")
    return output


def pinhole_arguments(arguments, root):
    arguments = arguments[1:] if arguments[:1] == ["--"] else list(arguments)
    found = False
    for index, argument in enumerate(arguments):
        if argument == "--outdir":
            if index + 1 == len(arguments) or arguments[index + 1].startswith("--"):
                raise ValueError("--outdir needs a private output directory")
            arguments[index + 1] = str(private_output(arguments[index + 1], root))
            found = True
        elif argument.startswith("--outdir="):
            raise ValueError("use --outdir followed by a private output directory")
    if not found:
        arguments += ["--outdir", str(private_output(DEFAULT_OUTPUT / "pinhole"))]
    return arguments


def smoke(root, port, output):
    output = private_output(output)
    output.mkdir(parents=True, exist_ok=True)
    browser = chrome_path()
    with (output / "server.log").open("w") as log:
        process = start_server(root, port, log=log)
        previous = signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise ValueError("companion server stopped; inspect the private server.log")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=1) as response:
                        if response.status == 200:
                            break
                except (OSError, TimeoutError):
                    time.sleep(0.25)
            else:
                raise ValueError("companion server did not become ready")
            env = environment()
            env.update(PUPPETEER_EXECUTABLE_PATH=browser, GEV_COMPANION_ROOT=str(root))
            command = ["node", str(HERE / "smoke.mjs"), f"http://127.0.0.1:{port}", str(output)]
            check = subprocess.Popen(command, cwd=root, env=env, start_new_session=True)
            try:
                status = check.wait()
                if status:
                    raise subprocess.CalledProcessError(status, command)
            finally:
                # Forward interruption so the browser owner's handler can reap
                # its whole process group before Python stops the server.
                stop_server(check)
        finally:
            try:
                stop_server(process)
            finally:
                signal.signal(signal.SIGTERM, previous)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", default=str(DEFAULT_CHECKOUT), help="separate upstream checkout")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup", help="install reviewed revision and dependency fixes")
    d = commands.add_parser("doctor", help="check the explicitly selected provider route")
    d.add_argument("--with-providers", action="store_true", help="use explicit environment/dotenv providers")
    serve = commands.add_parser("serve", help="run until Ctrl-C; localhost only")
    serve.add_argument("--port", type=int, default=4174)
    serve.add_argument("--with-providers", action="store_true", help="use explicit environment/dotenv providers")
    tool = commands.add_parser("tool", help="run audited offline panorama reprojection")
    tool.add_argument("name", choices=["pinhole"])
    tool.add_argument("args", nargs=argparse.REMAINDER)
    s = commands.add_parser("smoke", help="check keyless startup, camera and teardown; closes everything")
    s.add_argument("--port", type=int, default=4174)
    s.add_argument("--out", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    try:
        root = checkout_path(args.checkout)
        if args.command == "setup":
            setup(root)
        elif args.command == "doctor":
            doctor(root, args.with_providers)
        elif args.command == "serve":
            process = start_server(root, args.port, args.with_providers)
            print(f"Companion: http://localhost:{args.port} (Ctrl-C stops it)", flush=True)
            previous = signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
            try:
                process.wait()
                if process.returncode:
                    raise ValueError("companion server exited with an error")
            finally:
                try:
                    stop_server(process)
                finally:
                    signal.signal(signal.SIGTERM, previous)
        elif args.command == "tool":
            validate_checkout(root)
            arguments = pinhole_arguments(args.args, root)
            run(["node", "tools/pano-pinhole.mjs", *arguments], root)
        elif args.command == "smoke":
            smoke(root, args.port, args.out)
    except KeyboardInterrupt:
        return 130
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        # Commands contain no provider values; output those values nowhere.
        print(f"Companion: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
