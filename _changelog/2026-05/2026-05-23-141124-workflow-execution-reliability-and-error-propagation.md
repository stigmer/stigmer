# Workflow Execution Reliability and Error Propagation Fixes

**Date**: May 23, 2026

## Summary

Fixed five categories of workflow execution issues spanning error propagation, validation gaps, env forwarding, YAML authoring bugs, and sidebar UX latency. The most critical fix prevents failed agent executions from being silently reported as "completed" in parent workflows — a bug that caused downstream tasks to run with garbage/empty data.

## Problem Statement

The `daily-notification-plan` workflow execution revealed cascading failures across the platform: the agent execution failed (MCP server couldn't resolve), but the parent workflow reported the task as "completed" and continued with empty data. Investigation uncovered five distinct issues.

### Pain Points

- **Silent failure propagation (P0)**: `ExecuteDeepAgent` returns `EXECUTION_FAILED` phase instead of throwing. Both Go and Java orchestrators treated this as a successful activity return, completing the parent callback with success. Failed agents silently passed as "completed" in the parent workflow.
- **No reference validation at apply time (P1)**: Agent creation accepted nonexistent MCP server slugs silently. `MergeMcpServerEnvSpecs` was intentionally lenient, and `mcp-resolver.ts` swallowed resolution failures at runtime.
- **Workflow env not forwarded to child agents (P1)**: `CallAgent` only forwarded task-config-level env, not the workflow's runtime env. Workflow authors had to redundantly declare every env var on every `agent_call` task.
- **Wrong expression variable in YAML (P2)**: Workflow used `$context.env.NOTIFICATION_DATE` but should use `$env.NOTIFICATION_DATE`. `$context` holds task outputs, not env vars.
- **Sidebar not refreshing on execution navigation (P2)**: Sidebar only refetched when navigating to sessions, not workflow executions.

## Solution

Five-phase implementation addressing each issue independently with no cross-dependencies between phases:

1. **Error propagation fix** — Both Go and Java orchestrators now check `finalStatus.phase == EXECUTION_FAILED` and route to the failure path instead of the success path.
2. **Reference validation** — New `ValidateReferencesStep` in the agent create/update pipeline rejects agents with nonexistent MCP server references at apply time with `FAILED_PRECONDITION`.
3. **Env forwarding** — Automatic intersection forwarding in `call-agent.ts`: workflow env vars matching the child agent's declared `spec.env` keys are auto-forwarded.
4. **YAML fixes + guardrail** — Fixed 4 YAML files in tiny-tactics. Added `CheckExpressionWarnings` to the workflow validator that warns on `$context.env.*` usage.
5. **Sidebar refresh** — Both desktop and web sidebars now track `activeExecutionId` and refetch on `/executions/:id` navigation.

## Implementation Details

### Phase 1: Error Propagation (Dual-Edition)

**Go OSS** (`invoke_workflow_impl.go`): Both `executeDeepAgentFlow` and `executeCursorFlow` already detected `EXECUTION_FAILED` and persisted status as fallback, but returned `nil`. Changed to return `fmt.Errorf("agent execution failed: %s", finalStatus.GetError())`, routing `Run()` to the failure path which completes the external activity callback with an error.

**Java Cloud** (`InvokeAgentExecutionWorkflowImpl.java`): Added phase check before the callback completion block in both `executeDeepAgentFlow` (line ~689) and `executeCursorFlow` (line ~947). When `EXECUTION_FAILED`, calls `failExternalActivity` and throws `RuntimeException`.

**Integration test**: `TestWorkflowAgentCall_ChildFailurePropagates` — creates agent with nonexistent MCP server ref, wraps in workflow, asserts `EXECUTION_FAILED` phase and `WORKFLOW_TASK_FAILED` task status.

### Phase 2: ValidateReferencesStep

New generic pipeline step that walks all `ApiResourceReference` messages in the spec via proto reflection (reusing `NormalizeReferencesStep`'s traversal pattern). Validates MCP server references via `FindResourceBySlug`. Returns `FAILED_PRECONDITION` with actionable message listing all missing servers.

Wired after `NormalizeReferencesStep`, before `MergeMcpServerEnvSpecs` in both create and update pipelines. 8 unit tests with mock store covering valid refs, missing refs, cross-org, wrong-org, multiple missing, no-refs, empty slug, and skill refs not validated.

### Phase 3: Env Forwarding

After resolving the agent by reference, iterates `agent.spec.env` declarations and auto-forwards matching workflow runtime env vars to `executionRuntimeEnv`. Task-config-level `env` takes precedence (applied after auto-forwarded values).

### Phase 4: YAML Fixes + Expression Guardrail

Fixed `notification-analyst.yaml` and `notification-engineer.yaml`: `slug: mcp-server-postgres` → `slug: postgres`, added `org: stigmer`. Fixed `daily-notification-plan.yaml` and `risk-escalation.yaml`: `$context.env.*` → `$env.*` (6 occurrences total).

New `CheckExpressionWarnings` function scans task configs for `$context.env.*` patterns and emits validation warnings.

### Phase 5: Sidebar Refresh

Both desktop and web sidebars now derive `activeExecutionId` from `/executions/:id` paths. The refetch `useEffect` triggers on both `activeSessionId` and `activeExecutionId` changes, with the same staggered refetch pattern (8s + 18s).

## Benefits

- **No more silent failures**: Parent workflows correctly fail when child agent executions fail, preventing downstream tasks from running with empty data
- **Fail-fast validation**: Invalid MCP server references caught at agent creation time with actionable error messages, not at runtime
- **Reduced YAML boilerplate**: Workflow env vars automatically flow to child agents that declare matching keys
- **Better authoring experience**: Expression warnings catch the common `$context.env` mistake at validation time
- **Responsive sidebar**: Workflow execution navigation now updates the recents list

## Impact

- **Platform correctness**: Go OSS and Java Cloud orchestrators
- **Developer experience**: Agent apply pipeline, workflow YAML validation
- **User experience**: Desktop and web sidebar refresh
- **Demo project**: Tiny-tactics notification workflow and agent YAMLs

## Related Work

- Preceded by `fix(backend/runner): fix agent_call routing under session/execution routing` (ab479437b)
- Implements decisions from the workflow UX overhaul brainstorming session (`_projects/2026-05/20260523.01.workflow-ux-overhaul/`)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (analysis + implementation across 4 repos)
