# Recon: UT Austin's own class-schedule export — 2026-08-24

No code changed for this task. This is a research writeup for whoever builds
the "UT registration export" lane of the schedule-import feature described in
`docs/walk-progress.md` and the wayfind brief. Everything below is either a
direct quote of something public I fetched, or explicitly marked as unverified
because it sits behind a UT EID login I did not and should not cross.

## The one thing that matters most: the location-field format

UT's own public documentation says the location field on every class listing
is **a three-letter building code plus a room number, space-separated** — the
exact same vocabulary `js/wayfind.js`'s `UT_ENTRANCES` table already uses
(`MAI`, `JGB`, `WCH`, …).

Quoted verbatim from **registrar.utexas.edu/schedules/269/using** ("Using the
schedule", public, no login required — this is the Fall 2026 Course Schedule's
own glossary of what a class listing shows):

> **Rooms.** The building and room where the class meets. Buildings are
> abbreviated with three letters. » Also see the list of buildings and their
> abbreviations.

That page also documents the course-number format the same way: "Three-
character field of study abbreviation followed by three-digit number" (e.g.
`MAI 220` in the brief's example is course `M 220`-style plus location `MAI
220` — the field of study and the building can look identical in shape, which
is a real parser trap worth flagging for whoever builds this next).

I could not get UT to hand me one of its own real exported files (see wall,
below), but I found working, currently-shipping code that scrapes this exact
UT page format to build real students' calendars, and its test fixtures are
literal reproductions of what UT's DOM prints. From
`Longhorn-Developers/UT-Registration-Plus` (open source, MIT, 50,000+ users,
`src/shared/types/CourseSchedule.ts`):

```
/**
 * @param locLine - A string representation of the location that the course
 *                  is taught in: JGB 2.302, etc.
 */
