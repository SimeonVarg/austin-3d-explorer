#!/usr/bin/env python3
"""One-off: split the old HANDOFF.md into docs/journal/2026-MM[-pN].md.

Sections are cut at '## ' headings (outside code fences). The month comes from
the date in the heading; an undated section takes the next dated section's
month. Sections keep their original relative order inside each file and bytes
are never altered. docs/journal/_manifest.tsv records section -> file so the
original can be rebuilt and checked.

  python scripts/split_handoff.py OLD.md            split, then verify
  python scripts/split_handoff.py OLD.md --verify   verify only
"""
import hashlib, re, sys, collections, pathlib

MON = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
MAXB = 380_000
OUT = pathlib.Path("docs/journal")


def month_of(h):
    m = re.search(r"(20\d\d)-(\d\d)-\d\d", h)
    if m:
        return int(m.group(2))
    m = re.match(r"## (?:\d+[a-z]?\. )?([A-Za-z]{3})[a-z]* \d", h)
    if m and m.group(1).lower() in MON:
        return MON[m.group(1).lower()]
    m = re.search(r"\b([A-Z][a-z]{2})[a-z]* \d+.{0,12}2026", h)
    if m and m.group(1).lower() in MON:
        return MON[m.group(1).lower()]
    return None


def sections(data):
    lines = data.splitlines(keepends=True)
    cuts, fence = [0], False
    for i, l in enumerate(lines):
        if l.startswith(b"```"):
            fence = not fence
        elif not fence and l.startswith(b"## ") and i:
            cuts.append(i)
    cuts.append(len(lines))
    return [lines[a:b] for a, b in zip(cuts, cuts[1:])]


def main(old):
    secs = sections(old)
    months = [month_of(s[0].decode("utf8", "replace")) for s in secs]
    nxt = None
    for i in range(len(secs) - 1, -1, -1):  # undated -> next dated
        if months[i] is None:
            months[i] = nxt
        else:
            nxt = months[i]
    first = next(x for x in months if x)
    months = [m or first for m in months]
    per = collections.defaultdict(list)
    for i, m in enumerate(months):
        per[m].append(i)
    manifest = []
    OUT.mkdir(parents=True, exist_ok=True)
    for m, idx in sorted(per.items()):
        parts, cur, size = [], [], 0
        for i in idx:
            n = sum(map(len, secs[i]))
            if cur and size + n > MAXB:
                parts.append(cur)
                cur, size = [], 0
            cur.append(i)
            size += n
        parts.append(cur)
        for p, grp in enumerate(parts, 1):
            name = f"2026-{m:02d}" + (f"-p{p}" if len(parts) > 1 else "") + ".md"
            (OUT / name).write_bytes(b"".join(b"".join(secs[i]) for i in grp))
            manifest += [(i, name, len(secs[i])) for i in grp]
    manifest.sort()
    (OUT / "_manifest.tsv").write_text("".join(f"{i}\t{n}\t{c}\n" for i, n, c in manifest))


def verify(old):
    man = [l.split("\t") for l in (OUT / "_manifest.tsv").read_text().splitlines()]
    files = {f.name: f.read_bytes().splitlines(keepends=True) for f in sorted(OUT.glob("2026-*.md"))}
    pos = collections.defaultdict(int)
    out = []
    for _, name, cnt in man:  # rebuild in original order
        a = pos[name]
        out += files[name][a:a + int(cnt)]
        pos[name] += int(cnt)
    joined = b"".join(out)
    allnew = collections.Counter(l for v in files.values() for l in v)
    oldl = old.splitlines(keepends=True)
    print("old lines", len(oldl), "new lines", sum(len(v) for v in files.values()))
    for n, v in files.items():
        print(f"  {n}: {len(v)} lines, {sum(map(len, v))} bytes")
    print("every line in exactly one file:", allnew == collections.Counter(oldl))
    print("sha256 old    ", hashlib.sha256(old).hexdigest())
    print("sha256 joined ", hashlib.sha256(joined).hexdigest(), "MATCH" if joined == old else "MISMATCH")
    if joined != old or allnew != collections.Counter(oldl):
        sys.exit(1)


if __name__ == "__main__":
    data = pathlib.Path(sys.argv[1]).read_bytes()
    if "--verify" not in sys.argv:
        main(data)
    verify(data)
