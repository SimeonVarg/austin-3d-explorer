/**
 * js/analytics.js — counts visits with Vercel Web Analytics, and sends nothing else.
 *
 * WHAT THE OWNER WANTS FROM IT. How many people open the app, where they came
 * from (a LinkedIn post right now), phone or desktop, which country. Those are
 * the four things Vercel Web Analytics reports from a page view, and none of
 * them needs a cookie, an id, or anything this app knows about the person.
 *
 * WHAT LEAVES THE PAGE. One page view per load, to THIS origin
 * (`/_vercel/insights/view`), through Vercel's own script served from THIS
 * origin (`/_vercel/insights/script.js`). Never a third-party host. The event
 * this file lets through is `{ type: 'pageview', url: origin + pathname }`:
 * the query string and the hash are cut off in `clean()` below, so `?from=` /
 * `?to=` / `?dayat=` / `#anything` never reach the request. Everything else the
 * dashboard shows (country, device, browser, referrer) Vercel derives itself
 * from the request's headers and `document.referrer`.
 *
 * WHAT DOES NOT LEAVE. Nothing from the class schedule, ever. This file never
 * reads `austin3d.schedule.*`, never imports `WAYFIND`, and only ever hands
 * Vercel's script a URL it has already cut down. docs/si-privacy.md §12 states
 * what the request carries and why the egress guard's promise still holds.
 * The guard in js/wayfind.js §12 is NOT touched, bypassed, whitelisted or
 * special-cased by this file: the beacon simply has nothing in it for the
 * guard to refuse.
 *
 * WHY IT LOADS LAST. This is the last <script> in index.html and
 * _harness.html, after js/wayfind.js. When the walking feature is on, the
 * egress guard has already wrapped `fetch` and `navigator.sendBeacon` by the
 * time this runs, so any reference Vercel's script takes to them is the
 * guarded one. If it loaded first it could keep the unwrapped originals, and
 * the guard would never see the beacon. (With the feature off the guard is
 * not installed at all, and there is no schedule UI to have stored one.)
 *
 * WHERE IT IS INERT. localhost, private-network and other dev hosts, so the
 * verify suite, CI and a phone on the LAN never fetch a script that is not
 * there and never count as visitors. Also when the browser is opted out.
 *
 * OPTING A BROWSER OUT (the owner's own visits, agents that load the live
 * site): open the app once with `?va=off` and that browser stops counting
 * (it writes Vercel's documented `va-disable` key to localStorage). `?va=on`
 * turns it back on. Nothing else in this file touches storage.
 *
 * ONE PAGE VIEW PER LOAD. mobile.js rewrites the address bar twice while a
 * phone boots (history.replaceState), and any route-watching script could
 * count that as navigation. `clean()` drops a second page view of a URL this
 * document already reported, so a phone is not counted twice. And a load
 * reached from this same origin (the loader's mode picker reloads the page
 * with location.assign) is not counted again: see `countInAppReloads`.
 *
 * CUSTOM EVENTS ARE DROPPED. `va('event', { data })` would let a later lane
 * attach anything, which is exactly the "a later lane wires an analytics call
 * in" case docs/si-privacy.md exists for. This build sends page views only.
 *
 * Every policy value is one line in ANALYTICS below (CLAUDE.md rule 11).
 * KEEP THE <script> TAG IN BOTH index.html AND _harness.html
 * (harness-drift.mjs). `scripts/verify/analytics-check.mjs` is the gate.
 */