static parse(dayLine: string, timeLine: string, locLine: string): CourseMeeting {
    ...
    const location = locLine.split(' ').filter(Boolean);
    ...
    location: location[0] ? { building: location[0], room: location[1] ?? '' } : undefined,
```

And a full real `.ics` `VEVENT` block from that project's own test suite
(`src/views/components/calendar/utils.test.ts`), which is built from exactly
this parsed location — quoted verbatim:

```
X-WR-CALNAME:My Schedule
BEGIN:VEVENT
DTSTART;TZID=America/Chicago:20250825T160000
DTEND;TZID=America/Chicago:20250825T170000
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH;UNTIL=20251209T060000Z
EXDATE;TZID=America/Chicago:20250901T160000,20251124T160000,...
SUMMARY:C S 429 – COMP ORGANIZATN AND ARCH
LOCATION:UTC 3.102
DESCRIPTION:Unique number: 54795\nTaught by Siddhartha Chatterjee
END:VEVENT
```

Other real `LOCATION:` lines from the same fixture file: `CMA 6.146`,
`DMC 3.208`, `GSB 2.122`. Pattern is consistent across all of them:
`{3-LETTER CODE} {FLOOR.ROOM}`, one space, no punctuation around the code.

**Implication for the parser:** split the location string on the first space,
uppercase-compare the first token against `UT_ENTRANCES`'/`UT_CELEBRATED`'s
code list, and treat everything after the space as room (unused by routing,
but worth keeping for the "which door" display). This is a one-line split, not
a regex minefield — the format is that regular.

## The wall — exactly where it is

I navigated straight to `https://utdirect.utexas.edu` (no path) and to the
Fall 2026 course-schedule search app UT's own registrar page links as "Find
courses now" (`https://utdirect.utexas.edu/apps/registrar/course_schedule/20269`).
Both bounced immediately, via a 302, to:

```
https://enterprise.login.utexas.edu
```

Page title: "Sign in with your UT EID". Visible body text, quoted verbatim:

> Sign in with your UT EID
> I forgot my UT EID or password.
> I have a temporary password.
> I need a UT EID.
> Help
>
> Unauthorized use of university computer and networking resources is
> prohibited. If you log in, you acknowledge your awareness of and
> concurrence with the university's Acceptable Use Policy and Information
> Resources Use and Security Policy...

I did not attempt to log in (no EID credentials, and entering credentials is
outside what I'll do regardless). Everything behind that page — the actual
"My Schedule" view, any registration-system export button, RIS itself — is
unverified by me. Anything below about what's on the other side of that wall
is inference from public secondary sources, flagged as such.

## Correction: "RIS" is not a schedule-export tool

The brief's guess — "Registration Information System (RIS)" — is wrong in a
way worth fixing before anyone builds against it. UT's own Texas One Stop page
(`onestop.utexas.edu/registration-and-degree-planning/registering-for-classes/`,
public) spells it out:

> **Find Your Registration Time.** Find your registration access date and
> times on your Registration Information Sheet (**RIS**). Update your contact
> information if it has changed.
> **Resolve Holds.** Check your RIS to see your holds.

RIS = **Registration Information Sheet** — it tells a student when they're
allowed to register and whether they have holds. It is not where a class
schedule lives and it has nothing to do with calendar export. Whoever builds
the "UT registration export" lane should stop looking for an export button on
the RIS; it isn't there by definition, not because it's hidden behind login.

## Does UT itself publish a native calendar/.ics export of a personal class schedule?

Best answer from public sources: **I could not find one, and the existence of
a well-used third-party extension built specifically to do this is itself
evidence UT doesn't.**

What I checked:
- UT's own registrar/onestop/UT Direct public pages: no mention of an "add to
  calendar", "export schedule", ".ics", or "webcal" feature for a *personal*
  class schedule anywhere I could find.
- UT *does* publish `.ics` downloads of the **academic calendar** (semester
  start/end, holidays, registration windows) at
  `registrar.utexas.edu/calendars/*` — right-click-and-copy or direct
  download. This is a different thing from a personal class schedule and is
  easy to confuse with it; don't build against it by mistake.
- MyUT, UT's student portal (the thing that shows your class schedule and has
  the campus map in its side nav), was covered in a 2019 UT News piece
  (`news.utexas.edu/2019/08/26/how-myut-can-help-you-navigate-the-new-semester/`).
  Quoted: "Your class schedule is front and center in the MyUT website... Once
  you orient yourself with your new schedule, it's time to find your
  classrooms" — schedule and map are described as two separate tools you use
  back-to-back, with no walking directions between them and no export/calendar
  feature mentioned at all. That gap is exactly the gap this project's walk
  feature fills, which is worth saying back to Simeon as validation, not just
  filed as a footnote.
- The `UT Registration Plus` Chrome extension (Longhorn Developers, third-
  party, not an official UT tool, MIT-licensed, source on GitHub) exists
  *because* students had no first-party way to get their schedule into Google
  or Apple Calendar. Its own listing: "You can save a picture of the schedule,
  and even export it to an ICS file that you can import into Google Calendar
  or iCalendar." It works by scraping the DOM of UT's own (logged-in) course
  catalog/registration pages client-side in the browser — there is no UT API
  it's calling.

**So: no confirmed webcal:// link, no confirmed native .ics button inside
UT's registration system.** If one exists behind the login wall, it wasn't
findable from any public UT documentation, help-desk page, or news coverage I
could locate. The realistic "UT registration" import path for this project is
therefore almost certainly going to look like UT Registration Plus's own
approach — paste-in text or a pasted/uploaded `.ics` a student generated
themselves via that extension or by hand-copying rows off the course-schedule
page — not a UT-hosted feed URL. Good news for the parser design: that means
whatever format shows up will already look like the `CODE ROOM` pattern
quoted above, because that's what's on the UT page being copied from.

## The two forcing-function claims, re-verified independently

**Claim 1 — 10 of the 11 unroutable codes are ~11 km north at Pickle Research
Campus.** Re-checked against `js/wayfind.js`'s own `UT_CELEBRATED` table
(coordinates) and independently against UT Direct's public Pickle Research
Campus building index
(`utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/prc/`,
loads without login). **Confirmed, all 10:**

| Code | UT's PRC listing | Our table's coordinates |
|---|---|---|
| BE1 | BEG LAB BLDG (PRC 131) | 30.391820, -97.726989 |
| BEG | BEG MAIN BLDG (PRC 130) | 30.391018, -97.725348 |
| EME | ELEC MECH./ENGR.RES.CTR. (PRC 133) | 30.389588, -97.727334 |
| FS1 | FERGUSON ENGR LAB ANNEX (PRC 177) | 30.386885, -97.731999 |
| FSL | FERGUSON LAB.- MAIN BLDG. (PRC 24) | 30.387375, -97.731553 |
| MER | MICROELECT.& ENGR.RES.CTR. (PRC 160) | 30.385289/775/386410, -97.7278ish |
| PX3 | PETEX (PRC 2) | 30.387322, -97.729725 |
| ROC | RESEARCH OFFICE COMPLEX (PRC 196) | 30.390533, -97.725667 |
| SV1 | PRC SERVICE CTR TRADES (PRC 136) | 30.382449, -97.725727 |
| TCB | J NEILS THOMPSON COMMONS (PRC 137) | 30.387216, -97.727045 |

All ten sit at latitude ~30.38–30.39, vs. main-campus latitude ~30.28–30.29 —
about 0.10–0.11° of latitude, i.e. ~11–12 km, matching "reportedly ~11 km
north." This part of the brief was right; these ten are correctly excluded
from a main-campus walking router and the fix is not "route to them," it's
"tell the schedule-import UI these codes exist but are off-map, the same way
a class at UT's Lake Austin campus or UT-Downtown would be."

**Claim 2 — "SSW is reportedly not in UT's own building register at all."**
**This is false, and worth correcting before anyone designs around it.** SSW
*is* in UT's own register — as a main-campus building, not a Pickle Research
Campus one. Confirmed from three independent public sources:

- `maps.utexas.edu/buildings/utm/ssw` 302-redirects to
  `utdirect.utexas.edu/apps/campus/buildings/nlogon/maps/UTM/SSW/` — the
  `UTM` segment is UT's own main-campus code (as distinct from `PRC` for
  Pickle Research Campus above), so UT itself files SSW as a main-campus
  building.
