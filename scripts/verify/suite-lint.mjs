/**
 * suite-lint.mjs — the suite checking itself, in under a second.
 *
 * WHY THIS EXISTS. Commit 90ad9d7 routed all ~110 scripts through chrome.mjs's
 * new launch() helper. In fourteen of them it deleted the page-setup block along
 * with the old launch lines, so those scripts threw `page is not defined` before
 * doing any work — for a whole day, while reading as "the suite is there".
 *
 * A dead ruler is worse than no ruler: it teaches everyone that failures are
 * normal. Nothing caught it because nothing checks the CHECKERS. This does, and
 * it runs without opening a browser, so it costs nothing to run every time.
 *
 * It is deliberately a set of narrow, mechanical rules. It is not a linter and
 * should not grow into one — anything needing real type analysis belongs in a
 * script that actually runs.
 *
 * Usage: node suite-lint.mjs          (exit 1 on any finding)
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('.');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && f !== 'suite-lint.mjs');

const findings = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = src.split('\n');

  // ── 1. Uses `page` without ever declaring one. THE regression. ──────
  const usesPage = /(?<![\w.$])page\s*\./.test(src);
  const declaresPage =
    /(?<![\w.$])(?:const|let|var)\s+(?:\{[^}]*\bpage\b[^}]*\}|page)\s*[=,;]/.test(src) ||
    /function\s+\w*\s*\([^)]*\bpage\b/.test(src) ||
    /(?<![\w.$])page\s*=\s*await/.test(src) ||
    /\(\s*page\s*(?:,|\))\s*=>/.test(src) ||
    /import\s*\{[^}]*\bpage\b/.test(src);
  if (usesPage && !declaresPage) {
    const n = lines.findIndex(l => /(?<![\w.$])page\s*\./.test(l)) + 1;
    findings.push({ f, n, rule: 'no-page', msg: 'uses `page.` but never creates one — this is the 90ad9d7 regression' });
  }

  // ── 2. Launches a browser without going through launch(). ───────────
  // The watchdog and the reaper live in launch(). Thirty-eight orphaned
  // swiftshader Chromes once took the laptop to 100% CPU in the middle of a
  // deadline; bypassing launch() is how that comes back.
  // chrome.mjs is the helper itself; it is the one file that MUST call
  // chromium.launch directly. (It is also owned by another lane's open PR.)
  if (f !== 'chrome.mjs' && /chromium\.launch\(/.test(src) && !/from '\.\/chrome\.mjs'/.test(src)) {
    const n = lines.findIndex(l => /chromium\.launch\(/.test(l)) + 1;
    findings.push({ f, n, rule: 'raw-launch', msg: 'calls chromium.launch() directly — use launch() from chrome.mjs so the watchdog and reaper apply' });
  }

  // ── 3. Opens a browser and never closes it. ─────────────────────────
  // Match ANY receiver, not the name `browser`: fieldprobe.mjs calls
  // `await b.__done()` and an earlier version of this rule reported it as a
  // leak. A lint that cries wolf gets muted, which is the failure this file
  // exists to prevent.
  if (/await launch\(chromium/.test(src) && !/\.__done\s*\(|\.close\s*\(/.test(src)) {
    findings.push({ f, n: 0, rule: 'no-close', msg: 'launches a browser but never calls browser.__done()' });
  }

  // ── 4. Uses a binding before it is declared. ────────────────────────
  //
  // `node --check` cannot see this: a temporal-dead-zone error is a RUNTIME
  // error, so the file parses perfectly and then throws on the first line that
  // matters. A repair pass reordered these files and every one of the fourteen
  // died with "Cannot access 'browser' before initialization" — after parsing
  // clean AND passing every rule above. Twelve minutes of browser runs to learn
  // something a line-number comparison answers instantly.
  for (const v of ['browser', 'page']) {
    const declIdx = lines.findIndex(l => new RegExp(`\\b(?:const|let|var)\\s+${v}\\s*=`).test(l));
    // TOP-LEVEL uses only. A use inside a function body may well be a
    // PARAMETER shadowing the outer name — lod-perf.mjs takes `page` as an
    // argument and was reported as a violation by a first version of this rule.
    // A lint that cries wolf gets muted, which is the failure this file exists
    // to prevent.
    const useIdx = lines.findIndex((l, i) =>
      i !== declIdx && /^[a-zA-Z(]/.test(l) &&
      new RegExp(`(?<![\\w.$])${v}\\s*\\.`).test(l) && !/^\s*(\/\/|\*)/.test(l));
    if (declIdx >= 0 && useIdx >= 0 && declIdx > useIdx) {
      findings.push({ f, n: useIdx + 1, rule: 'use-before-decl',
        msg: `uses \`${v}\` at line ${useIdx + 1} but declares it at line ${declIdx + 1}` });
    }
  }

  // ── 5. Opens a browser and NEVER OPENS A PAGE. The husk rule. ───────
  //
  // ADDED 2026-08-16, and it is the same bug this file was written for, one
  // notch worse. `dusk.mjs`, `silhouette.mjs` and `banding.mjs` are each ~15
  // lines: a doc comment, `launch(chromium)`, and then `console.log(r.worst)`
  // for an `r` that is never assigned anywhere. The 90ad9d7 repair did not
  // merely delete their page setup — it deleted THE ENTIRE MEASUREMENT — and
  // every rule above passes them clean, including `no-page`, precisely BECAUSE
  // the deletion took the `page.` usages with it. Three of this suite's sky
  // assertions have therefore been dead since early August while reading as
  // "the suite is there", which is the exact sentence at the top of this file.
  //
  // The rule that catches it is the cheapest one here: a script that opens a
  // browser and never opens a page or navigates is not testing anything.
  if (/await launch\(chromium/.test(src) &&
      !/\.newPage\s*\(|\.goto\s*\(|newContext\s*\(/.test(src)) {
    findings.push({ f, n: 0, rule: 'no-navigate',
      msg: 'launches a browser but never opens a page or navigates — the body is missing, not just the setup' });
  }

  // ── 6, TRIED AND DELETED: "prints a result binding nothing assigns". ──
  // It looked like the other half of the husk (`console.log(r.worst)` with no
  // `r` anywhere) and it cried wolf immediately: 13 files on the raw source,
  // and still 17 after comments and string literals were stripped — including
  // `drag-perf.mjs`, `facade-perf.mjs` and `ground-flatness.mjs`, all healthy.
  // Separating a genuinely undefined binding from one assigned through a
  // destructure, a callback parameter or a nested scope needs real scope
  // analysis, which the header of this file says explicitly does not belong
  // here. Rule 5 above already catches all seven husks with no false positives,
  // so this one is deliberately absent rather than shipped noisy. Recorded so
  // the next person does not spend the same half hour rediscovering it.

  // ── 4. Drives the map without cancelling the auto-detect probe. ─────
  // It fires 11 s after load and rewrites every setting. Left running it lands
  // mid-test and reads as the lever under test being broken.
  const drivesMap = /window\.__map|__fly\b/.test(src);
  const cancels = /cancelGraphicsAutoDetect/.test(src);
  if (drivesMap && !cancels && /await launch\(chromium/.test(src)) {
    findings.push({ f, n: 0, rule: 'no-probe-cancel', msg: 'drives the map but never calls window.cancelGraphicsAutoDetect()' });
  }

  // ── 7. Prints a failure a caller can never see. ─────────────────────
  //
  // ADDED 2026-08-16 (§155). §149 DELETED `silhouette.mjs` partly for printing
  // `*FAIL` and then exiting 0 — and added no check, so the next one was free
  // to sit there. There were three: `sky.mjs`, `collision.mjs`, `night-sky.mjs`.
  //
  // `sky.mjs` is the worst of them, and it is not a hypothetical. On the night
  // this rule was written it was reporting **10/12, two red assertions about the
  // sun's own light direction, on the sky that had shipped hours earlier** — and
  // exiting 0. Every wrapper in this repo reads exit codes (`inventory.mjs`
  // classifies on them, §142 made them load-bearing), so those two failures were
  // invisible to everything except a human reading scrollback.
  //
  // A gate that cannot go red is not a weaker gate. It is decoration.
  const printsFail = lines.some(l => /console\.(log|error)/.test(l) &&
    /(\*FAIL|'FAIL|"FAIL|`FAIL| FAIL |FAIL\b.*\+)/.test(l));
  const canGoRed = /process\.exit\s*\((?!\s*0\s*\))|process\.exitCode\s*=\s*(?!0)/.test(src);
  if (printsFail && !canGoRed) {
    findings.push({ f, n: 0, rule: 'fail-exits-zero',
      msg: 'prints FAIL but has no path to a non-zero exit — no caller can ever see it go red' });
  }

  // ── 8. Loads the page without ?drift=0. ─────────────────────────────
  //
  // ADDED 2026-08-16 (§155). `js/app.js`'s idle cinema starts after
  // `DRIFT.idleMs = 25 s` of input silence and then, every `stepMs = 12 s` leg,
  // eases the BEARING by 13 deg, breathes the ZOOM by 0.05, and creeps the HOUR
  // by `pStep = 0.010`. A scripted run sends no pointer or key events, so the
  // countdown never re-arms: any script that jumps a camera and then works for
  // more than 25 s is being moved under its own feet.
  //
  // This is not a bug in the app — it is a shipped feature with a shipped
  // opt-out, and `js/app.js` says so in its own comment: "?drift=0 disables it
  // for scripted runs against index.html." 91 scripts pass it. 38 did not, and
  // the price was measured: `sky.mjs`'s setLight assertions, whose mismatch
  // wandered 0.92 / 1.20 / 4.82 deg run to run because it depended on whether a
  // 12-second leg had landed between the write and the read. `sunlight-probe.mjs`
  // caught the second writer red-handed — setLight called twice for one call,
  // az 118.8 then 120.88, `__todCurrentP` left at 0.11 for a p of 0.1.
  //
  // `drift-check.mjs` is the guard ON the idle cinema and is exempt by name.
  const loadsPage = /(?:index|_harness)\.html|page\.goto\(BASE/.test(src) && /page\.goto\s*\(/.test(src);
  if (loadsPage && !/drift=0/.test(src) && f !== 'drift-check.mjs') {
    findings.push({ f, n: 0, rule: 'no-drift-off',
      msg: 'loads the page without ?drift=0 — after 25 s idle the app moves the camera and the hour under it' });
  }
}

const byRule = {};
for (const x of findings) (byRule[x.rule] ||= []).push(x);

console.log(`suite-lint: ${files.length} scripts checked\n`);
const RULES = {
  'no-page': 'uses `page` without creating one  (BLOCKS THE SCRIPT ENTIRELY)',
  'raw-launch': 'bypasses launch() — no watchdog, no reaper',
  'no-close': 'never closes its browser',
  'use-before-decl': 'uses a binding before declaring it  (PARSES FINE, THROWS AT RUNTIME)',
  'no-navigate': 'opens a browser and never opens a page  (THE BODY IS MISSING)',
  'fail-exits-zero': 'prints FAIL but cannot exit non-zero  (A GATE THAT CANNOT GO RED)',
  'no-drift-off': 'loads the page without ?drift=0  (THE IDLE CINEMA MOVES IT AFTER 25 s)',
  'no-probe-cancel': 'does not cancel the graphics auto-detect probe',
};
let hard = 0;
for (const [rule, label] of Object.entries(RULES)) {
  const hits = byRule[rule] || [];
  // Only the first three are failures. The probe rule is advisory: a few
  // scripts legitimately measure the probe itself.
  const fatal = rule !== 'no-probe-cancel';
  if (fatal) hard += hits.length;
  console.log(`${hits.length ? (fatal ? '*FAIL ' : ' warn ') : ' PASS '} ${label} — ${hits.length}`);
  for (const h of hits) console.log(`         ${h.f}${h.n ? ':' + h.n : ''}  ${h.msg}`);
}
console.log(`\n${hard === 0 ? 'PASS' : '*FAIL'} — ${hard} blocking finding(s)`);
process.exitCode = hard ? 1 : 0;