(function () {
  'use strict';

  const ANALYTICS = {
    /** Master switch. false = this file does nothing at all. */
    on: true,
    /** Vercel serves this from the project's own origin once Web Analytics is
     *  enabled in the dashboard. Until then it 404s: one console line, and
     *  nothing else changes. Keep it a same-origin path. */
    scriptSrc: '/_vercel/insights/script.js',
    /** Query parameters allowed through to the event URL. EMPTY ON PURPOSE:
     *  no query string leaves. Add 'utm_source', 'utm_medium', 'utm_campaign'
     *  here to get the dashboard's UTM breakdowns for a link you share with
     *  tags on it; nothing this app writes into its own URL is on that list. */
    keepQueryParams: [],
    /** Custom events (`va('event', ...)`). Off: only page views are sent, and
     *  an event's `data` is not filtered by anything here, so do not turn this
     *  on without reading docs/si-privacy.md §12. */
    sendCustomEvents: false,
    /** Vercel's documented opt-out key (docs: "Redacting sensitive data"). */
    optOutKey: 'va-disable',
    /** `?va=off` opts this browser out, `?va=on` opts it back in. */
    optOutParam: 'va',
    /** false: a page load whose referrer is this same origin is not a new
     *  arrival (the loader's mode picker reloads the page with location.assign),
     *  so it is not counted again. true counts every load. */
    countInAppReloads: false,
  };

  /** A host this app is never served from in production: loopback, private
   *  ranges and every bare IP (a phone on the LAN), and the reserved dev
   *  suffixes. A denylist on purpose: an allowlist would go silent the day the
   *  app gets a custom domain, and silence is what a lost count looks like. */
  function isDevHost(h) {
    h = String(h || '').toLowerCase();
    if (!h) return true;
    if (h === 'localhost' || /\.(localhost|test|local|internal|lan)$/.test(h)) return true;
    if (h.indexOf(':') !== -1) return true;                       // an IPv6 literal, [::1]
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;           // an IPv4 literal
    return false;
  }

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); return true; } catch (e) { return false; } };

  /** `?va=off` / `?va=on`: the one way a person changes the opt-out. Returns
   *  the change it made, or null. */
  function applyOptOutParam() {
    let v;
    try { v = new URLSearchParams(location.search).get(ANALYTICS.optOutParam); } catch (e) { return null; }
    if (v === 'off') { lsSet(ANALYTICS.optOutKey, '1'); return 'off'; }
    if (v === 'on') { lsDel(ANALYTICS.optOutKey); return 'on'; }
    return null;
  }

  /** Page views this document has already reported, by event URL. */
  const reported = new Set();

  /** True when this page was reached from a page of this same origin: the
   *  loader's mode picker (location.assign) or any in-app link. That visit was
   *  already counted on its first load, with its real referrer. A plain
   *  reload keeps the original referrer, so it is not caught here. */
  function sameOriginArrival() {
    try {
      const r = document.referrer;
      return !!r && new URL(r).origin === location.origin;
    } catch (e) { return false; }
  }

  /**
   * Vercel's `beforeSend`: hand it an event, get back the event to send, or
   * null to send nothing. FAILS CLOSED: anything unexpected, including a throw,
   * drops the event rather than letting the raw URL through.
   */
  function clean(event) {
    try {
      if (!event || typeof event.url !== 'string') return null;
      if (event.type === 'event' && !ANALYTICS.sendCustomEvents) return null;
      const u = new URL(event.url, location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      const kept = new URLSearchParams();
      for (const k of ANALYTICS.keepQueryParams) {
        const v = u.searchParams.get(k);
        if (v != null) kept.set(k, v);
      }
      const qs = kept.toString();
      const url = u.origin + u.pathname + (qs ? '?' + qs : '');
      if (event.type !== 'event') {
        if (reported.has(url)) return null;
        reported.add(url);
      }
      return Object.assign({}, event, { url });
    } catch (e) {
      return null;
    }
  }

  const state = { reason: null, injected: false, optOut: null };

  function boot() {
    state.optOut = applyOptOutParam();
    if (state.optOut) console.info('[analytics] this browser is now opted ' + state.optOut);
    if (!ANALYTICS.on) return 'off';
    if (location.protocol !== 'https:' && location.protocol !== 'http:') return 'not-http';
    if (isDevHost(location.hostname)) return 'dev-host';
    if (lsGet(ANALYTICS.optOutKey)) return 'opted-out';
    if (!ANALYTICS.countInAppReloads && sameOriginArrival()) return 'in-app-reload';
    // Vercel's plain-HTML shape: queue calls until its script arrives, register
    // beforeSend FIRST so the initial page view is already filtered.
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.va('beforeSend', clean);
    const s = document.createElement('script');
    s.defer = true;
    s.src = ANALYTICS.scriptSrc;
    document.head.appendChild(s);
    state.injected = true;
    return 'active';
  }

  try { state.reason = boot(); } catch (e) { state.reason = 'threw: ' + String(e && e.message || e).slice(0, 80); }

  // Public so a gate can drive it, like WAYFIND / LITE_PROFILE.
  window.ANALYTICS = Object.assign(ANALYTICS, {
    clean,
    isDevHost,
    state: () => ({ reason: state.reason, injected: state.injected, optOut: state.optOut, reported: reported.size }),
  });
})();
