# Next Task: 20260130.01.api-resource-scope-redesign

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260130.01.api-resource-scope-redesign

**Description**: Redesign the API resource ownership model by removing ApiResourceOwnerScope from references, requiring all resources to have an org, and implementing context-aware reference resolution with two-method pattern (AddSkill for same-org, AddSkillFrom for cross-org).
**Goal**: Make SDK code portable between local, cloud, and self-hosted deployments by simplifying the reference model to org/slug (like GitHub owner/repo), removing the platform scope abstraction that doesn't exist in local mode.
**Tech Stack**: Proto/gRPC APIs, Go SDK, Go CLI, Java backend, FGA authorization model
**Components**: apis/ai/stigmer/commons/apiresource/ (proto definitions), sdk/go/ (skillref, mcpserverref, agent helpers), stigmer-cloud/backend/ (FGA model, service layer), CLI commands

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-01-30 08:12
**Current Task**: T01 - Plan Review
**Status**: PENDING REVIEW - Awaiting developer feedback on task plan

### Key Design Decisions Made
- Adopting GitHub model: everything has an org
- Two-method pattern: `AddSkill(slug)` + `AddSkillFrom(org, slug)`
- Visibility (public/private) on resource metadata only
- Remove `ApiResourceOwnerScope` from references

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
