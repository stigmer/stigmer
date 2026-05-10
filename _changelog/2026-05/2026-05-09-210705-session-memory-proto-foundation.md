# Session Memory Proto Foundation (Cursor Harness Durability — Task 5)

**Date**: May 9, 2026

## Summary

Introduced the proto data model for durable session memory — the foundation that lets Stigmer own conversation continuity when Cursor SDK agents are evicted, expired, or fail to resume. Also added `CursorMode` for local/cloud agent selection and HITL diagnostic fields for intelligent reinvocation after delayed human approval.

## Problem Statement

Cursor local SDK agents are not durable. `Agent.resume()` fails when the state root drifts, and there is a confirmed bug where local agents lose context across `send()` calls. When an agent is lost, the entire conversation history goes with it — the user gets a fresh agent with zero context.

### Pain Points

- No proto structure existed for session-level durable memory
- `Session.status` was `ApiResourceAuditStatus` (audit-only) — there was no place to put runtime state
- No way to distinguish local vs cloud Cursor agent mode at the session level
- HITL reinvocation after delayed approval had no diagnostic context about the original workspace state

## Solution

Extended the Session and AgentExecution proto contracts to support Stigmer-owned conversation durability, independent of any single agent runtime.

## Implementation Details

### New `SessionStatus` message (replaces `ApiResourceAuditStatus`)

Introduced a domain-specific `SessionStatus` that carries `session_memory` alongside the existing `audit` at field 99. This follows the same pattern as `AgentExecutionStatus`. The wire format is backward-compatible — `ApiResourceAuditStatus.audit` and `SessionStatus.audit` share the same field number, so existing MongoDB documents deserialize correctly without migration.

### New `SessionMemory` data model (`memory.proto`)

Three new messages for structured continuation context:

- **`SessionMemory`**: Top-level container with `durable_summary`, `workspace_digest`, `changed_files`, `open_tasks`, `tool_observations`, `recent_turns`, `decisions`, and `failed_attempts`. Token budgets documented inline (2k summary, 4k turns, 1k observations, 8k total ceiling).
- **`ToolObservation`**: Command, cwd, exit code, and summary for significant tool executions.
- **`ConversationTurn`**: Role, content, and ISO 8601 timestamp for verbatim replay.

Design choice: structured extraction by the cursor-runner, not LLM summarization. The runner parses stream events and populates fields directly — no separate LLM call in v1.

### `CursorMode` enum and `cursor_mode` field

New enum in `session/v1/enum.proto` with `UNSPECIFIED`, `LOCAL`, `CLOUD` values. Added as field 11 on `SessionSpec`. Immutable per session — determined once at creation based on workspace entries. Cloud mode is feature-flagged behind `STIGMER_CURSOR_CLOUD_MODE_ENABLED`.

### HITL diagnostic fields on `PendingApproval`

Added three fields to `approval.proto`:

- `agent_rationale` (10): Why the agent wanted this tool action
- `branch_at_deny` (11): Git branch at deny-time
- `head_sha_at_deny` (12): Git HEAD SHA at deny-time

These support the HITL continuation prompt — when a fresh agent is created for reinvocation after delayed approval, it gets diagnostic context to verify whether the approved action is still appropriate.

### Downstream fix

Updated `sdk/react/src/session/__tests__/group-sessions.test.ts` to use `SessionStatusSchema` instead of `ApiResourceAuditStatusSchema` — the only code-level breakage from the `Session.status` type change.

## Benefits

- Session memory has a well-defined proto contract — all consumers (cursor-runner, stigmer-service, SDKs) share the same types
- Wire-compatible migration means zero downtime and no data migration for existing sessions
- Structured memory fields (`decisions`, `failed_attempts`) survive summary regeneration
- Token budgets are documented at the proto level, not buried in runner code
- CursorMode enables the cloud agent path (Task 4) without mid-session mode switching

## Impact

- **cursor-runner (Task 2a/2b)**: Can now build and persist `SessionMemory` after each turn
- **stigmer-service (Task 6/7)**: Can now persist memory in `SessionStatus` and pass it to the workflow
- **All SDKs**: Go, Java, Python, TypeScript, Dart stubs regenerated with new types
- **Existing sessions**: Backward-compatible — `SessionStatus.audit` at field 99 matches `ApiResourceAuditStatus.audit`

## Related Work

- Part of project `20260509.01.cursor-harness-durability` (Task 5 of 8)
- Depends on: Nothing (first proto task, parallelizable with Task 1)
- Unblocks: Task 6 (session memory persistence), Task 7 (workflow integration), Task 2a (memory extraction), Task 4 (cloud agent path)
- Research inputs: `research.cursor-sdk-agent-lifecycle` and `research.hitl-continuation-after-long-idle`

---

**Status**: Production Ready
**Commit**: `c677fa978`
