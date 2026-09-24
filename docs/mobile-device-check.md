# Phone check — does the site survive on a real phone?

**Device gate: UNVERIFIED.** Everything in `docs/mobile-real-buildings.md` and
in HANDOFF "Sep 24 2026" was measured on an emulated phone in desktop Chrome
(390x844, DPR 3, touch). No iPhone was available. This is the check to run on
one, after the fix is merged and live on https://flyover-utx.vercel.app/.

Do NOT clear the site's data first. The point is that a phone which was stuck
gets out by itself.

## The Sep 24 check first: the crash during the opening flight (3 minutes)

What was reported: the loading screen for ~15 s, then during the opening flight
the page refreshed, then Safari said **"A problem repeatedly occurred"**.

1. **Open the site in Safari** (a normal tab, not private):
   `https://flyover-utx.vercel.app/`. Wait through the loading screen and
   **watch the whole opening flight** (downtown → up over the city → north into
   campus, about 13 s). Then leave it for 30 s.
   → **Best case:** the flight finishes, no refresh, real buildings.
   → **Acceptable:** it refreshes **once**, and comes back **at West Campus
   without the flight**, with a card at the top: **"Lighter city … Load full
   city"**. That is the phone running out of memory and the site stepping down
   by itself. Screenshot the card.
   → **Wrong:** "A problem repeatedly occurred", or the page refreshing more
   than once. Screenshot it and note the step.
2. **Open it again** (close the tab, new tab, same address). → Whatever step 1
   ended on, again: the full city, or the lighter one with its card. Never the
   error page. (After a step down the site keeps the lighter city for an hour,
   then tries the full one again by itself.)
3. **If you got the card: tap "Load full city".** → It tries the full city
   once. If the phone really cannot hold it, it goes back to the lighter city by
   itself — still never the error page.
4. **Rotate** to landscape and back while the city is up. → Nothing reloads.

If the error page ever does appear: tap Reload on it. The site should come
back with plain blocks and a **"Simplified buildings"** card. That is the last
fallback; note that it happened and which phone model it was.

## What "right" looks like

- **The Standard** (715 W 23rd St, West Campus): one building with a W-shaped
  plan and dark window bands — not two separate plain pillars. (True on the
  full and the lighter city; only "Simplified buildings" shows plain blocks.)
- **Campus around the Tower**: pitched red-tile roofs, not flat red lids.
- **The address bar**: the plain address. No `lite=`, `slopes=`, `preset=` or
  `campuslandscape=` in it, ever, after the city has loaded.
- **At most one refresh by itself**, ever, in any ten minutes.

## iPhone Safari, the rest (about 5 minutes)

1. **The old link.** If you have a home-screen icon or bookmark for the site,
   open it. Wait for the city. → Real buildings, clean address bar.
2. **Short visits.** Close the tab about 10 s after the city appears. Open the
   site again. Do this **three times**. → Real buildings every time.
3. **Reloads mid-load.** Open the site and tap reload while the loading screen
   is up. Three times. Then let it load. → Real buildings, no card.
4. **App switch mid-load.** Open the site, switch to another app while the
   loading screen is up, wait 10 s, come back. → It finishes; real buildings.
5. **Long background.** With the city loaded, switch to the camera or a game
   for a few minutes, then come back. → Either the city is exactly as you
   left it, or the loading screen comes back by itself within a few seconds
   and ends in the real buildings. Never a city with missing buildings.
   (If the phone took the graphics memory back, the page reloads itself once;
   a second time within 10 minutes it shows a "Graphics were reset … Reload
   city" card instead.)
6. **The fallbacks, on purpose.**
   - `https://flyover-utx.vercel.app/?litetier=lighter` → the lighter city
     (West Campus, no flight, real buildings). No card: you asked for it.
   - `https://flyover-utx.vercel.app/?lite=safe` → plain blocks and a
     "Simplified buildings … Load full city" card. Tap **Load full city** →
     the real buildings, and `lite=safe` is gone from the address bar.
7. **The old stuck address.** Open
   `https://flyover-utx.vercel.app/?slopes=0&campuslandscape=0&preset=performance&lite=safe`
   (what a much older version wrote into a stuck phone's address bar). → Real
   buildings by itself, and the address bar becomes the plain address.

## Chrome on iPhone

Same WebKit engine, separate storage. Repeat the Sep 24 check and steps 1, 5
and 6. Chrome's error for a killed tab is "Can't open this page".

## If something is wrong

- Screenshot it **with the address bar visible**, and say which phone model.
- Note which step, roughly how long the loading screen took, and how many
  times the page refreshed by itself.
- Optional, with a Mac: Safari > Develop > [iPhone] > the page, then in the
  console `LITE_PROFILE` (`tierName` is `phone`, `lighter` or `safe`; `reason`
  says why) and `localStorage['flyover.boot']` show what the phone decided.
- To start clean: Settings > Safari > Advanced > Website Data, delete
  `flyover-utx.vercel.app`. (Not needed for any step above.)
