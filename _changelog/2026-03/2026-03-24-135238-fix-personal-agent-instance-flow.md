# Fix Personal Agent Instance Flow

**Date**: March 24, 2026

## Summary

Fixed four issues in the React SDK's personal agent instance creation flow. The audit verified that the backend correctly persists and queries personal labels — all bugs were in the frontend state management and orchestration layer. These fixes prevent silent agent selection loss, unnecessary resource creation, stuck error states, and duplicate instances.

## Problem Statement

The personal agent instance flow — the path where users save secrets for reuse across sessions — had several correctness issues discovered during a thorough audit of the `useAgentSetup` hook, `agentSetupReducer`, and `SessionComposer`.

### Pain Points

- When session pool keys satisfied an agent's env_spec reactively (via `POOL_RESOLVE`), the parent component was never notified of the resolution, causing the selected agent to be silently dropped in favor of the default agent
- When pool keys (not personal env) covered env_spec during `resolveAgent`, the hook eagerly created a personal instance bound to an empty environment — subsequent sessions would find this instance and incorrectly report "saved" status with no actual values
- If the save-path API call failed during `submitEnvVars`, the state machine got stuck in `submitting` with no way to retry, because `missingVariables` was dropped during the transition
- Concurrent calls to `resolveAgent` or `submitEnvVars` (two tabs, double-click) could both see an empty instance list and create duplicates

## Solution

Four targeted fixes, all in the React SDK layer:

1. **Pool-resolve notification effect** — Bridge the gap between the reactive `POOL_RESOLVE` state transition and the imperative `onAgentResolutionChange` callback
2. **Pool-only detection** — Separate "personal env covers all keys" from "pool covers remaining keys" to prevent premature instance creation
3. **Error state recovery** — Preserve `missingVariables` through the `submitting` phase and revert to `needsEnvVars` on failure
4. **Find-or-create guard** — Re-check for existing instances immediately before creating to narrow the race window

## Implementation Details

### Issue 1: `POOL_RESOLVE` notification gap (`SessionComposer.tsx`)

Added a `useEffect` that watches `agentSetup.state` and calls `onAgentResolutionChange` when the state transitions to `ready`. This covers the `POOL_RESOLVE` auto-resolve path that the imperative callbacks (`handleAgentSelect`, `handleEnvSubmit`) miss. The effect is idempotent — the callbacks already fire synchronously before the state re-renders.

### Issue 2: Pool-only instance creation (`useAgentSetup.ts`)

In `resolveAgent`, the single `missingVariables.length === 0` check was split into two conditions:
- `personalOnlyMissing` (diff without pool) — when zero, personal env covers everything, create instance as before
- `missingVariables` (diff with pool) — when zero but personal has gaps, resolve as `direct` mode without creating any resources

### Issue 3: Error recovery during submit (`agentSetupReducer.ts`)

Three changes to the reducer:
- Added `missingVariables` to the `submitting` variant of `AgentSetupPhase`
- `SUBMIT_START` now carries `missingVariables` forward from `needsEnvVars`
- `ERROR` handler checks for `submitting` status and reverts to `needsEnvVars` with the preserved variables, enabling retry

### Issue 4: Duplicate instance guard (`useAgentSetup.ts`)

Extracted a `findOrCreatePersonalInstance` helper that re-queries the instance list with both personal labels immediately before calling `create`. Both `resolveAgent` and `submitEnvVars` now use this helper, eliminating the most common duplicate scenario (slow initial list response followed by concurrent creates).

## Benefits

- **Correctness**: Selected agents are no longer silently dropped when pool keys satisfy env_spec
- **Data integrity**: Personal instances are only created when the personal environment actually contains the required values
- **Error resilience**: Users can retry failed save operations without needing to re-select the agent
- **Dedup safety**: Narrowed race window for duplicate personal instance creation

## Impact

- **React SDK** (`@stigmer/react`): Three files changed — `agentSetupReducer.ts`, `useAgentSetup.ts`, `SessionComposer.tsx`
- **Platform builders**: The `useAgentSetup` hook now behaves more predictably; pool-satisfied agents resolve correctly as `direct` mode rather than creating phantom "saved" instances
- **End users**: Error recovery during secret saving now works — the env form reappears with the error message instead of a stuck spinner

## Related Work

- Default agent instance public visibility (implemented earlier in this session via `visibility_public` mechanism)
- `DefaultAgentInstanceFactory` for platform-owned instances
- MongoDB migration for existing default instances (`U20260324_DefaultAgentInstancePublicVisibility`)

---

**Status**: Production Ready
