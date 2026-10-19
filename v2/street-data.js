// Both street batches use the same validated inventories. Share the request and parsed object, including while it is in flight.
const requests = new Map();
export function loadSafeStreet(name) {
  if (!['safe', 'safe_osm'].includes(name)) throw new Error('Unknown validated street inventory');
  if (!requests.has(name)) {
    const url = new URL(`./data/street/${name}.json`, import.meta.url).href;
    requests.set(name, fetch(url).then((r) => r.ok ? r.json() : null).catch(() => null));
  }
  return requests.get(name);
}
