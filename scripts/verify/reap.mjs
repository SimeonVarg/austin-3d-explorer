/**
 * reap.mjs — kill headless verification browsers, and NOTHING else.
 *
 * Insurance. chrome.mjs's launch() now closes the browser on exit, on a signal,
 * on a throw, and on a watchdog, so orphans should not happen. They did once:
 * thirty-eight of them accumulated across a session of verification runs and
 * took the machine to 100% CPU and memory. One belt-and-braces command is worth
 * having.
 *
 * The important part is what it does NOT kill. Every process launched here
 * carries `--enable-unsafe-swiftshader`, which no ordinary browser sets, so that
 * flag is the filter. Your own Chrome — with your tabs in it — is never touched.
 *
 * Usage:  node scripts/verify/reap.mjs [--dry]
 */
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const MARK = 'enable-unsafe-swiftshader';
const win = process.platform === 'win32';

function victims() {
  if (win) {
    // CommandLine is the only place the flag appears, so query on it directly.
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process ' +
      "-Filter \\\"Name='chrome.exe' OR Name='msedge.exe'\\\" | " +
      `Where-Object { $_.CommandLine -like '*${MARK}*' } | ` +
      'Select-Object -ExpandProperty ProcessId"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\s+/).filter(Boolean);
  }
  const out = execSync(`ps -eo pid,args | grep -- ${MARK} | grep -v grep || true`,
                       { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map(l => l.trim().split(/\s+/)[0]);
}

let pids = [];
try { pids = victims(); } catch (e) { console.error('could not enumerate:', e.message); }

if (!pids.length) {
  console.log('no headless verification browsers running — nothing to reap');
} else if (DRY) {
  console.log(`would kill ${pids.length}: ${pids.join(' ')}`);
} else {
  for (const pid of pids) {
    try {
      execSync(win ? `taskkill /F /PID ${pid} /T` : `kill -9 ${pid}`,
               { stdio: 'ignore' });
    } catch (e) { /* already gone */ }
  }
  console.log(`reaped ${pids.length} headless verification browser process(es)`);
}
