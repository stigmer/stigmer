# Normalize LLM Call Output to Match Documented Contract

**Date**: May 27, 2026

## Summary

Added a normalization layer in the workflow engine's `CallFunctionTaskBuilder` that transforms raw `LlmCallResult` activity output into the documented `{ text, structured, model, usage }` shape. This closes a runtime-vs-documentation gap where workflow authors using `${ .structured }` (as taught by docs, registry, and MCP tools) would get `null`.

## Problem Statement

The task-kind registry, per-task documentation, and MCP tools (`get_task_kind()`) all teach workflow authors that `llm_call` output has the shape `{ text, structured }`. However, the TypeScript runner's `CallLlm` activity returned `{ result, model, provider, input_tokens, output_tokens }` — an internal shape that was never normalized before reaching the export binding.

### Pain Points

- Workflow authors using `export: as: "${ .structured }"` on `llm_call` tasks (the documented pattern) got `null`
- The visual editor, workflow-architect agent, and all documentation sources taught a contract the runtime didn't honor
- Seedpack workflows using `$context.task.text` or `$context.task.structured` downstream were silently broken
- The gap was only discoverable through runtime debugging, not any tooling or validation

## Solution

Added `normalizeLlmOutput()` in `call-function.ts` that maps the activity result to the documented contract before the export expression is evaluated:
- `response_schema` present: `{ structured: <parsed JSON>, model, usage: { ... } }`
- No schema (prose): `{ text: <string>, model, usage: { ... } }`

Updated `extractCostFromOutput` to also check the nested `usage.input_tokens` / `usage.output_tokens` path for budget tracking.

## Implementation Details

- **Normalization function** in `call-function.ts` — clean, typed mapping applied only when `callType === "llm"`
- **Budget tracker** updated to check `usage.*` nested tokens as a fallback after top-level fields (non-breaking for `agent_call` and other task types that still use top-level fields)
- **No backward compatibility** for `.result` — clean break to match the documented contract exactly
- Internal `__stigmer_cost_micros` preserved at top level for budget tracking continuity

## Benefits

- The entire documentation chain (proto sidecar YAML → codegen → registry JSON → MCP tool → agent → customer workflow) is now consistent with runtime behavior
- Seedpack workflows that reference `.text` or `.structured` now work correctly
- Workflow authors can trust what the docs and tooling teach them

## Impact

- **All `llm_call` tasks** in all workflows — output shape changes from `{ result, ... }` to `{ text, structured, model, usage }`
- **Budget tracking** continues to work via the nested `usage` fallback path
- **Seedpack workflows** (`content-review-pipeline`, `support-ticket-triage`, `research-and-summarize`) now produce correct downstream context values

---

**Status**: Production Ready
**Timeline**: ~15 minutes
