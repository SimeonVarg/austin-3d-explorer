#!/usr/bin/env python3
"""
watch-agents.py - a live window into what the agents are actually doing.

The /workflows panel shows the scoreboard: name, model, tokens, elapsed. It does
not show the work. This does: every command, every file read, every search,
every edit, every result, and everything an agent writes - as it happens.

    scripts\\watch.cmd                 follow every live agent
    scripts\\watch.cmd --one           follow only the busiest one
    scripts\\watch.cmd --list          what is running right now, then exit
    scripts\\watch.cmd --full          stop shortening long lines
    scripts\\watch.cmd thinking        turn the agents' thinking on or off

HOW LIVE IS IT: an agent writes to its transcript the moment it finishes a turn,
which is the moment it fires a tool and again the moment the result lands. Both
measured on this machine: a transcript grew at 12:15:34.63 as the tool calls went
out and again at 12:15:41.81 as the results came back. A long quiet stretch is
not this viewer lagging - it is an agent sitting inside one long command.

THE THINKING: Claude Code asks the API for "redacted" thinking by default, so no
thinking text ever arrives and the block is stored empty. Turning on the
showThinkingSummaries setting asks for summaries instead, and then the text does
arrive and does get stored. `watch.cmd thinking on` flips it. Until then this
viewer says so plainly rather than passing tool calls off as reasoning.

Read-only on transcripts. Never writes to the repo, never touches git.
"""
import argparse
import glob
import io
import json
import os
import re
import shutil
import sys
import time

HOME = os.path.expanduser("~")
# WATCH_AGENTS_ROOT exists so the empty-state can be tested; nobody needs to set it.
ROOT = os.environ.get("WATCH_AGENTS_ROOT") or os.path.join(HOME, ".claude", "projects")
SETTINGS = os.path.join(HOME, ".claude", "settings.json")

# --- taste values: every one of these is meant to be edited ------------------
IDLE_SECS = 240          # no writes for this long = treat the agent as finished
POLL_SECS = 0.6          # how often to look for new lines
RESCAN_SECS = 5.0        # how often to look for brand-new agents and workflows
RESULT_CHARS = 150       # how much of a tool's output to show
SAYS_CHARS = 320         # how much of an agent's own message to show
THINK_CHARS = 320        # how much of a thinking summary to show
LABEL_WIDTH = 18         # width of the agent-name column
AGENT_COLOURS = ("96", "92", "93", "95", "94", "91")  # cyan green yellow magenta blue red


# --- colour ------------------------------------------------------------------

def _enable_windows_colour():
    """
    Best effort, and deliberately not a veto. Windows 11 consoles already accept
    colour; this only matters for an old conhost that needs the flag turned on.
    It returns False whenever stdout is a pipe - which is not a reason to drop
    colour, because a pipe is not where the user is looking. Whether to colour
    at all is decided by isatty(), not by this.
    """
    if os.name != "nt":
        return True
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not k.GetConsoleMode(h, ctypes.byref(mode)):
            return False
        # add VIRTUAL_TERMINAL_PROCESSING; keep whatever else was already set
        return bool(k.SetConsoleMode(h, mode.value | 0x0004))
    except Exception:
        return False


def say(s=""):
    """The one printer. Never dies on a Windows code page."""
    line = s + "\n"
    try:
        sys.stdout.write(line)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(line.encode("utf-8", "replace"))


class Ink(object):
    def __init__(self, on):
        self.on = on

    def __call__(self, code, text):
        if not self.on or not code:
            return text
        return "\x1b[%sm%s\x1b[0m" % (code, text)


INK = Ink(False)


# --- finding the agents ------------------------------------------------------

def workflow_dirs():
    return glob.glob(os.path.join(ROOT, "*", "*", "subagents", "workflows", "wf_*"))


def project_key(cwd=None):
    """~/.claude/projects uses a flattened form of the path: C--Users-me-proj."""
    p = os.path.abspath(cwd or os.getcwd())
    return p.replace(":", "-").replace("\\", "-").replace("/", "-")


