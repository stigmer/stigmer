# Feature-Flagged Cloud Agent Path for Cursor Runner

**Date**: May 10, 2026

## Summary

Added cloud Cursor agent support to the cursor-runner, enabling sessions with git-backed workspaces to use `Agent.create({ cloud: { repos } })` instead of local agents. Cloud agents (bc- prefix) run on Cursor's servers with natively durable conversation state. The feature is gated behind `STIGMER_CURSOR_CLOUD_MODE_ENABLED` (default: false) and completes the final task of the cursor-harness-durability project.

## Problem Statement

The cursor-runner only supported local Cursor agents (`Agent.create({ local: { cwd } })`), which have known durability issues — the SDK's local store is keyed by `process.cwd()`, agents don't reliably retain context across `send()` calls, and evicted agents lose conversation history entirely. While Tasks 1-7 built a robust Stigmer-owned durability layer for local agents, Cursor's cloud agents offer native durability for git-backed workspaces without needing continuation prompts at all.

### Pain Points

- Git-backed sessions couldn't leverage Cursor's native cloud agent durability
- All sessions were forced into local mode regardless of workspace type
- No path for users with GitHub repositories to get the simpler, more reliable cloud agent experience

## Solution

Feature-flagged cloud agent mode that activates when all workspace entries are `GitRepoSource` (HTTPS URLs). The mode is determined once on first execution, persisted in `SessionSpec.cursor_mode`, and never re-evaluated — matching the immutability invariant established in the proto design (Task 5).

## Implementation Details

**New module: `cursor-mode.ts`** — Pure function `determineCursorMode(workspaceEntries, flagEnabled)` inspects workspace entries and the feature flag. All-GitRepoSource entries with flag enabled yields CLOUD; any LocalPathSource or flag disabled yields LOCAL.

**Extended `session-lifecycle.ts`** — `AgentResolution.mode` widened from `"local"` to `"local" | "cloud"`. New `createCloudAgent()` and `resumeCloudAgent()` functions call the Cursor SDK with `cloud: { repos }` instead of `local: { cwd }`. No platform options for cloud agents — cloud state lives on Cursor's servers, not in local SQLite.

**Bridge layer in `blueprint-resolver.ts`** — `resolveCloudRepos()` maps Stigmer's `GitRepoSource` proto to the Cursor SDK's `CloudAgentOptions.repos` shape (`{ url, startingRef? }`).

**Prompt selection matrix** — Cloud agents with live conversation context get the raw user message (trust native Cursor context). Only on the fallback path — cloud agent expired, fresh agent created — does Stigmer inject a continuation prompt from persisted session memory.

**Feature flag** — `STIGMER_CURSOR_CLOUD_MODE_ENABLED` env var (default: false) in config.ts.

## Benefits

- Git-backed sessions can now use Cursor's native cloud agent durability
- Simpler prompt path for cloud agents — no continuation prompt overhead on every turn
- Stigmer memory persisted as backup even in cloud mode (handles cloud agent expiry)
- Feature-flagged rollout — zero risk to existing local-mode sessions
- Clean separation: local agents get platform options, cloud agents don't

## Impact

- **cursor-runner**: 8 files changed (2 new, 6 modified), 597 insertions, 79 deletions
- **Tests**: 30 new tests (11 cursor-mode, 13 session-lifecycle cloud, 6 prompt-selection cloud), all 379 pass
- **No proto changes**: All types (CursorMode, SessionSpec.cursor_mode, workspace types) were already created in Task 5
- **No Java/workflow changes**: The workflow already reads cursorMode via readSessionContext (Task 7)
- **Project completion**: This is the 8th and final task of the cursor-harness-durability project

## Related Work

- Task 1: Stabilize local agent store lookup (platform options)
- Task 5: Proto/data model updates (CursorMode enum, SessionSpec.cursor_mode)
- Task 7: Workflow integration (readSessionContext reads cursorMode)
- Tasks 2a/2b/3/6: Durability layer (extraction, prompts, fallback, persistence)

---

**Status**: Production Ready (feature-flagged)
**Timeline**: 1 session (~1 hour)
