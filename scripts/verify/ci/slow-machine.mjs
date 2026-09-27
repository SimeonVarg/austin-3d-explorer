/**
 * ci/slow-machine.mjs — give Playwright's OWN waits more time on a CI runner.
 *
 * Loaded ahead of a verify script with `node --import` (run-checks.mjs does it
 * when PW_DEFAULT_TIMEOUT_MS is set). It changes one thing: the default timeout
 * of every page and context the script opens, which is what page.screenshot(),
 * locator.click() and friends wait for when the script names no timeout.
 *
 * WHY. Playwright's default is 30 s. A GitHub runner has 4 cores and draws the
 * city in software, and on 2026-09-27 the first CI run saw page.screenshot()
 * time out at 30 s in five scripts ("taking page screenshot" with the fonts
 * already loaded: the frame itself had not arrived). That is the machine, not
 * the code under test.
 *
 * WHAT IT DOES NOT DO. It does not touch any timeout a script sets itself, any
 * threshold, any tolerance, or any assertion. A script that says "must settle
 * within 60 s" still has 60 s.
 */
import { chromium } from 'playwright-core';

const MS = Number(process.env.PW_DEFAULT_TIMEOUT_MS || 0);

if (MS > 0 && !chromium.__slowMachine) {
  chromium.__slowMachine = true;
  const patchContext = c => { try { c.setDefaultTimeout(MS); } catch (e) {} return c; };
  const patchBrowser = b => {
    const newPage = b.newPage.bind(b);
    b.newPage = async (...a) => { const p = await newPage(...a); patchContext(p.context()); p.setDefaultTimeout(MS); return p; };
    const newContext = b.newContext.bind(b);
    b.newContext = async (...a) => patchContext(await newContext(...a));
    return b;
  };
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...a) => patchBrowser(await launch(...a));
  const persistent = chromium.launchPersistentContext.bind(chromium);
  chromium.launchPersistentContext = async (...a) => patchContext(await persistent(...a));
}
