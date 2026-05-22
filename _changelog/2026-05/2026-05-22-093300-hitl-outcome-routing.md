# HITL Human Input Outcome Routing

**Date**: May 22, 2026

## Summary

Implemented outcome-based flow routing for human_input tasks so that when a reviewer selects an outcome with a `then` field, the workflow engine jumps to the target task instead of continuing sequentially. Also fixed a latent data-loss bug where output/export processing was skipped whenever a dynamic flow directive was present.

## Problem Statement

The `TestWorkflowHITL_HumanInputOutcomeRouting` integration test defines a human_input task with outcomes that include routing directives (e.g., `needsRevision → then: "gatherMore"`). When a reviewer selected such an outcome, the engine ignored the `then` field and continued sequentially through the task list.

### Pain Points

- The `HumanInputOutcome` type declared `then?: string` and the loader parsed it correctly, but `executeHumanInputTask()` never consulted the outcome's `then` field after resolution
- The do-executor's existing dynamic routing mechanism (`__flow_directive__`) was only used by switch and validate tasks — human_input was not wired in
- The do-executor skipped `processTaskOutput()` and `processTaskExport()` whenever a `__flow_directive__` was present, causing data loss for tasks that produce both meaningful output and routing directives

## Solution

Two targeted changes in the TS runner engine:

1. **Outcome routing in human-input.ts**: After the human input resolves, look up the selected outcome in `config.outcomes`. If the matching outcome has a `then` field, include it as `__flow_directive__` in the returned output — the same mechanism used by switch and validate tasks.

2. **Reorder data vs routing in do-executor.ts**: Move `processTaskOutput` and `processTaskExport` calls before the flow directive check. This ensures output and export are always processed regardless of whether the task returns a routing directive. A `stripFlowDirective` helper removes the internal `__flow_directive__` key before storing in state, keeping workflow data clean.

## Implementation Details

### human-input.ts

After the result is stored in state via `addData`, the selected outcome is looked up by name. If it has a `then` field, the returned output includes `__flow_directive__` to trigger the do-executor's jump logic:

```typescript
const selectedOutcome = config.outcomes?.find(o => o.name === result.outcome);
if (selectedOutcome?.then) {
  return { ...result, __flow_directive__: selectedOutcome.then };
}
```

Edge cases handled: outcome with no `then` (sequential), `then: "end"` (terminate), outcome not found in config (graceful fallback to sequential).

### do-executor.ts

The executor loop was reordered from:

```
flow_directive_check → output/export → static_then_check
```

To:

```
output/export → flow_directive_check → static_then_check
```

A `stripFlowDirective` helper strips the `__flow_directive__` key from task output before it reaches `state.output` or `state.context`, preventing internal routing metadata from leaking into workflow state.

## Impact

- Fixes `TestWorkflowHITL_HumanInputOutcomeRouting` integration test
- Fixes a latent data-loss bug for `call-validate.ts` with `on_fail: BRANCH` (validation results were lost when branching to fallback)
- No changes to Go, Java, or test files — only 2 TS files in the runner engine modified
- All 65 existing unit tests pass (do-executor: 39, switch: 10, golden e2e: 16)

## Files Changed

| File | Change |
|------|--------|
| `backend/services/runner/src/workflow-engine/tasks/human-input.ts` | Add outcome-based routing via `__flow_directive__` |
| `backend/services/runner/src/workflow-engine/do-executor.ts` | Reorder output/export before directive check; add `stripFlowDirective` |

## Related Work

- Session 5: `_changelog/2026-05/2026-05-22-032331-integration-test-suite-session5-fixes.md` (TaskStatusAccumulator for WAITING_APPROVAL visibility)
- Session 4 triage: `_changelog/2026-05/2026-05-22-025000-integration-test-suite-session4-failure-report.md` (RC2: HITL tests)

---

**Status**: Production Ready
**Timeline**: ~30 minutes
