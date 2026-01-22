# callback_token Migration Summary

**Date**: 2026-01-22  
**Status**: ✅ COMPLETE (Go OSS)  
**Impact**: Breaking Change - Field Moved

---

## What Changed

Moved `callback_token` from `WorkflowExecutionStatus` to `WorkflowExecutionSpec` for architectural consistency.

### Before

```protobuf
// AgentExecution
message AgentExecutionSpec {
  bytes callback_token = 6;  // ✅ In spec
}

// WorkflowExecution
message WorkflowExecutionStatus {
  bytes callback_token = 11;  // ❌ In status (INCONSISTENT)
}
```

### After

```protobuf
// AgentExecution
message AgentExecutionSpec {
  bytes callback_token = 6;  // ✅ In spec
}

// WorkflowExecution
message WorkflowExecutionSpec {
  bytes callback_token = 7;   // ✅ In spec (CONSISTENT)
}
```

---

## Files Modified

### 1. Proto Definitions

**Added**:
- `apis/ai/stigmer/agentic/workflowexecution/v1/spec.proto`
  - Field 7: `bytes callback_token`
  - Comprehensive documentation (70+ lines)
  - Consistent with AgentExecution pattern

**Removed**:
- `apis/ai/stigmer/agentic/workflowexecution/v1/api.proto`
  - Field 11: `bytes callback_token` (removed from WorkflowExecutionStatus)

**Updated**:
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
  - Line 111: Reference updated from `WorkflowExecution.status.callback_token` to `WorkflowExecution.spec.callback_token`
  - Field number updated from 11 to 7

### 2. Generated Code

**Regenerated**:
- `apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1/spec.pb.go`
  - Added: `CallbackToken []byte` field (field 7)
  - Added: `GetCallbackToken()` method
  
- `apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1/api.pb.go`
  - Removed: `callback_token` from `WorkflowExecutionStatus`

### 3. Documentation

**Created**:
- `design-decisions/DD01-callback-token-in-spec-not-status.md`
  - Comprehensive rationale
  - Kubernetes philosophy analysis
  - Implementation details
  - Lessons learned

---

## Why This Change?

### The Problem

`callback_token` was inconsistently placed:
- AgentExecution: in **Spec** (correct)
- WorkflowExecution: in **Status** (incorrect)

### The Analysis

Following Kubernetes philosophy:
- **Spec** = Configuration / Inputs (what you want)
- **Status** = Observation / Outputs (what happened)

**Key Question**: Is `callback_token` an input or output?

**Answer**: **Input**
- Set at creation (before execution)
- Configures behavior ("where to report completion")
- Never changes during execution
- Not a result of execution

### The Decision

**callback_token is an input → belongs in Spec**

Like Kubernetes `pod.spec.nodeName`:
- System-set (scheduler sets it)
- But in spec because it configures WHERE pod runs
- Same pattern: `callback_token` configures WHERE to report completion

---

## Impact

### Proto Changes

**Breaking Change**:
- Field moved from Status (11) to Spec (7)
- Serialized protos with old location will need migration

**Minimal Impact** (for WorkflowExecution):
- Token handshake not yet implemented for WorkflowExecution
- No existing code reading `status.callback_token`
- Future implementation will use correct location

**No Impact** (for AgentExecution):
- Already in spec (no change)

### Code Changes

**Go OSS**:
- ✅ Proto stubs regenerated
- ✅ Code compiles successfully
- ✅ References updated

**Java Cloud** (stigmer-cloud):
- ⏳ Pending proto regeneration
- ⏳ See TODO-JAVA-IMPLEMENTATION.md

---

## Verification

### Build Status

```bash
✅ make protos                        # Success
✅ go build ./apis/stubs/go/...       # Success (1.3s)
```

### Proto Verification

**WorkflowExecutionSpec** (spec.pb.go):
```go
type WorkflowExecutionSpec struct {
    // ... other fields ...
    CallbackToken []byte  // ✅ Field 7
}

func (x *WorkflowExecutionSpec) GetCallbackToken() []byte {
    if x != nil {
        return x.CallbackToken  // ✅ Accessor exists
    }
    return nil
}
```

**WorkflowExecutionStatus** (api.pb.go):
```go
type WorkflowExecutionStatus struct {
    // ... other fields ...
    // ✅ No CallbackToken field (removed)
}
```

---

## Benefits

### 1. Philosophical Consistency

✅ Follows Kubernetes spec/status philosophy  
✅ Input in spec, output in status

### 2. Cross-Resource Consistency

✅ AgentExecution.spec.callback_token  
✅ WorkflowExecution.spec.callback_token  
✅ Same pattern everywhere

### 3. Future-Proof

✅ Enables workflow-to-workflow calling  
✅ No special cases  
✅ Clear semantics

### 4. Clearer Intent

**Before**:
```go
execution.GetStatus().GetCallbackToken()  // ❌ Why is input in status?
```

**After**:
```go
execution.GetSpec().GetCallbackToken()    // ✅ Clear: input in spec
```

---

## Next Steps

### For WorkflowExecution Implementation (Future Phase 4)

When implementing the token handshake pattern for WorkflowExecution:

1. **Extract token** in ExecuteWorkflowActivity:
   ```go
   taskToken := activity.GetInfo(ctx).TaskToken
   ```

2. **Pass in spec** when creating WorkflowExecution:
   ```go
   execution := &WorkflowExecution{
       Spec: &WorkflowExecutionSpec{
           CallbackToken: taskToken,  // ✅ Correct location
       },
   }
   ```

3. **Return pending**:
   ```go
   return nil, activity.ErrResultPending
   ```

4. **Complete on finish**:
   ```go
   // In workflow completion logic
   if execution.GetSpec().GetCallbackToken() != nil {
       completionClient.Complete(
           execution.GetSpec().GetCallbackToken(),
           result,
       )
   }
   ```

### For Java Team (stigmer-cloud)

See `TODO-JAVA-IMPLEMENTATION.md` for:
- Proto regeneration steps
- Code update locations
- Testing checklist

---

## References

- **Design Decision**: `design-decisions/DD01-callback-token-in-spec-not-status.md`
- **ADR**: `docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`
- **Java TODO**: `TODO-JAVA-IMPLEMENTATION.md`
- **Kubernetes Philosophy**: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#spec-and-status

---

## Summary

✅ **Problem**: Inconsistent field placement (AgentExecution in spec, WorkflowExecution in status)  
✅ **Solution**: Moved to spec for both (inputs belong in spec)  
✅ **Result**: Consistent, clear, future-proof architecture  
✅ **Status**: Complete for Go OSS, documented for Java cloud

**Key Insight**: `callback_token` is an **input** (configures where to report completion), not an **output** (result of execution), therefore it belongs in **Spec** regardless of being system-generated.

---

**Last Updated**: 2026-01-22  
**Implementation**: ✅ Go OSS Complete | ⏳ Java Cloud Pending
