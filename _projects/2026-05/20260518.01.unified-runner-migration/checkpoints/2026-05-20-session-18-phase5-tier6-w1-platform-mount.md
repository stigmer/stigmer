# Session 18: Phase 5 Tier 6 W1 — Platform Mount

**Date**: 2026-05-20
**Duration**: ~30 minutes
**Status**: W1 Complete

## Accomplishments

- Built the `.stigmer/` virtual platform mount for the unified TS runner
- Ported all 5 display/routing functions from Python `graphton/core/backends/platform_mount.py`
- Added transparent `.stigmer/` path routing to `LocalWorkspaceBackend`
- Created shared `getPlatformDir`/`ensurePlatformDir` replacing duplication in Cursor harness
- Wired platform directory into `setup.ts` for deep-agent execution pipeline
- Cleaned up Cursor harness to use shared platform-dir module

## Design Decision: Separate platformDir (Not Real Directory)

Resolved the open design question from T05 plan: `.stigmer/` must **never** physically exist inside a workspace entry. Instead, a separate `platformDir` at `~/.stigmer/sessions/{sessionId}/platform/` is created per session, with transparent path routing in `LocalWorkspaceBackend`.

**Rationale**: Single-entry workspaces set `rootDir` to the cloned repo — placing `.stigmer/` there pollutes the user's git repo. Local-path workspaces would modify the user's project directory. The separate `platformDir` approach matches the Python AD-01 v3 architecture and the existing Cursor harness pattern.

## Files Created (4)

| File | Tests | Purpose |
|------|-------|---------|
| `src/shared/workspace/platform-mount.ts` | — | 5 pure functions + 3 constants for path classification, display humanization, command rewriting |
| `src/shared/workspace/platform-dir.ts` | — | Shared `getPlatformDir`/`ensurePlatformDir`, session-scoped platform directory |
| `src/shared/workspace/__tests__/platform-mount.test.ts` | 61 | All pure functions: classifyPlatformPath, humanizePlatformRefs, resolvePlatformCommand, humanizeSandboxPaths, resolveDisplayEnvVars, combined pipeline |
| `src/shared/workspace/__tests__/local-backend-platform.test.ts` | 25 | Backend routing, env injection, traversal safety, backward compat, initializeLocalWorkspace |

## Files Modified (5)

| File | Change |
|------|--------|
| `src/shared/workspace/types.ts` | Added optional `platformDir` property to `WorkspaceBackend` interface |
| `src/shared/workspace/local-backend.ts` | Added `.stigmer/` path routing via `resolvePath()`, `STIGMER_PLATFORM_DIR` env injection in `execute()`, auto-mkdir for platform writes, path traversal guard |
| `src/activities/execute-deep-agent/setup.ts` | Wired `ensurePlatformDir(sessionId)` into `provisionWorkspace()`, passes `platformDir` to all `LocalWorkspaceBackend` instances |
| `src/activities/execute-cursor/skill-resolver.ts` | Replaced local `getPlatformDir` with shared module import |
| `src/activities/execute-cursor/attachment-resolver.ts` | Replaced local `getPlatformDir` with shared module import |

## Verification

- `tsc --noEmit` clean
- 809 tests passing (86 new, 723 existing)
- 53 test files (2 new, 51 existing)
- Zero linter errors

## Key Technical Notes

- **Path traversal guard**: `resolvePath()` checks that resolved platform paths don't escape `platformDir` via `..` components — throws `Error("Path traversal detected")`
- **Auto-mkdir for platform writes**: `writeFile` auto-creates parent directories for platform-routed paths only (not workspace paths, where unexpected mkdir could mask bugs)
- **Command rewriting**: `execute()` rewrites `.stigmer` → `$STIGMER_PLATFORM_DIR` in commands when `platformDir` is set, and injects the env var
- **Backward compat**: All existing 723 tests pass unchanged. `LocalWorkspaceBackend` without `platformDir` behaves identically to before.
- **`git.ts` addGitExcludes**: Kept as defense-in-depth (adds `.stigmer` to `.git/info/exclude` after clone)

## Next Session

Continue with W2: Attachment Injector (depends on W1 — attachments go under `.stigmer/inputs/`).
