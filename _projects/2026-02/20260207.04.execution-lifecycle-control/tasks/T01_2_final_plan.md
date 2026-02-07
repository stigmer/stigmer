# Task T01: Execution Lifecycle Control - FINAL Implementation Plan

**Created**: 2026-02-07  
**Revised**: 2026-02-07 (Research-validated + Architecture cleanup)  
**Status**: APPROVED FOR EXECUTION

---

## Executive Summary

This plan delivers **user-facing lifecycle control** for workflow executions, validated by DeepSeek/ChatGPT research. It includes architectural cleanup to simplify the control plane.

### MVP Scope (Research-Validated: Option C)

| Feature | Domain Term | Description |
|---------|-------------|-------------|
| **Graceful Stop** | `cancel` | Stop a running execution gracefully (cleanup allowed) |
| **Hard Stop** | `terminate` | Force stop immediately (no cleanup) |
| **Recover from Failure** | `recover` | Continue from last checkpoint after failure (Temporal Reset) |
| **Enhanced Wait** | `wait` | Support ISO durations + "until" timestamp |

### Deferred (Post-MVP)

| Feature | Rationale |
|---------|-----------|
| `pause` / `resume` | "Nice but not baseline across engines" per research |
| Event ingestion gateway | Important but not blocking durability claim |
| Signal-With-Start | Can be added later |

---

## Part 1: Architecture Cleanup (Remove WorkflowRunner gRPC Interface)

### The Problem

Currently there are **two control planes**:
1. **WorkflowRunner gRPC** (`interface.proto`) - Exposes `cancelExecution`, `pauseExecution`, `resumeExecution`
2. **Stigmer Service** (`WorkflowExecutionCommandController`) - User-facing API

This is redundant. WorkflowRunner is just a Temporal worker - it shouldn't expose lifecycle control.

### The Solution

**Remove the WorkflowRunner gRPC interface entirely.** Lifecycle control happens at Stigmer service level via direct Temporal API calls.

```
BEFORE (Dual Control Plane - Confusing):
┌─────────────────┐     ┌───────────────────┐     ┌─────────────┐
│   User / CLI    │────▶│  Stigmer Service  │────▶│ WorkflowRunner │
│                 │     │  (gRPC gateway)   │     │  (gRPC server)  │
└─────────────────┘     └───────────────────┘     └───────┬─────────┘
                                                          │
                                                          ▼
                                                    ┌─────────────┐
                                                    │  Temporal   │
                                                    └─────────────┘

AFTER (Single Control Plane - Clean):
┌─────────────────┐     ┌───────────────────┐     ┌─────────────┐
│   User / CLI    │────▶│  Stigmer Service  │────▶│  Temporal   │
│                 │     │  (direct control) │     │             │
└─────────────────┘     └───────────────────┘     └─────────────┘
                                                          │
                                                          ▼
                                                    ┌─────────────────┐
                                                    │ WorkflowRunner  │
                                                    │ (Temporal Worker│
                                                    │  - executes only)│
                                                    └─────────────────┘
```

### Files to Delete

| File | Type | Reason |
|------|------|--------|
| `apis/ai/stigmer/agentic/workflowrunner/v1/interface.proto` | Proto | Service interface not needed |
| `apis/ai/stigmer/agentic/workflowrunner/v1/io.proto` | Proto | Messages move to workflowexecution |
| `apis/stubs/go/ai/stigmer/agentic/workflowrunner/v1/interface.pb.go` | Generated | Proto deleted |
| `apis/stubs/go/ai/stigmer/agentic/workflowrunner/v1/interface_grpc.pb.go` | Generated | Proto deleted |
| `apis/stubs/go/ai/stigmer/agentic/workflowrunner/v1/io.pb.go` | Generated | Proto deleted |
| `apis/stubs/python/stigmer/.../interface_pb2.py` | Generated | Proto deleted |
| `apis/stubs/python/stigmer/.../interface_pb2_grpc.py` | Generated | Proto deleted |
| `backend/services/workflow-runner/pkg/grpc/server.go` | Go | gRPC server not needed |
| `backend/services/workflow-runner/pkg/grpc/` | Directory | Remove entirely |

