# Spec vs Status Philosophy in Stigmer

**Created**: 2026-01-22  
**Category**: Architecture

## Overview

Stigmer follows Kubernetes spec/status separation philosophy for all execution resources (AgentExecution, WorkflowExecution, etc.). This document explains the philosophy and provides guidelines for deciding where fields belong.

## The Philosophy

**Spec** = Desired State / Configuration / Inputs
- What you want
- How the resource should behave
- Can be user-provided OR system-provided
- Generally immutable (or changes trigger new versions)

**Status** = Observed State / Results / Outputs
- What actually exists
- What happened during execution
- Always system-generated
- Changes over time during resource lifecycle

## The Key Question

When adding a new field, ask: **"Is this an input or an output?"**

- **Input** (configures behavior) → **Spec**
- **Output** (reports results) → **Status**

The **origin** (user vs system) is **not** the deciding factor.

## Examples from Kubernetes

### System-Set Fields in SPEC

**`pod.spec.nodeName`**:
- User doesn't set it (scheduler does)
- But it's in SPEC because it configures WHERE pod runs
- It's an instruction: "run on this node"

**`pod.spec.serviceAccountName`**:
- Can be defaulted by system
- In spec because it configures HOW pod authenticates

### System-Set Fields in STATUS

**`pod.status.podIP`**:
- System-assigned during execution
- Reports WHAT happened (IP was assigned)
- Changes during lifecycle

**`pod.status.phase`**:
- Reports current state (Pending → Running → Succeeded)
- WHAT is happening now

## Stigmer Examples

### callback_token (Our Case Study)

**Question**: Should `callback_token` be in Spec or Status?

**Analysis**:
- Set at creation time (before execution starts) ✓
- Never changes (immutable) ✓
- Configures behavior: "when you finish, call back HERE" ✓
- Input to the execution logic ✓
- Not a result of execution ✗
- Doesn't change during lifecycle ✗

**Answer**: **Spec**

**Rationale**:
- It's an instruction, not a result
- It controls HOW the execution completes
- Like `nodeName` controls WHERE pod runs
- callback_token controls WHERE completion is reported

**Implementation**:
- `AgentExecution.spec.callback_token` ✅
- `WorkflowExecution.spec.callback_token` ✅

### temporal_workflow_id (Comparison)

**Question**: Should `temporal_workflow_id` be in Spec or Status?

**Analysis**:
- Assigned by Temporal during workflow start
- For observability/correlation
- Doesn't control behavior
- Metadata ABOUT the execution

**Answer**: **Status**

**Rationale**:
- It's an identifier assigned BY the system (like `podIP`)
- It's for observability, not behavior control
- It reports "this is my Temporal ID" (informational)
- Unlike callback_token which says "call back here" (behavioral)

**Implementation**:
- `WorkflowExecutionStatus.temporal_workflow_id` ✅

## Decision Framework

When adding a new field:

### Step 1: Classify the Field

Ask these questions:

1. **When is it set?**
   - Before execution starts → Likely Spec
   - During/after execution → Likely Status

2. **Does it change?**
   - Immutable → Likely Spec
   - Changes during lifecycle → Definitely Status

3. **What does it do?**
   - Configures behavior → Spec
   - Reports results/state → Status

4. **What's its purpose?**
   - Instruction ("do this", "use that") → Spec
   - Observation ("this happened", "current state is") → Status

### Step 2: Apply the Test

**The Input/Output Test**:
```
if field_controls_how_resource_behaves:
    location = SPEC
elif field_reports_what_happened_or_current_state:
    location = STATUS
else:
    # Metadata case
    location = METADATA  # uid, timestamps, version, etc.
```

**The Immutability Test**:
```
if field_never_changes_after_creation:
    if field_is_configuration:
        location = SPEC
    elif field_is_identity:
        location = METADATA
elif field_changes_during_lifecycle:
    location = STATUS
```

**The Purpose Test**:
```
if field_purpose == "instruction":
    location = SPEC
elif field_purpose == "observation":
    location = STATUS
elif field_purpose == "identity":
    location = METADATA
```

