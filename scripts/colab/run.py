#!/usr/bin/env python3
"""run.py - render the app's browser checks on a Colab L4 GPU, not the laptop.

The browser checks in scripts/verify need a real GPU. This laptop has one, but
only one, so the checks queue behind each other and behind whatever else wants
the GPU browser. This runner rents a Colab L4 (12 CPUs, 52 GB, a real NVIDIA
GPU), runs the checks there - up to four at once - brings their frames and exit
codes back, and ALWAYS stops the session afterward, on success, on error and on
Ctrl-C, so no rented GPU is ever left running.

Usage:

    python run.py --ref main \
        --check graphics.mjs \
        --check "movement.mjs --report" \
        --out ./colab-out

  --ref      git ref to test (branch, tag or full sha). Default: main.
  --check    a scripts/verify/*.mjs check with its args, quoted. Repeatable.
  --out      local folder to write the downloaded outputs into.
  --repo     git URL to clone on Colab. Default: the repo's own origin.
  --gpu      accelerator to request. Default: L4 (the shape proven to hold four
             full-city browsers at once; a T4 cannot).
  --parallel how many checks to run at once on the VM. Default: 4.
  --keep     do not stop the session at the end (for debugging). Off by default.

The Colab CLI command comes from the COLAB_CLI environment variable so no
personal path is committed. See scripts/colab/README.md for the WSL form.
"""
import argparse
import atexit
import json
import os
import shlex
import signal
import subprocess
import sys
import tarfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SETUP = os.path.join(HERE, "setup.py")
LAUNCH = os.path.join(HERE, "launch.py")
POLL = os.path.join(HERE, "poll.py")
POLL_SECONDS = 30      # how often to ask the VM for the run's state
POLL_MISSES = 10       # consecutive failed polls before giving up on the VM

# The CLI is a single command word by default ("colab"), or a full command line
# in COLAB_CLI for environments where it is reached through a wrapper (WSL, a
# venv, an absolute path). We split it as a shell line so either works.
COLAB_CLI = os.environ.get("COLAB_CLI", "colab")


def cli(*args, timeout=None, capture=True, quiet=False):
    cmd = shlex.split(COLAB_CLI) + list(args)
    if not quiet:
        print("+ " + " ".join(shlex.quote(c) for c in cmd), flush=True)
    if capture:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return subprocess.run(cmd, timeout=timeout)


def usage_line():
    r = cli("usage")
    for line in (r.stdout or "").splitlines():
        if "balance" in line.lower():
            return line.strip()
    return (r.stdout or r.stderr or "").strip()


