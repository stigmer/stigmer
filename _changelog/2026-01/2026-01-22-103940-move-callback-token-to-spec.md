# Move callback_token from Status to Spec for Architectural Consistency

**Date**: January 22, 2026

## Summary

Moved `callback_token` field from `WorkflowExecutionStatus` to `WorkflowExecutionSpec` to maintain consistency with `AgentExecution` and follow Kubernetes spec/status philosophy. This architectural alignment ensures both AgentExecution and WorkflowExecution handle async activity completion tokens identically, enabling future workflow-to-workflow calling patterns.

## Problem Statement

The `callback_token` field was inconsistently placed across execution resources:
- `AgentExecution`: callback_token in **Spec** (field 6) ✅
- `WorkflowExecution`: callback_token in **Status** (field 11) ❌

This inconsistency violated Kubernetes spec/status philosophy and would create confusion in future workflow-to-workflow calling scenarios.

### Pain Points

- **Architectural inconsistency**: Same field, different locations across similar resources
- **Philosophy violation**: callback_token is an input (where to report completion), not an output (result)
- **Future confusion**: If WorkflowExecution calls WorkflowExecution, which pattern to follow?
- **Semantic ambiguity**: Status placement suggested it was a result, but it's actually configuration

## Solution

Applied Kubernetes spec/status philosophy to determine correct placement:
- **Spec** = Configuration/Inputs (what you want, how it should behave)
- **Status** = Observation/Outputs (what happened, what was observed)

**Decision**: `callback_token` is an **input** (configures where to report completion) → belongs in **Spec**

**Rationale** (following Kubernetes patterns):
- Like `pod.spec.nodeName` (system-set but configures WHERE pod runs)
- Unlike `pod.status.podIP` (reports WHAT was assigned)
- Unlike `pod.status.phase` (reports WHAT is happening)

**Key insight**: "System-generated" doesn't mean "must be in status". Many Kubernetes spec fields are system-set (e.g., `nodeName`). The deciding factor is whether it's an input/configuration or output/observation.

## Implementation Details

### Proto Changes

#### WorkflowExecution

**Before**:
```protobuf
// spec.proto
message WorkflowExecutionSpec {
  string workflow_instance_id = 1;
  string workflow_id = 6;
  string trigger_message = 3;
  map<string, string> trigger_metadata = 4;
  map<string, ExecutionValue> runtime_env = 5;
  // No callback_token
}

// api.proto  
message WorkflowExecutionStatus {
  // ... other fields ...
  bytes callback_token = 11;  // ❌ Wrong location
}
```

**After**:
```protobuf
// spec.proto
message WorkflowExecutionSpec {
  string workflow_instance_id = 1;
  string workflow_id = 6;
  string trigger_message = 3;
  map<string, string> trigger_metadata = 4;
  map<string, ExecutionValue> runtime_env = 5;
  bytes callback_token = 7;  // ✅ Moved to spec
}

// api.proto
message WorkflowExecutionStatus {
  // ... other fields ...
  // callback_token removed
}
```

#### Cross-Resource Consistency

Updated AgentExecution proto cross-reference:

**Before**:
```protobuf
// AgentExecution api.proto
// - WorkflowExecution.status.callback_token (field 11) - Same pattern
```

**After**:
```protobuf
// AgentExecution api.proto  
// - WorkflowExecution.spec.callback_token (field 7) - Same pattern
```

### Generated Code

**Go Stubs**:
- ✅ `WorkflowExecutionSpec.CallbackToken` field added (field 7)
- ✅ `WorkflowExecutionSpec.GetCallbackToken()` method generated
- ✅ `WorkflowExecutionStatus.CallbackToken` field removed
- ✅ `AgentExecutionStatus.callback_token` reference updated

**Python Stubs**:
- ✅ `WorkflowExecutionSpec.callback_token` property added
- ✅ `WorkflowExecutionStatus.callback_token` property removed

### Files Modified

**Proto Definitions**:
1. `apis/ai/stigmer/agentic/workflowexecution/v1/spec.proto`
   - Added callback_token field (field 7)
   - Comprehensive documentation (70+ lines)
   - Consistency notes with AgentExecution

2. `apis/ai/stigmer/agentic/workflowexecution/v1/api.proto`
   - Removed callback_token field (old field 11)
   - Removed ~55 lines of documentation

