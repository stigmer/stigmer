# Structured Output Pipeline — Issue Discovery Test Suite

**Date**: May 25, 2026

## Summary

Added a comprehensive integration test suite targeting the structured output extraction pipeline across both harnesses (native + cursor). The suite is designed to **discover issues** in the 15-handoff-point pipeline rather than fix them, producing diagnostic markers (`[B1 CONFIRMED]`, `[D2 NOT PRESENT]`, etc.) that map directly to known failure modes.

## Problem Statement

The `daily-notification-plan` workflow failed with "Agent did not return structured output" despite the agent producing a rich markdown report. Investigation revealed a proto serialization bug (schema dropped during execution creation), but deeper analysis uncovered **15 handoff points** with numerous unguarded failure modes — many producing **silent wrong data** rather than clean failures.

### Pain Points

- No test coverage for structured output extraction across different agent response formats (prose, code-fenced JSON, tool-only responses)
- Schema round-trip through proto/structpb not validated (nullable fields, nested arrays silently dropped)
- Workflow-level structured data propagation (callback results, context export) untested
- Validation gaps (nested objects, array items, additionalProperties) not documented

## Solution

Created a 3-layer test suite following the existing integration test harness patterns:

1. **Layer 1** (agent execution): Does extraction produce `structuredOutput`?
2. **Layer 2** (workflow): Does structured data propagate to downstream tasks?
3. **Layer 3** (edge cases): Adversarial inputs, schema conformance, failure modes

## Implementation Details

### New Files

| File | Lines | Role |
|------|-------|------|
| `test/integration/harness/structured_output_assertions.go` | 228 | Assertion helpers + schema builders |
| `test/integration/agent_execution_15_structured_output_test.go` | 571 | 15 agent-level tests (Layer 1 + 3) |
| `test/integration/workflow_structured_output_test.go` | 326 | 4 workflow-level tests (Layer 2) |

### Test Coverage Map

| Test | Failure Modes Targeted |
|------|----------------------|
| PureJsonResponse | Happy path (Tier 1) |
| MarkdownProse | B1, B2, E4 (Tier 2 extraction) |
| CodeFencedJson | B3 (Tier 1.5 fence extraction) |
| EmptyFinalMessage | B1 (tool-only final turn) |
| MultiTurnVerbose | B2 (JSON in middle, "Done!" at end) |
| NestedSchema | D1, D2 (nested object/array validation) |
| SchemaWithNullableField | A2 (structpb type array limitation) |
| SchemaStoredOnExecution | A1 (proto field dropped on create) |
| TrailingCommasInJson | B7 (invalid JSON → Tier 2 fallback) |
| MultipleCodeFences | B3 (which fence wins?) |
| ExtraFieldsNotStripped | D5 (additionalProperties: false) |
| MissingRequiredField | D1 (required field validation) |
| WrongFieldType | D1 (type validation gaps) |
| CohortsArrayOfObjects | D2 (items schema for arrays) |
| SchemaRoundTrip | A1, A2 (4 schema variants) |

## Benefits

- Every known failure mode from the deep code analysis now has a test that will surface it
- Tests use diagnostic logging (`[B1 CONFIRMED]` / `[B1 NOT PRESENT]`) making triage instant
- Follows existing harness patterns — runs across both native and cursor harnesses
- Schema builder helpers are reusable for future structured output tests

## Impact

- **Test infrastructure**: 3 new files in `test/integration/` following established conventions
- **Issue discovery**: Will surface extraction, validation, and propagation bugs on first run
- **Future fixes**: Each discovered issue can be fixed incrementally with the test as regression guard

---

**Status**: ✅ Production Ready
**Timeline**: Single session
