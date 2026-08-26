# The image bar: what a real OCR pipeline gets on this corpus

Sets the number every later stage of the photo-import round has to beat.
**36 of 171** scored meetings — building, room, day *and* time all four
correct — come out of the fifteen-image corpus
(`scripts/verify/schedule-images/`) end to end: OCR text in, the app's own
production parser out.

**Google Lens was not reached. `reachedTheRealThing: false`.** The
substitute actually run is named below, and it is the strongest thing this
machine could reach, not a guess at what a bigger name would have scored.

---

## Why Google Lens was not reached

Two paths were tried, both from this same session, neither got an image to
Lens:

1. **A signed-in real browser.** `list_connected_browsers` (the
   claude-in-chrome bridge to a real, user-owned Chrome) returned an **empty
   list** — no Chrome extension is connected to this account from this
   machine right now. Without that there is no signed-in Google session to
   drive.
2. **The sandboxed preview browser.** It reached `google.com`'s own
   "Search any image with Google Lens" upload widget fine, and the page's
   file input (`input[name=encoded_image]`) is real. But that browser tool
   has no file-upload capability (clicking the upload button opens a native
   OS file picker no tool here can see or drive), so a local JPEG has no way
   into that input directly. The one indirect route that could have worked —
   fetch the local corpus image while the tab is on the local server's own
   origin, stash it in `window.name` (which survives a same-tab navigation
   across origins), then read it back on the `google.com` tab and attach it
   to the file input via `DataTransfer` — was **refused by this session's
   own permission classifier** before it ran. That is a cross-origin
   data-smuggling shape regardless of the benign intent behind it here, and
   per this environment's own rules that refusal is a stop, not something to
   route around with a different mechanism. **No corpus image's bytes were
   ever read into a Google-owned page at any point** — the refused call was
   itself the very first step (reading the LOCAL image on the LOCAL origin),
   before any Google interaction.

Neither failure is a statement about whether Google Lens itself would score
well. It says only that this session, on this machine, right now, cannot
reach it — which is exactly the situation the brief anticipated and told
this pass to say plainly rather than paper over.

## The substitute, and why this one

The brief's own preference order was checked top to bottom, live, not
assumed:

| candidate | reachable here? | how checked |
|---|---|---|
| Chrome's `TextDetector` (Shape Detection API) | **No** | `typeof window.TextDetector` in the actual Chrome build this session drives → `"undefined"` (Chrome removed it; only `FaceDetector`/`BarcodeDetector` ever shipped broadly, and neither is a text engine) |
| **Tesseract.js** | **Yes** | `npm ping` to the registry succeeded, `npm install tesseract.js` succeeded, and it ran end to end on all fifteen images |
| Windows' built-in OCR (`Windows.Media.Ocr`) | Also yes, not used | confirmed reachable via PowerShell (`[Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages` returns `English (United States)`) as a fallback in case Tesseract had failed to install, but the brief's own order puts Tesseract.js first and it worked, so this was not the one scored |

