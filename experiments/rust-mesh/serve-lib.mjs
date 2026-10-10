// A tiny static server for the browser benches: this folder at /, the repo at /repo/, a stream folder at /stream/, and the
// three.js file named by THREE_JS at /three.min.js. No compression, no caching, correct wasm MIME type.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.f64': 'application/octet-stream' };
export async function startServer(streamDir) {
  const roots = { '/stream/': streamDir ? path.resolve(streamDir) + '/' : null, '/repo/': repo + '/', '/': here + '/' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    let f;
    if (u === '/three.min.js' && process.env.THREE_JS) f = process.env.THREE_JS;
    else { const hit = ['/stream/', '/repo/', '/'].find(p => u.startsWith(p)); if (!roots[hit]) { res.writeHead(404); return res.end(); } f = path.normalize(roots[hit] + u.slice(hit.length)); if (!Object.values(roots).some(r => r && f.startsWith(r))) { res.writeHead(404); return res.end(); } }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream', 'content-length': fs.statSync(f).size, 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
