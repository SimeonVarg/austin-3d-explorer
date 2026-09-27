# Phone check — does the site survive on a real phone?

**Device gate: UNVERIFIED.** Everything in HANDOFF "Sep 24 2026" and "Sep 27
2026" and in `docs/mobile-real-buildings.md` was measured in desktop Chrome
pretending to be a phone (390x844, DPR 3, touch). No iPhone was available.
This page is the check to run on one, once the fix is live on
https://flyover-utx.vercel.app/ (about 15 minutes in all).

What is being checked, in plain words:

- the phone city stays small enough that the phone does not kill the page;
- if the phone kills it anyway, the page comes back **lighter**, and it never
  refreshes itself more than **once in ten minutes** — so Safari never reaches
  "A problem repeatedly occurred";
- if the phone takes the graphics memory back, the page either reloads itself
  once, or **pauses behind a "Reload to continue exploring" card** — never a
  city with missing buildings that you can still walk around in;
- walking up the Texas Union and Gearing Hall steps works on the phone.

## Before you start

- **Record the screen for every check** (Control Center > Screen Recording).
  A recording shows the refreshes and the cards that a screenshot misses.
- A normal Safari tab, not private. **Do not clear the site's data** — a phone
  that was stuck should get out by itself.
- Note the phone model and iOS version (Settings > General > About).

## Check 1 — the opening flight (the Sep 24 report, 3 minutes)

What was reported: the loading screen for ~15 s, then during the opening flight
the page refreshed, then Safari said **"A problem repeatedly occurred"**.

1. Open `https://flyover-utx.vercel.app/` in Safari. Wait through the loading
   screen and **watch the whole opening flight** (downtown, up over the city,
   north into campus, about 13 s). Then leave it alone for 30 s.
   - **Best:** the flight finishes, no refresh, real buildings.
   - **Acceptable:** it refreshes **once** and comes back **at West Campus
     without the flight**, with a card at the top: **"Lighter city … Load full
     city"**. That is the phone running out of memory and the site stepping
     down by itself.
   - **Wrong:** "A problem repeatedly occurred", or more than one refresh.
2. Close the tab, open a new one, same address. → The same ending as step 1:
   the full city, or the lighter one with its card. Never the error page. (After
   a step down the site keeps the lighter city for an hour, then tries the full
   one again by itself.)
3. If you got the card, tap **Load full city**. → It tries the full city once.
   If the phone really cannot hold it, it goes back to the lighter city by
   itself — still never the error page.
4. Rotate to landscape and back while the city is up. → Nothing reloads.

## Check 2 — crashing twice ends lighter, not in a loop

You cannot crash a phone on purpose; this is what to look for if it happens.

- **One crash** (in check 1 or any time the page dies while loading): the next
  load is the **lighter city** with its card.
- **Two crashes**: the next load is **plain blocks** with a **"Simplified
  buildings … Load full city"** card. Plain blocks are the last fallback.
- If Safari's error page does appear, tap Reload on it: you must land on the
  lighter city or plain blocks, not on the error page again.
- In no case does the page refresh itself twice in ten minutes. If it does,
  that is the bug: note the times.

## Check 3 — graphics reset while exploring (5 minutes)

1. With the city loaded, switch to the **Camera** app and record 30 s of video
   (or play a 3D game for two minutes). Come back to Safari.
   - **Fine:** the city exactly as you left it, **or** the loading screen
     comes back by itself once and ends in the real buildings.
2. Do it again within ten minutes of the first time.
   - **Fine:** the city as you left it, **or** a dark full-screen card
     **"Reload to continue exploring — The graphics were reset. Exploring is
     paused until the city reloads."** with one button, **Reload city**, and
     **no ×**. While the card is up, dragging or using the joystick behind it
     does nothing.
   - **Wrong:** a city with buildings missing (holes, floating roofs, the
     ground only) that you can still move around in, or a card you can close
     and then walk through that city.
