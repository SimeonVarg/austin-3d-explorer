/**
 * cdp.mjs — a small Chrome DevTools Protocol client with no dependency.
 * Uses the global WebSocket when Node has one (22+) and lib/ws.mjs otherwise.
 *
 * WHY NOT PLAYWRIGHT. Playwright's page-scoped CDP session cannot send a command to a CHILD target
 * (a worker), so it cannot see MapLibre's worker fetches (about 19 MB of a cold load, see
 * scripts/verify/README.md) or profile the facade-paint workers. This client talks to the browser
 * endpoint over one WebSocket and routes every command by sessionId, so a page, its dedicated
 * workers and their network traffic are all visible. 
 *
 *   const chrome = await startChrome({ gl: 'hardware', width: 1280, height: 800 });
 *   const page = await chrome.newPage();          // { send, on, sessionId }
 *   await page.send('Page.enable');
 *   await chrome.close();
 *
 * Chrome is launched with a FRESH user-data-dir, so its HTTP cache starts empty (a "cold" load).
 * It is always killed: on exit, on SIGINT/SIGTERM and by a watchdog (`maxMs`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MiniWebSocket } from './ws.mjs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
export const chromeBinary = () => CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

export class Session {
  constructor(conn, sessionId) { this.conn = conn; this.sessionId = sessionId; this.handlers = new Map(); this.children = new Map(); }
  send(method, params = {}) { return this.conn.send(method, params, this.sessionId); }
  on(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
  emit(event, params) { for (const fn of this.handlers.get(event) || []) { try { fn(params); } catch (e) { console.error('[cdp handler]', event, e.message); } } }
}

class Conn {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.sessions = new Map();
    this.root = new Session(this, undefined); this.sessions.set(undefined, this.root);
    ws.addEventListener('message', ev => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id != null) {
        const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
        m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
      } else {
        const s = this.sessions.get(m.sessionId); if (s) s.emit(m.method, m.params);
      }
    });
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  session(id) { if (!this.sessions.has(id)) this.sessions.set(id, new Session(this, id)); return this.sessions.get(id); }
}

export async function startChrome(opts = {}) {
  const gl = opts.gl || 'hardware';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-chrome-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-component-update', '--disable-default-apps', '--metrics-recording-only',
    // Chrome throttles timers and rAF in a window it thinks is hidden; that would make a frame interval
    // a multiple of 20 ms (scripts/verify/README.md, outer-perf incident).
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
    `--window-size=${opts.width || 1280},${opts.height || 800}`,
    ...(opts.vsync === 'off' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
    ...(gl === 'hardware'
      ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    // a root user (a rented machine) cannot start Chrome's sandbox
    ...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []),
    ...(opts.args || []),
    'about:blank',
  ];
  const proc = spawn(opts.binary || chromeBinary(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; proc.stderr.on('data', d => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  let closed = false;
  const kill = () => { if (closed) return; closed = true; try { proc.kill('SIGKILL'); } catch (e) {} setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }, 500); };
  process.once('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { kill(); process.exit(130); });
  const wd = setTimeout(() => { console.error('[cdp] watchdog: killing Chrome'); kill(); }, opts.maxMs || 600000); wd.unref?.();

  // Chrome writes the debugging port to <user-data-dir>/DevToolsActivePort
  let wsUrl = null;
  for (let i = 0; i < 200 && !wsUrl; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { const [port, p] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${port}${p}`; } catch (e) {}
    if (proc.exitCode != null) throw new Error('Chrome exited: ' + stderr.slice(-500));
  }
  if (!wsUrl) { kill(); throw new Error('Chrome did not open a debugging port: ' + stderr.slice(-500)); }
  const ws = typeof WebSocket === 'function' ? new WebSocket(wsUrl) : new MiniWebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const conn = new Conn(ws);
  const version = await conn.root.send('Browser.getVersion');
  const pids = {};
  return {
    pid: proc.pid, version, root: conn.root, conn,
    async newPage() {
      const { targetId } = await conn.root.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await conn.root.send('Target.attachToTarget', { targetId, flatten: true });
      const s = conn.session(sessionId); s.targetId = targetId; return s;
    },
    /** Auto-attach to a page's dedicated workers (flatten). `onWorker(session, info)` runs before the worker resumes. */
    async followWorkers(page, onWorker) {
      page.on('Target.attachedToTarget', async ({ sessionId, targetInfo }) => {
        const child = conn.session(sessionId); child.info = targetInfo; page.children.set(sessionId, child);
        try { await onWorker(child, targetInfo); } catch (e) { console.error('[cdp worker setup]', e.message); }
        try { await child.send('Runtime.runIfWaitingForDebugger'); } catch (e) {}
      });
      page.on('Target.detachedFromTarget', ({ sessionId }) => { const c = page.children.get(sessionId); if (c) c.detached = true; });
      await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    },
    async close() { try { await conn.root.send('Browser.close'); } catch (e) {} kill(); },
    kill,
  };
}

/** The machine's own load, printed beside every timing (a number without its conditions is not a measurement). */
export function machineLoad() {
  return { load1: +os.loadavg()[0].toFixed(1), cpus: os.cpus().length, freeGB: +(os.freemem() / 2 ** 30).toFixed(1) };
}
/** Seconds since the last keyboard or mouse event on this Mac (the owner-away check). null off macOS. */
export async function idleSeconds() {
  if (process.platform !== 'darwin') return null;
  const { execFileSync } = await import('node:child_process');
  try {
    const out = execFileSync('ioreg', ['-c', 'IOHIDSystem'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const m = out.match(/"HIDIdleTime" = (\d+)/); return m ? Math.floor(Number(m[1]) / 1e9) : null;
  } catch (e) { return null; }
}
