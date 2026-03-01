# Next Task: 20260301.01.smart-workspace-context

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260301.01.smart-workspace-context

**Description**: Implement intelligent workspace context retrieval for Stigmer's agent platform — replacing the current reactive, brute-force file discovery with proactive context delivery including workspace tree snapshots, .gitignore-aware filtering, file-tree caching, extended skip-directories, context-efficiency prompt guidance, task-aware relevance signaling, and semantic search indexing.
**Goal**: Close the architectural gaps between Stigmer's reactive workspace interaction and Cursor-style proactive context retrieval so that agents start with structural awareness, discover files efficiently, and use context budgets wisely.
**Tech Stack**: Python (Graphton library, agent-runner worker), Go (CLI if needed)
**Components**: backend/libs/python/graphton (filesystem backend, tool wrappers, prompt enhancement), backend/services/agent-runner (workspace provisioner, execute_graphton, workspace sources), potentially client-apps/cli

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-01 07:00
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
