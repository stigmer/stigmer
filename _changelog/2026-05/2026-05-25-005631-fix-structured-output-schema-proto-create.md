# Fix Structured Output Schema Lost During Agent Execution Creation

**Date**: May 25, 2026

## Summary

Fixed the root cause of all structured output failures: `google.protobuf.Struct`
fields were silently dropped when the `CallAgent` activity created agent executions
using `@bufbuild/protobuf`'s `create()` with a plain `Record<string, unknown>` init
object. The schema never reached MongoDB, so the runner never attempted extraction,
and agents returned prose instead of JSON.

## Problem Statement

The `daily-notification-plan` workflow (and any workflow using `output.schema` on
`agent_call` tasks) failed with:

```
Agent output validation failed for task 'analyze_player_data':
Agent did not return structured output or parseable JSON in final_text
```

Four prior fix attempts (v1-v3) addressed extraction, Zod conversion, `slimStatus`
serialization, and callback data loss — but the workflow kept failing. MongoDB
queries revealed **zero** agent executions in the entire database ever had a
`structuredOutput` field, and crucially, `executionConfig.structuredOutputSchema`
was also missing from every execution spec.

### Pain Points

- 4+ fix attempts over 12+ hours, each addressing symptoms not the cause
- $3+ burned per retry loop on futile extraction (schema was never there)
- Runner logs showed `hasStructuredOutput=false` — extraction was never attempted
- Agents returned prose (no JSON schema instruction injected into prompt)

## Solution

### Root Cause: `create()` drops `Struct` fields from nested `Record<string, unknown>`

In `call-agent.ts`, the `executionConfig` was built as a plain
`Record<string, unknown>` and passed to `create(AgentExecutionSpecSchema, ...)`
via `as any` cast:

```typescript
// BROKEN: Struct field silently dropped by create()
let executionConfig: Record<string, unknown> | undefined;
executionConfig = {};
executionConfig.modelName = "claude-sonnet-4";           // string — survived
executionConfig.structuredOutputSchema = schema;          // Struct — DROPPED

create(AgentExecutionSpecSchema, {
    ...(executionConfig ? { executionConfig: executionConfig as any } : {}),
});
```

The `@bufbuild/protobuf` `create()` function handles scalar fields (`modelName`)
correctly but does not properly initialize `google.protobuf.Struct` fields when
they arrive inside a nested plain object with `as any` type erasure.

### Fix: Explicitly create the `ExecutionConfig` proto

```typescript
// FIXED: Explicit proto creation preserves Struct fields
const execConfig = create(ExecutionConfigSchema, {});
execConfig.modelName = resolved.config!.model!;
execConfig.structuredOutputSchema = resolved.output!.schema as JsonObject;
executionSpec.executionConfig = execConfig;
```

### Additional hardening

- Runner `execute-cursor` and `execute-deep-agent`: Added `slim.structured`
  as a plain JSON field on the activity return value (alongside the proto
  `structuredOutput` field), ensuring the callback path works even if proto
  `Struct` deserialization fails across the polyglot Temporal boundary.

- Go OSS `buildCallbackResult`: Fixed key lookup from `structured_output`
  (snake_case, wrong) to `structuredOutput` (camelCase, matches proto-JSON),
  with fallback to the `structured` plain field and DB execution status.

## Test Coverage

3 regression tests added to `golden-execution.test.ts`:

- **Go callback regression**: Verifies validation fails when callback result
  has no `structured` field (the Go snake_case mismatch scenario)
- **Java callback success**: Verifies structured output flows to downstream
  tasks when callback includes `structured`
- **Old Java plain string**: Verifies validation fails when callback is a
  non-JSON string (pre-v3 Java code)

## Verification

MongoDB query after fix confirmed both fields present:

```
executionConfig.structuredOutputSchema: { type: "object", required: [...], ... }
status.structuredOutput: { executive_summary: "...", dau: 7175, cohorts: [...] }
```

## Implementation Details

| File | Change |
|------|--------|
| `backend/services/runner/src/activities/call-agent.ts` | Explicit `create(ExecutionConfigSchema)` instead of `Record<string, unknown> as any` |
| `backend/services/runner/src/activities/execute-cursor/index.ts` | Added `slim.structured` plain field on activity return |
| `backend/services/runner/src/activities/execute-deep-agent/index.ts` | Same |
| `backend/services/runner/src/workflow-engine/__tests__/golden-execution.test.ts` | 3 regression tests |
| `backend/services/stigmer-server/pkg/.../invoke_workflow_impl.go` | Fixed camelCase key lookup + DB fallback |

## Impact

- All workflows with `output.schema` on `agent_call` tasks (Cursor and native)
- Tiny Tactics `daily-notification-plan` workflow unblocked
- Structured output now persists to MongoDB (visible on frontend)
- No behavioral change for tasks without `output.schema`

---

**Status**: Production Ready
