/**
 * ui.js — the HUD and the finish card, plain DOM. All the numbers shown come
 * from js/air/sim.js and js/air/race.js; this file only draws them.
 */
(function (root, factory) { root.AirUI = factory(root.AIR, root.AirRace); })(typeof self !== 'undefined' ? self : this, function (AIR, Race) {
  'use strict';
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  function create(h) {
    const root = document.getElementById('air-root');
    root.innerHTML = '';
    const hud = el('div', 'air-hud');
    const title = el('div', 'air-title air-ui', '<b>Air Race</b><span id="air-gate">--</span>');
    const clock = el('div', 'air-clock', '<div id="air-time">0.00</div><div id="air-delta"></div>');
    const flash = el('div', 'air-flash');
    const centre = el('div', 'air-centre');
    const gauge = el('div', 'air-gauge', '<span id="air-speed">0</span><small>km/h</small><span id="air-alt">0</span><small>m up</small>');
    const hint = el('div', 'air-hint air-ui', '<span class="kb"><b>A D</b> bank &nbsp; <b>W S</b> dive / climb &nbsp; <b>Shift</b> boost &nbsp; <b>C</b> brake &nbsp; <b>R</b> restart &nbsp; <b>N</b> day/night &nbsp; <b>H</b> hide</span><span class="touch">Drag to steer</span>');
    const stick = el('div', 'air-stick'); stick.innerHTML = '<i></i>';
    const buttons = el('div', 'air-buttons air-ui', '<button data-hold="brake">BRAKE</button><button data-hold="boost">BOOST</button><button data-act="restart">&#8635;</button>');
    const toast = el('div', 'air-toast');
    const card = el('div', 'air-card air-ui hidden');
    [title, clock, flash, centre, gauge, hint, stick, buttons, toast, card].forEach(n => hud.appendChild(n));
    root.appendChild(hud);
    buttons.querySelectorAll('button[data-hold]').forEach(b => h.bindHold && h.bindHold(b, b.dataset.hold));
    buttons.querySelector('[data-act=restart]').addEventListener('click', () => h.restart && h.restart());
    const $ = id => document.getElementById(id);
    let flashT = 0, toastT = 0;

    return {
      setGate(i, n, name) { $('air-gate').textContent = i >= n ? 'finished' : `gate ${i + 1} / ${n}` + (name ? ' · ' + name : ''); },
      setClock(s) { $('air-time').textContent = Race.fmt(s); },
      setDelta(d, ahead) { const e = $('air-delta'); if (d == null) { e.textContent = ''; return; } e.textContent = Race.fmtDelta(d); e.className = d <= 0 ? 'ahead' : 'behind'; },
      setGauge(v, alt) { $('air-speed').textContent = Math.round(v * 3.6); $('air-alt').textContent = Math.round(alt); },
      centre(text, cls) { centre.className = 'air-centre' + (cls ? ' ' + cls : ''); centre.innerHTML = text || ''; },
      flash(text, cls) { flash.className = 'air-flash show ' + (cls || ''); flash.textContent = text; clearTimeout(flashT); flashT = setTimeout(() => flash.classList.remove('show'), 1500); },
      toast(text, ms) { toast.textContent = text; toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), ms || 2600); },
      stick(a) { if (!a) { stick.style.display = 'none'; return; } stick.style.display = 'block'; stick.style.left = a.ax + 'px'; stick.style.top = a.ay + 'px';
        const dx = Math.max(-45, Math.min(45, a.x - a.ax)), dy = Math.max(-45, Math.min(45, a.y - a.ay)); stick.firstChild.style.transform = `translate(${dx}px,${dy}px)`; },
      hudVisible(v) { hud.classList.toggle('off', !v); },
      hudToggle() { hud.classList.toggle('off'); return !hud.classList.contains('off'); },
      hintHide() { hint.classList.add('gone'); },
      showFinish(r) {
        const rows = r.rows.map(x => `<tr class="${x.status}"><td>${x.i + 1}</td><td>${x.name}</td><td>${x.status === 'miss' ? 'miss' : Race.fmt(x.split)}</td><td class="${x.d == null ? '' : x.d <= 0 ? 'ahead' : 'behind'}">${x.d == null ? '' : Race.fmtDelta(x.d)}</td></tr>`).join('');
        const verdict = r.best == null ? 'First run.' : r.time < r.best ? `New best, ${Race.fmt(r.best - r.time)} faster.` : `Your best is ${Race.fmt(r.best)}.`;
        card.innerHTML = `<div class="c-head">Finish</div><div class="c-time">${Race.fmt(r.time)}</div>
          <div class="c-sub">${r.misses ? r.misses + ' missed gate' + (r.misses > 1 ? 's' : '') + ' (+' + (r.misses * AIR.penaltyS).toFixed(1) + ' s)' : 'Clean run, no missed gates.'} ${verdict}</div>
          ${r.refLabel ? `<div class="c-sub">${r.refLabel}: ${Race.fmt(r.refTime)} &nbsp; <b class="${r.time <= r.refTime ? 'ahead' : 'behind'}">${Race.fmtDelta(r.time - r.refTime)}</b></div>` : ''}
          <div class="c-split"><table>${rows}</table></div>
          <div class="c-btns"><button class="primary" data-act="copy">Copy link</button><button data-act="again">Race again</button></div>
          <div class="c-link" id="air-link"></div>`;
        card.classList.remove('hidden');
        card.querySelector('[data-act=copy]').onclick = () => h.copyLink && h.copyLink(card.querySelector('[data-act=copy]'));
        card.querySelector('[data-act=again]').onclick = () => h.restart && h.restart();
      },
      setLink(text) { const l = $('air-link'); if (l) l.textContent = text; },
      hideFinish() { card.classList.add('hidden'); },
      root,
    };
  }
  return { create };
});