### Files to Update

| File | Change |
|------|--------|
| `backend/services/workflow-runner/main.go` | Remove gRPC server startup |
| `backend/services/workflow-runner/worker/worker.go` | Remove gRPC references if any |

---

## Part 2: Domain Model (Ubiquitous Language)

### Execution Lifecycle Operations

| Domain Operation | From State | To State | Temporal Equivalent | Meaning |
|-----------------|------------|----------|---------------------|---------|
| **cancel** | IN_PROGRESS | CANCELLED | `workflow cancel` | "I don't need this, clean up gracefully" |
| **terminate** | Any running | TERMINATED | `workflow terminate` | "Kill it now, something is stuck" |
| **recover** | FAILED | IN_PROGRESS | `workflow reset` | "Fix issue and continue from checkpoint" |

### New Phase Enum Values

```protobuf
enum ExecutionPhase {
  EXECUTION_PHASE_UNSPECIFIED = 0;
  EXECUTION_PENDING = 1;
  EXECUTION_IN_PROGRESS = 2;
  EXECUTION_COMPLETED = 3;
  EXECUTION_FAILED = 4;
  EXECUTION_CANCELLED = 5;
  EXECUTION_TERMINATED = 6;  // NEW: Force-stopped by operator
}
```

**Note**: We're NOT adding `EXECUTION_PAUSED` in MVP (deferred per research).

### Why These Names?

| Term | Why NOT "retry" | Why NOT "reset" |
|------|-----------------|-----------------|
| `recover` | "Retry" is ambiguous (full restart vs checkpoint resume) | "Reset" is Temporal jargon, not business language |
| `terminate` | Clear distinction from `cancel` (hard vs graceful) | Matches Temporal terminology |

---

## Part 3: Implementation Tasks

### Task 0: WorkflowRunner Cleanup (FIRST)

**Goal**: Remove the dual control plane

**Subtasks**:
1. Delete `apis/ai/stigmer/agentic/workflowrunner/v1/` directory entirely
2. Delete generated stubs in `apis/stubs/go/` and `apis/stubs/python/`
3. Delete `backend/services/workflow-runner/pkg/grpc/` directory
4. Update `main.go` to remove gRPC server startup
5. Run `buf generate` to regenerate stubs
6. Run `bazel run //:gazelle` to fix BUILD files
7. Verify build passes

**Effort**: Small (deletion + cleanup)

---

### Task 1: Add EXECUTION_TERMINATED phase enum

**File**: `apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto`

```protobuf
enum ExecutionPhase {
  // ... existing phases 0-5 ...
  
  // Execution was force-stopped by an operator.
  //
  // Unlike CANCELLED (graceful), TERMINATED means immediate halt
  // without cleanup. Used for stuck or unresponsive workflows.
  //
  // Terminal state: cannot be resumed or recovered.
  EXECUTION_TERMINATED = 6;
}
```

**Effort**: Small

---

### Task 2: Add lifecycle RPCs to WorkflowExecutionCommandController

**File**: `apis/ai/stigmer/agentic/workflowexecution/v1/command.proto`

```protobuf
service WorkflowExecutionCommandController {
  // ... existing RPCs ...
  
  // Cancel a running workflow execution gracefully.
  //
  // Sends cancellation signal to Temporal. Workflow code can handle cleanup.
  // Execution transitions to CANCELLED phase.
  //
  // Idempotent: Cancelling already-cancelled execution succeeds (no-op).
  rpc cancel(CancelWorkflowExecutionInput) returns (WorkflowExecution);
  
  // Terminate a workflow execution immediately.
  //
  // Force-stops execution without cleanup. Use for stuck workflows.
  // Execution transitions to TERMINATED phase.
  //
  // Idempotent: Terminating already-terminated execution succeeds (no-op).
  rpc terminate(TerminateWorkflowExecutionInput) returns (WorkflowExecution);
  
  // Recover a failed workflow execution from last checkpoint.
  //
  // Uses Temporal Reset to continue from the last successful point.
  // Preserves completed work - does NOT re-execute successful steps.
  //
  // Requires: Execution must be in FAILED phase.
  // Creates: New Temporal run, same workflow ID chain.
  rpc recover(RecoverWorkflowExecutionInput) returns (WorkflowExecution);
}
```

