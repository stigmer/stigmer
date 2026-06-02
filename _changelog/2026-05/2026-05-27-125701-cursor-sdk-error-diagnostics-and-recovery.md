# Cursor SDK Error Diagnostics, Classification, and Poisoned-Handle Recovery

**Date**: May 27, 2026

## Summary

Replaced the opaque "Cursor run failed" error with a multi-source diagnostic pipeline that captures error detail from three independent channels (SDK result, stream status events, process-level unhandledRejection), classifies errors into actionable categories, and implements the poisoned-handle recovery pattern recommended by the Cursor SDK team for stale agent handles.

## Problem Statement

The Cursor SDK (`@cursor/sdk` v1.0.13) has a confirmed bug where `run.wait()` returns a bare `{ status: "error" }` with no error detail, while the actual `ConnectError` (carrying the real cause — e.g., `[unauthenticated]`, `[unavailable]`) escapes as a process-level `unhandledRejection`. This was acknowledged by the Cursor team on their forum (May 21, 2026) and is pending a fix in the SDK.

### Pain Points

- "Cursor run failed" provided zero diagnostic context — no way to distinguish auth failures from network errors from stale agent handles
- The process-level `unhandledRejection` handler logged the real `ConnectError` but never correlated it to the execution that caused it
- Stream status events with `status: "ERROR"` were logged but their `message` field was never captured or used for error reporting
- Once an agent handle entered the stale/error state, all subsequent `send()` calls on that handle would keep failing (the "poisoned handle" pattern), causing cascading failures across executions in the same session
- The runner had no retry mechanism for transient SDK failures, and the Temporal activity was configured with `maximumAttempts: 1`

## Solution

A five-layer error diagnostic and recovery pipeline:

1. **Rejection capture** — Process-level `unhandledRejection` handler that detects `ConnectError` instances, extracts `code` and `message`, and correlates them to the active execution via `AsyncLocalStorage`
2. **Stream error capture** — The stream loop now captures `SDKStatusMessage` events with `status: "ERROR"` and extracts their `message` field before `run.wait()` resolves
3. **Error synthesis** — The `case "error"` block synthesizes a rich error from three sources in priority order: SDK result fields, stream ERROR message, correlated ConnectError
4. **Error classification** — Errors are classified into `auth`, `rate-limit`, `network`, `agent-stale`, `model`, or `unknown` categories with `retryable` flags
5. **Poisoned-handle recovery** — When a bare error is detected on a resumed agent handle, the activity disposes the handle, creates a fresh agent with continuation prompt from `SessionMemory`, and retries `send + stream + wait` once

## Implementation Details

### Files Created

| File | Purpose |
|------|---------|
| `execute-cursor/rejection-capture.ts` | Module-level `ConnectError` capture correlated via `AsyncLocalStorage`. Stores captured errors in a TTL-evicted `Map<executionId, CapturedRejection>` |
| `execute-cursor/error-classifier.ts` | Pattern-matching classifier that maps error text to categories. Drives retry decisions and formats error strings with `[category=..., source=..., retryable=...]` |

### Files Modified

| File | Change |
|------|--------|
| `main.ts` | Replaced generic `console.error` rejection handler with execution-aware `handleUnhandledRejection` |
| `fetch-interceptor.ts` | Added `getExecutionContext()` export for rejection handler correlation |
| `runner.ts` | Wired `setExecutionContextRef` after fetch interceptor installation |
| `runner-manager.ts` | Same wiring for manager (desktop) mode |
| `execute-cursor/index.ts` | Stream ERROR capture, enriched error synthesis, poisoned-handle recovery with fresh agent retry |
| `call-agent.ts` | Added diagnostic logging for session naming (warns when timestamp-based fallback is used) |

### Error Classification Categories

| Category | Pattern | Retryable | Example |
|----------|---------|-----------|---------|
| `auth` | `unauthenticated`, `401`, `forbidden` | No | Stale JWT, revoked API key |
| `rate-limit` | `resource_exhausted`, `429` | Yes | Cursor API throttling |
| `network` | `unavailable`, `503`, `timeout` | Yes | Transient connection issues |
| `agent-stale` | Bare error from resumed handle | Yes | Poisoned agent handle |
| `model` | `invalid model`, `not found` | No | Bad model configuration |
| `unknown` | Everything else | No | Unclassified |

### Poisoned-Handle Recovery Flow

When `run.wait()` returns `status: "error"` AND the agent was obtained via `Agent.resume()` AND the error is classified as `agent-stale` or `network`:
1. Dispose the current agent handle via `agent.close()`
2. Create a fresh agent via `createAgent()` / `createCloudAgent()`
3. Build a continuation prompt from `SessionMemory` (same path as `created_after_resume_failure`)
4. Retry `agent.send() + stream + run.wait()` once on the fresh handle
5. If retry also fails, report the retry error (not the original)

Guarded by `alreadyRetriedWithFreshAgent` flag — only one retry per activity invocation.

## Benefits

- **Actionable errors**: "Cursor run failed" now includes category, source, and retryable flag (e.g., `[unauthenticated] Error [category=auth, source=rejection, retryable=false]`)
- **Automatic recovery**: Poisoned agent handles are detected and recovered without human intervention
- **Three-channel correlation**: Error detail that was previously only visible in scattered runner logs is now synthesized into a single `status.error` string
- **No Java changes needed**: The workflow already surfaces `finalStatus.getError()` — richer runner error strings flow through automatically

## Impact

- **Runner**: Enhanced error diagnostics for all Cursor-powered executions
- **Desktop app**: Rejection handler now correlates errors in manager mode too
- **Workflow executions**: `call:agent` tasks that fail with Cursor errors now report actionable diagnostics instead of opaque messages
- **Call-agent activity**: Added diagnostic logging for session naming to help trace duplicate session issues

## Related Work

- Cursor SDK bug report: [forum.cursor.com/t/161203](https://forum.cursor.com/t/agent-send-wait-returns-bare-status-error-while-connectrpc-unauthenticated-leaks-as-unhandledrejection/161203)
- Prior error diagnostics: `2026-05-26-125136-enhance-cursor-run-error-diagnostics.md`
- Prior token staleness fix: `2026-05-26-135639-fix-desktop-runner-proxy-token-staleness.md`
- Prior silent logging fix: `2026-05-01-142354-fix-cursor-runner-silent-error-logging.md`

---

**Status**: Production Ready
**Timeline**: Single session
