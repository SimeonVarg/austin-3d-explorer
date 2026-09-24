"""bake_finder_majors.py -- UT major -> the buildings its classes meet in.

Sole writer of data/finder/major-buildings.json (CLAUDE.md rule 1). Read by
js/finder.js to rank homes for a student who picks a major instead of
importing a schedule.

SOURCES (all public, no login; the downloads stay OUT of the repo)
  SRC_DIR/course-buildings.json  built by scripts/finder_course_table.py from
      the UT Registrar "Course Offerings, Fall 2026" PDF (public, no login:
      https://registrar.utexas.edu/schedules/269/print ->
      https://utexas.box.com/v/UT20269CSpdf, 8.9 MB).
  SRC_DIR/catalog-plans/  a cache of each major's "Plan of Study Grid" from the
      2026-27 Undergraduate Catalog, https://catalog.utexas.edu/undergraduate/programs/
      (fetched on the first run or with --refetch; a re-run with the cache
      needs no network).
  Which majors: the largest by bachelor's degrees conferred 2024-25 (IPEDS,
  NCES College Navigator, unitid 228778).

    python scripts/finder_course_table.py SRC_DIR       # once per semester
    python scripts/bake_finder_majors.py SRC_DIR [--refetch]

Copied from the research script build_major_buildings.py (2026-09-23): the
method is unchanged; the paths moved and the output is the slim table the
browser reads (weights, a solid/estimated flag and the two shares the finder
turns into plain words). Original notes follow.

Table 2: UT Austin undergraduate major -> weighted buildings (years 1-3).

Inputs
  course-buildings.json      table 1 (build_course_buildings.py), per-course and
                             per-prefix meeting rows by building, Fall 2026.
  catalog.utexas.edu         each major's "Plan of Study Grid" (2026-27 catalog,
                             public, no login). Only the grid rows of Years 1-3
                             are kept; the extracted rows are cached in
                             catalog-plans/ so a re-run needs no network.
  Which majors: the largest by bachelor's degrees conferred 2024-25 (IPEDS
  completions, first majors) as published on NCES College Navigator for UT
  Austin (unitid 228778): https://nces.ed.gov/collegenavigator/?id=228778#programs
  CIP names are mapped to UT majors by hand below; the mapping note says where
  that is a judgement.

Method
  Each grid row of Years 1-3 carries hours. A row that names courses ("C S 312",
  "M 408C or M 408N") uses those courses' Fall 2026 building mix (alternatives
  averaged; a course with no Fall 2026 section falls back to its prefix at the
  same division). A row that names a slot ("U.S. History (060)", "Hours chosen
  from: Upper-division C S", "Visual and Performing Arts (050)") uses a pool of
  the courses that usually fill it (POOLS below). Free electives and anything
  unrecognised are left out and counted in `unmapped_hours`.
  building weight = sum(hours x building share) / mapped hours; buildings under
  MIN_SHARE are dropped and the rest renormalised so the weights sum to 1.
  Majors with several catalog options average the options equally.

Re-run: python build_major_buildings.py          (uses the cache)
        python build_major_buildings.py --refetch
"""
import collections
import html
import json
import os
import re
import sys
import time
import urllib.request

_ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
if not _ARGS:
    sys.exit("usage: python scripts/bake_finder_majors.py SRC_DIR [--refetch]")
HERE = os.path.abspath(_ARGS[0])             # the external source folder
T1 = os.path.join(HERE, "course-buildings.json")
CACHE = os.path.join(HERE, "catalog-plans")
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "data", "finder", "major-buildings.json")
CATALOG = "https://catalog.utexas.edu/undergraduate/programs/"
NAV = "https://nces.ed.gov/collegenavigator/?id=228778#programs"
MIN_SHARE = 0.02      # drop buildings below 2 % of a major's weight
TOP_N = 12            # and keep at most this many
YEARS = (1, 2, 3)
SOLID_SPECIFIC = 0.50 # share of mapped hours that must be named courses or the major's own prefixes

