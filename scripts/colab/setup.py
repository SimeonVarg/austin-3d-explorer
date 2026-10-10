#!/usr/bin/env python3
"""setup.py - runs INSIDE a Colab session to render the app on the L4 GPU.

`run.py` uploads this file and executes it with `colab exec`, passing its
inputs as environment variables (Colab's `exec --env KEY=VALUE`):

    REPO      git URL to clone (public, https)
    REF       git ref to check out (branch, tag or full sha)
    CHECKS    JSON list of {"name","cmd","args"} - each a scripts/verify/*.mjs
              check to run against the local server, up to CONCURRENCY at once
    CONCURRENCY   how many checks to run in parallel (default 4)
    BASE_PORT     first local port for scripts/serve.py (default 8442)

Why each step is here, learned the hard way (see scripts/colab/README.md):

  * Colab mounts only NVIDIA's COMPUTE libraries, so Chrome falls back to a
    software rasteriser (SwiftShader) and every frame is drawn on the CPU. To
    get the L4, the matching NVIDIA USERSPACE GL libraries have to be unpacked
    from the driver's own .run installer and dropped next to the compute ones,
    then Chrome told to use them with `--use-gl=angle --use-angle=gl-egl`.
  * Playwright must run as a SUBPROCESS, never inside the notebook kernel, or
    its event loop fights Colab's.
  * The verify scripts are UNMODIFIED. They launch Chrome through
    scripts/verify/chrome.mjs, which honours CHROME_PATH. So we write a tiny
    Chrome wrapper that appends the EGL flags and point CHROME_PATH at it, with
    VERIFY_GL=hardware so chrome.mjs stops adding the SwiftShader flags.

The result of every check (its stdout, exit code and any files it wrote) is
collected into /content/out.tar, which run.py downloads as one file.
"""
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

REPO = os.environ.get("REPO", "").strip()
REF = os.environ.get("REF", "").strip()


def _load_checks():
    """Checks come as JSON in CHECKS, or in the file named by CHECKS_FILE.

    run.py passes them in CHECKS (it builds the value itself, so quoting is
    safe). CHECKS_FILE is the escape hatch for a hand-driven run, where a JSON
    list on a command line has to survive several layers of shell quoting.
    """
    raw = os.environ.get("CHECKS", "").strip()
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    path = os.environ.get("CHECKS_FILE", "/content/checks.json")
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    return []


CHECKS = _load_checks()
CONCURRENCY = int(os.environ.get("CONCURRENCY", "4"))
BASE_PORT = int(os.environ.get("BASE_PORT", "8442"))

WORK = "/content/work"           # the cloned repo
OUT = "/content/out"             # per-check outputs, tarred at the end
NVDIR = "/content/nv"            # extracted driver payload
LIBDIR = "/usr/lib/x86_64-linux-gnu"

log_lines = []


def log(*a):
    line = " ".join(str(x) for x in a)
    print(line, flush=True)
    log_lines.append(line)


def sh(cmd, timeout=1800, check=False, env=None):
    """Run a shell command, streaming a heartbeat, return (code, tail_of_output)."""
    p = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, env=env)
    buf, last = [], time.time()
    for line in p.stdout:
        buf.append(line)
        if time.time() - last > 3:
            print(".", end="", flush=True)
            last = time.time()
    p.wait(timeout=timeout)
    out = "".join(buf)
    if check and p.returncode != 0:
        raise RuntimeError("command failed (%d): %s\n%s" % (p.returncode, cmd, out[-2000:]))
    return p.returncode, out


def gpu_name_and_driver():
    _, out = sh("nvidia-smi --query-gpu=name,driver_version --format=csv,noheader")
    name, driver = [x.strip() for x in out.strip().splitlines()[0].split(",")]
    return name, driver


def install_toolchain():
    log("== installing Chrome, Node and Playwright ==")
    sh("wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb "
       "-O /tmp/chrome.deb && apt-get install -y -qq /tmp/chrome.deb >/dev/null 2>&1", check=True)
    _, ver = sh("google-chrome --version")
    log("chrome:", ver.strip())
    # Node is preinstalled on Colab; confirm and print the version.
    _, nv = sh("node --version 2>/dev/null || (apt-get install -y -qq nodejs npm >/dev/null 2>&1; node --version)")
    log("node:", nv.strip())
    # playwright-core is what the verify harness imports; it uses the system Chrome.
    sh("pip -q install playwright-core 2>&1 | tail -1")


