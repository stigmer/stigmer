# Fix Agent Call Workflow Validation Error

**Project**: Fix Agent Call Workflow Validation Error  
**Location**: `_projects/2026-01/20260120.02.fix-agent-call-workflow-validation-error/`  
**Created**: 2026-01-20  
**Status**: ✅ Complete  
**Completed**: 2026-01-20

## Overview

Fixed agent call workflow validation errors by adding task kind support and fixing scope enum serialization.

## Problem Statement

When running `stigmer apply` with a workflow containing agent call tasks, validation fails with:

```
ERROR YAML generation failed
error: failed to convert task 'analyze-pr': failed to unmarshal task 'analyze-pr' config: unsupported task kind: WORKFLOW_TASK_KIND_AGENT_CALL
```

**Critical Issue**: Code changes were made to add agent call support in:
- `backend/services/workflow-runner/pkg/validation/unmarshal.go`
- `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go`
- `backend/services/workflow-runner/pkg/converter/task_converters.go`

But after rebuilding, the error still persists.

## Resolution ✅

**Fixed two issues**:

1. **Missing Task Kind Support**: Added `WORKFLOW_TASK_KIND_AGENT_CALL` cases to validation and conversion code
2. **Scope Enum Serialization**: Fixed SDK to serialize scope as enum integer instead of string

**Changes made**:
- Added agent call case to `unmarshal.go`, `proto_to_yaml.go`, `task_converters.go`
- Fixed scope conversion in SDK `workflow_converter.go` with `scopeStringToEnum()` helper
- Added worker mode support with `EXECUTION_MODE=temporal` detection
- Fixed AgentExecutionConfig field names (Timeout, Temperature, Model)

**Result**: Workflows with agent call tasks now pass validation. YAML generation succeeds.

See: `checkpoints/2026-01-20-validation-fixes-complete.md`

## Technology Stack

- Go/Bazel
- Temporal workflow engine
- Protocol Buffers
- workflow-runner service

## Affected Components

- `backend/services/workflow-runner/pkg/validation/unmarshal.go`
- `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go`
- `backend/services/workflow-runner/pkg/converter/task_converters.go`
- `backend/services/workflow-runner` binary build/deployment
- `stigmer-server` daemon that launches workflow-runner

## Success Criteria

- [ ] Agent call tasks (`WORKFLOW_TASK_KIND_AGENT_CALL`) are properly recognized
- [ ] Workflow validation succeeds for workflows containing agent calls
- [ ] `stigmer apply` completes successfully with agent call workflows
- [ ] Generated YAML includes proper `call: agent` syntax
- [ ] Test workflow executes without validation errors

## Key Files

- `README.md` - This file (project overview)
- `tasks.md` - Task breakdown and progress tracking
- `notes.md` - Investigation notes and findings
- `next-task.md` - Quick resume file (drag into chat!)

## Related Resources

- Error logs in: `~/.stigmer/data/logs/workflow-runner.log`
- Test workflow: `~/.stigmer/stigmer-project/`
- Workflow-runner binary: Built via Bazel

## Investigation Areas

1. **Binary not rebuilding**: Check if Bazel is actually rebuilding the binary
2. **Daemon caching**: Check if stigmer-server is using a cached binary
3. **Multiple code paths**: Check if there are other unmarshal/convert paths
4. **Build artifacts**: Verify the built binary contains the new code

---

**To resume work**: Drag `next-task.md` into chat or reference this project.