def agent_files(wf):
    out = []
    for f in glob.glob(os.path.join(wf, "agent-*.jsonl")):
        try:
            out.append((os.path.getmtime(f), f))
        except OSError:
            pass
    return sorted(out, reverse=True)


def live_agents(here_only=True, idle=IDLE_SECS):
    """Every agent file that has been written to recently, newest first."""
    now = time.time()
    key = project_key()
    found = []
    for wf in workflow_dirs():
        if here_only and key.lower() not in wf.replace("/", os.sep).lower():
            continue
        for mt, f in agent_files(wf):
            if now - mt < idle:
                found.append((mt, f, wf))
    found.sort(reverse=True)
    if not found and here_only:
        return live_agents(here_only=False, idle=idle)
    return found


_TITLES = {}


def workflow_started(wf):
    """When this workflow began: the oldest spawn marker in its folder."""
    times = [os.path.getmtime(p) for p in glob.glob(os.path.join(wf, "agent-*.meta.json"))]
    times += [os.path.getmtime(p) for p in glob.glob(os.path.join(wf, "agent-*.jsonl"))]
    return min(times) if times else os.path.getmtime(wf)


def workflow_title(wf):
    """
    The workflow's own one-line description. It lives in the MAIN session
    transcript as the Workflow tool call that spawned this folder, and there is
    no id linking the two - so match on time: take the last Workflow call made
    at or just before this folder appeared.
    """
    if wf in _TITLES:
        return _TITLES[wf]
    _TITLES[wf] = ""
    try:
        main = os.path.dirname(os.path.dirname(os.path.dirname(wf))) + ".jsonl"
        if not os.path.exists(main):
            return ""
        born = workflow_started(wf) + 90          # slack: spawn is not instant
        best_t, best = 0.0, ""
        with io.open(main, encoding="utf-8", errors="ignore") as fh:
            for raw in fh:
                if '"Workflow"' not in raw or '"description"' not in raw:
                    continue
                try:
                    o = json.loads(raw)
                except ValueError:
                    continue
                t = _iso(o.get("timestamp"))
                if not t or t > born or t < best_t:
                    continue
                c = (o.get("message") or {}).get("content")
                if not isinstance(c, list):
                    continue
                for b in c:
                    if isinstance(b, dict) and b.get("name") == "Workflow":
                        d = (b.get("input") or {}).get("description")
                        if d:
                            best_t, best = t, " ".join(str(d).split())
        _TITLES[wf] = best
    except Exception:
        pass
    return _TITLES[wf]


def _iso(s):
    """'2026-08-26T16:57:00.558Z' -> unix seconds, or 0."""
    if not s or len(s) < 19:
        return 0.0
    try:
        import calendar
        return calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception:
        return 0.0


def clock(s):
    """
    Transcript timestamps are UTC. Show them on HIS clock instead - a feed that
    says 17:25 while the taskbar says 12:25 reads as broken.
    """
    t = _iso(s)
    if not t:
        return " " * 8
    return time.strftime("%H:%M:%S", time.localtime(t))


# --- naming an agent ---------------------------------------------------------

_LABELS = {}
_ORDINAL = [0]
_PIECE = re.compile(r"^\s*(?:\*\*)?PIECE(?:\*\*)?\s*[:\-]\s*(.+?)\s*$", re.M | re.I)
_BRANCHY = re.compile(r"\b(?:acer|mac|cloud|feat|fix)/([A-Za-z0-9._-]+)")
_ROUND = re.compile(r"\bROUND\s+(\d+)\b", re.I)
_STOPWORDS = set("""the a an of on in at to for and or is are was were it its this that
with from into by as be been all any not no nothing every""".split())


