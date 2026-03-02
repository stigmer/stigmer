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
- **Last Session**: 2026-03-03 (session 3) — Cloud repo proto migration (partially complete, blocked)
- **Active Task**: T01.2 (next — Add Organization as supported resource kind in apply pipeline)
- **Cloud Repo Status**: Migration partially complete — blocked on ProjectSpec reconciliation rearchitecture. See `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`

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
1. **T01.2**: Add Organization as a supported resource kind in the Project apply pipeline (expand the hardcoded 4-kind restriction)
2. **T01.3**: Make cross-references org-agnostic (empty `org` in `ApiResourceReference` resolves to parent resource's org)
3. **T01.4+**: Bootstrap real Organization resource in seedpack, replace all hardcoded `"local"` org defaults with `"default"`

## Context for Resume
- T01.1 is committed and complete in OSS (code + docs)
- The Project proto now lives at `apis/ai/stigmer/tenancy/project/v1/` with package `ai.stigmer.tenancy.project.v1`
- All generated stubs, codegen schemas, MCP gen, and consumers have been updated in OSS
- Project docs now live at `apis/ai/stigmer/tenancy/project/docs/` (moved from agentic path)
- Zero remaining `management/project` or `agentic/project` references in OSS non-historical files
- The task plan is in `tasks/T01_0_plan.md` — review T01.2 section for next task details
- **stigmer-cloud**: Partially migrated — stubs regenerated, Java domain moved, imports updated. Blocked on reconciliation rearchitecture due to ProjectSpec redesign. Full status documented in `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/checkpoints/2026-03-03-session-3.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-03-03-session-3.md`
2. [ ] Read cloud migration doc: `stigmer-cloud/_docs/2026-03-03-cloud-project-tenancy-migration.md`
3. [ ] Check current task status in `tasks/T01_0_plan.md`
4. [ ] Review any new design decisions in `design-decisions/`
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
7. [ ] Continue with T01.2 (OSS) or cloud reconciliation rearchitecture (stigmer-cloud)

## Quick Commands

After loading context:
- "Continue with T01.2" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
