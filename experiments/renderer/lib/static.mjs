/** Tiny static file server for the harness: /exp/* -> experiments/renderer/*, /data/* -> the private output folder, /libs/* -> cached library files. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, PRIVATE } from './app.mjs';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.css': 'text/css', '.png': 'image/png' };
export function startStatic(port = 8498) {
  const roots = { '/exp/': path.resolve(HERE, '..'), '/data/': PRIVATE, '/libs/': path.join(PRIVATE, 'libs') };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    for (const [pre, root] of Object.entries(roots)) {
      if (!url.startsWith(pre)) continue;
      const f = path.resolve(root, url.slice(pre.length));
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) break;
      // a precompressed sibling (file.br) is sent as Content-Encoding: br, as a real host would send it
      const br = fs.existsSync(f + '.br') && /\bbr\b/.test(req.headers['accept-encoding'] || '');
      const send = br ? f + '.br' : f;
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': fs.statSync(send).size, ...(br ? { 'Content-Encoding': 'br' } : {}) });
      fs.createReadStream(send).pipe(res); return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
