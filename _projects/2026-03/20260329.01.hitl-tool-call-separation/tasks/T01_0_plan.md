# Task T01: HITL Atomic Approval & DB-Driven Resume

**Created**: 2026-03-29
**Status**: PENDING REVIEW

## Problem Statement

The current HITL approval flow has two structural issues:

1. **Concurrent approval race**: `SubmitApproval` does read-modify-write on the entire `AgentExecution` document (`replaceOne` in Java/MongoDB, `INSERT OR REPLACE` in Go/SQLite). Two concurrent approvals can overwrite each other — the second write replaces the full document, erasing the first's `approval_action`.

2. **Signal-counted resume**: The Go/Java Temporal workflow determines `signalsNeeded` from a Python-built snapshot. It counts individual Temporal signals and passes each approval decision as a signal payload. Python receives decisions as Temporal activity arguments, not from the DB. This creates fragile coordination — orphaned tool calls inflate the count, and the decision source of truth is split between Temporal args and the DB.

3. **No concurrent approval during streaming**: With parallel sub-agents, sub-agent 1 may need approval while sub-agents 2, 3, 4 are still running. Today the phase gate blocks approvals until ALL sub-agents finish streaming. The user must wait unnecessarily.

## Design

### Principle: Field Ownership

The core fix is strict field ownership — each field in the `AgentExecution` document has exactly one writer:

| Field | Owner | Written by |
|-------|-------|------------|
| `tool_call.status` | Python (StatusBuilder) | `update_status` |
| `tool_call.args` | Python (StatusBuilder) | `update_status` |
| `tool_call.result` | Python (StatusBuilder) | `update_status` |
| `tool_call.approval_action` | User (via server) | `SubmitApproval` only |
| `tool_call.approval_decided_at` | User (via server) | `SubmitApproval` only |
| `messages`, `sub_agent_executions` (structure) | Python (StatusBuilder) | `update_status` |
| `phase`, `metadata` | Workflow/Server | Various |

**Rule**: `update_status` NEVER writes `approval_action` or `approval_decided_at`. When merging incoming status from Python, it preserves whatever approval fields are already in the DB. `SubmitApproval` is the sole writer of approval fields.

### Change 1: Atomic SubmitApproval

Replace the current read-modify-write-replaceOne pattern with atomic `$set` using MongoDB array filters (Java) or equivalent (Go/SQLite).

**Current (Java)**:
```java
AgentExecution existing = repository.findById(id);       // read
AgentExecution updated = clone(existing);                 // copy
setApprovalOnToolCall(updated, toolCallId, action);       // modify
repository.save(updated);                                 // replaceOne (full doc)
```

**New (Java)**:
```java
collection.updateOne(
    Filters.eq("metadata.id", executionId),
    Updates.combine(
        Updates.set("<path-to-tool-call>.approval_action", action),
        Updates.set("<path-to-tool-call>.approval_decided_at", now)
    ),
    new UpdateOptions().arrayFilters(...)
);
```

Two concurrent approvals (tc_1 and tc_2) update different tool calls atomically. No conflict.

**Go/SQLite**: SQLite doesn't support sub-document updates. Use `BEGIN EXCLUSIVE TRANSACTION` around the read-modify-write to prevent concurrent overwrites. The OSS deployment is single-process, so this is sufficient.

### Change 2: update_status Preserves Approval Fields

In the `update_status` handler's merge logic (`BuildNewStateWithStatusStep` in Go, equivalent in Java), when merging incoming tool call data from Python:

- If the existing tool call in the DB has `approval_action != UNSPECIFIED`, preserve it — do not overwrite with Python's data (which always sends `UNSPECIFIED` for approval fields).
- Same for `approval_decided_at`.

This ensures `update_status` can run concurrently with `SubmitApproval` during streaming without erasing approval decisions. Even with `replaceOne`, the merged document retains the approval data from the DB.

**Optionally**: Convert `update_status` to use `$set` at the top-level status fields instead of `replaceOne`. This is a hygiene improvement — `update_status` only touches `status.*` fields, never `metadata` or `spec`. Not strictly required if the merge logic preserves approval fields, but cleaner.

### Change 3: DB-Driven Resume (Remove Signal Counting)

Replace the signal-counting pattern with a single DB-driven "all-approved" signal.

**Current flow**:
1. Python returns `WAITING_FOR_APPROVAL` with a `pending_approvals` snapshot
2. Go workflow reads `signalsNeeded` from the snapshot count
3. Workflow loops: `waitForApprovalSignal()` × N, collecting each signal's decision payload
4. Workflow invokes Python activity with all decisions as arguments
5. Python builds `decisions_by_tc` from the Temporal args

