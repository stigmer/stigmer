# Fix: Stale Serverless Workflow YAML After Workflow Update

**Date**: May 23, 2026

## Summary

Fixed a critical bug where workflow updates (via apply/update) did not refresh the compiled CNCF Serverless Workflow YAML in `status.serverless_workflow_validation`. This caused executions to run with stale task names, wrong models, and missing harness configuration from the original workflow creation.

## Problem Statement

When a workflow was updated (e.g., renaming tasks, changing models, adding `harness: cursor`), the `spec.tasks` in MongoDB was correctly updated, but the `status.serverless_workflow_validation.yaml` — the actual YAML the runner executes — remained frozen from the original `create` call.

### Pain Points

- Workflow execution events showed old task names (e.g., `run_analyst` instead of `analyze_player_data`)
- Agent executions used wrong harness (Anthropic/native instead of Cursor)
- LLM calls used outdated models (e.g., `gpt-4o-mini` instead of `claude-haiku-4.5`)
- Frontend graph showed correct names (from `spec.tasks`) while events showed old names (from stale YAML)
- `$context` references in the YAML pointed to old task names, causing expression evaluation failures

## Solution

The `WorkflowUpdateHandler` pipeline was missing the `PopulateServerlessValidation` step that the `WorkflowCreateHandler` already had. The validation step (`ValidateWorkflowSpecStep`) correctly regenerated the YAML on update and stored it in gRPC context, but nothing read it back into `workflow.status` before persisting.

Extracted the step into a shared `PopulateServerlessValidationStep` class (typed with `ContextBase<Workflow, Workflow>`) and wired it into both Create and Update pipelines.

## Implementation Details

- **New file**: `PopulateServerlessValidationStep.java` — standalone step in the `steps/` package, typed with `ContextBase<Workflow, Workflow>` so it works in both `CreateContextV2` and `UpdateContextV2` pipelines
- **WorkflowUpdateHandler**: Injected the step and added it between `normalizeReferences` and `persist` (step 8 in the pipeline)
- **WorkflowCreateHandler**: Replaced the inner class `PopulateServerlessValidation` with the shared step; removed ~60 lines of duplicated code

The fix mirrors what the OSS Go backend already does via `newPopulateServerlessValidationStepForUpdate()` in `update.go`.

## Benefits

- Workflow updates now correctly regenerate the CNCF YAML that the runner executes
- Task name renames, model changes, and harness additions take effect on the next execution
- Frontend graph and execution events show consistent task names
- Deduplicates validation-population logic between Create and Update handlers

## Impact

- **Affected**: All workflows updated via apply/update in stigmer-cloud (task names, models, harness, context references were stale)
- **Fix scope**: stigmer-cloud Java backend only (3 files changed, 1 new file)
- **Backfill**: Existing workflows with stale YAML need a re-apply after deployment to regenerate

---

**Status**: ✅ Production Ready
