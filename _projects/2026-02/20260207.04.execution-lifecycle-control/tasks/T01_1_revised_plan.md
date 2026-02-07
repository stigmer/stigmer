# Task T01: Execution Lifecycle Control - REVISED Implementation Plan

**Created**: 2026-02-07
**Revised**: 2026-02-07 (Aligned with actual implementation + DeepSeek research)
**Status**: PENDING REVIEW

---

## Executive Summary

This revised plan reconciles the **DeepSeek/ChatGPT research recommendations** with what's **actually implemented in Stigmer**. The research identified several critical durability requirements, many of which Stigmer has already addressed. This plan focuses on the remaining gaps.

### What ChatGPT Research Recommended vs What Stigmer Has

| Research Recommendation | Stigmer Status | Gap? |
|------------------------|----------------|------|
| **Continue-As-New for history management** | ✅ **IMPLEMENTED** in `task_builder_do.go` | No |
| **Claim Check for large payloads** | ✅ **IMPLEMENTED** in `pkg/claimcheck/` | No |
| **Search Attributes for visibility** | ✅ **IMPLEMENTED** with auto-setup | No |
| **Wait beyond int32 seconds** | 🔧 **PARTIAL** - executor ready, proto limited | Yes |
| **Signal/Update handling** | ✅ **IMPLEMENTED** in Listen task | No |
| **Signal-With-Start** | ❌ Not implemented | Yes |
| **Event correlation/idempotency** | ❌ Not implemented | Yes |
| **User-facing cancel/retry** | ❌ Internal only (WorkflowRunner) | Yes |
| **EXECUTION_PAUSED phase** | ❌ Missing from enum | Yes |
| **User-facing pause/resume** | ❌ Internal only | Yes |

---

## What's Already Done (ChatGPT Wasn't Aware)

### 1. Continue-As-New ✅ IMPLEMENTED

**Location**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_do.go`

The implementation:
- Uses Temporal's `continueAsNewSuggested` flag (triggers at ~10K events)
- Custom threshold support via `canMaxHistoryLength` metadata
- State preservation via `__continue_as_new_from__` marker
- Task skipping on resume (except tasks marked `NeverSkipCAN`)

**This directly addresses the research's top priority**: "Add Continue-As-New support to the runner"

### 2. Claim Check Pattern ✅ IMPLEMENTED

**Location**: `backend/services/workflow-runner/pkg/claimcheck/`

The implementation:
- Intercepts large activity outputs (> 50KB threshold)
- Stores in Cloudflare R2 (production) or filesystem (local dev)
- Replaces payloads with `ClaimCheckRef` in workflow state
- Auto-retrieves on next activity execution
- Survives Continue-As-New

**This addresses**: "Guardrails for large payloads"

### 3. Search Attributes ✅ IMPLEMENTED

**Location**: `backend/services/workflow-runner/pkg/temporal/searchattributes/`

The implementation:
- Auto-creates `WorkflowExecutionID` search attribute on startup
- Supports all Temporal types (keyword, text, datetime, int, bool)
- Metadata-driven search attribute setting

**This addresses**: "Minimal operator visibility (Search Attributes)"

### 4. Listen Task (Signals/Updates) ✅ IMPLEMENTED

**Location**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_listen.go`

The implementation:
- Supports `signal`, `query`, and `update` types
- `one` mode (wait for any) and `all` mode (wait for all)
- Timeout support
- `acceptIf` condition evaluation

---

## Remaining Gaps (MVP Focus)

Based on the research checklist and actual gaps:

### MVP Priority 1: User-Facing Lifecycle APIs

**What's needed**: Expose internal WorkflowRunner lifecycle operations to users

| Capability | Internal Status | User-Facing Gap |
|------------|-----------------|-----------------|
| Cancel | ✅ `cancelExecution()` in WorkflowRunner | ❌ No user API |
| Retry | ❌ Manual workaround only | ❌ No API |
| Pause | ✅ `pauseExecution()` in WorkflowRunner | ❌ No user API + No PAUSED phase |
| Resume | ✅ `resumeExecution()` in WorkflowRunner | ❌ No user API |

