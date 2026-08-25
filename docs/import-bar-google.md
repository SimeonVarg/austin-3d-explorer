# Recon: Google Calendar's import bar (real, live-fetched)

**2026-08-24.** This is recon only — no code changed. Goal: capture, for real,
how Google Calendar itself presents (1) importing an .ics/.csv file, (2)
subscribing to a calendar by URL, and (3) creating one event by hand — as the
bar the schedule-import builder should clear or beat. Screenshots are in
`shots/import/bar-google/`, all real captures (see Method below), phone
(390×844) and desktop (1280×900).

## Method — and one honest limitation up front

I opened a real headless Chrome (the project's own pinned
`playwright-core` + `C:/Program Files/Google/Chrome/Application/chrome.exe`,
same binary the verify suite uses) and hit `calendar.google.com` and
`support.google.com` for real. **I did not sign into a Google account** —
entering a password is against my operating rules regardless of who asks, and
no credential-manager tool was available to do it safely. Concretely, that
means:

- `calendar.google.com` signed-out just redirects to a Google sign-in page
  (screenshot: `signin-account-chooser-desktop.png` /
  `-phone.png`) — I could not drive the live in-app Import/Subscribe/Create
  dialogs directly.
- Instead I captured Google's own **official Help Center walkthroughs**
  (support.google.com/calendar/answer/…), which is Google's real, current,
  public documentation of the exact same flows, generally including the exact
  in-app copy (button labels, menu paths, field names) and — critically — the
  **exact error/confirmation strings** the app shows, which is the part a
  builder most needs and least wants to guess at. Every screenshot below is a
  real capture of a real live page today, not a page from memory.

If a later pass needs pixel-for-pixel dialog chrome (exact modal styling),
that still requires an authenticated session and should be done by a human or
with an explicit go-ahead to sign in — I did not do that here.

## 1. Import (.ics / .csv file upload)

**Path:** Settings (gear, top right) → **Settings** → **Import & Export** (left
menu) → **Select file from your computer** → choose calendar → **Import**.

Exact steps as Google documents them (Computer tab):
1. Open Google Calendar.
2. Top right, click **Settings** (gear) → **Settings**.
3. Left menu, click **Import & Export**.
4. Click **Select file from your computer**, pick the file. Must end in
   `.ics` or `.csv`.
5. Choose which calendar to import into (defaults to your primary calendar).
6. Click **Import**.

Screenshots: `import-help-steps-desktop.png`, `import-help-steps-phone.png`.

**Important constraints that bear directly on our builder:**
- **Google's import is desktop/browser-only.** The Android tab of the same
  article says outright: *"To import events, open Google Calendar on your
  computer."* There is no in-app-on-phone import at all in Google's own
  product. (`import-help-steps-phone.png` — captured on the Android tab
  because a mobile user-agent lands there by default.)
- **1 MB file-size ceiling.** "Google Calendar works with files that are one
  megabyte (1MB) or smaller." Above that, Google tells the user to export a
  shorter date range or split the file.
- **Google only trusts files from "major calendar applications"** — it names
  Microsoft Outlook, Apple Calendar, and Yahoo Calendar explicitly as the
  known-good source set for .ics/.csv structure.
- **ZIP files**: if the export is a `.zip` (Google Takeout-style), the user
  must unzip it themselves and import each `.ics` inside one at a time —
  Google does not unzip for you.

