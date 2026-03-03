# Next Task: 20260302.01.org-tenancy-portable-resources

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260302.01.org-tenancy-portable-resources

**Description**: Migrate Project to tenancy domain, replace hardcoded org: local with relative cross-references and a real Organization resource in seedpack, making Stigmer OSS resources portable across local and cloud deployments.
**Goal**: (1) Migrate Project proto to tenancy.stigmer.ai/v1, (2) expand apply pipeline for Organization kind, (3) make cross-refs org-agnostic, (4) bootstrap real default Organization in seedpack, (5) replace all "local" defaults with "default".
**Tech Stack**: Go (CLI, Server), Protobuf (APIs), YAML (Seedpack, Skill references), Python (Agent Runner)
**Components**: Proto definitions (tenancy/project), CLI apply pipeline, OSS server (Organization controller, project reconciliation), seedpack, CLI config (org context), documentation

## Current State
- **Status**: T01.1–T01.9 Complete (OSS). T01.4 also complete in Cloud.
- **Last Session**: 2026-03-03 (session 12) — T01.9: Product Documentation Update
- **Active Task**: All planned tasks complete. Remaining: ~14 `org: local` hits in secondary API docs (workflow, workflowinstance, environment, agentinstance, agentexecution, project docs in `apis/`). These are not attached to skill generation scripts but are browsable via workspace.
- **Cloud Repo Status**: Build restored. Reconciliation subsystem rearchitected. NormalizeApiResourceReferencesStepV2 wired into all 29 handlers. See `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`

## Session Progress (2026-03-03, session 12 — T01.9: Product Documentation Update)
- Completed T01.9: Eliminated all `org: local` from docs that feed into skill generation, consolidated CLI config docs, documented unified org context model
- **Product docs** (7 files): Replaced `org: local` with correct patterns in `what-is-organization.md`, `what-is-agent.md`, `what-is-mcp-server.md`, `what-is-project.md`, `what-is-skill.md`, `what-is-workflow.md`, `docs/guides/uploading-skills.md`
- **API resource docs** (13 files): Fixed all `org: local` in skill-generation-attached directories: `agent/docs/` (7 files), `mcpserver/docs/` (4 files), `skill/docs/` (2 files)
- **resource-references.md**: Complete rewrite — org field from "Required" to optional, documented relative vs absolute references, updated validation rules to match T01.3 proto changes
- **CLI config consolidation**: Merged `configuration.md` + `configuration-cascade.md` into single doc. Added Organization Context section documenting `--org` flag, `stigmer context show/set --org`, `context.organization`, `STIGMER_ORG_ID` injection, resolution chain. Deleted `configuration-cascade.md`
- **Design decision**: No `what-is-cli-configuration.md` — CLI config is a tool concern, not a domain resource; the what-is pattern is reserved for domain resources (Agent, Organization, etc.)
- **YAML example org strategy**: `default` for getting-started metadata, omit org for cross-references (relative pattern from T01.3), `acme-corp` for illustrative examples
- **Files modified**: 23 files modified (+241 lines, -549 lines) — net reduction of 308 lines
- **Verified clean**: All skill-generation-attached directories (`agent/docs/`, `mcpserver/docs/`, `skill/docs/`, `docs/product/`) have zero `org: local` remaining

