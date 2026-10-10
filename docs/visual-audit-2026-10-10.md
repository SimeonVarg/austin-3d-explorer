# Visual audit, 2026-10-10

Draft pull request from `mac/visual-audit`. Auditor: one Sonnet 5.5 agent. Six Haiku 5.5 helpers read code, one narrow question each (loader and intro, graphics menus, controls and modes, walk and schedule screens, finder/panels/terms/credits and tool-name strings, CSS token inventory); I checked what they reported against the files before using it, and three of their claims were wrong (see section 6). Pictures were taken on the owner's laptop lane (RTX 3050 Ti for desktop; software drawing for phone, because the hardware phone run could not start WebGL) and on the live site for the terms page and the 404. Every finding went to a judge: Astra for design questions, the free school ChatGPT member for plain "fix it?" ones (section 5 says which). The judge decides. This pull request does what they said: FIX verdicts are implemented, one commit per finding, each naming its id; OWNER'S TASTE items are listed in section 5 and nothing was changed for them; LEAVE items are only recorded.

## 0. In plain words

* Most of what turned up is small and now fixed: copy written for the builders ("run the data pipeline", a URL flag in a notice, "this phone" on a laptop, build tools named on the terms page), panels that cover each other (the mode pill over the graphics menu, Explore over the graphics sheet on a phone, the hint over the credits link), a keyboard that stopped working after one click (G, P and T), a focus ring nobody could see, and touch targets far under the app's own 44 px floor.
* One was a real hole. When a browser cannot start WebGL, the loading card sat at "Map: surveying the site, 20 percent" with the clock counting (155 seconds in my picture) and no word on what was wrong. It now says "This map needs WebGL" and what to try (A09).
* Any mistyped or old link showed another product's white 404 page with a "debug prompt" link (A01). It is now a page in the app's own colours with one way back to the map.
* The apartment compare panel no longer opens on The Standard and flies you there (B22). After a comparison it opens on the apartment with the shortest walk.
* Nothing about the look of the loading screen, the Explore button, the navy "Switch modes" pill, the cream compare card or the loader's jokes was changed. Those are yours (section 5).
* Important limit: I could not photograph everything. The tablet width has no pictures at all, and the walk, importer, compare, loading-stage and failure screens were only read from code (the script that photographs them is written and tested; its runs were still waiting for a machine when I stopped). The fixes were checked by syntax, by `harness-drift.mjs` and by the "before" pictures; their "after" pictures were requested and had not landed. Section 6 lists it all.

## 1. Route map

Every route a visitor can reach, from `index.html`, `js/*.js`, the three stylesheets and `terms.html`. "How" is the URL or the gesture. "Pictures" says which widths and looks the audit photographed (P = phone 390, T = tablet 820, D = desktop 1440; day / golden / night where it matters). A route marked "code only" could not be photographed and the reason is in section 6.

