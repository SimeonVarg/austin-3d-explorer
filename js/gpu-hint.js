/**
 * js/gpu-hint.js — tell a visitor when their browser is drawing the city
 * without the graphics card.
 *
 * WHY. With Chrome's "Use graphics acceleration when available" switched off,
 * WebGL still works — it just runs on a software rasteriser. The owner hit
 * exactly this: the renderer string read "ANGLE (Microsoft, Microsoft Basic
 * Render Driver ...)" and the city drew about one frame every three seconds.
 * Nothing on screen said why, so it read as "the app is broken". Every other
 * visitor with the same setting sees the same thing.
 *
 * WHAT. Once the map's WebGL context exists, read its renderer. If it is a
 * software one (SOFTWARE_RE), show a small dismissible notice that says so in
 * plain words and how to switch acceleration back on in THIS browser. A notice
 * only: no preset, quality or render setting is touched here. The graphics
 * probe in js/graphics.js still makes its own call about the preset.
 *
 * NOT FOR TEST BROWSERS. The verification harness runs SwiftShader ON PURPOSE,
 * for exact-pixel assertions, so this file stands down whenever
 * navigator.webdriver is true — and it does so BEFORE it touches the GL
 * context, so a harness frame is byte-identical with or without this file.
 *   ?gpuhint=0  never show it
 *   ?gpuhint=1  always show it, whatever the renderer, the webdriver flag or
 *               an earlier dismissal — for looking at it and for tests
 *
 * A dismissal is remembered in localStorage (GPU_HINT.key). Every storage
 * access is wrapped: a private window or blocked site data throws, and the
 * notice must still work (it simply comes back next visit).
 *
 * Debug/test hook: window.__gpuHint = { checked, renderer, software, browser,
 * shown, reason }.
 *
 * Self-booting off window.__map; app.js never calls it. The DOM and its CSS are
 * built here, the same way js/mobile.js builds #lite-notice, so index.html and
 * _harness.html cannot drift apart over it. KEEP THE <script> TAG IN BOTH.
 */
