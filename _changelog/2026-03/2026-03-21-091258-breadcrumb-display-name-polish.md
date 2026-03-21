# Breadcrumb Display Name via onResourceLoad Callback

**Date**: March 21, 2026

## Summary

Added `onResourceLoad` callback prop to SDK detail view components and wired it to a Console-level breadcrumb context so Library breadcrumbs show the resource display name (e.g., "PR Review Agent") instead of the raw URL slug ("pr-review-agent"). This completes T01.12 — the final task of the Resource Detail Views sub-project.

## Problem Statement

When navigating to a resource detail page like `/library/agents/pr-review-agent`, the breadcrumb rendered:

```
Library / Agents / pr-review-agent
```

The slug is functional but not the actual display name. The resource name is only available after the SDK detail view component fetches the data — but the breadcrumb lives in the layout, two levels above the detail page. Getting the name to the breadcrumb without duplicating API calls required a coordination mechanism.

### Pain Points

- Raw slugs in breadcrumbs look unpolished compared to display names
- The data lives inside SDK components that fetch internally — no obvious way to surface it to the layout
- Calling the same data hook at both the page level and inside the component would make two separate gRPC requests (hooks use `useState`/`useEffect`, not a shared cache)

## Solution

Two-layer approach that respects the SDK/Console boundary:

1. **SDK layer**: Added a single optional `onResourceLoad` callback prop to `AgentDetailView`, `SkillDetailView`, and `McpServerDetailView`. Fires when the resource data resolves, providing `{ name: string }`. Uses a stable ref pattern internally to avoid re-renders from unstable inline callbacks.

2. **Console layer**: Created `LibraryBreadcrumbContext` — a React context in the library layout that detail pages write to and the breadcrumb reads from. Pure Console concern with no SDK involvement.

## Implementation Details

### SDK Changes (3 files modified)

Each detail view component gained one new optional prop:

```typescript
readonly onResourceLoad?: (meta: { name: string }) => void;
```

The implementation uses a ref pattern to decouple the callback identity from the effect dependency:

```typescript
const onResourceLoadRef = useRef(onResourceLoad);
onResourceLoadRef.current = onResourceLoad;

useEffect(() => {
  if (resource?.metadata?.name) {
    onResourceLoadRef.current?.({ name: resource.metadata.name });
  }
}, [resource]);
```

### Console Changes (1 new file, 4 files modified)

- `LibraryBreadcrumbContext.tsx` — Context provider with `label`/`setLabel` state, plus two consumer hooks: `useBreadcrumbLabel()` for the breadcrumb to read, `useBreadcrumbOverride()` for detail pages to write.
- `layout.tsx` — Wrapped children in `LibraryBreadcrumbProvider`.
- `LibraryBreadcrumb.tsx` — Reads override label from context; applies it to the last segment only when that segment is a slug (not a known category like "Agents").
- Three detail pages — Each wires `onResourceLoad={({ name }) => setLabel(name)}` with cleanup on unmount.

### UX Behavior

- **Initial render**: Breadcrumb shows slug (same as before — no regression)
- **After data loads**: Breadcrumb transitions to display name
- **Navigation away**: Cleanup effect resets label; next page shows slug until its data loads
- **Not-found / error**: `onResourceLoad` never fires; breadcrumb stays on slug

## Benefits

- **Zero duplicate API calls** — the callback reuses data the component already fetched
- **Platform builder utility** — `onResourceLoad` is useful beyond breadcrumbs: document titles, analytics, conditional rendering based on loaded resource identity
- **Minimal SDK surface addition** — one optional prop per component, no new exports, no barrel file changes
- **Progressive enhancement** — breadcrumb is always functional; display name is polish on top

## Impact

- **SDK**: `AgentDetailViewProps`, `SkillDetailViewProps`, `McpServerDetailViewProps` each gain one optional prop — non-breaking, backward compatible
- **Console**: Library breadcrumbs now show proper display names on all three resource detail pages
- **Files**: 9 files changed (3 SDK, 1 new Console, 5 modified Console), 168 insertions, 8 deletions

## Related Work

- Completes T01.12 of sub-project `20260320.03.sp.resource-detail-views`
- Finalizes Phase 4 (Exports + Polish) of the Resource Detail Views sub-project
- Parent project: `20260320.01.library-and-artifacts-flow` — all 5 phases now complete

---

**Status**: ✅ Production Ready
