# Next Task: 20260302.01.org-tenancy-portable-resources

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260302.01.org-tenancy-portable-resources

**Description**: Migrate Project from agentic to management domain, replace hardcoded org: local with relative cross-references and a real Organization resource in seedpack, making Stigmer OSS resources portable across local and cloud deployments.
**Goal**: (1) Migrate Project proto to management.stigmer.ai/v1, (2) expand apply pipeline for Organization kind, (3) make cross-refs org-agnostic, (4) bootstrap real default Organization in seedpack, (5) replace all "local" defaults with "default".
**Tech Stack**: Go (CLI, Server), Protobuf (APIs), YAML (Seedpack, Skill references), Python (Agent Runner)
**Components**: Proto definitions (agentic/project → management/project, ApiResourceReference), CLI apply pipeline, OSS server (Organization controller, project reconciliation), seedpack, CLI config (org context), documentation

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260302.01.org-tenancy-portable-resources/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-02 17:30
**Current Task**: T01 (Initial Setup)
**Status**: Planning

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
