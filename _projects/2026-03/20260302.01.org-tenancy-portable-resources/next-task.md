# Next Task: 20260302.01.org-tenancy-portable-resources

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260302.01.org-tenancy-portable-resources

**Description**: Migrate Project from agentic to management domain, replace hardcoded org: local with relative cross-references and a real Organization resource in seedpack, making Stigmer OSS resources portable across local and cloud deployments.
**Goal**: (1) Migrate Project proto to management.stigmer.ai/v1, (2) expand apply pipeline for Organization kind, (3) make cross-refs org-agnostic, (4) bootstrap real default Organization in seedpack, (5) replace all "local" defaults with "default".
**Tech Stack**: Go (CLI, Server), Protobuf (APIs), YAML (Seedpack, Skill references), Python (Agent Runner)
**Components**: Proto definitions (management/project), CLI apply pipeline, OSS server (Organization controller, project reconciliation), seedpack, CLI config (org context), documentation

## Current State
- **Status**: In Progress
- **Last Session**: 2026-03-03 — Completed T01.1 (Migrate Project proto to management domain)
- **Active Task**: T01.2 (next — Add Organization as supported resource kind in apply pipeline)

## Session Progress (2026-03-03)
- Completed full T01.1: Migrate Project proto from `agentic.stigmer.ai/v1` to `management.stigmer.ai/v1`
- 145 files changed (166 insertions, 4,758 deletions)
- All Go modules build and test successfully
- buf lint clean, zero remaining `agentic/project` references in hand-written code
- Key decision: Clean break, no backward compatibility for old apiVersion
- Key decision: MCP codegen regeneration (not manual edit)

## Next Steps
1. **T01.2**: Add Organization as a supported resource kind in the Project apply pipeline (expand the hardcoded 4-kind restriction)
2. **T01.3**: Make cross-references org-agnostic (empty `org` in `ApiResourceReference` resolves to parent resource's org)
3. **T01.4+**: Bootstrap real Organization resource in seedpack, replace all hardcoded `"local"` org defaults with `"default"`

## Context for Resume
- T01.1 is committed and complete
- The Project proto now lives at `apis/ai/stigmer/management/project/v1/` with package `ai.stigmer.management.project.v1`
- All generated stubs, codegen schemas, MCP gen, and consumers have been updated
- The task plan is in `tasks/T01_0_plan.md` — review T01.2 section for next task details
- `stigmer-cloud` was NOT modified — cloud team handles proto bump separately

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/checkpoints/2026-03-03-session-1.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-03-03-session-1.md`
2. [ ] Check current task status in `tasks/T01_0_plan.md`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with T01.2

## Quick Commands

After loading context:
- "Continue with T01.2" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
