# Reading the visit numbers

The app counts visits with **Vercel Web Analytics**: first-party, no cookies,
free on this plan. This note is for whoever wants to read the numbers. The code
side is `js/analytics.js` (what it sends and why it is safe is in
`docs/si-privacy.md` §12.A).

## Turn it on first (one time, in the dashboard)

The code is live already, but nothing is counted until Web Analytics is switched
on for the Vercel project. In the Vercel dashboard: open the project, open the
**Analytics** tab, and enable **Web Analytics**. Until that switch is on, the
`/_vercel/insights/script.js` request 404s and no page views are recorded — this
is expected and breaks nothing.

- Live app: https://flyover-utx.vercel.app

The Vercel project and team identifiers are not kept in this public repo; they
live in the operator's local notes.

Data starts accruing from the moment it is enabled; it is not backfilled.

## What the numbers answer

The owner asked four questions. Web Analytics answers all four from a plain page
view, with no cookie and nothing the app knows about the person:

| Question | Where it comes from |
| --- | --- |
| How many people, how many views | visitors and page views |
| Where they come from (a LinkedIn post right now) | referrer hostname |
| Phone or desktop | device type |
| Which country | country (from the request, coarse) |

The event the app sends is only `origin + pathname`. The query string and hash
are stripped before it is sent, so no page or person can ride along in the URL.

## Reading the numbers

Once Web Analytics is on, read the numbers in the Vercel dashboard's Analytics
tab (or the same data via Vercel's own query interface). Set the date range to
cover the period since the LinkedIn post. Useful views:

- **Trend over time** — page views and visitors by day, for the trend since the
  post went up.
- **Referrer** (`referrerHostname`) — how much traffic LinkedIn is sending
  versus direct opens and other links.
- **Device** (`deviceType`) — phone versus desktop.
- **Country** (`country`) — where the visitors are.

Because everything the app sends is one origin + path, the page dimension will
be a single page; the interesting breakdowns are referrer, device and country.

## Reading them with the Vercel MCP tools

The lead can pull the same numbers without the dashboard. Every call needs the
project id and team id (in the operator's notes, not here) and a date range;
`since` should be the day Web Analytics was enabled, or the day of the post.

- Totals: `count_pageviews` for the range. Gives page views and visitors.
- Trend: `aggregate_pageviews` grouped by day. One row per day, page views and
  visitors, so the bump from the post is visible.
- Where they come from: `aggregate_pageviews` grouped by `referrerHostname`.
  LinkedIn shows as `www.linkedin.com` (and its short links as `lnkd.in`);
  opens with no referrer (typed, pasted, many phone apps) show as empty/direct.
- Phone vs desktop: `aggregate_pageviews` grouped by `deviceType`
  (`mobile`, `desktop`, `tablet`).
- Country: `aggregate_pageviews` grouped by `country` (two-letter codes).

If a call answers "Web Analytics not found", the dashboard switch is still off.
An empty result right after enabling is normal; data is not backfilled.

Things that make the numbers read low or high:

- Browsers opted out with `?va=off` are not counted (by design).
- Some ad and tracker blockers block `/_vercel/insights/` even on the same
  origin, so the true count is somewhat higher than reported.
- Links shared inside the LinkedIn app often open in its in-app browser; those
  still count, and usually still carry the LinkedIn referrer.
- One load is one page view: route changes inside the page are not counted
  again unless the path itself changes, and the app has one path.

## Confirming the live request is clean

`scripts/verify/analytics-check.mjs` proves the code side against a stand-in for
Vercel's script (it starts its own server, needs no GPU, and is safe to run any
time):

```
node scripts/verify/analytics-check.mjs
```

The one thing that check cannot prove is the byte layout of Vercel's **real**
request body, because that script only exists on the live deployment. To confirm
it live once Web Analytics is on: open https://flyover-utx.vercel.app with the
browser devtools Network tab filtered to `_vercel/insights`, and check the
`POST /_vercel/insights/view` request. Its body should carry the origin and path
only, with no query string, no hash, and nothing from a class schedule; the
`Referer` header should be the origin only (the `Referrer-Policy: origin` header
in `vercel.json` enforces that). If you want your own visits excluded from the
count, open the app once with `?va=off` (and `?va=on` to re-enable).
