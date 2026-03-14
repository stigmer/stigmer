# Web Console: Organization Context System

**Date**: March 14, 2026

## Summary

Added a global organization context to the Stigmer Web Console, ensuring every API call is scoped to the user's active organization. This was identified as a critical prerequisite for draft flows (T06), which need the org to resolve system agents before any agent is selected. The implementation introduces a service, React context, sidebar switcher, and wires the active org into all existing search hooks and execution creation.

## Problem Statement

The web console lacked an explicit concept of "active organization." The Run page inferred the org from the selected agent's SearchResult, but this approach fails for draft flows where no agent has been selected yet — the system agent must be resolved by org slug + agent slug.

### Pain Points

- No way to scope catalog searches to a specific org
- Run page silently coupled org to the selected agent, rather than having it as an independent selection
- No mechanism for users with multiple org memberships to switch context
- Draft flows (T06) need the org to call `AgentQueryController.getByReference(orgSlug, agentSlug)` to resolve system agents

## Solution

Introduced a three-layer architecture:

1. **Service layer** (`org-service.ts`): Thin Connect-RPC wrapper over `OrganizationQueryController.findMyOrganizations(Empty)` → `Organization[]`
2. **Context layer** (`org-context.tsx`): `OrgProvider` with `useOrg()` (full state) and `useActiveOrgSlug()` (convenience) hooks. Manages fetching, selection, error state, and localStorage persistence.
3. **UI layer** (`OrgSwitcher.tsx`): Sidebar component with four distinct render states — loading skeleton, error with retry, single org (static display), multiple orgs (native dropdown).

## Implementation Details

**New files:**
- `client-apps/web-console/src/services/org-service.ts` — RPC client with `fetchMyOrganizations()`
- `client-apps/web-console/src/contexts/org-context.tsx` — React context, provider, and two hooks
- `client-apps/web-console/src/components/layout/OrgSwitcher.tsx` — Sidebar org selector

**Modified files:**
- `Sidebar.tsx` — OrgSwitcher rendered between header and navigation
- `Providers.tsx` — OrgProvider nested inside AuthGuard
- `useResourceCatalog.ts` — Reads active org internally, passes to search, refetches on change
- `useAgentSearch.ts` — Same internal org consumption pattern
- `app/run/page.tsx` — Uses `useActiveOrgSlug()` for execution creation

**Key pattern: hooks consume context internally.** Rather than threading `org` through every component's props, the hooks call `useActiveOrgSlug()` themselves. This keeps call sites clean and ensures org-scoping is automatic. The `org` dependency in `useCallback` triggers useEffect re-runs on org switch, resetting query/page state.

**Org identifier format:** Confirmed via proto analysis that `org` fields across the entire API surface use the organization **slug** (e.g., "stigmer"), not UUID IDs. Validation pattern: `^$|^[a-z][a-z0-9-]*$`.

## Benefits

- All catalog searches and execution creation are now automatically org-scoped
- Users with multiple org memberships can switch between them with persistence across sessions
- Draft flows (T06) can call `useActiveOrgSlug()` to resolve system agents without requiring any user interaction for org selection
- Zero call-site changes needed for existing catalog pages — hooks handle it internally
- `yarn build` passes with zero errors

## Impact

- **Web Console users**: Org context is now visible in the sidebar; searches and executions respect the active org
- **T06 Draft Flows**: Unblocked — system agent resolution can now use `useActiveOrgSlug()` immediately
- **Existing pages**: All three catalog pages (Agents, Skills, MCP Servers), the agent picker on the Run page, and execution creation are automatically org-aware

## Related Work

- Part of `20260314.01.web-console-mvp` project
- Predecessor: T05 Resource Catalog (Session 6)
- Successor: T06 Draft Flows (next)
- Commit: `f0002518` on `feat/add-web-console`

---

**Status**: ✅ Production Ready
**Timeline**: Session 7 (single session)
