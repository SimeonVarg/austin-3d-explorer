"""launch.py - start setup.py detached on the Colab VM and return at once.

run.py used to run setup.py inside one `colab exec` that held a websocket open
for the whole run. When that connection dropped (seen after 39 minutes on an
eight-check run), the exec died before setup.py had packed its outputs, so
nothing came back. Now setup.py runs in its own process group, writing to
/content/setup.out, and run.py asks for its state with short poll.py calls.
The REPO/REF/CHECKS/CONCURRENCY variables set with --env are passed through.
"""
import os
import subprocess

log = open("/content/setup.out", "w")
proc = subprocess.Popen(["python3", "/content/setup.py"], stdout=log, stderr=subprocess.STDOUT,
                        stdin=subprocess.DEVNULL, start_new_session=True, env=dict(os.environ))
with open("/content/setup.pid", "w") as fh:
    fh.write(str(proc.pid))
print("LAUNCHED", proc.pid)
