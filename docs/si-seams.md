# si-seams — SI1, SI2 and SI3, and the one decision they all hang off

Branch: `acer/si-combined`. Written 2026-08-25, after the fix, from runs rather
than from reading the diff.

`WAYFIND.on` is still `false` on this branch and was not touched. The walk
feature is still behind the flag.

---

## 0. The decision, first, because everything below is a consequence of it

**The parser's object — `ut-walk-schedule`, the thing `wayfindParseSchedule()`
returns — is the shape that crosses every seam in this feature.** The import
screen's own row shape survives as a *local* detail of placement, adapted down
from the parser's events; it no longer leaves the section.

This is what the brief recommended, and it holds up for three measurable
reasons, not one:

1. **It is the only producer carrying `startMin`/`endMin` as numbers.** The day
   view orders a day by minutes (`dayNormalise` drops any row where
   `isFinite(startMin)` is false), and the store's `normaliseSchedule` writes
   `null` for any `startMin` that is not finite. The import screen's rows carried
   clock *strings* (`"14:00"`). Anything crossing the seam in that shape arrives
   at both consumers with no time at all — which is exactly what a reload used to
   produce.
2. **It is the only producer carrying per-row `problems[]`.** The day view
   prints the importer's own sentence under a class it could not place
   (`SAY_D.unplacedWhy`, and the parser's hint where it gave one). There is
   nowhere else to get that sentence from.
3. **It already resolves names, not just codes.** `schedResolve()` falls through
   to a name ladder, so `Jester Center` — a LOCATION line with no building code
   in it — comes back as `JES`. The stand-in decoders can only ever drop it.

**What was NOT chosen, and why.** The obvious alternative was to make the import
screen's `{title, location, days, start, end}` row the lingua franca and teach
the day view and the store to read it. It fails on all three points above: it
would mean re-deriving minutes at two more call sites, inventing a second place
for failure text, and shipping two building-resolution ladders. The row shape is
a good shape for *placement*, which is the only job it now has.

**The cost of the decision, stated.** The published object is a union: it
carries `classes`/`rejects` (this screen's placements) *and* `events` (the
parser's own rows). Two views of one list is a real risk of drift, so they are
built in one loop, in one order, through one de-duplication — see `impBuild()`.
When the parser threw and the fallback decoders ran, `events` is synthesised
from the rows that were actually placed, so the two views cannot disagree in
that case either.

### The object that now crosses the seam

```
window.wayfindSchedule = {
  v, source, via, at,            // unchanged: the import screen's own header
  classes, rejects,              // unchanged: what this screen placed and why not
  decoder: 'parser' | 'fallback',// NEW: which producer made the rows
  events:  [...],                // NEW: the parser's events, verbatim
  origin:  {kind, label, producer, importedAt} | null,   // NEW
  tz, problems, summary,         // NEW: the parser's, where it ran
  saved:   {ok, bytes, classes}  // NEW: what store.save() returned
}
```

After a reload the store rebuilds a thinner version of the same object
(`schedulePublished()`, `restored: true`, `events` only) onto the same name, so
every reader downstream has exactly one thing to look at and exactly one
condition under which there is nothing to look at.

---

## 1. SI1 — the import screen never called the parser

**Was:** `js/wayfind.js:11889` did `const r = window.wayfindParseSchedule(...)`
with no `await`, then `if (Array.isArray(r) && r.length) return r`. The parser
is `async`, so `r` was always a Promise and the check was always false. Every
import in the app fell through to the stand-in decoders `si-ui` wrote for the
case where the parser lane had not landed.

**Now:** `impRawRows()` is `async`, awaits the parser, and maps
`parsed.events[]` through `impRowFromEvent()` into the rows `impPlace()` reads.
The stand-in decoders remain, reached only when the parser throws.

**Measured, on the parser's own `manual-paste.txt` fixture:**

| | before | after |
|---|---|---|
| classes the screen places | 2 | **5** |
| codes | `MAI`, `WEL`* | `GDC MAI PAI RLP WEL` |
| the parser's own count | 5 of 7 | 5 of 7 |

\* the gate's before-line records the shortfall as "3 classes silently dropped
by the fallback decoder"; GOV 312L, PHY 303L and MAI 220 were the three.

On the integration fixture (`integration-tuesday.ics`, 6 events) the screen now
places 5 and rejects 1 — MER 1.906, which is at the Pickle campus and is named
and explained rather than dropped. `shots/si/seams/import-result-phone.jpg`.

Two things worth knowing about the fix:

- **The label is a hint, not an override.** `impRawRows` passes the tab's own
  label (`Google Calendar` / `Apple Calendar` / `UT registration`) as
  `opts.label`. `schedParseICS` prefers the file's own PRODID and calendar name,
  so this only decides what the day view's footer falls back to when the file
  said nothing about itself.
- **`busy` is now cleared after the await.** It used to be cleared on the first
  line of `impFinishNow`, which with an async producer would put `Import` back
  on the button while the file was still being read.

## 2. SI2 — the day view showed somebody else's classes

**Was:** `impUse()` published `.classes`; `wayfindDayFromSchedule` read
`.events || .routable`; nothing anywhere listened for the `wayfind:schedule`
event (one `dispatchEvent`, zero `addEventListener`). So `#wf-day-btn` called
its hard-coded demo unconditionally. Import M 340L / RTF 305 / C S 439 /
EE 460R, tap the button that says "Import my class schedule", and be shown
CMS 306M / C S 429 / BA 101S / J 310F.

**Now:**

- the published object carries `events`, so the day view reads it directly;
- `#wf-day-btn` asks `dayImportedSchedule()` first and only falls back to the
  demo when nothing has ever been imported on this device;
- the missing `addEventListener('wayfind:schedule', …)` exists, so an import
  invalidates a stale plan and rebuilds an open panel, and a delete closes it;
- **the demo says it is a demo.** Every built-in fixture is marked
  `example: true` at the source (`wayfindDayFixture`,
  `wayfindDayScheduleFixture`), the header carries an `EXAMPLE` badge, and the
  footer reads `From UT registration — sample data, not your schedule`.

Provenance and authenticity are two different facts and the footer keeps both.
"From UT registration" is what the *data* claims about where it came from —
true of a fixture built out of real UT LOCATION lines, and a trip `dayview.mjs`
already asserts survives from the parser's shape to the footer. What it could
not say before is that the data is not the student's.

The badge rides **inside** the title line rather than taking a row of its own,
because `dayview.mjs` asserts the whole panel fits a 390×844 phone and a new row
would have put a shipped assertion at risk for a purely additive label. Measured
after the change: panel `y=186 h=472 bottom=658 ≤ 844`.

Two taste values, both parameterised: `WF_DAY.exampleBadge` (label the demo) and
`WF_DAY.demoWhenEmpty` (whether the demo may appear at all). Wording is in
`SAY_D.exampleBadge` / `SAY_D.fromExample`.

**Verified by looking, on a 390×844 phone:**

- `shots/si/seams/demo-labelled-phone.jpg` — nothing imported: `TUESDAY EXAMPLE`
  in the header, `From UT registration — sample data, not your schedule` in the
  footer.
- `shots/si/seams/day-imported-phone.jpg` — after importing the fixture:
  M 340L / RTF 305 / C S 439 on screen in time order, no badge, footer reads
  `From UT registration`.
- `shots/si/seams/day-after-reload-phone.jpg` — the same day, after a reload.

Asserted on the DOM as well as the frame: all four of M 340L, RTF 305, C S 439,
EE 460R present; all four of CMS 306M, C S 429, BA 101S, J 310F absent.

`daySourceOf()` also learned to read a bare source id. The import screen and the
store each name the same three sources in their own vocabulary (`gcal` vs
`google-ics`), and a restored schedule carries the store's — reading only the
parser's descriptor object made every one of those come back `manual`, so a real
UT import's footer said "From typed in".

## 3. SI3 — nothing was ever saved

**Was:** `WAYFIND.store.save` is defined at `:14413` and its own comment calls
it "the public seam the import lanes call". Nothing called it. A reload lost the
import, "Delete my schedule" had nothing to delete, and the egress guard — which
arms its watchlist from the **stored** schedule — read `watched=0, checked=0`
during a real import.

**Now:** `impUse()` calls `WAYFIND.store.save(impStoreDoc(res))`.

- **At `impUse`, not at preview.** This is the tap that says "use these"; a
  schedule a student looked at and backed out of has no business being left on
  the device.
- **Rejects are stored too**, each with the reason this screen gave for it
  (`unroutableWhy`). A student who imported seven classes and can walk to five
  still has seven classes on their Tuesday, and dropping the other two on the
  way to disk would put an invented gap into the day view the moment the page
  reloads — the same defect `WF_DAY.showUnplaced` exists to stop. So the
  integration fixture stores **6**, not 5.
- **`startMin`/`endMin` travel on the placed row** (`impPlace`), because
  `normaliseSchedule` discards any `startMin` that is not finite. All 6 stored
  classes carry a time.
- **The store now names the source.** `IMP_SOURCES` gained `storeKind`
  (`gcal → google-ics`, `apple → apple-ics`, `ut → ut-registration`), so the
  privacy panel reads `6 classes from UT's registration export, on this device
  only` instead of `from an import`.
- **A reload republishes.** `scheduleSyncPublished()` runs at boot and on every
  store change, turning the stored envelope back into the published object. A
  delete unpublishes it and dispatches `wayfind:schedule` with `detail: null`,
  which is also what makes a delete in *another tab* take the schedule off this
  tab's screen.

**The shipped alarm, not the test rig:** after a real import through the real
screen, `WAYFIND.store.guard.state()` reports **`watched=30`** (was 0) and
**`quietChecked=107`** worker messages inspected (was 0). Nothing was blocked
and nothing left the device; the difference is that it is now the shipped guard
saying so at the moment it matters, which is what the round asked for. After
delete: `watched=0`, `localStorage` back to `["austin3d.gfx.v1"]`.

Nothing here changes what is stored *about* a schedule or where — still
`localStorage` only, still one key under the feature's own prefix, still
one-tap delete. No new schema version: no field was added to the stored
envelope. `course` is deliberately **not** stored; it is re-derived from the
title on restore with the same rule the parser used, because a stored field that
can go out of step with the field it came from is a schema change looking for a
bug.

---

## 4. One instrument was corrected, and that has to be said plainly

`si-integration.mjs` gate 1 asserted `seam.kept > 0`, where `kept` was
incremented by `if (Array.isArray(r))` inside a wrapper around
`wayfindParseSchedule`. That reads the parser's **return type**, not the
screen's behaviour — and the parser is `async` by design, so it is false however
the screen behaves, including when the screen is doing exactly the right thing.
An instrument that can only ever report one answer is not measuring anything.

It now asserts on the screen's own record of which producer made the rows it
placed: `impBuild` sets `decoder: 'parser' | 'fallback'` on the result, and
`window.wayfindImportResult()` exposes it. The old counter is still incremented
and still printed in the note line, so the change is visible in the output
rather than hidden.

**Both numbers, so nobody has to take this on trust:**

| | gates |
|---|---|
| before the fix, gate as it was | **39 / 50** |
| after the fix, gate still exactly as it was | **44 / 50** |
| after the fix, with the instrument corrected | **45 / 50** |

## 5. What is still red, and it is not this pass's job

- **SI5** — `the import screen agrees SSW is reachable`. `IMP_UNREACHABLE`
  still hard-codes SSW/HLB as `nodoor` while the router says SSW is routable
  with 2 doors.
- **SI6** — `the day view gives si-gaps's off-map reason for it`. `dayPlace()`
  tests `entry.routable` before `entry.offMap`, so MER takes the `nodoor` path.
- **SI4** — three gates: two import doors in one sheet, and 157 px of the sheet
  past a fold it clips with `overflow-y: hidden`, taking the privacy line and
  the Delete button with it. The one-door-or-two half is a taste call for
  Simeon; the `overflow-y` half is not.

The `overflow-y` one has a consequence worth writing down for whoever fixes it:
**the Delete control cannot be tapped on a 390 px phone today.** It is below a
clipped fold. The verification above drove the shipped control on a viewport
where it is reachable rather than reaching round it with an API call, and it
works — but a student on a phone cannot currently get to it, which makes SI4 a
privacy defect and not only a layout one.

## 6. The shipped feature

`walkmeter.mjs` on this branch after the change reproduces the record exactly:
**87.0 m** extra over the pairs it makes worse, signed total **−393.7 m**,
**38/38** ends at UT's own door, self-check drift 0, 0 route errors, live UI
gate PASS. `harness-drift.mjs` PASS. `dayview.mjs` is **100 ok / 2 failed**,
identical to its baseline measured on the same tree with these changes reverted
— both remaining failures are the merge's own (`si-gaps` made SSW routable, so
"all eleven are still unroutable" now reads 10/11).

## 7. How to reproduce all of it

```bash
python scripts/serve.py 8975                  # never python -m http.server
node scripts/verify/si-integration.mjs 8975   # 45/50
node scripts/verify/walkmeter.mjs 8975        # 87.0 / -393.7 / 38 of 38
node scripts/verify/dayview.mjs 8975          # 100 ok, 2 failed (both pre-existing)
```
