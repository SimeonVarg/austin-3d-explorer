# Apple Calendar's subscription flow — recon, no code touched

**Status: no real screenshot obtained.** Apple Calendar is desktop/iOS
software; this session has no Mac or iPhone to drive live, and the one tool
that can reach a real GUI (the Claude Browser pane) errored on every
`screenshot` call with "the Browser pane is not displayed, so the page is not
compositing frames" — a sandbox limit of this subagent, confirmed by trying
it four separate times against four different pages, at two different
viewport sizes, after fronting the tab each time. Partway through, that same
browser pane also started showing pages this session never navigated to
(`registrar.utexas.edu`, `enterprise.login.utexas.edu`) — it is shared with
another concurrent task in this environment, so nothing from it after that
point is trusted. See `shots/import/bar-apple/NOTE.md` for the detail.

What follows is Apple's own documented behaviour, read directly from
`support.apple.com`, quoted close to verbatim with the exact URL for each
claim — not an assumption and not a screenshot caption. Every quote below was
fetched twice by two different tools (`WebFetch`, a direct HTTP fetch; and
the Claude Browser's `get_page_text` before it got contaminated) and the two
copies matched, which is the closest this recon gets to independent
verification without a real device.

## Sources read

- `https://support.apple.com/guide/calendar/subscribe-to-calendars-icl1022/mac`
  — "Subscribe to calendars on Mac"
- `https://support.apple.com/guide/calendar/import-or-export-calendars-icl1023/mac`
  — "Import or export calendars on Mac"
- `https://support.apple.com/guide/calendar/refresh-calendars-icl1024/mac`
  — "Refresh calendars on Mac"
- `https://support.apple.com/en-us/102301` — "Use iCloud calendar
  subscriptions" (covers Mac, iPhone/iPad in one page; last published date on
  the page reads May 22, 2026)
- `https://support.apple.com/guide/icloud/share-a-calendar-mm6b1a9479/icloud`
  — "Share a calendar on iCloud.com" (the publisher side of a webcal link,
  read for completeness — not what a UT student would use, but it is where
  Apple's own webcal URLs come from)

## The flow itself

**Subscribing via a webcal:// or https://…ics link (Mac).** File → New
Calendar Subscription → paste the URL → Subscribe → name it, pick a color,
pick where it lives (iCloud, so it syncs to every device signed into that
Apple Account, or "On My Mac", local only) → choose an auto-refresh interval
→ OK. Apple's own shortcut, quoted directly: *"To subscribe to a calendar
from a link on the internet or an email you received, click the link. If you
do this, you can skip step 1, and the calendar's web address is filled out
for you."* That is the path a UT registration export actually takes if it's
delivered as a clickable link (email, or a "subscribe" button on a
registration page) rather than typed in by hand — no separate download step,
the OS's registered handler for `webcal:` opens Calendar straight into the
New Subscription sheet with the URL pre-filled.

**Subscribing on iPhone/iPad** is the same shape, App-native instead of
menu-native: Calendars button → Add Calendar → Add Subscription Calendar →
paste the URL → Find/Subscribe → name, color, and explicitly choose iCloud as
the account → Done/Add. (Apple's page gives two slightly different button
labels for iOS 26+ vs iOS 18 and earlier — "Find" vs "Subscribe" as the
button after entering the URL, "Tap Done" vs "choose iCloud from the Account
menu, then click Add" — same flow, worth knowing if screenshots ever get
matched against a specific OS version.)

**Importing a downloaded .ics file (Mac)**, the other path — drag the file
onto the Calendar app, or File → Import → pick the file → Import → choose
which calendar to add the events to → OK. This is what happens if UT's
registration export is a plain file download rather than a link Apple's
`webcal:` handler can intercept.

## What makes it distinctive next to Google Calendar

**A dedicated URL scheme with OS-level handling, not a paste-into-a-settings-page
flow.** Google Calendar's own equivalent (Settings → Add calendar → From URL)
requires the user to be inside Google Calendar's UI already and paste the
address themselves; Apple's `webcal://` is a registered URI scheme the whole
OS understands, so a link on a web page or in an email opens *directly* into
Calendar's subscription sheet with the address already filled in. For a
schedule-import flow, that means UT could in principle offer a plain "Add to
Apple Calendar" link that skips a copy-paste step Google can't skip — worth
noting as a later polish idea, not something to build this pass.

**`webcal://` vs `https://` is the same feed, and both sides accept the
swap.** Not from Apple's guide pages directly (they don't spell this out —
noted as a gap below) but confirmed by Apple's own "Share a calendar on
iCloud.com" flow existing at all: the public link iCloud hands you to share
your own calendar is a `webcal://` address, and third-party documentation
(not Apple's) consistently describes swapping the scheme to `https://` to
force a plain file download instead of a subscribe action, which is standard
`webcal:` behaviour, not an Apple quirk. **This matters directly for the
building work ahead**: if UT's registration export is served as a `webcal://`
link, the same URL almost certainly also resolves over `https://` — so a
browser-based "click here" import (Google Calendar's model) and Apple's
native subscribe can both point at the identical feed without UT needing to
publish two different links.

**Refresh is a client-side poll interval you set, not push, and Apple never
publishes the actual numbers.** Apple's own "Refresh calendars on Mac" and
"Subscribe to calendars on Mac" pages both describe an "Auto-refresh pop-up
menu" the user picks from, but neither page's text lists the actual choices
in that menu — it's a native dropdown, not itemized in the HTML. (Recalled
from general familiarity with the Calendar app, not confirmed today by a
fetched page, so not asserted as sourced: the menu is understood to offer a
small fixed set of intervals from every 5 minutes up to weekly, plus Never —
flagged here explicitly as unverified so nobody downstream treats it as
fetched fact.) Push only applies to full calendar *accounts* (iCloud,
Exchange) — a webcal subscription is always polled, never pushed, per the
same page: *"If you choose Push, the account is updated automatically... or
when someone makes a change to a shared calendar in that account"* is stated
only for the account-refresh section, not the subscription section. This is
the same shape as Google's behaviour — third-party sources (not Google's own
docs, and not independently re-verified this pass) report Google polls
subscribed ICS feeds on its own internal schedule, commonly described as
somewhere between 8 and 24 hours with no user-facing control and no
publisher-facing way to force it faster. If that holds, **neither Apple nor
Google gives a subscribed class schedule same-day visibility into a UT
registration change** — a swapped section shows up on the student's phone
whenever the OS next decides to poll, not when it happens. Worth flagging
back to whoever scopes the import feature: a subscription link is not a
substitute for "check now" if same-day accuracy is a promise being made.