### MVP Priority 2: Wait Task Enhancement

**Current State**: Proto only supports `int32 seconds`
**What Works**: Executor already handles full durations via `model.Duration`
**Gap**: Proto definition limits what users can specify

**Needed**:
1. Expand `WaitTaskConfig` proto to support ISO duration or structured duration
2. Add `until` timestamp support for "wait until date/time"
3. Update converter to handle new formats

### MVP Priority 3: Event Ingestion Patterns (Defer?)

**Research Recommendation**: Signal-With-Start, correlation, idempotency

**Assessment**: This is important for production but may not block MVP. The current `listen` task + external signal delivery works for basic cases.

**Recommendation**: Defer to post-MVP unless a specific use case requires it.

---

## Revised Implementation Plan

### Phase 1: Core Durability APIs (MVP-Critical)

#### T02: Add EXECUTION_PAUSED phase enum

**Files**:
- `apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto`
- `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto` (if applicable)

**Change**:
```protobuf
enum ExecutionPhase {
  // ... existing ...
  EXECUTION_PAUSED = 6;
}
```

**Effort**: Small (1 file change + proto regen)

#### T03: Add lifecycle RPCs to WorkflowExecution command.proto

**Files**:
- `apis/ai/stigmer/agentic/workflowexecution/v1/command.proto`
- `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto`

**New RPCs**:
```protobuf
rpc cancel(CancelWorkflowExecutionInput) returns (WorkflowExecution);
rpc retry(RetryWorkflowExecutionInput) returns (WorkflowExecution);
rpc pause(PauseWorkflowExecutionInput) returns (WorkflowExecution);
rpc resume(ResumeWorkflowExecutionInput) returns (WorkflowExecution);
```

**Effort**: Medium (proto changes + regen)

#### T04: Implement backend handlers

**Files**:
- `services/agentic/internal/handler/workflowexecution/` (Java or Go depending on location)

**Logic**:
| RPC | Handler Logic |
|-----|--------------|
| `cancel` | Validate phase → Call WorkflowRunner.cancelExecution → Update status |
| `retry` | Validate FAILED phase → Copy spec → Create new execution |
| `pause` | Validate IN_PROGRESS → Call WorkflowRunner.pauseExecution → Update to PAUSED |
| `resume` | Validate PAUSED → Call WorkflowRunner.resumeExecution → Update to IN_PROGRESS |

**Effort**: Medium-Large

#### T05: Add CLI commands

**Files** (new):
- `client-apps/cli/cmd/stigmer/root/workflow_cancel.go`
- `client-apps/cli/cmd/stigmer/root/workflow_retry.go`
- `client-apps/cli/cmd/stigmer/root/workflow_pause.go`
- `client-apps/cli/cmd/stigmer/root/workflow_resume.go`

**Effort**: Medium

---

### Phase 2: Wait Task Enhancement

#### T06: Expand WaitTaskConfig proto

**File**: `apis/ai/stigmer/agentic/workflow/v1/tasks/wait.proto`

**Current**:
```protobuf
message WaitTaskConfig {
  int32 seconds = 1;
}
```

**Proposed**:
```protobuf
message WaitTaskConfig {
  oneof wait_type {
    // Wait for a specific duration (backward compatible)
    int32 seconds = 1;
    
    // ISO 8601 duration string (e.g., "PT30M", "P7D", "P1M")
    string duration = 2;
    
    // Wait until a specific timestamp (RFC3339)
    string until = 3;
    
    // Structured duration for clarity
    WaitDuration structured_duration = 4;
  }
}

message WaitDuration {
  int32 days = 1;
  int32 hours = 2;
  int32 minutes = 3;
  int32 seconds = 4;
  int32 milliseconds = 5;
}
```

