# Next Task - Agent Controller Pipeline

**Project:** Agent Controller Pipeline Framework  
**Location:** `_projects/2026-01/20260118.01.agent-controller-pipeline/`  
**Last Updated:** 2026-01-18

## Current Status

✅ **Task T01 Complete** - Pipeline framework foundation implemented  
🟡 **Task T02 Partial** - Common pipeline steps implemented (interface fix needed)

## Current Task

**Task T02.1:** Fix Pipeline Step Interface Mismatch

**Status:** READY TO START (15 minutes)

**Previous Task:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/tasks/T02_1_partial.md`

## What to Do Next

**Quick fix needed (15 minutes):**

All 4 step files need Execute method signature updated:

**Current (incorrect):**
```go
func (s *Step[T]) Execute(ctx *pipeline.RequestContext[T]) pipeline.StepResult {
    // ...
    return pipeline.StepResult{Success: true}
}
```

**Required:**
```go
func (s *Step[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    // ...
    return nil  // for success
}
```

**Files to fix:**
1. `pkg/pipeline/steps/slug.go`
2. `pkg/pipeline/steps/defaults.go`
3. `pkg/pipeline/steps/persist.go`
4. `pkg/pipeline/steps/duplicate.go`

**After fix:**
- Run tests: `go test ./backend/services/stigmer-server/pkg/pipeline/steps/...`
- All tests should pass
- Ready for T03 (agent controller integration)

## Quick Context

This project implements a pipeline framework for the Stigmer OSS agent controller to match the architecture used in Stigmer Cloud (Java). 

**Completed so far:**
- ✅ Generic pipeline framework (T01)
- 🟡 4 common reusable steps: slug resolution, duplicate checking, defaults, persistence (T02 - needs interface fix)

**What remains:**
- ⏳ Fix interface mismatch (15 min)
- ⏳ Agent-specific steps (2-3 hours)
- ⏳ Agent controller refactoring (1-2 hours)
- ⏳ Integration testing

## Files to Reference

- **Partial Completion:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/tasks/T02_1_partial.md`
- **README:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/README.md`
- **Step Interface:** `@stigmer/backend/services/stigmer-server/pkg/pipeline/step.go`

## To Resume in Future Sessions

Simply drag this file (`next-task.md`) into the chat or reference:
```
@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/next-task.md
```
