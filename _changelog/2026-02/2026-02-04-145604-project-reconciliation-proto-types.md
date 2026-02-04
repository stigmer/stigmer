# Project Reconciliation Proto Types - T05.0

**Date**: February 4, 2026

## Summary

Implemented T05.0 from Phase 5 - Added ReconciliationSummary proto type to the Project API to enable the Apply response to report what changes were made during reconciliation (created/updated/deleted resources). This establishes the proto foundation for Project Track reconciliation in the Stigmer platform, following a key architectural decision: the dependency graph is derived by the backend via reflection, not passed from the CLI.

## Problem Statement

Phase 5 of the Stigmer CLI Unified Architecture requires implementing the Project Track reconciliation engine. The reconciliation process needs to:

1. Track what resources were created, updated, or deleted during an apply operation
2. Report these changes back to the CLI for user feedback
3. Support the backend's reflection-based dependency discovery approach

### Pain Points

- No proto types existed to capture reconciliation results
- The Apply response could not communicate what changes were made
- Users would have no visibility into which resources were affected during deployment
- The proto schema needed to align with the architectural decision that dependency graphs are derived (not passed)

## Solution

**Following Kubernetes-style API pattern**, all status-related messages are defined in `status.proto`:

1. **ReconciliationSummary** - Container for all changes made during an apply operation
   - `created` - List of newly created resources
   - `updated` - List of resources whose specs changed
   - `deleted` - List of orphaned resources that were pruned

2. **ResourceChangeRecord** - Identity of a single changed resource
   - `kind` - The resource type (agent, workflow, mcp_server, skill)
   - `slug` - Human-readable identifier from metadata.name
   - `resource_id` - System-assigned ID (e.g., agt_xxx, wfl_xxx)

Added `last_reconciliation` field (position 1) to ProjectStatus in `status.proto`. This field is populated only in the Apply() response and is not persisted to the database, maintaining the "minimal status" design principle.

### Refactoring (Post-Implementation)

After initial implementation with a separate `reconciliation.proto` file, the design was refactored to follow the Kubernetes-style API pattern where all status-related message types are co-located in `status.proto`. This aligns with how other resources (Agent, Workflow) structure their status definitions.

## Implementation Details

### Files Modified

**`apis/ai/stigmer/agentic/project/v1/status.proto`** (added 71 lines)
- Added ReconciliationSummary message with three repeated fields
- Added ResourceChangeRecord message with kind/slug/resource_id
- Added import of ApiResourceKind enum for type-safe resource identification
- Added `last_reconciliation` field (position 1) to ProjectStatus
- Comprehensive documentation explaining the design decision (no DependencyGraph proto)

**`apis/ai/stigmer/agentic/project/v1/api.proto`** (simplified)
- Removed separate reconciliation.proto import (comes via status.proto)
- Added comment that status.last_reconciliation contains reconciliation results
- Maintains clean separation of concerns

### Generated Stubs

**Go stubs**:
- `status.pb.go` - Contains ReconciliationSummary, ResourceChangeRecord, and ProjectStatus types
- `api.pb.go` - Simplified (no longer has last_reconciliation at Project level)
- `BUILD.bazel` - Updated with apiresourcekind dependency

**Python stubs**:
- `status_pb2.py`, `status_pb2.pyi` - Contains all status-related types
- Updated `api_pb2.py` and `api_pb2.pyi` (simplified)

### Proto Design Patterns Followed

1. **Kubernetes-style Co-location**: All status-related messages in `status.proto` (matches Agent, Workflow pattern)
2. **Field Numbering Convention**: Used field 1 in ProjectStatus for last_reconciliation, field 99 for audit (standard pattern)
3. **Enum Integration**: Used ApiResourceKind enum from commons package for type-safe resource identification
4. **Documentation Standards**: Extensive comments explaining design decisions and usage patterns
5. **Response-Only Fields**: Maintained the pattern of not persisting derived information to status

## Architectural Decision: No DependencyGraph Proto

