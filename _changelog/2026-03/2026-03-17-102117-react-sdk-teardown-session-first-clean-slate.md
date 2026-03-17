# React SDK Teardown: Session-First Clean Slate

**Date**: March 17, 2026

## Summary

Removed all feature-specific UI components, hooks, and internal primitives from `@stigmer/react`, leaving only the core provider infrastructure (`StigmerProvider`, `StigmerContext`, `useStigmer`) and the theming/styles layer. This is the SDK counterpart to the T01.3 web UI teardown, ensuring legacy component patterns do not influence the session-first UX redesign.

## Problem Statement

The `@stigmer/react` SDK contained a full set of pre-built UI components (agent picker, execution stream, session history, catalog search, approval controls, etc.) that were designed for the previous dashboard-centric console. With the session-first UX redesign underway and the web console already torn down, these SDK components are dead code that risks anchoring future design conversations to the old paradigm.

### Pain Points

- Legacy components could be mistakenly used as prior art for the new platform-for-platforms architecture
- 5 peer dependencies (`@base-ui/react`, `class-variance-authority`, `lucide-react`, `react-markdown`, `remark-gfm`) existed solely to support components that are no longer consumed
- 6 sub-path exports (`./agent`, `./session`, `./agent-execution`, `./catalog`, `./skill`, `./mcp-server`) pointed to modules with no consumers
- The internal primitive layer (`Button`, `Textarea`, `Badge`, `Section`, `Collapsible`) was tightly coupled to the deleted feature modules

## Solution

Complete teardown of all feature modules. Preserve only the infrastructure layer that the web app actively depends on: `StigmerProvider`, `useStigmer`, `StigmerContext`, and `styles.css`.

## Implementation Details

**Deleted (33 files, 2,959 lines removed across 7 directories):**
- `src/agent/` -- `AgentPicker`, `AgentCard`, `AgentOverview`, `useAgentSearch`
- `src/session/` -- `SessionCard`, `AgentSessionHistory`, `useAgentSessionList`
- `src/agent-execution/` -- `ExecutionStream`, `ExecutionStatus`, `OutputBlock`, `MessageEntry`, `MessageInput`, `ToolCallCard`, `ApprovalControls`, `SubAgentCard`, `useAgentExecution`, `useApproval`, helpers
- `src/catalog/` -- `ResourceSearchCard`, time utilities
- `src/skill/` -- `useSkillSearch`
- `src/mcp-server/` -- `useMcpServerSearch`
- `src/internal/` -- `Button`, `Textarea`, `Badge`, `Section`, `Collapsible`
- `dist/` -- stale build output from the pre-teardown codebase

**Modified (2 files):**
- `package.json` -- removed 6 sub-path exports and their `publishConfig` counterparts, removed 5 unused peer dependencies, updated description and keywords
- `README.md` -- stripped to cover only provider, hook, styles, and theming; added note about session-first rebuild

**Preserved (5 source files):**
- `src/index.ts` -- exports `StigmerProvider`, `StigmerContext`, `useStigmer`
- `src/provider.tsx` -- provider with theme scoping via `@stigmer/theme`
- `src/context.ts` -- React context for the Stigmer SDK client
- `src/hooks.ts` -- `useStigmer` hook
- `src/styles.css` -- Tailwind theme token mapping and `.stgm` scoped reset

## Benefits

- Clean starting point for rebuilding embeddable components with a platform-for-platforms mindset
- Peer dependency surface reduced from 10 to 5 packages
- Export surface reduced from 8 sub-paths to 2 (`.` and `./styles.css`)
- `npm run typecheck` and `npm run build` pass clean for both `sdk/react` and `client-apps/web`
- Git history preserves all deleted components for reference

## Impact

- **SDK consumers**: Only the provider/hook/styles infrastructure remains. Feature components will be rebuilt as part of the session-first UX project.
- **Web console**: Unaffected -- it only imports `StigmerProvider`, `useStigmer`, and `styles.css`.
- **Platform builders**: No embeddable components available yet. These will be designed from scratch with embeddability as a primary concern.

## Related Work

- T01.3: Web UI Teardown (completed, committed `10513ce1`)
- T01.4: Web App Shell (next task -- three-panel layout)
- Project: `_projects/2026-03/20260317.01.session-first-web-ux`
- Previous: React SDK README integration guide (`2026-03-16-185820`)

---

**Status**: Production Ready
