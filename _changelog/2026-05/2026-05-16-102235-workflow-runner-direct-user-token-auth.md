# Workflow Runner: Direct User-Token Auth (Remove OBO Impersonation)

**Date**: May 16, 2026

## Summary

Fixed the workflow-runner to authenticate gRPC calls using the user's own token (`STIGMER_TOKEN`, injected by the Daytona sandbox launcher) instead of a machine account token with `x-on-behalf-of` impersonation. This aligns the workflow-runner with how agent-runner and cursor-runner already operate — direct user identity, no impersonation.

## Problem Statement

After the sandbox integration (Phase 1-4b), each workflow execution gets its own Daytona sandbox with the invoking user's JWT injected as `STIGMER_TOKEN`. However, two issues remained:

### Pain Points

- `StigmerConfig.LoadStigmerConfig()` only read `STIGMER_API_KEY`, ignoring `STIGMER_TOKEN` — so gRPC clients never picked up the user's JWT that the launcher injected
- The `x-on-behalf-of` OBO impersonation header was still attached on user-facing reads, which is redundant when the Bearer token IS the user
- Inconsistency with agent-runner (Python) and cursor-runner (TypeScript), which both use direct user tokens with no OBO mechanism

## Solution

Two-part fix: (1) make `StigmerConfig` read `STIGMER_TOKEN` first (matching the launcher and other config loaders), and (2) remove the entire OBO plumbing since the Bearer token now carries the user's identity directly.

## Implementation Details

### Part 1: Fix Token Resolution

`StigmerConfig.LoadStigmerConfig()` now reads `STIGMER_TOKEN` first, falling back to `STIGMER_API_KEY` for backward compatibility. This matches the pattern already used by `LlmProxyConfig` and the claim check proxy config in the same codebase.

### Part 2: Remove OBO Plumbing

- **Deleted** `pkg/grpc_client/on_behalf_of.go` — the `WithOnBehalfOf` helper and `x-on-behalf-of` header constant
- **`execute_workflow_activity.go`** — removed `oboCtx` creation; all 5 gRPC reads (WorkflowInstance, Workflow, ExecutionContext) now use plain `ctx` which already carries the user's Bearer token
- **`task_builder_call_agent_activities.go`** — removed `invokerIdentityAccountID` parameter from `CallAgentActivity()` and `buildAuthenticatedContext()`; the latter now only attaches the Bearer token
- **`task_builder_call_agent.go`** — removed `getInvokerIdentityFromState()` function and the `invokerIdentityAccountID` plumbing from the activity call
- **`temporal_workflow.go`** — removed `__stigmer_invoker_identity_account` from workflow state data (no longer consumed)
- **`progress.go`** — updated `InvokerIdentityAccountID` field comment (kept for Temporal serialization compat, no longer drives auth)

### Fields Kept for Backward Compatibility

`InvokerIdentityAccountID` is retained in both `InvokeWorkflowExecutionWorkflowInput` and `TemporalWorkflowInput` structs because the Java orchestrator still sends this field via Temporal. The field is inert — no Go code reads it for auth purposes.

## Benefits

- **Correct auth**: gRPC calls now authenticate as the actual user who triggered the workflow, matching the sandbox launcher's intent
- **Consistency**: Workflow-runner follows the same direct-token pattern as agent-runner and cursor-runner
- **Simplicity**: Removed ~80 lines of OBO plumbing (helper file, context threading, state propagation, identity extraction)
- **FGA correctness**: Authorization checks happen against the real user identity from the Bearer token, not via a secondary impersonation header

## Impact

- **Workflow Runner**: All gRPC calls (reads and writes) now use the user's token directly
- **Java Side**: No changes needed — `DaytonaSandboxRunnerLauncher` already injects `STIGMER_TOKEN = userJwt`
- **Server Side**: The `x-on-behalf-of` interceptor infrastructure remains for other use cases but is no longer invoked by workflow-runner

## Related Work

- Workflow runner sandbox integration (2026-05-15, Phases 1-4b)
- Agent-runner direct-token pattern (`ChannelProvider` with no OBO)
- Fix on-behalf-of impersonation authorization gate (2026-03-26)

---

**Status**: Complete
**Timeline**: ~30 minutes implementation
