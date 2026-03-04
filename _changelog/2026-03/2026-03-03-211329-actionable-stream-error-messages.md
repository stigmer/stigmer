# Actionable Stream Error Messages

**Date**: March 3, 2026

## Summary

Replaced raw gRPC error internals in stream disconnect messages with human-actionable guidance. When the CLI detects a dead server connection (via the existing keepalive infrastructure), the user now sees what happened and how to recover instead of cryptic transport-layer error strings.

## Problem Statement

When the gRPC keepalive detected a dead backend connection, `stream.Recv()` returned a transport error that was passed through to the TUI with minimal wrapping.

### Pain Points

- The user saw messages like: "Stream error: execution stream error: rpc error: code = Unavailable desc = connection closed before server preface received"
- No re-attach instructions — the user had to know the `stigmer run <session-id>` command
- Raw gRPC code names and descriptions leaked to non-technical users
- In conversational mode, the follow-up input activated without explaining that sending a message would attempt reconnection

## Solution

Added an error classification layer between `stream.Recv()` and the TUI that translates raw gRPC/io errors into actionable messages with recovery instructions.

## Implementation Details

- **`streamError` type** — Custom error wrapper where `Error()` returns the user-facing message and `Unwrap()` preserves the raw error for debug logging and programmatic inspection. Idiomatic Go error wrapping.
- **`classifyStreamError` function** — Classifies errors by type (EOF, gRPC status codes, non-gRPC) and produces appropriate messages. Appends session-specific re-attach instructions when a session ID is available.
- **`sessionID` in `streamToEventsConfig`** — Threaded session ID into the streaming bridge config so error messages can include `stigmer run <session-id>`.
- **TUI error rendering** — Removed the redundant "Stream error:" prefix (messages are now self-descriptive). Added a follow-up reconnection hint in conversational mode.
- **Pre-existing flaky test fix** — Fixed `TestTrySendEvent_ReturnsFalseOnCancelledContext` which used a buffered channel, causing non-deterministic `select` behavior. Changed to unbuffered channel so only `ctx.Done()` is ready.

### Error Classification Table

| Error | User-Facing Message |
|-------|-------------------|
| `io.EOF` | "Server closed the connection unexpectedly." |
| gRPC `Unavailable` | "Connection to server lost." |
| gRPC `Canceled` | "Server cancelled the stream." |
| gRPC `DeadlineExceeded` | "Server response timed out." |
| Other gRPC codes | "Stream error (CodeName): server message" |
| Non-gRPC errors | "Unexpected stream error: original message" |

When session ID is available, all messages append: "Re-attach to this session: stigmer run ses-XXX"

### Architectural Decision: Challenging the Original Plan

The original Phase 1.3 plan prescribed three components:
1. Add gRPC keepalive (10s/5s) — **Already existed** at 30s/10s
2. 60s inactivity timeout on `stream.Recv()` — **Anti-pattern** that was already tried and removed (falsely triggered during LLM thinking pauses)
3. 30s stale-connection TUI footer warning — **Same anti-pattern** that contradicts the existing "Thinking..." indicator

All three were challenged and rejected. The actual gap was UX quality of the error response, not detection infrastructure.

## Benefits

- Users see actionable English messages instead of gRPC internals
- Recovery path is explicit: re-attach command with session ID included
- In conversational mode, users understand they can send a follow-up to reconnect
- Raw errors preserved via `Unwrap()` for `--debug` diagnostics
- No false positives from application-level timeouts during LLM thinking

## Impact

- **Files changed**: 4 production files, 1 test file
- **Lines**: +189 / -16
- **Tests**: 10 new tests for error classification, 1 pre-existing flaky test fixed

## Related Work

- Phase 1.1: Defense-in-depth approval detection on resume (`2026-03-03-204258`)
- Phase 1.2: Context-cancellable approval flow (`2026-03-03-205941`)
- Phase 2.1: Comprehensive error handler (`clierr` overhaul — future)

---

**Status**: Production Ready
