# Fix Library Scope Excluding Organization's Own Public Resources

**Date**: March 23, 2026

## Summary

Fixed the Library page's Org scope filter which was incorrectly hiding resources that belong to the user's own organization when those resources have public visibility. The Library landing card counts and list views now show all resources owned by the organization regardless of visibility, and the "All" tab correctly shows resources across all organizations.

## Problem Statement

When a user navigates to the Library page, the resource cards (Agents, Skills, MCP Servers) show counts, and the list pages offer "Org" and "All" scope toggles. Resources owned by the user's organization but marked as public were being excluded from both the card counts and the Org list view.

### Pain Points

- Library landing cards showed 0 for Agents and MCP Servers even though the organization owned public resources
- Clicking into the Agents list with "Org" selected showed "No agents found"
- Users had to discover the "All" toggle to see their own resources — unintuitive UX
- The "All" tab still sent the org filter, so it only showed the user's own org resources rather than all accessible resources across organizations

## Solution

Changed the scope-to-API-parameter mapping in the two shared hooks that power all Library views:

- **Org scope**: Stopped setting `excludePublic: true`. The `metadata.org` filter already constrains results to the user's organization; the `excludePublic` flag was redundantly (and harmfully) excluding the org's own public resources.
- **All scope**: Changed from sending the user's org slug to sending an empty org, which tells the backend to skip the org filter entirely and return all resources the caller is authorized to access.

## Implementation Details

Two files changed in `sdk/react/src/search/`:

**`useResourceList.ts`** — powers paginated list pages (AgentListPage, SkillListPage, McpServerListPage):

- `excludePublic` changed from `scope === "org"` to `false` (never exclude public from either scope)
- `org` parameter changed from always sending the active org to sending empty string when scope is `"all"`
- Updated JSDoc for `ResourceListScope` type and `scope` option to reflect corrected semantics

**`useResourceCount.ts`** — powers Library landing card counts:

- Same two parameter changes as `useResourceList.ts`
- Updated JSDoc for `scope` option

No backend changes were required. The `MongoSearchQueryStore.buildQuery` in stigmer-cloud already handles these parameter combinations correctly:

- `org` set + `excludePublic: false` → all resources in org (public and private)
- `org` empty + `excludePublic: false` → all authorized resources across all orgs

## Benefits

- Library card counts now accurately reflect the total number of resources in the organization
- Org tab shows all resources the organization owns, regardless of public/private visibility
- All tab shows resources from every organization the user has access to
- No surprising empty states when all org resources happen to be public

## Impact

Affects the web console Library experience for all users. The fix is in the React SDK layer (`@stigmer/react`), so both the OSS web console and any downstream consumers of these hooks benefit automatically. No API or backend changes needed.

## Related Work

- `2026-03-20-105950-use-agent-list-and-resource-list-hooks.md` — initial implementation of list hooks
- `2026-03-20-115317-individual-resource-count-hooks.md` — count hooks implementation
- `2026-03-20-120708-scope-toggle-component.md` — Org/All scope toggle

---

**Status**: ✅ Production Ready