# (id, name, college, [catalog slugs], bachelor's 2024-25, CIP program(s), mapping note, own prefixes)
MAJORS = [
    ("biology", "Biology (BSBio)", "Natural Sciences",
     ["biology-human-biology-bsbio", "biology-cell-molecular-biology-bsbio", "biology-genetics-genomics-bsbio",
      "biology-microbiology-infectious-diseases-bsbio", "biology-ecology-evolution-behavior-bsbio"],
     761, "Biology/Biological Sciences, General", "", ["BIO"]),
    ("computer-science", "Computer Science (BSCompSci)", "Natural Sciences",
     ["computer-science-computer-science-option-bscompsci", "computer-science-bsa"],
     483, "Computer and Information Sciences, General", "", ["C S"]),
    ("psychology", "Psychology (BA/BSPsy)", "Liberal Arts",
     ["psychology-ba", "psychology-bspsy"],
     604, "Psychology, General (443) + Experimental Psychology (161)", "", ["PSY"]),
    ("finance", "Finance (BBA)", "Business",
     ["finance-energy-finance-law-science-bba"],
     433, "Finance, General", "catalog slug is the only Finance (BBA) page", ["FIN"]),
    ("electrical-computer-engineering", "Electrical and Computer Engineering (BSECE)", "Engineering",
     ["electrical-computer-engineering-software-engineering-design-bsece",
      "electrical-computer-engineering-computer-architecture-embedded-systems-bsece",
      "electrical-computer-engineering-electronics-integrated-circuits-bsece",
      "electrical-computer-engineering-data-science-information-processing-bsece"],
     365, "Electrical and Electronics Engineering", "", ["ECE"]),
    ("economics", "Economics (BA/BSEco)", "Liberal Arts",
     ["economics-ba", "economics-bseco"],
     488, "Economics, General (359) + Econometrics and Quantitative Economics (129)",
     "assumes the quantitative-economics CIP is the BSEco", ["ECO"]),
    ("mathematics", "Mathematics (BSMath/BA)", "Natural Sciences",
     ["mathematics-math-option-bsmath", "mathematics-ba"],
     351, "Mathematics, General", "", ["M"]),
    ("government", "Government (BA)", "Liberal Arts", ["government-ba"],
     293, "Political Science and Government, General", "", ["GOV"]),
    ("radio-television-film", "Radio-Television-Film (BSRTF)", "Communication", ["radio-television-film-bsrtf"],
     289, "Radio and Television", "", ["RTF"]),
    ("advertising", "Advertising (BSAdv)", "Communication", ["advertising-bsadv"],
     283, "Advertising", "", ["ADV"]),
    ("mechanical-engineering", "Mechanical Engineering (BSME)", "Engineering", ["mechanical-engineering-bsme"],
     279, "Mechanical Engineering", "", ["M E"]),
    ("biochemistry", "Biochemistry (BSBioch)", "Natural Sciences", ["biochemistry-biochemistry-option-bsbioch"],
     277, "Biochemistry", "", ["BCH", "CH"]),
    ("neuroscience", "Neuroscience (BSNeurosci)", "Natural Sciences", ["neuroscience-neuroscience-option-bsneurosci"],
     272, "Neuroscience", "", ["NEU"]),
    ("exercise-science", "Exercise Science (BSKin&Health)", "Education", ["exercise-science-bskinhealth"],
     225, "Exercise Science and Kinesiology", "", ["KIN"]),
    ("public-health", "Public Health (BSPublicHealth)", "Natural Sciences", ["public-health-bspublichealth"],
     221, "Public Health, General", "", ["PBH"]),
    ("management", "Management (BBA)", "Business", ["management-general-management-bba"],
     221, "Business Administration and Management, General",
     "this CIP may also hold Business Honors; mapped to Management", ["MAN"]),
    ("management-information-systems", "Management Information Systems (BBA)", "Business",
     ["management-information-systems-bba"], 203, "Management Information Systems, General", "", ["MIS"]),
    ("accounting", "Accounting (BBA)", "Business", ["accounting-bba"],
     183, "Accounting", "", ["ACC"]),
    ("communication-studies", "Communication Studies (BSCommStds)", "Communication",
     ["communication-studies-corporate-communication-bscommstds", "communication-studies-human-relations-communication-bscommstds",
      "communication-studies-political-communication-bscommstds"],
     171, "Speech Communication and Rhetoric", "", ["CMS"]),
    ("plan-ii-honors", "Plan II Honors (BA)", "Liberal Arts", ["honors-ba"],
     164, "Liberal Arts and Sciences, General Studies and Humanities, Other",
     "JUDGEMENT: this CIP is assumed to be Plan II", ["T C"]),
    ("journalism", "Journalism (BJ)", "Communication", ["journalism-bj"],
     163, "Journalism", "", ["J"]),
    ("international-relations-global-studies", "International Relations and Global Studies (BA)", "Liberal Arts",
     ["international-relations-global-studies-international-political-economy-ba",
      "international-relations-global-studies-international-security-ba",
      "international-relations-global-studies-culture-media-arts-ba",
      "international-relations-global-studies-science-technology-environment-ba"],
     160, "International/Globalization Studies", "", ["IRG"]),
    ("public-relations", "Public Relations (BSPR)", "Communication", ["public-relations-bspr"],
     152, "Public Relations/Image Management", "", ["P R"]),
    ("biomedical-engineering", "Biomedical Engineering (BSBiomedE)", "Engineering",
     ["biomedical-engineering-cellular-biomolecular-engineering-bsbiomede",
      "biomedical-engineering-computational-biomedical-engineering-bsbiomede",
      "biomedical-engineering-biomedical-imaging-instrumentation-bsbiomede"],
     139, "Bioengineering and Biomedical Engineering", "", ["BME"]),
    ("chemical-engineering", "Chemical Engineering (BSChE)", "Engineering", ["chemical-engineering-bsche"],
     138, "Chemical Engineering", "", ["CHE"]),
    ("sociology", "Sociology (BA)", "Liberal Arts", ["sociology-ba"],
     132, "Sociology, General", "", ["SOC"]),
    ("health-and-society", "Health and Society (BA)", "Liberal Arts", ["health-society-ba"],
     126, "Behavioral Aspects of Health", "JUDGEMENT: CIP name mapped to Health and Society", ["HMN", "SOC"]),
    ("civil-engineering", "Civil Engineering (BSCE)", "Engineering", ["civil-engineering-bsce"],
     121, "Civil Engineering, General", "", ["C E"]),
    ("nursing", "Nursing (BSN)", "Nursing", ["nursing-bsn"],
     120, "Registered Nursing/Registered Nurse", "", ["N"]),
    ("marketing", "Marketing (BBA)", "Business", ["marketing-bba"],
     118, "Marketing/Marketing Management, General", "", ["MKT"]),
    ("english", "English (BA)", "Liberal Arts", ["english-ba"],
     111, "English Language and Literature, General", "", ["E"]),
    ("speech-language-hearing-sciences", "Speech, Language, and Hearing Sciences (BSSLH)", "Communication",
     ["speech-language-hearing-sciences-speech-language-pathology-bsslh", "speech-language-hearing-sciences-audiology-bsslh"],
     108, "Communication Sciences and Disorders, General", "", ["SLH"]),
    ("chemistry", "Chemistry (BSCh/BSA)", "Natural Sciences",
     ["chemistry-synthesis-chemical-biology-bsch", "chemistry-bsa"],
     107, "Chemistry, General", "", ["CH"]),
    ("aerospace-engineering", "Aerospace Engineering (BSASE)", "Engineering", ["aerospace-engineering-bsase"],
     103, "Aerospace, Aeronautical, and Astronautical/Space Engineering, General", "", ["ASE"]),
    ("communication-and-leadership", "Communication and Leadership (BSCommLead)", "Communication",
     ["communication-leadership-bscommlead"], 96, "Organizational Communication, General", "", ["CMS", "CLD"]),
    ("history", "History (BA)", "Liberal Arts", ["history-ba"],
     95, "History, General", "", ["HIS"]),
    ("physics", "Physics (BSPhy)", "Natural Sciences", ["physics-physics-option-bsphy"],
     94, "Physics, General", "", ["PHY"]),
    ("sustainability-studies", "Sustainability Studies (BA)", "Liberal Arts", ["sustainability-studies-ba"],
     91, "Sustainability Studies", "", ["SUS", "GRG"]),
    ("sport-management", "Sport Management (BSKin&Health)", "Education", ["sport-management-bskinhealth"],
     84, "Sport and Fitness Administration/Management", "", ["KIN"]),
    ("nutrition", "Nutrition (BSNtr)", "Natural Sciences", ["nutrition-nutritional-sciences-bsntr"],
     83, "Nutrition Sciences", "", ["NTR"]),
    ("informatics", "Informatics (BSI/BA)", "Information",
     ["informatics-human-centered-data-science-bsi", "informatics-user-experience-design-bsi"],
     79, "Informatics", "", ["I"]),
    ("arts-and-entertainment-technologies", "Arts and Entertainment Technologies (BSAET)", "Fine Arts",
     ["arts-entertainment-technologies-bsaet"], 76, "Digital Arts", "", ["AET"]),
]

