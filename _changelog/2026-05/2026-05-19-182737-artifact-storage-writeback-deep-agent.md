# Artifact Storage, Inline Publishing, and Incremental Git Writeback for ExecuteDeepAgent

**Date**: May 19, 2026

## Summary

Implemented the artifact storage abstraction (local + proxy backends), real-time inline file publishing during agent execution, incremental git writeback (branch/commit/push/PR on each file write), and a post-stream safety net for the unified TypeScript runner's ExecuteDeepAgent activity. This completes Phase 3b of the unified runner migration, bringing the deep agent execution path to feature parity with the Python agent-runner's file output and git workflow capabilities.

## Problem Statement

When a deep agent writes files during execution (code, reports, configs), those files need to be:
1. Uploaded to storage and made available for download in the UI in real time
2. Committed and pushed to a git branch with a PR created automatically for git-backed workspaces

The Python agent-runner handled both of these through `InlinePublisher`, `WriteBackCoordinator`, and `ArtifactStorage` backends. The unified TypeScript runner had no equivalent — agents could write files, but users couldn't download them from the UI, and git workspaces accumulated uncommitted changes silently.

### Pain Points

- No artifact visibility during execution — users had to wait until the end and manually inspect the workspace
- No git writeback — file changes in git-backed workspaces were lost if not manually committed
- No download URLs for agent-produced files
- No post-execution safety net to catch files written via shell commands or other non-tracked paths

## Solution

Five new modules implementing a layered architecture: artifact storage at the bottom, inline publisher and writeback coordinator in the middle (fire-and-forget from the streaming loop), and a post-stream orchestrator at the top that runs safety nets after the stream completes.

## Implementation Details

### Artifact Storage (`src/shared/artifact-storage.ts`)
- `ArtifactStorage` interface: `upload()`, `getDownloadUrl()`, `exists()`
- `LocalArtifactStorage`: writes to filesystem, returns direct URLs served by stigmer-server (OSS mode)
- `ProxyArtifactStorage`: gets presigned upload URL from Stigmer side-channel proxy, PUTs content to R2 (cloud mode). Runner never holds R2 credentials.
- Factory dispatches on `ARTIFACT_STORAGE_TYPE` env var, defaulting to local in OSS mode and proxy in cloud mode

### Inline Publisher (`src/activities/execute-deep-agent/inline-publisher.ts`)
- Fire-and-forget callback invoked on each file-modifying tool completion (`write_file`, `edit_file`, etc.)
- Reads file from workspace, computes SHA-256 content hash, uploads to artifact storage
- Builds `ExecutionArtifact` proto with name, path, size, storage key, download URL, content hash
- Deduplication via `Map<sandboxPath, contentHash>` — skips re-upload if content hasn't changed
- Registers artifact on StatusBuilder, which gets persisted to the UI on the next scheduled update

### Writeback Coordinator (`src/activities/execute-deep-agent/writeback-coordinator.ts`)
- Incremental git writeback: each file-modifying tool call triggers commit+push for the affected workspace entry
- First write: creates branch `stigmer/{shortId}`, commits, pushes, creates GitHub PR via REST API
- Subsequent writes: commits to existing branch, pushes (PR auto-updates)
- Per-entry mutex (Promise-chain lock) serializes concurrent git operations
- Eligibility filtering: only git-backed workspaces with credentials and enabled write-back mode
- `finalize()` post-stream safety net catches files modified by shell commands

### Post-Stream Orchestrator (`src/activities/execute-deep-agent/post-stream.ts`)
- Sequence: drain pending publish promises → drain pending writeback promises → auto-publish safety net → writeback finalize
- Each step independently try/caught — one failure does not block subsequent steps

### StatusBuilder Extensions
- `addArtifact()`: deduplicates by `sandboxPath`, replaces when `contentHash` changes
- `addWriteBack()`: upserts by `workspaceEntryName`, supports phase progression

### Streaming Integration
- Detects file-modifying tool calls by name in the `on_tool_end` event handler
- Fires inline-publisher and writeback-coordinator as background promises
- Tracks pending promises for post-stream draining

## Benefits

- **Real-time artifact visibility**: Users see downloadable files in the UI the moment the agent writes them, not after execution completes
- **Instant PR creation**: For git-backed workspaces, the PR link appears on the first file write. Users watch the diff grow in real time.
- **Zero file loss**: Post-stream safety net catches files written via shell commands or other paths not triggered during inline publishing
- **Cloud-ready**: Proxy-based artifact storage works with zero R2 credentials in the runner process
- **OSS-ready**: Local filesystem storage works with zero cloud dependencies

## Impact

- **Unified runner**: ExecuteDeepAgent now has full file output parity with the Python agent-runner
- **Frontend**: `ExecutionArtifact` and `WorkspaceWriteBack` protos are populated on `AgentExecutionStatus`, enabling the execution viewer to render download links and PR cards
- **Phase 3b complete**: All three sub-phases (StatusBuilder+streaming, middleware stack, artifacts+writeback) are done. Phase 3c (HITL + Approval) is unblocked.

## Related Work

- Phase 3b-ii: Middleware stack (loop detection, cost cap, execution budget, graceful stop, OTel spans)
- Phase 3b-i: StatusBuilder + streaming loop + gRPC retry
- Phase 3a: ExecuteDeepAgent walking skeleton
- Python source: `inline_publisher.py`, `writeback_coordinator.py`, `storage/` in agent-runner

---

**Status**: Production Ready (pending Phase 3c for full HITL support)
**Timeline**: 1 session (~2 hours)
**Tests**: 68 new tests (303 total), typecheck clean
