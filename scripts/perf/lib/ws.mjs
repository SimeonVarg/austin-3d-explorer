/**
 * ws.mjs — a tiny WebSocket client for Node versions older than 22 (no global WebSocket), enough for the
 * Chrome DevTools Protocol: text frames, masked client frames, fragmented and 64-bit-length server frames.
 * The AWS GPU runner installs whichever Node 18+ it finds, so scripts/perf cannot assume the global one.
 */
import http from 'node:http';
import crypto from 'node:crypto';

export class MiniWebSocket {
  constructor(url) {
    this.listeners = { open: [], message: [], error: [], close: [] };
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.on('upgrade', (res, socket, head) => {
      this.socket = socket; let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0); let frag = [];
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len); buf = buf.subarray(off + len);
          if (op === 8) { socket.end(); return; }
          if (op === 9) { this._frame(10, payload); continue; }
          if (op === 0 || op === 1 || op === 2) {
            frag.push(payload);
            if (fin) { const data = Buffer.concat(frag); frag = []; this.emit('message', { data: data.toString('utf8') }); }
          }
        }
      };
      socket.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
      socket.on('close', () => this.emit('close', {}));
      socket.on('error', e => this.emit('error', e));
      this.emit('open', {}); if (buf.length) pump();
    });
    req.on('error', e => this.emit('error', e));
    req.end();
  }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  emit(t, ev) { for (const fn of this.listeners[t] || []) fn(ev); }
  _frame(op, payload) {
    const mask = crypto.randomBytes(4), n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.concat([Buffer.from([0x80 | op, 0x80 | 126]), Buffer.from([n >> 8, n & 255])]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
    const body = Buffer.from(payload); for (let i = 0; i < n; i++) body[i] ^= mask[i & 3];
    this.socket.write(Buffer.concat([head, mask, body]));
  }
  send(text) { this._frame(1, Buffer.from(text, 'utf8')); }
}