**Effort**: Small (proto change)

#### T07: Update converter and executor

**Files**:
- `backend/services/workflow-runner/pkg/converter/task_converters.go`
- `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_wait.go`

**Note**: The executor already supports `model.Duration` which includes days, hours, minutes, seconds, milliseconds. The change is primarily in the proto→YAML converter.

**Effort**: Small-Medium

---

### Phase 3: Future Enhancements (Post-MVP)

These are documented for future reference but NOT MVP-blocking:

1. **Signal-With-Start support** - Race-proof event delivery
2. **Event Ingestion Gateway** - Correlation + idempotency infrastructure
3. **Business calendar waits** - Skip weekends/holidays
4. **Retry from specific task** - Resume from a checkpoint
5. **Saga/Compensation DSL** - First-class compensation stack
6. **Worker Versioning UX** - Migration controls

---

## Updated Success Criteria

### MVP (Must Have)
- [ ] `EXECUTION_PAUSED` phase exists in enum
- [ ] Users can cancel executions via API/CLI
- [ ] Users can retry failed executions via API/CLI
- [ ] Users can pause/resume executions via API/CLI
- [ ] Wait task supports durations beyond int32 seconds

### Already Met (No Work Required)
- [x] Continue-As-New prevents history overflow
- [x] Claim Check handles large payloads
- [x] Search Attributes provide visibility
- [x] Signals/Updates work via Listen task

### Post-MVP (Nice to Have)
- [ ] Signal-With-Start for race-proof event delivery
- [ ] Event correlation/idempotency infrastructure
- [ ] Business calendar waits
- [ ] Retry from specific failed task

---

## Revised File Changes Summary

| File | Action | Phase | Priority |
|------|--------|-------|----------|
| `apis/.../workflowexecution/v1/enum.proto` | Add EXECUTION_PAUSED | 1 | MVP |
| `apis/.../workflowexecution/v1/command.proto` | Add cancel/retry/pause/resume RPCs | 1 | MVP |
| `apis/.../workflowexecution/v1/io.proto` | Add input/output messages | 1 | MVP |
| `services/.../workflowexecution/*.java` | Implement handlers | 1 | MVP |
| `client-apps/cli/cmd/stigmer/root/workflow_*.go` | New CLI commands (4 files) | 1 | MVP |
| `apis/.../workflow/v1/tasks/wait.proto` | Expand WaitTaskConfig | 2 | MVP |
| `backend/.../converter/task_converters.go` | Update wait converter | 2 | MVP |

---

## Key Insight: Research Was Right, But We're Ahead

The DeepSeek/ChatGPT research correctly identified the critical durability requirements:

1. **History management (Continue-As-New)** → Already done
2. **Large payload handling (Claim Check)** → Already done
3. **Visibility (Search Attributes)** → Already done
4. **Long-duration waits** → Partially done (executor ready, proto limited)
5. **Lifecycle control** → Not exposed to users (this plan's focus)

The research's value was in validating our architecture and identifying the user-facing API gap. The core durability infrastructure is solid.

---

## Recommended Execution Order

1. **T02**: Add EXECUTION_PAUSED enum (quick win)
2. **T03**: Add lifecycle RPCs (proto design)
3. **T06**: Expand WaitTaskConfig (proto design)
4. **T04**: Implement backend handlers (main work)
5. **T07**: Update wait converter/executor
6. **T05**: Add CLI commands (last, depends on API)

This order groups proto changes together, then backend, then CLI.

---

## Review Questions

1. **Pause/Resume Scope**: Should pause/resume work for both workflows AND agents, or workflows only for MVP?

2. **Wait Enhancement Priority**: Is wait enhancement MVP-critical, or can we ship lifecycle APIs first?

3. **Retry Semantics**: Should retry create a NEW execution ID, or attempt to resume the failed one?

4. **CLI Naming**: `stigmer workflow cancel` vs `stigmer execution cancel`?