def label_for(path):
    """
    Nothing on disk stores the name /workflows shows. journal.jsonl has only ids,
    .meta.json has only the model, and the session `slug` is identical for every
    agent in the run. So the only real source is the agent's own opening prompt.

    Prompts in a round share a long identical preamble, so a first-few-lines
    heuristic names them all the same thing - which is worse than useless. Look
    for what actually differs: the PIECE: line, then the branch it was given.
    Fall back to a plain number rather than inventing a name that looks precise
    and is wrong.
    """
    if path in _LABELS:
        return _LABELS[path]
    _ORDINAL[0] += 1
    name = "agent %d" % _ORDINAL[0]
    try:
        txt = _opening_prompt(path)
        if txt:
            name = _name_from_prompt(txt, name)
    except Exception:
        pass
    _LABELS[path] = name[:LABEL_WIDTH]
    return _LABELS[path]


_PROJECTS = {}


def project_of(path):
    """Which folder the agent is actually working in - it may not be yours."""
    if path in _PROJECTS:
        return _PROJECTS[path]
    name = ""
    try:
        with io.open(path, encoding="utf-8", errors="ignore") as fh:
            for _ in range(3):
                raw = fh.readline()
                if not raw:
                    break
                try:
                    o = json.loads(raw)
                except ValueError:
                    continue
                if o.get("cwd"):
                    name = os.path.basename(str(o["cwd"]).rstrip("\\/"))
                    break
    except Exception:
        pass
    _PROJECTS[path] = name
    return name


def _opening_prompt(path):
    with io.open(path, encoding="utf-8", errors="ignore") as fh:
        for _ in range(6):
            raw = fh.readline()
            if not raw:
                return ""
            try:
                o = json.loads(raw)
            except ValueError:
                continue
            m = o.get("message") or {}
            if m.get("role") != "user":
                continue
            c = m.get("content")
            return c if isinstance(c, str) else " ".join(
                b.get("text", "") for b in (c or []) if isinstance(b, dict))
    return ""


def _squeeze(phrase, budget):
    """'The missing rooms on UT Registration Plus' -> 'missing-rooms'."""
    words = [w.strip(".,:;'\"()[]`*").lower() for w in str(phrase).split()]
    words = [w for w in words if w and w not in _STOPWORDS]
    out = ""
    for w in words:
        nxt = (out + "-" + w) if out else w
        if len(nxt) > budget:
            break
        out = nxt
    return out or (words[0][:budget] if words else "")


def _name_from_prompt(txt, fallback):
    up = txt.upper()
    if "HARSH CRITIC" in up or "YOU ARE THE CRITIC" in up:
        role = "critic"
    elif "INDEPENDENT JUDGE" in up or "INDEPENDENT VERIF" in up:
        role = "judge"
    elif "RESEARCH LANE" in up or "RECON" in up or "READ-ONLY" in up:
        role = "recon"
    else:
        role = "build"

    rnd = ""
    mr = _ROUND.search(txt)
    if mr:
        rnd = "r" + mr.group(1)

    budget = LABEL_WIDTH - len(role) - 1 - (len(rnd) + 1 if rnd else 0)
    tag = ""
    mp = _PIECE.search(txt)
    if mp:
        tag = _squeeze(mp.group(1), budget)
    if not tag:
        mb = _BRANCHY.search(txt)
        if mb:
            tag = _squeeze(mb.group(1).replace("-", " "), budget)
    if not tag:
        return fallback
    out = "%s:%s" % (role, tag)
    if rnd:
        out += " " + rnd
    return out


# --- turning one content block into one readable line ------------------------

_FILEY = ("Read", "Write", "Edit", "NotebookEdit")
_PATTERNY = ("Grep", "Glob")


def _short_path(p):
    p = str(p).replace("\\", "/")
    parts = [x for x in p.split("/") if x]
    return "/".join(parts[-2:]) if len(parts) > 1 else p


