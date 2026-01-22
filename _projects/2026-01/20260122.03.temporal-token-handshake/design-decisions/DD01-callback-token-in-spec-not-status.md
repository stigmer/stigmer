# Design Decision: callback_token in Spec, Not Status

**Date**: 2026-01-22  
**Status**: ✅ IMPLEMENTED  
**Impact**: Breaking Change (proto field moved)

---

## Decision

Move `callback_token` field from `WorkflowExecutionStatus` to `WorkflowExecutionSpec` to maintain consistency across resources and follow Kubernetes spec/status philosophy.

**Applies to**:
- ✅ AgentExecution: `callback_token` already in `AgentExecutionSpec` (field 6)
- ✅ WorkflowExecution: `callback_token` **moved** from Status to Spec (field 7)

---

## Context

### The Inconsistency

Initially, we had:
- **AgentExecution**: `callback_token` in **Spec** (field 6) ✅
- **WorkflowExecution**: `callback_token` in **Status** (field 11) ❌

This inconsistency was identified when considering future workflow-to-workflow calling patterns.

### The Question

> "Where should `callback_token` go: Spec or Status?"

Based on Kubernetes philosophy:
- **Spec** = Desired state / Configuration / Inputs (what you want)
- **Status** = Observed state / Results / Outputs (what happened)

---

## Analysis

### Kubernetes Philosophy

**Key Principle**: The decisive factor is whether a field is an **input** or **output**, not whether it's user-provided or system-generated.

**Examples of System-Set Spec Fields**:
- `pod.spec.nodeName` - Scheduler sets it, but it's in spec because it configures WHERE pod runs
- `pod.spec.serviceAccountName` - Can be defaulted by system, but configures HOW pod authenticates

**Examples of System-Set Status Fields**:
- `pod.status.podIP` - Reports WHAT happened (IP was assigned)
- `pod.status.phase` - Reports WHAT is happening (Pending → Running → Succeeded)

### Is callback_token an Input or Output?

**callback_token characteristics**:
- ✅ Set at creation time (before execution starts)
- ✅ Never changes during execution (immutable)
- ✅ Configures behavior: "when you finish, call back HERE"
- ✅ Input to the execution logic
- ❌ Not a result of execution
- ❌ Doesn't change during lifecycle

**Verdict**: **Input** → Belongs in **Spec**

### Why Not Status?

The original reasoning for putting it in Status was:
1. System-generated (not user-provided)
2. Runtime state
3. Ephemeral
4. Consistent with `temporal_workflow_id`

**Counter-arguments**:
1. **"System-generated" is not decisive**: Kubernetes has system-set spec fields (e.g., `nodeName`)
2. **"Runtime state" is misleading**: The token doesn't change during runtime; it's set at creation
3. **"Ephemeral" is incorrect**: The token is durable (stored in Temporal, survives restarts)
4. **`temporal_workflow_id` comparison is wrong**:
   - `temporal_workflow_id` = "This is my Temporal ID" (observability/correlation)
   - `callback_token` = "When done, call back here" (behavioral instruction)

---

## Decision Rationale

### 1. It's an Instruction, Not a Result

The token tells the execution **HOW to complete** (where to report), not **WHAT the result is**.

**Analogy**: 
- `nodeName` tells a pod "run on this node" (configuration)
- `podIP` reports "you got this IP" (result)
- `callback_token` tells an execution "report completion here" (configuration)

### 2. It's Immutable

- Set at creation
- Never changes during execution
- Status fields typically change (phase, conditions, timestamps)
- Spec fields are stable

### 3. Consistency Across Resources

Both AgentExecution and WorkflowExecution should handle callback patterns identically:
- ✅ `AgentExecution.spec.callback_token`
- ✅ `WorkflowExecution.spec.callback_token`

This enables future workflow-to-workflow calling without confusion.

### 4. Future-Proof Architecture

If WorkflowExecution calls another WorkflowExecution:
- Pattern is identical to AgentExecution
- No special cases
- Clear semantic: "Here's where to report completion"

### 5. Clearer Semantics

**Before**:
- "I'll put the result somewhere in status for you to read" ❌ Confusing

**After**:
- "When you create me, tell me where to report completion" ✅ Clear

---

## Implementation

### Proto Changes

#### Before (WorkflowExecution)

**Status** (api.proto):
```protobuf
message WorkflowExecutionStatus {
  // ... other fields ...
  bytes callback_token = 11;  // ❌ WRONG LOCATION
}
```

**Spec** (spec.proto):
```protobuf
message WorkflowExecutionSpec {
  // ... other fields (no callback_token)
}
```

#### After (WorkflowExecution)

**Status** (api.proto):
```protobuf
message WorkflowExecutionStatus {
  // ... other fields ...
  // callback_token REMOVED ✅
}
```

