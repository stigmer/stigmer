# Draft Session Pre-fill and "Create New" Flow

**Date**: March 20, 2026

## Summary

Added `initialAgentRef` prop to `SessionComposer` (SDK) for mount-time agent auto-resolution, wired `SessionLauncher` (Console) to read `?draft=` query params and pre-select system creator agents, and updated all Library "Create New" buttons to navigate with draft session URLs. This completes Phase 3 of the Library and Artifacts project — the full "Create New" flow from Library to session creation to artifact apply.

## Problem Statement

The Library pages had "Create New" buttons for Agents, Skills, and MCP Servers, but they all navigated to the generic home page (`/`) with no pre-selection. Users had to manually find and select the system creator agent every time they wanted to create a new resource.

### Pain Points

- "Create Agent" in Library navigated to `/` with no agent pre-selected — user had to open Configure > Agent > search for "agent-creator" > select it
- No programmatic way for `SessionComposer` consumers to pre-select an agent on mount — the resolution flow was only triggered by `AgentPicker` user interaction
- Platform builders embedding `SessionComposer` had no way to pre-fill an agent for specific workflows (e.g., "Start a code review" button)

## Solution

Three-layer approach following the SDK-first architecture:

1. **SDK layer** (`@stigmer/react`): Added `initialAgentRef` prop to `SessionComposer` that triggers the full agent resolution flow on mount — env spec check, personal instance lookup, credential collection — exactly as if the user picked the agent manually.

2. **Console routing layer** (`page.tsx`): Server component reads `searchParams.draft` and validates against known draft types, passing the result to `SessionLauncher` as a prop. No `useSearchParams()` needed, no `<Suspense>` boundary required.

3. **Console composition layer** (`SessionLauncher`): Derives `initialAgentRef` from the draft type, sets a contextual placeholder ("Describe the agent you want to create…"), and clears the URL param on mount to prevent stale state.

## Implementation Details

### SDK: `initialAgentRef` on `SessionComposer`

- New optional prop `initialAgentRef?: ResourceRef` on `SessionComposerProps`
- Mount-time `useEffect` with two ref guards:
  - `handleAgentSelectRef` (stable callback ref pattern) — avoids effect re-fires when `handleAgentSelect` reference changes
  - `initialAgentHandled` (boolean ref) — ensures one-time execution, handles React StrictMode double-fire
- Calls the existing `handleAgentSelect` which runs the full resolution: `agentSetup.resolveAgent(ref)` → fetch agent → env spec check → personal instance lookup → `onAgentRefChange` + `onAgentResolutionChange`
- If agent needs env vars, `AgentEnvForm` appears naturally via the existing state machine

### Console: `page.tsx` + `SessionLauncher`

- `page.tsx` reads `searchParams.draft` as a server component prop (Next.js 16 `Promise`-based API)
- `SessionLauncher` accepts `draftType?: DraftResourceType | null`
- Derives `initialAgentRef` from `CREATOR_AGENTS[draftType]`
- Derives contextual placeholder per draft type
- Clears `?draft=` from URL via `window.history.replaceState` on mount

### Library pages: draft session URLs

- `LibraryLanding.tsx`: `CREATE_SHORTCUTS` updated from `href: "/"` to `getDraftSessionUrl("agent")` etc.
- `AgentListPage.tsx`, `SkillListPage.tsx`, `McpServerListPage.tsx`: "Create X" ghost links updated

## Benefits

- **Zero-click agent selection**: "Create Agent" in Library → lands on home with agent-creator already resolved and placeholder guiding the user
- **Platform builder DX**: Any `SessionComposer` consumer can pre-select an agent for workflow-specific entry points
- **Full env spec support**: If a creator agent requires credentials, the env form appears automatically — no special handling needed
- **URL-shareable**: `/?draft=agent` is bookmarkable and shareable
- **Clean URL**: Draft param cleared on mount — refresh shows clean home page

## Impact

- **SDK**: 1 new prop on `SessionComposer` (non-breaking, optional)
- **Console**: 7 files modified (1 page, 1 component, 4 library pages, 1 project doc)
- **Users**: "Create New" in Library now directly pre-selects the right system agent
- **Platform builders**: Can pre-fill agents in their own `SessionComposer` embeddings

## Related Work

- [Draft Session Navigation Helper](2026-03-20-175629-draft-session-navigation-helper.md) — T03.1, the `draft-session.ts` utility consumed here
- [Artifacts Widget and Modal-only Apply](2026-03-20-173736-artifacts-widget-and-modal-only-apply.md) — Phase 2, the artifact review/apply flow that completes the end-to-end "Create New" journey

---

**Status**: ✅ Production Ready
**Timeline**: Phase 3 complete (T03.1–T03.3)