def describe_tool(name, inp):
    name = name or "tool"
    inp = inp if isinstance(inp, dict) else {}
    if name.startswith("mcp__"):
        name = name.split("__")[-1]
    if name == "Bash":
        arg = inp.get("command") or inp.get("description") or ""
    elif name in _FILEY:
        arg = _short_path(inp.get("file_path") or "")
        if name == "Edit" and inp.get("old_string"):
            # a couple of words of what is being replaced, not a wall of code
            words = " ".join(str(inp["old_string"]).split())[:34].rstrip()
            if words:
                arg += "   (changing \"%s…\")" % words
        elif name == "Write" and inp.get("content") is not None:
            arg += "   (%d lines)" % (str(inp["content"]).count("\n") + 1)
    elif name in _PATTERNY:
        arg = str(inp.get("pattern") or "")
        if inp.get("path"):
            arg += "   in " + _short_path(inp["path"])
    elif name in ("Task", "Workflow", "Agent"):
        arg = str(inp.get("description") or inp.get("prompt") or "")
    elif name in ("WebFetch", "WebSearch"):
        arg = str(inp.get("url") or inp.get("query") or "")
    elif name == "TodoWrite":
        todos = inp.get("todos") or []
        doing = [t.get("content", "") for t in todos
                 if isinstance(t, dict) and t.get("status") == "in_progress"]
        arg = (doing[0] if doing else "%d items" % len(todos))
    else:
        arg = (inp.get("description") or inp.get("command") or inp.get("file_path")
               or inp.get("pattern") or inp.get("query") or inp.get("prompt") or "")
        if not arg and inp:
            arg = json.dumps(inp)[:120]
    return name, " ".join(str(arg).split())


_BOILERPLATE = (
    "has been updated successfully",
    "file created successfully",
    "no need to read it back",
    "todos have been modified successfully",
)


def _is_boilerplate(s):
    """A result that only repeats what the action line already said."""
    low = s.lower()
    return len(s) < 260 and any(p in low for p in _BOILERPLATE)


_HERE = os.getcwd()


def _dehydrate(s):
    """Long absolute paths eat the whole line and tell him nothing new."""
    for root in (_HERE, _HERE.replace("\\", "/"), HOME, HOME.replace("\\", "/")):
        if root and len(root) > 8:
            s = s.replace(root + os.sep, "").replace(root + "/", "").replace(root, "")
    return s


def block_line(block):
    """(kind, text, colour) for one content block, or None to skip it."""
    t = block.get("type")
    if t == "tool_use":
        name, arg = describe_tool(block.get("name"), block.get("input"))
        return (name, arg, "97")
    if t == "tool_result":
        c = block.get("content")
        s = c if isinstance(c, str) else " ".join(
            x.get("text", "") for x in (c or []) if isinstance(x, dict))
        s = " ".join(str(s).split())
        if not s or _is_boilerplate(s):
            return None
        s = _dehydrate(s)
        bad = bool(block.get("is_error")) or s[:80].lower().startswith(("error", "traceback"))
        return ("->", s, "91" if bad else "90")
    if t == "text":
        s = " ".join((block.get("text") or "").split())
        if not s:
            return None
        return ("says", s, "0")
    if t == "thinking":
        s = " ".join((block.get("thinking") or "").split())
        if not s:
            return ("__EMPTY_THOUGHT__", "", "")
        return ("thinks", s, "90")
    return None


# --- the feed ----------------------------------------------------------------

