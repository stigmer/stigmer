# Next Task: Fix Agent Call Workflow Validation Error

**Project**: Fix Agent Call Workflow Validation Error  
**Location**: `_projects/2026-01/20260120.02.fix-agent-call-workflow-validation-error/`  
**Status**: ✅ Complete

## Completion Summary

**Completed**: 2026-01-20 23:52

Fixed two critical validation errors preventing workflows with agent call tasks from deploying.

**What was fixed**:
1. ✅ Missing task kind support (WORKFLOW_TASK_KIND_AGENT_CALL)
2. ✅ Scope enum serialization (string → enum conversion)
3. ✅ Worker mode support (EXECUTION_MODE=temporal)

**Documentation**: See checkpoint `checkpoints/2026-01-20-validation-fixes-complete.md`

**Critical Issue**: The workflow-runner binary is still throwing the error even after:
- Code changes added to unmarshal.go, proto_to_yaml.go, task_converters.go
- Binary was rebuilt
- Workflow was tested

## Current Task: Task 1 - Verify Code Changes Are in Place

**Objective**: Confirm the code changes actually exist in the source files before investigating further.

### What to Check

1. **File: `unmarshal.go`**
   ```bash
   # Check for agent call case
   grep -A 2 "WORKFLOW_TASK_KIND_AGENT_CALL" backend/services/workflow-runner/pkg/validation/unmarshal.go
   ```
   
   Expected: Should find case statement with `AgentCallTaskConfig`

2. **File: `proto_to_yaml.go`**
   ```bash
   # Check for agent call case
   grep -A 2 "WORKFLOW_TASK_KIND_AGENT_CALL" backend/services/workflow-runner/pkg/converter/proto_to_yaml.go
   ```
   
   Expected: Should find case calling `convertAgentCallTask()`

3. **File: `task_converters.go`**
   ```bash
   # Check for converter function
   grep -A 10 "convertAgentCallTask" backend/services/workflow-runner/pkg/converter/task_converters.go
   ```
   
   Expected: Should find complete function implementation

4. **Proto Enum**
   ```bash
   # Check if enum exists
   grep "WORKFLOW_TASK_KIND_AGENT_CALL" apis/stubs/go/ai/stigmer/commons/apiresource/enum.pb.go
   ```
   
   Expected: Should find enum value = 13

### Quick Start

```bash
# Navigate to project root
cd /Users/suresh/scm/github.com/stigmer/stigmer

# Verify all code changes exist
@_projects/2026-01/20260120.02.fix-agent-call-workflow-validation-error/tasks.md (Task 1)

# Then proceed to Task 2 to debug the build/deploy issue
```

## The Problem

**Error from logs (2026-01-20 23:12:04)**:
```
ERROR YAML generation failed
error: failed to convert task 'analyze-pr': failed to unmarshal task 'analyze-pr' config: unsupported task kind: WORKFLOW_TASK_KIND_AGENT_CALL
```

**This error occurs in**: `backend/services/workflow-runner/pkg/validation/unmarshal.go` 
**In function**: `UnmarshalTaskConfig()`
**At the switch statement**: When it doesn't find a matching case for the task kind

## Why This Matters

Without this fix:
- Cannot deploy workflows with agent call tasks
- Agent-workflow integration is blocked
- "AI PR reviewer" and similar workflows won't work

## Investigation Hypothesis

**Most Likely**: Binary wasn't actually rebuilt or daemon is using cached/old binary

**Possibilities**:
1. Bazel cached the old binary
2. stigmer-server daemon is using a different binary path
3. There's another code path being called
4. Temporal worker needs restart

## Next Steps After Task 1

Once code is verified, move to Task 2 to:
1. Check binary build timestamp
2. Verify which binary the daemon is using
3. Clean rebuild if needed
4. Restart daemon with new binary

## Files

- `README.md` - Project overview
- `tasks.md` - All 5 tasks detailed
- `notes.md` - Investigation findings
- `next-task.md` - This file (drag into chat!)

## Test Workflow

**Location**: `~/.stigmer/stigmer-project/`  
**Workflow**: `review-demo-pr`  
**Agent**: `pr-reviewer`  
**Failing Task**: `analyze-pr` (agent call task)

---

**To resume**: Drag this file into chat or reference:  
`@_projects/2026-01/20260120.02.fix-agent-call-workflow-validation-error/next-task.md`

**To view logs**: 
```bash
stigmer server logs -c workflow-runner -f
```
