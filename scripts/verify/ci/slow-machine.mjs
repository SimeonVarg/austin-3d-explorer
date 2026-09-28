/**
 * ci/slow-machine.mjs — give Playwright's own WAITS more time on a CI runner.
 *
 * Loaded ahead of a verify script with `node --import` (run-checks.mjs and
 * pictures.mjs do it when PW_DEFAULT_TIMEOUT_MS is set). Two things change,
 * both about how long Playwright waits for the page, neither about what any
 * check asserts:
 *
 *   PW_DEFAULT_TIMEOUT_MS   the default timeout of every page and context,
 *                           which is what page.screenshot(), locator.click()
 *                           and friends wait for when the script names none.
 *   PW_WAIT_SCALE           multiplies the timeout a script DOES name on the
 *                           calls that wait for the page to get somewhere:
 *                           goto, waitForFunction, waitForSelector,
 *                           waitForLoadState, waitForURL, waitForEvent.
 *
 * WHY. A GitHub runner has 4 cores and draws the city in software at 0.2-0.4
 * frames a second, against 3.7 on the owner's laptop, and its page load swings
 * from 50 s to 99 s run to run. On 2026-09-27 the CI runs saw page.screenshot()
 * time out at Playwright's 30 s default in five scripts, and banding.mjs, green
 * three times, went red once on its 60 s wait for the page to open. Those are
 * the machine, not the code.
 *
 * WHAT IT DOES NOT TOUCH. Any assertion, threshold or tolerance; any clock a
 * script reads itself ("retint within 2500 ms"); any in-page timer ("did not
 * settle within 60 s"); waitForTimeout sleeps. Those are the checks' own
 * business, and the ones that cannot pass at this frame rate are quarantined
 * in checks.json instead.
 */
import { chromium } from 'playwright-core';

const MS = Number(process.env.PW_DEFAULT_TIMEOUT_MS || 0);
const SCALE = Number(process.env.PW_WAIT_SCALE || 1);

// Position of the options argument for each waiting call.
const WAITS = { goto: 1, waitForFunction: 2, waitForSelector: 1, waitForLoadState: 1, waitForURL: 1, waitForEvent: 1 };

function patchPage(p) {
  if (!p || p.__slowMachine) return p;
  p.__slowMachine = true;
  if (MS > 0) p.setDefaultTimeout(MS);
  if (SCALE > 1) {
    for (const [name, at] of Object.entries(WAITS)) {
      const orig = p[name]?.bind(p);
      if (!orig) continue;
      p[name] = (...a) => {
        const o = a[at];
        if (o && typeof o === 'object' && typeof o.timeout === 'number' && o.timeout > 0) {
          a[at] = { ...o, timeout: o.timeout * SCALE };
        }
        return orig(...a);
      };
    }
  }
  return p;
}
function patchContext(c) {
  if (!c || c.__slowMachine) return c;
  c.__slowMachine = true;
  if (MS > 0) { try { c.setDefaultTimeout(MS); } catch (e) {} }
  c.on('page', patchPage);
  const newPage = c.newPage.bind(c);
  c.newPage = async (...a) => patchPage(await newPage(...a));
  return c;
}

if ((MS > 0 || SCALE > 1) && !chromium.__slowMachine) {
  chromium.__slowMachine = true;
  const patchBrowser = b => {
    const newPage = b.newPage.bind(b);
    b.newPage = async (...a) => { const p = await newPage(...a); patchContext(p.context()); return patchPage(p); };
    const newContext = b.newContext.bind(b);
    b.newContext = async (...a) => patchContext(await newContext(...a));
    return b;
  };
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...a) => patchBrowser(await launch(...a));
  const persistent = chromium.launchPersistentContext.bind(chromium);
  chromium.launchPersistentContext = async (...a) => patchContext(await persistent(...a));
}
