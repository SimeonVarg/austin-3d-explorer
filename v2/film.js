// film.js — THE OPENING FLIGHT AS A FILM OF THIS RENDERER (prototype behind ?film=1).
//
// Why: on a screen with one canvas pixel per CSS pixel (the owner's 2560 x 1440 monitor) the live flight is drawn at about
// 22 frames a second with 4 samples a pixel, and every part thinner than a pixel breaks into dots that crawl (CLAUDE.md
// rule 15). No frame budget on that GPU pays for more samples. But the flight is the SAME camera path on every visit, and
// the city does not move. So the flight can be drawn ahead of time by this same renderer, with no time limit: every frame at
// the flight's own pose, everything loaded, the clean still complete (rest.js: 64 samples a pixel), 60 frames a second.
// The film plays over the canvas while the live city loads for the flight's END underneath. When the film ends the live
// picture (the same pose, its clean still complete) is under its last frame, and the film fades out.
//
// It is this renderer's picture, not a photograph and not another renderer. The film is made by scripts/verify/v2-film-frames.mjs
// and scripts/v2/film_encode.sh, and it has to be made again when the city changes. So that an old film is never shown over
// a newer city, the film's record (film/film.json) carries a hash of the tile list and the far-copy list it was drawn from
// (`of`); the page works the same hash out from the lists it is about to load, and plays the film only when they are equal.
// The film's files are too big for the repository (every work copy would hold them): film.json names where they are.
//
// The lens: the film's HEIGHT is the whole height of the view (the camera's vertical angle is fixed), and the film is wider
// than any usual window (3072 x 1440). `object-fit: cover` then shows it at the window's height and cuts the sides: exactly
// the live framing. A window wider than the film cannot be covered that way, so there the flight stays live.
const Q = new URLSearchParams(location.search);
export const FILM = {
  ON: Q.get('film') === '1',                   // prototype: only when asked for
  RECORD: './film/film.json',                  // { of, w, h, ms, files: [{ src, type }] } written by scripts/v2/film_encode.sh
  OF: ['./tiles/manifest.json', './tiles/coats.json'],   // the lists the film's hash is made of
  FILES: [],                                   // from the record; tried in this order (the browser takes the first kind it can play)
  W: 3072, H: 1440,                            // the film's size (see "The lens"); the record's own numbers replace these
  WAIT_MS: Q.has('filmwait') ? +Q.get('filmwait') : 6000,   // the loading screen waits at most this long for the film; then the flight is live as before (?filmwait= ms: a slow test machine)
  HOLD_MS: 10000,                              // at most this long on the film's last frame while the live city is not ready under it
  FADE_MS: 450,                                // the film fades into the live city at its end...
  CUT_MS: 160,                                 // ...and when a person takes the camera
};
const CLIP = Q.get('filmsrc');                // (a test clip in the film's place, no record and no hash: scripts/verify/v2-film.mjs)
if (CLIP) FILM.FILES = [{ src: CLIP, type: 'video/mp4' }];

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
// The hash of the lists this page is about to load (the same bytes the maker hashed, in the same order).
export async function cityHash() {
  const parts = await Promise.all(FILM.OF.map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.arrayBuffer(); })));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0)); let o = 0; for (const p of parts) { all.set(new Uint8Array(p), o); o += p.byteLength; }
  return hex(await crypto.subtle.digest('SHA-256', all)).slice(0, 16);
}
// Is there a film for THIS city? true = FILM.FILES is set; false = no film, an old film, or a browser that cannot check.
export async function filmPlan() {
  if (CLIP) return true;
  try {
    const r = await fetch(FILM.RECORD, { cache: 'no-cache' }); if (!r.ok) return false;
    const rec = await r.json(); if (!rec || !rec.of || !Array.isArray(rec.files) || !rec.files.length) return false;
    if (rec.of !== await cityHash()) { console.info('[v2 film] the film is of an older city: the flight is live'); return false; }
    FILM.FILES = rec.files; if (rec.w && rec.h) { FILM.W = rec.w; FILM.H = rec.h; }
    return true;
  } catch (e) { return false; }
}

export const filmFits = () => innerWidth / Math.max(1, innerHeight) <= FILM.W / FILM.H + 1e-3;

export function installFilm() {
  const v = document.createElement('video');
  v.id = 'film'; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.disablePictureInPicture = true; v.setAttribute('aria-hidden', 'true');
  const ready = new Promise((res) => {
    v.addEventListener('canplaythrough', () => res(true), { once: true });
    v.addEventListener('error', () => res(false), { once: true });
    FILM.FILES.forEach((f, i) => { const s = document.createElement('source'); s.src = f.src; s.type = f.type; v.appendChild(s);
      if (i === FILM.FILES.length - 1) s.addEventListener('error', () => res(false), { once: true }); });   // (no file could be played)
  });
  (document.getElementById('markers') || document.body.lastElementChild).after(v);   // over the canvas and the names, under the loading screen and the controls
  v.load();
  const stats = { state: 'loading', shown: 0, gaps: 0, worstGapMs: 0, startedAt: 0, endedAt: 0 };
  let last = 0;
  const onFrame = (now, m) => { if (last) { const g = now - last; if (g > 30) stats.gaps++; if (g > stats.worstGapMs) stats.worstGapMs = g; } last = now; stats.shown = m.presentedFrames;
    if (stats.state === 'playing') v.requestVideoFrameCallback(onFrame); };
  return {
    el: v, ready, stats,
    timeMs: () => v.currentTime * 1000,
    play() { stats.state = 'playing'; stats.startedAt = performance.now(); document.body.classList.add('film-on'); if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame); return v.play(); },
    // fade out and take the film away (ms = how long the fade is)
    end(ms, state = 'done') {
      if (stats.state === 'done' || stats.state === 'cancelled' || stats.state === 'failed') return;
      stats.state = state; stats.endedAt = performance.now();
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null; if (q) { stats.dropped = q.droppedVideoFrames; stats.total = q.totalVideoFrames; }
      v.style.transition = `opacity ${ms}ms linear`; v.style.opacity = '0'; document.body.classList.remove('film-on');
      setTimeout(() => { v.pause(); v.removeAttribute('src'); v.replaceChildren(); v.load(); v.remove(); }, ms + 60);
    },
  };
}