## Session Progress (2026-03-03, session 11 — T01.8: CLI Org Global Flag, Runtime Injection, and Cleanup)
- Completed T01.8: Removed speculative `ContextConfig.Environment` (YAGNI), promoted `--org` to root persistent flag, injected `STIGMER_ORG_ID` into agent runtime and SDK synthesis, updated all seedpack skill docs
- **Removed `ContextConfig.Environment`**: Removed field from config struct, config get/set handlers, `context show` display, and all related test fixtures — no domain semantics defined, dead surface area
- **Promoted `--org` to root persistent flag**: Added `rootCmd.PersistentFlags().String("org", ...)` and `GetOrgFlag(cmd)` helper. Removed per-command `--org` flag from 10 files (apply, get, list, delete, push, search, discover, run_agent_exec, draft_agent, draft_mcp_server, draft_skill). Follows `kubectl --namespace` pattern
- **Injected `STIGMER_ORG_ID` into agent RuntimeEnv**: In `prepareAgentExec()` after `connectToBackend()` resolves orgID, injects `STIGMER_ORG_ID` into `runtimeEnv` (shared by `stigmer run` and `stigmer draft`). Respects user override via `--env STIGMER_ORG_ID=xxx`
- **Injected `STIGMER_ORG_ID` into SDK synthesis env**: Added `OrgID` to `SynthesizeOptions`, set as env var alongside `STIGMER_OUT_DIR`. Restructured `executeProjectApply()` to resolve org before synthesis
- **Updated seedpack skill docs**: Updated 10 files across agent-creator and mcp-server-creator — replaced all `org: local` with `STIGMER_ORG_ID` references, removed "local vs cloud" org guidance, removed questions asking user for org
- **Updated `next-task.md`**: Marked T01.8 complete, added detailed T01.9 scope for documentation consolidation
- **Tests**: Fixed `config_test.go` references to removed `Environment` field. All 26 CLI test packages pass, build clean
- **Files modified**: 30 files modified (+125 lines, -128 lines) — net reduction
- **Key design**: `STIGMER_ORG_ID` is outbound-only (injected by CLI into agent runtime), not inbound (CLI's own org resolution chain unchanged)
- **Key design**: Agents no longer mention "local mode vs cloud mode" for org — org is always from context, backend type is a separate concern

## Session Progress (2026-03-03, session 10 — T01.7: Unified Organization Context and CLI Defaults)
- Completed T01.7: Eliminated all hardcoded `"local"` org fallbacks, unified 3 fragmented org-resolution functions into single backend-agnostic priority chain, added `stigmer context` commands, auto-sets org context during server startup
- **Architectural change**: Single org resolution priority chain: `--org flag > stigmer.yaml metadata.org > config context.organization > Backend.Cloud.OrgID (compat) > error` — same chain for local AND cloud
- Added `ResolveContextOrganization()` to `config.Config` — reads `Context.Organization`, falls back to `Backend.Cloud.OrgID` for backward compat
- **apply.go** `resolveApplyOrganization()`: removed backend-type branching and `"local"` fallback; unified chain
- **verb_helpers.go** `resolveOrganization()`: removed entire `switch` on backend type; also fixed existing bug where `--org` flag was ignored for local backend
- **run_resolve.go** `resolveOrgID()`: simplified to flag > `ResolveContextOrganization()`
- **server.go** `handleServerStart()`: added `autoSetOrgContext(cfg)` after seedpack bootstrap — queries `findMyOrganizations`, auto-sets `context.organization` when exactly 1 org, warns when multiple
- **server.go** `runBootstrapDiscovery()`: replaced hardcoded `orgID := "local"` with `cfg.ResolveContextOrganization()`
- **New file** `context.go`: `stigmer context show` (displays org, environment, backend) and `stigmer context set --org <slug>` (validates org exists via server, saves to config)
- Registered `stigmer context` in root.go Configuration group (alongside `backend` and `config`)
- **config_values.go**: added `context.organization` and `context.environment` to `stigmer config get/set`
- **daemon.go** `EnsureRunning()`: added `EnsureOrgContext()` after `EnsureSeedpackBootstrapped` — idempotent auto-detection for commands that auto-start daemon
- Updated `ContextConfig` comment to clarify it's used by both local and cloud backends
- **Tests**: rewrote `apply_org_test.go` from 8 tests to 24 tests covering unified resolution, context org, cloud backward compat, no-org error, nil metadata, resolveOrgID, ResolveContextOrganization
- All 26 CLI test packages pass, all 23 stigmer-server test packages pass, all modules build clean
- **Key design**: zero hardcoded org strings in CLI code — `"local"` is gone from all 4 locations
- **Key design**: single code path for local and cloud — no backend-type branching in org resolution
- **Key design**: auto-detection during startup means zero manual steps for normal flow
- **Files modified**: 11 files modified, 1 file created (+314 lines, -63 lines)
- BUILD.bazel updated for both `root/` (added context.go, emptypb dep) and `daemon/` (added org proto, emptypb dep)

## Session Progress (2026-03-03, session 9 — T01.6: Seedpack Updates)
- Completed T01.6: Seedpack bootstraps a real Organization resource and all `org: local` removed from YAML resources
- Created `seedpack/organizations/default.yaml` — Organization with slug `default`, self_managed, system label
- Added `metadata.org: default` to `seedpack/stigmer.yaml` — makes seedpack self-contained, CLI reads project's org for all resources
- Removed `org: local` from 3 agent YAML files (metadata and cross-references)
- Updated `seedpack/embed.go` with `//go:embed organizations` directive
- Updated `seedpack/BUILD.bazel` with `organizations/**` in embedsrcs glob
- Updated `seedpack/seedpack_test.go` to verify `organizations/default.yaml` is embedded
- All 4 seedpack tests pass, all modules build clean (seedpack, CLI, server)
- Key design: seedpack project manifest declares `org: default`, so T01.7 narrows to CLI fallback default only
- Key design: agent instruction text and skill docs deferred to T01.8 (documentation, not structural references)

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
1. ~~**T01.8**: Skill docs~~ — COMPLETED
2. ~~**T01.9**: Product docs~~ — COMPLETED: eliminated `org: local` from all skill-generation inputs, consolidated CLI config docs, documented org context model
3. **Optional cleanup**: ~14 remaining `org: local` hits in secondary API docs (`apis/ai/stigmer/agentic/workflow/docs/`, `workflowinstance/docs/`, `environment/docs/`, `agentinstance/docs/`, `agentexecution/docs/`, `tenancy/project/docs/`). Not urgent — these are not spotlight-attached to skill generation scripts.
4. **Regenerate skills**: Run `seedpack/tools/regenerate_all.sh` to verify clean skill output with updated docs

## Context for Resume
- T01.1 through T01.9 are complete in OSS; T01.4 also complete in Cloud
- **T01.8 changes**: Removed `ContextConfig.Environment` (YAGNI), promoted `--org` to root persistent flag (was duplicated across 11+ commands), injected `STIGMER_ORG_ID` into agent `RuntimeEnv` and SDK synthesis env, updated all seedpack skill docs (agent-creator, mcp-server-creator) to read `STIGMER_ORG_ID` instead of asking user or hardcoding `org: local`
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
- **Seedpack** now bootstraps Organization resource (slug `default`), project manifest declares `org: default`, all agent YAML cross-refs use relative (empty org) pattern
- **CLI org context**: unified resolution (flag > metadata > context.organization > Cloud.OrgID > error), `stigmer context show/set --org`, auto-detection on server start
- **CLI org context**: `EnsureOrgContext()` in daemon.go auto-detects org for commands that auto-start the daemon
- **CLI org context**: `context.organization` readable/writable via `stigmer config get/set`
- **CLI org context**: zero hardcoded org strings in CLI code
- The task plan is in `tasks/T01_0_plan.md` — review T01.8 section for next task details
- **stigmer-cloud**: Partially migrated — stubs regenerated, Java domain moved, imports updated. Reconciliation rearchitected. Full status documented in `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`
- **Pre-existing Bazel issue**: `com_github_charmbracelet_glamour` repo unresolved — CLI root_test can't build via Bazel but passes via `go test`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/checkpoints/2026-03-03-session-12.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-03-03-session-12.md`
2. [ ] Read cloud migration doc: `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`
3. [ ] Check current task status in `tasks/T01_0_plan.md`
4. [ ] Review any new design decisions in `design-decisions/`
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
7. [ ] Optional: clean up remaining ~14 `org: local` hits in secondary API docs
8. [ ] Regenerate skills with `seedpack/tools/regenerate_all.sh` to verify clean output

## Quick Commands

After loading context:
- "Clean up secondary API docs" - Fix ~14 remaining `org: local` in non-attached API docs
- "Regenerate skills" - Run `seedpack/tools/regenerate_all.sh` to verify clean output
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
