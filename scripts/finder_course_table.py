"""finder_course_table.py -- SOURCE PREP for scripts/bake_finder_majors.py.

NOT A BAKE: it writes nothing in this repo. It turns the registrar's public
course PDF into the intermediate table the majors bake reads, and writes it
next to the PDF, in the source folder you pass (which stays out of the repo).

    python scripts/finder_course_table.py SRC_DIR [ut.courses.fall2026.pdf]
      -> SRC_DIR/course-buildings.json, SRC_DIR/meetings-fall2026.csv
    python scripts/bake_finder_majors.py SRC_DIR
      -> data/finder/major-buildings.json

Copied from the research script build_course_buildings.py (2026-09-23); only
the paths changed. Needs PyMuPDF (pip install pymupdf). Original notes follow.

Table 1: course prefix / course -> buildings where its sections meet.

Input : ut.courses.fall2026.pdf  (UT Registrar "Course Offerings, Fall 2026",
        as of 02/27/2026, public no-login PDF linked from
        https://registrar.utexas.edu/schedules/269/print ->
        https://utexas.box.com/v/UT20269CSpdf)
        ../../../contest-claude/data/walk_graph.json and data/ut_buildings.json
        (read only) for the "is this code on the app's map" check.
Output: course-buildings.json   (the table)
        meetings-fall2026.csv   (one line per printed meeting row; no names)

Re-run next semester: drop the new PDF next to this script and pass its name:
    python build_course_buildings.py ut.courses.spring2027.pdf

Parsing notes (why it is done with coordinates, not text lines):
  The PDF is set in TWO columns and pdftotext -layout interleaves them, so this
  reads PyMuPDF words with their x/y. Every page repeats a column-header row
  ("course unique days time room instructor") twice; the x of those header
  words gives each column's field positions for that page (odd and even pages
  have different margins). Within a column:
    * course header  = words left of the "unique" column matching "C S 312"
    * section row    = a 5-digit unique number in the unique column
    * extra meeting  = a row with no unique but days/time in their columns
                       (labs, discussions, a second lecture room)
    * anything else (descriptions, topic titles, prerequisites) is ignored.
  Sections at the top of a page continue the last course of the previous page.

Counting rule: every PRINTED meeting row counts once, regardless of how many
days it meets (MWF = 1). A shared lecture printed under six discussion sections
counts six times, because six separate groups of students attend it.
Instructor names are read by the PDF parser but never written anywhere.
"""
import collections
import csv
import json
import os
import re
import sys

import fitz  # PyMuPDF

if len(sys.argv) < 2:
    sys.exit("usage: python scripts/finder_course_table.py SRC_DIR [pdf name]")
HERE = os.path.abspath(sys.argv[1])          # the external source folder
PDF = os.path.join(HERE, sys.argv[2] if len(sys.argv) > 2 else "ut.courses.fall2026.pdf")
APP = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))   # this repo (read only)
OUT_JSON = os.path.join(HERE, "course-buildings.json")
OUT_CSV = os.path.join(HERE, "meetings-fall2026.csv")

COURSE_RE = re.compile(r"^((?:[A-Z]{1,3} ){1,3})(\d{3}[A-Z]{0,2})$")
UNIQUE_RE = re.compile(r"^\d{5}$")
DAYS_RE = re.compile(r"^(?:M|TH|T|W|F|SU|S)+$")
TIME_RE = re.compile(r"(\d{1,4})\s*-\s*(\d{1,4})(P?)")
BLDG_RE = re.compile(r"^[A-Z][A-Z0-9]{1,3}$")
ROW_TOL = 2.5  # points; words closer than this in y share a row


def to_minutes(a, b, pm):
    """'930','1200',P -> (start, end) minutes after midnight. The PDF marks only
    the END time with P; the start is whichever of AM/PM lands 0-10 h before it."""
    a, b = a.zfill(3), b.zfill(3)
    sh, sm, eh, em = int(a[:-2]), int(a[-2:]), int(b[:-2]), int(b[-2:])
    if pm and eh != 12:
        eh += 12
    end = eh * 60 + em
    cands = [sh * 60 + sm] + ([(sh + 12) * 60 + sm] if sh < 12 else [])
    good = [c for c in cands if 0 < end - c <= 600]
    return (min(good, key=lambda c: end - c) if good else cands[0]), end


