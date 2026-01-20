# Fix Agent Call Scope Enum Serialization

**Date**: 2026-01-21 00:12:45  
**Type**: Bug Fix  
**Scope**: SDK (Go), Backend (workflow-runner)  
**Impact**: Critical - Unblocks agent call tasks in workflows

## Problem

Workflows with agent call tasks were failing deployment with error:

```
failed to unmarshal agent call config: json: cannot unmarshal string 
into Go struct field AgentCallTaskConfig.scope of type apiresource.ApiResourceOwnerScope
```

This prevented any workflow containing agent calls from deploying, blocking the agent-workflow integration feature.

## Root Cause Analysis

The issue manifested in two locations with the same underlying problem: **incorrect enum handling during serialization**.

### Issue 1: SDK Enum Serialization (workflow_converter.go)

**Location**: `sdk/go/internal/synth/workflow_converter.go:635`

**Problem**: When converting `AgentCallTaskConfig` to protobuf Struct, the code converted the scope string to an enum value and tried to insert it directly into the map:

```go
if scope := cfg.Agent.Scope(); scope != "" {
    configMap["scope"] = scopeStringToEnum(scope)  // ❌ Enum type
}
```

**Why it failed**: `structpb.NewStruct()` cannot handle protobuf enum types directly. It expects primitive types (string, int, float, bool) or nested maps/slices.

**Error at synthesis time**:
```
proto: invalid type: apiresource.ApiResourceOwnerScope
```

### Issue 2: Backend JSON Unmarshaling (task_builder_call_agent.go)

**Location**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_agent.go:105`

**Problem**: The backend was using standard `json.Unmarshal` instead of `protojson.Unmarshal` to deserialize agent call configurations:

```go
if err := json.Unmarshal(withBytes, t.agentConfig); err != nil {  // ❌ Standard JSON
    return fmt.Errorf("failed to unmarshal agent call config: %w", err)
}
```

**Why it failed**: Standard `encoding/json` package doesn't understand protobuf enum name mappings. When it encounters:
```json
{"scope": "organization"}
```

It tries to unmarshal the string "organization" directly into the enum field, which fails because Go's standard JSON library expects the enum's numeric value, not its name.

**Error at deployment time**:
```
json: cannot unmarshal string into Go struct field AgentCallTaskConfig.scope 
of type apiresource.ApiResourceOwnerScope
```

## Solution

### Fix 1: SDK - Keep Scope as String

**File**: `sdk/go/internal/synth/workflow_converter.go`

**Change**:
```go
// Before
if scope := cfg.Agent.Scope(); scope != "" {
    configMap["scope"] = scopeStringToEnum(scope)  // Enum type
}

// After  
if scope := cfg.Agent.Scope(); scope != "" {
    // Keep as string - structpb.NewStruct() cannot handle enum types
    // The backend will convert the string to the appropriate enum value
    configMap["scope"] = scope  // String type
}
```

**Rationale**: 
- `structpb.NewStruct()` works with primitive types
- Protobuf JSON encoding expects enum names as strings
- Backend handles the string-to-enum conversion during unmarshaling

### Fix 2: Backend - Use protojson.Unmarshal

**File**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_agent.go`

**Changes**:

1. **Import protojson**:
```go
import (
    "encoding/json"  // Still needed for marshaling
    "fmt"
    // ... other imports ...
    "google.golang.org/protobuf/encoding/protojson"  // Added
)
```

2. **Use protojson for unmarshaling**:
```go
// Before
if err := json.Unmarshal(withBytes, t.agentConfig); err != nil {
    return fmt.Errorf("failed to unmarshal agent call config: %w", err)
}

// After
// Unmarshal using protojson - properly handles string enum values
if err := protojson.Unmarshal(withBytes, t.agentConfig); err != nil {
    return fmt.Errorf("failed to unmarshal agent call config: %w", err)
}
```

**Rationale**:
- `protojson.Unmarshal()` understands protobuf enum name mappings
- Converts enum string names ("organization", "platform") to correct enum values
- Consistent with how other task types are unmarshaled in `validation/unmarshal.go`

## Files Changed

### SDK
- `sdk/go/internal/synth/workflow_converter.go` - Fixed scope serialization (line 635)

### Backend
- `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_agent.go` - Fixed unmarshaling (lines 19, 105)

## Testing

**Test workflow**: `~/.stigmer/stigmer-project/review-demo-pr`

**Before fix**:
```bash
$ stigmer apply
Error: failed to deploy workflow 'review-demo-pr': 
  json: cannot unmarshal string into Go struct field AgentCallTaskConfig.scope
```

**After fix**:
```bash
$ stigmer apply
✓ Agent deployed: pr-reviewer (ID: agt-1768918212594733000)
✓ Workflow deployed: review-demo-pr (ID: wfl-1768918212604015000)
🚀 Deployment successful!
```

## Impact

**Unblocked**:
- ✅ Agent call tasks can now be deployed in workflows
- ✅ Agent-workflow integration is functional
- ✅ Users can create AI-powered workflows with agent delegation

**Fixed scenarios**:
- Workflows calling agents with explicit scope (`scope: "organization"`)
- Workflows calling agents with default scope (scope omitted)
- Agent call tasks with all configuration options (model, timeout, temperature)

## Design Notes

**Why two separate fixes?**

The issue appeared at two distinct serialization boundaries:

1. **SDK → Protobuf Manifest**: SDK creates a protobuf Struct for transmission. This requires primitive types, so scope must stay as string.

2. **Zigflow YAML → Proto Config**: Zigflow deserializes YAML-converted JSON into proto messages. This requires protobuf-aware unmarshaling, hence `protojson.Unmarshal`.

Both fixes address the same conceptual problem (enum serialization) but at different layers with different tools.

**Enum handling consistency**:
- Other task types in `validation/unmarshal.go` already use `protojson.Unmarshal` correctly
- This fix brings agent call task handling in line with established patterns
- The `scopeStringToEnum()` function is still valid for other use cases where explicit enum conversion is needed

## Related

**Original project**: `_projects/2026-01/20260120.02.fix-agent-call-workflow-validation-error/`

**Related enum**: `ai.stigmer.commons.apiresource.ApiResourceOwnerScope`
- Values: `platform`, `organization`, `identity_account`
- Proto file: `apis/ai/stigmer/commons/apiresource/enum.proto`

**Proto definition**: `ai.stigmer.agentic.workflow.v1.tasks.AgentCallTaskConfig`
- Field: `scope` (field 2, optional)
- Proto file: `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto`
