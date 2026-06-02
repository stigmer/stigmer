# Hard-Fail Stale Runner Build Guard

**Date**: May 27, 2026

## Summary

Upgraded the runner's build freshness check from warn-only to a hard process exit, added clean-dist-before-build to the npm build script, and ensured `kill-desktop` kills orphaned runner processes. Together these changes make it impossible to silently run stale compiled JavaScript.

## Problem Statement

The structured output validation failure (`daily-notification-plan` workflow failing with "Agent did not return structured output") persisted for 4 days across 15+ manual test iterations. MongoDB analysis of the 15 most recent `notification-analyst` agent executions proved the root cause: in 8 of 15 runs, `spec.executionConfig.structuredOutputSchema` was absent from the AgentExecution document — meaning the schema propagation code in `call-agent.ts` was never executed because `dist/` contained stale compiled JavaScript.

### Pain Points

- The build fingerprint guard logged `!!! STALE RUNNER BUILD DETECTED !!!` to stderr but allowed the runner to start and serve stale code
- `tsc` compiled on top of existing `dist/` artifacts, allowing orphan `.js` files from deleted/renamed sources to survive
- `kill-desktop` did not kill `node runner/dist/main` processes, so a long-lived runner could survive across `make desktop-dev` restarts
- The error message in the running binary ("or parseable JSON in final_text") did not match the current source ("Agent did not return structured output"), confirming the code divergence

## Solution

Three changes that form a layered defense:

1. **Hard exit on stale build**: `checkBuildFreshness()` in `main.ts` now calls `process.exit(78)` (EX_CONFIG) when the source hash diverges from the build fingerprint. The runner refuses to start instead of silently running old code. Missing fingerprint (first build, CI, tsx) gracefully skips the check.

2. **Clean dist before build**: The `build` script in `package.json` now runs `rm -rf dist` before `tsc`, ensuring every build is a clean compilation with no orphan artifacts.

3. **Kill runner processes on restart**: The `kill-desktop` Makefile target now includes `pkill -f "runner/dist/main"`, ensuring no stale runner process survives across `make desktop-dev` runs.

## Implementation Details

### `backend/services/runner/src/main.ts`

Changed `checkBuildFreshness()` from `console.warn(...)` to `console.error(...)` + `process.exit(78)`. Updated the JSDoc to reflect the fail-fast behavior and the conditions under which the check is skipped (missing fingerprint file in CI/tsx/first-build scenarios).

### `backend/services/runner/package.json`

Changed build script from `tsc -p tsconfig.build.json && node scripts/build-fingerprint.js` to `rm -rf dist && tsc -p tsconfig.build.json && node scripts/build-fingerprint.js`.

### `Makefile`

Added `@-pkill -f "runner/dist/main" 2>/dev/null || true` as the first line in `kill-desktop`.

## Benefits

- Stale runner code can no longer run silently — the process exits immediately with a clear message telling the developer to rebuild
- Clean builds eliminate orphan JavaScript artifacts that could cause subtle behavior differences
- Runner process lifecycle is properly managed across desktop-dev restarts

## Impact

- **Developer workflow**: If you edit runner source and restart the desktop app without rebuilding, the runner exits immediately with instructions instead of running stale code for 6+ minutes
- **Production**: No impact — the fingerprint file doesn't exist in Docker images (no `src/` alongside `dist/`), so the check gracefully skips
- **CI**: No impact — integration tests use `tsx src/main.ts` (no `dist/`), so the fingerprint file is absent and the check skips

---

**Status**: Production Ready
**Timeline**: Single session
