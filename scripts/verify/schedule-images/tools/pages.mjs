/**
 * pages.mjs — the three schedule surfaces this corpus renders.
 *
 * These are HAND-WRITTEN MOCKS in the style of the real thing. They are not
 * screenshots of UT's registration system or of Google Calendar, and nothing
 * in this corpus claims they are. What has to be faithful for a benchmark is
 * the SHAPE OF THE DATA a reader has to pull out — a code-plus-room string, a
 * day-letter run, a time range, a coloured block in a week grid at a position
 * that means a time — and that is what these reproduce.
 *
 * Every element that displays a meeting carries `data-meet`, a comma-separated
 * list of meeting keys. `render.mjs` measures those boxes and that is how the
 * cropped images know which meetings actually survived the crop, rather than
 * anyone eyeballing it.
 *
 * TASTE VALUES ARE ALL IN `THEME` AND THE THREE `LAYOUT` BLOCKS — colours,
 * type sizes, row heights, the grid's first and last hour. One-line edits.
 */
import { DAYS, meetings, toMin, ampm, dayLetters } from './schedules.mjs';

// ── taste ─────────────────────────────────────────────────────────────────
const THEME = {
  light: {
    pageBg: '#f1f3f4', cardBg: '#ffffff', ink: '#202124', dim: '#5f6368',
    line: '#dadce0', headBg: '#f8f9fa', accent: '#bf5700', // UT burnt orange
    gridLine: '#e8eaed', nowLine: '#ea4335',
    blocks: ['#4285f4', '#0b8043', '#8e24aa', '#e67c73', '#f6bf26', '#3f51b5'],
    blockInk: '#ffffff', blockInkDark: '#3c4043',
  },
  dark: {
    pageBg: '#131314', cardBg: '#1e1f20', ink: '#e3e3e3', dim: '#9aa0a6',
    line: '#3c4043', headBg: '#282a2c', accent: '#ff8a3d',
    gridLine: '#35363a', nowLine: '#f28b82',
    blocks: ['#1a5fb4', '#0d652d', '#6a1b9a', '#a13b34', '#8a6d1a', '#2a3a8f'],
    blockInk: '#ffffff', blockInkDark: '#e8eaed',
  },
};

const LAYOUT = {
  utTable: { rowH: 46, fontPx: 15, headPx: 12.5 },
  utCards: { fontPx: 14.5, titlePx: 17, roomPx: 16 },
  gcal: { firstHour: 8, lastHour: 18, hourH: 62, gutterW: 62, headH: 64, blockPx: 12.5 },
};

const FONT_STACK =
  "'Segoe UI', -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Meeting keys for one class index of a schedule. */
function keysFor(sched, i) {
  return meetings(sched).filter(m => m.clsIndex === i).map(m => m.key).join(',');
}

