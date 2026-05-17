# Workflow P0 Task Types — Backend Implementation (Go)

**Date**: May 13, 2026

## Summary

Implemented runtime execution for 6 new AI-native workflow task types (transform, validate, emit_event, notification, llm_call, human_input) in the Go workflow-runner, completing T13 of the Bring Workflows to Foreground project. This includes the converter pipeline, shared infrastructure (budget tracker, event emitter, LLM provider abstraction), and dynamic branch routing — making the workflow engine capable of executing the full range of P0 task types defined in Phase 0 (T02–T07).

## Problem Statement

The workflow-runner could only execute the original CNCF Serverless Workflow task types (http_call, grpc_call, set_vars, switch, etc.) plus agent_call. The 6 new AI-native task types defined in T03 had proto contracts but no runtime implementation — workflows using llm_call, transform, human_input, validate, emit_event, or notification would fail at execution time.

### Pain Points

- Workflows with AI-native tasks (classification, validation, approval gates) had no runtime
- The execution viewer (T09) and list pages (T08) showed stubs against UNIMPLEMENTED backends
- Budget enforcement primitives (T05) and event stream model (T06) had no runtime wiring
- No Go LLM client existed — llm_call was entirely greenfield

## Solution

Extended the workflow-runner following the established `agent_call` pattern: each new task type maps to `model.CallFunction` with a custom `call` name, flows through the converter pipeline (proto → YAML → SDK → builder → activity), and executes via Temporal activities. Added shared infrastructure packages for cross-cutting concerns.

## Implementation Details

### Task Types Implemented (6)

| Task Kind | Engine/Provider | Pattern |
|-----------|----------------|---------|
| `transform` | gojq (JQ), text/template | Activity-based |
| `validate` | jsonschema/v6 (Draft 2020-12), gojq (rules) | Activity-based |
| `emit_event` | CloudEvents envelope construction | Activity-based |
| `notification` | Webhook provider (extensible interface) | Activity-based |
| `llm_call` | OpenAI + Anthropic Go clients | Activity-based |
| `human_input` | Temporal signals + timer | Signal-based (no activity) |

### Infrastructure Packages (4 new)

- **`pkg/budget/`** — Budget accumulator tracking cost_micros, total_tokens, elapsed duration against WorkflowBudget limits
- **`pkg/events/`** — Typed event builder creating WorkflowExecutionEvent protos with auto-incrementing sequence numbers
- **`pkg/llm/`** — LLMProvider interface with OpenAI and Anthropic implementations, prefix-based model resolution
- **`pkg/notification/`** — NotificationProvider interface with webhook implementation

### Core Executor Enhancement

Modified `DoTaskBuilder.runTask` to detect and return `__stigmer_branch_override` from task output, enabling dynamic flow routing for validate (fallback_task), llm_call (fallback_task), and human_input (outcome.then). This is a clean extension of the existing flow directive system.

### Converter Pipeline

Added 6 new converter methods and dispatch entries, completing the proto → YAML → execution pipeline for all P0 task kinds.

## Benefits

- **Workflow engine completeness**: All P0 task types from T03 now have runtime implementations
- **AI-native primitives**: LLM calls, structured output validation, and human approval gates work end-to-end
- **Extensible infrastructure**: Provider interfaces for LLM and notification allow adding vendors without changing task logic
- **Zero regressions**: All existing tests pass; existing task types unaffected

## Impact

- **workflow-runner**: 20 new files, 5 modified files, 3 new dependencies
- **Execution viewer (T09)**: Can now render real task execution data instead of handling UNIMPLEMENTED
- **Future tasks (T10–T14)**: Backend is now ready to support YAML editor, run-from-UI, and CLI parity
- **Java/Cloud (T13b)**: Go implementation validates the approach; Java parity follows the same contracts

## Related Work

- T02: Structured Agent Output Model (output contracts used by llm_call)
- T03: P0 New Task Types (proto definitions implemented here)
- T04: Task Schema Registry (registry metadata for all task kinds)
- T05: Workflow Budget Primitives (budget tracker implements these)
- T06: Execution Event Stream Model (event emitter implements these)
- T07: Artifact Store (artifact_ids on task output)
- T08: Workflow List & Detail Pages (UI consuming these APIs)
- T09: Execution Viewer (timeline events from these task types)

---

**Status**: ✅ Production Ready (Go workflow-runner)
**Timeline**: Single session
**Project**: 20260508.01.bring-workflows-to-foreground
