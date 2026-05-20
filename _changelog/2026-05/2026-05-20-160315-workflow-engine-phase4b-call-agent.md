# Workflow Engine Phase 4b: call:agent — Async Completion, HITL Signals, Structured Output

**Date**: May 20, 2026

## Summary

Implemented `call:agent` as a fully functional task type in the TypeScript workflow runner, introducing Temporal async completion, HITL signal handling for tool-approval propagation, and structured output validation with retry policies. This is the first workflow engine component that requires workflow-side Temporal primitives beyond simple activity proxying, establishing the architectural pattern for all future signal-aware task types.

## Problem Statement

The TypeScript workflow runner supported synchronous call tasks (HTTP, gRPC, LLM) but had no way to invoke Stigmer agents from workflows. Agent calls are fundamentally different — they don't return immediately. Instead, the activity creates an AgentExecution on the platform, hands off a Temporal task token, and waits for the platform to complete the activity asynchronously when the agent finishes. During this wait, tool-approval signals from the child agent must be surfaced on the parent workflow's status.

### Pain Points

- `call: agent` in YAML threw `CALL_AGENT_NOT_IMPLEMENTED` — blocking all agent-invoking workflows
- No async completion pattern existed in the TS runner — all activities were synchronous
- No signal handling infrastructure — HITL approval state from child agents couldn't propagate to parent workflows
- No structured output validation — agent results couldn't be validated against JSON Schemas within the workflow

## Solution

Implemented call:agent across five layers while preserving the kernel's Temporal-agnostic architecture:

1. **Kernel layer** — New `CallAgentTaskBuilder` with expression evaluation and structured output retry loop, dispatched via dedicated `call:agent` kind (not routed through generic `call:function`)
2. **Workflow layer** — Signal orchestrator module (`call-agent-orchestrator.ts`) that manages `child_approval_required` signal handling, condition loops, and local activity calls for approval status updates
3. **Activity layer** — CallAgent activity with Temporal async completion (extract task token, create Session + AgentExecution via platform gRPC, throw `CompleteAsyncError`)
4. **Platform integration** — Extended StigmerClient with agent resolution, session/execution creation, and workflow execution status updates via Connect-RPC
5. **Validation layer** — Sandbox-safe JSON Schema validator supporting ON_INVALID_RETRY (re-prompt with augmented message), ON_INVALID_FAIL, and ON_INVALID_FALLBACK (flow directive)

## Implementation Details

### Architecture: Kernel Purity Preserved

The key architectural decision: async completion and signal handling live in the workflow bundle (`workflows/call-agent-orchestrator.ts`), not in the Temporal-agnostic kernel. The kernel simply calls `ctx.callAgent()` — the same opaque callback pattern used by `callHttp`, `callGrpc`, and `callFunction`. This preserves the clean separation where the kernel has zero `@temporalio/workflow` imports.

### Files Created (8)

- `activities/call-agent.ts` — Async completion activity: task token extraction, gRPC sequence, `CompleteAsyncError`
- `activities/call-agent-status.ts` — Local activities for HITL approval status on WorkflowExecution
- `workflows/call-agent-orchestrator.ts` — Signal definition, handler, condition loop, local activity calls
- `workflow-engine/tasks/call-agent.ts` — Kernel task builder with expression evaluation and output retry
- `workflow-engine/tasks/call-agent-output.ts` — Lightweight JSON Schema validation (type, required, properties, enum)
- 2 test files with 23 new tests
- `test/golden/13-agent-call.yaml` — Code review triage pipeline (golden YAML #13)

### Files Modified (10)

- `types.ts` — `CallAgentTaskDef`, `callAgent` callback, agent call type hierarchy
- `loader.ts` — `call:agent` parsing with validation and harness normalization
- `task-factory.ts` — `call:agent` dispatch case
- `do-executor.ts` — `callAgent` stub in `buildMinimalContext`
- `stigmer-client.ts` — 4 new gRPC methods via Connect-RPC
- `execute-serverless-workflow.ts` — `callAgent` callback wiring to orchestrator
- `main.ts` — Activity registration
- 6 test files updated for `callAgent` compatibility

### Structured Output Validation

Kept sandbox-safe with a lightweight inline validator rather than adding an Ajv dependency. Validates object type, required fields, property types, and enum constraints — the subset actually used by agent output schemas. Full Ajv can be added later if Draft 2020-12 features ($ref, if/then/else) are needed.

## Benefits

- **Workflows can invoke agents** — the `call: agent` YAML task type now works end-to-end
- **HITL visibility** — tool-approval notifications from child agents surface on the parent workflow's status for UI display
- **Output contracts** — workflow authors can enforce structured output schemas on agent results with automatic retry
- **Pattern established** — async completion + signal handling architecture is reusable for future task types (`listen`, `wait`, `human_input`)
- **No regressions** — 1,159 tests passing, `tsc --noEmit` clean, no new dependencies

## Impact

- **Workflow authors**: Can now use `call: agent` tasks in YAML workflows to invoke any Stigmer agent with structured output validation
- **Platform operators**: HITL approval state propagates from child agents to parent workflow status
- **Future phases**: Phase 5 (try/catch, wait/listen, fork) is unblocked — signal handling infrastructure is in place
- **Go parity**: TS implementation matches Go behavioral parity plus structured output validation (which Go defers)

## Related Work

- Phase 4 (call:http, call:grpc, call:llm) — established the call task pattern this extends
- Phase 3 (expression engine) — provides the two-phase expression evaluation used by call:agent
- Go reference: `task_builder_call_agent.go` + `task_builder_call_agent_activities.go` (~1,218 lines)

---

**Status**: Production Ready
**Timeline**: Session 6 (May 20, 2026)
**Test Coverage**: 23 new tests, 1,159 total passing