function shell(t, body, extraCss) {
  return '<!doctype html><meta charset="utf-8">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'html,body{background:' + t.pageBg + ';color:' + t.ink + ';font-family:' + FONT_STACK + ';' +
    '-webkit-font-smoothing:antialiased}' +
    extraCss +
    '</style>' + body;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. UT registrar-style course table (desktop)
// ══════════════════════════════════════════════════════════════════════════
/**
 * @param {object} sched
 * @param {'light'|'dark'} theme
 * @param {boolean} splitRoom  put the building code in its own column instead
 *                             of the single "WEL 2.224" string. One layout out
 *                             of the corpus does this so no reader can pass by
 *                             assuming code and room are always one token.
 */
export function utTablePage(sched, theme, splitRoom) {
  const t = THEME[theme], L = LAYOUT.utTable;
  const css =
    'body{padding:34px 40px}' +
    '.wrap{max-width:1180px;margin:0 auto}' +
    '.brand{display:flex;align-items:baseline;gap:14px;margin-bottom:6px}' +
    '.brand b{font-size:22px;letter-spacing:.2px;color:' + t.accent + '}' +
    '.brand span{font-size:14px;color:' + t.dim + '}' +
    'h1{font-size:26px;font-weight:600;margin:10px 0 2px}' +
    '.sub{font-size:14px;color:' + t.dim + ';margin-bottom:20px}' +
    '.card{background:' + t.cardBg + ';border:1px solid ' + t.line + ';border-radius:10px;overflow:hidden}' +
    'table{width:100%;border-collapse:collapse;font-size:' + L.fontPx + 'px}' +
    'th{background:' + t.headBg + ';color:' + t.dim + ';font-size:' + L.headPx + 'px;font-weight:700;' +
      'letter-spacing:.7px;text-transform:uppercase;text-align:left;padding:11px 14px;' +
      'border-bottom:1px solid ' + t.line + '}' +
    'td{padding:0 14px;height:' + L.rowH + 'px;border-bottom:1px solid ' + t.line + ';white-space:nowrap}' +
    'tr:last-child td{border-bottom:0}' +
    '.uniq{color:' + t.dim + ';font-variant-numeric:tabular-nums}' +
    '.course{font-weight:600}' +
    '.title{color:' + t.ink + '}' +
    '.instr{color:' + t.dim + '}' +
    '.days{font-weight:600;font-variant-numeric:tabular-nums}' +
    '.hour{font-variant-numeric:tabular-nums}' +
    '.room{font-weight:600}' +
    '.st{color:' + t.dim + ';font-size:12.5px}' +
    '.foot{margin-top:16px;font-size:12.5px;color:' + t.dim + '}';

  const head = splitRoom
    ? '<tr><th>Unique</th><th>Course</th><th>Title</th><th>Instructor</th><th>Days</th><th>Hour</th><th>Bldg</th><th>Room</th><th>Status</th></tr>'
    : '<tr><th>Unique</th><th>Course</th><th>Title</th><th>Instructor</th><th>Days</th><th>Hour</th><th>Room</th><th>Status</th></tr>';

  const rows = sched.classes.map((c, i) => {
    const roomCells = splitRoom
      ? '<td class="room">' + esc(c.building) + '</td><td class="room">' + esc(c.room) + '</td>'
      : '<td class="room">' + esc(c.building + ' ' + c.room) + '</td>';
    return '<tr data-meet="' + keysFor(sched, i) + '">' +
      '<td class="uniq">' + esc(c.unique) + '</td>' +
      '<td class="course">' + esc(c.course) + '</td>' +
      '<td class="title">' + esc(c.title) + '</td>' +
      '<td class="instr">' + esc(c.instructor) + '</td>' +
      '<td class="days">' + esc(dayLetters(c.days)) + '</td>' +
      '<td class="hour">' + esc(ampm(c.start) + '-' + ampm(c.end)) + '</td>' +
      roomCells +
      '<td class="st">Registered</td></tr>';
  }).join('');

  const body =
    '<div class="wrap">' +
    '<div class="brand"><b>THE UNIVERSITY OF TEXAS AT AUSTIN</b><span>Registrar</span></div>' +
    '<h1>My Course Schedule</h1>' +
    '<div class="sub">' + esc(sched.term) + ' &middot; ' + sched.classes.length +
      ' courses &middot; printed 25 Aug 2026</div>' +
    '<div class="card"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="foot">Hours are Central Time. Rooms are subject to change through the twelfth class day.</div>' +
    '</div>';
  return shell(t, body, css);
}

// ══════════════════════════════════════════════════════════════════════════
// 2. UT schedule as stacked cards (phone width)
// ══════════════════════════════════════════════════════════════════════════
export function utCardsPage(sched, theme) {
  const t = THEME[theme], L = LAYOUT.utCards;
  const css =
    'body{padding:0}' +
    '.bar{background:' + t.accent + ';color:#fff;padding:14px 16px 13px;font-size:17px;font-weight:600}' +
    '.bar small{display:block;font-weight:400;opacity:.9;font-size:12.5px;margin-top:2px}' +
    '.list{padding:12px}' +
    '.c{background:' + t.cardBg + ';border:1px solid ' + t.line + ';border-radius:12px;' +
      'padding:11px 13px 12px;margin-bottom:9px}' +
    '.c .n{font-size:' + L.titlePx + 'px;font-weight:700;letter-spacing:.2px}' +
    '.c .t{font-size:12.5px;color:' + t.dim + ';margin:1px 0 7px;line-height:1.25}' +
    // Two meta lines, not four label/value rows. A four-row card made the page
    // three screens tall, and once it was photographed at an angle the labels
    // and their values no longer looked like they were on the same line.
    '.c .r{display:flex;align-items:baseline;gap:12px;font-size:' + L.fontPx + 'px;' +
      'font-variant-numeric:tabular-nums}' +
    '.c .r2{display:flex;justify-content:space-between;align-items:baseline;' +
      'gap:10px;margin-top:5px}' +
    '.d{font-weight:700;min-width:46px}' +
    '.h{color:' + t.ink + '}' +
    '.rm{font-size:' + L.roomPx + 'px;font-weight:700}' +
    '.u{font-size:12px;color:' + t.dim + ';font-variant-numeric:tabular-nums}' +
    '.foot{padding:2px 14px 16px;font-size:12px;color:' + t.dim + '}';

  const cards = sched.classes.map((c, i) =>
    '<div class="c" data-meet="' + keysFor(sched, i) + '">' +
    '<div class="n">' + esc(c.course) + '</div>' +
    '<div class="t">' + esc(c.title) + '</div>' +
    '<div class="r"><span class="d">' + esc(dayLetters(c.days)) + '</span>' +
      '<span class="h">' + esc(ampm(c.start) + '-' + ampm(c.end)) + '</span></div>' +
    '<div class="r2"><span class="rm">' + esc(c.building + ' ' + c.room) + '</span>' +
      '<span class="u">#' + esc(c.unique) + '</span></div>' +
    '</div>').join('');

  const body =
    '<div class="bar">My Course Schedule<small>' + esc(sched.term) + ' &middot; ' +
      sched.classes.length + ' courses</small></div>' +
    '<div class="list">' + cards + '</div>' +
    '<div class="foot">Central Time. Rooms may change through the twelfth class day.</div>';
  return shell(t, body, css);
}

/**
 * Side-by-side lanes for meetings that overlap in one day column.
 *
 * WHY THIS EXISTS. The first version stacked every block at full column width,
 * so on image 10 HIS 315K (10:30-11:30) sat straight on top of C S 429
 * (10:00-11:00) and hid its room. Nothing in the geometry knew: the C S 429
 * element was entirely inside the image, so the derived answer key said its
 * building AND room were readable when the room was behind another rectangle.
 * An answer key that claims a covered field is the same defect as one that
 * claims a field nobody can read through the glare.
 *
 * Real week views split an overlap into columns, so this does too — and the
 * narrow blocks it produces are a case the corpus is better for having.
 *
 * Greedy, within a cluster of transitively-overlapping meetings: each takes the
 * first lane whose last meeting has already ended, and every member of the
 * cluster is drawn at 1/lanes of the column so their left edges line up.
 */
function laneOut(dayMeetings) {
  const ms = dayMeetings.slice()
    .sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(a.end) - toMin(b.end));
  const out = [];
  let cluster = [], lanes = [], clusterEnd = -1;

  const flush = () => {
    for (const m of cluster) m._lanes = lanes.length;
    out.push(...cluster);
    cluster = []; lanes = []; clusterEnd = -1;
  };

  for (const m of ms) {
    const s = toMin(m.start), e = toMin(m.end);
    if (cluster.length && s >= clusterEnd) flush();
    let lane = lanes.findIndex(end => end <= s);
    if (lane < 0) { lane = lanes.length; lanes.push(e); } else { lanes[lane] = e; }
    const c = Object.assign({}, m, { _lane: lane });
    cluster.push(c);
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Google-Calendar-style week grid
// ══════════════════════════════════════════════════════════════════════════
export function gcalPage(sched, theme) {
  const t = THEME[theme], L = LAYOUT.gcal;
  const gridH = (L.lastHour - L.firstHour) * L.hourH;
  const css =
    'body{padding:0}' +
    '.top{display:flex;align-items:center;gap:16px;padding:12px 18px;border-bottom:1px solid ' + t.line + ';' +
      'background:' + t.cardBg + '}' +
    '.top .m{font-size:20px;font-weight:500}' +
    '.top .w{font-size:13px;color:' + t.dim + '}' +
    '.top .pill{margin-left:auto;font-size:13px;color:' + t.dim + ';border:1px solid ' + t.line + ';' +
      'border-radius:6px;padding:5px 12px}' +
    '.cal{background:' + t.cardBg + '}' +
    '.hd{display:flex;height:' + L.headH + 'px;border-bottom:1px solid ' + t.line + '}' +
    '.hd .sp{width:' + L.gutterW + 'px;flex:0 0 ' + L.gutterW + 'px}' +
    '.hd .d{flex:1;text-align:center;padding-top:9px;border-left:1px solid ' + t.gridLine + '}' +
    '.hd .d .n{font-size:11px;letter-spacing:.9px;text-transform:uppercase;color:' + t.dim + '}' +
    '.hd .d .q{font-size:23px;font-weight:400;margin-top:2px}' +
    '.hd .d.today .q{background:' + t.nowLine + ';color:#fff;border-radius:50%;' +
      'display:inline-block;width:36px;height:36px;line-height:36px}' +
    '.body{display:flex;position:relative;height:' + gridH + 'px}' +
    '.gut{width:' + L.gutterW + 'px;flex:0 0 ' + L.gutterW + 'px;position:relative}' +
    '.gut i{position:absolute;right:8px;font-style:normal;font-size:10.5px;color:' + t.dim + ';' +
      'transform:translateY(-50%)}' +
    '.col{flex:1;position:relative;border-left:1px solid ' + t.gridLine + '}' +
    '.hr{position:absolute;left:0;right:0;border-top:1px solid ' + t.gridLine + '}' +
    '.ev{position:absolute;border-radius:5px;padding:4px 6px;overflow:hidden;' +
      'font-size:' + L.blockPx + 'px;line-height:1.28;color:' + t.blockInk + '}' +
    '.ev b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.ev s{display:block;text-decoration:none;opacity:.92;white-space:nowrap;overflow:hidden}' +
    '.ev u{display:block;text-decoration:none;opacity:.92;font-weight:600;white-space:nowrap;overflow:hidden}';

  const dayNums = { Mon: 24, Tue: 25, Wed: 26, Thu: 27, Fri: 28 };
  const hd = '<div class="hd"><div class="sp"></div>' + DAYS.map(d =>
    '<div class="d' + (d === 'Tue' ? ' today' : '') + '"><div class="n">' + d.toUpperCase() +
    '</div><div class="q">' + dayNums[d] + '</div></div>').join('') + '</div>';

  const guts = [];
  for (let h = L.firstHour; h <= L.lastHour; h++) {
    const y = (h - L.firstHour) * L.hourH;
    const lab = (h % 12 === 0 ? 12 : h % 12) + ' ' + (h < 12 ? 'AM' : 'PM');
    if (h > L.firstHour) guts.push('<i style="top:' + y + 'px">' + lab + '</i>');
  }

  const ms = meetings(sched);
  const cols = DAYS.map(d => {
    const lines = [];
    for (let h = L.firstHour + 1; h <= L.lastHour; h++) {
      lines.push('<div class="hr" style="top:' + ((h - L.firstHour) * L.hourH) + 'px"></div>');
    }
    const evs = laneOut(ms.filter(m => m.day === d)).map(m => {
      const top = ((toMin(m.start) - L.firstHour * 60) / 60) * L.hourH;
      const hgt = ((toMin(m.end) - toMin(m.start)) / 60) * L.hourH - 3;
      const col = t.blocks[m.clsIndex % t.blocks.length];
      const w = 100 / m._lanes, x = m._lane * w;
      return '<div class="ev" data-meet="' + m.key + '" style="top:' + top.toFixed(1) +
        'px;height:' + hgt.toFixed(1) + 'px;background:' + col +
        ';left:calc(' + x.toFixed(3) + '% + 2px);width:calc(' + w.toFixed(3) + '% - 5px)">' +
        '<b>' + esc(m.course) + '</b>' +
        '<s>' + esc(ampm(m.start) + ' - ' + ampm(m.end)) + '</s>' +
        '<u>' + esc(m.building + ' ' + m.room) + '</u></div>';
    }).join('');
    return '<div class="col">' + lines.join('') + evs + '</div>';
  }).join('');

  const body =
    '<div class="top"><div class="m">August 2026</div>' +
    '<div class="w">24 - 28 Aug &middot; ' + esc(sched.term) + '</div>' +
    '<div class="pill">Week</div></div>' +
    '<div class="cal">' + hd +
    '<div class="body"><div class="gut">' + guts.join('') + '</div>' + cols + '</div></div>';
  return shell(t, body, css);
}

export const PAGE_BUILDERS = { 'ut-table': utTablePage, 'ut-cards': utCardsPage, 'gcal': gcalPage };
export { THEME, LAYOUT };
