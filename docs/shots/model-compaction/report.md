MERGED

PR #360 - Core models ship without JSON whitespace (12.2 MB to 6.1 MB raw)
Branch: claude/model-compaction
PR: https://github.com/SimeonVarg/austin-3d-explorer/pull/360

What was wrong
The branch had not caught up with main. Since it last updated, the Union on
24th model was rebuilt on main (new podium entry, columns and screen detail),
so the two branches changed the same file and the merge would conflict.

What changed
- Merged the latest main into the branch.
- Two files conflicted. Union on 24th: took main's rebuilt model as the source,
  then re-ran the packer so the shipped copy is the same content with the
  spacing between values removed. It went from about 871 KB to 839 KB and now
  has no line breaks. HANDOFF.md: kept both sides' notes.
- The packer confirms every one of the 45 core models still reads back to
  exactly the same content; only the spacing between values is gone.

Does it look the same
Yes. Side by side at Union on 24th in daylight, the branch and main frames are
the same to the eye (see before and after below). Measured: shooting the branch
twice and comparing moved 339 pixels; comparing the branch against main moved
244 pixels, which is fewer than the reload-to-reload noise. So the change moves
no more of the picture than simply loading the page twice does. A perfectly
zero-pixel result is not reachable on this scene because a plain reload already
moves a few hundred shadow-edge pixels.
Content check: the served branch file and the served main file differ in only
two places, both of them hidden note text about where the model came from, which
nothing in the app reads. Every coordinate, colour and shape is identical.

Fewer bytes
Yes. All 45 core model files over the local server (which sends them
uncompressed, so the byte count is the raw size): main 13,530,409 bytes, branch
6,942,232 bytes, saved 6,588,177 bytes, about 49 percent. (The local main copy
has Windows line endings, which inflate it; the committed raw saving is about
12.2 MB to 6.1 MB.)

Loads no slower
Yes. Fresh browser each load, browser cache off, real graphics, four loads each
side interleaved, timed to when the loading bar reaches 100 percent. Taking the
fastest of each side (the fair statistic on a busy machine): branch 98.7 s,
main 105.9 s. The branch is not slower. The middle values overlap, so this is
"no slower", not a speed-up claim.

Checks run
- packer self-check (token spelling, quoted spaces, escapes, run-twice): pass
- 45 models carry no spacing between values: pass
- far-away apartment areas load on demand: pass
- shadow footprint lookup matches the old scan (core 196, core+areas 549,
  0 differences): pass
- harness matches the real page (50 = 50 scripts): pass
- whitespace-error check on the whole diff: clean
These are the browser-free checks CI runs that read these files; all green on the
merged tree. The full CI picture set is advisory and never blocks a merge.

Evidence
- docs/shots/model-compaction/union-on-24th-before.png (main)
- docs/shots/model-compaction/union-on-24th-after.png (branch)
- docs/shots/model-compaction/pixel-diff.json (the pixel counts above)

What is left
Nothing blocking. All gates passed, so the PR was marked ready and merged.