class Feed(object):
    def __init__(self, args):
        self.args = args
        self.handles = {}      # path -> file handle
        self.colour = {}       # path -> ansi code
        self.started = {}      # path -> first-seen time
        self.calls = {}        # path -> tool-call count
        self.done = set()
        self.last = None       # (label, kind, text) of the previous line
        self.repeat = 0
        self.saw_thinking_text = False
        self.warned_no_thinking = False

    # -- printing ----------------------------------------------------------
    def _width(self):
        try:
            return max(60, shutil.get_terminal_size((120, 30)).columns)
        except Exception:
            return 120

    def out(self, s):
        try:
            sys.stdout.write(s + "\n")
        except UnicodeEncodeError:
            sys.stdout.buffer.write((s + "\n").encode("utf-8", "replace"))
        sys.stdout.flush()

    def emit(self, ts, path, kind, text, colour):
        label = label_for(path)
        here = (label, kind, text)
        if here == self.last:
            self.repeat += 1
            return
        if self.repeat:
            self.out("%s %s %s" % (" " * 8, " " * LABEL_WIDTH,
                                   INK("90", "  (same again x%d)" % self.repeat)))
            self.repeat = 0
        self.last = here
        room = self._width() - 8 - LABEL_WIDTH - 12 - 4
        if not self.args.full and len(text) > room:
            text = text[:max(20, room - 3)] + "..."
        self.out("%s %s %s %s" % (
            INK("90", ts),
            INK(self.colour.get(path, "97"), label.ljust(LABEL_WIDTH)),
            INK("1", kind.ljust(10)) if kind not in ("->",) else INK("90", kind.ljust(10)),
            INK(colour, text)))

    # -- reading -----------------------------------------------------------
    def render(self, raw, path):
        try:
            o = json.loads(raw)
        except ValueError:
            return
        ts = clock(o.get("timestamp"))
        c = (o.get("message") or {}).get("content")
        if not isinstance(c, list):
            return
        for b in c:
            if not isinstance(b, dict):
                continue
            r = block_line(b)
            if not r:
                continue
            kind, text, colour = r
            if kind == "__EMPTY_THOUGHT__":
                self.note_no_thinking()
                continue
            if kind == "thinks":
                self.saw_thinking_text = True
                text = text[:THINK_CHARS]
            elif kind == "says":
                text = text[:SAYS_CHARS]
            elif kind == "->":
                if self.args.quiet:
                    continue
                text = text[:RESULT_CHARS]
            self.emit(ts, path, kind, text, colour)
            if kind not in ("->", "says", "thinks"):
                self.calls[path] = self.calls.get(path, 0) + 1

    def note_no_thinking(self):
        if self.warned_no_thinking or self.saw_thinking_text:
            return
        self.warned_no_thinking = True
        self.out("")
        self.out(INK("93", "  The agents ARE thinking here, but the thinking is not being saved,"))
        self.out(INK("93", "  so there is nothing for me to show you. To switch it on, run:"))
        self.out(INK("1", "      scripts\\watch.cmd thinking on"))
        self.out(INK("93", "  then start a new workflow. Everything else below is real work."))
        self.out("")

    # -- lifecycle ---------------------------------------------------------
    def adopt(self, path):
        if path in self.handles:
            return
        try:
            fh = io.open(path, encoding="utf-8", errors="ignore")
        except OSError:
            return
        self.colour[path] = AGENT_COLOURS[len(self.handles) % len(AGENT_COLOURS)]
        self.started[path] = os.path.getmtime(path)
        lines = fh.readlines()
        label = label_for(path)
        self.handles[path] = fh
        self.out(INK("1", "  + %s joined  (%d lines already)" % (label, len(lines))))
        for raw in lines[-self.args.tail:]:
            self.render(raw, path)

    def finish(self, path):
        if path in self.done:
            return
        self.done.add(path)
        label = label_for(path)
        mins = (os.path.getmtime(path) - self.started.get(path, 0)) / 60.0
        summary = journal_result(path)
        tail = ("  -  " + summary[:90]) if summary else ""
        self.out(INK("1", "  * %s finished  -  %d tool calls, %s%s" % (
            label, self.calls.get(path, 0),
            ("%.0f min" % mins) if mins >= 1 else "under a minute", tail)))

    def pump(self):
        moved = False
        for path in list(self.handles):
            fh = self.handles[path]
            try:
                for raw in fh.readlines():
                    if path in self.done:
                        # it went quiet long enough to look finished, then spoke
                        # again. A four-minute pause inside one long command is
                        # normal here, so take the "finished" back.
                        self.done.discard(path)
                        self.out(INK("1", "  + %s is going again" % label_for(path)))
                    self.render(raw, path)
                    moved = True
            except (OSError, ValueError):
                continue
            try:
                if time.time() - os.path.getmtime(path) > IDLE_SECS:
                    self.finish(path)
            except OSError:
                pass
        return moved


