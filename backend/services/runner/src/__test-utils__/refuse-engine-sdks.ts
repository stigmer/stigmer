/**
 * Loaded with `--import` into a runner process under test
 * (`__tests__/harness-boot-order.test.ts`): a resolve hook that refuses the
 * engines' SDKs, `@cursor/sdk` and `deepagents`, so a runner that loads one
 * fails at that import, naming it. The agent host the runner starts is
 * spawned without this flag and loads them as it always does.
 */

import { register } from "node:module";

const hook = `
export async function resolve(specifier, context, next) {
  if (/^(@cursor\\/sdk|deepagents)(\\/|$)/.test(specifier)) {
    throw new Error("the runner process imported " + specifier + ", an engine SDK that belongs to the agent host");
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);
