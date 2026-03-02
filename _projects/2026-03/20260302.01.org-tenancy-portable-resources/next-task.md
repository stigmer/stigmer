# Next Task: 20260302.01.org-tenancy-portable-resources

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260302.01.org-tenancy-portable-resources

**Description**: Migrate Project to tenancy domain, replace hardcoded org: local with relative cross-references and a real Organization resource in seedpack, making Stigmer OSS resources portable across local and cloud deployments.
**Goal**: (1) Migrate Project proto to tenancy.stigmer.ai/v1, (2) expand apply pipeline for Organization kind, (3) make cross-refs org-agnostic, (4) bootstrap real default Organization in seedpack, (5) replace all "local" defaults with "default".
**Tech Stack**: Go (CLI, Server), Protobuf (APIs), YAML (Seedpack, Skill references), Python (Agent Runner)
**Components**: Proto definitions (tenancy/project), CLI apply pipeline, OSS server (Organization controller, project reconciliation), seedpack, CLI config (org context), documentation

## Current State
- **Status**: In Progress
- **Last Session**: 2026-03-03 (session 8) — T01.4: Server-side org reference resolution (OSS + Cloud)
- **Active Task**: T01.6 (seedpack updates — next)
- **Cloud Repo Status**: Build restored. Reconciliation subsystem rearchitected. NormalizeApiResourceReferencesStepV2 wired into all 29 handlers. See `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`

## Session Progress (2026-03-03, session 8 — T01.4: Server-Side Org Reference Resolution)
- Completed T01.4: Generic pipeline step resolves empty `org` in `ApiResourceReference` at write time (both OSS and Cloud)
- **OSS (Go)**: Created `normalize_references.go` — proto reflection walker finds all `ApiResourceReference` in spec, fills empty org from `metadata.org`
- Created `normalize_references_test.go` — 14 unit tests (empty fill, explicit preserved, mixed, nested sub-agents, MCP server usages, no-op, idempotency)
- Wired `NormalizeReferencesStep` into 16 controller pipelines (after BuildNewState/BuildUpdateState, before Persist)
- All Go tests pass, `go build` clean across all modules
- **Cloud (Java)**: Created `NormalizeApiResourceReferencesStepV2.java` — same walker using `Descriptors.FieldDescriptor` and `Message.Builder` pattern
- Created `NormalizeApiResourceReferencesStepV2Test.java` — 12 unit tests matching OSS coverage
- Added to `RequestOperationCommonSteps` as `normalizeReferences` field
- Wired into all 29 Create and Update handler pipelines (Agent, AgentExecution, AgentInstance, ApiKey, Environment, ExecutionContext, IdentityAccount, IdentityProvider, McpServer, Organization, Project, Session, Workflow, WorkflowExecution, WorkflowInstance)
- `grpc-request` library builds clean via Bazel; service-level build has pre-existing errors unrelated to this change
- Key design: step is a safe no-op for resources without references — added to ALL pipelines for forward-compatibility
- Key design: only walks `spec` field (not `status`) — status refs are system-generated and already absolute

