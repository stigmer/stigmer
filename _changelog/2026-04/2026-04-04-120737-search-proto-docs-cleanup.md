# Search Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Cleaned up proto documentation for the Search service (`apis/ai/stigmer/search/v1/`) to align with the document writer conventions. Added `@internal` markers to separate SDK-facing descriptions from internal architecture details, removed decorative dividers, replaced internal jargon with plain language, and created a `docs/overview.md` for the SDK reference page.

## Problem Statement

The Search service protos had thorough comments but violated the document writer conventions in several ways that would degrade auto-generated SDK documentation quality.

### Pain Points

- Zero `@internal` markers — internal architecture details (CQRS, FGA authorization, bounded contexts, Searchable interface) were in SDK-facing position
- Decorative divider blocks (`// ====...`) cluttering the proto files
- Internal terminology ("display projection", "QueryController", "Searchable interface") leaking into SDK-facing descriptions
- Internal field path references (`From metadata.name`, `From status.audit.created_at`) visible to SDK users
- Missing `docs/overview.md` for the SDK reference page overview section

## Solution

Applied the same documentation standards used across all other API resources (agent, skill, mcp_server, etc.) to the search protos:

1. Added `@internal` markers throughout both proto files to cleanly separate SDK-facing text from internal implementation details
2. Removed all three decorative divider blocks from `io.proto`
3. Rewrote the `SearchService` comment to lead with SDK-facing description and move CQRS/FGA/bounded-context rationale behind `@internal`
4. Rewrote the `search` RPC comment to keep the behavior table and pagination guidance SDK-facing, moving authorization handler details behind `@internal`
5. Replaced internal jargon: "display projection" to "summary", "QueryController" to "get method for that resource kind"
6. Moved implementation details behind `@internal` for `SearchResult` fields (metadata source paths, Searchable interface mapping)
7. Created `apis/ai/stigmer/search/docs/overview.md` with a concise service description and representative JSON examples

## Implementation Details

### Files Changed

- `apis/ai/stigmer/search/v1/query.proto` — Service and RPC comment cleanup with `@internal` separation
- `apis/ai/stigmer/search/v1/io.proto` — Message and field comment cleanup across `SearchRequest`, `SearchResponse`, and `SearchResult`
- `apis/ai/stigmer/search/docs/overview.md` (new) — SDK reference page overview

### Key Patterns Applied

Every comment now follows the `@internal` structure from the document writer conventions:

```
// SDK-facing first sentence.
//
// Additional SDK-facing context.
//
// @internal
// Implementation details, authorization notes, etc.
```

## Benefits

- SDK-generated documentation will show clean, user-facing descriptions without internal architecture details
- Consistent with the documentation patterns already applied across all other API resources
- Internal developers still have full architecture context preserved behind `@internal` markers

## Impact

- **SDK users**: Will see cleaner, more useful documentation when search SDK docs are generated
- **Internal developers**: No information lost — all architecture details preserved behind `@internal`
- **Consistency**: Search protos now follow the same conventions as agent, skill, mcp_server, and all other resources

## Related Work

- Follows the same pattern applied in previous sessions for all other API resources (agent, agentexecution, session, skill, mcpserver, environment, agentinstance, executioncontext, iam, commons, workflow, platform, tenancy)
- Pipeline gap remains: `sdk_docs.go` still skips search, and `SearchResult` is not extracted as a standalone type in `search.json` — these are deferred follow-up items

---

**Status**: ✅ Production Ready
