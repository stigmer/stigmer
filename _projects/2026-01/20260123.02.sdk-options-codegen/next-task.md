# Next Task: 20260123.02.sdk-options-codegen

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260123.02.sdk-options-codegen

**Description**: Extend code generator to automatically generate functional options layer from proto schemas, eliminating 90% of hand-crafted options code across all 13 task types
**Goal**: Automate generation of task-specific functional options (HttpCallOption, AgentCallOption, etc.) from proto/JSON schemas to achieve 95% code generation, 5% ergonomic sugar
**Tech Stack**: Go, Protocol Buffers, JSON schemas, Code generation templates
**Components**: tools/codegen/generator/main.go, sdk/go/workflow/*_options.go (13 task types), tools/codegen/schemas/tasks/*.json

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-01-23 21:27
**Current Task**: T05 (Migration & Testing) - IN PROGRESS 🔄
**Status**: Major Milestone Achieved - Generator Fixed! ✅
**Last Updated**: 2026-01-24 00:30
**Latest Completion**: T05 Generator Fixes ✅
**Major Achievement**: 
- ✅ All naming conflicts resolved with prefixing
- ✅ Helpers generated for SDK resource directories
- ✅ Map types fixed to use correct value types
- ✅ `sdk/go/agent/gen` package compiles successfully!

**Key Decisions Made**:
- ✅ Follow Pulumi patterns (bare names, no error returns)
- ✅ Direct integration (breaking changes OK, pre-launch)
- ✅ Resource-based prefixing for disambiguation (AgentDescription, InlineSubAgentDescription)

**Next Action**: Clean up manual agent.go file and update examples (~2.5 hours remaining)
**Latest Checkpoint**: `checkpoints/2026-01-24-t05-generator-fixed-pulumi-patterns.md`
**Latest Changelog**: `_changelog/2026-01/2026-01-24-023203-fix-sdk-options-generator-pulumi-patterns.md`

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