**Effort**: Medium

---

### Task 3: Add IO messages

**File**: `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto`

```protobuf
// CancelWorkflowExecutionInput requests graceful cancellation.
message CancelWorkflowExecutionInput {
  // Workflow execution ID to cancel.
  // Format: 'wfx-{ulid}'
  string id = 1 [(buf.validate.field).required = true];
  
  // Human-readable reason for cancellation (for audit trail).
  string reason = 2;
}

// TerminateWorkflowExecutionInput requests immediate termination.
message TerminateWorkflowExecutionInput {
  // Workflow execution ID to terminate.
  string id = 1 [(buf.validate.field).required = true];
  
  // Human-readable reason for termination (for audit trail).
  string reason = 2;
}

// RecoverWorkflowExecutionInput requests recovery from failure.
message RecoverWorkflowExecutionInput {
  // Workflow execution ID to recover.
  // Must be in FAILED phase.
  string id = 1 [(buf.validate.field).required = true];
  
  // Human-readable reason for recovery (for audit trail).
  string reason = 2;
  
  // Optional: Override environment variables for the recovered run.
  // If empty, uses original execution's environment.
  map<string, string> env_overrides = 3;
}
```

**Effort**: Small

---

### Task 4: Implement backend handlers (Java/Kotlin)

**Location**: `stigmer-cloud/backend/services/stigmer-service/`

**Handler Logic**:

| RPC | Implementation |
|-----|----------------|
| `cancel` | 1. Validate execution is cancellable (IN_PROGRESS) |
|          | 2. Call Temporal `CancelWorkflow(workflowId)` |
|          | 3. Update phase to CANCELLED |
|          | 4. Return updated WorkflowExecution |
| `terminate` | 1. Call Temporal `TerminateWorkflow(workflowId, reason)` |
|             | 2. Update phase to TERMINATED |
|             | 3. Return updated WorkflowExecution |
| `recover` | 1. Validate execution is FAILED |
|           | 2. Call Temporal `ResetWorkflow(workflowId, eventId)` |
|           | 3. Update phase to IN_PROGRESS |
|           | 4. Return updated WorkflowExecution |

**Effort**: Medium-Large

---

### Task 5: Add CLI commands

**New files**:
- `client-apps/cli/cmd/stigmer/root/workflow_cancel.go`
- `client-apps/cli/cmd/stigmer/root/workflow_terminate.go`
- `client-apps/cli/cmd/stigmer/root/workflow_recover.go`

**Commands**:
```bash
# Cancel a running workflow gracefully
stigmer workflow cancel <execution-id> [--reason "..."]

# Terminate a workflow immediately (hard stop)
stigmer workflow terminate <execution-id> [--reason "..."]

# Recover a failed workflow from last checkpoint
stigmer workflow recover <execution-id> [--reason "..."]
```

**Effort**: Medium

---

### Task 6: Enhance WaitTaskConfig proto

**File**: `apis/ai/stigmer/agentic/workflow/v1/tasks/wait.proto`

**Current** (limited):
```protobuf
message WaitTaskConfig {
  int32 seconds = 1;
}
```

**Proposed** (expanded):
```protobuf
message WaitTaskConfig {
  oneof wait_spec {
    // Wait for a duration in seconds (backward compatible).
    int32 seconds = 1;
    
    // Wait for an ISO 8601 duration (e.g., "PT30M", "P7D", "P1M2D").
    string duration = 2;
    
    // Wait until a specific timestamp (RFC3339 format).
    // Example: "2026-03-15T09:00:00-05:00"
    string until = 3;
  }
}
```

