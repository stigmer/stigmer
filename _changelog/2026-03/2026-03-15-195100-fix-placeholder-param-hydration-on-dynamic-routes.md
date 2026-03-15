# Fix __placeholder__ Param Leaking Into API Calls on Dynamic Route Pages

**Date**: March 15, 2026

## Summary

Fixed a bug where all four dynamic route detail pages (agents, sessions, skills, MCP servers) made API calls with `__placeholder__` as the resource ID instead of the real ID from the URL. This was the second half of the dynamic route navigation issue — the SPA handler fix made pages load, but they loaded with the wrong route parameter.

## Problem Statement

After the `resolveDynamicRoute` SPA handler fix, navigating to dynamic route pages (e.g., `/agents/abc123`) no longer failed silently. However, the pages now showed a "Not found" error: `Agent not found: __placeholder__`. The API call was made with the literal string `__placeholder__` instead of the real resource ID.

### Pain Points

- Every dynamic route detail page showed "Not found" errors on full page load (refresh, direct URL access)
- The error message exposed an internal implementation detail (`__placeholder__`) to end users
- All four resource types were affected: agents, sessions, skills, MCP servers

## Solution

The root cause is a hydration timing issue with Next.js static export (`output: "export"`). During build, `generateStaticParams` returns `[{ id: "__placeholder__" }]`, and Next.js bakes this value into the pre-rendered HTML. When the Go SPA handler serves `agents/__placeholder__.html` for a request to `/agents/abc123`, `useParams()` returns `"__placeholder__"` during hydration because the HTML was rendered with that param value. Since `"__placeholder__"` is truthy, the query hooks (`enabled: !!id`) fire immediately with the invalid ID.

Created a `useDynamicRouteId` hook that detects the `__placeholder__` sentinel and extracts the real ID from `window.location.pathname` after hydration. Returns `""` while resolving, which integrates with the existing `enabled: !!id` guards to prevent premature API calls. For client-side navigation (Link clicks), `useParams()` returns the correct value immediately, so the hook passes it through with no delay.

## Implementation Details

### New Hook: `useDynamicRouteId`

- Location: `src/hooks/useDynamicRouteId.ts`
- Initializes `useState` with `""` when `useParams()` returns `__placeholder__`, avoiding hydration mismatch (matches SSR output)
- Uses `useEffect` to extract real ID from `window.location.pathname` after hydration
- Syncs with `useParams()` when router updates provide the correct value (e.g., client-side navigation)
- For non-placeholder values, passes through immediately with no overhead

### Updated Detail Pages

All four detail pages replaced `useParams()` with `useDynamicRouteId()`:

- `AgentDetailPage.tsx` — removed `useParams` import, added `useDynamicRouteId`
- `SkillDetailPage.tsx` — same pattern
- `SessionDetailPage.tsx` — same pattern
- `McpServerDetailPage.tsx` — same pattern

## Benefits

- Dynamic route detail pages work correctly on both client-side navigation and full page load
- No API calls with invalid `__placeholder__` ID
- Zero-overhead path for client-side navigation (most common case)
- Centralized fix — any future dynamic route page only needs `useDynamicRouteId()` instead of `useParams()`

## Impact

- **End users**: Detail pages load correctly regardless of how the user arrives (link click, refresh, direct URL, bookmark)
- **Developers**: Single hook replaces the `useParams()` + placeholder guard pattern across all dynamic routes

## Related Work

- Completes the fix started in `dynamic-route-fix-and-embeddable-components` (2026-03-15) — that fix addressed file serving, this fix addresses param resolution
- Depends on the `resolveDynamicRoute` SPA handler from `handler.go`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