## Session Progress (2026-03-03, session 7 — T01.5: Organization OSS Controllers)
- Completed T01.5: Full Organization CRUD controller in OSS server
- Created `backend/services/stigmer-server/pkg/domain/organization/controller/` package (8 source files)
- Command operations: create, update, delete, apply (pipeline pattern following McpServer)
- Query operations: get (by ID), find (paginated), findMyOrganizations (returns all in OSS)
- Delete follows Project pattern (OrganizationId has GetValue(), unlike McpServer's ApiResourceDeleteInput)
- getByExternalOrgId left as Unimplemented (cloud-only IdentityProvider feature)
- Created OrganizationExtractor for FTS5 search indexing (registered via init(), NOT added to ValidateExpectedKinds)
- Registered Organization controllers in server.go alongside existing controllers
- Updated BUILD.bazel for extractor and server packages
- 20 integration tests covering all operations, all passing
- All 23 stigmer-server test packages pass (0 failures, 0 regressions)
- Key insight: Organization slug is required in proto input (CEL rules enforce 2-15 chars) — unlike other resources, slug is not auto-derived from name
- Committed: `c2a55f49 feat(backend/stigmer-server): add Organization command/query controllers`

## Session Progress (2026-03-03, session 6 — Cloud Reconciliation Rearchitecture)
- Fixed 6 pre-existing build failures in stigmer-cloud (SkillPushHandler, CreateExecutionContextStep x2, WorkflowExecutionSendSignalHandler, AgentInstance controllers, McpServer handlers)
- Rearchitected reconciliation subsystem from embedded-resource to reference-based membership model
- Deleted DependencyGraph/Builder/Discoverer and tests (~3,500 lines of dead code removed)
- Added `deleteByOrgAndSlug` to `ApiResourceRepository` and `AbstractMongoApiResourceRepository`
- Rewrote domain types: `DesiredState`, `ActualState`, `ReconciliationPlan`, `ResourceChange` for `Set<ApiResourceReference>` model
- Rewrote `ProjectReconciliationService` for orphan-pruning-only semantics
- Updated all handler tests to remove `ProjectRuntime`, embedded resource lists references
- Net result: ~24,000 lines deleted, ~2,900 lines added across 172 files
- Design decisions: delete dependency graphs, keep dry-run, add deleteByOrgAndSlug

## Session Progress (2026-03-03, session 5 — T01.3: Optional Org in ApiResourceReference)
- Completed T01.3: Made `org` optional in `ApiResourceReference` proto message
- Removed `required = true` and `min_len = 1` from `org` field validation
- Changed pattern to `^$|^[a-z][a-z0-9-]*$` (follows established `SearchRequest.org` precedent)
- Updated field comment to document relative (empty) vs absolute (explicit) reference semantics
- Regenerated Go and Python stubs via `make protos` (also caught up ResourceTier enum rename stubs from T01.2)
- All verification passed: buf lint clean, Go build clean, 114 Bazel targets build, 38 test suites pass
- Architectural decision: Single `ApiResourceReference` type is correct (not split into relative/absolute types) — same pattern as `version` field
- Committed: `4f423b9f feat(apis/commons): make org optional in ApiResourceReference`

## Session Progress (2026-03-03, session 4 — T01.2: Organization Apply Pipeline)
- Completed T01.2: Organization is now a fully supported resource kind in the CLI apply pipeline
- Created `client-apps/cli/internal/cli/organization/` package (loader, applier, BUILD, tests)
- Added Organization to CLI type registry and verb support (apply, get, list, delete)
- Introduced `types.IsProjectMemberKind()` to distinguish project member vs infrastructure kinds
- Wired Organization into apply dispatch (`apply_file.go`) and handlers (`apply_file_handlers.go`)
- Added membership filter in declarative apply — Organization is applied but NOT added to `Project.Spec.Members`
- Changed Organization proto tier from `TIER_CLOUD_ONLY` to `open_source`
- Renamed `ResourceTier` enum values to lowercase (cosmetic proto cleanup)
- All tests updated and passing
- Key architectural decision: Organization is infrastructure (parent of Project), NOT a project member — no changes to reconcile/service.go

## Session Progress (2026-03-03, session 3 — Cloud Repo Migration)
- Migrated stigmer-cloud Project proto stubs from `agentic/project/v1` to `tenancy/project/v1` (all 5 languages: Go, Java, Python, TS, Dart)
- Moved 37 Java domain files from `domain.agentic.project` to `domain.tenancy.project` (20 main + 17 test)
- Updated all package declarations, proto imports, and apiVersion test assertions
- Adapted `ReconciliationResult` and `ProjectReconciliationService` from `ResourceChangeRecord` to `ApiResourceReference` (proto type removed in OSS redesign)
- Discovered major surprise: `ProjectSpec` fundamentally redesigned — embedded resources replaced by lightweight `ApiResourceReference` membership references
- Entire cloud reconciliation subsystem (`DesiredState`, `ActualState`, `ReconciliationPlan`, `DependencyGraph*`) needs rearchitecting for reference-based model
- Created comprehensive documentation: `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`
- Build currently fails — blocked on reconciliation rearchitecture (separate task)

## Session Progress (2026-03-03, session 2)
- Thorough codebase-wide gap analysis for management/project and agentic/project remnants
- Confirmed all production code (proto, Go/Python stubs, MCP codegen, schemas, backend, CLI, seedpack, e2e, examples) is fully migrated — zero gaps
- Moved project docs from `apis/ai/stigmer/agentic/project/docs/` to `apis/ai/stigmer/tenancy/project/docs/` (6 files)
- Updated all Project apiVersion references from `agentic.stigmer.ai/v1` to `tenancy.stigmer.ai/v1` in docs (README, project-resource-guide, sdk-track, declarative-track, examples, validation-checklist)
- Updated file discovery rules in docs to reference both `agentic.stigmer.ai/v1` and `tenancy.stigmer.ai/v1` (multiple valid apiVersions now)
- Fixed `docs/guides/stigmer-projects.md` — 7 stale Project apiVersion references
- Fixed `docs/product/what-is-project.md` — 3 stale apiVersion refs + 4 broken doc links
- Fixed `client-apps/cli/internal/cli/types/detect_test.go` — TestDetect_Project test fixture
- All tests pass

## Session Progress (2026-03-03, session 1)
- Completed T01.1: Migrated Project proto from `agentic.stigmer.ai/v1` through `management.stigmer.ai/v1` to final destination `tenancy.stigmer.ai/v1`
- Project now lives alongside Organization and Platform in the tenancy bounded context
- All Go modules build and test successfully
- buf lint clean, zero remaining `management/project` or `agentic/project` references in hand-written code
- Key decision: Clean break, no backward compatibility for old apiVersion
- Key decision: MCP codegen regeneration (not manual edit)
- Key decision: Merged Project into tenancy domain (not management) — Organization, Platform, and Project form the resource hierarchy bounded context

## Next Steps
1. **T01.6**: Seedpack updates — add Organization resource, update apiVersion, remove `org: local` (unblocked — T01.4 + T01.5 both complete)
2. **T01.7**: CLI defaults — replace `"local"` with `"default"`, add org context commands
3. Known gap for T01.7: Organization query proto has no `getBySlug` RPC — CLI `stigmer org get <slug>` will need either a proto addition or client-side filtering via `findMyOrganizations`

## Context for Resume
- T01.1, T01.2, T01.3, T01.4, and T01.5 are complete in both OSS and Cloud
- The Project proto now lives at `apis/ai/stigmer/tenancy/project/v1/` with package `ai.stigmer.tenancy.project.v1`
- Organization is fully supported in both CLI apply pipeline AND server-side controllers
- `ApiResourceReference.org` is now optional — empty means "resolve from parent resource's org"
- The `^$|^pattern$` convention is the established way to make proto fields optional-but-validated in this codebase
- `types.IsProjectMemberKind()` defines the member/non-member boundary — Organization is NOT a member
- `ResourceTier` enum values now use lowercase naming convention (e.g., `open_source`, `cloud_only`)
- Organization server controllers are live: create, update, delete, apply, get, find, findMyOrganizations
- Organization slug is REQUIRED in proto input (2-15 chars, CEL validation) — not auto-derived from name
- Organization `getByExternalOrgId` is Unimplemented in OSS (cloud-only feature)
- Server-side org resolution is live (T01.4) — NormalizeReferencesStep fills empty org from metadata.org at write time
- In OSS: `normalize_references.go` in `backend/libs/go/grpc/request/pipeline/steps/`
- In Cloud: `NormalizeApiResourceReferencesStepV2.java` in `grpc-request` library, `commonSteps.normalizeReferences` in all handlers
- The task plan is in `tasks/T01_0_plan.md` — review T01.6 section for next task details
- **stigmer-cloud**: Partially migrated — stubs regenerated, Java domain moved, imports updated. Blocked on reconciliation rearchitecture due to ProjectSpec redesign. Full status documented in `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`
- **Pre-existing Bazel issue**: `com_github_charmbracelet_glamour` repo unresolved — CLI root_test can't build via Bazel but passes via `go test`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/checkpoints/2026-03-03-session-8.md
```

### 2. Task Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/tasks/T01_0_plan.md
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/2026-03-03-session-8.md`
2. [ ] Read cloud migration doc: `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`
3. [ ] Check current task status in `tasks/T01_0_plan.md`
4. [ ] Review any new design decisions in `design-decisions/`
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
7. [ ] Proceed to T01.6 (seedpack updates — unblocked)

## Quick Commands

After loading context:
- "Continue with T01.6" - Seedpack updates with Organization resource (next — unblocked)
- "Continue with T01.7" - CLI defaults and org context commands
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
