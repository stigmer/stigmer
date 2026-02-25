# Next Task: 20260225.03.agent-instance-ref-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260225.03.agent-instance-ref-migration

**Description**: Replace opaque agent_instance_id strings with ApiResourceReference (org + kind + slug) across SessionSpec and AgentStatus, making the system human-readable and consistent with existing codebase patterns like environment_refs.
**Goal**: Eliminate opaque system-generated IDs from user-facing surfaces by replacing them with human-readable ApiResourceReference throughout the session and agent execution flows.
**Tech Stack**: Protobuf, Go, Python, gRPC
**Components**: Proto APIs (session/v1, agent/v1), Go backend (stigmer-server agent execution, session controller), Python agent-runner (execute_graphton), CLI (session display)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.03.agent-instance-ref-migration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-25 23:19
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
