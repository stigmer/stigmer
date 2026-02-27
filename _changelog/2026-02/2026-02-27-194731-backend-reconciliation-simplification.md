# Backend Reconciliation Simplification

**Date**: February 27, 2026

## Summary

Replaced the entire 10,000 LOC reconciliation engine — originally designed for server-side resource lifecycle management with embedded objects, dependency graphs, and topological sorting — with a ~300 LOC reference-based reconciliation that performs set-difference on `ApiResourceReference` membership lists and orphan pruning. This is Phase 2 of the Project API redesign from embedded resources to a declarative reference-based model.

## Problem Statement

Phase 1 changed `ProjectSpec` from embedding full resource objects (`agents`, `workflows`, `mcp_servers`, `skills`) to a flat list of `repeated ApiResourceReference members`. The entire reconciliation package was built around the old embedded model:

### Pain Points

- **Obsolete machinery**: 11 production files (~5,000 LOC) implementing dependency graph construction, topological sort, spec-level deep diffing, and create/update/delete execution ordering — none of which applies when resources are lightweight references
- **Compilation failures**: The proto-generated Go stubs no longer contained `ResourceChangeRecord` (removed in Phase 1), causing the old reconciliation code to fail to compile
- **Conceptual mismatch**: The old model assumed the server creates/updates resources from embedded specs. In the new model, the CLI applies resources individually; the server only tracks membership and prunes orphans
- **Test complexity**: 11 test files (~5,000 LOC) testing obsolete behavior with elaborate mocks for dependency graphs, topological ordering, and full resource diffs

## Solution

Complete rewrite of the reconciliation layer to match the new reference-based model:

1. **Set-difference reconciliation**: Compare previous and current `[]*ApiResourceReference` lists. Members in current but not previous = added. Members in previous but not current = orphans.
2. **ResourceDeleter interface**: Single-method `Delete(ctx, kind, resourceID)` replaces the full `ResourceController` with Create/Update/Delete/prepare methods.
3. **Reference resolution**: For orphan deletion, resolve `kind + slug` to `resourceID` via `store.FindByField`, then delete through the appropriate downstream client.
4. **Graceful failure**: Continue deleting remaining orphans if one fails. Accumulate errors in the result.

## Implementation Details

### Deleted (11 + 11 + 1 = 23 files, ~10,000 LOC)

All from `backend/services/stigmer-server/pkg/domain/project/reconcile/`:

| File | Purpose (now obsolete) |
|------|----------------------|
| `desired_state.go` | Parsed full resources from project spec into typed maps |
| `actual_state.go` | Fetched full resources from DB via ownership annotations |
| `diff.go` | Spec-level comparison producing create/update/delete lists |
| `dependency_graph.go` | Directed acyclic graph for resource dependencies |
| `dependency_discoverer.go` | Proto reflection to discover inter-resource references |
| `graph_builder.go` | Constructed dependency graph from desired + actual state |
| `execution_order.go` | Topological sort for dependency-aware execution |
| `resource_change.go` | Full resource change objects with before/after snapshots |
| `reconciliation_plan.go` | Container for ordered list of changes |
| `change_type.go` | Create/Update/Delete enum |
| `resource_key.go` | Composite key type for resource identity |

Each production file had a corresponding `_test.go` file. The `README.md` documenting the old architecture was also removed.

### Rewritten (4 core files, ~300 LOC)

- **`reconciliation_service.go`**: Interface simplified to `Reconcile(ctx, previousMembers, currentMembers, options)` — pure set math, no project object needed
- **`reconciliation_result.go`**: Uses `*ApiResourceReference` for `added`/`removed` fields. Includes `ToProtoSummary()` mapping (`added -> created`, `removed -> deleted`, `updated` empty) and a `ResultBuilder` for incremental construction
- **`execution_engine.go`**: Stripped to `ResourceDeleter` interface + `ResourceDeleterAdapter` that routes delete calls to the appropriate downstream client
- **`service.go`**: Set-difference orchestration with `buildReferenceSet` for O(1) membership checks, orphan deletion with continue-on-failure, and reference resolution via `store.FindByField`

### Updated (3 files)

- **`apply.go`**: Captures previous members from `ExistingResourceKey` in the pipeline context before Create/Update overwrites the project, then passes both lists to `Reconcile()`
- **`project_controller.go`**: Updated package docs and constructor for reference-based model, added `SetReconciliationService` for late binding
- **`server.go`**: Swapped `NewResourceControllerAdapter` + `NewExecutionEngine` for `NewResourceDeleterAdapter`

### Tests rewritten (10 files)

- 3 reconciliation test files with 20+ tests covering set-difference, dry-run, orphan deletion, partial failure, stub mode, reference resolution
- 7 controller test files updated to use `Members` instead of `Agents`/`Workflows`/`McpServers`/`Skills`/`Runtime`

## Benefits

- **97% LOC reduction**: ~10,000 LOC deleted, ~300 LOC written — reconciliation package is now trivially understandable
- **Conceptual clarity**: The server's responsibility is precisely defined — compare membership lists, optionally delete orphans. No more pretending the server manages resource lifecycle.
- **Faster tests**: Tests no longer need elaborate dependency graph mocks. Simple reference lists and a mock deleter suffice.
- **Correct architecture**: Resources are applied individually by the CLI. The server is an observer of membership changes, not an orchestrator of resource creation.

## Impact

- **Backend reconciliation**: Fully rewritten — all 21 test targets pass
- **Server wiring**: Updated to use new types — server builds and starts correctly
- **Controller tests**: All 7 test files updated — no references to removed proto fields
- **No proto changes**: Phase 1 already handled all proto changes; this phase only touches Go code
- **No CLI changes**: CLI changes are deferred to Phase 3

## Related Work

- Phase 1: Proto API redesign (`c2e69995`) — removed embedded resource fields, added `members`
- Phase 3 (upcoming): CLI declarative track — directory scanning + individual resource apply
- Phase 4 (upcoming): Adapt SDK track — update `executeProjectApply` for new model

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
