/**
 * apartments-worker.js — the main-thread side of the build worker: start js/build-worker.js and hand it the catalog. An ES module that
 * js/slopes-apartments.js imports ONLY when the switch is on, so a page without it never requests this file.
 *
 * startBuildWorker({ readyMs, buildMs }) returns a promise of { build(specs, settings) -> Promise<result>, terminate() }. The worker is created at once and
 * starts loading its scripts while the catalog is still being fetched; build() posts the specs (plain data, structured-cloned) and resolves with the
 * worker's result: geometry arrays (their buffers TRANSFERRED, not copied), the plain-data list of what the generator registered, the per-building
 * records, the tallies, the facade-filter faces and each building's first triangle. js/slopes-apartments.js buildOnce() turns that back into a mesh and
 * replays the list.
 *
 * EVERY failure is a rejection, never a hang: a browser with no Worker, a script that will not load (the worker's error event), a throw inside the
 * worker (its { error } message), and a worker that never answers (readyMs for the scripts, buildMs for the build). The worker is terminated on any of them.
 * js/slopes-apartments.js turns a rejection into the main-thread build.
 */
export function startBuildWorker({ readyMs = 30000, buildMs = 240000 } = {}) {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('this browser has no Web Workers'));
  const pageBase = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const flags = new URLSearchParams(location.search);
  flags.set('slopes', '0');   // neither js/slopes.js nor js/slopes-apartments.js may boot a map layer in there; the page's other flags ride along
  flags.delete('buildworker'); flags.delete('buildworkertimeout');
  let worker;
  try { worker = new Worker(new URL('./build-worker.js', import.meta.url).href + '?' + flags.toString()); }
  catch (e) { return Promise.reject(new Error('could not start the worker: ' + (e && e.message || e))); }
  const threeTag = document.querySelector('script[src*="three"]');
  const wait = (pred, ms, what) => new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', onMsg); worker.removeEventListener('error', onErr); worker.removeEventListener('messageerror', onBad); };
    const fail = err => { cleanup(); try { worker.terminate(); } catch (e) {} reject(err); };
    const onMsg = ev => { const m = ev.data || {}; if (m.error) fail(new Error('the worker threw: ' + String(m.error).split('\n')[0])); else if (pred(m)) { cleanup(); resolve(m); } };
    const onErr = ev => { if (ev.preventDefault) ev.preventDefault(); fail(new Error('worker error: ' + (ev.message || 'its script did not load'))); };
    const onBad = () => fail(new Error('the worker sent a message this page could not read'));
    timer = setTimeout(() => fail(new Error('the worker did not answer in ' + +(ms / 1000).toFixed(1) + ' s (' + what + ')')), ms);
    worker.addEventListener('message', onMsg); worker.addEventListener('error', onErr); worker.addEventListener('messageerror', onBad);
  });
  const ready = wait(m => m.ready, readyMs, 'loading its scripts');
  worker.postMessage({ init: { base: pageBase, three: threeTag ? threeTag.src : 'https://unpkg.com/three@0.159.0/build/three.min.js' } });
  return ready.then(() => ({
    build(specs, settings) { const done = wait(m => m.done, buildMs, 'building'); worker.postMessage({ build: { specs, ...settings } }); return done.then(m => m.done); },
    terminate() { try { worker.terminate(); } catch (e) {} },
  }));
}