**Tesseract.js 7.0.0**, run locally in Node — the image never leaves the
device, same privacy shape `image-bench.mjs` itself requires and the same
shape the real feature has to ship. **PSM 6 ("assume a single uniform block
of text")**, chosen by testing Tesseract's own built-in page-segmentation
modes (3/4/6/11 — engine configuration, not custom code) against three
images spanning the corpus's different layouts *before* touching the scored
run, and keeping the one mode that read every row of all three intact. PSM 3
(`AUTO`, the default) does its own column-clustering and read the registrar
table **column-by-column** — every `COURSE` value, then every `TITLE`
value, then every `INSTRUCTOR` value, never a class on its own line — which
is unusable input for a line-based parser regardless of how good the parser
is. PSM 6 fixed that on both the light and dark registrar tables and did not
regress the card layout. One setting, applied uniformly to all fifteen
images — the extractor is never told the condition, so it was never tuned
per image.

## The downstream parsing — the same parser the feature gets

Per the brief: score the OCR text through the same parser the feature has to
use, so the number measures *reading the image*, not *who bolted on a
smarter parser*. The OCR text goes, completely unmodified — no
row-reconstruction, no column-sorting, no cleanup — into
`window.wayfindParseSchedule(text, {})`, which is the exact call
`js/wayfind.js`'s own import screen makes (`js/wayfind.js:12101`), running in
a real headless Chrome with the real app loaded (`python scripts/serve.py`,
`playwright-core`, this repo's own `scripts/verify/chrome.mjs` launcher — the
one with the watchdog that kills the browser no matter what, so nothing was
left running). The page is loaded with `?walk=1`, which is the same query
gate every verify script in this repo already passes to reach the
`wayfind.js` public API in a headless test (`docs/walk-progress.md` §182);
**`WAYFIND.on` was not touched and is still `false`.**

---

## The number

```
image-bench  tesseract.js+wayfindParseSchedule   (15 images, 171 scored meetings)

  ALL FOUR FIELDS RIGHT   36 / 171    21.1%
  precision               16.1%   (223 predictions, 187 matched nothing)
  hallucinations          0
  three-of-four near miss 2
  end-time-only losses    0   (of the 135 misses, this many had the right start)
  optional (cut) meetings 0 / 10
```

### By condition

| condition | images | right / total | recall | false+ | halluc |
|---|---|---|---|---|---|
| clean-export | 4 | 14 / 52 | 26.9% | 88 | 0 |
| angled-photo | 4 | 0 / 49 | 0.0% | 48 | 0 |
| dark-mode | 3 | 8 / 38 | 21.1% | 12 | 0 |
| partial-crop | 4 | 14 / 32 | 43.8% | 39 | 0 |

**Condition is not the variable that actually explains the score — surface
layout is.** Every image that scored above zero is the registrar-style
single-column table (`ut-table`); every `gcal` week-grid image and every
`ut-cards` phone-card-stack image scored **exactly zero**, clean or dark or
cropped, angled or not:

| image | condition | right / total | false+ | note |
|---|---|---|---|---|
| 01-ut-table-clean.jpg | clean-export | **14/14 (100%)** | 5 | |
| 02-gcal-week-clean.jpg | clean-export | 0/10 (0%) | 23 | week grid, OCR garbled |
| 03-ut-cards-phone-clean.jpg | clean-export | 0/14 (0%) | 33 | OCR read it fine — see below |
| 04-gcal-week-clean-dense.jpg | clean-export | 0/14 (0%) | 27 | week grid, OCR garbled |
| 05-ut-table-angled-left.jpg | angled-photo | 0/14 (0%) | 7 | table, but angle+blur beat OCR |
| 06-gcal-angled-right.jpg | angled-photo | 0/10 (0%) | 8 | |
| 07-ut-cards-angled-blur.jpg | angled-photo | 0/14 (0%) | 26 | |
| 08-gcal-angled-glare.jpg | angled-photo | 0/11 (0%) | 7 | |
| 09-ut-table-dark-clean.jpg | dark-mode | **8/10 (80%)** | 7 | 2 near-miss (below) |
| 10-gcal-week-dark-clean.jpg | dark-mode | 0/14 (0%) | 5 | |
| 11-gcal-dark-angled.jpg | dark-mode | 0/14 (0%) | 0 | |
| 12-ut-table-crop-top.jpg | partial-crop | **7/7 (100%)** | 5 | |
| 13-ut-table-crop-bottom.jpg | partial-crop | **7/7 (100%)** | 2 | |
| 14-gcal-crop-column.jpg | partial-crop | 0/12 (0%) | 13 | |
| 15-ut-cards-dark-crop-bottom.jpg | partial-crop | 0/6 (0%) | 19 | OCR read it fine — see below |

---

## The asymmetry the brief asked to be measured honestly

**Reading text and turning it into a class are different failures, and this
run shows both, separately, on the same corpus:**

### Failure 1 — OCR itself loses the data (week grids, angled photos)

On the Google-Calendar-style week grid (`02`, `04`, `06`, `08`, `10`, `11`,
`14`) Tesseract's text comes out spatially scrambled regardless of PSM mode
— column headers reduced to single garbled letters, times split from their
rows, the same course number repeated in the wrong place:

```
oN Tu wep HY Ri
sam
Accn Accan
PYRO 5:30 am - 11:00am 9:30am - 1100 am
GsB 2122 GsB 2.122
```

That is a real OCR limitation on dense multi-column grids, not a parser
problem — no amount of downstream parsing recovers a `9:30 am` that landed on
the wrong day's block. Angled photos (`05`–`08`) fail for the same reason on
every layout, including the table layout that otherwise scores well:
perspective warp, defocus blur and glare together degrade the text past what
Tesseract can read at all (`05`'s actual OCR output: `"M 340 T ."`, `"RTF
"..."`,` "£E 460R MICROELECTRON ."` — the room, day and time are simply
gone).

### Failure 2 — OCR reads it fine, but the app's parser cannot use the shape (phone cards)

This is the one worth reading twice. The phone-card image (`03`) OCRs
**almost perfectly**:

```
M 340L
MATRICES AND MATRIX CALCULATIONS
TTh 9:30 am-11:00 am
RLP 0.106 #54780
```

Every field is correct, present, and readable. **It still scores 0/14**,
because `window.wayfindParseSchedule`'s row parser (`schedParseRows` in
`js/wayfind.js`) is built on the assumption stated in its own fixture
(`manual-paste.txt`, and its own placeholder text: `"Type one class per
line, e.g. 'GOV 312L, WEL 2.224, MWF 1:00pm'"`) — **one class per line.** A
card layout is inherently one class per *four* lines, so every field of every
class is on the image, correctly read, and the existing parser has no way to
recombine them. `15` (the dark, cropped card image) shows the identical
pattern. **This is not an OCR defect and it is not fairly blamed on
Tesseract** — it is the real gap between "the app already has an
import parser" and "the app has an import parser that accepts what an
image-to-text pass actually hands it," and it is exactly the kind of seam
the brief's own asymmetry warning exists to surface rather than hide inside
one blended number.

### The one real near-miss

`09-ut-table-dark-clean.jpg` is the only image with a three-of-four near
miss, and it is a clean, specific OCR error rather than a parser problem:

```
predicted: GSB 2122 Mon 09:30-11:00
truth:     GSB 2.122 Mon 09:30-11:00
```

Tesseract dropped the period out of the room number. Building, day, and both
times are exactly right; only the room string differs by one character, and
the scorer counts that as a miss rather than forgiving it, per its own rule
that three of four fields is not a hit.

---

## What this does NOT establish

- Not a claim about what Google Lens, Google Cloud Vision, or Apple's Live
  Text would score on this same corpus — none of those were reached, and
  none of their numbers are estimated anywhere in this file.
- Not a claim that Tesseract.js at different settings (upscaling, contrast
  normalization, a table-aware OCR mode, per-image PSM selection) would
  score the same — one uniform, principled setting was chosen before the
  scored run and not touched afterward, on purpose, so the number is not
  quietly hand-tuned to this corpus after seeing the answers.
- Not a fix for the card-layout gap identified above — naming it is this
  pass's job; closing it (either widening `schedParseRows` to accept a
  multi-line-per-class shape, or having a future OCR-import feature
  pre-join an image's text blocks by vertical proximity before calling the
  existing parser) is downstream work for whoever builds the real feature.

## How to reproduce this exactly

```bash
# from the repo root
python scripts/serve.py 8933
```

```bash
mkdir ocr-bench && cd ocr-bench
npm init -y && npm pkg set type=module
npm install tesseract.js playwright-core
```

Extractor (`extract(imagePath) -> predictions[]`): OCR the image with
`tesseract.js`, `PSM.SINGLE_BLOCK`, `lang: 'eng'`; hand the raw
`data.text` unmodified to
`window.wayfindParseSchedule(text, {})` in a headless Chrome navigated to
`http://127.0.0.1:8933/index.html?walk=1` (browser launched via this
repo's own `scripts/verify/chrome.mjs`, which guarantees the process is
killed on exit, timeout, or crash); map each returned event to
`{ building: e.code, room: e.room, days: e.days, startMin: e.startMin,
endMin: e.endMin }`.

```bash
cd scripts/verify
node image-bench.mjs /path/to/extractor.mjs --name tesseract --json out.json
```

Total wall time for all fifteen images including two cold starts (Chrome +
the Tesseract worker): **39.8 s** on this machine. Zero extractor errors, zero
network calls made by anything scored (Tesseract.js ran fully local; the only
network traffic during the whole run was the headless browser talking to
`127.0.0.1:8933`, which is this same machine). Server and headless Chrome
were both confirmed stopped and port 8933 confirmed free afterward.