def journal_result(agent_path):
    """The one-line takeaway an agent left behind, if it left one."""
    j = os.path.join(os.path.dirname(agent_path), "journal.jsonl")
    aid = os.path.basename(agent_path)[6:-6]
    try:
        with io.open(j, encoding="utf-8", errors="ignore") as fh:
            for raw in fh:
                if aid not in raw or '"result"' not in raw:
                    continue
                try:
                    o = json.loads(raw)
                except ValueError:
                    continue
                if o.get("agentId") != aid or o.get("type") != "result":
                    continue
                r = o.get("result")
                if isinstance(r, dict):
                    for k in ("summary", "verdict", "best", "result", "lane"):
                        if r.get(k):
                            return " ".join(str(r[k]).split())
                    r = json.dumps(r)
                return " ".join(str(r).split())
    except (OSError, ValueError):
        pass
    return ""


# --- the thinking switch -----------------------------------------------------

THINK_KEY = "showThinkingSummaries"


def read_settings():
    try:
        with io.open(SETTINGS, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def thinking_command(word):
    s = read_settings()
    now = bool(s.get(THINK_KEY))
    if word in ("", "status"):
        say("Thinking summaries are currently %s." % ("ON" if now else "OFF"))
        say("File: %s" % SETTINGS)
        if not now:
            say("\nTo turn them on:   scripts\\watch.cmd thinking on")
        else:
            say("\nTo turn them off:  scripts\\watch.cmd thinking off")
        return 0
    if word not in ("on", "off"):
        say("Say 'on', 'off' or 'status'.")
        return 2
    want = (word == "on")
    if want == now:
        say("Thinking summaries are already %s. Nothing to change." % word.upper())
        return 0
    s[THINK_KEY] = want
    backup = SETTINGS + ".before-watch-agents"
    try:
        if os.path.exists(SETTINGS):
            shutil.copyfile(SETTINGS, backup)
        with io.open(SETTINGS, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(s, indent=2) + "\n")
    except OSError as e:
        say("Could not write %s: %s" % (SETTINGS, e))
        return 1
    say("Thinking summaries are now %s." % word.upper())
    say("Changed one line in %s" % SETTINGS)
    say("  \"%s\": %s" % (THINK_KEY, "true" if want else "false"))
    say("A copy of the old file is at %s" % backup)
    say("\nStart a NEW workflow for this to take effect - runs already going")
    say("keep the setting they started with.")
    if want:
        say("\nYou will get short summaries of the reasoning, not the raw")
        say("word-for-word thoughts. That is all the API sends.")
    return 0


# --- header ------------------------------------------------------------------

def banner(feed, agents, title):
    w = min(78, feed._width())
    bar = "=" * w
    feed.out("")
    feed.out(INK("1", bar))
    feed.out(INK("1", " WATCHING THE AGENTS"))
    if title:
        feed.out("   " + INK("96", title[:w - 4]))
    where = project_of(agents[0][1]) or os.path.basename(os.getcwd())
    feed.out(" " + INK("90", "%d agent%s working in %s" % (
        len(agents), "" if len(agents) == 1 else "s", where)))
    feed.out(INK("1", "-" * w))
    feed.out(" You WILL see: every command, file opened, search, edit, and")
    feed.out(" everything each agent writes down - as it happens.")
    thinking_on = bool(read_settings().get(THINK_KEY))
    if thinking_on:
        feed.out(" You WILL also see: short summaries of their thinking (lines")
        feed.out(" marked " + INK("1", "thinks") + ").")
    else:
        feed.out(INK("93", " You will NOT see: their thinking. It is not being saved right"))
        feed.out(INK("93", " now. Run  ") + INK("1", "scripts\\watch.cmd thinking on") +
                 INK("93", "  to change that."))
    feed.out(" " + INK("90", "Press Ctrl+C to stop. Closing this window changes nothing."))
    feed.out(INK("1", bar))
    feed.out("")


# --- main --------------------------------------------------------------------

def _ago(secs):
    if secs < 90:
        return "%d seconds ago" % secs
    if secs < 5400:
        return "%d minutes ago" % (secs / 60)
    if secs < 172800:
        return "%d hours ago" % (secs / 3600)
    return "%d days ago" % (secs / 86400)


def cmd_list():
    now = time.time()
    rows = live_agents(idle=10 ** 9)
    if not rows:
        say("\n  No agent runs found yet.")
        say("  Start a workflow in Claude Code and they will show up here.\n")
        return 0
    groups = {}
    for mt, f, wf in rows:
        groups.setdefault(wf, []).append((mt, f))
    order = sorted(groups, key=lambda w: max(m for m, _ in groups[w]), reverse=True)
    shown = 0
    for wf in order:
        if shown >= 24:
            say("\n  (older runs not shown)")
            break
        agents = sorted(groups[wf], reverse=True)
        live = sum(1 for mt, _ in agents if now - mt < IDLE_SECS)
        title = workflow_title(wf) or os.path.basename(wf)
        head = "%s  -  %d live, %d finished" % (title, live, len(agents) - live)
        say("\n" + INK("1", head))
        for mt, f in agents[:12]:
            age = now - mt
            state = "LIVE" if age < IDLE_SECS else "done"
            say("   %s %-18s last active %-16s %5.1f MB" % (
                INK("92" if state == "LIVE" else "90", state),
                label_for(f), _ago(age), os.path.getsize(f) / 1e6))
            shown += 1
    say("")
    return 0


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("mode", nargs="?", default="", help="'thinking' to change the thinking setting")
    ap.add_argument("word", nargs="?", default="", help="on / off / status")
    ap.add_argument("--one", action="store_true", help="follow only the busiest agent")
    ap.add_argument("--list", action="store_true", help="show what is running, then exit")
    ap.add_argument("--tail", type=int, default=12, help="replay this many recent lines first")
    ap.add_argument("--full", action="store_true", help="do not shorten long lines")
    ap.add_argument("--quiet", action="store_true", help="hide tool output, show only actions")
    ap.add_argument("--no-color", dest="colour", action="store_false", help="plain text")
    ap.add_argument("--anywhere", action="store_true", help="watch every project, not just this one")
    ap.add_argument("-h", "--help", action="help")
    args = ap.parse_args()

    _enable_windows_colour()          # best effort, never a veto - see the note there
    INK.on = bool(args.colour) and sys.stdout.isatty() and not os.environ.get("NO_COLOR")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    if args.mode == "thinking":
        return thinking_command(args.word)
    if args.mode and args.mode not in ("thinking", "watch"):
        say("I do not know '%s'. Try:  watch.cmd   or   watch.cmd thinking" % args.mode)
        return 2
    if args.list:
        return cmd_list()

    feed = Feed(args)
    waiting_said = False
    shown_banner = False
    last_scan = 0.0

    try:
        while True:
            if time.time() - last_scan >= RESCAN_SECS:
                last_scan = time.time()
                rows = live_agents(here_only=not args.anywhere)
                if rows and not shown_banner:
                    banner(feed, rows, workflow_title(rows[0][2]))
                    shown_banner = True
                    waiting_said = False
                picks = rows[:1] if args.one else rows
                for mt, f, wf in picks:
                    feed.adopt(f)
                if not rows and not waiting_said:
                    waiting_said = True
                    feed.out("")
                    feed.out(INK("1", "  WATCHING THE AGENTS"))
                    feed.out("")
                    feed.out(INK("1", "  Nothing is running right now."))
                    feed.out("  I am watching and will start printing the moment an agent")
                    feed.out("  starts working. You can leave this window open.")
                    feed.out("  " + INK("90", "(Press Ctrl+C to stop.)"))
                    feed.out("")
            if not feed.pump():
                time.sleep(POLL_SECS)
    except KeyboardInterrupt:
        feed.out("")
        feed.out(INK("1", "  Stopped. The agents keep working - this was only a window."))
        return 0
    except Exception as e:                      # never dump a stack trace at him
        feed.out("")
        feed.out(INK("91", "  This viewer hit a snag and stopped: %s" % e))
        feed.out("  The agents are unaffected. Run it again to carry on.")
        return 1


if __name__ == "__main__":
    sys.exit(main() or 0)
