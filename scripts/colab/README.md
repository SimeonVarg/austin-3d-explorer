# scripts/colab - run the browser checks on a rented GPU

The checks in `scripts/verify` need a real GPU: on software rendering the city
draws at well under one frame a second, so anything that has to move the camera
or let the scene settle times out. This machine has a GPU, but only one, and
only one full-app 3D browser fits in it at a time - so the checks queue, behind
each other and behind everything else that wants that browser.

This runner rents a Google Colab **L4** for a few minutes instead. An L4 has 12
CPUs, 52 GB of RAM and a real NVIDIA GPU, and it holds **four** full-city
browsers at once (a T4, with 2 CPUs, cannot). The checks run there, up to four
in parallel, their frames and exit codes come back to a local folder, and the
session is **always** stopped afterward - on success, on error and on Ctrl-C -
so a rented GPU is never left running.

## What you need

- The official Colab CLI, installed and signed in
  (`github.com/googlecolab/google-colab-cli`).
- Python 3 and `git` on the machine that runs `run.py`.
- A Colab balance with compute units (the runner prints the balance before and
  after so you can see what a run cost).

Nothing is downloaded to your machine except the checks' own output. Chrome,
Node, Playwright and the matching NVIDIA GPU libraries are all installed **on
the Colab VM** by `setup.py`, which throws the VM away when the session stops.

## The CLI command comes from an environment variable

`run.py` invokes the CLI as whatever `COLAB_CLI` is set to, defaulting to the
bare word `colab`. Set it to match how the CLI is reached on your machine. It is
split as a shell command line, so a multi-word wrapper works.

If the CLI lives in WSL (a common setup on Windows), point `COLAB_CLI` at the
WSL invocation. The generic form is:

```
COLAB_CLI="wsl.exe -d <distro> -- <path-to>/colab --auth oauth2"
```

for example, with the CLI installed under a user's `~/.local/bin`:

```
COLAB_CLI="wsl.exe -d Ubuntu -- /home/<user>/.local/bin/colab --auth oauth2"
```

On Linux or macOS with the CLI on `PATH`, leave `COLAB_CLI` unset.

## Running

```
python scripts/colab/run.py --ref main \
    --check graphics.mjs \
    --check "movement.mjs --report" \
    --out ./colab-out
```

- `--ref` is any git ref: a branch, a tag or a full sha. It is shallow-cloned.
- `--check` is one `scripts/verify/*.mjs` check with its arguments, quoted.
  Repeat it for more than one; up to `--parallel` (default 4) run at once.
- `--out` is the local folder the outputs land in.
- `--repo` defaults to this checkout's own `origin` (normalised to https), so a
  fork or a different URL can be passed explicitly.
- `--gpu` defaults to `L4`. `--parallel` defaults to 4. `--keep` leaves the
  session running for debugging (it is stopped by default).

Each check's output arrives under `--out/out/<check-name>/`:
`stdout.txt` (its full console output), plus any screenshots or reports it wrote
(the runner points `VERIFY_OUT` at that folder). `--out/out/manifest.json` lists
every check with its exit code and wall time, `--out/run-summary.json` records
the session, the git ref, the units before and after, and the total wall time.

`run.py` exits non-zero if any check failed, so it composes in a pipeline.

## How it gets the L4 GPU (and why the checks are unmodified)

Colab mounts only NVIDIA's **compute** libraries, so Chrome finds no hardware GL
driver and falls back to a software rasteriser (SwiftShader). To reach the L4,
`setup.py`:

1. reads the exact driver version from `nvidia-smi`;
2. downloads that driver's `.run` installer and unpacks the **userspace GL**
   libraries out of it (`libEGL_nvidia`, `libGLX_nvidia`, `libnvidia-glcore`
   and friends), copies them next to the compute libraries and runs `ldconfig`;
3. registers the EGL vendor (`/usr/share/glvnd/egl_vendor.d/10_nvidia.json`) and
   the Vulkan ICD;
4. writes a tiny **Chrome wrapper** that appends `--use-gl=angle
   --use-angle=gl-egl`, and points the verify harness at it through
   `CHROME_PATH`, with `VERIFY_GL=hardware` so `scripts/verify/chrome.mjs` stops
   adding its SwiftShader flags.

Because the harness already honours `CHROME_PATH` and `VERIFY_GL`, **no verify
script changes.** The renderer string in a check's output reads
`ANGLE (NVIDIA Corporation, NVIDIA L4 ...)` rather than `SwiftShader`, which is
how you confirm a run used the GPU.

Playwright is run as a **subprocess** on the VM, never inside the notebook
kernel, so its event loop does not fight Colab's.

## Traps, learned the hard way

- **The NVIDIA GL libraries must match the driver version exactly.** They are
  extracted from that driver's own installer for that reason; a mismatch loads
  and then renders on the CPU with no error.
- **Serve with `scripts/serve.py`, never `python -m http.server`.** The stdlib
  server ignores `Range:` requests, so PMTiles archives come back whole and the
  layers that read slices out of them render nothing, with no console error.
  Each parallel check gets its own port and its own server.
- **An L4 holds four browsers; a T4 does not.** Keep `--parallel` at 4 or fewer
  on an L4, and expect a T4 to fall over with the full city.
- **The session is stopped in a `finally`/`atexit`/signal path.** If you add
  code, keep it that way. A rented GPU left running bills by the hour.
- **Never run the whole job inside one `colab exec`.** That holds a single
  websocket for the entire run; on 2026-09-30 it dropped after 39 minutes of an
  eight-check run, and because `setup.py` packs its outputs only at the end,
  nothing came back. `launch.py` now starts `setup.py` in its own process group
  and returns at once; `run.py` then asks `poll.py` for the state every 30
  seconds. A dropped connection costs one poll. If the run dies, or
  `--exec-timeout` (now the deadline for the whole run) passes, `poll.py` packs
  whatever outputs exist so they still download.
