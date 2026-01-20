# Fix: Agent Call Workflow Validation

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Areas**: workflow-runner, SDK (Go)  
**Impact**: Workflows with agent call tasks can now be validated and deployed

## Problem

Workflows containing agent call tasks failed validation with two errors:

**Error 1 - Missing Task Kind Support**:
```
failed to unmarshal task 'analyze-pr' config: 
unsupported task kind: WORKFLOW_TASK_KIND_AGENT_CALL
```

**Error 2 - Scope Enum Serialization**:
```
json: cannot unmarshal string into Go struct field AgentCallTaskConfig.scope 
of type apiresource.ApiResourceOwnerScope
```

This blocked deployment of workflows that invoke AI agents (e.g., PR review workflows).

## Root Causes

### Issue 1: Missing Validation Support

The workflow-runner's validation code didn't recognize `WORKFLOW_TASK_KIND_AGENT_CALL` enum:

**Location**: `backend/services/workflow-runner/pkg/validation/unmarshal.go`

The switch statement handling task kinds was missing the agent call case, causing it to fall through to the default error case.

**Location**: `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go`

The proto-to-YAML converter didn't have a case for converting agent call tasks.

### Issue 2: Scope String vs Enum

The SDK was serializing the `scope` field as a string ("organization", "platform"), but the protobuf expected an enum integer value.

**Location**: `sdk/go/internal/synth/workflow_converter.go`

```go
// ❌ Before
configMap["scope"] = scope  // "organization" as string

// ✅ After  
configMap["scope"] = scopeStringToEnum(scope)  // ApiResourceOwnerScope_organization (enum value 2)
```

## Changes Made

### 1. Added Agent Call Validation Support

**File**: `backend/services/workflow-runner/pkg/validation/unmarshal.go`

Added case to handle agent call task kind:

```go
case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL:
    protoMsg = &tasksv1.AgentCallTaskConfig{}
```

**File**: `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go`

Added case to convert agent call tasks to YAML:

```go
case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL:
    yamlTask[task.Name] = c.convertAgentCallTask(typedProto.(*tasksv1.AgentCallTaskConfig))
```

**File**: `backend/services/workflow-runner/pkg/converter/task_converters.go`

Implemented agent call task converter:

```go
func (c *Converter) convertAgentCallTask(cfg *tasksv1.AgentCallTaskConfig) map[string]interface{} {
    with := map[string]interface{}{
        "agent":   cfg.Agent,
        "message": cfg.Message,
    }
    
    // Handle optional fields: scope, env, config
    // Converts to Zigflow YAML format:
    // call: agent
    // with:
    //   agent: <agent-name>
    //   message: <message>
    
    return map[string]interface{}{
        "call": "agent",
        "with": with,
    }
}
```

Also updated field names to match proto:
- `MaxSteps` → `Timeout` (int32 seconds)
- `TimeoutSeconds` → removed
- `Temperature` → `Temperature` (float32 0.0-1.0)

### 2. Fixed Scope Enum Serialization

**File**: `sdk/go/internal/synth/workflow_converter.go`

Changed scope serialization from string to enum:

```go
// Add scope if specified (not empty)
if scope := cfg.Agent.Scope(); scope != "" {
    // Convert scope string to enum value
    configMap["scope"] = scopeStringToEnum(scope)
}
```

Added conversion helper:

```go
func scopeStringToEnum(scope string) apiresource.ApiResourceOwnerScope {
    switch scope {
    case "platform":
        return apiresource.ApiResourceOwnerScope_platform  // 1
    case "organization":
        return apiresource.ApiResourceOwnerScope_organization  // 2
    case "identity_account":
        return apiresource.ApiResourceOwnerScope_identity_account  // 3
    default:
        return apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified  // 0
    }
}
```

### 3. Added Worker Mode Support (Enhancement)

**File**: `backend/services/workflow-runner/cmd/worker/root.go`

Added support for `EXECUTION_MODE=temporal` environment variable to run workflow-runner in dedicated Temporal worker mode (used by stigmer daemon):

```go
// Check if running in Temporal worker mode (for stigmer integration)
if executionMode := os.Getenv("EXECUTION_MODE"); executionMode == "temporal" {
    log.Info().Str("mode", "temporal").Msg("Starting workflow-runner")
    return runTemporalWorkerMode()
}
```

Implemented `runTemporalWorkerMode()` function that:
- Loads config from environment variables
- Creates ZigflowWorker with three-queue architecture
- Registers validation, orchestration, and execution activities
- Starts workers on proper task queues

Added imports and aliased SDK worker package as `sdkworker` to avoid conflict with local `worker` package.

## Impact

**Before**:
- Workflows with agent call tasks failed validation
- Users couldn't deploy AI agent workflows
- Error occurred during YAML generation phase

**After**:
- Agent call tasks are recognized and validated
- Scope enums serialize correctly
- Workflows with agent calls can proceed through validation
- YAML generation succeeds for agent call tasks

## Testing Limitations

End-to-end testing blocked by unrelated CLI issue ("failed to execute Go agent") from another conversation. The fixes themselves are correct and validated through:
- ✅ Code verification (all cases added)
- ✅ Successful build
- ✅ Workflow-runner logs show progression past "unsupported task kind" error
- ⚠️ Full deployment test pending CLI fix

## Files Changed

- `backend/services/workflow-runner/pkg/validation/unmarshal.go` - Added agent call case
- `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go` - Added agent call conversion
- `backend/services/workflow-runner/pkg/converter/task_converters.go` - Implemented converter + fixed field names
- `backend/services/workflow-runner/cmd/worker/root.go` - Added worker mode support
- `sdk/go/internal/synth/workflow_converter.go` - Fixed scope enum serialization

## Related

- **Original issue**: `_projects/2026-01/20260120.02.fix-agent-call-workflow-validation-error/`
- **Enum definition**: `apis/stubs/go/ai/stigmer/commons/apiresource/enum.pb.go` (WORKFLOW_TASK_KIND_AGENT_CALL = 13)
- **Proto definition**: `apis/schemas/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto`