def page_columns(words):
    """Return [(col_x0, fields)] for the left and right columns of a page."""
    hdr = [w for w in words if w[1] < 30]
    cols = []
    for w in hdr:
        if w[4] == "course":
            x0 = w[0]
            f = {"course": x0}
            for name in ("unique", "days", "time", "room", "instructor"):
                cand = [v for v in hdr if v[4] == name and v[0] > x0 and v[0] < x0 + 260]
                if cand:
                    f[name] = min(cand, key=lambda v: v[0])[0]
            cols.append(f)
    cols.sort(key=lambda f: f["course"])
    return cols


def rows_of(words):
    words = sorted(words, key=lambda w: (w[1], w[0]))
    rows, cur, y = [], [], None
    for w in words:
        if y is None or abs(w[1] - y) <= ROW_TOL:
            cur.append(w)
            y = w[1] if y is None else y
        else:
            rows.append(sorted(cur, key=lambda v: v[0]))
            cur, y = [w], w[1]
    if cur:
        rows.append(sorted(cur, key=lambda v: v[0]))
    return rows


def parse(pdf_path):
    doc = fitz.open(pdf_path)
    course = None
    section = None
    sections = []  # {course, unique, rows:[{days,start,end,bldg,room}]}
    last_cols = None
    for pno, page in enumerate(doc):
        # drop the diagonal "As of 02/27/2026" watermark: its word boxes are ~150 pt tall
        words = [w for w in page.get_text("words") if w[4].strip() and w[3] - w[1] < 20]
        cols = page_columns(words)
        if len(cols) != 2:
            if last_cols is None:
                continue
            cols = last_cols
        last_cols = cols
        split = cols[1]["course"] - 4
        for ci, f in enumerate(cols):
            cw = [w for w in words if (w[0] < split) == (ci == 0) and 28 < w[1] < 740]
            for row in rows_of(cw):
                xs = f
                left = [w for w in row if w[0] < xs["unique"] - 3]
                rest = [w for w in row if w[0] >= xs["unique"] - 3]
                ltxt = " ".join(w[4] for w in left)
                m = COURSE_RE.match(ltxt)
                if left and m:
                    course = (m.group(1).strip(), m.group(2))
                    section = None
                    continue
                if left:
                    continue  # page numbers, TOC entries, watermark
                if not rest:
                    continue
                toks = [w for w in rest if w[4] not in ("•", "�")]  # the bullet before a unique
                if not toks:
                    continue
                first = toks[0]
                is_unique = UNIQUE_RE.match(first[4]) and first[0] < xs["days"] - 2
                # fields by column position
                days = [w[4] for w in toks if xs["days"] - 3 <= w[0] < xs["days"] + 12 and DAYS_RE.match(w[4])]
                timew = [w for w in toks if xs["days"] + 12 <= w[0] < xs["room"] - 3]
                roomw = [w for w in toks if xs["room"] - 3 <= w[0] < xs["instructor"] - 3]
                instw = [w for w in toks if w[0] >= xs["instructor"] - 3]
                ttxt = " ".join(w[4] for w in timew)
                tm = TIME_RE.search(ttxt)
                if is_unique:
                    if course is None:
                        continue
                    section = {"course": course, "unique": first[4], "rows": [], "page": pno + 1}
                    sections.append(section)
                elif section is not None and first[0] >= xs["days"] - 3 and (days or tm or roomw):
                    # an extra meeting row of the current section (lab, discussion)
                    if first[0] >= xs["instructor"] - 3:
                        continue  # a second instructor line only
                else:
                    continue  # description / topic title / notes
                bldg = room = ""
                if roomw:
                    bt = roomw[0][4]
                    if BLDG_RE.match(bt) and not bt.endswith(","):
                        bldg = bt
                        room = " ".join(w[4] for w in roomw[1:])
                if not (days or tm or bldg):
                    if is_unique:
                        continue  # section with no meeting info (web-based, arranged)
                    continue
                start = end = None
                if tm:
                    start, end = to_minutes(tm.group(1), tm.group(2), tm.group(3) == "P")
                section["rows"].append({"days": "".join(days), "start": start, "end": end,
                                        "bldg": bldg, "room": room,
                                        "raw_room": " ".join(w[4] for w in roomw)})
    return sections