def install_nvidia_gl(driver):
    """Unpack the matching NVIDIA userspace GL libs and register the EGL/Vulkan ICDs.

    Idempotent: the driver's `.run -x` refuses to extract into a non-empty
    target, so a second run in the same session would fail. Skip the download
    and extract when the payload is already there and only re-copy/register.
    """
    log("== installing NVIDIA userspace GL for driver", driver, "==")
    already = os.path.isdir(NVDIR) and os.path.exists(
        os.path.join(NVDIR, "libEGL_nvidia.so.%s" % driver))
    if not already:
        if os.path.isdir(NVDIR):
            shutil.rmtree(NVDIR)
        urls = [
            "https://us.download.nvidia.com/tesla/%s/NVIDIA-Linux-x86_64-%s.run" % (driver, driver),
            "https://download.nvidia.com/XFree86/Linux-x86_64/%s/NVIDIA-Linux-x86_64-%s.run" % (driver, driver),
        ]
        ok = False
        for u in urls:
            code, _ = sh("cd /content && wget -q '%s' -O nv.run" % u)
            if code == 0 and os.path.getsize("/content/nv.run") > 1_000_000:
                ok = True
                break
        if not ok:
            raise RuntimeError("could not download NVIDIA driver %s" % driver)
        sh("cd /content && sh nv.run -x --target %s >/dev/null 2>&1" % NVDIR, check=True)
    # Copy only the versioned .so files that are not already present.
    sh("cd %s && for f in *.so.%s; do [ -e %s/$f ] || cp $f %s/; done && ldconfig"
       % (NVDIR, driver, LIBDIR, LIBDIR), check=True)
    os.makedirs("/usr/share/glvnd/egl_vendor.d", exist_ok=True)
    os.makedirs("/usr/share/vulkan/icd.d", exist_ok=True)
    with open("/usr/share/glvnd/egl_vendor.d/10_nvidia.json", "w") as fh:
        fh.write('{"file_format_version":"1.0.0","ICD":{"library_path":"libEGL_nvidia.so.0"}}')
    sh('cd %s && sed "s/__NV_VK_ICD__/libGLX_nvidia.so.0/" nvidia_icd.json.template '
       '> /usr/share/vulkan/icd.d/nvidia_icd.json 2>/dev/null || true' % NVDIR)
    os.environ["NVIDIA_DRIVER_CAPABILITIES"] = "all"


def write_chrome_wrapper():
    """A Chrome wrapper that appends the EGL flags so the verify scripts stay unmodified."""
    path = "/content/chrome-egl"
    with open(path, "w") as fh:
        fh.write("#!/bin/sh\n"
                 'exec /usr/bin/google-chrome --use-gl=angle --use-angle=gl-egl '
                 '--enable-gpu --ignore-gpu-blocklist "$@"\n')
    os.chmod(path, 0o755)
    return path


def clone_repo():
    log("== cloning", REPO, "at", REF, "(shallow) ==")
    if os.path.exists(WORK):
        shutil.rmtree(WORK)
    # Shallow clone of the exact ref. --depth 1 needs the ref fetched explicitly
    # for arbitrary shas, so try the ref as a branch/tag first, then fall back.
    code, _ = sh("git clone --depth 1 --branch '%s' '%s' '%s'" % (REF, REPO, WORK))
    if code != 0:
        sh("git clone '%s' '%s'" % (REPO, WORK), check=True)
        sh("cd '%s' && git checkout '%s'" % (WORK, REF), check=True)
    sh("cd '%s' && git rev-parse HEAD" % WORK)
    # The verify harness needs playwright-core resolvable from scripts/verify.
    sh("cd '%s/scripts/verify' && npm install --no-audit --no-fund >/dev/null 2>&1 "
       "|| pip show playwright-core >/dev/null 2>&1" % WORK)
    # Fall back to the global playwright-core if npm install did not run.
    sh("cd '%s/scripts/verify' && [ -d node_modules/playwright-core ] || "
       "(mkdir -p node_modules && ln -s $(python3 -c \"import playwright,os;print(os.path.dirname(playwright.__file__))\" 2>/dev/null) node_modules/ 2>/dev/null || true)" % WORK)