3. Tap **Reload city**. → The loading screen, then the real buildings, and the
   joystick moves you again.

If the phone never takes the graphics memory back, check 3 shows nothing — say
so; that is a pass for this phone, not a skip.

## Check 4 — walking the campus steps (5 minutes)

On the phone: **joystick** (bottom left) to move, **swipe** to look, **two
fingers** up/down for height. Come down to walking height (people-sized: the
doors look like doors).

1. **Texas Union**, on the east side of Guadalupe at 24th (the lighter city
   starts a block west of it, facing away — turn around; from the full city,
   head west from the Tower). Walk up the raised approach and both flights of
   steps to the entrance.
   → You rise with each step and stay at eye height; you never sink into the
   steps or float above them, and you stop at the wall instead of passing
   through it.
2. **Gearing Hall**, the courtyard just west of the Tower. Walk up the
   courtyard stairs onto the terrace, then back down the ramp.
   → Same: up and down with the ground, no sinking, no floating.
3. Do check 4 again right after a **Reload city** from check 3, if you got the
   card. → Walking still works after the reload.

## What "right" looks like everywhere

- **The Standard** (715 W 23rd St, West Campus): one building with a W-shaped
  plan and dark window bands — not two plain pillars. (True on the full and the
  lighter city; only "Simplified buildings" shows plain blocks.)
- **Campus around the Tower**: pitched red-tile roofs, not flat red lids.
- **The address bar**: the plain address. No `lite=`, `slopes=`, `preset=` or
  `campuslandscape=` in it after the city has loaded.
- **At most one refresh by itself** in any ten minutes.

## The rest (about 5 minutes)

1. **The old link.** A home-screen icon or bookmark for the site → real
   buildings, clean address bar.
2. **Short visits.** Close the tab ~10 s after the city appears, open it again,
   three times. → Real buildings every time.
3. **Reloads mid-load.** Tap reload while the loading screen is up, three
   times, then let it load. → Real buildings, no card.
4. **App switch mid-load.** Switch apps while the loading screen is up, wait
   10 s, come back. → It finishes; real buildings.
5. **The fallbacks, on purpose.**
   - `https://flyover-utx.vercel.app/?litetier=lighter` → the lighter city
     (West Campus, no flight, real buildings). No card: you asked for it.
   - `https://flyover-utx.vercel.app/?lite=safe` → plain blocks and a
     "Simplified buildings … Load full city" card. Tap it → the real buildings,
     and `lite=safe` is gone from the address bar.
6. **The old stuck address.**
   `https://flyover-utx.vercel.app/?slopes=0&campuslandscape=0&preset=performance&lite=safe`
   → real buildings by itself, and the address bar becomes the plain address.

## Chrome on iPhone

Same WebKit engine, separate storage. Repeat checks 1, 3 and 4 and step 5
above. Chrome's error for a killed tab is "Can't open this page".

## Optional, with the Mac and a cable: force a graphics reset

Safari > Develop > [the iPhone] > the page opens a console for the phone's tab.

- `LITE_PROFILE.tierName` says which city the phone chose (`phone`,
  `lighter` or `safe`) and `LITE_PROFILE.reason` why.
- To force a graphics reset, paste
  `x=__map.painter.context.gl.getExtension('WEBGL_lose_context');x.loseContext();setTimeout(()=>x.restoreContext(),700)`.
  The first time the page reloads itself once; paste it again within ten
  minutes and the **Reload to continue exploring** card must appear, with
  `LITE_PROFILE.sceneUnavailable` reading `true`. Then do step 3 of check 3.

## If something is wrong

- Send the screen recording, or a screenshot **with the address bar visible**,
  plus the phone model.
- Note which check and step, roughly how long the loading screen took, and how
  many times the page refreshed by itself.
- To start clean afterwards: Settings > Safari > Advanced > Website Data,
  delete `flyover-utx.vercel.app`. (Not needed for any step above.)