def default_repo():
    try:
        r = subprocess.run(["git", "config", "--get", "remote.origin.url"],
                           cwd=HERE, capture_output=True, text=True)
        url = (r.stdout or "").strip()
        # Normalise a git@ URL to https so the shallow clone needs no key.
        if url.startswith("git@github.com:"):
            url = "https://github.com/" + url[len("git@github.com:"):]
        if url.endswith(".git"):
            return url
        return url + ".git" if url else ""
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser(description="Run scripts/verify checks on a Colab L4 GPU.")
    ap.add_argument("--ref", default="main")
    ap.add_argument("--check", action="append", default=[], help="a verify check + args, quoted; repeatable")
    ap.add_argument("--out", default="./colab-out")
    ap.add_argument("--repo", default="")
    ap.add_argument("--gpu", default="L4")
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--session", default=None, help="session name (default: a timestamped one)")
    ap.add_argument("--exec-timeout", type=float, default=2400.0)
    ap.add_argument("--keep", action="store_true", help="do not stop the session at the end")
    args = ap.parse_args()

    if not args.check:
        ap.error("at least one --check is required")

    repo = args.repo or default_repo()
    if not repo:
        ap.error("could not determine the repo URL; pass --repo")

    checks = []
    for c in args.check:
        parts = shlex.split(c)
        checks.append({"name": os.path.splitext(parts[0])[0].replace("/", "_") +
                       ("_" + "_".join(p.lstrip("-") for p in parts[1:]) if len(parts) > 1 else ""),
                       "cmd": parts[0], "args": parts[1:]})

    session = args.session or ("colabrun-%d" % int(time.time()))
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    stopped = {"done": False}

    def stop_session(*_):
        if stopped["done"] or args.keep:
            return
        stopped["done"] = True
        print("== stopping session %s ==" % session, flush=True)
        try:
            cli("stop", "-s", session, timeout=120)
        except Exception as e:
            print("warning: stop failed: %s" % e, flush=True)

    # ALWAYS stop: normal exit, Ctrl-C, SIGTERM.
    atexit.register(stop_session)
    signal.signal(signal.SIGINT, lambda *a: (stop_session(), sys.exit(130)))
    try:
        signal.signal(signal.SIGTERM, lambda *a: (stop_session(), sys.exit(143)))
    except Exception:
        pass

    units_before = usage_line()
    print("units before:", units_before, flush=True)
    t0 = time.time()

    print("== creating %s session %s ==" % (args.gpu, session), flush=True)
    r = cli("new", "-s", session, "--gpu", args.gpu, timeout=600)
    print(r.stdout, r.stderr, flush=True)
    if r.returncode != 0:
        stop_session()
        sys.exit("failed to create session")

    print("== uploading setup.py ==", flush=True)
    r = cli("upload", SETUP, "/content/setup.py", "-s", session, timeout=300)
    if r.returncode != 0:
        print(r.stdout, r.stderr, flush=True)
        sys.exit("upload failed")

    # Start the run detached, then poll it with short execs. One long exec held
    # a single connection for the whole run, and a dropped connection lost
    # every output (see launch.py). Now a drop costs one poll.
    print("== starting the checks on the VM (toolchain + driver install first) ==", flush=True)
    r = cli("exec", "-s", session, "-f", LAUNCH, "--timeout", "120",
            "--env", "REPO=%s" % repo,
            "--env", "REF=%s" % args.ref,
            "--env", "CHECKS=%s" % json.dumps(checks),
            "--env", "CONCURRENCY=%d" % args.parallel,
            timeout=420)
    print(r.stdout, r.stderr, flush=True)
    if "LAUNCHED" not in (r.stdout or ""):
        stop_session()
        sys.exit("failed to start the checks on the VM")

    manifest = None
    deadline = time.time() + args.exec_timeout
    misses, last_tail = 0, ""
    while True:
        time.sleep(POLL_SECONDS)
        late = time.time() > deadline
        try:
            pr = cli("exec", "-s", session, "-f", POLL, "--timeout", "60",
                     *(["--env", "PACK=1"] if late else []), timeout=240, quiet=True)
            text, ok = pr.stdout or "", pr.returncode == 0
        except subprocess.TimeoutExpired:
            text, ok = "", False
        if not ok or "STATE " not in text:
            misses += 1
            print("poll failed (%d in a row)" % misses, flush=True)
            if misses >= POLL_MISSES:
                print("warning: the VM stopped answering; downloading what exists", flush=True)
                break
            continue
        misses = 0
        for line in text.splitlines():
            if line.startswith("MANIFEST "):
                try:
                    manifest = json.loads(line[len("MANIFEST "):])
                except Exception:
                    pass
            elif line.startswith("TAIL ") and line != last_tail:
                last_tail = line
                print(line[5:], flush=True)
        if "STATE done" in text:
            break
        if "STATE died" in text:
            print("warning: the run on the VM died; its log tail:")
            print(text, flush=True)
            break
        if late:
            print("warning: --exec-timeout reached; downloading what exists", flush=True)
            break

    print("== downloading outputs ==", flush=True)
    tar_local = os.path.join(out_dir, "out.tar")
    dr = cli("download", "/content/out.tar", tar_local, "-s", session, timeout=600)
    if dr.returncode == 0 and os.path.exists(tar_local):
        with tarfile.open(tar_local) as tar:
            tar.extractall(out_dir)
        os.remove(tar_local)
        print("outputs in", out_dir, flush=True)
    else:
        print("warning: download failed:", dr.stdout, dr.stderr, flush=True)

    stop_session()
    units_after = usage_line()
    elapsed = round(time.time() - t0, 1)
    print("units after: ", units_after, flush=True)
    print("wall seconds:", elapsed, flush=True)

    # A machine-readable summary for report writing / CI.
    summary = {
        "session": session, "gpu": args.gpu, "ref": args.ref, "repo": repo,
        "units_before": units_before, "units_after": units_after,
        "wall_seconds": elapsed, "manifest": manifest,
    }
    with open(os.path.join(out_dir, "run-summary.json"), "w") as fh:
        json.dump(summary, fh, indent=1)

    # Exit non-zero if any check failed, so this composes in a pipeline.
    if manifest and manifest.get("results"):
        for res in manifest["results"]:
            print("  %-24s exit=%s  %ss" % (res["name"], res["exit"], res["seconds"]), flush=True)
        if any(res["exit"] != 0 for res in manifest["results"]):
            sys.exit(1)
    else:
        sys.exit("no manifest returned; see output above")


if __name__ == "__main__":
    main()
