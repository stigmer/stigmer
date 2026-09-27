/**
 * Test-only workflow barrel: every production type, plus the inline-model
 * entry the goldens drive the engine through (`inline-model.ts` says why it
 * is test-only). Point a test worker's `workflowsPath` here instead of at
 * `src/workflows/index.ts` when a test hands the engine a model directly.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE applies (sandbox module).
 */

export * from "../../workflows/index.js";

// Equals INLINE_MODEL_WORKFLOW_TYPE in inline-model.ts, pinned by
// `workflows/__tests__/barrel.test.ts`: an ES2022 export alias must be a
// literal, so this line cannot import it.
export { executeInlineModel as "test/workflow/execute-inline" } from "./inline-model.js";