def level(num):
    return int(num[1:3])


def main():
    sections = parse(PDF)
    g = json.load(open(os.path.join(APP, "data", "walk_graph.json"), encoding="utf-8"))
    reg = {b["ref"]: b["name"] for b in json.load(open(os.path.join(APP, "data", "ut_buildings.json"), encoding="utf-8"))["buildings"]}
    doors = g["d"]
    graph_codes = {c for c, idx in g["code"].items() if any(doors[i][2] for i in idx)}
    routable_reg = graph_codes & set(reg)

    pre_ug = collections.defaultdict(collections.Counter)
    pre_all = collections.defaultdict(collections.Counter)
    pre_lower = collections.defaultdict(collections.Counter)
    per_course = collections.defaultdict(collections.Counter)
    no_room_sections = []
    no_room_rows = 0
    rows_total = 0
    code_rows = collections.Counter()
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        wr = csv.writer(fh)
        wr.writerow(["prefix", "number", "unique", "row", "days", "start_min", "end_min", "bldg", "room"])
        for s in sections:
            pfx, num = s["course"]
            name = f"{pfx} {num}"
            has_room = False
            if not s["rows"]:
                wr.writerow([pfx, num, s["unique"], "", "", "", "", "", ""])
            for i, r in enumerate(s["rows"]):
                wr.writerow([pfx, num, s["unique"], i, r["days"], r["start"], r["end"], r["bldg"], r["room"]])
                rows_total += 1
                if not r["bldg"]:
                    no_room_rows += 1
                    continue
                has_room = True
                b = r["bldg"]
                code_rows[b] += 1
                pre_all[pfx][b] += 1
                per_course[name][b] += 1
                if level(num) < 80:
                    pre_ug[pfx][b] += 1
                if level(num) < 20:
                    pre_lower[pfx][b] += 1
            if not has_room:
                no_room_sections.append(s)

    def sort_counter(c):
        return {k: v for k, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))}

    nr_by_prefix = collections.Counter(s["course"][0] for s in no_room_sections)
    nr_kind = collections.Counter("no meeting row" if not s["rows"] else "rows without room" for s in no_room_sections)
    off = {}
    for b, n in code_rows.most_common():
        if b not in graph_codes:
            off[b] = {"rows": n, "in_register": b in reg, "name": reg.get(b, "")}

    out = {
        "_about": "Where each UT Austin course prefix and course meets, Fall 2026. prefix -> {building code: meeting rows}.",
        "_source": "UT Registrar, Course Offerings Fall 2026 PDF (as of 02/27/2026), https://utexas.box.com/v/UT20269CSpdf via https://registrar.utexas.edu/schedules/269/print",
        "_method": "PyMuPDF word coordinates, two columns per page. Each printed meeting row of a section counts once (MWF = 1). A lecture printed under N discussion sections counts N times (N groups of students attend it). Undergraduate = course number digits 2-3 below 80 (UT numbering: 01-19 lower division, 20-79 upper, 80-99 graduate).",
        "_script": "build_course_buildings.py",
        "term": "Fall 2026",
        "totals": {
            "sections": len(sections),
            "meeting_rows": rows_total,
            "rows_with_building": sum(code_rows.values()),
            "courses": len({s["course"] for s in sections}),
            "prefixes": len({s["course"][0] for s in sections}),
            "building_codes": len(code_rows),
        },
        "prefixes": {p: sort_counter(c) for p, c in sorted(pre_ug.items())},
        "prefixes_lower_division": {p: sort_counter(c) for p, c in sorted(pre_lower.items())},
        "prefixes_all_levels": {p: sort_counter(c) for p, c in sorted(pre_all.items())},
        "courses": {c: list(sort_counter(v).keys()) for c, v in sorted(per_course.items())},
        "course_counts": {c: sort_counter(v) for c, v in sorted(per_course.items())},
        "no_room": {
            "sections": len(no_room_sections),
            "meeting_rows_without_room": no_room_rows,
            "kinds": dict(nr_kind),
            "by_prefix": sort_counter(nr_by_prefix),
            "uniques": sorted(s["unique"] for s in no_room_sections),
        },
        "not_in_walk_graph": off,
        "walk_graph": {"codes_with_anchored_door": len(graph_codes), "register_codes_routable": len(routable_reg),
                       "source": "contest-claude/data/walk_graph.json (read only)"},
    }
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    # ---------------- spot checks (known facts) ----------------
    def share(pfx, codes, table=pre_ug):
        c = table.get(pfx, collections.Counter())
        t = sum(c.values())
        return (sum(c[k] for k in codes) / t if t else 0.0), t, [k for k, _ in c.most_common(4)]

    # PASS = the expected building is the prefix's #1 building by meeting rows.
    # (Facts from UT department homes; "share" says how concentrated it is.)
    checks = [
        ("C S -> GDC (Gates Dell Complex)", "C S", {"GDC"}),
        ("ECE (was E E) -> EER", "ECE", {"EER"}),
        ("M -> PMA (RLM was renamed PMA)", "M", {"PMA", "RLM"}),
        ("CH -> WEL", "CH", {"WEL"}),
        ("ECO -> BRB/UTC", "ECO", {"BRB", "UTC"}),
        ("ACC -> McCombs GSB/CBA/UTC/RRH", "ACC", {"GSB", "CBA", "UTC", "RRH"}),
        ("FIN -> McCombs", "FIN", {"GSB", "CBA", "UTC", "RRH"}),
        ("MKT -> McCombs", "MKT", {"GSB", "CBA", "UTC", "RRH"}),
        ("MAN -> McCombs", "MAN", {"GSB", "CBA", "UTC", "RRH"}),
        ("PHY -> PMA", "PHY", {"PMA", "RLM"}),
        ("M E -> ETC", "M E", {"ETC"}),
        ("C E -> ECJ", "C E", {"ECJ"}),
        ("MUS -> MRH", "MUS", {"MRH"}),
        ("N (nursing) -> NUR", "N", {"NUR"}),
        ("RTF -> Moody CMA/CMB/DMC/BMC", "RTF", {"CMA", "CMB", "DMC", "BMC"}),
        ("ARC -> SUT/GOL/WMB/BTL", "ARC", {"SUT", "GOL", "WMB", "BTL"}),
        ("PHM (pharmacy) -> PHR bldg", "PHM", {"PHR"}),
    ]
    print(f"sections {len(sections)}  rows {rows_total}  with bldg {sum(code_rows.values())}  "
          f"courses {out['totals']['courses']}  prefixes {out['totals']['prefixes']}  codes {len(code_rows)}")
    print(f"no-room sections {len(no_room_sections)} {dict(nr_kind)}; rows without room {no_room_rows}")
    print(f"prefix 'E E' present: {'E E' in pre_all}; 'NUR' present: {'NUR' in pre_all}")
    passed = 0
    results = []
    for label, pfx, codes in checks:
        s, t, top = share(pfx, codes)
        ok = bool(top) and top[0] in codes
        passed += ok
        results.append({"check": label, "pass": ok, "share": round(s, 3), "rows": t, "top": top})
        print(f"  {'PASS' if ok else 'FAIL'}  {label:36s} expected-set share {s:5.1%} of {t:4d} UG rows; top {top}")
    print(f"spot checks {passed}/{len(checks)}")
    out["spot_checks"] = results
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print("codes not in walk graph:", {k: (v['rows'], v['in_register']) for k, v in off.items()})


if __name__ == "__main__":
    main()
