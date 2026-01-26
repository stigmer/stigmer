# Next Task: 20260127.02.agent-skills-spec-alignment

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260127.02.agent-skills-spec-alignment

**Description**: Align Stigmer's Agent Skills implementation with the official Agent Skills specification (agentskills.io), including proper description field storage and system prompt injection format
**Goal**: Ensure our skills implementation follows the Agent Skills spec by: (a) storing skill description in SkillSpec proto, (b) using proper XML format for system prompt injection with name/description/location
**Tech Stack**: Protobuf, Go (CLI + backend)
**Components**: Proto definitions (apis/ai/stigmer/agentic/skill/v1/spec.proto), CLI skill parsing (client-apps/cli/internal/cli/artifact/), Backend skill controller, System prompt generation

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.02.agent-skills-spec-alignment/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-01-27 00:22
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
