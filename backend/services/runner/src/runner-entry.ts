/**
 * Where this build's own entry is, for a process that starts another copy
 * of it: the runner starts its agent host as `main.js agent-host`
 * (`agent-host/supervisor.ts`).
 *
 * The module sits at the source root, beside `main.ts`, because that is the
 * one place a relative URL resolves in every layout the runner ships: the
 * compiled tree (`dist/runner-entry.js` next to `dist/main.js`), the slim
 * bundle (every module is `main.js`, whose own URL the bundle defines), and
 * the source tree under tsx (`src/main.ts`, chosen by extension). The
 * library's embedders start the runner through its factories, from their
 * own script, so the running script's path is no guide.
 */

const SELF = new URL(import.meta.url);

/** `main.js` beside this module, or `main.ts` when running from source. */
export const RUNNER_ENTRY_URL = new URL(SELF.pathname.endsWith(".ts") ? "./main.ts" : "./main.js", SELF);
