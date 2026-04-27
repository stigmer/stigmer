# Shared useFetch Hook: Eliminate Skeleton Flash Across All Data Hooks

**Date**: April 27, 2026

## Summary

Created a shared `useFetch` internal hook with stale-while-revalidate semantics and migrated all 30 data hooks in `@stigmer/react` to use it. This eliminates the skeleton flash that occurred on every background refetch across the entire platform, and brings the desktop session list to visual parity with the web version (tooltips, two-line clamping, styled scrollbar).

## Problem Statement

Every data hook in `@stigmer/react` followed an identical copy-pasted pattern with a critical flaw: `setIsLoading(true)` fired on every `refetch()` call, causing skeleton/spinner UI to flash even when valid cached data was already visible. The session list sidebar was the most visible case — it auto-refetched 2-3 times in the first 20 seconds of viewing a session for async subject generation, producing jarring flickers.

### Pain Points

- Session list in both web and desktop sidebars flickered to skeleton placeholders on every timed refetch
- All 30 data hooks (runners, agents, environments, API keys, etc.) had the same bug
- ~900 lines of identical boilerplate duplicated across the codebase
- Desktop session list lacked hover tooltips, two-line text clamping, and styled scrollbar that the web version had
- Inconsistent error types across hooks (`string | null` vs `Error | null`)

## Solution

Introduced a single `useFetch<T>` internal hook that encapsulates the fetch-with-refetch pattern with stale-while-revalidate semantics, then mechanically migrated all 30 domain hooks to use it.

## Implementation Details

**New file: `sdk/react/src/internal/useFetch.ts`**

The hook distinguishes between initial load (`isLoading`) and background refresh (`isRefetching`). During a refetch, stale data remains visible — no skeleton flash. When `fetchFn` is `null`, the hook is idle (handles the common "skip when param is null" pattern). Error normalization via `toError` is handled internally.

**30 hooks migrated** across session, agent, runner, environment, MCP server, skill, IAM, invitation, platform client, OAuth, organization, usage, and search domains. Each migration:
- Replaced `useState`/`useEffect`/`fetchKey`/`cancelled` boilerplate with a single `useFetch()` call
- Added `isRefetching: boolean` to the return type (additive, non-breaking)
- Normalized error type to `Error | null` (breaking for 5 hooks that previously used `string | null`)

**Desktop sidebar parity:**
- Added `Tooltip`/`TooltipTrigger`/`TooltipContent` wrapping each session item (uses existing `@base-ui/react` dependency)
- Changed `truncate` (single-line ellipsis) to `line-clamp-2` (two-line clamping)
- Replaced bare `overflow-y-auto` with styled `ScrollArea` component

## Benefits

- Zero skeleton flash on background refetches across the entire platform
- ~700 fewer lines of code (30 hooks deduplicated)
- Consistent `Error | null` error type across all data hooks
- Desktop session list matches web's polish (tooltips, text wrapping, scrollbar)
- Single place to evolve fetching behavior (retry, caching, etc.) in the future

## Impact

- **SDK consumers**: All `@stigmer/react` data hooks gain `isRefetching` field; 5 hooks change `error` from `string | null` to `Error | null`
- **Web console**: Session list no longer flickers; error rendering updated to use `error.message`
- **Desktop app**: Session list gains tooltips, two-line titles, and styled scrollbar
- **All pages using data hooks**: Settings, Library, Runners — all benefit from no-flicker refetches

## Related Work

- Follows the `useDefaultAgent` visibility-aware refetch pattern introduced in the previous session
- Desktop sidebar changes complement the desktop shell/library parity work from 2026-04-26

---

**Status**: ✅ Production Ready
