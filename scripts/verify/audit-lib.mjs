/**
 * audit-lib.mjs — shared by the audit-*.mjs scripts.
 *
 * applySwaps(target): serve a local file in place of a site file, so a BEFORE
 * and an AFTER can be rendered from one checkout and one server.
 *
 *   AUDIT_SWAP="js/graphics.js=C:/x/main/graphics.js;js/lod.js=C:/x/main/lod.js"
 *
 * `target` is a Playwright page or browser context. Returns the list swapped,
 * which every script prints so a run always says which build it measured.
 */
import fs from 'node:fs';

export async function applySwaps(target) {
  const spec = process.env.AUDIT_SWAP;
  if (!spec) return [];
  const done = [];
  for (const part of spec.split(';').filter(Boolean)) {
    const [suffix, raw] = part.split('=');
    // Git Bash may hand over an MSYS path (/c/Users/...), which Node on
    // Windows reads as C:\c\Users. Convert the drive prefix.
    const file = raw.replace(/^\/([a-zA-Z])\//, '$1:/');
    const body = fs.readFileSync(file);
    await target.route(u => u.pathname.endsWith('/' + suffix), r => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
    done.push(suffix);
  }
  console.log('[audit] serving swapped: ' + done.join(', '));
  return done;
}