**New flow**:
1. Python returns `WAITING_FOR_APPROVAL` (no snapshot needed for signal counting)
2. Go workflow enters an approval-wait state (waits for a single "all-approved" signal)
3. User approves tc_1 → `SubmitApproval` atomically updates tc_1, checks DB: "any WAITING_APPROVAL tool calls without approval_action?" → yes → no signal
4. User approves tc_2 → `SubmitApproval` atomically updates tc_2, checks DB → none remaining → sends ONE Temporal signal
5. Workflow receives signal, invokes Python activity (no decision args needed)
6. Python loads the execution from DB, extracts approval decisions from tool calls' `approval_action` fields

**Key benefits**:
- No signal counting — workflow waits for exactly one signal
- No decision payloads in Temporal args — Python reads decisions from DB (single source of truth)
- The "all-approved?" check in `SubmitApproval` is a simple query on the document it just updated
- Orphaned tool calls can't inflate signal counts because there are no signal counts

### Change 4: Allow Approval During Streaming (Phase Gate Relaxation)

With field ownership enforced (Change 2), it becomes safe to accept approvals while streaming is still running (phase = IN_PROGRESS). Sub-agent 1's tools can be approved while sub-agents 2, 3, 4 are still executing.

**Current**: `SubmitApproval` rejects if phase != `WAITING_FOR_APPROVAL`.

**New**: `SubmitApproval` accepts if the target tool call has `status = WAITING_APPROVAL`, regardless of execution phase. The "all-approved?" check still gates the resume signal — the workflow only resumes when ALL pending tool calls have decisions.

**Note**: This change is optional and can be deferred. The other three changes work correctly with the existing phase gate. This is a UX improvement that becomes safe once field ownership is enforced.

## Task Breakdown

### T01: Atomic SubmitApproval
- Modify Java `SubmitApproval` handler to use atomic `$set` with array filters for `approval_action` and `approval_decided_at`
- Modify Go `SubmitApproval` handler to use exclusive transaction for the read-modify-write
- Add "all-approved?" check after the atomic update: query the document for remaining WAITING_APPROVAL tool calls without `approval_action`
- If all approved, send a single Temporal signal (new signal type: "all-approvals-received")
- Add tests for concurrent approval scenarios

### T02: update_status Approval Preservation
- Modify Go `BuildNewStateWithStatusStep` merge logic to preserve existing `approval_action` and `approval_decided_at` from the DB when merging incoming tool call data
- Mirror the change in Java `UpdateStatus` handler
- Add tests: approval fields survive update_status writes
- Optional: convert update_status persistence to `$set` at top-level status fields instead of `replaceOne`

### T03: DB-Driven Resume (Workflow + Python)
- Modify Go Temporal workflow: replace signal-counting loop with single-signal wait for "all-approvals-received"
- Mirror in Java workflow
- Modify Python `execute_graphton.py`: on resume, load execution from DB and extract approval decisions from tool calls instead of reading Temporal activity args
- Remove `pending_approvals` snapshot from Python's activity return (no longer needed for signal counting)
- Update `ResumeReconciler` to build decisions from DB-loaded tool call data
- Add tests for the new resume flow

### T04: Phase Gate Relaxation (Optional, Deferred)
- Modify `SubmitApproval` validation: accept approvals when tool call status is WAITING_APPROVAL, regardless of execution phase
- Ensure "all-approved?" check accounts for tool calls from sub-agents that haven't interrupted yet (only check tool calls that are actually WAITING_APPROVAL)
- Add tests for approval-during-streaming scenarios

## Dependencies

```
T01 (Atomic SubmitApproval) → T03 (DB-Driven Resume)
T02 (Approval Preservation) — independent, can be done in parallel with T01
T04 (Phase Gate Relaxation) — depends on T01 + T02
```

T01 and T02 can be worked in parallel. T03 depends on T01 (needs the "all-approved" signal). T04 is optional and comes last.

## What This Does NOT Change

- No new collections — tool calls stay within the `AgentExecution` document
- No new RPCs — `SubmitApproval` and `update_status` remain the only write paths
- No proto structure changes — tool calls stay embedded in messages
- No frontend API changes
- No StatusBuilder rework — it still builds tool calls in-memory and sends via `update_status`
- No migration needed

## Comparison with Original Plan

| Aspect | Original Plan | Revised Plan |
|--------|--------------|-------------|
| New collection | Yes (tool calls) | No |
| New RPC | Yes (UpsertToolCall) | No |
| Proto changes | Yes (message references) | No |
| Server-side join | Yes | No |
| Migration | Yes | No |
| Scope | 7 tasks, 3 languages, 2 repos | 3-4 tasks, same codebase |
| Solves concurrent approval race | Yes | Yes |
| Solves signal-counting fragility | Yes | Yes |
| DB-driven resume | Yes | Yes |
| Allows approval during streaming | Implicit | Explicit (T04) |

## Review Process

**What happens next**:
1. **You review this plan** — consider the approach and task breakdown
2. **Provide feedback** — concerns or changes
3. **I'll revise** — create T01_2_revised_plan.md incorporating feedback
4. **You approve** — we proceed task by task