3. `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
   - Updated cross-reference comment
   - Changed from `.status.callback_token (field 11)` to `.spec.callback_token (field 7)`

**Generated Stubs** (auto-generated):
4. `apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1/spec.pb.go`
5. `apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1/api.pb.go`
6. `apis/stubs/go/ai/stigmer/agentic/agentexecution/v1/api.pb.go`
7. `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowexecution/v1/spec_pb2.py`
8. `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowexecution/v1/spec_pb2.pyi`
9. `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowexecution/v1/api_pb2.py`
10. `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowexecution/v1/api_pb2.pyi`

## Benefits

### 1. Philosophical Consistency

✅ Follows Kubernetes spec/status philosophy:
- **Spec**: Configuration/inputs (what you want, how it should behave)
- **Status**: Observation/outputs (what happened, what was observed)

callback_token is clearly configuration: "When you finish, complete this external activity"

### 2. Cross-Resource Consistency

Both AgentExecution and WorkflowExecution now use identical pattern:
- ✅ `AgentExecution.spec.callback_token` (field 6)
- ✅ `WorkflowExecution.spec.callback_token` (field 7)

No confusion, no special cases to remember.

### 3. Future-Proof Architecture

Enables future workflow-to-workflow calling:
- Same pattern for any execution resource
- No special handling needed
- Clear semantics everywhere

### 4. Clearer Code Intent

**Before**:
```go
execution.GetStatus().GetCallbackToken()  // ❌ Why is input in status?
```

**After**:
```go
execution.GetSpec().GetCallbackToken()    // ✅ Clear: input in spec
```

### 5. Better Documentation

Documentation now aligns with field placement:
- Spec docs explain "what you can configure"
- callback_token configures "where to report completion"
- No need to explain anomalies

## Impact

### Breaking Change

**Proto Serialization**:
- Field moved from Status (field 11) to Spec (field 7)
- Serialized protos with old location incompatible
- Wire format changed

**Minimal Production Impact**:
- WorkflowExecution token handshake not yet implemented in production
- No existing code reading/writing `status.callback_token`
- AgentExecution unchanged (already in spec)

### Code Migration

**Go**:
- ✅ Proto stubs regenerated
- ✅ All references updated
- ✅ Code compiles successfully

**Python**:
- ✅ Proto stubs regenerated
- ✅ Code compiles (no existing usage)

**Java** (stigmer-cloud):
- ⏳ Proto regeneration pending (server timeout issue)
- ⏳ See TODO-JAVA-IMPLEMENTATION.md

**Future Implementation**:
- When implementing WorkflowExecution token handshake, use `spec.callback_token`
- Pattern matches AgentExecution (already implemented)

## Design Decision

### Why Spec, Not Status?

**The Critical Question**: Is callback_token an input or output?

**Answer**: **Input**
- Set at creation (before execution starts)
- Configures behavior (where to report completion)
- Never changes during execution
- Not a result of execution

**Kubernetes Analogy**:
- Like `pod.spec.nodeName` (scheduler sets it, but it's in spec because it configures WHERE pod runs)
- Unlike `pod.status.podIP` (reports WHAT was assigned)

**Deciding Factor**: 
- callback_token tells the execution "HOW to complete" (configuration)
- It doesn't report "WHAT happened" (observation)
- Therefore: **Spec**

### What About temporal_workflow_id?

`temporal_workflow_id` correctly stays in **Status** because:
- It's an identifier assigned BY Temporal (like `pod.status.podIP`)
- It's for observability/correlation, not behavior control
- It's metadata ABOUT the execution, not configuration FOR it

**Key Distinction**:
- `temporal_workflow_id` = "This is my Temporal ID" (informational)
- `callback_token` = "When done, call back here" (behavioral)

## Related Work

**Phase 1 (Completed)**: Proto definition with callback_token for AgentExecution
**Phase 2 (Completed)**: Zigflow Go activity implementation for async completion
**Phase 3 (Completed)**: Stigmer Service Go backend integration with logging
**This Change**: Architectural alignment for WorkflowExecution

**Documentation Created**:
- `design-decisions/DD01-callback-token-in-spec-not-status.md` - Comprehensive rationale
- `CALLBACK-TOKEN-MIGRATION-SUMMARY.md` - Migration summary and verification
- `checkpoints/CP03_phase3_complete_go.md` - Phase 3 completion checkpoint
- `TODO-JAVA-IMPLEMENTATION.md` - Java implementation guide

## Testing

### Build Verification

```bash
✅ make protos                        # Proto regeneration successful
✅ go build ./apis/stubs/go/...       # Go stubs compile (1.3s)
```

### Verification Steps

1. ✅ WorkflowExecutionSpec has CallbackToken field (field 7)
2. ✅ WorkflowExecutionSpec has GetCallbackToken() method
3. ✅ WorkflowExecutionStatus no longer has CallbackToken
4. ✅ AgentExecution cross-reference updated
5. ✅ All generated code compiles

## Future Work

### When Implementing WorkflowExecution Token Handshake

Similar to AgentExecution pattern (already implemented):

1. **Extract token** in calling activity:
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
   if execution.GetSpec().GetCallbackToken() != nil {
       completionClient.Complete(
           execution.GetSpec().GetCallbackToken(),
           result,
       )
   }
   ```

### Java Cloud (stigmer-cloud)

See `TODO-JAVA-IMPLEMENTATION.md` for:
- Proto regeneration steps
- Code update locations
- Testing checklist

## Metrics

**Proto Changes**:
- 3 proto files modified
- 7 generated stub files updated
- 164 lines added, 142 lines removed (net: +22 lines)

**Documentation**:
- 1 design decision created (comprehensive rationale)
- 1 migration summary created (verification guide)
- 2 project files created (untracked)

**Build Time**:
- Proto regeneration: ~8 seconds
- Code compilation: ~1.3 seconds

**Time Spent**:
- Analysis and decision: ~15 minutes
- Implementation: ~10 minutes
- Documentation: ~20 minutes
- Verification: ~5 minutes
- **Total**: ~50 minutes

## Impact Summary

**Immediate**:
- ✅ Architectural consistency achieved
- ✅ Clear spec/status semantics
- ✅ Code compiles successfully

**Short-term** (Next Phases):
- Future WorkflowExecution implementation will use spec.callback_token
- Pattern matches AgentExecution (no learning curve)
- Simpler mental model (one pattern for all)

**Long-term**:
- Enables workflow-to-workflow calling with same pattern
- Reduces cognitive load (consistent everywhere)
- Better documentation alignment

---

**Status**: ✅ Complete (Go OSS)  
**Timeline**: 50 minutes  
**Next**: Phase 4 - Workflow Completion Logic

**Related Documents**:
- Design Decision: `_projects/.../design-decisions/DD01-callback-token-in-spec-not-status.md`
- Migration Summary: `_projects/.../CALLBACK-TOKEN-MIGRATION-SUMMARY.md`
- Java TODO: `_projects/.../TODO-JAVA-IMPLEMENTATION.md`
