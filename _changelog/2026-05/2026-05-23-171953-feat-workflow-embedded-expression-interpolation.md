# Embedded Expression Interpolation in Workflow Engine

**Date**: May 23, 2026

## Summary

Implemented CNCF Serverless Workflow 1.0.0–compliant embedded expression interpolation in the Stigmer workflow engine. Workflow authors can now write multi-line prompts and messages with inline `${ expr }` placeholders that resolve at runtime from `$env`, `$context`, `$input`, and other state namespaces. This fixes the `daily-notification-plan` workflow issue where raw `${ $env.NOTIFICATION_DATE }` text was passed to child agents instead of the resolved date value.

## Problem Statement

The workflow engine only supported **strict expressions** — values where the entire string is a single `${ ... }` expression. **Embedded expressions** within larger strings (e.g., `"Date: ${ $env.DATE }\nAnalyze the data."`) were never implemented in either the original Go runner or the current TypeScript rewrite, despite being documented in the CNCF spec and expected by golden test fixtures.

When users authored agent_call messages with embedded env or context references, the raw placeholder syntax appeared in the UI and reached child agent executions unchanged. Optional env vars showed as blank placeholders rather than empty strings.

### Pain Points

- Multi-line agent prompts could not dynamically incorporate runtime data without awkward workarounds (strict-only expressions, separate set tasks)
- `${ $env.NOTIFICATION_DATE }` in `daily-notification-plan` appeared literally in the initiated agent execution
- Golden test `13-agent-call.yaml` expected interpolation but the engine silently passed through raw syntax
- No integration test coverage for embedded expression resolution through the agent_call pipeline

## Solution

Added a two-phase expression resolution pipeline:

1. **Phase 1 (existing)**: Resolve strict expressions where the entire value is `${ expr }`
2. **Phase 2 (new)**: Scan remaining string values for embedded `${ expr }` patterns, batch-evaluate via jq local activities, and interpolate results back into the original strings

The fix applies uniformly to all call-type task builders (agent, http, grpc, function) through the shared `resolveConfigExpressions()` path.

## Implementation Details

### Expression Parser (`expression.ts`)

- **`extractEmbeddedExpressions()`**: Brace-depth-tracking parser that correctly handles nested jq braces (e.g., object construction) and skips runtime placeholders like `${.secrets.KEY}`
- **`interpolateString()`**: Evaluates extracted expressions and substitutes results into the source string
- **`stringifyInterpolatedValue()`**: Converts evaluated values to strings; null/undefined become empty string for better UX
- **`evaluateString()`**: Updated chain — strict → embedded → passthrough

### Resolve Pipeline (`resolve.ts`)

- **`resolveEmbeddedExpressions()`**: Walks config object tree, collects embedded expressions from all string values, batch-evaluates, and writes interpolated strings back
- **`resolveConfigExpressions()`**: Orchestrates Phase 1 (strict) then Phase 2 (embedded)

### Golden Test Fix (`13-agent-call.yaml`)

Added `export: as: ${ . }` to the `setupContext` task so its output is available in `$context` for subsequent embedded expressions.

### Test Coverage

- **Unit tests**: 69 expression tests, 32 resolve tests, strengthened golden test #13, call-agent interpolation tests
- **Integration test**: `TestWorkflowExpressionInterpolation_EmbeddedEnvInAgentMessage` verifies end-to-end env var interpolation in agent_call messages, including optional missing vars resolving to empty string

## Benefits

- Workflow authors can write natural multi-line prompts with inline dynamic values — matching GitHub Actions, Azure Logic Apps, and CNCF spec conventions
- Fixes `daily-notification-plan` and any workflow using embedded `$env` or `$context` in message strings
- Null-to-empty conversion prevents ugly `${ ... }` remnants for optional env vars
- Batch evaluation preserves Temporal determinism and performance characteristics

## Impact

- **Workflow authors**: Can use embedded expressions in agent_call messages, HTTP bodies, and other string config fields
- **Child agents**: Receive fully resolved prompts instead of raw placeholder syntax
- **Platform**: Closes a spec-compliance gap that existed since the first workflow engine implementation

## Related Work

- [Fix Workflow agent_call Env Var Forwarding and Recovery Idempotency](./2026-05-23-145540-fix-workflow-agent-call-env-forwarding-and-idempotency.md) — complementary fix ensuring env vars reach child agents; this change ensures they are also interpolated into message strings

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation with comprehensive test coverage
