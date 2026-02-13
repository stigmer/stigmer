---
name: T1 EXECUTION_TERMINATED Enum
overview: Add EXECUTION_TERMINATED = 6 to the workflowexecution ExecutionPhase enum with comprehensive documentation, regenerate stubs, and verify the build passes.
todos:
  - id: edit-enum-proto
    content: Add EXECUTION_TERMINATED = 6 with comprehensive documentation to enum.proto
    status: completed
  - id: update-header-docs
    content: Update phase transition diagram and terminal states list in enum header comment
    status: completed
  - id: regenerate-stubs
    content: Run `cd apis && make build` to regenerate Go and Python stubs
    status: completed
  - id: verify-build
    content: Run `bazel build //apis/stubs/...` to verify compilation
    status: completed
isProject: false
---

# T1: Add EXECUTION_TERMINATED Enum

## Objective

Add a new terminal state `EXECUTION_TERMINATED = 6` to the workflow execution lifecycle to represent force-stopped executions. This is the foundation for the `terminate` RPC (T2) and backend implementation (T4).

## Semantic Distinction

The enum documents a critical semantic difference:

- **CANCELLED** (graceful): User requested stop, workflow code can handle cleanup, Temporal `CancelWorkflow`
- **TERMINATED** (hard stop): Force kill immediately, no cleanup opportunity, Temporal `TerminateWorkflow`

This distinction matters for:

- Audit trails (was this a controlled stop or emergency kill?)
- Debugging (terminated workflows may have incomplete state)
- Recovery (terminated executions cannot be recovered)

## File to Modify

[apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto](apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto)

## Changes

### 1. Update Phase Transition Diagram (lines 25-30)

Add termination flow to the existing documentation:

```
// Termination flow:
// Any running state → EXECUTION_TERMINATED
```

### 2. Update Terminal States List (lines 27-30)

Add TERMINATED to the terminal states enumeration in the header comment.

### 3. Add EXECUTION_TERMINATED Enum Value

Insert after `EXECUTION_CANCELLED = 5` (line 128), matching the existing documentation depth and style:

```protobuf
// Execution was force-stopped immediately.
//
// Unlike CANCELLED (graceful stop with cleanup opportunity), TERMINATED
// means the workflow was killed immediately without giving workflow code
// a chance to clean up. This is used for stuck or unresponsive workflows.
//
// Terminal state - execution will not change phases again.
//
// When this phase is reached:
// - completed_at timestamp is set
// - error field may contain termination reason
// - In-progress tasks are stopped abruptly
// - No cleanup callbacks are executed
//
// Use Cases:
// - Force-stop stuck workflows that don't respond to cancellation
// - Emergency stop for workflows consuming excessive resources
// - Kill workflows with infinite loops or deadlocks
//
// Terminated vs Cancelled:
// - Terminated: Immediate kill, no cleanup, use when workflow is unresponsive
// - Cancelled: Graceful stop, cleanup allowed, use when you want controlled shutdown
//
// Recovery:
// - Terminated executions CANNOT be recovered (unlike FAILED)
// - Use terminate only when cancel doesn't work
EXECUTION_TERMINATED = 6;
```

## Build and Verification

After editing the proto file:

```bash
cd apis && make build
```

This command will:

- Lint and format the proto file
- Regenerate Go stubs (`apis/stubs/go/...`)
- Regenerate Python stubs (`apis/stubs/python/...`)
- Run gazelle to update BUILD.bazel files

Then verify with:

```bash
bazel build //apis/stubs/...
```

## Not In Scope (By Design)

The following changes are intentionally deferred to later tasks:

- **CLI display function** (`run_display.go`): Will be updated in T5 when the terminate command is added. Currently no execution can reach TERMINATED state, so no display case is needed yet.
- **Test helpers** (`approval_test_helpers.go`): Same reasoning - will be updated when terminate functionality exists.
- **agentexecution enum**: Deferred per user decision - separate task if needed.

## Quality Checklist

- Documentation matches depth/style of existing enum values (CANCELLED, FAILED, etc.)
- Enum value is 6 (next sequential value after CANCELLED = 5)
- Phase transition diagram updated in header comment
- Terminal states list updated in header comment
- Proto file passes `buf lint`
- Go stubs regenerated successfully
- Python stubs regenerated successfully
- Bazel build passes

