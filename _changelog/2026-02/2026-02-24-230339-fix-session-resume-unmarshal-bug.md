# Fix Session Resume: ListBySession Unmarshal Bug

**Date**: February 24, 2026

## Summary

Fixed a serialization format mismatch in the OSS backend's `ListBySession` handler that caused `stigmer run <session-id>` to always report "has no executions", even when executions existed. Also corrected the CLI help text to accurately describe session resumption behavior.

## Problem Statement

When a user attempted to resume an existing session via `stigmer run ses-xxx`, the CLI always displayed "Session ses-xxx has no executions" despite executions being present in the SQLite store.

### Pain Points

- Session resumption was completely non-functional on the OSS backend
- The error was silent: executions were skipped with a warning log rather than surfacing the root cause
- The CLI help text described session resumption as "read-only replay mode" when the actual implementation provides a fully interactive, resumable TUI with follow-up message support

## Solution

The root cause was a serialization format mismatch in `list_by_session.go`. The SQLite store persists resources as binary protobuf (`proto.Marshal`), but the `queryExecutionsBySessionStep` was deserializing with `protojson.Unmarshal` (JSON). Every execution failed to parse and was silently skipped.

## Implementation Details

### Backend Fix (`list_by_session.go`)

- Changed `protojson.Unmarshal` to `proto.Unmarshal` to match the binary protobuf format used by the SQLite store
- Updated the import from `google.golang.org/protobuf/encoding/protojson` to `google.golang.org/protobuf/proto`

### CLI Help Text Fix (`run.go`)

- Updated the `--help` description from "read-only replay mode" to "see the full conversation and can send follow-up messages to continue", accurately reflecting the `NewResumable` TUI behavior

## Benefits

- Session resumption now works correctly on the OSS backend
- Users can resume any session by ID and continue the conversation with follow-up messages
- Help text accurately describes the interactive resumption capability

## Impact

- **Users**: `stigmer run <session-id>` now works as designed, enabling multi-turn conversations across CLI sessions
- **Developers**: Highlights the importance of matching serialization formats when the store uses binary protobuf

## Related Work

- Session abstraction and conversational TUI (2026-02-18, 2026-02-19)
- Conversational session UX fixes (2026-02-24-150814)

---

**Status**: Production Ready
