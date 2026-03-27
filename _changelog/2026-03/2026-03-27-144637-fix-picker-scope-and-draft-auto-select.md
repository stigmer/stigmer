# Fix Picker Scope and Draft Auto-Select Silent Failures

**Date**: March 27, 2026

## Summary

Fixed two compounding bugs that prevented the "Create MCP Server" (and all draft creation) flows from working: (1) all resource pickers in the SessionComposer searched only within the user's org, hiding public/platform agents from other orgs, and (2) the initial agent auto-select silently swallowed resolution failures with no retry.

## Problem Statement

When clicking "Create MCP Server" from the Library, the user landed on the session launcher but:

- The MCP Server Creator agent was not pre-selected (no agent chip, no contextual placeholder)
- Opening Configure > Agent manually showed "No agents found" — even though 4 agents existed in the search index
- The server logs confirmed: `Search completed: totalCount=0, pageResults=0, kinds={agent=4}`

The previous fix (2026-03-27-132841) addressed an org-loading race condition but did not fix the actual root causes.

### Root Cause 1: Picker search scope was org-locked

`useResourceSearch` always sent the user's org (e.g., `"suresh"`) as the `org` param to the Search API. Per the proto contract, non-empty `org` means "search only within that org." System agents in the `stigmer` org were excluded from results entirely.

The Library page worked because `useResourceList` sends `org: ""` when `scope === "all"`. The picker hooks (`useAgentSearch`, `useMcpServerSearch`, `useSkillSearch`) never did this.

### Root Cause 2: Initial agent resolution failed silently

The initial-agent effect in `SessionComposer` set `initialAgentHandled.current = true` synchronously before the async `handleAgentSelect` resolved. If `resolveAgent` failed (agent not found, permissions, network), the one-shot guard prevented retry and the catch block produced no user-visible feedback.

### Root Cause 3: `initialAgentRef` capture was fragile

The `useState` initializer in `SessionLauncher` depended on `useSearchParams()` having URL params on the very first render. In Next.js `output: "export"` (static export), this can fail on full page loads.

## Solution

### Fix 1: Add `scope` option to resource search and all pickers

- Added `scope?: "org" | "all"` to `UseResourceSearchOptions`. When `scope === "all"`, the search sends `org: ""` and `excludePublic: false`, matching the `useResourceList` pattern.
- Propagated the `scope` option through `useAgentSearch`, `useMcpServerSearch`, and `useSkillSearch` (via their shared `UseResourceSearchOptions` type).
- Added `scope` prop to `AgentPicker`, `McpServerPicker`, and `SkillPicker`. Default is `"org"` for backward compatibility.
- `SessionComposer` passes `scope="all"` to all three pickers so the session context shows all accessible resources.

### Fix 2: Robust initial-agent effect

- The one-shot guard (`initialAgentHandled.current`) is now reset on failure, allowing retry when dependencies change.
- Added cancellation tracking to prevent stale updates.

### Fix 3: Resilient `initialAgentRef` capture

- Replaced the `useState`-only initializer with `useState` + `useEffect`. The initializer handles the fast path (params available on first render). The effect handles the deferred path (params arrive after hydration in static export).

## Files Changed

**SDK layer (`@stigmer/react`):**

- `sdk/react/src/search/useResourceSearch.ts` — added `scope` option
- `sdk/react/src/agent/useAgentSearch.ts` — JSDoc update (scope forwarded via type alias)
- `sdk/react/src/agent/AgentPicker.tsx` — added `scope` prop
- `sdk/react/src/mcp-server/McpServerPicker.tsx` — added `scope` prop
- `sdk/react/src/skill/SkillPicker.tsx` — added `scope` prop
- `sdk/react/src/composer/SessionComposer.tsx` — `scope="all"` on all three pickers; fixed initial-agent effect timing

**Console layer (`client-apps/web`):**

- `client-apps/web/src/components/session/SessionLauncher.tsx` — hardened `initialAgentRef` capture

## Benefits

- All resource pickers in the session composer now show public/platform resources from all accessible orgs
- Draft creation flows (Create Agent, Create Skill, Create MCP Server) have resilient agent auto-selection
- The `scope` prop is additive — no breaking changes for SDK consumers who default to org-scoped search
- Platform builders can opt into `scope="all"` when embedding pickers in their own products

## Impact

- **Direct users**: Agent, MCP server, and skill pickers now show platform resources alongside org-owned ones. Draft flows work as designed.
- **Platform builders**: New optional `scope` prop on all pickers. Existing code is unaffected (default `"org"`).
- **SDK surface**: Three new optional props (`scope` on `AgentPicker`, `McpServerPicker`, `SkillPicker`). No removed or renamed exports.

---

**Status**: ✅ Production Ready
