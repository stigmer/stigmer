# Cross-Org Public Library Scope Filtering

**Date**: April 5, 2026

## Summary

Introduced a `cross_org_public` field to the Search API and implemented compound filtering logic across both the Go (OSS/SQLite) and Java (Cloud/MongoDB) backends, all SDK codegen targets, and React hooks. When users select "All" in library views, they now see their organization's resources (public and private) plus public resources from other organizations — instead of every resource they have FGA authorization to view across all organizations.

## Problem Statement

The library "All" scope was displaying every resource the user has access to, including private resources from other organizations that the user had been explicitly granted access to via FGA. This violated organization boundary expectations — a user granted viewer access to a private resource in another org should not see that resource when casually browsing "All" in their own org's library.

### Pain Points

- "All" was indistinguishable from a global FGA dump — no org boundary enforcement
- Private cross-org grants leaked into the general library listing, surprising users
- No proto-level mechanism existed to express "my org + public from others" in a single request
- The only workaround was client-side merging of two separate API calls (fragile, pagination-breaking)

## Solution

Added a single boolean field `cross_org_public` to `SearchRequest` that, when combined with an `org` filter, instructs the backend to return a compound result set: all resources from the specified org (any visibility) OR public resources from any other org. This keeps the query atomic, preserves server-side pagination, and avoids client-side merging.

## Implementation Details

### Proto Layer
- Added `bool cross_org_public = 6` to `SearchRequest` in `apis/ai/stigmer/search/v1/io.proto`
- Field is only meaningful when `org` is non-empty; defaults to `false` (backward-compatible)

### Go Backend (OSS — SQLite FTS5)
- Extended `SearchCriteria` value object with `crossOrgPublic` field, constructor parameter, and accessor
- Replaced separate `buildOrgFilter` and `buildVisibilityFilter` methods with a unified `buildScopeFilter` in `SQLiteSearchQueryStore`
- When `crossOrgPublic` is true: `AND (org = ? OR visibility = 'visibility_public')`
- Updated all 18 test cases in `search_criteria_test.go` to pass the new parameter

### Java Backend (Cloud — MongoDB)
- Extended `SearchCriteria` record with `crossOrgPublic` field and `of()` factory method
- Modified `MongoSearchQueryStore.buildQuery()` to use `orOperator` when `crossOrgPublic` is true:
  ```java
  new Criteria().orOperator(
      Criteria.where("metadata.org").is(orgFilter),
      Criteria.where("metadata.visibility").is("visibility_public")
  )
  ```

### SDK Codegen (All Targets)
- TypeScript: Added `crossOrgPublic` to `ListParams` interface and search request construction
- Go: Added `CrossOrgPublic` to `ListParams` struct and search request construction
- Python: Added `cross_org_public` to `ListParams` dataclass
- Java: Added `crossOrgPublic` to `ListParams` builder pattern
- Rebuilt `tools/generator` binary and regenerated all SDK client files

### React SDK Hooks
- `useResourceList`: Always passes `org` (active org); sets `crossOrgPublic: scope === "all"`
- `useResourceSearch`: Same pattern for picker/type-ahead search
- Updated JSDoc for `ResourceListScope` to reflect new semantics

## Benefits

- Organization boundaries are respected in library views — private cross-org grants stay invisible in "All"
- Single atomic API call replaces what would otherwise require client-side merging of two requests
- Server-side pagination works correctly with compound filtering
- Backward-compatible: existing clients that don't set `cross_org_public` see no behavior change
- All four SDK languages (TypeScript, Go, Python, Java) expose the field consistently

## Impact

- **End users**: "All" library view now shows a sensible, boundary-respecting resource set
- **Platform builders**: `ListParams.crossOrgPublic` is available in all SDKs for custom library UIs
- **Backend**: Both OSS and Cloud search paths handle the compound query efficiently via database-level filtering

## Related Work

- IAM Role & Permission Separation (Sessions 1–7) — the authorization model that makes org-scoped visibility meaningful
- SDK Codegen Pipeline — the `tools/codegen/generator` templates that propagate proto fields to all language SDKs

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
