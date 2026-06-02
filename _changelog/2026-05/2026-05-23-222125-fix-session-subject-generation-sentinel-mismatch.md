# Fix Session Subject Generation — Sentinel Mismatch

**Date**: May 23, 2026

## Summary

Fixed a sentinel mismatch that caused all workflow-spawned agent sessions to permanently display "Untitled session". The `call-agent.ts` runner activity created sessions without setting the sentinel subject, so the `GenerateSessionSubjectActivity` silently skipped title generation for every workflow child execution. Added heuristic fallback, improved observability, and comprehensive test coverage across unit, workflow, and integration layers.

## Problem Statement

After the unified runner migration, every agent execution spawned by a workflow (via `call:agent` tasks) showed "Untitled session" in the desktop app sidebar. Direct executions still got LLM-generated titles. The issue was invisible because it was logged at DEBUG level.

### Pain Points

- All workflow child sessions permanently stuck as "Untitled session" — impossible to distinguish between conversations
- The root cause was a silent sentinel mismatch between two session creation paths
- `call-agent.ts` created sessions with empty subject (`""`, protobuf default)
- `GenerateSessionSubjectActivityImpl` only triggered on the exact sentinel `"Auto-created session"`
- The skip condition was logged at DEBUG — invisible with production `LOG_LEVEL=info`
- No test coverage existed to catch this class of regression

## Solution

Four coordinated fixes across the Java backend and TypeScript runner:

1. **Broadened the sentinel check** — empty/blank subjects now trigger generation (not just the exact sentinel string)
2. **Defense-in-depth** — `call-agent.ts` now sets `subject: "Auto-created session"` when creating sessions
3. **Heuristic fallback** — when the LLM is unavailable (expired key, rate limit), falls back to first 7 words of the user message
4. **Improved observability** — promoted key skip logs from DEBUG to INFO

## Implementation Details

### Sentinel Check Fix (`GenerateSessionSubjectActivityImpl.java`)

Changed from strict sentinel matching to inclusive "needs generation" logic:

```java
// Before: only exact sentinel match triggered generation
if (!AUTO_CREATED_SUBJECT.equals(currentSubject)) { return; }

// After: empty/blank also triggers; only real custom titles skip
if (currentSubject != null && !currentSubject.isBlank()
        && !AUTO_CREATED_SUBJECT.equals(currentSubject)) { return; }
```

### Runner Session Creation (`call-agent.ts`)

Added the sentinel subject to session creation in the workflow runner:

```typescript
spec: create(SessionSpecSchema, {
  agentInstanceId: defaultInstanceId,
  harness,
  subject: "Auto-created session",
}),
```

### Heuristic Fallback

When `ModelPricingService` returns empty (no model in registry) or `LlmCallService` returns null (API failure), the activity now falls back to a heuristic derived from the first 7 words of the user message, capped at 50 characters.

### Test Coverage (4 new test files)

- `GenerateSessionSubjectActivityImplTest.java` — 13 unit tests covering all branches
- `call-agent.test.ts` — assertion that sessions get the sentinel subject
- `session_subject_generation_test.go` — 3 Go integration tests (E2E against live service)
- `InvokeAgentExecutionWorkflowSubjectTest.java` — 4 Temporal workflow tests

## Benefits

- Workflow child sessions now get meaningful LLM-generated titles
- Sessions always get a title even when LLM is down (heuristic fallback)
- Silent failures are now visible in logs at INFO level
- Comprehensive test coverage prevents this class of regression

## Impact

- **Desktop app**: Sidebar no longer shows "Untitled session" for workflow-spawned executions
- **All harnesses**: Fix works for native, Cursor, and any future harness
- **Resilience**: Heuristic fallback prevents permanent "Untitled session" when Anthropic API is unavailable
- **Observability**: `GenerateSessionSubject` skip reasons now visible in standard log output

## Related Work

- `2026-05-09-105617-move-session-subject-to-java-local-activity.md` — moved subject gen to Java
- `2026-05-09-134402-switch-session-subject-to-anthropic.md` — switched to Anthropic + dynamic registry
- `2026-05-23-145540-fix-workflow-agent-call-env-forwarding-and-idempotency.md` — related workflow child execution fixes

---

**Status**: ✅ Production Ready
**Timeline**: Single session
