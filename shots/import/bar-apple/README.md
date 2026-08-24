# What is in this folder, and what is not

**Every image here is a screenshot of THIS app** — the Austin 3D Explorer's own
schedule-import screen, driven through the Apple Calendar subscription route,
photographed on the real `?walk=1` page at 390 × 844. That is why they are all
named `ours-*`. There is no picture of Apple Calendar in this folder.

The folder is called `bar-apple` because Apple Calendar's subscription flow is
the **bar** this screen is being judged against. The bar itself is not stored
here.

## Why there is no capture of Apple's real product

Apple Calendar is macOS and iOS software, not a website. This repo's harness
drives headless Chrome on Windows; it cannot open Calendar.app, and the recon
lane that tried to photograph Apple's support pages through a shared browser
pane hit a sandbox limit and, separately, found the pane navigating to sites it
had never asked for — so it abandoned pictures and quoted Apple's own support
guides verbatim instead. Those quotes, with the exact URLs, are in
`docs/import-bar-apple.md`. That is the bar, in text.

**Round 4 of this lane shipped these same frames under the names
`si-apple-add.png`, `si-apple-result.png` and `si-apple-error-blocked.png` in
this folder.** A reviewer opening `bar-apple/si-apple-add.png` would reasonably
read that as a capture of Apple Calendar. It was not. The honest note about it
existed — `NOTE.md`, in this folder — but nothing linked to it and the file
names contradicted it. Names win over notes, so the names changed.

If a later round obtains a genuine capture of Apple Calendar's New Calendar
Subscription sheet, name it `bar-*.png`, and say in this file where it came
from and when.

## The files

| file | what it shows |
|---|---|
| `ours-add.png` | the add screen, Apple tab — the subscription address first, the exported `.ics` second |
| `ours-error-blocked.png` | a real `webcal://p00-calendars.icloud.com/…` address, really refused by the browser, and the way round it |
| `ours-result.png` | what happened, after a real HTTP fetch of a published `.ics` feed end to end |
| `ours-panels.png` | the three panels above, side by side and cropped to the panel, for reading the type |

`ours-error-blocked.png` is not staged. The page really tried to `fetch()`
`https://p00-calendars.icloud.com/published/2/MTA5NDQ0NTU0` — the scheme swap
is the app's own — and iCloud's cross-origin policy really refused it. The
message names the host it could not read and points at the control that gets
round it.
