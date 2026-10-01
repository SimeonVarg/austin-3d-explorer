"""poll.py - one short read of the detached run started by launch.py.

Prints "STATE running" (with the newest log line), "STATE done" (with the
MANIFEST line) or "STATE died" (with the log tail). If the run died, or PACK=1
is set because run.py's deadline passed, it packs whatever outputs exist into
/content/out.tar so they can still be downloaded.
"""
import os
import tarfile

OUT, TAR, LOG, PID = "/content/out", "/content/out.tar", "/content/setup.out", "/content/setup.pid"
text = open(LOG).read() if os.path.exists(LOG) else ""
lines = text.splitlines()
pid = int(open(PID).read()) if os.path.exists(PID) else 0
alive = False
if pid:
    try:
        # The kernel never reaps the child, so a finished run lingers as a zombie.
        alive = "\nState:\tZ" not in open("/proc/%d/status" % pid).read()
    except OSError:
        alive = False


def pack():
    if os.path.isdir(OUT) and not os.path.exists(TAR):
        with tarfile.open(TAR, "w") as tar:
            tar.add(OUT, arcname="out")


manifest = [l for l in lines if l.startswith("MANIFEST ")]
if manifest:
    print(manifest[-1])
    print("STATE done")
elif alive:
    if os.environ.get("PACK") == "1":
        pack()
    print("TAIL " + (lines[-1][:300] if lines else ""))
    print("STATE running")
else:
    pack()
    print("\n".join(lines[-40:]))
    print("STATE died")
