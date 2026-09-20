# Phone check — does the phone show the real buildings?

**Device gate: UNVERIFIED.** Everything in `docs/mobile-real-buildings.md` was
measured on an emulated phone in desktop Chrome (390x844, DPR 3, touch). No
iPhone was available. This is the check to run on one, after the fix is merged
and live on https://flyover-utx.vercel.app/.

Do NOT clear the site's data first. The point is that a phone which was stuck
on the old buildings gets out by itself.

## What "right" looks like

- **The Standard** (715 W 23rd St, West Campus): one building with a W-shaped
  plan and dark window bands — not two separate plain pillars.
- **Campus around the Tower**: pitched red-tile roofs, not flat red lids.
- **The address bar**: the plain address. No `lite=`, `slopes=`, `preset=` or
  `campuslandscape=` in it, ever, after the city has loaded.
- **No notice** saying "Simplified buildings" (unless a step below asks for it).

## iPhone Safari (about 5 minutes)

1. **The old link.** If you have a home-screen icon or bookmark for the site,
   open it. Otherwise open the site from the address bar. Wait for the city
   (about 30 s). → Real buildings, clean address bar.
2. **Short visits.** Close the tab about 10 s after the city appears. Open the
   site again. Do this **three times**. → Real buildings every time.
   (Before the fix, the third visit was the old buildings, for good.)
3. **Reloads mid-load.** Open the site and tap reload while the loading screen
   is up. Three times. Then let it load. → Real buildings.
4. **App switch mid-load.** Open the site, switch to another app while the
   loading screen is up, wait 10 s, come back. → It finishes; real buildings.
5. **Rotate.** Turn the phone to landscape and back. → Still real buildings.
5b. **Long background.** With the city loaded, switch to the camera or a game
   for a few minutes, then come back. → Either the city is exactly as you
   left it, or the loading screen comes back by itself within a few seconds
   and ends in the real buildings. Never a city with missing buildings.
   (If the phone took the graphics memory back, the page reloads itself; a
   second time within 10 minutes it shows a "Graphics were reset … Reload
   city" card instead.)
6. **The fallback, on purpose.** Open
   `https://flyover-utx.vercel.app/?lite=safe`. → Plain blocks, and a card at
   the top: "Simplified buildings … Load full city". Tap **Load full city**. →
   The page reloads with the real buildings and `lite=safe` is gone from the
   address bar.
7. **The old stuck address.** Open
   `https://flyover-utx.vercel.app/?slopes=0&campuslandscape=0&preset=performance&lite=safe`
   (what the old version wrote into a stuck phone's address bar). → Real
   buildings by itself, and the address bar becomes the plain address.

## Chrome on iPhone

Same WebKit engine, separate storage. Repeat steps 1, 2, 5b and 6.

## If something is wrong

- Screenshot it **with the address bar visible**.
- Note which step and roughly how long the loading screen took.
- If Safari shows "A problem repeatedly occurred" or Chrome "Can't open this
  page": that is the phone running out of memory. After two of those the site
  switches itself to plain blocks **and says so on screen** — note that the
  card appeared, then tap Load full city once to see if it survives.
- Optional, with a Mac: Safari > Develop > [iPhone] > the page, then in the
  console `LITE_PROFILE` and `localStorage['flyover.boot']` show what the
  phone decided and why.