| # | Route / state | How a visitor reaches it | Pictures |
|---|---|---|---|
| R01 | First paint veil (brown, three bars, title) | every load, before scripts | boot series |
| R02 | Loading card, stage by stage (Map, Paperwork, Buildings, Lighting, Sidewalks; percent; time line) | every load | P T D, 0.2 s to 25 s |
| R03 | Loading card, slow copy (after 40 s desktop, 50 s phone) | slow network | P T D (1.2 Mbps, 180 ms) |
| R04 | Data files fail ("some flaked") | blocked `/data/` | P T D |
| R05 | No WebGL | browser without WebGL | P T D |
| R06 | WebGL context lost (reload dialog) | graphics reset | P T D |
| R07 | Graphics-acceleration-off notice (`?gpuhint=1`) | software drawing | P T D |
| R08 | Phone "Simplified buildings" / "Lighter city" notice (`?lite=safe`) | two boot crashes, low memory, URL | P T D |
| R09 | Reveal, then the 12 s intro flight | default | P T D, +1 s to +22 s |
| R10 | Title bar (HUD), controls hint, "Switch modes" pill | after reveal | P T D day/golden/night |
| R11 | Free roam with chrome: Explore button + panel + visit | click Explore | P T D day/golden/night |
| R12 | Time-of-day slider, sun/moon marks, play button, playing state | right edge | P T D day/golden/night |
| R13 | Graphics menu (presets, four groups, 20 rows, footer), each preset, scrolled | gear button, key G | P T D day/golden/night |
| R14 | Recommendations box (empty, filled, status lines) | speech-bubble button | P T D day/golden/night |
| R15 | Mode dialog "Where to?" (8 modes, time, graphics, Send it) | "Switch modes" pill | P T D |
| R16 | Keyboard focus walk (Tab order, ring) | Tab | P T D |
| R17 | Keys: G, P (photo mode), T (tour), R, Shift+D (debug box) | keyboard | P T D |
| R18 | Map attribution control, "Terms and credits" link | bottom-right "i" | P T D |
| R19 | `?clip=1`, `?clip=1&drive=1`, `?timelapse=1`, `?autopilot=1`, `?sliderdemo=1`, `?tour=1` | URL (the mode dialog builds these) | P T D |
| R20 | `?lite=1`, `?lite=0`, `?debug=1`, `?preset=` x4 | URL | P T D |
| R21 | Labels: building names, `?labels`, `?namelabels`, `?entlabels`, `?placelabels` | URL / default | P T D |
| R22 | Walk to class: button, sheet, typing, not-found, route card, details | `?walk=1`, key `/` | P T D |
| R23 | Walk deep link `?walk=1&from=WEL&to=GDC` | URL | P T D |
| R24 | "My day" panel, class check ("CHECK THIS CLASS") | after a schedule is saved | P T D |
| R25 | Schedule importer: Google, Apple, UT, Photo tabs; result, rejects, not-a-calendar | "Import my class schedule" | P T D (synthetic files) |
| R26 | Schedule privacy footer, Delete my schedule | walk sheet footer | P T D |
| R27 | Apartment compare (`?livehere=1`): panel, example week, compare, hide / toggle, import | URL; mode dialog "Apartment hunt (beta)" | P T D |
| R28 | Terms and credits page | attribution link | P T D |
| R29 | Unknown URL (404) | mistyped link | P T D (live site) |
| R30 | Live buses and route search | no UI: `js/transit-live.js` and `js/transit-route.js` are not loaded by any page | code only |
| R31 | `?finder=1` | does not exist in the code (the owner's word for the apartment compare or the walk sheet); the page loads as a normal visit | P T D |
| R32 | `_harness.html` | deployed with the site (test page, not linked) | code only |
| R33 | Reduced-motion visit | system setting | P T D |


## 3. Findings and verdicts

Picture paths are under `~/flyover-private/visual-audit-2026-10-10/` (`base/` = before, on main plus the walker; `live-static/` = the live site); the few the PR cites are copied into `docs/visual-audit-2026-10-10/`. Verdict is the judge's (Astra, or the school ChatGPT member for plain yes/no ones, as noted in section 5). FIX = fix it; TASTE = the owner's choice, nothing changed; LEAVE = nothing to do. Status says what this pull request did.

| id | route | widths | what is wrong | sure | verdict | reason | status | picture |
|---|---|---|---|---|---|---|---|---|
| A01 | R29 unknown URL | P T D | Any mistyped or old link shows the host's stark white default 404 with 'Go back', a request id and 'View documentation / Copy debug prompt', and no way back to the map. | certain | FIX | Serve a branded 404 with a back-to-map link. | done | live-static/err-404-*.jpg |
| A02 | R28 terms page | P T D | Terms page line 'The data is prepared with DuckDB, tippecanoe, Shapely, Pillow and Requests' names build tools in public copy. | certain | FIX | Delete the build-tool sentence; keep source credits and licences. | done | live-static/terms-* |
| A03 | R28 terms page | P T D | Terms call the app 'Austin 3D Explorer (also called Flyover)' and credit 'Flyover by Simeon Varghese'; elsewhere only 'Austin 3D Explorer'; page says 'the owner' where the app says 'we'. | certain | OWNER'S TASTE | Consistent branding, or keep Flyover as an explicit alias; formal legal wording is acceptable. | left | live-static/terms-0-* |
| A04 | R28 credits | P T D | Seven credit lines (UT register, Wikipedia, Wikimedia Commons, StratMap, USGS/NAIP, Esri, Noto Sans) have no link while others do. | certain | LEAVE | Unlinked credits are not inherently broken; link only where attribution requires. | left | live-static/terms-end-* |
| A05 | R18 attribution | P T D | The only route to Terms and credits is the small attribution control; nothing else links to it. | certain | LEAVE | Conventional place; another control adds clutter. | left | base/chrome-desktop/attrib-open-desktop.jpg |
| A06 | R01-R02 loader | P T D | During load the visitor sees brown veil, then navy card, then brown map controls. | medium | OWNER'S TASTE | Keep the brown-to-navy hand-off or recolour the veil to the approved navy. | left | base/boot-* |
| A07 | R02/R15 loader copy | P T D | Loader and mode-dialog copy has slang and in-jokes ('some flaked', 'Sorry in advance', 'Nobody's grading this one', 'Wallpaper material', 'Still building'). The code marks it owner-approved 2026-09-28. | certain | OWNER'S TASTE | Playful or plain copy; keep the approved 'As usual.' | left | base/chrome-phone/ui-day-main-phone.jpg |
| A08 | R04 data failure | D | With no snapshot manifest the HUD line read 'No snapshot found — run the data pipeline first' (developer copy). | certain | FIX | Replace with plain 'Map data is unavailable. Please try again later.' | done | (code) |
| A09 | R05 no WebGL | P | When the map cannot get a WebGL context the loading card sits on 'Map: surveying the site, 20%' with the clock running (155 s) and no explanation. | certain (seen) | FIX | Say 'This map needs WebGL. Try another browser.' | done | base/chrome-phone/ui-day-main-phone.jpg |
| A10 | R09 intro flight | P T D | The 12 s opening flight ignores prefers-reduced-motion and has no visible skip. | certain | FIX | Skip the flight under reduced motion; a skip control otherwise. | done-partly | (code) |
| A11 | R02 loader | P T D | Loader caption/eyebrow/footer text 8 to 11 px. | certain | FIX | 12 px named minimum. | done | base/chrome-phone/ui-day-main-phone.jpg |
| A12 | index.html viewport | P T | Viewport tag blocks pinch-zoom and has no viewport-fit/safe-area insets for a notch or home bar. | certain (tag); notch effect inferred | FIX | Safe-area only; defer page-zoom change until iOS can be tested (second ask D02). | done-partly | (code) |
| A13 | style.css dead rules | - | About 140 lines of CSS for an old loader (#veil-load, #vl-*) and #date-panel/#diff-banner match no element. | certain | LEAVE | No visible effect; remove in maintenance. | left | (code) |
| A14 | R08 phone notice | P | The phone notice showed the raw URL flag '(lite=safe)'. | medium | FIX | Describe the mode without URL syntax. | done | (code) |
| B01 | R17 keys | D | G, P and T did nothing once a button or slider had keyboard focus. | certain | FIX | Allow from buttons and sliders; keep suppression in text fields. | done | (code) |
| B02 | R13 graphics menu | D | Escape closed the recommendations box but not the graphics menu beside it. | certain | FIX | Escape closes the graphics menu. | done | (code) |
| B03 | R17 keys | D | G also fired on Ctrl/Cmd+G ('find next'). | certain | FIX | Ignore with Ctrl/Cmd/Alt held. | done | (code) |
| B04 | R13 toast | P | Slow-device toast said 'Press G to change' on phones, which have no G key. | certain | FIX | Point at the Graphics settings button. | done | (code) |
| B05 | R10 hint | P D | Desktop hint omits G; phone hint omits reset/photo/tour and the phone has no on-screen reset. | certain | FIX | Add G to the desktop hint and a touch reset button. (Second ask D03: the touch reset button is the owner's taste.) | done-partly | base/chrome-desktop/ui-day-main-desktop.jpg |
| B06 | R12 play button | D | Play button used text glyphs among drawn icons and its label stayed 'Play' while playing. | certain | FIX | Pause label while playing; glyphs stay. | done | base/chrome-desktop/ui-day-tod-playing-desktop.jpg |
| B07 | R13/R14 close marks | D | Panel close marks were 15 px targets, and two glyphs (✕ and ×) are in use. | certain | FIX | 34 px target parameter; glyph difference can stay. | done | base/chrome-desktop/ui-day-gfx-top-desktop.jpg |
| B08 | R11 Explore | P T D | Explore is a near-black rectangle (14 px radius, system-ui) among round icon buttons and brown glass pills; turns brown on hover; does not fade in flight. | certain | OWNER'S TASTE | Keep a distinct launcher or adopt the brown glass pill and flight fade. | left | base/chrome-desktop/ui-day-main-desktop.jpg |
| B09 | all panels | D | Three golds in use: #f5a623, #ffc663, #f6b85e. | certain | LEAVE | Related shades distinguish surfaces; keep the loved loader. | left | (code) |
| B10 | all panels | D | Panel opacity and radius differ between sibling panels (.86 / .88 / .93 / .50 / .72; 10 / 12 / 14 / 16 / 24 px). | certain | LEAVE | Different roles justify different values. | left | (code) |
| B11 | R13/R14 buttons | D | Gear rotates on hover, bubble lifts. | certain | LEAVE | Harmless. | left (but F02 changed the gear to lift anyway) | (code) |
| B12 | R14 recommendations | P T D | Button says 'Send' but only opens the email app. | certain | FIX | Rename to 'Open email'. | done | base/chrome-desktop/ui-day-feedback-filled-desktop.jpg |
| B13 | R13 readouts | D | Some sliders show raw decimals, others units; footer uses 'x' for '×'. | certain | LEAVE | Understandable and harmless. | left | base/chrome-desktop/ui-day-gfx-top-desktop.jpg |
| B14 | R24 day panel | D | 'Crosses 1 signalised crossings'. | certain | FIX | Singular for one crossing. | done | (code) |
| B15 | R22-R24 walk copy | P T D | British spellings 'signalised', 'Kerbs' in a US app. | certain | OWNER'S TASTE | US or British spelling. | left | (code) |
| B16 | R26 delete schedule | P T D | One tap wipes the saved schedule; a confirm exists but is switched off. | certain | LEAVE | (Second ask D01) The brief asked for one tap; re-import is quick. | left | (code) |
| B17 | R25-R26 schedule copy | P T D | Four words for removal and four phrases for where data lives, incl. 'this phone' shown on laptops. | certain | FIX | Standardise storage claims to 'in this browser'. | done | (code) |
| B18 | R26 privacy line | P T D | 'Never uploaded anywhere' did not mention that a calendar link contacts its provider. | certain | FIX | Say so. | done | (code) |
| B19 | R23 deep link | D | A ?walk deep link shows nothing if the path data fails to load. | certain | FIX | Show a message. | done | (code) |
| B20 | R22 walk sheet | D | Clear mark and example chips react to mousedown only. | certain | FIX | Make them work from the keyboard. | done | (code) |
| B21 | R25 importer | P T D | A failed picture read said 'could not be read on this device' whatever the cause. | certain | FIX | Neutral message. | done | (code) |
| B22 | R27 compare | P T D | The compare panel opened on The Standard and flew there; the owner said it must not be the default. | certain | FIX | Open with no home selected; D04: after comparing, select the shortest walk. | done | (code) |
| B23 | R27 compare | P T D | The compare card is cream paper and terracotta, a third visual language. | certain | OWNER'S TASTE | Keep or adopt brown glass. | left | (pictures pending) |
| B24 | R21 labels | D | Canvas name labels use Arial; some read just 'Building 1'. | certain | LEAVE | Harmless; names need verifying. | left | (code) |
| B25 | R18 attribution | P T D | Attribution text 10 px at .5 alpha. | certain | LEAVE | Measure first. (Later superseded by E05.) | superseded by E05 | base/chrome-desktop/ui-day-main-desktop.jpg |
| D01 | R26 |  | B16 recheck with the one-tap brief. |  | LEAVE | Keep one-tap deletion. | left |  |
| D02 | A12 |  | A12 recheck: zoom change vs safe-area. |  | FIX | Safe-area only. | done |  |
| D03 | B05 |  | Touch reset button. |  | OWNER'S TASTE | Convenient reset button vs fewer controls. | left |  |
| D04 | B22 |  | Rule for the compare panel's opening state. |  | LEAVE | Open unselected, then pick the shortest walk after compare. | left (agreed) |  |
| E03 | R13 desktop | D | 'Switch modes' pill overlaps the bottom corner of the open graphics menu by 11 px at 1440x900. | certain | FIX | Hide the pill while the menu is open. | done | base/chrome-desktop/ui-day-gfx-top-desktop.jpg |
| E04 | R16 focus | D | Gear, bubble and play buttons and credit links show only a thin near-black default focus ring that vanishes on dark glass. | certain | FIX | One named gold focus ring. | done | base/chrome-desktop/focus-02-desktop.jpg |
| E05 | R18 attribution | D | Credits (and the only Terms link) are 10 px at .5 alpha over the bright city. | certain | FIX | Named dark background and larger amber text. | done | base/chrome-desktop/ui-day-main-desktop.jpg |
| E06 | R17 Shift+D | D | Shift+D opens a developer box 'Color by height source' over the map labels. | certain | LEAVE | Hidden diagnostic is harmless. | left | base/chrome-desktop/key-shiftd-desktop.jpg |
| E07 | R13 graphics menu | D | Graphics menu uses 9 to 10.5 px text for notes, hints, readouts. | certain | FIX | 12 px named minimum. | done | base/chrome-desktop/ui-day-gfx-top-desktop.jpg |
| F01 | R11 Explore | D | Explore button unlike its siblings (see B08). | certain | OWNER'S TASTE | Distinct launcher or matching warm glass. | left | base/chrome-desktop/ui-day-main-desktop.jpg |
| F02 | R13 gear | D | The graphics button is a sun, the same drawing as the time-of-day slider's sun. | certain | FIX | Distinct settings symbol (done as three sliders rather than a cog: the menu is sliders). | done | base/chrome-desktop/ui-day-main-desktop.jpg |
| F03 | R02/R15 navy vs brown | D | The loader, Switch modes pill and mode dialog are navy; map controls are brown. | certain | OWNER'S TASTE | Keep navy for mode controls or recolour. | left | base/chrome-desktop/modes-dialog-desktop.jpg |
| G01 | R10/R18 phone | P | On a phone, before the first touch, the open map-credits bar sits under the controls hint, so 'Terms and credits' (11 px tall) cannot be tapped. | certain (measured and seen) | FIX | Hint above credits (done instead by folding the credits into the 'i' button at load on a phone). | done | base/chrome-phone-sw/ui-day-main-phone.jpg |
| G02 | R11/R13 phone | P | On a phone Explore opens on top of an open Graphics sheet; the two are readable through each other. | certain (seen) | FIX | Explore closes Graphics and Recommendations on phones. | done | base/chrome-phone-sw/ui-day-explore-phone.jpg |
| G03 | R13/R14/R15 touch | P T | Menu footer buttons, preset buttons, recommendation fields and the mode pill are 24 to 39 px on touch screens, below the app's own 44 px floor. | certain (measured) | FIX | Named 44 px touch minimum. | done | base/chrome-phone-sw/ui-day-feedback-phone.jpg |
| H01 | R01 veil, reduced motion | P T D | The first-paint veil mark fades in over 1.2 s regardless of reduced motion. | certain | FIX | Disable the live veil-mark animation under reduced motion; leave unused rules. | done | (code) |
| H02 | all buttons | D | Hover/press transitions are 0.12, 0.14 or 0.15 s on near-identical buttons. | certain | LEAVE | Imperceptible. | left | (code) |
| H03 | R27 compare | P T D | Compare toggle and map home labels get no focus ring. | certain | FIX | Extend the gold focus ring (the font stack is harmless). | done | (code) |
| H04 | name-labels.js | - | Dead references to #finder-tray and #compare-tray. | certain | LEAVE | No visible effect. | left | (code) |
| H05 | R22/R25 touch | P T | Walk sheet and importer controls are 24 to 38 px on touch screens (clear mark 26, close 30, chips 24, rows 34, tabs 32...). | certain (CSS) | FIX | One named 44 px touch rule. | done (style.css controls; the day panel and confirm screen are styled from JS strings and were not changed) | (code) |
| H06 | R22/R25 fields | P T D | Walk and importer text fields show focus only as a border colour change. | certain | FIX | Gold focus ring on keyboard focus. | done (style.css fields; JS-injected fields not changed) | (code) |
| H07 | R22-R27 copy | P T D | Vague or em-dash-heavy walk and compare copy ('Something about this class was never checked.', 'More room for the city', 'Saved — but this map cannot walk there'). | certain | OWNER'S TASTE | Clearer literal wording is the owner's call. | left | (code) |
| H08 | R30 buses and route search | - | Finished live-bus and route-search code that no page loads, so no screen exists. | certain | LEAVE | Outside a visual audit; confirm scope with the owner before wiring. | left | docs/transit-live.md |

## 4. Summary

| | count |
|---|---|
| Routes mapped | 33 (section 1) |
| Findings (each with a verdict) | 58, plus 4 follow-up re-asks (D01 to D04) that changed three verdicts' scope |
| FIX, done | 32 |
| FIX, partly done | 3 (A10: reduced motion done, a visible skip control not added because any touch or key already ends the flight; A12: safe-area done, page-zoom change deferred by the judge until it can be tested on iOS; B05: G in the hint done, touch reset button is the owner's taste, D03) |
| FIX, not done | 0 |
| OWNER'S TASTE (nothing changed) | 9: A03, A06, A07, B08, B15, B23, F01, F03, H07 (D03 is the same choice as B05's second half) |
| LEAVE | 14 |
| Helpers | 6 Haiku 5.5 (code reading only) |
| Judge questions | 8: Astra 5 (A, B1, B2, D, F) and the school ChatGPT member 3 (E, G, H); the answer files are in `~/flyover-mail/council/2026-10-10-va-batch-*` |
| Pictures taken | desktop 44 + phone 59 (software drawing; 25 more from a failed hardware attempt) + live-site terms and 404 at three widths |

## 5. For the owner to judge (nothing was changed for these)

Each has a picture. Paths are under `~/flyover-private/visual-audit-2026-10-10/`; the ones the PR cites are also in `docs/visual-audit-2026-10-10/`.

| id | the choice | picture |
|---|---|---|
| B08 / F01 | The Explore button is a near-black rounded rectangle among round icon buttons and brown glass pills; it turns brown on hover and does not fade while you fly. Keep it as a distinct launcher, or restyle it as a brown glass pill. | `docs/visual-audit-2026-10-10/desktop-main-before.jpg`, `g01-phone-main-before.jpg` |
| F03 / A06 | The loading card, "Switch modes" pill and the mode dialog are navy; every map control is brown; the first-paint veil is brown. Keep (you love the navy loader) or bring the pill and dialog into brown. | `docs/visual-audit-2026-10-10/f03-mode-dialog.jpg`, `desktop-main-before.jpg` |
| A07 | Loader and mode-dialog jokes: "some flaked", "Sorry in advance", "Nobody's grading this one", "Wallpaper material", "Still building". The code marks them owner-approved 2026-09-28. | `docs/visual-audit-2026-10-10/a09-stuck-loader-before.jpg`, `f03-mode-dialog.jpg` |
| A03 | The terms page says "also called Flyover" and "the owner"; the app says "Austin 3D Explorer" and "we". | `docs/visual-audit-2026-10-10/a03-terms-phone.jpg` |
| B15 | US ("signalized", "curbs") or British ("signalised", "kerbs") spelling in the walk copy. | text only |
| B23 | The apartment compare card is cream paper and terracotta: a third look beside brown glass and navy. | not photographed (section 6) |
| H07 | Vague or dash-heavy walk and compare lines ("Something about this class was never checked.", "More room for the city"). | text only |
| D03 | A small round Reset button on touch screens (the phone has no way to re-centre except reloading). | `docs/visual-audit-2026-10-10/g01-phone-main-before.jpg` |

## 6. What I could not look at, and what I got wrong on the way

* **Tablet (820 px): no pictures.** The laptop lane had one long job from another lane running for over an hour; my tablet jobs waited behind it. The script and the jobs are ready (`visual-audit.mjs chrome|all --vp tablet`).
* **Phone: only the graphics, feedback, Explore, clock, keys and mode-dialog group.** My first phone run used the laptop's real graphics card and Chrome could not start WebGL in phone mode (the picture is in `a09-stuck-loader-before.jpg`: that failure is how A09 was found); the second used software drawing and worked.
* **Walk sheet, schedule importer, "My day", privacy footer, apartment compare, the loading card stage by stage, slow network, failed data, no-WebGL (other than the accidental one), context lost, notices, `?clip` `?timelapse` `?autopilot` `?sliderdemo` `?tour` `?lite` `?debug` `?preset`, labels routes, reduced motion at any width: written into `scripts/verify/visual-audit.mjs`, tested only on the terms page and 404, and not photographed.** Their findings in the table are read from code and marked "(code)" in the picture column; the judges decided on those descriptions.
* **"After" pictures for the fixes.** I requested two runs (`va-after-chrome-desktop`, `va-after-static`) on the laptop and they had not started when I stopped. What is checked: JavaScript syntax for every file I touched (`schedconfirm.js` fails the same check on main, so that check is not meaningful for it), `harness-drift.mjs` passes. What is not checked in a browser: every CSS change here (focus ring, touch floors, credits sizes, loader caption sizes, the sliders icon), the WebGL card (fired only by the MapLibre error text I saw in one run; the "no WebGL" boot step that would exercise it was not run), the keyboard changes, the compare panel's new opening, and the phone credits folding at load. Treat all of them as unseen until the after pictures or the PR checks say otherwise.
* **A real notch or home bar (A12) and iPhone Safari page zoom.** No device here.
* **Live buses and route search (R30):** no screen exists; `js/transit-live.js` and `js/transit-route.js` are not loaded by any page. `?finder=1` does not exist either; the nearest things are the walk sheet (`?walk=1`) and the compare panel (`?livehere=1`). `_harness.html` is deployed with the site (not linked).
* **Mistakes by the helpers that I corrected:** one said result rows in the walk sheet cannot be reached by keyboard (they can, with the arrow keys; only the clear mark and chips could not, B20); one said "there is no PDF import" and no offline state, which is right, but also listed live bus screens that do not exist; the CSS helper's example of "a pure-white panel against translucent navy" does not exist in the code.
* **A command I should not have run:** to cancel my own laptop-lane job I ran `pkill -f "acer-run.py check"`, which can match other lanes' client processes. One other check (`packverts-pixels.mjs`) was still running afterwards; I cannot prove I did not end another lane's client. If someone's check printed "terminated" around 04:29 laptop time, that was me.
* **The Acer** answered `ssh` at 04:07 laptop time (it had been unreachable at the start). It was in use (about 20 Chrome processes, free memory under 2 GB), so I used only the lane's one-browser queue, never directly.
* **AWS:** one dispatch (`aws-va1`) was waiting on the other lanes' lock when I stopped; nothing was spent on AWS.

## 7. Method, for the next audit

`scripts/verify/visual-audit.mjs` walks groups of routes (`boot`, `chrome`, `walk`, `modes`, `all`) at 390, 820 and 1440 widths, takes every picture twice (trust the second), and writes `metrics.json` with, per picture, every visible control's size, font, radius, colour and focus outline, text contrast, clipped text, off-screen text and overlaps between fixed panels. `~/flyover-private/visual-audit-2026-10-10/summ.py` turns that into a short list. It found, with no human looking: the 11 px overlap of the mode pill on the graphics menu, the invisible focus rings, the 9 to 10.5 px menu text, and the covered "Terms and credits" link. Run it with `acer-run.sh check --ref <branch> --gl hardware --check "visual-audit.mjs chrome --vp desktop --out {out}"`; use `--gl software` for phone and tablet.

