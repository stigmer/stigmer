# Workflow Execution Temporal Integration - Implementation Summary

## Overview

This package implements the Temporal workflow infrastructure for workflow execution in Stigmer OSS. The architecture uses a two-level workflow pattern: a Go/Java outer orchestrator on the `workflow_execution_stigmer` queue and a TS child workflow (`stigmer/workflow/execute-from-execution`) on the `stigmer_runner` queue.

## What Was Implemented

### 1. Configuration (`config.go`)
- Environment-based configuration for the orchestrator task queue
- `StigmerQueue`: Orchestrator workflows (default: `workflow_execution_stigmer`)

### 2. Workflow Types (`workflow_types.go`)
- Workflow type constant: `stigmer/workflow-execution/invoke`
- Used for workflow registration and invocation

### 3. Workflow Implementation
**`workflows/invoke_workflow.go`** (Interface)
- Defines `InvokeWorkflowExecutionWorkflow` interface
- Single method: `Run(ctx, execution)`

**`workflows/invoke_workflow_impl.go`** (Implementation)
- Starts TS child workflow `stigmer/workflow/execute-from-execution` on `stigmer_runner` queue
- Relays pause/resume signals from outer orchestrator to child workflow
- Relays LISTEN/human_input signals to child workflow
- Handles lifecycle status updates via local activities on failure/cancellation

### 4. Workflow Creator (`workflows/workflow_creator.go`)
- Creates and starts Temporal workflows
- Sets workflow ID: `stigmer/workflow-execution/invoke/{execution-id}`
- 30-minute workflow timeout
- Asynchronous execution

### 5. Activity Implementation (`activities/update_status_impl.go`)
- Loads execution from BadgerDB
- Merges status updates (tasks, phase, error, timestamps)
- Updates audit metadata
- Persists to BadgerDB
- Registered as LOCAL activity (in-process)

### 6. Worker Configuration (`worker_config.go`)
- Registers Go workflow on `workflow_execution_stigmer` queue
- Registers LOCAL activity (UpdateWorkflowExecutionStatus)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Temporal Server                          │
├──────────────────────────────┬──────────────────────────────────┤
│ Queue: workflow_execution_   │ Queue: stigmer_runner            │
│        stigmer               │                                  │
└───────────┬──────────────────┴──────────────┬───────────────────┘
            │                                  │
            │ Orchestrator Workflow            │ Child Workflow
            ▼                                  ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│  Orchestrator Worker     │      │  TS Runner                    │
│  (stigmer-server)        │      │  (unified runner)             │
│                          │      │                               │
│  - Lifecycle signals     │      │  - Task-by-task execution     │
│  - Signal relay to child │      │  - Progressive gRPC updates   │
│  - UpdateStatus (LOCAL)  │      │  - Pause at task boundary     │
└──────────────────────────┘      └──────────────────────────────┘
```

## Key Design Decisions

### 1. Two-Level Workflow (Orchestrator + TS Child)
- Outer orchestrator handles lifecycle (signals, status persistence)
- TS child workflow handles actual task execution
- Clean separation of concerns

### 2. Signal-Based Pause/Resume
- Pause signal flows: gRPC → outer orchestrator → child workflow
- Child blocks at the next task boundary via `condition()`
- Completed tasks preserved in Temporal workflow history, not re-executed on resume

### 3. Signal Relay for LISTEN/human_input
- Same forwarding mechanism as pause/resume
- Outer orchestrator acts as signal proxy to the child

### 4. Dual Status Update Paths
- Progressive updates: TS runner → gRPC streaming → stigmer-server
- Lifecycle transitions: Orchestrator → local activities → BadgerDB

### 5. Local Activities for Error Handling
- UpdateStatus runs in-process (no task queue)
- Used for failure, cancellation, pause, and resume status persistence

## Integration Points

### With WorkflowExecutionController
1. Controller persists execution to BadgerDB
2. Controller calls `workflowCreator.Create(execution)`
3. Orchestrator workflow starts asynchronously
4. Orchestrator starts TS child workflow
5. TS child executes tasks and sends progressive updates

### With TS Runner
1. Orchestrator starts child workflow `stigmer/workflow/execute-from-execution` on `stigmer_runner` queue
2. TS runner executes tasks sequentially
3. Runner sends progressive status updates via gRPC
4. Runner responds to pause/resume/input signals

## Files

```
temporal/
├── config.go                              # Configuration
├── workflow_types.go                      # Constants
├── worker_config.go                       # Worker registration
├── README.md                              # Documentation
├── IMPLEMENTATION_SUMMARY.md              # This file
├── workflows/
│   ├── invoke_workflow.go                 # Interface
│   ├── invoke_workflow_impl.go            # Implementation
│   └── workflow_creator.go                # Creator
└── activities/
    ├── update_status.go                   # UpdateStatus interface
    └── update_status_impl.go              # UpdateStatus implementation
```

## References

- **Java Implementation**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/`
- **Agent Execution Pattern**: `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/`
- **TS Runner**: `backend/services/runner/`
- **Temporal Docs**: https://docs.temporal.io/
