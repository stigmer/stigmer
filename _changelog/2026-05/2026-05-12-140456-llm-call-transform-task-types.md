# Add llm_call and transform Workflow Task Types (T03 Batch 1)

**Date**: May 12, 2026

## Summary

Added two new AI-native workflow task types — `llm_call` and `transform` — as proto definitions with full codegen, validation wiring, and regenerated stubs across all five languages. Also extracted `OnInvalidOutputPolicy` to a shared `common.proto` to establish the right convention for cross-task shared types.

## Problem Statement

The existing 13 workflow task kinds cover CNCF Serverless Workflow primitives well but lack the primitives that make workflows AI-native. Many workflow decisions are too small for a full agent invocation (classification, extraction, scoring), and workflows frequently need to reshape data between tasks without LLM calls.

### Pain Points

- No way to make a lightweight LLM call without the overhead of a full agent (system prompt resolution, tool setup, MCP wiring, session management)
- No explicit, inspectable data transformation step — `set_vars` mutates state as a side effect and is invisible in the execution trace
- `OnInvalidOutputPolicy` was defined inside `agent_call.proto` but is semantically shared across any task type that validates LLM output against a schema

## Solution

Add `llm_call` (enum 14) for direct LLM calls and `transform` (enum 15) for deterministic data transformation, following the established proto-first development pattern. Extract the shared `OnInvalidOutputPolicy` enum to `common.proto` to support clean cross-task reuse.

## Implementation Details

### New Proto Files

- **`common.proto`**: Shared task enums, starting with `OnInvalidOutputPolicy` (moved from `agent_call.proto`). Establishes the convention for cross-task shared types ahead of Batch 2 (`validate` will follow the same pattern).

- **`llm_call.proto`**: `LlmCallTaskConfig` with 10 fields — model, system_prompt, prompt, response_schema (JSON Schema via `google.protobuf.Struct`), temperature (0.0–2.0 to accommodate all providers), max_tokens, timeout, on_invalid, max_retries, fallback_task. Reuses `OnInvalidOutputPolicy` from `common.proto`.

- **`transform.proto`**: `TransformEngine` enum (JQ, JSONata, Template) and `TransformTaskConfig` with 3 fields — engine, expression, input. Deliberately simple; the complexity lives in the runtime engine (T13).

### Modified Files

- `agent_call.proto`: Removed `OnInvalidOutputPolicy` definition, added import for `common.proto`
- `enum.proto`: Added `llm_call = 14` and `transform = 15` to `WorkflowTaskKind`
- `spec.proto`: Added kind-to-config mapping comments for both new types
- `unmarshal.go`: Added switch cases for both new task types in the validation pipeline
- `tasks/README.md`: Updated task definitions table (also added the missing `agent_call` row)

### Validation Constraints

- All `buf.validate` rules follow existing patterns: required fields, string length bounds, numeric ranges
- `TransformEngine` uses `defined_only: true, not_in: [0]` to reject `UNSPECIFIED`
- `is_expression` annotations on all fields that support `${ }` interpolation

## Benefits

- Workflows can now express lightweight AI decisioning (classification, scoring, routing) without agent overhead
- Data reshaping between tasks is an explicit, named, inspectable step in the execution trace
- The `common.proto` convention scales cleanly for Batch 2 and beyond
- All 5 language stubs (Go, Java, Python, TypeScript, Dart) regenerated and verified

## Impact

- **Proto API**: Two new task types available in the workflow DSL; no breaking changes to existing types
- **Workflow Runner (Go)**: Unmarshal switch cases wired; runtime implementation deferred to T13
- **Stigmer Service (Java)**: Stubs regenerated in stigmer-cloud; no service code changes needed yet
- **SDK / MCP Server / Codegen**: All downstream artifacts regenerated automatically

## Related Work

- T02 (Structured Agent Output Model) — established the `OnInvalidOutputPolicy` pattern
- T03 Batch 2 (human_input + validate) — next in queue
- T13 (Runtime Implementation) — will implement the actual Go Temporal activities for these task types

---

**Status**: ✅ Production Ready (proto + codegen layer; runtime is T13)
**Timeline**: Single session