The implementation explicitly follows the Phase 5 architectural decision that **dependency graphs are DERIVED by the backend, not passed from the CLI**:

**Rationale**:
- **Single Source of Truth**: Resources contain their references (ApiResourceReference fields)
- **No Sync Risk**: Graph derived from resources can't be stale or inconsistent
- **Open/Closed Principle**: Adding new reference fields works automatically via reflection
- **SDK's dependencies.json**: Used for LOCAL CLI validation only (dry-run preview)

This design ensures that the proto schema remains simple while the backend uses reflection to dynamically discover dependencies by scanning for `ApiResourceReference` fields in all resource types.

**Example dependencies that will be discovered**:
```
Agent.spec.skill_refs[]           → agent depends on skills
Agent.spec.mcp_server_usages[]    → agent depends on mcp_servers
Workflow.spec.tasks[].agent_ref   → workflow depends on agents
```

The DependencyDiscoverer (T05.13) will implement the reflection-based scanner in Java.

## Benefits

1. **User Visibility**: CLI can now display exactly what changed during an apply operation
2. **Audit Trail**: Change records include resource IDs for linking to audit logs
3. **Minimal Status Design**: ReconciliationSummary is response-only, not persisted (follows existing pattern)
4. **Type Safety**: Uses ApiResourceKind enum instead of strings for resource types
5. **Future-Proof**: Proto schema doesn't need updates when new reference fields are added to resources
6. **Pattern Consistency**: Follows Kubernetes-style API pattern with all status types in status.proto (matches Agent, Workflow)
7. **Clean Architecture**: Eliminates unnecessary separate reconciliation.proto file (14 files changed, 337 insertions, 465 deletions)

## Impact

### Immediate Impact

- Enables completion of T05.1-T05.28 in Phase 5 (Backend + Full CLI Integration)
- Provides the wire format for reconciliation results
- All proto stubs compile successfully (Go and Python)

### Developer Experience

- Clear proto documentation explains the design philosophy
- Pattern can be followed for future reconciliation-related features
- CLI developers have a clean API to work with for displaying results

### Production Readiness

- Zero breaking changes (additive field only)
- buf lint passes
- Bazel build succeeds
- Generated stubs are ready for immediate use in backend and CLI

## Related Work

### Prerequisites Completed

- Phase 4: Project Entity & stigmer.yaml Foundation ✅
- Project proto schema (api.proto, spec.proto, status.proto, enum.proto, io.proto) ✅
- Project Command/Query services (command.proto, query.proto) ✅

### Next Steps in Phase 5

- **T05.1**: Project Applier Foundation (CLI)
- **T05.2**: Project Get Foundation (CLI)
- **T05.3**: Project Delete Foundation (CLI)
- **T05.12-T05.14**: Domain Value Objects and Dependency Discovery (Backend)
- **T05.15-T05.20**: ProjectReconciliationService implementation (Backend)

### Architecture References

- **Phase 5 Plan**: `_projects/2026-01/20260131.02.cli-agent-yaml-first/plans/phase_5_backend_cli_integration_6fff0758.plan.md`
- **ADR-005**: Unified Resource Management & Project-Based Reconciliation
- **Project Track Guide**: `docs/guides/stigmer-projects.md`

## Verification

All verification steps passed:

- ✅ `buf lint` passed (proto syntax valid)
- ✅ `buf format -w` passed (formatting consistent)
- ✅ Go stubs generated successfully
- ✅ Python stubs generated successfully
- ✅ `bazel build //apis/stubs/go/ai/stigmer/agentic/project/v1:project` succeeded
- ✅ Gazelle updated BUILD.bazel files automatically
- ✅ No breaking changes (field 6 is additive)
- ✅ All dependencies resolved (apiresourcekind imported correctly)

---

**Status**: ✅ Production Ready
**Timeline**: 45 minutes (as estimated in Phase 5 plan)
**Task**: T05.0 from Phase 5 Backend + Full CLI Integration
