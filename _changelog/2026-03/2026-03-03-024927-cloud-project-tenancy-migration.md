# Cloud Project Tenancy Migration (Partial)

**Date**: March 3, 2026

## Summary

Propagated the Project proto migration from `agentic.stigmer.ai/v1` to `tenancy.stigmer.ai/v1` into the stigmer-cloud repository. Successfully completed the mechanical migration (stubs, Java domain package move, import updates) but discovered a fundamental ProjectSpec redesign that blocks the reconciliation subsystem from compiling. The migration is documented and paused for architectural review.

## Problem Statement

After completing T01.1 in the OSS repo (migrating the Project proto to the tenancy domain), the stigmer-cloud repository still referenced the old `agentic/project/v1` proto paths. The cloud backend needed to be updated to consume the new tenancy proto stubs and reflect the package restructuring.

### Pain Points

- Cloud repo proto stubs pointed at removed `agentic/project/v1` package
- 37 Java domain files in `domain.agentic.project` needed package migration
- Proto import paths throughout the Java codebase were stale
- Test fixtures contained hardcoded `agentic.stigmer.ai/v1` apiVersion references

## Solution

Executed a systematic migration of the cloud repo in phases: stub regeneration, Java domain file relocation, import/package updates, and test assertion fixes. When proto-level type changes were discovered (ResourceChangeRecord removal, ProjectSpec redesign), adapted code where feasible and documented the remaining architectural gap.

## Implementation Details

### Completed (Phases 1-5)

- **Stub regeneration**: Ran `make clean && make build` in `stigmer-cloud/apis/` to regenerate stubs for all 5 languages (Go, Java, Python, TypeScript, Dart) from the new tenancy proto
- **Java domain relocation**: Moved 37 files (20 main + 17 test) from `domain/agentic/project/` to `domain/tenancy/project/` via `git mv`, preserving history
- **Package/import migration**: Updated all `package` declarations and `import` statements from `ai.stigmer.domain.agentic.project.*` to `ai.stigmer.domain.tenancy.project.*`
- **Test assertions**: Updated apiVersion test expectations from `agentic.stigmer.ai/v1` to `tenancy.stigmer.ai/v1`
- **ResourceChangeRecord adaptation**: Replaced removed proto type with `ApiResourceReference` in `ReconciliationResult`, `ProjectReconciliationService`, and tests

### Blocked (Phase 6)

The new `tenancy/project/v1/spec.proto` fundamentally redesigned ProjectSpec:
- **Before**: Embedded full resource definitions — `repeated Agent agents`, `repeated Workflow workflows`, `repeated McpServer mcp_servers`, `repeated Skill skills`, plus a `Runtime runtime` field
- **After**: Flat membership tracking — `repeated ApiResourceReference members`, no runtime field

This invalidates the cloud reconciliation subsystem which was built around iterating resource-specific lists. Affected components: `DesiredState`, `ActualState`, `ReconciliationPlan`, `DependencyGraph*`, `ProjectReconciliationService`.

## Benefits

- Cloud repo stubs now aligned with OSS tenancy proto
- Java domain correctly placed in `tenancy` bounded context alongside Organization
- Migration document (`stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`) provides clear path for completing the rearchitecture

## Impact

- **stigmer-cloud backend**: Build currently broken — reconciliation service needs rearchitecture before it compiles
- **Deployment**: No production impact — cloud service was already being rebuilt
- **Architecture**: Surfaces a design question about whether Project reconciliation should manage resource lifecycle or just track membership references

## Related Work

- [Migrate Project proto to management domain](2026-03-03-014051-migrate-project-proto-to-management-domain.md) — First hop (agentic → management)
- [Migrate Project to tenancy domain](2026-03-03-022846-migrate-project-to-tenancy-domain.md) — Second hop (management → tenancy)
- Project task plan: `_projects/2026-03/20260302.01.org-tenancy-portable-resources/tasks/T01_0_plan.md`

---

**Status**: In Progress (blocked on reconciliation rearchitecture)
**Timeline**: ~2 hours for mechanical migration; reconciliation rearchitecture TBD
