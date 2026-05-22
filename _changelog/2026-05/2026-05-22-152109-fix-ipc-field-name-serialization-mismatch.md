# Fix IPC Field Name Serialization Mismatch Between Tauri and Runner

**Date**: May 22, 2026

## Summary

Fixed a serde `rename_all` scoping bug in the Tauri desktop app's IPC layer that caused all Rust-to-Node field names to be serialized in snake_case instead of camelCase. This caused the runner to receive `undefined` for all IPC command parameters, resulting in workers being created on wrong task queues (e.g. `wfexec:undefined` instead of `wfexec:{executionId}`).

## Problem Statement

After launching a workflow execution from the desktop app, the child workflow was stuck indefinitely with zero pollers on its `wfexec:{id}` task queue.

### Pain Points

- Workflow executions triggered from the desktop app never made progress
- The runner created workers on `wfexec:undefined` instead of the correct `wfexec:{executionId}` queue
- The Temporal UI showed "No Workers Running" on the child workflow's task queue
- The same bug silently affected session worker creation (`session:undefined`) and all IPC response parsing

## Solution

Added `#[serde(rename_all = "camelCase")]` to each struct variant in the `IpcCommand` and `IpcResponse` enums in `runner.rs`.

## Implementation Details

In Rust's serde, `#[serde(rename_all = "camelCase")]` on an enum only renames **variant names** (used as the tag value), not field names within struct variants. The enum-level attribute converted `AddWorkflowExecution` to `"addWorkflowExecution"` for the `type` tag, but left `execution_id` as-is in the JSON payload.

The TypeScript IPC handler (`main.ts`) reads `cmd.executionId` (camelCase), so it received `undefined` when the JSON key was `execution_id` (snake_case).

The fix adds variant-level `#[serde(rename_all = "camelCase")]` to each struct variant, which instructs serde to rename fields within that variant. This produces `executionId`, `sessionId`, and `taskQueue` in the serialized JSON, matching the TypeScript expectations.

### Variants fixed

| Enum | Variant | Fields affected |
|------|---------|----------------|
| `IpcCommand` (Serialize) | `AddSession` | `session_id` -> `sessionId` |
| `IpcCommand` (Serialize) | `RemoveSession` | `session_id` -> `sessionId` |
| `IpcCommand` (Serialize) | `AddWorkflowExecution` | `execution_id` -> `executionId` |
| `IpcCommand` (Serialize) | `RemoveWorkflowExecution` | `execution_id` -> `executionId` |
| `IpcResponse` (Deserialize) | `SessionAdded` | `session_id`, `task_queue` |
| `IpcResponse` (Deserialize) | `SessionRemoved` | `session_id` |
| `IpcResponse` (Deserialize) | `WorkflowExecutionAdded` | `execution_id`, `task_queue` |
| `IpcResponse` (Deserialize) | `WorkflowExecutionRemoved` | `execution_id` |

Unit variants (`Ready`, `Shutdown`, `ShutdownComplete`) and `Error` (whose fields `message`/`fatal` are single-word and unaffected by camelCase) were left unchanged.

## Benefits

- Workflow executions triggered from the desktop app now have workers polling the correct queue
- Session worker creation via IPC now sends the correct `sessionId` field
- IPC response parsing on the Rust side now correctly deserializes Node responses (previously silently failing)

## Impact

- **Desktop app**: All IPC commands between Tauri and the Node runner now serialize field names correctly
- **Workflow executions**: Workers register on `wfexec:{executionId}` instead of `wfexec:undefined`
- **Sessions**: Workers register on `session:{sessionId}` instead of `session:undefined`

## Related Work

- Workflow Execution Worker Recovery and Per-Execution Routing Integration Tests (May 22, 2026)
- Per-execution workflow queue routing (May 22, 2026)
- Desktop embedded runner execution target routing (May 20, 2026)

---

**Status**: ✅ Production Ready