(function () {
  'use strict';

  // ── Every value here is the taste/config surface (CLAUDE.md rule 11) ──
  const GPU_HINT = {
    // Renderer strings that mean "no graphics card". SwiftShader is Chrome's
    // own CPU fallback, "Basic Render Driver" and WARP are Windows', llvmpipe
    // and softpipe are Mesa's on Linux, and "Software" catches the rest
    // ("Software Adapter", "Apple Software Renderer").
    SOFTWARE_RE: /swiftshader|basic render driver|\bwarp\b|llvmpipe|softpipe|software/i,

    key: 'austin3d.gpuhint.dismissed.v1',

    title: 'Graphics acceleration is off',
    body: 'This browser is drawing the 3D city without your graphics card, so it will run very slowly.',
    // Shown under the steps. '' drops the line.
    driver: 'Already on? Updating your graphics driver usually fixes it.',
    // The settings address, as a sentence: addrLead + address + addrTail.
    addrLead: 'Or paste ',
    addrTail: ' into the address bar.',
    copy: 'Copy address',
    copied: 'Copied — paste it into the address bar',
    copyFail: 'Select the address above and copy it',
    dismiss: 'Dismiss',

    // How to turn it on, per browser. First `test` that matches wins, so the
    // Chromium browsers that also say "Chrome/" in their user agent go first.
    // `url` is the settings page: a web page cannot open it, so it is shown
    // for pasting and offered on a Copy button. null = no such page.
    browsers: [
      { name: 'phone', test: (ua) => /Android|iPhone|iPad|iPod/.test(ua),
        steps: 'Close and reopen the browser, and check that it is up to date.', url: null },
      { name: 'Edge', test: (ua) => /Edg\//.test(ua),
        steps: 'To turn it on in Edge: Settings › System and performance › switch on “Use graphics acceleration when available” › Restart.',
        url: 'edge://settings/system' },
      { name: 'Opera', test: (ua) => /OPR\//.test(ua),
        steps: 'To turn it on in Opera: Settings › System › switch on “Use graphics acceleration when available” › Relaunch.',
        url: null },
      { name: 'Brave', test: () => !!navigator.brave,
        steps: 'To turn it on in Brave: Settings › System › switch on “Use graphics acceleration when available” › Relaunch.',
        url: 'brave://settings/system' },
      { name: 'Firefox', test: (ua) => /Firefox\//.test(ua),
        steps: 'To turn it on in Firefox: Settings › General › Performance › untick “Use recommended performance settings” › tick “Use hardware acceleration when available” › restart Firefox.',
        url: 'about:preferences#general' },
      { name: 'Chrome', test: (ua) => /Chrome\//.test(ua),
        steps: 'To turn it on in Chrome: Settings › System › switch on “Use graphics acceleration when available” › Relaunch.',
        url: 'chrome://settings/system' },
      { name: 'Safari', test: (ua) => /Safari\//.test(ua),
        steps: 'Safari has no switch for this. Quit and reopen Safari, and check that macOS is up to date.',
        url: null },
    ],
    fallback: { name: 'other',
      steps: 'Look in your browser’s settings for “graphics acceleration” or “hardware acceleration”, switch it on, then restart the browser.',
      url: null },

    // Placement. Above the load veil (z 60) on purpose: a software renderer
    // makes the LOAD slow too, and the visitor should learn why before they
    // sit through it, not after. Desktop: centred under the title pill.
    // Phone: the #lite-notice slot (js/mobile.js), clear of the top-right
    // button column and under the Explore button.
    z: 80,
    top: '64px',
    width: '420px',
    phoneMax: '520px',
    phoneTop: 'calc(16px + 44px + 12px)',
    phoneLeft: '12px',
    phoneRight: 'calc(16px + 44px + 8px)',

    // The house notice colours — the same values as #lite-notice.
    bg: 'rgba(16,10,3,.92)',
    edge: 'rgba(255,190,90,.30)',
    ink: '#f5dfa0',
    accent: '#f5a623',
    accentInk: '#1a1208',
    codeBg: 'rgba(255,190,90,.12)',

    // Boot: the map is built once the manifest is in, which has been measured
    // anywhere from under a second to a minute on a cold cache.
    BOOT_POLL_MS: 250,
    BOOT_GIVE_UP_MS: 120000,
  };

  const state = window.__gpuHint = {
    checked: false, renderer: '', software: false, browser: '', shown: false, reason: '',
  };

  const Q = new URLSearchParams(location.search);
  const flag = Q.get('gpuhint');          // '0' off, '1' force on, else automatic

  const store = {
    get() { try { return window.localStorage.getItem(GPU_HINT.key); } catch (e) { return null; } },
    set(v) { try { window.localStorage.setItem(GPU_HINT.key, v); } catch (e) {} },
  };

  /** The unmasked renderer of the map's OWN context, or '' if unreadable. */
  function readRenderer(map) {
    let gl = null;
    try { gl = map.painter && map.painter.context && map.painter.context.gl; } catch (e) {}
    // MapLibre builds its context in the Map constructor, so by the time
    // window.__map exists this returns that context rather than making one.
    // webgl2 first: asking a webgl2 canvas for 'webgl' returns null.
    if (!gl) {
      try { const c = map.getCanvas(); gl = c.getContext('webgl2') || c.getContext('webgl'); } catch (e) {}
    }
    if (!gl) return '';
    try {
      // Firefox answers RENDERER unmasked and warns if the debug extension is
      // asked for, so only reach for it when RENDERER is Chrome/Safari's mask.
      const plain = String(gl.getParameter(gl.RENDERER) || '');
      if (plain && !/^WebKit WebGL$/i.test(plain)) return plain;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : plain;
    } catch (e) { return ''; }
  }

  function whichBrowser() {
    const ua = navigator.userAgent || '';
    for (const b of GPU_HINT.browsers) {
      try { if (b.test(ua)) return b; } catch (e) {}
    }
    return GPU_HINT.fallback;
  }

  /** execCommand fallback for non-secure contexts (plain-http LAN serves). */
  function legacyCopy(s) {
    try {
      const t = document.createElement('textarea');
      t.value = s;
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch (e) { return false; }
  }

  function show(b) {
    if (document.getElementById('gpu-hint')) return;
    const N = GPU_HINT;
    const css = document.createElement('style');
    css.id = 'gpu-hint-css';
    css.textContent =
      '#gpu-hint{position:absolute;top:' + N.top + ';left:50%;transform:translateX(-50%);z-index:' + N.z + ';' +
      'width:' + N.width + ';max-width:calc(100vw - 24px);background:' + N.bg + ';' +
      '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);' +
      'border:1px solid ' + N.edge + ';border-radius:14px;padding:11px 13px 11px 14px;color:' + N.ink + ';' +
      'font-size:12.5px;line-height:1.38;box-shadow:0 8px 26px rgba(0,0,0,.35);pointer-events:auto}' +
      '#gpu-hint .gh-t{font-weight:600;letter-spacing:.02em;margin-bottom:3px;padding-right:26px}' +
      '#gpu-hint .gh-b{opacity:.86}' +
      '#gpu-hint .gh-s{margin-top:7px}' +
      '#gpu-hint .gh-u{margin-top:5px;opacity:.86}' +
      '#gpu-hint .gh-d{margin-top:5px;opacity:.62;font-size:11.5px}' +
      '#gpu-hint code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:' + N.codeBg + ';' +
      'border-radius:5px;padding:1px 5px;user-select:all;-webkit-user-select:all;word-break:break-all}' +
      '#gpu-hint .gh-a{margin-top:9px}' +
      '#gpu-hint button[data-act=copy]{min-height:36px;padding:0 16px;border-radius:999px;border:0;' +
      'background:' + N.accent + ';color:' + N.accentInk + ';font-family:inherit;font-weight:600;font-size:12.5px;line-height:1;cursor:pointer}' +
      '#gpu-hint button[data-act=close]{position:absolute;top:4px;right:4px;width:36px;height:36px;border:0;' +
      'background:none;color:' + N.ink + ';opacity:.7;font-size:18px;line-height:1;cursor:pointer}' +
      '@media(max-width:' + N.phoneMax + '){#gpu-hint{top:' + N.phoneTop + ';left:' + N.phoneLeft + ';right:' + N.phoneRight + ';' +
      'width:auto;max-width:none;transform:none}}' +
      // Capture mode (?clip=1 and the reel flags) is scene only.
      '.clip #gpu-hint{display:none!important}';
    document.head.appendChild(css);

    const el = document.createElement('div');
    el.id = 'gpu-hint';
    el.setAttribute('role', 'status');
    const t = document.createElement('div'); t.className = 'gh-t'; t.textContent = N.title;
    const p = document.createElement('div'); p.className = 'gh-b'; p.textContent = N.body;
    const s = document.createElement('div'); s.className = 'gh-s'; s.textContent = b.steps;
    el.append(t, p, s);
    if (b.url) {
      // The address as selectable text; the button below copies it.
      const u = document.createElement('div'); u.className = 'gh-u';
      const c = document.createElement('code'); c.textContent = b.url;
      u.append(N.addrLead, c, N.addrTail);
      el.appendChild(u);
    }
    if (N.driver) {
      const d = document.createElement('div'); d.className = 'gh-d'; d.textContent = N.driver;
      el.appendChild(d);
    }
    if (b.url) {
      const a = document.createElement('div'); a.className = 'gh-a';
      const go = document.createElement('button'); go.type = 'button'; go.dataset.act = 'copy'; go.textContent = N.copy;
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        const ok = () => { go.textContent = N.copied; };
        const no = () => { go.textContent = legacyCopy(b.url) ? N.copied : N.copyFail; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(b.url).then(ok, no);
        else no();
      });
      a.appendChild(go);
      el.appendChild(a);
    }
    const x = document.createElement('button'); x.type = 'button'; x.dataset.act = 'close'; x.textContent = '×';
    x.setAttribute('aria-label', N.dismiss);
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      store.set(String(Date.now()));
      el.remove();
      state.shown = false;
      state.reason = 'dismissed';
    });
    el.appendChild(x);
    document.body.appendChild(el);
    state.shown = true;
  }

  function check(map) {
    state.checked = true;
    if (flag === '0') { state.reason = 'off'; return; }
    const force = flag === '1';
    // Before any GL call: a test browser gets nothing, not even the query.
    if (!force && navigator.webdriver) { state.reason = 'webdriver'; return; }
    if (!force && store.get()) { state.reason = 'dismissed'; return; }
    state.renderer = readRenderer(map);
    state.software = GPU_HINT.SOFTWARE_RE.test(state.renderer);
    if (!force && !state.software) { state.reason = 'hardware'; return; }
    const b = whichBrowser();
    state.browser = b.name;
    state.reason = force ? 'forced' : 'software';
    show(b);
  }

  const t0 = Date.now();
  (function arm() {
    const map = window.__map;
    if (!map) {
      if (Date.now() - t0 < GPU_HINT.BOOT_GIVE_UP_MS) setTimeout(arm, GPU_HINT.BOOT_POLL_MS);
      return;
    }
    try { check(map); } catch (e) { state.reason = 'error'; }
  })();
})();
