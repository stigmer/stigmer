# Incremental Git Write-Back and Artifact Staleness Fix

**Date**: March 28, 2026

## Summary

Two critical gaps in the agent execution flow have been addressed: stale artifact content in the UI and missing pull request creation for git-backed workspaces. Artifact staleness is solved with SHA-256 content hashing. PR creation is now platform-owned and incremental — the PR appears the moment the first file is written, and the diff grows in real time as the agent works.

## Problem Statement

### Pain Points

- **Stale artifact previews**: When an agent wrote a file and later edited it, the UI artifact preview showed the original content. The `useArtifactContent` hook's `useEffect` dependency was the `storageKey`, which never changed on overwrite — so the hook never re-fetched.
- **No automatic PR creation**: File modifications in git-backed workspaces did not produce a pull request. The previous design relied on LLM instructions to run git commands — unreliable, prompt-space-consuming, and inconsistent.
- **Post-execution batch approach**: The initial platform-owned write-back ran as a single post-execution step, meaning the user saw no PR until the agent finished. Real-time visibility is the standard expectation (Devin, Codex, Cursor agents all show PRs early).

## Solution

### 1. Artifact Staleness — Content Hash Cache Invalidation

Added `content_hash` (SHA-256 hex digest) to the `ExecutionArtifact` proto. The hash is computed on every upload in `publish_artifact.py`. The `useArtifactContent` hook now includes `contentHash` in its `useEffect` dependency array, forcing a re-fetch when file content changes even though the `storageKey` remains constant.

### 2. Incremental Git Write-Back — `WriteBackCoordinator`

Replaced the batch post-execution write-back with an incremental coordinator that hooks into the LangGraph tool execution pipeline:

- **Hook point**: `StreamExecutor._on_file_modifying_tool_end` — fires on `on_tool_end` for `write`, `write_file`, `edit`, `edit_file`. Now triggers both artifact publish (existing) and git write-back (new) as independent background tasks.
- **First file modification**: creates branch `stigmer/{short_id}`, commits, pushes, creates PR via GitHub API. The PR link appears in the UI immediately.
- **Subsequent modifications**: commits to the same branch, pushes. The PR auto-updates on GitHub. The UI diff summary grows in real time.
- **Post-execution safety net**: `coordinator.finalize()` catches any remaining uncommitted changes (e.g., from shell commands).
- **Concurrency**: per-workspace `asyncio.Lock` serializes git operations. Background tasks are tracked and drained before finalization.

### 3. Domain Modeling

- **`WorkspaceWriteBack`** proto: captures branch, base branch, commit SHA, PR URL/number, diff summary, phase, and error per workspace entry.
- **`WorkspaceWriteBackPhase`** enum: `COMMITTED → PUSHED → PR_CREATED → FAILED`.
- **`GitWriteBackMode`** enum on `GitRepoSource`: opt-in via `GIT_WRITE_BACK_BRANCH_AND_PR`.
- **`workspace_write_backs`** repeated field on `AgentExecutionStatus`: server-side merge replaces the list on each update.

### 4. SDK Components

- **`useWorkspaceWriteBacks`** — per-execution derivation hook (mirrors `useExecutionArtifacts`).
- **`useSessionWriteBacks`** — session-level aggregation hook (mirrors `useSessionArtifacts`). Deduplicates by `workspaceEntryName`, latest execution wins.
- **`WriteBackCard`** — compact card showing workspace name, branch, phase badge, diff summary, error, and "View PR" link.
- **`WriteBacksWidget`** — session-level widget (mirrors `ArtifactsWidget`). Takes `executions[]`, renders `null` when empty.

## Implementation Details

### Files Changed (Hand-Written)

| Area | File | Change |
|------|------|--------|
| Proto | `apis/.../writeback.proto` | New: `WorkspaceWriteBack`, `WorkspaceWriteBackPhase` |
| Proto | `apis/.../workspace.proto` | Added `GitWriteBackMode`, `write_back_mode` field |
| Proto | `apis/.../artifact.proto` | Added `content_hash` field |
| Proto | `apis/.../api.proto` | Added `workspace_write_backs` to `AgentExecutionStatus` |
| Backend | `writeback_coordinator.py` | New: `WriteBackCoordinator` class |
| Backend | `streaming.py` | Extended with `on_git_file_modified` callback, renamed method |
| Backend | `execute_graphton.py` | Coordinator creation and wiring |
| Backend | `post_stream.py` | Replaced batch write-back with coordinator finalize |
| Backend | `publish_artifact.py` | SHA-256 content hash computation |
| Backend | `status_builder.py` | `add_workspace_write_back` upsert method |
| Backend | `prompt_builder.py` | Removed LLM git write-back instructions |
| Backend | `tool_wrappers.py` | Removed `create_pull_request` tool registration |
| Backend | `approval_policy.py` | Removed `create_pull_request` entry |
| Backend | `github_api.py` | New: extracted GitHub API utilities |
| Go server | `update_status.go` | Write-backs merge logic |
| SDK | `useArtifactContent.ts` | Added `contentHash` dependency |
| SDK | `useWorkspaceWriteBacks.ts` | New: per-execution hook |
| SDK | `useSessionWriteBacks.ts` | New: session-level aggregation |
| SDK | `WriteBackCard.tsx` | New: write-back card component |
| SDK | `WriteBacksWidget.tsx` | New: session-level widget |
| Console | `SessionPage.tsx` | Integrated `WriteBacksWidget` |

### Files Auto-Generated

Proto generation (`make protos`) regenerated stubs across Go, Java, Python, TypeScript, and MCP server codegen — all from the hand-written `.proto` changes above.

### Deleted

- `writeback.py` — batch write-back module, fully superseded by `WriteBackCoordinator`.

## Benefits

- **Real-time PR visibility**: Users see the PR link the moment the first file is written, not when the agent finishes. The diff grows as the agent works.
- **No stale artifacts**: Content hash ensures the UI always shows the latest file content.
- **Deterministic git workflow**: Platform-owned, no LLM prompt dependency. Branch naming, commit messages, and PR creation are consistent and predictable.
- **Multi-workspace support**: Each git-backed workspace gets its own PR, tracked independently.
- **SDK-first architecture**: All write-back hooks and components live in `@stigmer/react`, not the Console. Platform builders can embed `<WriteBacksWidget />` or use `useSessionWriteBacks()` directly.

## Impact

- **End users**: See PRs in real time during agent execution, can review on GitHub while the agent is still working.
- **Platform builders**: New SDK hooks and components for write-back data, following the same patterns as artifacts.
- **Agent prompts**: Cleaner — no git write-back instructions consuming context window.
- **Codebase**: One fewer LLM-callable tool (`create_pull_request`), one new well-scoped coordinator class.

## Related Work

- Session-level artifacts widget (`2026-03-28-154305`)
- GitHub file URL construction fix (`2026-03-28-153929`)

---

**Status**: ✅ Production Ready
**Timeline**: Multi-session implementation