# Slots in a plan grid -> the courses / prefixes that usually fill them.
# ("C", code) = one course; ("P", prefix, division) division in lower|upper|ug
POOLS = [
    (r"rhetoric and writing|\(010\)", "RHE 306", [("C", "RHE 306")]),
    (r"u\.s\. history|\(060\)", "U.S. History core", [("C", "HIS 315K"), ("C", "HIS 315L")]),
    (r"american and texas government|government \(070\)|\(070\)", "GOV core", [("C", "GOV 310L"), ("C", "GOV 312L")]),
    (r"first-year signature|\(090\)|\$090", "Signature course", [("P", "UGS", "lower")]),
    (r"humanities \(040\)|\(040\)", "Humanities core (E 316)", [("C", "E 316L"), ("C", "E 316M"), ("C", "E 316N"), ("C", "E 316P")]),
    (r"visual and performing arts|\(050\)", "VAPA core", [("P", p, "lower") for p in ("ARH", "F A", "T D", "MUS", "ART", "DES")]),
    (r"social and behavioral|\(080\)", "Social/behavioral core", [("C", "PSY 301"), ("C", "ECO 304K"), ("C", "SOC 302"), ("C", "ANT 302"), ("P", "GOV", "lower")]),
    (r"natural science|\(030\)|\(093\)|science and technology", "Natural science core", [("P", p, "lower") for p in ("BIO", "CH", "PHY", "AST", "GEO")]),
    (r"mathematics \(020\)|\(020\)|quantitative reasoning", "Math core", [("P", "M", "lower"), ("P", "SDS", "lower")]),
    (r"foreign language|language and culture|language other than english|language, communication,? and culture|language, arts,? and culture",
     "Foreign language / culture", [("P", p, "lower") for p in ("SPN", "FR", "GER", "CHI", "JPN", "KOR", "ARA", "ITL", "POR", "RUS")]),
    (r"statistics course", "Statistics", [("P", "SDS", "lower")]),
]
# plain-English subject words in "Hours chosen from: Upper-division Math" rows
WORD_PREFIX = {"math": "M", "mathematics": "M", "english": "E", "psychology": "PSY", "history": "HIS",
               "government": "GOV", "economics": "ECO", "sociology": "SOC", "chemistry": "CH", "physics": "PHY",
               "biology": "BIO"}
