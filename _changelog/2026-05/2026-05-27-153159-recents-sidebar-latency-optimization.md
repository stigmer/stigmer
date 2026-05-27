# Recents Sidebar Latency Optimization

**Date**: May 27, 2026

## Summary

Addressed multiple compounding latency sources in the sidebar "Recents" section, which makes two parallel gRPC calls (sessions + workflow executions) through a two-phase authorization + data-fetch pipeline. The changes span proto definitions, MongoDB indexing, server-side pagination, FGA result caching, and a new unified RPC with an org-scoped fast path.

## Problem Statement

The sidebar recents list exhibited noticeable latency on every page navigation. Each load triggered two gRPC calls, each going through OpenFGA `listObjects` (O(n) reverse-index traversal) followed by MongoDB queries with no compound indexes and, in the workflow execution case, loading all authorized documents into memory.

### Pain Points

- OpenFGA `listObjects` is the dominant bottleneck (500ms-2s+), called twice per sidebar load
- No MongoDB compound indexes for the `metadata.id IN (...)` + sort pattern
- `WorkflowExecutionListHandler` loaded ALL authorized executions into memory with no pagination
- `SessionRepo.findByIds` ran a redundant `count()` query even for first-page requests
- No caching of FGA authorization results despite infrequent IAM policy changes
- Frontend triggered redundant staggered refetches (8s/18s) that each re-ran the full pipeline

## Solution

Three-phase approach: database-level quick wins, authorization caching, and architectural improvements.

## Implementation Details

### Phase 1: Database and Query Optimizations (stigmer-cloud)

**MongoDB indexes** (`U20260527_RecentsListIndexes`): Added 4 compound indexes across `session` and `workflow_execution` collections -- `{metadata.id, createdAt}` for FGA-filtered queries and `{metadata.org, createdAt}` for the org fast path.

**WorkflowExecution pagination**: Added `findByIds(ids, Pageable)` and `findByIdsFirstPage(ids, Pageable)` to `WorkflowExecutionRepo`. Rewrote `WorkflowExecutionListHandler.LoadFromRepo` to use server-side pagination for default sort, falling back to in-memory only for advanced filter/sort criteria.

**Count-free first page**: Added `findByIdsFirstPage` to both `SessionRepo` and `WorkflowExecutionRepo`. Updated both list handlers to skip the `count()` query when serving page 0 (the sidebar's case).

### Phase 2: FGA Authorization Caching (stigmer-cloud)

**`AuthorizedResourceIdsCache`**: Redis-backed 30-second TTL cache for `listAuthorizedResourceIds` results, keyed by `{principalKind:principalId:resourceKind:relation}`. Integrated into `IamPolicyGrpcRepoImpl` with cache invalidation on all write paths (`createPolicy`, `bootstrapPolicy`, `deletePolicy`, `cleanupResourcePolicies`, `revokeOrgAccess`).

### Phase 3: Unified RPC with Org Fast Path (stigmer + stigmer-cloud)

**New `activity/v1` proto**: `ActivityQueryController.listRecentActivity` RPC that returns a merged, time-sorted list of sessions and workflow executions in a single call.

**`ListRecentActivityHandler`**: Queries FGA for both resource kinds in one handler call, loads lightweight projections (not full documents) from both MongoDB collections, and merges server-side.

**Org fast path**: When the request includes an `org` slug, checks FGA `is_member` (single tuple lookup, ~5ms) and bypasses the expensive `listObjects` entirely, querying MongoDB directly with `metadata.org = org`.

## Benefits

- First-page sidebar loads skip the count query (1 fewer MongoDB round-trip per call)
- FGA cache eliminates 500ms-2s+ latency on repeat loads within 30 seconds
- Compound indexes eliminate in-memory sorts in MongoDB
- Workflow execution list no longer loads all documents into memory
- Unified RPC reduces 2 gRPC round-trips to 1
- Org fast path reduces O(n) FGA scan to O(1) membership check for org members

## Impact

- **Direct users**: Faster sidebar load on every navigation
- **Platform builders**: `useRecentActivity` hook consumers get the same improvement when the backend is wired
- **Backend**: Reduced MongoDB and OpenFGA load under repeated sidebar queries

## Related Work

- Frontend `useRecentActivity` hook migration to the unified RPC is a follow-up (requires wiring the generated TS client)
- Go (OSS) implementation of `ActivityQueryController` is a follow-up

---

**Status**: Production Ready (backend changes); follow-up needed for frontend migration and Go implementation
**Timeline**: ~2 hours