**Conflicts and duplicates: Apple's documentation says nothing at all, in
either direction — not "it merges," not "it warns," nothing.** Read across
all five pages above, no sentence anywhere covers what happens if a
subscribed or imported event's UID matches something already on the
calendar, or what happens if the same feed is subscribed twice. The one
concrete fact from the import page, worth carrying forward because it will
bite the "one row into a database" design instinct: *"Importing a calendar
file removes the event's previous custom color"* — importing an .ics is
described as destructive to metadata Calendar itself is tracking, not a
transparent merge. This is a real gap in what "fetch Apple's flow for real"
could establish without a live device to actually create a duplicate and
watch what Calendar does with it — flagged here rather than guessed at.

**Subscriptions are read-only by design**, stated plainly on Apple's own
subscribe page: *"You can't edit calendars you are subscribed to (for
example, the Holidays calendar). If you want to use a calendar that several
people can edit, share it instead."* A class schedule delivered as a webcal
subscription is view-only forever on the Apple side — a student can't nudge
one class's time on their phone and have it stick locally the way they could
with an imported .ics turned into a local "On My Mac" calendar. That's a real
product fork for the schedule-import feature: subscribe-and-stay-synced
(read-only, auto-updating whenever UT changes something, on Apple's own
unpublished poll schedule) versus import-once (editable afterward, but a
snapshot that goes stale the moment UT changes a room or a time).

## What this means for the seam ("MAI 220, TTh 2:00pm" → building CODE)

Both of Apple's two paths — `webcal://` subscribe and `.ics` file import —
terminate in the same place: a standard ICS payload of `VEVENT` blocks, each
with a `SUMMARY`, a `LOCATION` string, and `DTSTART`/`DTEND`/`RRULE` for the
recurrence. Neither path gives the importer anything structured beyond that
— no separate "building" or "room" field, no guarantee `LOCATION` even
follows a parseable pattern (UT's own registrar page, read for the same
project earlier this session, formats meeting rooms as a three-letter
building code plus a room number, e.g. "MAI 220" — but a student's personal
calendar export could re-format or truncate that string in a way this recon
did not test, having no live device to actually generate one). Whatever the
Google Calendar and Apple Calendar recon legs converge on, the actual
extraction work — pulling a UT building code out of an ICS `LOCATION` field
— is identical regardless of which of the three import sources produced the
file; the three "flexible import" paths only differ in *how the ICS/webcal
payload arrives* (a subscribed live feed vs a downloaded snapshot vs,
someday, an OCR'd image or a Registration-Plus API response), not in what the
parser on the other end has to do with it. That is the seam worth building
against: one `parseScheduleText(icsOrRows) → [{code, days, start, end}]`
function fed by three different acquisition front-ends, so OCR or an API
integration later is a fourth front-end feeding the same function, not a
rewrite.
