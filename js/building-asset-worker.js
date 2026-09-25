import { decodeVerifiedBuildingAsset } from './building-asset-codec.js';

// Fetch, authentication and structural validation never run on the render thread.
const pending = new Map();
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { pending.get(data.requestId)?.abort(); return; }
  if (data.type !== 'load' || pending.has(data.requestId)) return;
  const abort = new AbortController();
  pending.set(data.requestId, abort);
  const started = performance.now();
  let storage = null, asset = null;
  try {
    const response = await fetch(data.url, { signal: abort.signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const maxBytes = Math.min(data.maxBytes || 256 * 1024 * 1024, 256 * 1024 * 1024);
    const size = Number(response.headers.get('content-length'));
    if (size > maxBytes) throw new Error('Asset exceeds byte limit');
    // Enforce the bound while receiving a body too, including responses with
    // no Content-Length. Never collect an unlimited body before checking it.
    if (!response.body) throw new Error('Asset response has no body');
    const reader = response.body.getReader();
    storage = new Uint8Array(maxBytes);
    let length = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        if (length + value.byteLength > maxBytes) throw new Error('Asset exceeds byte limit');
        storage.set(value, length); length += value.byteLength;
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (length !== maxBytes) throw new Error('Asset byte length differs from manifest');
    const received = performance.now();
    asset = await decodeVerifiedBuildingAsset(storage.buffer, {
      expectedId: data.expectedId, expectedHash: data.expectedHash, maxBytes,
    });
    if (abort.signal.aborted) return;
    self.postMessage({ type: 'loaded', requestId: data.requestId, asset,
      timing: { fetchMs: received - started, decodeMs: performance.now() - received,
        started: performance.timeOrigin + started, finished: performance.timeOrigin + performance.now() },
      bytes: storage.byteLength,
    }, [storage.buffer]);
  } catch (error) {
    if (!abort.signal.aborted) self.postMessage({ type: 'error', requestId: data.requestId, error: String(error.message || error) });
  } finally {
    // Aborting fetch cannot interrupt crypto.subtle.digest. Acknowledge only
    // after authentication/validation has returned and all local byte owners
    // have been released, so the main thread retains its slot and reservation.
    asset = null; storage = null; pending.delete(data.requestId);
    if (abort.signal.aborted) self.postMessage({ type: 'cancelled', requestId: data.requestId });
  }
};
