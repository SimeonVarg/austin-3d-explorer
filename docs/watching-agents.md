# Watching the agents work

You asked to see the agents actually working, not just their names and a token
counter. Here is how.

## Start it

Open File Explorer.

Go to `C:\Users\simip\Projects\austin-3d-explorer\scripts`.

Double-click **`watch.cmd`**.

A black window opens and starts printing. That is it. Nothing else to set up.

If you would rather type it, this is the whole command:

```
C:\Users\simip\Projects\austin-3d-explorer\scripts\watch.cmd
```

Right-click `watch.cmd` and pick "Pin to Start" if you want it one click away.

## What you will see

Every agent that is working, all at once, colour-coded by name.

A line lands the moment it happens:

```
12:32:19  build:missing r2   Bash       python scripts/verify/schedimg.mjs --real
12:32:19  build:missing r2   ->         74 distinctive strings written  rooms 35
12:32:26  build:missing r2   Write      scratchpad/scan.py   (24 lines)
12:33:10  build:missing r2   says       Too much noise from map data. Tightening.
```

Reading left to right: the time on your clock, which agent, what it did, and
what it did it to. Lines starting `->` are what came back.

`says` lines are the agent talking - its own notes as it works. That is the
closest thing to watching it think that exists today.

When an agent joins you get a `+` line. When it finishes you get a `*` line with
how long it took, how many tools it used, and its conclusion.

## What you will NOT see

**Their thinking.** Not by default.

Claude Code asks the model to keep its reasoning hidden, so the reasoning never
reaches your computer at all. It is not hidden from you in the window - it was
never saved anywhere. The viewer says this once, on screen, rather than letting
you assume the commands are the thinking.

You can switch it on. Run this:

```
C:\Users\simip\Projects\austin-3d-explorer\scripts\watch.cmd thinking on
```

Then start a new workflow. Runs already going keep the setting they started
with.

To switch it back off:

```
C:\Users\simip\Projects\austin-3d-explorer\scripts\watch.cmd thinking off
```

Two honest warnings about this.

One: you get **short summaries** of the reasoning, not the raw word-for-word
thoughts. Summaries are all the model sends. Nobody can get the raw stream.

Two: I could not test this end to end. I read the code inside Claude Code and it
says this is the switch, and I found the exact place where the empty thinking
comes from, and old transcripts on your disk from an older version do have real
thinking text in them. But I could not start a second Claude Code to prove it,
because only your app can sign in. So: likely, well-evidenced, not proven. Turn
it on and look. If nothing shows up, turn it off and tell me.

## Stop it

Press `Ctrl` and `C` together.

Or just close the window. Closing it changes nothing - the agents keep working.
The window is a window, not a switch.

## Other things it does

See what is running without opening a live feed:

```
scripts\watch.cmd --list
```

Follow only the busiest agent instead of all of them:

```
scripts\watch.cmd --one
```

Stop shortening long lines:

```
scripts\watch.cmd --full
```

Hide the results and show only the actions:

```
scripts\watch.cmd --quiet
```

## If nothing appears

If no workflow is running it says so and waits. Leave it open - it starts
printing on its own the moment an agent begins.

A long gap with nothing new is normal. It usually means one agent is inside one
slow command. It is not the window lagging: agents write down what they are
doing the instant they do it, and this reads that within a second.

## Two things worth trying yourself

Neither is a substitute, but both take under a minute and cost nothing.

In Claude Code, open the **Views** menu and look for a tasks or background-tasks
pane. Click a running agent in it. Anthropic's own documentation says its output
shows up in a pane next to it. Your `/workflows` panel does not do that, so this
may be a different pane you have not opened. I could not check it from here
without taking over your screen while a lane was running.

In the chat itself, press `Ctrl` and `O`. That cycles how much detail the
transcript shows - normal, everything, and summary only. On "everything" you see
each tool call instead of a collapsed summary. That is for the main chat, not
the agents.

## What this is

`scripts/watch-agents.py`, run by `scripts/watch.cmd`.

It only reads. It never writes to the project, never touches git, and cannot
disturb a running agent. The one exception is `watch.cmd thinking on/off`, which
changes a single line in your Claude Code settings and keeps a copy of the old
file next to it.

Every setting worth arguing about is at the top of `watch-agents.py` under
"taste values" - how much of a result to show, how long a quiet agent counts as
finished, the colours. One-line edits.
