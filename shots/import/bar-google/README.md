# What is in this folder, and what is not

**Every image here is a screenshot of THIS app** — the Austin 3D Explorer's own
schedule-import screen, driven through the Google Calendar route, photographed
on the real `?walk=1` page at 390 × 844. That is why they are all named
`ours-*`. There is no picture of Google Calendar in this folder.

The folder is called `bar-google` because Google Calendar's import flow is the
**bar** this screen is being judged against. The bar itself is not stored here.

## Why there is no capture of Google's real product

Google Calendar's import screen lives behind a signed-in Google account at
`calendar.google.com/…/settings/export`. Nothing in this repo has a Google
account, and driving one would mean putting somebody's credentials into a
headless browser. So the bar was read as documentation, not photographed:
Google's own "Import events into Google Calendar" help page, plus third-party
walkthroughs, are quoted in the recon notes rather than screenshotted.

**Round 4 of this lane shipped these same frames under the names
`si-google-add.png`, `si-google-result.png` and `si-google-error-zip.png` in
this folder.** A reviewer opening `bar-google/si-google-add.png` would
reasonably read that as a capture of Google. It was not; the admission sat in a
`NOTE.md` in the sibling folder that no document linked. That is why the names
changed and why this file exists at the top level of the folder instead.

If a later round obtains a genuine capture of Google Calendar's import screen,
name it `bar-*.png`, and say in this file where it came from and when.

## The files

| file | what it shows |
|---|---|
| `ours-add.png` | the add screen, Google tab — the two ways in and the `.zip` warning |
| `ours-result.png` | what happened, after importing a nine-event Google export through the real file picker |
| `ours-error-zip.png` | picking Google's actual `.zip` export by mistake, and the sentence that says so |
| `ours-panels.png` | the three panels above, side by side and cropped to the panel, for reading the type |

`ours-result.png` was produced by handing
`shots/si/ui/fixture-google-export.ics` to the page's own `<input type=file>`
— not by calling an internal function — so the sentence on the `(no room)` row
is the file path's sentence ("the export carried no location") and not the
paste path's.