def start_server(port):
    log("== starting scripts/serve.py on", port, "==")
    p = subprocess.Popen(["python3", "scripts/serve.py", str(port)], cwd=WORK,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Wait for it to answer.
    for _ in range(50):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/index.html" % port, timeout=2)
            return p
        except Exception:
            time.sleep(0.2)
    return p


def ensure_playwright_core():
    """Make playwright-core importable to node from scripts/verify.

    The harness README says `npm install` there is not optional. Colab has no
    network npm restriction, so a plain install works; if it did not, fail loud
    rather than silently render on the wrong renderer.
    """
    code, out = sh("cd '%s/scripts/verify' && node -e \"import('playwright-core').then(()=>console.log('OK')).catch(e=>{console.error(e.message);process.exit(1)})\"" % WORK)
    if code != 0:
        sh("cd '%s/scripts/verify' && npm install playwright-core --no-audit --no-fund" % WORK, check=True)


def run_check(chk, port, chrome_wrapper):
    """Run one verify check against the local server. Returns a result dict."""
    name = chk["name"]
    cmd = chk["cmd"]                       # e.g. "graphics.mjs"
    args = chk.get("args", [])
    outdir = os.path.join(OUT, name)
    os.makedirs(outdir, exist_ok=True)
    env = dict(os.environ)
    env["VERIFY_URL"] = "http://127.0.0.1:%d" % port
    env["VERIFY_GL"] = "hardware"          # stop chrome.mjs adding SwiftShader flags
    env["CHROME_PATH"] = chrome_wrapper    # ...and make "hardware" mean the L4
    env["VERIFY_OUT"] = outdir
    env["VERIFY_MAX_MS"] = env.get("VERIFY_MAX_MS", "2400000")   # was 600000: night-luma.mjs needs more than ten minutes on an L4 (killed at 600.9 s twice, 2026-10-10)
    full = "node %s %s" % (cmd, " ".join("'%s'" % a for a in args))
    t0 = time.time()
    p = subprocess.Popen(full, shell=True, cwd=os.path.join(WORK, "scripts/verify"),
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    out, _ = p.communicate()
    dt = round(time.time() - t0, 1)
    with open(os.path.join(outdir, "stdout.txt"), "w") as fh:
        fh.write(out)
    return {"name": name, "cmd": cmd, "args": args, "exit": p.returncode, "seconds": dt,
            "tail": out[-1500:]}


def main():
    os.makedirs(OUT, exist_ok=True)
    started = time.time()
    name, driver = gpu_name_and_driver()
    log("GPU:", name, "driver", driver)
    install_toolchain()
    install_nvidia_gl(driver)
    chrome_wrapper = write_chrome_wrapper()
    clone_repo()
    ensure_playwright_core()

    # One server per check port so parallel checks never queue on one socket.
    ports = [BASE_PORT + i for i in range(len(CHECKS))]
    servers = [start_server(p) for p in ports]

    results = []
    try:
        # Simple bounded pool: run at most CONCURRENCY checks at a time.
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as ex:
            futs = [ex.submit(run_check, chk, ports[i], chrome_wrapper)
                    for i, chk in enumerate(CHECKS)]
            for f in futs:
                r = f.result()
                results.append(r)
                log("check %-20s exit=%s  %ss" % (r["name"], r["exit"], r["seconds"]))
    finally:
        for s in servers:
            try:
                s.terminate()
            except Exception:
                pass

    manifest = {
        "gpu": name, "driver": driver, "repo": REPO, "ref": REF,
        "total_seconds": round(time.time() - started, 1),
        "results": results,
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    with open(os.path.join(OUT, "setup.log"), "w") as fh:
        fh.write("\n".join(log_lines))

    # Some checks (shot.mjs and friends) write PNGs into scripts/verify/shots
    # relative to their own cwd rather than into VERIFY_OUT. Fold that in so the
    # frames come back too.
    shots = os.path.join(WORK, "scripts/verify/shots")
    if os.path.isdir(shots):
        dest = os.path.join(OUT, "shots")
        if os.path.exists(dest):
            shutil.rmtree(dest)
        shutil.copytree(shots, dest)

    with tarfile.open("/content/out.tar", "w") as tar:
        tar.add(OUT, arcname="out")
    log("== done ==")
    print("MANIFEST " + json.dumps(manifest))


if __name__ == "__main__":
    main()
