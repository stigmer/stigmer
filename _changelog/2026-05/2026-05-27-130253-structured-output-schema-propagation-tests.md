# Structured Output Schema Propagation Tests

**Date**: May 27, 2026

## Summary

Added comprehensive test coverage verifying that `output.schema` from workflow task configuration survives the expression resolution pipeline and reaches the agent execution as `executionConfig.structuredOutputSchema`. This covers the exact failure mode from the daily-notification-plan production bug where structured output schema was intermittently missing.

## Problem Statement

The workflow engine's `call:agent` task type supports an `output.schema` field that defines the JSON schema for structured output. This schema must flow through the expression resolution pipeline (which resolves `${ $env.* }` and `${ $context.* }` expressions in the message field) and arrive intact at the server as `executionConfig.structuredOutputSchema` on the created `AgentExecution`.

### Pain Points

- No tests verified schema survived expression resolution — the pipeline was implicitly trusted
- Production bug in daily-notification-plan workflow where schema was intermittently missing after expression evaluation
- Nested schema structures (arrays of objects with enums, required fields) had no coverage for serialization fidelity
- No golden test exercised the full pattern: embedded env expressions in message + complex schema + config + harness

## Solution

Added three layers of test coverage: unit tests for the task builder, contract tests for the server payload, and a golden execution test for end-to-end workflow behavior.

## Implementation Details

**call-agent-contracts.test.ts** (7 new tests):
- Verifies `output.schema` → `executionConfig.structuredOutputSchema` on the created AgentExecution
- Covers: schema present, schema+model, nested structure preservation, schema absent, schema without model
- End-to-end daily-notification-plan pattern test with full cohort schema

**call-agent.test.ts** (6 new tests):
- Verifies `output.schema` is passed through to `ctx.callAgent` after the CallAgentTaskBuilder resolves expressions
- Covers: schema alone, schema with embedded expressions in message, strict expression references, empty env vars, schema alongside config/harness/env
- Negative case: no output configured passes undefined

**golden-execution.test.ts** (1 new test):
- Golden test #26: full daily-notification-plan pattern with embedded env expressions
- Verifies schema survives expression resolution, embedded `${ $env.NOTIFICATION_DATE }` resolves, config/harness preserved, structured output exported to context and consumed downstream

**Golden YAML** (`26-agent-call-structured-output-propagation.yaml`):
- Real-world workflow definition with complex cohort analysis schema (nested arrays, enums, required fields)
- Two tasks: `analyze_player_data` (call:agent with schema) → `verify_data` (call:function consuming output)

**Go integration test** (`workflow_structured_output_schema_propagation_test.go`):
- Server-side validation that schema flows through the full gRPC pipeline

**call-agent.ts**:
- Added diagnostic logging for session/execution naming and missing workflow context warnings

## Benefits

- Production bug class is now covered by 14 targeted tests across three test layers
- Complex nested schemas (arrays of objects with enums, required fields) have serialization fidelity coverage
- Expression resolution pipeline is tested for schema preservation, not just message substitution
- Golden test provides a regression anchor for the exact daily-notification-plan workflow pattern

## Impact

- **Runner**: 5 files changed (3 test files, 1 golden YAML, 1 activity with logging)
- **Integration**: 1 new Go integration test
- **Tests**: 91/91 pass across affected files, 0 regressions

## Related Work

- Phase 3: v3 default + structured output pipeline wiring (Session 8)
- Session 9: E2E structured output validation with real providers
- Error diagnostics changelog: `2026-05-27-125701-cursor-sdk-error-diagnostics-and-recovery.md`

---

**Status**: Production Ready
**Timeline**: 1 session (part of Session 12 in v3 streaming migration project)
