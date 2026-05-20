# Platform Mount: Virtual `.stigmer/` Namespace for Unified Runner

**Date**: May 20, 2026

## Summary

Built the `.stigmer/` virtual platform mount for the unified TypeScript runner, implementing transparent path routing so platform files (skills, attachments) live in a separate physical directory while the agent sees them under `.stigmer/` in the workspace. This is a foundational module for the Tier 6 feature-gap workstreams (attachment injection, subagent transformer).

## Problem Statement

The deep-agent execution pipeline had no platform mount — skills were written directly into the workspace root, polluting the user's git repo or project directory. The Cursor harness had an ad-hoc solution (symlink + duplicated `getPlatformDir`) but the deep-agent path had nothing.

### Pain Points

- Skills written to `.stigmer/skills/` landed inside the user's cloned repo (visible in `git status`)
- Local-path workspaces (user's project dir) would get a `.stigmer/` folder injected
- Multi-entry workspaces needed a shared platform location across all entries
- `getPlatformDir()` was duplicated in two Cursor harness files
- No `STIGMER_PLATFORM_DIR` env var injection for shell commands
- No display humanization (absolute sandbox paths leaked to users)

## Solution

Separate physical `platformDir` at `~/.stigmer/sessions/{sessionId}/platform/` with transparent path routing in `LocalWorkspaceBackend`. The agent sees `.stigmer/*` paths; the backend routes them to the platform directory. The workspace is never polluted.

## Implementation Details

**New modules:**
- `platform-mount.ts` — 5 pure functions ported from Python AD-01 v3: `classifyPlatformPath`, `humanizePlatformRefs`, `resolvePlatformCommand`, `humanizeSandboxPaths`, `resolveDisplayEnvVars`
- `platform-dir.ts` — Shared `getPlatformDir`/`ensurePlatformDir` replacing Cursor harness duplication

**Modified modules:**
- `WorkspaceBackend` interface — Added optional `platformDir` property (backward-compatible)
- `LocalWorkspaceBackend` — Added `resolvePath()` routing, `STIGMER_PLATFORM_DIR` env injection in `execute()`, auto-mkdir for platform writes, path traversal guard
- `setup.ts` — Wired `ensurePlatformDir(sessionId)` into workspace provisioning
- Cursor harness — Replaced duplicated `getPlatformDir` with shared module

**Security:** Path traversal guard rejects `.stigmer/../../etc/passwd` — resolved paths must stay within `platformDir`.

## Benefits

- Zero workspace pollution — user repos and project directories are never modified
- Shared platform location across multi-entry workspaces
- Eliminated code duplication between Cursor and deep-agent harnesses
- Display humanization ready for StatusBuilder integration
- Foundation for W2 (Attachment Injector) and W3 (Subagent Transformer)

## Impact

- **Unified runner**: Deep-agent skills now route to the correct platform directory
- **Cursor harness**: Simplified by using shared `platform-dir.ts`
- **Test coverage**: 86 new tests (61 pure function + 25 routing), 809 total

## Related Work

- Python reference: `graphton/core/backends/platform_mount.py` (AD-01 v3)
- Tier 6 plan: `T05_tier6_0_plan.md` (W1 Platform Mount)
- Next: W2 Attachment Injector, W3 Subagent Transformer

---

**Status**: Production Ready
**Timeline**: 1 session (~30 minutes)
