# Fix Draft Agent Pre-Selection Race Condition

**Date**: March 27, 2026

## Summary

Fixed a race condition that prevented creator agents from being pre-selected when users initiated draft sessions via "Create Agent", "Create Skill", or "Create MCP Server" flows. The initial-agent effect in `SessionComposer` fired before the organization slug finished loading, silently failed, and never retried.

## Problem Statement

When clicking "Create MCP Server" (or any draft creation link), users were redirected to a new session at `/?draft=mcp-server`, but the MCP Server Creator agent was not pre-selected. The user had to manually open Configure > Agent and pick the creator agent themselves, defeating the purpose of the draft flow.

### Pain Points

- All three draft creation flows (Agent, Skill, MCP Server) were broken by the same race condition
- The failure was silent — no error toast, no visual feedback, just an empty session launcher
- The one-shot guard pattern meant the effect would never retry, even after the org loaded milliseconds later
- Users who discovered the draft flows through the Library UI had a confusing experience: clicking "Create" appeared to do nothing special

## Solution

Two targeted changes that fix the timing issue without altering any APIs, props, or SDK export surface:

1. **Primary fix in `SessionComposer` (SDK layer)**: Added `org` as both a guard condition and a dependency to the initial-agent effect, so it only fires once the organization slug is a non-empty string.

2. **Secondary hardening in `SessionLauncher` (Console layer)**: Replaced the inline derivation of `initialAgentRef` with a `useState` initializer that captures the value once on mount, ensuring it survives any re-renders triggered by URL cleanup.

## Implementation Details

### `sdk/react/src/composer/SessionComposer.tsx`

The initial-agent effect previously depended only on `[initialAgentRef, showAgent]`. The problem was that `showAgent` is computed as `onAgentRefChange != null && org != null`, and since `useActiveOrgSlug()` returns `""` (not `null`) while loading, `showAgent` was `true` prematurely. Adding `org` to the guard (`org &&`) and the dependency array means the effect defers until the org slug transitions from `""` to the actual value.

### `client-apps/web/src/components/session/SessionLauncher.tsx`

`initialAgentRef` was derived inline from `draftType`, which itself comes from `useSearchParams()`. After the URL cleanup effect runs (`window.history.replaceState({}, "", "/")`), a future Next.js version could cause `useSearchParams()` to re-evaluate, losing the draft param. Wrapping the derivation in `useState(() => ...)` makes the capture explicit and version-safe.

## Benefits

- All three draft creation flows (Create Agent, Create Skill, Create MCP Server) now correctly pre-select the corresponding creator agent
- Zero API surface changes — no new props, no new hooks, no breaking changes for SDK consumers
- The fix is in the shared code path, so any future draft types added to `CREATOR_AGENTS` will automatically benefit
- The `useState` hardening makes `initialAgentRef` resilient to Next.js router behavior changes

## Impact

- **Direct users**: Draft creation flows now work as designed — clicking "Create MCP Server" lands the user in a session with the MCP Server Creator agent pre-selected and a contextual placeholder ("Describe the MCP server you want to create...")
- **Platform builders**: No impact — `SessionComposer`'s `initialAgentRef` prop contract is unchanged; the fix only affects internal timing of the auto-resolve effect
- **SDK surface**: No export changes, no type changes, no behavioral changes for consumers who don't use `initialAgentRef`

## Related Work

- Draft session infrastructure: `client-apps/web/src/utils/draft-session.ts` (unchanged)
- Agent setup state machine: `sdk/react/src/agent/useAgentSetup.ts` (unchanged)
- Org context: `client-apps/web/src/contexts/org-context.tsx` (unchanged — `""` as loading sentinel is a valid pattern; the fix is at the consumption site)

---

**Status**: ⚠️ Incomplete — addressed only the org-loading timing; did not fix the org-scoped search or silent error swallowing. See `2026-03-27-144637-fix-picker-scope-and-draft-auto-select.md` for the full fix.
