# Notes: Fix Agent Call Workflow Validation Error

**Project**: Fix Agent Call Workflow Validation Error  
**Date**: 2026-01-20

---

## Problem Context

### Original Error
```
Error: failed to deploy workflow 'review-demo-pr': rpc error: code = Unknown desc = pipeline step ValidateWorkflowSpec failed: workflow validation failed: Failed to generate YAML: failed to convert task 'analyze-pr': failed to unmarshal task 'analyze-pr' config: unsupported task kind: WORKFLOW_TASK_KIND_AGENT_CALL
```

### What We Know

1. **Workflow Contains Agent Call Task**
   - Workflow name: `review-demo-pr`
   - Task name: `analyze-pr`
   - Task kind: `WORKFLOW_TASK_KIND_AGENT_CALL`

2. **Code Changes Were Made**
   - Added agent call support to `unmarshal.go`
   - Added agent call support to `proto_to_yaml.go`
   - Implemented `convertAgentCallTask()` in `task_converters.go`

3. **But Error Persists**
   - User rebuilt the binary
   - User tested with the workflow
   - Same error still appears

### Why This Is Critical

Agent call tasks are a new feature that allows workflows to invoke AI agents. Without this working:
- Workflows cannot use agent capabilities
- The new agent-workflow integration is blocked
- Use cases like "AI PR reviewer" workflow cannot be deployed

---

## Investigation Findings

### Code Changes Made (2026-01-20)

**File 1: `unmarshal.go`**
```go
case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL:
    protoMsg = &tasksv1.AgentCallTaskConfig{}
```

**File 2: `proto_to_yaml.go`**
```go
case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL:
    yamlTask[task.Name] = c.convertAgentCallTask(typedProto.(*tasksv1.AgentCallTaskConfig))
```

**File 3: `task_converters.go`**
```go
func (c *Converter) convertAgentCallTask(cfg *tasksv1.AgentCallTaskConfig) map[string]interface{} {
    with := map[string]interface{}{
        "agent":   cfg.Agent,
        "message": cfg.Message,
    }
    // ... handles scope, env, config ...
    return map[string]interface{}{
        "call": "agent",
        "with": with,
    }
}
```

### Hypothesis: Why It's Not Working

**Hypothesis 1: Binary Not Rebuilt**
- Bazel may have cached the old binary
- Need to verify binary timestamp

**Hypothesis 2: Daemon Using Old Binary**
- `stigmer-server` may have copied the binary at startup
- May need to restart daemon, not just rebuild

**Hypothesis 3: Different Code Path**
- There may be another unmarshal or convert function being called
- Need to search entire codebase

**Hypothesis 4: Proto Enum Not Generated**
- The enum value may not be in the generated Go stubs
- Need to verify proto generation

**Hypothesis 5: Temporal Worker Cache**
- Temporal may cache activity code
- Need to restart Temporal worker

---

## Key Insights

### How Workflow Validation Works

1. **User runs** `stigmer apply`
2. **CLI sends** workflow proto to stigmer-server
3. **stigmer-server** calls `ValidateWorkflowSpec` pipeline step
4. **Pipeline step** executes Temporal workflow `ValidateWorkflow`
5. **Temporal dispatches** to workflow-runner's `ValidateWorkflow` activity
6. **Activity calls** `converter.ProtoToYAML()`
7. **Converter calls** `convertTask()` for each task
8. **convertTask calls** `UnmarshalTaskConfig()` to get typed proto
9. **UnmarshalTaskConfig** switches on task kind → **THIS IS WHERE IT FAILS**

### The Error Location

The error happens in `unmarshal.go` at the switch statement:
```go
switch kind {
    case WORKFLOW_TASK_KIND_SET: ...
    case WORKFLOW_TASK_KIND_HTTP_CALL: ...
    // ... other cases ...
    case WORKFLOW_TASK_KIND_AGENT_CALL: ... // ← THIS CASE WAS ADDED
    default:
        return nil, fmt.Errorf("unsupported task kind: %v", kind)
}
```

If the error still happens, it means:
- Either the new code isn't in the binary
- Or there's a different code path being called

---

## Build and Deploy Process

### How workflow-runner Gets Built

```bash
# Build with Bazel
bazel build //backend/services/workflow-runner/...

# Binary location
bazel-bin/backend/services/workflow-runner/workflow-runner_/workflow-runner
```

### How stigmer-server Launches workflow-runner

```bash
# stigmer-server finds the binary
findWorkflowRunnerBinary() → searches in:
  1. Same directory as stigmer-server
  2. Parent directory
  3. bazel-bin path
  4. PATH environment

# Launches as subprocess
cmd := exec.Command(binaryPath)
cmd.Stdout = logFile
cmd.Stderr = errFile
cmd.Start()
```

### Potential Issues

1. **Old binary in PATH** - If there's an old workflow-runner in PATH, it might be used
2. **Cached binary** - daemon.go may have copied binary at startup
3. **Multiple binaries** - Different binaries in different locations

---

## Debugging Strategy

### Phase 1: Verify Code Exists
✓ Confirm code changes are in source files  
✓ Confirm proto enum exists  
✓ Confirm BUILD.bazel includes the files

### Phase 2: Verify Build Works
- Check Bazel actually rebuilds
- Check binary contains new symbols
- Check binary timestamp is recent

### Phase 3: Verify Deployment Works
- Check which binary daemon is using
- Check binary path resolution
- Restart daemon and verify new binary loaded

### Phase 4: Verify Execution Works
- Run test workflow
- Check validation logs
- Confirm YAML generation succeeds

---

## Next Steps

1. **Immediately**: Verify the code changes are actually in the source files (Task 1)
2. **Then**: Check binary build and deployment (Task 2)
3. **Then**: Search for alternative code paths (Task 3)
4. **Finally**: Test end-to-end (Tasks 4-5)

---

## Questions to Answer

- [ ] Are the code changes in the source files?
- [ ] Is the binary actually being rebuilt?
- [ ] Is the daemon using the new binary?
- [ ] Are there other code paths that need updating?
- [ ] Does Temporal need to be restarted?
- [ ] Is there a validation cache somewhere?

---

## Related Files

**Source Code:**
- `backend/services/workflow-runner/pkg/validation/unmarshal.go`
- `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go`
- `backend/services/workflow-runner/pkg/converter/task_converters.go`

**Proto Definitions:**
- `apis/schemas/ai/stigmer/commons/apiresource/enum.proto` (enum definition)
- `apis/stubs/go/ai/stigmer/commons/apiresource/enum.pb.go` (generated)
- `apis/schemas/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto` (config)

**Daemon Code:**
- `client-apps/cli/internal/cli/daemon/daemon.go` (launches workflow-runner)

**Test Workflow:**
- `~/.stigmer/stigmer-project/main.go` (contains review-demo-pr workflow)

---

## Timestamps

- **Code changes made**: 2026-01-20 23:00 (approximately)
- **User rebuilt**: 2026-01-20 23:10 (approximately)
- **Error persists**: 2026-01-20 23:12 (from logs)
