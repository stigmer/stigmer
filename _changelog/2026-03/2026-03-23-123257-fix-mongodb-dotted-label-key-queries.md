# Fix MongoDB Dotted Label Key Queries

**Date**: March 23, 2026

## Summary

Fixed a bug in `EnvironmentRepo` and `AgentInstanceRepo` where MongoDB queries for resources with dotted label keys (e.g., `stigmer.ai/personal`) returned zero results. The broken dot-escaping approach was replaced with MongoDB's `$getField` operator, unblocking the personal environment lookup and the GitHub OAuth connection flow.

## Problem Statement

The "Checking GitHub connection..." UI was stuck indefinitely after a successful GitHub OAuth callback. Backend logs showed the environment list handler finding authorized environments via FGA but then loading zero results from MongoDB.

### Pain Points

- The `findByIdsAndOrgAndLabels` query used `label.getKey().replace(".", "\\.")` to "escape" dots in label keys, but MongoDB does **not** support `\.` as an escape sequence in field paths.
- The generated field path `metadata.labels.stigmer\.ai/personal` was interpreted as nested path traversal (`stigmer\` → `ai/personal`), which doesn't match the actual BSON structure where `stigmer.ai/personal` is a single literal key.
- The personal environment (labeled `stigmer.ai/personal: "true"`) could never be found by the list query, causing the frontend's `usePersonalEnvironment` hook to always return `null`.

## Solution

Replaced the Spring Data `Criteria`-based label filtering with raw MongoDB `Document` queries using the `$getField` operator (available since MongoDB 5.0). This operator retrieves field values by their literal key name without interpreting dots as path separators.

## Implementation Details

Both `EnvironmentRepo.java` and `AgentInstanceRepo.java` were updated identically:

- Switched from `Criteria.where().and()` chain to raw `Document`-based filter construction for the entire query.
- Label filters now use `$expr` with `$getField` to match label values by literal key:
  ```json
  {"$expr": {"$eq": [{"$getField": {"field": "stigmer.ai/personal", "input": "$metadata.labels"}}, "true"]}}
  ```
- Multiple label filters are combined with `$and`.
- Uses `BasicQuery` instead of `Query.query(criteria)` for count and find operations.

### Files Changed

| File | Change |
|------|--------|
| `EnvironmentRepo.java` | Replace dot-escaping with `$getField` in `findByIdsAndOrgAndLabels` |
| `AgentInstanceRepo.java` | Same fix applied to the identical method |

## Benefits

- Personal environments with dotted label keys (`stigmer.ai/personal`) are now correctly returned by MongoDB queries.
- The GitHub OAuth connection flow completes end-to-end: callback → personal environment creation → environment list → token reconciliation.
- Any future label keys containing dots or dollar signs will work correctly.

## Impact

- **Users**: The "Checking GitHub connection..." spinner resolves instead of hanging indefinitely.
- **Platform**: All label-filtered list queries across environments and agent instances now handle arbitrary key names.

## Related Work

- [fix-github-oauth-rpc-routing-cloud](2026-03-23-105724-fix-github-oauth-rpc-routing-cloud.md) — fixed the initial routing mismatch for GitHub OAuth RPCs
- [add-missing-rpc-authorization-config](2026-03-23-115613-add-missing-rpc-authorization-config.md) — added authorization config to the environment create RPC

---

**Status**: ✅ Production Ready