### Step 3: Don't Be Fooled By Origin

**Common Mistake**: "System-generated → must be Status"

**Counter-examples**:
- `pod.spec.nodeName` - System-generated, but in Spec
- `pod.spec.serviceAccountName` - Often defaulted, but in Spec

**Correct Logic**: Origin (user vs system) doesn't determine placement. **Purpose** does.

## Common Patterns in Stigmer

### Spec Fields (Configuration/Inputs)

**User-provided inputs**:
- `agent_id`, `session_id`, `message` (AgentExecution)
- `workflow_instance_id`, `trigger_message` (WorkflowExecution)

**System-provided configuration**:
- `callback_token` - Configures where to report completion
- Future: `priority`, `retry_policy` (if system-set)

**Pattern**: If it configures HOW the execution behaves, it's Spec.

### Status Fields (Results/Outputs)

**Execution results**:
- `messages[]`, `tool_calls[]` (AgentExecution)
- `tasks[]`, `output` (WorkflowExecution)

**State tracking**:
- `phase` - Current lifecycle state
- `error` - Failure reason
- `started_at`, `completed_at` - Timestamps

**System identifiers**:
- `temporal_workflow_id` - Correlation ID

**Pattern**: If it reports WHAT happened or WHAT is happening, it's Status.

## Real-World Application

### Example 1: Adding a "retry_policy" Field

**Question**: Where does `retry_policy` belong?

**Analysis**:
```
Purpose: Configures how failures are retried
When set: At creation or during update
Changes: No (configuration)
Controls behavior: Yes
```

**Answer**: **Spec**

### Example 2: Adding a "retry_count" Field

**Question**: Where does `retry_count` belong?

**Analysis**:
```
Purpose: Reports how many retries occurred
When set: During execution
Changes: Yes (increments with each retry)
Controls behavior: No
```

**Answer**: **Status**

### Example 3: Adding a "correlation_id" Field

**Question**: Where does `correlation_id` belong?

**Analysis**:
```
Purpose: Identity/tracing (observability)
When set: At creation
Changes: No
Controls behavior: No (just for correlation)
```

**Answer**: Could be **Metadata** or **Status** depending on use case
- If for external correlation (user-provided): **Spec**
- If system-assigned for internal tracing: **Status**

## Benefits of This Philosophy

### 1. Predictable API Design

Contributors can predict where fields belong:
- Configuration → Spec
- Observation → Status
- Identity → Metadata

### 2. Consistent Across Resources

All execution resources follow same pattern:
- ✅ `AgentExecution.spec.callback_token`
- ✅ `WorkflowExecution.spec.callback_token`
- Future: Any execution resource

### 3. Clearer Code Intent

```go
// ✅ Clear intent
execution.GetSpec().GetCallbackToken()    // Configuration
execution.GetStatus().GetPhase()          // Observation

// ❌ Confusing
execution.GetStatus().GetCallbackToken()  // Why is config in status?
```

### 4. Better Documentation

Documentation aligns with field placement:
- Spec docs → "What you can configure"
- Status docs → "What the system reports"
- No anomalies to explain

## When You're Unsure

If you're debating Spec vs Status:

1. **Read the field's documentation** - Does it describe configuration or observation?
2. **Check if it changes** - Immutable configuration → Spec, Dynamic state → Status
3. **Ask "input or output?"** - Input → Spec, Output → Status
4. **Look for Kubernetes equivalent** - Find similar field in K8s
5. **When in doubt, choose Spec** - Easier to move to Status later than vice versa

## References

- **Kubernetes API Conventions**: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#spec-and-status
- **Design Decision**: Project-specific application in `_projects/2026-01/20260122.03.temporal-token-handshake/design-decisions/DD01-callback-token-in-spec-not-status.md`
- **ADR**: `docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`

---

**Remember**: The key is **purpose** (input vs output), not **origin** (user vs system).

If it configures how the resource behaves → **Spec**  
If it reports what happened → **Status**  
If it identifies the resource → **Metadata**
