# Fix Web Build: Remove Deleted Subcategory Field from React SDK

**Date**: April 10, 2026

## Summary

The web app pipeline build was failing because the React SDK's `McpServerDetailView` component still referenced the `subcategory` field on `McpServerSource`, which was removed from the proto schema in commit `9b0c32c5`. Removing the stale UI block restores a clean `next build`.

## Problem Statement

After the quality grading proto refactor replaced the PT-Edge quality index with GitHub-based grading, the `subcategory` field was removed from `McpServerSource`. The codegen and SDK TypeScript types were regenerated, but the React component that rendered the subcategory was not updated.

### Pain Points

- CI pipeline for `stigmer-web` failing on every push since the proto change
- `next build` exits with code 1 due to a TypeScript error: accessing a property that no longer exists on the type
- The error surfaces deep in the build output, requiring log inspection to trace back to a removed proto field

## Solution

Removed the subcategory display block (Category row) from `McpServerDetailView`'s `SourceSection` component, aligning the UI with the updated proto schema.

## Implementation Details

- **File**: `sdk/react/src/mcp-server/McpServerDetailView.tsx`
- Deleted the conditional `{source.subcategory && (...)}` JSX block that rendered a "Category" label and the subcategory value
- No replacement UI needed — the subcategory was a low-value field from the old quality index that is no longer sourced

## Benefits

- Restores green CI for the web app build pipeline
- Keeps the React SDK in sync with the proto schema after the quality grading refactor

## Impact

- **Web app**: build is unblocked
- **MCP server detail view**: the "Category" row (e.g. "dotnet-mcp-servers") no longer appears; this was display-only metadata from the deprecated PT-Edge index

## Related Work

- `2026-04-10-134406-replace-pt-edge-with-github-based-quality-grading.md` — the proto refactor that triggered this issue
- `2026-04-10-114443-add-source-provenance-to-mcp-server-detail-view.md` — recent source section UI work

---

**Status**: ✅ Production Ready
