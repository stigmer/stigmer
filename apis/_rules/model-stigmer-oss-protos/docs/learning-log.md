# Proto API Creation - Learning Log

**Purpose**: Chronicles proto API creation evolution, organized by topic.

**Usage**: Add entry after creating proto API or discovering patterns.

---

## API Resource Standards

### 2026-01-22: Spec/Status Separation for System-Generated State

**Pattern**: System-generated runtime state must go in Status message, not Spec or Input messages.

**Context**: While implementing Temporal async activity completion pattern, initially added `callback_token` to `WorkflowExecuteInput` (gRPC input message). This was incorrect because the token is system-generated, not user-provided.

**Correction**: Moved `callback_token` to Status messages:
- `WorkflowExecutionStatus.callback_token` (field 11)
- `AgentExecutionStatus.callback_token` (field 10)

**Proto Structure**:
```protobuf
// ✅ CORRECT: System state in Status
message WorkflowExecutionStatus {
  // ... user-observable fields ...
  
  // System-generated Temporal state
  string temporal_workflow_id = 7;
  bytes callback_token = 11;  // ← System-generated, belongs in Status
}

// ❌ WRONG: System state in Input/Spec
message WorkflowExecuteInput {
  string workflow_execution_id = 1;
  string workflow_yaml = 2;
  bytes callback_token = 3;  // ← WRONG: Not user input!
}
```

**Rationale**:
- **Spec/Input**: User-provided configuration (immutable after creation)
- **Status**: System-managed state (continuously updated during execution)
- `callback_token` is created by Temporal runtime, not user
- Follows precedent: `temporal_workflow_id` already in Status (field 7)

**Impact**: 
- Maintains architectural consistency across all Stigmer API resources
- Clear separation enables retries (same Spec = same execution)
- System state can be updated independently without touching user inputs

**Rule**: When adding fields to proto messages, ask:
- "Is this user-provided or system-generated?"
- "Is this configuration (Spec) or runtime state (Status)?"
- "Can users provide this value, or is it created during execution?"

If system-generated → Status. If user-provided → Spec/Input.

**Related ADR**: `docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`

---

## File Organization Patterns

_Entries will be added as patterns are discovered_

---

## Validation Patterns

_Entries will be added as validation patterns are discovered_

---

## Authorization Configuration

_Entries will be added as authorization patterns are discovered_

---

## Common Mistakes

### 2026-01-22: Adding System State to Input Messages

**Mistake**: Adding system-generated fields (like callback tokens, workflow IDs, execution timestamps) to Input or Spec messages.

**Example**:
```protobuf
// ❌ WRONG
message WorkflowExecuteInput {
  string workflow_execution_id = 1;
  bytes callback_token = 2;  // System-generated, doesn't belong here!
}

// ✅ CORRECT
message WorkflowExecutionStatus {
  string temporal_workflow_id = 7;  // System-generated, belongs in Status
  bytes callback_token = 11;        // System-generated, belongs in Status
}
```

**How to Avoid**:
1. Check existing similar fields (e.g., `temporal_workflow_id` is in Status)
2. Ask: "Does the user provide this value?" (NO = Status)
3. Review Spec/Status separation pattern in resource definition
4. Look for precedent in similar resources

**Detection**: During code review, if a field seems "out of place" in Input/Spec, check if it should be in Status.

---

## Integration Patterns

_Entries will be added as integration patterns are discovered_

---

## Documentation Index

**Topic Docs**: None yet (learning log only at this stage)

**Learning Log**: This file (`learning-log.md`)

**Main Rule**: `../model-stigmer-oss-protos.mdc`

---

**Last Updated**: 2026-01-22  
**Total Entries**: 2 (1 pattern + 1 mistake documented)