**Effort**: Small

---

### Task 7: Update wait converter and documentation

**Files**:
- `backend/services/workflow-runner/pkg/converter/task_converters.go`
- Update SDK documentation

**Note**: The executor (`task_builder_wait.go`) already supports `model.Duration` which handles days/hours/minutes. The change is primarily at the proto and converter level.

**Effort**: Small

---

## Part 4: Execution Order

```
Phase 0: Cleanup (Prerequisite)
├── T0: Remove WorkflowRunner gRPC interface

Phase 1: Proto Changes (Do together, regenerate once)
├── T1: Add EXECUTION_TERMINATED enum
├── T2: Add cancel/terminate/recover RPCs
├── T3: Add IO messages
└── T6: Expand WaitTaskConfig

Phase 2: Backend Implementation
├── T4: Implement handlers in Stigmer service

Phase 3: CLI
├── T5: Add CLI commands

Phase 4: Wait Enhancement
└── T7: Update converter
```

---

## Part 5: What We Can Now Claim on Landing Page

After MVP:

✅ **Can claim honestly**:
- "Workflows that retry and resume" (via `recover` = Temporal Reset)
- "Cancel stuck workflows" (via `cancel` and `terminate`)
- "Long-running workflows (weeks/months)" (enhanced `wait` + existing Continue-As-New)
- "Durable execution powered by Temporal"

⚠️ **Should qualify**:
- Event ingestion story if correlation/idempotency not complete
- Pause/resume is deferred

---

## Part 6: Success Criteria

### MVP Complete When:
- [ ] WorkflowRunner gRPC interface removed (cleanup done)
- [ ] Users can `cancel` running executions via API/CLI
- [ ] Users can `terminate` stuck executions via API/CLI
- [ ] Users can `recover` failed executions via API/CLI
- [ ] Wait task supports ISO durations + "until" timestamps
- [ ] `EXECUTION_TERMINATED` phase exists

### Already Done (No Work Required):
- [x] Continue-As-New (history management)
- [x] Claim Check (large payload handling)
- [x] Search Attributes (visibility)
- [x] Signal/Update handling (Listen task)

---

## Part 7: Files Summary

### To Delete (Cleanup)
| Path | Type |
|------|------|
| `apis/ai/stigmer/agentic/workflowrunner/v1/` | Directory |
| `apis/stubs/go/ai/stigmer/agentic/workflowrunner/v1/` | Directory |
| `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowrunner/v1/` | Directory |
| `backend/services/workflow-runner/pkg/grpc/` | Directory |

### To Modify
| Path | Change |
|------|--------|
| `apis/.../workflowexecution/v1/enum.proto` | Add EXECUTION_TERMINATED |
| `apis/.../workflowexecution/v1/command.proto` | Add cancel/terminate/recover RPCs |
| `apis/.../workflowexecution/v1/io.proto` | Add input messages |
| `apis/.../workflow/v1/tasks/wait.proto` | Expand WaitTaskConfig |
| `backend/.../converter/task_converters.go` | Update wait converter |

### To Create
| Path | Purpose |
|------|---------|
| `client-apps/cli/cmd/stigmer/root/workflow_cancel.go` | CLI command |
| `client-apps/cli/cmd/stigmer/root/workflow_terminate.go` | CLI command |
| `client-apps/cli/cmd/stigmer/root/workflow_recover.go` | CLI command |

---

## Appendix: Research References

- **ChatGPT Report 07**: Recommended Option C (Minimal Viable Both)
- **Key Quote**: "If your landing page will continue to say 'retry and resume', then Option B is not enough"
- **Competitor Analysis**: All platforms (Temporal, AWS Step Functions, Cadence, Conductor) expose cancel/terminate/reset as baseline
- **Temporal Docs**: `workflow cancel`, `workflow terminate`, `workflow reset` are core operations