SKIP = r"free elective|^elective|electives?$|general elective"


def fetch(slug, refetch=False):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, slug + ".json")
    if os.path.exists(path) and not refetch:
        return json.load(open(path, encoding="utf-8"))
    url = CATALOG + slug + "/"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research script; static data bake)"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    time.sleep(1.0)
    title = re.search(r"<h1[^>]*>(.*?)</h1>", raw, re.S)
    rows = []
    m = re.search(r'<table[^>]*class="sc_plangrid"[^>]*>(.*?)</table>', raw, re.S)
    year = 0
    if m:
        for tr in re.findall(r"<tr([^>]*)>(.*?)</tr>", m.group(1), re.S):
            cls, body = tr
            if "plangridyear" in cls:
                y = re.search(r"Year\s+(\d)", body)
                year = int(y.group(1)) if y else year
                continue
            if "plangridterm" in cls or "plangridsum" in cls or "plangridtotal" in cls:
                continue
            code = re.search(r'<td[^>]*class="codecol"[^>]*>(.*?)</td>', body, re.S)
            hrs = re.search(r'<td[^>]*class="hourscol"[^>]*>(.*?)</td>', body, re.S)
            if not code:
                continue
            courses = [html.unescape(c).replace("\xa0", " ") for c in re.findall(r'class="bubblelink code"[^>]*>(.*?)</a>', code.group(1))]
            text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", code.group(1)))).replace("\xa0", " ").strip()
            htxt = re.sub(r"<[^>]+>", "", hrs.group(1)).strip() if hrs else ""
            hn = re.findall(r"\d+", htxt)
            rows.append({"year": year, "courses": courses, "text": text, "hours": int(hn[0]) if hn else 0})
    rec = {"slug": slug, "url": url, "title": html.unescape(re.sub(r"<[^>]+>", "", title.group(1))).strip() if title else slug,
           "has_plan": bool(m), "rows": rows, "fetched": time.strftime("%Y-%m-%d")}
    json.dump(rec, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return rec


def main():
    refetch = "--refetch" in sys.argv
    t1 = json.load(open(T1, encoding="utf-8"))
    cc = t1["course_counts"]
    prefixes = set(t1["prefixes_all_levels"])

    def lvl(code):
        num = code.split()[-1]
        return int(num[1:3])

    def pool_prefix(p, div):
        c = collections.Counter()
        for code, cnt in cc.items():
            pfx = code.rsplit(" ", 1)[0]
            if pfx != p:
                continue
            L = lvl(code)
            if L >= 80 or (div == "lower" and L >= 20) or (div == "upper" and L < 20):
                continue
            c.update(cnt)
        return c

    def course_dist(code):
        if code in cc:
            return collections.Counter(cc[code]), "course"
        pfx = code.rsplit(" ", 1)[0]
        return pool_prefix(pfx, "lower" if lvl(code) < 20 else "upper"), "prefix-fallback"

    def norm(c):
        t = sum(c.values())
        return {k: v / t for k, v in c.items()} if t else {}

    majors_out = {}
    low_conf = []
    for mid, name, college, slugs, degrees, cip, note, own in MAJORS:
        per_option = []
        reasons = []
        opt_stats = []
        for slug in slugs:
            rec = fetch(slug, refetch)
            if not rec["has_plan"]:
                reasons.append(f"no Plan of Study grid on {slug}")
                continue
            acc = collections.Counter()
            hrs_total = hrs_mapped = hrs_specific = 0
            unmapped = collections.Counter()
            fallbacks = []
            for r in rec["rows"]:
                if r["year"] not in YEARS or r["hours"] <= 0:
                    continue
                h = r["hours"]
                hrs_total += h
                dist = None
                specific = False
                if r["courses"]:
                    ds = []
                    for code in r["courses"]:
                        d, how = course_dist(code)
                        if d:
                            ds.append(norm(d))
                            if how != "course":
                                fallbacks.append(code)
                    if ds:
                        dist = collections.Counter()
                        for d in ds:
                            for k, v in d.items():
                                dist[k] += v / len(ds)
                        specific = True
                else:
                    low = r["text"].lower()
                    if re.search(SKIP, low):
                        unmapped["free elective"] += h
                        continue
                    # "Hours chosen from: Upper-division C S" -> that prefix
                    cands = [p for p in prefixes if re.search(r"(?<![A-Za-z])" + re.escape(p) + r"(?![A-Za-z])", r["text"]) and len(p) > 1]
                    if not cands and re.search(r"hours chosen from|division", low):
                        cands = [WORD_PREFIX[w] for w in re.findall(r"[a-z]+", low) if w in WORD_PREFIX][:1]
                    if cands:
                        div = "upper" if "upper-division" in low else "lower" if "lower-division" in low else "ug"
                        c = collections.Counter()
                        for p in cands:
                            c.update(pool_prefix(p, div))
                        if c:
                            dist = norm(c)
                            specific = any(p in own for p in cands)
                    if dist is None:
                        for rx, label, members in POOLS:
                            if re.search(rx, low):
                                c = collections.Counter()
                                for mem in members:
                                    if mem[0] == "C":
                                        c.update(course_dist(mem[1])[0])
                                    else:
                                        c.update(pool_prefix(mem[1], mem[2]))
                                dist = norm(c)
                                break
                if dist is None:
                    unmapped[r["text"][:60]] += h
                    continue
                hrs_mapped += h
                if specific:
                    hrs_specific += h
                for k, v in dist.items():
                    acc[k] += h * v
            per_option.append(norm(acc))
            opt_stats.append({"slug": slug, "hours_y1_3": hrs_total, "mapped": hrs_mapped, "specific": hrs_specific,
                              "unmapped": dict(unmapped), "fallbacks": sorted(set(fallbacks))})
        if not per_option:
            majors_out[mid] = {"name": name, "confidence": "estimated", "why": "; ".join(reasons), "buildings": []}
            low_conf.append((mid, 0.0, reasons))
            continue
        avg = collections.Counter()
        for d in per_option:
            for k, v in d.items():
                avg[k] += v / len(per_option)
        top = [(k, v) for k, v in avg.most_common(TOP_N) if v >= MIN_SHARE]
        kept = sum(v for _, v in top)
        w = [[k, round(v / kept, 3)] for k, v in top]
        fix = round(1 - sum(v for _, v in w), 3)
        w[0][1] = round(w[0][1] + fix, 3)
        mapped = sum(s["mapped"] for s in opt_stats)
        tot = sum(s["hours_y1_3"] for s in opt_stats)
        spec = sum(s["specific"] for s in opt_stats)
        spec_share = spec / mapped if mapped else 0
        if spec_share < SOLID_SPECIFIC:
            reasons.append(f"only {spec_share:.0%} of mapped Year 1-3 hours are named courses or the major's own prefixes; the rest are core/elective pools")
        if tot and mapped / tot < 0.75:
            reasons.append(f"{1 - mapped / tot:.0%} of Year 1-3 hours are free electives or unmapped")
        if "JUDGEMENT" in note:
            reasons.append("CIP-to-major mapping is a judgement")
        if len(slugs) > 1:
            pass  # averaging options is a method choice, not a confidence problem
        conf = "solid" if not reasons else "estimated"
        why = "; ".join(reasons) if reasons else f"Plan of Study grid present; {spec_share:.0%} of mapped Year 1-3 hours are named courses/own-prefix courses with Fall 2026 rooms"
        majors_out[mid] = {
            "name": name, "college": college,
            "bachelors_2024_25": degrees, "cip": cip,
            "catalog": [CATALOG + s + "/" for s in slugs],
            "buildings": w,
            "kept_share": round(kept, 3),
            "confidence": conf, "why": why,
            "hours_y1_3": tot, "hours_mapped": mapped, "hours_specific": spec,
        }
        low_conf.append((mid, spec_share * (mapped / tot if tot else 0), reasons))

    slim = []
    for mid, m in majors_out.items():
        nm = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", m["name"])
        tot, mapped, spec = m.get("hours_y1_3", 0), m.get("hours_mapped", 0), m.get("hours_specific", 0)
        slim.append({"id": mid, "name": nm.group(1) if nm else m["name"], "degree": nm.group(2) if nm else "",
                     "college": m.get("college", ""), "n": m.get("bachelors_2024_25"),
                     "conf": m["confidence"],
                     # share of the mapped Year 1-3 hours that are named courses / the major's own prefixes
                     "spec": round(spec / mapped, 2) if mapped else 0,
                     # share of Year 1-3 hours that are free electives or unmapped
                     "free": round(1 - mapped / tot, 2) if tot else 1,
                     "judged": "judgement" in m.get("why", ""),
                     "catalog": (m.get("catalog") or [None])[0],
                     "b": m["buildings"]})
    slim.sort(key=lambda r: r["name"].lower())
    out = {
        "v": 1,
        "_about": "UT Austin undergraduate major -> buildings where a typical student's Year 1-3 classes meet. "
                  "b = [[building code, weight], ...], weights sum to 1. conf 'estimated' = most of those years "
                  "are core and elective courses that meet all over campus. An estimate for students without a "
                  "schedule; an imported schedule always wins.",
        "_sources": {
            "majors": f"Largest majors by bachelor's degrees conferred 2024-25 (IPEDS completions, first majors), NCES College Navigator {NAV}",
            "plans": "UT Austin Undergraduate Catalog 2026-27, each major's Plan of Study Grid, https://catalog.utexas.edu/undergraduate/programs/",
            "rooms": "UT Registrar Course Offerings Fall 2026 PDF, https://utexas.box.com/v/UT20269CSpdf",
        },
        "_method": "Year 1-3 grid rows weighted by hours; named courses use their own Fall 2026 building mix; core slots use pools of the courses that usually fill them; free electives dropped; buildings under 2% dropped and the rest renormalised; multi-option majors average their options.",
        "_script": "scripts/bake_finder_majors.py",
        "catalog_year": "2026-27",
        "rooms_term": "Fall 2026",
        "majors": slim,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        head = {k: v for k, v in out.items() if k != "majors"}
        fh.write(json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1] + ',"majors":[\n')
        fh.write(",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in slim))
        fh.write("\n]}\n")

    for mid, m in majors_out.items():
        b = " ".join(f"{k}:{v:.2f}" for k, v in m["buildings"][:5])
        print(f"{mid:40s} {m['confidence']:9s} {b}")
    print("\nleast confident (specific-share x mapped-share):")
    for mid, score, reasons in sorted(low_conf, key=lambda x: x[1])[:8]:
        print(f"  {mid:40s} {score:.2f}  {'; '.join(reasons)}")


if __name__ == "__main__":
    main()