**Partial-failure / error wording (this is the part worth copying verbatim
into our own UI's tone), from "Fix problems importing"**
(`import-errors-help-desktop.png`, `import-errors-help-phone.png`,
support.google.com/calendar/answer/45654):

| Message shown | What it means / when it fires |
|---|---|
| **"Processed zero events"** | Either nothing in the file could be read, *or* the exact same file was already imported once (Google explicitly calls out double-clicking Import as a cause) — it tells the user to go check their calendar before assuming it failed. |
| **"Processed x of y events"** | **This is Google's partial-success message** — x succeeded, y is the total in the file. Shown when some events parse and some don't. Google's own root-cause guess: the file didn't come from Outlook/Apple/Yahoo, or its .ics/.csv formatting is off. |
| **"Google Calendar is temporarily unavailable"** | File too large (>1MB) — shown as a generic-sounding server error even though the real cause is client-side (file size). |
| **"The connection to the server was reset"** | Malformed file — same remediation as above (check CSV/ICAL formatting). |

Takeaway for our design: Google's own model is **"x of y" partial success,
not all-or-nothing** — a file with some unparseable rows still imports the
good ones and reports a count. That's the bar: our importer should do the
same (parse what it can, report N of M classes matched to a building CODE,
name the ones that didn't).

There is **no visible in-app "success" toast** described anywhere in Google's
own docs beyond the imported events simply appearing on the calendar grid —
confirmation is implicit (the events are just there), except for the explicit
error strings above when something goes wrong. That's a bar we can beat
cheaply: an explicit "imported 6 of 7 classes, MER not found" is already
better UX than Google's own default.

## 2. Subscribe by URL (a public .ics link)

**Path:** on the left sidebar, next to "Other calendars," click **＋** → **From
URL** → paste the .ics link → **Add calendar**.

Exact steps as documented:
1. Open Google Calendar.
2. Left sidebar, next to "Other calendars," click **Add other calendars (+)**
   → **From URL**.
3. Enter the URL of the published calendar.
4. Click **Add calendar**.
5. The calendar appears on the left under "Other calendars."

Screenshots: `subscribe-url-help-steps-desktop.png`,
`subscribe-url-help-steps-phone.png`.

**Constraints:**
- **Desktop/browser-only, explicitly.** Google's own callout: *"To subscribe
  to a new calendar, you must use a computer web browser. You can't subscribe
  to a calendar in the Google Calendar app for Android, iPhone, or iPad."*
  Same restriction as Import. (The phone capture lands on the Android tab,
  which instead only documents show/hide of an *already-added* calendar —
  adding one by URL is not offered there at all.)
- **Google-hosted calendars only for the "ask to subscribe" flow** ("You
  can't subscribe to calendars that aren't from Google" — that's the
  person-to-person share flow, a different one from From-URL). The From-URL
  flow has no such restriction — any public .ics URL works, which is exactly
  our UT-Registration-export use case (an ICS the student hosts or a
  Registrar-issued link) if UT ever publishes one.
- No confirmation dialog beyond the calendar appearing in the left list —
  again, implicit success, no explicit error string documented for a bad URL
  (a 404 or non-ICS URL presumably just fails to add anything, silently, per
  Google's docs — no wording exists in Google's own material for this case,
  worth noting as a gap rather than guessing at wording that isn't real).

## 3. Manual "create one event" flow

**Path (button):** top-left **Create** button → fill in title/date/time →
**Save**.
**Path (click a slot):** click an empty time on the grid → fill in details →
**Save**.

Screenshots: `create-event-help-steps-desktop.png` (both paths expanded),
`create-event-help-steps-phone.png` (Android app path).

Exact wording, "Click the Create button" path:
1. Open Google Calendar.
2. *Optional:* add guests via "Search for people."
3. Top left, click **Create**.
4. Add a title and any event details.
5. Top of the page, click **Save**.

Android app path is materially different and worth knowing since our own app
is a phone-first tool: **Create (+) → Event → fill fields → "Swipe up to edit
event details."** No separate Save button call-out on the mobile step list —
save is folded into the swipe-up sheet.

Confirmation is, again, implicit: the created event simply appears on the
grid at its slot. Editing later: click the event → **Edit** (pencil) → change
→ **Save**.

## What a builder should copy from this, concretely

1. **Partial success, not all-or-nothing.** Model on "Processed x of y
   events": if 6 of 7 classes on a pasted schedule match a known building
   CODE, import the 6 and name the 1 that didn't, rather than rejecting the
   whole import. This is Google's own default and it's the right one.
2. **Say why a row failed, in the same breath as the count.** Google's error
   copy always pairs the failure with the likely cause (source app, file
   size, formatting) — copy that habit: "MER not found in the building list"
   beats a bare "1 event skipped."
3. **Treat file size / source app as real constraints to design around**, not
   edge cases: cap what we accept, and don't assume every registrar/personal
   calendar export is well-formed.
4. **Design has to work at phone width** — Google's own product doesn't even
   try (Import and Subscribe-by-URL are flatly desktop-only in Google
   Calendar itself). Our app is phone-first per the walk feature it's
   extending, so if we do this better than Google, phone-width import support
   is itself a differentiator worth calling out, not just a viewport to
   test.
5. **Confirmation should be explicit, not implicit.** Google leans on "the
   event just appears" as its whole confirmation model even on desktop. A
   one-line "Imported 6 classes → MAI, WEL, GDC, PAI, UTC, GSB. MER not
   matched." toast/banner is a strictly better UX than what Google ships.

## File inventory (`shots/import/bar-google/`)

All ten are cited above; nothing extra was left in the folder.

- `signin-account-chooser-desktop.png` / `-phone.png` — what `calendar.google.com`
  shows signed-out (context for why this recon used Help Center pages instead
  of the live app).
- `import-help-steps-desktop.png` / `-phone.png` — Import & Export flow.
- `subscribe-url-help-steps-desktop.png` / `-phone.png` — Subscribe-by-URL flow.
- `create-event-help-steps-desktop.png` / `-phone.png` — manual create-event flow.
- `import-errors-help-desktop.png` / `-phone.png` — the four documented
  import error strings, expanded.
