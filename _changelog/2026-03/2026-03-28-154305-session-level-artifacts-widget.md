# Session-Level Artifacts Widget

**Date**: March 28, 2026

## Summary

Transformed the `ArtifactsWidget` from showing a single execution's artifacts to aggregating artifacts across all executions in a session. The sidebar now presents a unified, alphabetically-sorted file listing — like a file explorer — with deduplication by `sandbox_path` (latest execution wins). Execution is treated as a backend concept that never surfaces to the user.

## Problem Statement

The `ArtifactsWidget` accepted a single `execution: AgentExecution | null` and only displayed artifacts from the latest or currently-active execution. In a multi-turn conversation where the agent produces files across several executions, users could only see artifacts from the most recent turn — earlier artifacts were invisible in the sidebar.

### Pain Points

- Users had no visibility into artifacts produced in earlier turns of the conversation
- The mental model was wrong: users think "my conversation produced these files," not "execution #3 produced this file"
- Switching between executions to check artifacts was not possible in the sidebar

## Solution

Introduced a session-level artifact aggregation model where all executions' artifacts are merged into a single flat list, deduplicated by filesystem identity (`sandbox_path`), and sorted alphabetically — matching the file-explorer mental model users expect.

## Implementation Details

### New hook: `useSessionArtifacts` (`sdk/react/src/session/useSessionArtifacts.ts`)

Pure derivation hook (useMemo, no side effects) that takes `executions: readonly AgentExecution[]` and returns deduplicated, sorted `SessionArtifactEntry[]` objects. Each entry carries the artifact plus its parent execution context (`executionId`, `isTerminal`) needed by downstream components.

**Dedup logic**: Iterates executions chronologically, building a Map keyed by `sandbox_path` (falls back to `name` if empty). Later entries overwrite earlier ones — matching filesystem overwrite semantics.

**Name collision detection**: When two artifacts share the same display `name` but different `sandbox_path` values, both are flagged with `hasNameCollision: true` so the card can show the parent directory for disambiguation.

### Updated `ArtifactsWidget` (`sdk/react/src/execution/ArtifactsWidget.tsx`)

- Props changed from `execution: AgentExecution | null` to `executions: readonly AgentExecution[]`
- Internally uses `useSessionArtifacts` instead of `useExecutionArtifacts`
- Preview state tracks a full `SessionArtifactEntry` (not just the artifact) so the modal receives the correct per-artifact `executionId` and `isTerminal`
- `aria-label` simplified from "Execution artifacts" to "Artifacts" (no execution concept in the UI)

### Updated `ArtifactCard` (`sdk/react/src/execution/ArtifactCard.tsx`)

- New optional `hasNameCollision` prop
- When `true` and `sandbox_path` is populated, renders the parent directory as a muted subtitle below the artifact name (e.g., `configs/`)
- Added `parentDirectory()` helper that extracts the last directory segment from a sandbox path

### Console integration (`client-apps/web/SessionPage.tsx`)

- `ArtifactsWidget` moved outside the `displayExecution` guard — it now always renders when the session has any executions
- Receives all executions: `[...conv.completedExecutions, ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : [])]`

## Benefits

- **Complete visibility**: Users see every artifact produced during the conversation, not just the latest turn
- **File-explorer UX**: Alphabetically sorted, deduplicated by path — matches the mental model of "files my conversation created"
- **No leaky abstractions**: Execution/turn concepts stay in the backend; users see a clean file listing
- **SDK-first**: New `useSessionArtifacts` hook exported for platform builders who want headless access to aggregated artifacts
- **Zero breaking changes to existing hooks**: `useExecutionArtifacts` preserved for single-execution use cases

## Impact

- **Direct users**: Session sidebar now shows all conversation artifacts with proper dedup and sorting
- **Platform builders**: New `useSessionArtifacts` hook and `SessionArtifactEntry` type available from `@stigmer/react`
- **ArtifactsWidget API**: Breaking prop change (`execution` → `executions`) — only consumer was `SessionPage.tsx` (updated)

## Related Work

- `useExecutionArtifacts` (preserved, single-execution derivation)
- `ArtifactPreviewModal` (unchanged, receives per-artifact execution context)
- `useSessionConversation` (provides the execution lists consumed by the widget)

---

**Status**: ✅ Production Ready
