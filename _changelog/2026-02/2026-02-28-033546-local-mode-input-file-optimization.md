# Phase 6: Local-Mode Input File Optimization

**Date**: February 28, 2026

## Summary

Added a `local_path` provenance hint to the `Attachment` proto and implemented a download-bypass fast path in the agent runner. When running in local mode, the runner reads attachment content directly from the local filesystem instead of downloading from artifact storage, eliminating the storage round-trip for local executions.

## Problem Statement

In local mode, all three components (CLI, server, runner) share the same machine. Despite this, attachments follow the full cloud path: CLI uploads to artifact storage via gRPC, then the runner downloads from artifact storage. For a 10MB file (the max attachment size), this is a measurable and unnecessary latency penalty.

### Pain Points

- Redundant network round-trip through artifact storage for files already on the local filesystem
- Latency proportional to file size on every local execution with attachments
- No mechanism for the runner to know the original file location

## Solution

Option A (download-only optimization): The CLI always uploads (preserving `storage_key` as required), but also sets `local_path` to the absolute source path. The runner, when in local mode, reads directly from `local_path` instead of downloading from storage. Graceful fallback to storage on any local-path miss.

## Implementation Details

### Proto Change

Added `string local_path = 6` to the `Attachment` message in `agentexecution/v1/spec.proto`. No validation changes -- `storage_key` retains its `min_len=1` rule. The field is documented as a provenance hint, ignored in cloud mode.

### Runner Change

`inject_attachments()` gained an `allow_local_path: bool = False` parameter. When enabled:

1. Check if `attachment.local_path` is set and points to an existing file
2. If yes, read bytes from disk (skip storage download entirely)
3. If the file is missing, log a warning and fall back to `storage.download()`

The parameter name (`allow_local_path`) describes what it enables, not why, keeping the function decoupled from deployment-mode semantics. The call site passes `worker_config.is_local_mode()`.

### CLI Change

`uploadFile()` resolves `filepath.Abs(path)` and sets `attachment.LocalPath` after upload. `processDirectory()` sets `LocalPath` to the resolved directory path (informational for zip archives -- the runner's fast path only triggers for readable files).

### Go Stubs

Regenerated via `make go-stubs` to include the new `LocalPath` field and `GetLocalPath()` accessor on the `Attachment` struct.

## Benefits

- Eliminates storage download latency for local-mode attachments
- Zero behavioral change for cloud mode (field is silently ignored)
- Graceful degradation: missing local files fall back to storage download
- Establishes the `local_path` field for future full round-trip elimination (CLI upload skip)

## Impact

- **Local CLI users**: Faster attachment injection on every execution with `--attach` files
- **Cloud users**: No change (field is ignored by cloud runners)
- **API consumers**: New optional field on `Attachment` -- fully backward compatible

## Related Work

- Phase 0-5: Workspace provisioning pipeline (same branch, same PR)
- AD-09 v3: `LocalPathSource` on `WorkspaceSource` -- same provenance-hint pattern
- Phase 4: Virtual platform mount -- `.stigmer/inputs/` routing through platform directory

---

**Status**: Production Ready
**Timeline**: ~1 hour implementation + testing
