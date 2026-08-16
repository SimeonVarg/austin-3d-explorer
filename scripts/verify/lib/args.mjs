/**
 * lib/args.mjs — say what you need instead of throwing ENOENT at the reader.
 *
 * WHY. The 2026-08-16 suite inventory found five screenshot tools —
 * `crop.mjs`, `dkrdiag.mjs`, `drag-shot.mjs`, `gallery.mjs`, `isolate.mjs` —
 * that die inside the first second with a raw `readFileSync(undefined)` stack
 * trace when run with no arguments. They are not broken; they simply have no
 * defaults and no usage line. But from the outside a Node stack trace is
 * indistinguishable from a crashing guard, and this suite has enough real
 * crashers that a reader triaging it cannot afford to spend a minute per file
 * working out which is which.
 *
 * A tool that cannot tell you how to run it is, for triage purposes, broken.
 */
import fs from 'node:fs';

/** Exit 2 with a usage line. 2, not 1: 1 means "the thing I guard is wrong". */
export function usage(lines) {
  console.error('Usage: ' + [].concat(lines).join('\n       '));
  process.exit(2);
}

/**
 * Read a shots JSON that the caller MUST supply.
 * @param {string|undefined} p     the argv slot
 * @param {string|string[]} lines  the usage text to print when it is missing
 */
export function requireShots(p, lines) {
  if (!p) usage(lines);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`Cannot read shots file "${p}": ${e.message}`);
    process.exit(2);
  }
}
