# Cloud Reconciliation Rearchitecture and Build Fix

**Date**: March 3, 2026

## Summary

Fixed all pre-existing build failures in stigmer-cloud caused by upstream proto migrations, then rearchitected the entire project reconciliation subsystem from an embedded-resource model to a lightweight reference-based membership model. The reconciliation service now exclusively performs orphan pruning via set-difference on `ApiResourceReference` members, eliminating ~3,500 lines of complex dependency graph infrastructure.

## Problem Statement

The `stigmer-cloud` backend was in a broken build state after the Project proto migration from `agentic.stigmer.ai/v1` to `tenancy.stigmer.ai/v1`. The fundamental redesign of `ProjectSpec` (from embedding full Agent/Workflow/Skill/McpServer resources to using lightweight `ApiResourceReference` membership pointers) left the entire reconciliation subsystem incompatible with the new data model.

### Pain Points

- 6 files had pre-existing compile errors from proto field removals, type renames, and API changes unrelated to the Project migration
- The reconciliation subsystem (`DesiredState`, `ActualState`, `ReconciliationPlan`, `DependencyGraph`, `ProjectReconciliationService`) operated on full embedded proto messages — a model that no longer exists
- ~1,250 lines of dependency graph code (`DependencyGraph`, `DependencyGraphBuilder`, `DependencyDiscoverer`) became dead code since the CLI now applies resources individually
- All reconciliation and handler tests referenced removed `ProjectSpec` fields (`runtime`, `agents`, `workflows`, `mcp_servers`, `skills`)

## Solution

Two-phase approach: surgical fixes for pre-existing build failures, followed by a full rearchitecture of the reconciliation subsystem to match the new reference-based membership model.

## Implementation Details

### Phase 1: Pre-existing Build Failures (6 files)

- **SkillPushHandler**: Removed `source` field handling, fixed `SkillState.READY` to `SKILL_STATE_READY`, renamed `ApiResourceSpecAudit` to `ApiResourceAuditInfo`, replaced `getOwnerScope()` with `orgId`
- **CreateExecutionContextStep (x2)**: Fixed `ApiResourceReference` import path from `commons.apiresource.io` to `commons.apiresource`
- **WorkflowExecutionSendSignalHandler**: Migrated from string-keyed `context.setAttribute/getAttribute` to typed `io.grpc.Context.Key<Boolean>` pattern
- **AgentInstanceGrpcAutoController + handlers**: Renamed `AgentInstanceQueryServiceGrpc` to `AgentInstanceQueryControllerGrpc` across controller and 3 handler files
- **McpServerCreateHandler + UpdateHandler**: Removed all `DockerServerConfig` and `VolumeMount` handling (only `stdio` and `http` server types remain)

### Phase 2: Reconciliation Rearchitecture (core domain + tests)

**Design decisions (collaboratively resolved):**
1. Delete `DependencyGraph/Builder/Discoverer` — dead code is a maintenance burden, git history is the safety net
2. Keep server-side dry-run — negligible complexity for defense-in-depth
3. Add `deleteByOrgAndSlug` to `AbstractMongoApiResourceRepository` — clean single-call orphan deletion

**Domain types rewritten:**
- `DesiredState` / `ActualState`: From 4-map structure (`Map<String, Agent>`, etc.) to `Set<ApiResourceReference>`
- `ReconciliationPlan`: From full resource diffs with dependency ordering to simple set-difference (`orphans = actual - desired`), sorted by kind hierarchy for safe deletion order
- `ResourceChange`: From holding full proto `Message` with create/update/delete to `ApiResourceReference` + `ChangeType.DELETE` only
- `ProjectReconciliationService`: From complex orchestrator (fetch from repos, build dependency graph, execute creates/updates/deletes) to simple comparator (parse member sets, compute orphans, delete via `ApiResourceRepositoryRegistry`)

**Infrastructure additions:**
- `ApiResourceRepository.deleteByOrgAndSlug(String orgId, String slug)` — new interface method
- `AbstractMongoApiResourceRepository.deleteByOrgAndSlug` — MongoDB implementation using `metadata.org` + `metadata.slug` query

**Files deleted (6):**
- `DependencyGraph.java`, `DependencyGraphBuilder.java`, `DependencyDiscoverer.java`
- `DependencyGraphTest.java`, `DependencyGraphBuilderTest.java`, `DependencyDiscovererTest.java`

**Tests rewritten (10 files):**
- All reconciliation domain tests (`DesiredStateTest`, `ActualStateTest`, `ReconciliationPlanTest`, `ResourceChangeTest`, `ReconciliationResultTest`) — rewritten for reference-based model
- `ProjectReconciliationServiceTest` — fully rewritten for orphan-pruning-only semantics
- Handler tests (`ProjectCreateHandlerTest`, `ProjectUpdateHandlerTest`, `ProjectApplyHandlerTest`, `ProjectDeleteHandlerTest`) — removed all `ProjectRuntime`, `setRuntime`, `getAgentsList`, and embedded resource references

## Benefits

- **Net deletion of ~3,500 lines** of complex, now-dead code
- **Reconciliation complexity reduced by an order of magnitude** — from dependency-graph-ordered creates/updates/deletes to a single set-difference producing delete-only operations
- **Clean separation of concerns** — CLI handles individual resource apply; server handles only orphan cleanup
- **Build restored** — all pre-existing compilation errors fixed across 6 unrelated files
- **Test suite aligned** — all tests reference the current `ProjectSpec` shape (members-based, no runtime, no embedded resources)

## Impact

- **stigmer-cloud backend**: Build unblocked, reconciliation aligned with OSS proto redesign
- **Shared infrastructure**: `ApiResourceRepository` and `AbstractMongoApiResourceRepository` gain `deleteByOrgAndSlug` — a generally useful capability
- **Future maintainability**: Removed false confidence from 1,250 lines of dependency graph tests covering dead code paths

## Related Work

- [Migrate Project to Tenancy Domain](2026-03-03-022846-migrate-project-to-tenancy-domain.md) — OSS proto migration that triggered these changes
- [Cloud Project Tenancy Migration](2026-03-03-024927-cloud-project-tenancy-migration.md) — Cloud stub regeneration and Java domain move (session 3)
- [Add Organization to CLI Apply Pipeline](2026-03-03-025519-add-organization-to-cli-apply-pipeline.md) — T01.2 that established Organization as infrastructure, not a project member

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
