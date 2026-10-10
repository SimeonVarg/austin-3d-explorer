/**
 * lib/appkey.mjs - the name of "the app these pictures were shot from". Pure Node + git; no browser.
 *
 * The key changes when ANY of these change: the git commit of the checkout, the content of any uncommitted change (or untracked
 * file) under the paths the page serves (js, css, style.css, index.html, data), the page flags, the viewport, software or
 * hardware GL, or the camera list. compare.mjs keeps the app's pictures in compare-app-<key>/ and refuses to score against a folder
 * of another key, so a stale app side can no longer be mistaken for the current one.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SERVED = ['js', 'css', 'style.css', 'index.html', 'data'];

export function appKey({ repo, query, viewport, software, poses }) {
  const git = (...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } };
  const commit = (git('rev-parse', 'HEAD') || '').trim();
  if (!commit) throw new Error('cannot read this checkout\'s git commit, so the app pictures cannot be keyed; refusing to guess');
  const changes = git('diff', 'HEAD', '--', ...SERVED) ?? '';
  const untracked = (git('ls-files', '--others', '--exclude-standard', '--', ...SERVED) || '').trim();
  const sha = x => crypto.createHash('sha1').update(x).digest('hex');
  const untrackedContent = untracked ? sha(untracked.split('\n').map(f => { try { return f + ':' + sha(fs.readFileSync(path.join(repo, f))); } catch (e) { return f; } }).join('|')) : '';
  const key = sha(JSON.stringify([commit, sha(changes), untracked, untrackedContent, query, viewport, !!software, (poses || []).map(p => [p.name, p.center, p.zoom, p.pitch, p.bearing, p.p])])).slice(0, 12);
  return { key, commit, dirty: !!(changes || untracked) };
}
