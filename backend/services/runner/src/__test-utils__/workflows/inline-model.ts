/**
 * Test-only workflow: runs the engine on a model the caller hands it.
 *
 * The golden E2E (`src/__tests__/golden-e2e.test.ts`) and the engine's
 * unit test (`src/workflows/__tests__/engine-inline-model.test.ts`) drive
 * the engine with a materialized {@link ExecuteServerlessWorkflowInput}
 * and no server to hydrate from.
 * Production registers no such type. A worker that ran whatever model
 * arrived on its queue would let anyone who can reach Temporal run work
 * that no signed-in person asked for, so the production barrel
 * (`src/workflows/index.ts`) exports only the types the server starts.
 * This entry lives here, outside the published build (`tsconfig.build.json`
 * excludes `src/__test-utils__`), and is registered only by the test
 * barrel beside it, under a name outside the platform's `stigmer/`
 * namespace.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins, no non-deterministic operations, no
 * side-effecting imports.
 */

import { runWorkflowEngine } from "../../workflows/engine-core.js";
import type { ExecuteServerlessWorkflowInput } from "../../workflows/engine-core.js";
import { setupPauseResumeHandlers } from "../../workflows/workflow-signals.js";

/** The test barrel's name for this workflow; never a production type. */
export const INLINE_MODEL_WORKFLOW_TYPE = "test/workflow/execute-inline";

export async function executeInlineModel(
  input: ExecuteServerlessWorkflowInput,
): Promise<unknown> {
  const { checkPause } = setupPauseResumeHandlers();
  return runWorkflowEngine(input, { checkPause });
}
