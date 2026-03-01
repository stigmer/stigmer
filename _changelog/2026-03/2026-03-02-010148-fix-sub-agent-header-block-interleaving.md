# Fix Sub-Agent Header Block Interleaving and Invisible Headers

**Date**: March 2, 2026

## Summary

Fixed two bugs that caused the sub-agent header block UX to silently fall back to the old dim separator (`── general-purpose ──`) despite the expandable header infrastructure being committed and present. The root cause was an architectural vulnerability in the block rendering logic that relied on fragile block adjacency, combined with an invisible-header bug when `input` was empty.

## Problem Statement

The sub-agent header block feature (commit `f7916533`) introduced expandable `🔀 general-purpose ─ <description> ▶` headers to replace the old dim separators. However, users continued seeing the old format in production.

### Pain Points

- **Interleaving vulnerability**: `needsSubAgentSeparator` checked only the immediately preceding block to decide if a separator was needed. When top-level events (system messages, phase changes) were appended between sub-agent blocks across `Recv()` iterations, the preceding block had `subAgentID=""`, triggering the old separator even though a header block already existed higher in the block list
- **Invisible header when input is empty**: `newSubAgentBlock` set `expandable: false` when `input` was empty but only populated `preview`/`full` fields — not `content`. Since `displayContent()` returns `content` for non-expandable blocks, the header rendered as an empty string and was invisible in the viewport
- **Old separator format in fallback path**: The fallback separator still used `── name ──` instead of the new `🔀` visual language

## Solution

Made the separator logic header-aware rather than adjacency-dependent, fixed the block construction for non-expandable headers, and aligned the fallback format with the new visual language.

## Implementation Details

### `needsSubAgentSeparator` rewrite (`render_blocks.go`)

Replaced the fragile "check immediately preceding block" logic with a two-phase approach:

1. **Header scan**: Walk forward through blocks looking for a `blockSubAgent` header with the same `subAgentID`. If found, return `false` unconditionally — the user has already been introduced to this sub-agent context regardless of interleaving.
2. **Orphaned fallback**: Only reached when no header exists (abnormal state). Uses the original adjacency check to show a single separator on context switch, avoiding duplicates for consecutive orphaned blocks.

### `newSubAgentBlock` fix (`blocks.go`)

When `input` is empty (non-expandable header), the block now sets `content` directly instead of `preview`/`full`. This ensures `displayContent()` returns the header text for non-expandable blocks.

### Fallback separator format (`render_blocks.go`)

`renderSubAgentSeparator` changed from `── name ──` to `🔀 name`, matching the header block visual language.

### Diagnostic logging (`run_stream_subagent.go`)

Added a warning log when a sub-agent arrives with empty `input`, making pipeline data loss immediately visible in CLI logs.

## Benefits

- Sub-agent headers are now robust against event interleaving — no more silent fallback to old separators
- Headers are visible even when the backend sends empty `input` (graceful degradation)
- Fallback separator matches the new visual language for consistency
- 8 new test cases covering interleaving, orphaned blocks, multiple sub-agents, and block construction

## Impact

- **CLI users**: The expandable sub-agent header (`🔀 general-purpose ─ <description> ▶`) now reliably appears in all execution scenarios
- **5 files changed** in the CLI (4 Go source, 1 Go test)
- **124 tests pass** including 8 new interleaving and block construction tests

## Related Work

- Builds on the sub-agent header block infrastructure from `f7916533` (`feat(cli,backend): replace dim sub-agent separator with expandable header block`)
- Addresses the same UX gap documented in `2026-03-01-052620-sub-agent-header-block-ux.md`

---

**Status**: ✅ Production Ready
