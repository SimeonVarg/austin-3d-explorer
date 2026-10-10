/**
 * apartments-worker.js — the main-thread side of ?buildworker=1: start js/build-worker.js and hand it the catalog. An ES module that js/slopes-apartments.js
 * imports ONLY when the switch is on, so a page without it never requests this file.
 *
 * startBuildWorker() returns { build(specs, settings) -> Promise<result>, terminate() }. The worker is created at once and starts loading its
 * scripts while the catalog is still being fetched; build() posts the specs (plain data, structured-cloned) and resolves with the worker's result:
 * geometry arrays (their buffers TRANSFERRED, not copied), the plain-data list of what the generator registered, the per-building records, the
 * tallies, the facade-filter faces and each building's first triangle. js/slopes-apartments.js buildOnce() turns that back into a mesh and replays the list.
 */
export function startBuildWorker() {
  const pageBase = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const flags = new URLSearchParams(location.search);
  flags.set('slopes', '0');   // neither js/slopes.js nor js/slopes-apartments.js may boot a map layer in there; the page's other flags ride along
  flags.delete('buildworker');
  const worker = new Worker(new URL('./build-worker.js', import.meta.url).href + '?' + flags.toString());
  const threeTag = document.querySelector('script[src*="three"]');
  const wait = pred => new Promise((resolve, reject) => {
    const onMsg = ev => { const m = ev.data; if (m.error) { cleanup(); reject(new Error(m.error)); } else if (pred(m)) { cleanup(); resolve(m); } };
    const onErr = ev => { cleanup(); reject(new Error('worker error: ' + (ev.message || ev))); };
    const cleanup = () => { worker.removeEventListener('message', onMsg); worker.removeEventListener('error', onErr); };
    worker.addEventListener('message', onMsg); worker.addEventListener('error', onErr);
  });
  const ready = wait(m => m.ready);
  worker.postMessage({ init: { base: pageBase, three: threeTag ? threeTag.src : 'https://unpkg.com/three@0.159.0/build/three.min.js' } });
  return ready.then(() => ({
    build(specs, settings) { const done = wait(m => m.done); worker.postMessage({ build: { specs, ...settings } }); return done.then(m => m.done); },
    terminate() { worker.terminate(); },
  }));
}
