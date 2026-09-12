/* Schedule arithmetic, independent of the map and of browser storage. */
(function (root) {
  'use strict';
  const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  function validate(rows, codes) {
    if (!rows.length) return 'Add a class or try the example week.';
    if (rows.length > 40) return 'Compare up to 40 class meetings at a time.';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], label = 'Class ' + (i + 1) + ': ';
      if (r.needsReview) return label + 'review the imported building, days and times.';
      if (!codes.has(r.code)) return label + 'choose a building from the list.';
      if (!r.days?.length || r.days.some(d => !days.includes(d))) return label + 'choose its days.';
      if (!Number.isInteger(r.startMin) || !Number.isInteger(r.endMin) || r.startMin < 0 ||
          r.endMin > 1440 || r.endMin <= r.startMin) return label + 'check the start and end times.';
    }
    for (const d of days) {
      const daily = rows.filter(r => r.days.includes(d)).sort((a,b) => a.startMin - b.startMin);
      if (daily.some((r,i) => i && r.startMin < daily[i-1].endMin)) return d + ': class times overlap. Adjust them before comparing.';
    }
    return '';
  }
  const total = legs => legs.reduce((sum, l) => ({lo: sum.lo + l.route.lo,
    hi: sum.hi + l.route.hi, distM: sum.distM + l.route.distM}), {lo: 0, hi: 0, distM: 0});
  async function compare(rows, homes, route, codes) {
    const error = validate(rows, codes);
    if (error) return {error};
    const cache = new Map();
    async function leg(from, to, kind, gap) {
      const key = JSON.stringify([from,to]);
      if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => route(from,to)).catch(() => ({ok:false,why:'load'})));
      const r = await cache.get(key);
      // A missing route never contributes zero to a successful comparison.
      const ok = r?.ok && ['lo','hi','distM'].every(k => Number.isFinite(r[k]) && r[k] >= 0);
      return {from,to,kind,gap,route: ok ? r : {ok:false,why:r?.why || 'unavailable'}};
    }
    const week = [];
    for (const day of days) {
      const classes = rows.filter(r => r.days.includes(day)).sort((a,b) => a.startMin - b.startMin);
      if (!classes.length) continue;
      const shared = [];
      for (let i = 1; i < classes.length; i++) shared.push(await leg(classes[i-1].code, classes[i].code,
        'between', classes[i].startMin - classes[i-1].endMin));
      week.push({day,classes,shared});
    }
    const sharedLegs = week.flatMap(d => d.shared);
    const sharedOK = sharedLegs.every(l => l.route.ok);
    const apartments = [];
    for (const home of homes) {
      const daily = [];
      for (const d of week) daily.push({day:d.day, legs:[
        await leg(home.name,d.classes[0].code,'out'),
        await leg(d.classes.at(-1).code,home.name,'home')
      ]});
      const legs = daily.flatMap(d => d.legs), ok = legs.every(l => l.route.ok);
      apartments.push({home,daily,ok,total:ok ? total(legs) : null});
    }
    return {week, apartments, shared:sharedOK ? total(sharedLegs) : null,
      complete:sharedOK && apartments.every(a => a.ok)};
  }
  // Import only the fields needed here. No names, identifiers, raw text or rooms.
  // Invalid/unresolved events stay visible for correction; never silently drop them.
  function imported(schedule) {
    return (schedule?.events || []).map(r => ({code:r.code || '', days:(r.days || []).filter(d => days.includes(d)),
      startMin:Number.isInteger(r.startMin) ? r.startMin : null, endMin:Number.isInteger(r.endMin) ? r.endMin : null,
      needsReview:r.status === 'failed' || (r.confidence != null && r.confidence < 1) || !!r.problems?.length}));
  }
  const api = {days,validate,compare,imported};
  if (typeof module !== 'undefined') module.exports = api;
  else root.LiveHereCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