- Search results independently surface the record as **"school of social
  work building (ssw - 0625)"** (a real UT building-inventory number) from
  both `maps.utexas.edu` and `utdirect.utexas.edu`.
- Address and coordinates found (Wikipedia, citing the historic building's
  listing): 1925 San Jacinto Blvd, 30.28056°N, 97.73250°W — which is a near-
  exact match for `js/wayfind.js`'s own `UT_CELEBRATED` rows for `SSW`
  (30.280477, -97.732959 and 30.280797, -97.732860). **It's the same building
  and it's already got coordinates in this codebase.**

One real wrinkle: per that same source, the Steve Hicks School of Social Work
*vacated* this historic building as of spring 2024 as part of a relocation.
The building itself, its code, and its registration all still stand — it just
may not be where Social Work classes are actually held any more. Whatever
department occupies SSW now (if anyone) would still need it as a valid
registered destination code.

**Net correction:** SSW is not unroutable because it's unregistered. If it's
currently unroutable, the cause is something inside this app's own pavement/
routing graph, not a missing UT record — that's a different, and probably
much smaller, fix than "handle an unregistered code." Whoever picks up SSW
next should look at why the app's router can't reach a building that already
has two real UT_CELEBRATED door rows, not add special-casing for "building
doesn't exist."

## On screenshots

The task asked for screenshots in `shots/import/bar-ut/` if I could reach
anything without a login. I *did* reach public pages (the registrar's "Using
the schedule" page, Texas One Stop, the `enterprise.login.utexas.edu` wall
itself, UT Direct's public PRC building index) — but this session's browser
pane does not compositor-render in this sandboxed subagent context
(`computer{action:"screenshot"}` timed out every time with "the Browser pane
is not displayed, so the page is not compositing frames," even after
`resize_window` and re-fronting the tab). Per house rule ("prove the subject
is on screen before any number you report"), I'm not fabricating screenshots
or claiming pixels I never looked at — every fact above is instead a verbatim
quote of page text I pulled with `get_page_text`, with the exact URL next to
it, which is the honest substitute available in this session. No files were
written to `shots/import/bar-ut/`.

## Bottom line for whoever builds the UT-registration lane

1. The location-field format to parse is `{3-LETTER CODE} {FLOOR.ROOM}`,
   space-separated, code first — confirmed both by UT's own public glossary
   and by real fixture data from a widely-used extension scraping UT's actual
   pages. Design the parser around a plain `split(' ')`, first token
   uppercase-matched against the existing `UT_ENTRANCES`/`UT_CELEBRATED` code
   list.
2. There is no confirmed first-party UT `.ics`/webcal feed for a personal
   class schedule. Build the "UT" import lane to accept a pasted block of
   text or an uploaded `.ics` (matching the shape UT Registration Plus
   already produces), not a URL UT hosts — nothing found supports the latter
   existing.
3. Don't confuse UT's *academic calendar* `.ics` downloads
   (`registrar.utexas.edu/calendars/*`) with a personal schedule export —
   they're a different feature for a different purpose.
4. Of the 11 unroutable codes: 10 are genuinely off-map (Pickle Research
   Campus, ~11 km north) and the schedule-import UI should say so rather than
   attempt to route there. SSW is a real, registered, main-campus code with
   existing coordinates in this codebase already — its unroutability is a bug
   in this app, not a data gap upstream.
