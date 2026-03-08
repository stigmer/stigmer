# Fix Search Index Architecture: Extend to All Searchable Resource Types

**Date**: March 8, 2026

## Summary

The search index rebuild (`RebuildIndex`) silently aborted when encountering an unhandled resource kind, causing `stigmer list` commands to return empty results after server restart. This change eliminates the brittle `createEmptyProtoForKind` switch statement, extends search indexing to all 13 searchable resource types, and makes the rebuild process resilient to per-kind failures.

## Problem Statement

After running `stigmer server start` followed by `stigmer apply`, the `stigmer list skills` command returned zero results despite skills existing in the database. The root cause was a cascading failure in the search index rebuild pipeline.

### Pain Points

- `RebuildIndex` used a centralized `createEmptyProtoForKind` switch statement that had to be manually kept in sync with new resource types — a parallel mapping that silently drifted.
- When the `organization` kind was added as searchable (via proto options) but missed from the switch, `RebuildIndex` returned an error and aborted entirely, preventing *all* subsequent kinds (skill, agent, mcp_server, workflow) from being indexed.
- Only 5 of 13 searchable resource kinds had `SearchableExtractor` implementations, so even with a fix to the switch, the majority of resource types would remain un-indexed.
- Domain controller pipelines for 8 resource types (project, session, agent_instance, environment, agent_execution, workflow_instance, workflow_execution, execution_context) lacked `IndexSearchStep` / `DeleteSearchIndexStep` wiring, meaning CRUD operations on these resources never updated the search index.

## Solution

A six-phase architectural improvement that eliminates the centralized switch, distributes proto instantiation to each extractor, adds missing extractors, and wires search index maintenance into all CRUD pipelines.

## Implementation Details

### Phase 1 — Eliminate `createEmptyProtoForKind`

Extended the `SearchableExtractor` interface with a `NewEmptyProto() proto.Message` method so each extractor owns its proto instantiation. Updated all 5 existing extractors (agent, skill, mcp_server, workflow, organization) to implement the new method. Removed the `createEmptyProtoForKind` function and its unused proto imports from `sqlite_search_query_store.go`.

### Phase 2 — Resilient `RebuildIndex`

Changed `RebuildIndex` to collect per-kind errors and continue processing remaining kinds instead of aborting entirely. Errors are logged with `zap.Warn` and a summary is returned at the end, ensuring that a failure in one kind (e.g., a corrupt record) doesn't take down the entire index.

### Phase 3 — User-Facing Extractors

Added `SearchableExtractor` implementations for 4 user-facing resource types:

| Kind | Summary Field | Proto |
|------|--------------|-------|
| `project` | `spec.description` | `projectv1.Project` |
| `session` | `spec.subject` | `sessionv1.Session` |
| `agent_instance` | `spec.description` | `agentinstancev1.AgentInstance` |
| `environment` | `spec.description` | `environmentv1.Environment` |

### Phase 4 — Operational Extractors

Added `SearchableExtractor` implementations for 4 operational resource types:

| Kind | Summary Field | Proto |
|------|--------------|-------|
| `agent_execution` | `metadata.name` | `agentexecutionv1.AgentExecution` |
| `workflow_instance` | `spec.description` | `workflowinstancev1.WorkflowInstance` |
| `workflow_execution` | (empty) | `workflowexecutionv1.WorkflowExecution` |
| `execution_context` | (empty) | `executioncontextv1.ExecutionContext` |

### Phase 5 — Registry Validation

Updated `ValidateExpectedKinds` in `SearchableResourceRegistry` to include all 13 searchable kinds, ensuring the startup-time validation catches any missing extractors in the future.

### Phase 6 — Pipeline Wiring

Wired `IndexSearchStep` into create/update pipelines and `DeleteSearchIndexStep` into delete pipelines for all 8 newly indexed resource types across their respective domain controllers.

## Benefits

- **Correctness**: `stigmer list` commands now return all resources of every searchable kind after server restart.
- **Resilience**: A bad record in one resource kind no longer prevents indexing of all other kinds.
- **Maintainability**: Adding a new searchable kind requires only implementing one `SearchableExtractor` — no central switch to update.
- **Completeness**: All 13 proto-declared searchable kinds are now indexed and maintained through CRUD operations.
- **Safety net**: `ValidateExpectedKinds` at startup catches missing extractors before they can cause silent data loss.

## Impact

- **All `stigmer list` and `stigmer search` commands** are now backed by a complete, self-healing search index.
- **Server restart** no longer causes list commands to silently return empty results.
- **Future resource types** only need to implement the `SearchableExtractor` interface and register via `init()` — no other files need modification.
- **Files changed**: 41 files (8 new extractor files, 5 modified extractors, 1 interface change, 1 store rewrite, 2 test updates, 24 domain controller pipeline updates).

## Related Work

- Seedpack bootstrap flow relies on the search index being correct after `RebuildIndex` — this fix ensures seedpack resources are discoverable.
- Organization tenancy migration (2026-03-03) introduced the `organization` kind that triggered the original failure.

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (investigation, architecture, implementation, testing)
