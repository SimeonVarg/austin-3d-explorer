/**
 * finder-live.js — the live bus line under a selected home in the apartment finder.
 *
 * js/finder.js loads this file (one dynamic import) the first time a home is
 * selected in a mode that allows the bus. It asks js/transit-route.js for the
 * trip from the home to the student's most-used class building, with the next
 * buses from js/transit-live.js (CapMetro's public feed), and writes one or two
 * plain lines. It redraws when the feed has new data.
 *
 * THE SCHEDULE STAYS ON THE DEVICE, AND HERE IS WHY THAT STILL HOLDS. This file
 * is handed two points: the home, and the door of a class building. The second
 * one comes from the student's schedule. It goes to js/transit-route.js, which
 * has no network code at all, and to nothing else. js/transit-live.js downloads
 * the SAME files for everyone (the whole city's buses, and the baked slice): no
 * address it asks for depends on a stop, a route, a home or a building. The
 * departures of one stop are picked out of that download here, in the browser.
 * scripts/verify/finder-static.mjs checks these statements against the source.
 *
 * WHAT IT MAY SAY. A range, never one number (js/finder-core.js gives the
 * reason). "live" only for minutes that came from the feed in this very poll;
 * everything else says "timetable". If the feed is not answering it says so.
 * It gives no arrival clock time and no promise ("you will make it").
 */
import { plan, rangeText } from './transit-route.js';

export const LIVE = {
  script: 'js/transit-live.js',   // the page's own copy; injected once
  tz: 'America/Chicago',          // the buses run on Austin time, wherever the visitor's clock is
  nextBuses: 4,                   // how many coming buses to hand the search for a stop
  say: {
    to: (code) => 'Bus to ' + code + ' now: ',
    ride: (route, stop) => route + ' from ' + stop,
    live: (m) => m <= 0 ? 'due now (live)' : 'in ' + m + ' min (live)',
    timetable: (h) => 'about every ' + h + ' min (timetable)',
    change: (route, stop) => 'change to ' + route + ' at ' + stop,
    door: (range) => range + ' door to door',
    none: (code) => 'No bus links this home and ' + code + ' right now.',
    notRunning: 'No bus is running right now (timetable).',
    walkingWins: (code, range) => 'Walking to ' + code + ' is as quick as any bus: about ' + range + '.',
    samePlace: (code) => 'This home and ' + code + ' are the same place.',
    outOfDate: 'The bus timetable on this page has run out of date, so no timetable times are shown.',
    feedDown: 'Live bus data is not answering. These are timetable times.',
    loading: 'Looking for the next bus…',
  },
};

/** {day, minute} in Austin, whatever the device's own time zone is. day 0 = Sunday. */
export function austinNow(date = new Date(), tz = LIVE.tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minute: Number(get('hour')) % 24 * 60 + Number(get('minute')) };
}

/** The lines to show for one search result. Pure: no DOM, so node can check every sentence. */
export function describe(res, code, feedOk, expired) {
  const S = LIVE.say, o = res && res.options && res.options[0];
  const buses = o && o.legs.filter((l) => l.kind === 'bus'), wait = o && o.legs.find((l) => l.kind === 'wait');
  // A timetable past its last date is not "the timetable": only a bus that came from the live feed may be described.
  if (expired && !(o && wait.live)) return { lines: [S.outOfDate], live: false };
  if (!o) {
    const why = (res && res.reason) || '';
    if (/already/.test(why)) return { lines: [S.samePlace(code)], live: false };
    if (/walking/.test(why) && res.walk) return { lines: [S.walkingWins(code, rangeText(res.walk.lo, res.walk.hi))], live: false };
    return { lines: [/running/.test(why) ? S.notRunning : S.none(code)], live: false };
  }
  let s = S.to(code) + S.ride(buses[0].route, buses[0].boardName) + ', ' + (wait.live ? S.live(wait.inMin) : S.timetable(wait.headway));
  if (buses[1]) s += ' · ' + S.change(buses[1].route, buses[0].alightName);
  s += ' · ' + S.door(rangeText(o.lo, o.hi));
  const lines = [s];
  if (!feedOk && !wait.live) lines.push(S.feedDown);
  return { lines, live: !!wait.live, option: o };
}

let loading = null;
/** The bus module and the baked slice, once. Resolves to null when either cannot be had. */
function load() {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const ready = () => { const TL = window.TransitLive; if (!TL) return resolve(null); TL.data().then((slice) => resolve(slice ? { TL, slice } : null), () => resolve(null)); };
    if (window.TransitLive) return ready();
    const own = [...document.scripts].map((s) => s.getAttribute('src')).find((s) => s && /(^|\/)js\/finder\.js(\?|$)/.test(s));
    const s = document.createElement('script');
    s.src = own ? own.replace(/finder\.js/, 'transit-live.js') : LIVE.script;
    s.onload = ready; s.onerror = () => resolve(null);
    document.body.append(s);
  });
  return loading;
}

/**
 * Fill `box` with the live bus line for from -> to ([lat, lon] each) and keep it fresh. `opts.code` is the class
 * building's code; `opts.el(tag, cls, text)` makes an element. Returns a function that stops the updates.
 */
export function watch(box, from, to, opts) {
  let off = null, stopped = false;
  box.textContent = LIVE.say.loading;
  load().then((L) => {
    if (stopped || !L) { if (!L) box.textContent = ''; return; }
    const { TL, slice } = L;
    TL.start(); TL.wantTrips(true);
    const paint = () => {
      if (stopped || !box.isConnected) { stop(); return; }
      const st = TL.state();
      const res = plan(slice, from, to, {
        when: austinNow(),
        live: (sid, rid, dir) => { const d = TL.departures(sid, LIVE.nextBuses, { route: rid, dir }).filter((x) => x.live).map((x) => x.minutes); return d.length ? d : null; },
      });
      const out = describe(res, opts.code, st.ok, st.timetableExpired);
      box.textContent = '';
      out.lines.forEach((t, i) => box.append(opts.el('p', i ? 'fd-live-note' : 'fd-live-line' + (out.live ? ' is-live' : ''), t)));
      box.append(opts.el('p', 'fd-live-credit', TL.credit));
      if (opts.onPlan) opts.onPlan(out.option || null, slice);
    };
    off = TL.on(paint);
    paint();
    function stop() { if (off) off(); off = null; TL.wantTrips(false); TL.stop(); }
  });
  // Stopping the line stops the downloads too: nothing else on the page uses the bus module yet.
  return () => { stopped = true; if (off) off(); off = null; if (window.TransitLive) { window.TransitLive.wantTrips(false); window.TransitLive.stop(); } };
}
