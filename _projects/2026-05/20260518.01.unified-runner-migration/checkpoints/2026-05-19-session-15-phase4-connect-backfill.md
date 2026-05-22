# Session 15: Phase 4 — Connect Backfill for Deep Agent

**Date**: 2026-05-19  
**Duration**: ~30 minutes  
**Status**: Complete

## Accomplishments

- Created shared `connect-backfill.ts` module with harness-agnostic `ResolvedMcpServer[]` in/out signature
- Wired backfill into `execute-deep-agent/setup.ts` between `resolveMcpServers()` and `connectMcpServers()`
- Refactored `execute-cursor/connect-backfill.ts` to delegate to shared module (thin wrapper)
- Added 17 unit tests for the shared module
- Removed "MCP package pre-installer" from roadmap (unnecessary)
- All 488 tests passing, `tsc --noEmit` clean

## Key Decisions

1. **Shared module with simplified signature** — Function takes `ResolvedMcpServer[]` and returns `ResolvedMcpServer[]` instead of wrapper types. Each harness maps the result into its own format. This is the most composable interface.

2. **MCP package pre-installer removed** — Analysis showed all 56 seedpack MCP servers use self-installing commands (npx: 14, uvx: 8, go run: 3, HTTP: 31). No server requires explicit pre-installation. The 270s discovery timeout is sufficient for cold starts.

3. **Cursor wrapper (Option A)** — Kept the cursor `index.ts` call site unchanged by making the cursor-specific file a thin wrapper that delegates to shared and rebuilds `cursorConfig`. Less invasive than Option B (direct shared import in cursor index).

## Files Created

| File | Purpose |
|------|---------|
| `src/shared/connect-backfill.ts` | `needsBackfill`, `backfillMcpServersIfNeeded`, `extractRuntimeEnvForServer` |
| `src/shared/__tests__/connect-backfill.test.ts` | 17 unit tests |

## Files Modified

| File | Change |
|------|--------|
| `src/activities/execute-deep-agent/setup.ts` | Added backfill step between resolve and connect in MCP setup |
| `src/activities/execute-cursor/connect-backfill.ts` | Refactored to thin wrapper delegating to shared module |

## Verification

- 488 tests pass (471 existing + 17 new)
- `tsc --noEmit` clean
- No new dependencies
- Cursor `index.ts` call site unchanged (backward compatible)

## Next Session

Continue with remaining Phase 4 items:
- Skill relevance filtering (exclude low-relevance skills when count >= 8)
- Remote workspace backend (Daytona sandbox)
- Or move to Phase 5 (Testing) — port Python tests, integration, HITL e2e