**Spec** (spec.proto):
```protobuf
message WorkflowExecutionSpec {
  // ... other fields ...
  
  // Temporal async activity completion token (optional).
  // Enables async completion pattern for workflow orchestration.
  bytes callback_token = 7;  // ✅ CORRECT LOCATION
}
```

### Migration Impact

**Proto Field Numbers**:
- **Removed**: WorkflowExecutionStatus.callback_token (field 11)
- **Added**: WorkflowExecutionSpec.callback_token (field 7)

**Code Changes**:
- ✅ Go proto stubs regenerated
- ✅ References updated (AgentExecution.api.proto comment)
- ⏳ Java proto stubs regeneration (pending - TODO-JAVA-IMPLEMENTATION.md)
- ⏳ Any code reading/writing the field (currently none for WorkflowExecution)

**Backward Compatibility**:
- Breaking change for serialized WorkflowExecution protos
- Since WorkflowExecution token handshake not yet implemented, minimal impact
- AgentExecution already had it in spec (no change)

---

## Comparison with temporal_workflow_id

**Why temporal_workflow_id STAYS in Status**:

`temporal_workflow_id` is fundamentally different:
- **Nature**: Identifier assigned BY Temporal (like `pod.status.podIP`)
- **Purpose**: Observability/correlation ("this is my Temporal ID")
- **Semantics**: Metadata ABOUT the execution, not instruction FOR it
- **Analogy**: Like a social security number (you get assigned it), not a mailing address (you use it for behavior)

`callback_token` is:
- **Nature**: Instruction passed TO the execution
- **Purpose**: Behavior control ("call back here when done")
- **Semantics**: Configuration FOR the execution
- **Analogy**: Like a return address on an envelope (tells you where to send the response)

**Both are system-generated, but serve different purposes:**
- `temporal_workflow_id` → "Who am I?" (identity, observability)
- `callback_token` → "Where do I report?" (behavior, configuration)

---

## Benefits

### 1. Philosophical Consistency

Follows Kubernetes spec/status philosophy:
- Spec = Configuration (even if system-set)
- Status = Observation

### 2. Cross-Resource Consistency

Both AgentExecution and WorkflowExecution:
- `spec.callback_token` for async completion
- Same pattern, same location
- No confusion

### 3. Future-Proof

Enables:
- WorkflowExecution calling WorkflowExecution
- Any resource calling any resource
- Clear, consistent pattern

### 4. Clearer Intent

**Code Before**:
```go
// ❌ Confusing: Why is input in status?
execution.GetStatus().GetCallbackToken()
```

**Code After**:
```go
// ✅ Clear: Input in spec
execution.GetSpec().GetCallbackToken()
```

### 5. Better Documentation

Documentation now makes sense:
- Spec docs explain "what you can configure"
- callback_token configures "where to report completion"
- No need to explain "system-generated but in spec because..."

---

## Trade-offs

### What We Lost

**Previous Rationale** (for status):
- "System-generated fields go in status"
- "Consistent with temporal_workflow_id"

**Response**:
- Kubernetes proves system-generated can be in spec (`nodeName`)
- `temporal_workflow_id` serves different purpose (identity vs behavior)

### What We Gained

- **Clarity**: Input/output distinction is clear
- **Consistency**: All resources handle callback tokens identically
- **Simplicity**: No special cases, no exceptions to explain

---

## Lessons Learned

### 1. "System-Generated" Is Not the Deciding Factor

The key question is: **Input or output?**, not **user or system?**

Many Kubernetes spec fields are system-set (`nodeName`, `serviceAccountName`). The philosophy is about **role** (configuration vs observation), not **origin** (user vs system).

### 2. Consistency Beats Convenience

Even though moving the field is a breaking change, it's worth it for:
- Long-term architectural consistency
- Clearer mental model
- Future extensibility

### 3. Identity vs Behavior

Fields that identify "what this is" (like `temporal_workflow_id`) can be in status. Fields that configure "how this behaves" (like `callback_token`) belong in spec.

---

## References

- **Kubernetes Design Philosophy**: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#spec-and-status
- **ADR**: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
- **Java TODO**: TODO-JAVA-IMPLEMENTATION.md
- **Discussion**: Conversation on 2026-01-22 about spec vs status consistency

---

## Decision Record

**Decision**: Move `callback_token` from Status to Spec for WorkflowExecution

**Made by**: Architecture team  
**Date**: 2026-01-22  
**Implemented**: 2026-01-22  

**Status**: ✅ COMPLETE (Go OSS)  
**Pending**: Java cloud implementation (see TODO-JAVA-IMPLEMENTATION.md)

---

**Summary**: `callback_token` belongs in **Spec** because it's an **input** that configures **behavior** (where to report completion), not an **output** that reports **results**. The "system-generated" argument is not decisive - Kubernetes has many system-set spec fields. What matters is whether it's configuration (spec) or observation (status).
