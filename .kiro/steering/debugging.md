# Debugging Standards

## Diagnose before acting

Before writing any fix for a bug:

1. **Trace the execution path in full** using the actual source code. Read every relevant file. Follow the call chain from trigger to symptom.
2. **Identify one specific, concrete cause** — a line number, a condition, a sequence — before writing any code.
3. **If you cannot determine the cause from static analysis alone**, instrument the code with targeted logging and deploy it. Get real runtime data before fixing anything.
4. **Never write a fix while still uncertain.** If the analysis produces multiple candidate causes, say so clearly and explain which one you are testing first and why.

## Language standards

- Do not use confident language ("the real culprit is", "actually it's", "wait it's simple") when the diagnosis is still in progress.
- State your certainty level plainly. "I traced the full execution path and the cause is X at line Y" is correct. "I think it might be X" is also correct. Hedging with confident-sounding language while still guessing is not acceptable.
- If a previous hypothesis was wrong, say it was wrong and why, then state the new one.

## The "flash then disappear" pattern

This symptom — elements visible briefly then gone — almost always means one of:
1. Something removes them **after** they load (an async event, a second style mutation)
2. Their opacity/visibility is being set to 0/hidden by a separate code path that runs after initial render

When you see this, the first diagnostic step is always: instrument every code path that **removes or hides** the element, and log when `styledata` fires relative to when layers are added. Do not guess at which code path is guilty.
