# Task T01: Cursor Harness Durability — Full Implementation Plan

**Created**: 2026-05-09
**Status**: APPROVED
**Approved**: 2026-05-09
**Type**: Feature Development
**Timeline**: 2 weeks
**Research**:
- `research.cursor-sdk-agent-lifecycle/04.report.gpt.md` (agent lifecycle, durability)
- `research.hitl-continuation-after-long-idle/04.report.gpt.md` (HITL delayed approval)

## Approved Decisions

The following decisions were made during plan review and apply across all tasks:

1. **Task 2 split**: Original Task 2 is split into Task 2a (session memory extraction) and Task 2b (continuation prompt building + HITL variant). Each is independently reviewable and shippable.
2. **SessionMemory location**: `SessionMemory` lives in `SessionStatus`, not `SessionSpec`. Spec is desired configuration; memory is runtime state that changes every turn.
3. **CursorMode is immutable per session**: Determined once at session creation based on workspace entries. Never switched mid-session. Switching would lose Cursor-side conversation state.
4. **Cloud mode is feature-flagged**: Task 4 (cloud agent path) is gated behind a feature flag. Not all users have `GitRepoSource` workspaces, cloud agent expiry needs monitoring, and self-hosted cloud agents require Team/Enterprise Cursor plans.
5. **Structured extraction, not LLM summarization**: `durable_summary` and session memory fields are built by cursor-runner parsing stream events (tool calls, file edits, command outputs). No separate LLM call for summarization in v1.
6. **Explicit token budgets**: `durable_summary` max 2k tokens, `recent_turns` max 4k tokens (last 6 turns), `tool_observations` max 1k tokens. Total continuation prompt ceiling: 8k tokens. Enforced at persist-time.
7. **Pruning policy**: Keep last 6 turns (3 user + 3 assistant), FIFO. Truncate any single turn exceeding 1k tokens to last 1k tokens with `[truncated]` prefix. Prune at persist-time.
8. **HITL continuation**: Agent does its own workspace validation — no separate drift-detection pipeline. Store `head_sha` and `branch` at deny-time as diagnostic metadata, but do not build a deterministic pre-flight system for v1.
9. **Cloud mode prompt strategy**: Send raw user message (native Cursor context management). Still persist Stigmer-owned memory as backup for the case where a `bc-` agent expires and we need to fall back to fresh cloud agent + continuation prompt.
10. **Structured facts in proto**: `SessionMemory` includes `repeated string decisions` and `repeated string failed_attempts` alongside `durable_summary` to survive summary regeneration/compression.

## Problem Statement

Cursor local SDK agents (`agent-` prefix) are not durable. The `Agent.resume()` call fails with "Agent not found" because:

1. The Cursor SDK local store is keyed by `process.cwd()`, not by the `local.cwd` passed to `Agent.create`. When these differ (common in Daytona sandboxes), the resume lookup misses.
2. There is a confirmed open bug where local agents do not retain conversation context across `send()` calls even on the same instance.
3. Cursor staff explicitly recommend cloud agents or manual history injection as the workaround.

Meanwhile, cloud agents (`bc-` prefix) are natively durable but require `cloud: { repos }` (GitHub repo URL), making them incompatible with `LocalPathSource` workspaces.

## Architecture Decision

**Make Stigmer the durable conversation system, not Cursor local agents.**

Two execution modes for Cursor harness:

- **Cloud mode** (git-backed workspaces, feature-flagged): Use `Agent.create({ cloud: { repos } })` for native Cursor durability. Stigmer mirrors transcripts because cloud agents CAN expire.
- **Local mode** (arbitrary filesystem paths): Use `Agent.create({ local: { cwd } })` with explicit `platform.stateRoot`/`workspaceRef`. Always send Stigmer-owned continuation context. Best-effort `Agent.resume`, graceful fallback to fresh agent + replay.

**CursorMode is determined once at session creation** based on workspace entries and never changed mid-session.

## Task Breakdown

### Task 1: Stabilize Local Agent Store Lookup (cursor-runner)

**Files**: `cursor-runner/src/adapter/session-lifecycle.ts`

Pass explicit `platform.workspaceRef` and `platform.stateRoot` on both `Agent.create` and `Agent.resume` to prevent `process.cwd()` keying mismatch.

```ts
platform: {
  workspaceRef: `stigmer-session:${sessionId}`,
  stateRoot: path.join(sandboxRoot, ".stigmer", "cursor-sdk-state", sessionId),
}
```

**Changes**:
- Update `createAgent()` to accept `sessionId` + `sandboxRoot` and pass `platform` options
- Update `resumeAgent()` to pass the same `platform` options
- Update `resolveAgent()` to propagate these through
- Update `execute-cursor.ts` to pass sessionId/sandboxRoot into the lifecycle functions

**Acceptance**: `Agent.resume` no longer fails due to state-root drift within the same sandbox.

---

### Task 2a: Session Memory Extraction Layer (cursor-runner)

**New file**: `cursor-runner/src/adapter/session-memory.ts`

Build the Stigmer-owned durable memory layer that survives agent eviction. This task covers the data types, extraction logic, and persistence call — not the prompt building.

**Session memory structure** (persisted after each turn via gRPC to stigmer-service):

```
goal, current status, decisions taken, failed attempts,
changed files, important tool observations (command + exit code + summary),
open questions, next best action
```

**Summary generation approach**: Structured extraction by cursor-runner, not a separate LLM call. Parse assistant messages and stream events for:
- Decisions: explicit choices the agent made (e.g., "chose library X over Y because...")
- Failed attempts: commands that failed, approaches that didn't work
- Changed files: extracted from tool-call events (file_edit, file_create, etc.)
- Tool observations: command, cwd, exit code, short summary extracted from output
- Open tasks: parsed from agent's final message or todo-list tool calls

**Token budgets** (enforced at persist-time):
- `durable_summary`: max 2k tokens
- `recent_turns`: max 4k tokens (last 6 turns, FIFO)
- `tool_observations`: max 1k tokens (most recent observations, FIFO)
- Individual turn truncation: if a single turn exceeds 1k tokens, truncate to last 1k tokens with `[truncated]` prefix

**Pruning policy**:
- Keep last 6 turns (3 user + 3 assistant), FIFO
- Keep last ~10 tool observations, FIFO
- Decisions and failed_attempts are append-only (never pruned, but capped at ~20 entries)

**Changes**:
- New `SessionMemory` TypeScript type matching proto definition
- New `buildSessionMemory()` function: extracts structured memory from stream events and assistant messages
- New `persistSessionMemory()` function: calls gRPC to update session status with memory
- After each completed run in `execute-cursor.ts`, call `persistSessionMemory()`
- On each new execution, load session memory from activity input

**Acceptance**: After every completed turn, session memory is persisted to MongoDB with all fields populated within token budgets.

---

### Task 2b: Continuation Prompt Builder (cursor-runner)

**New file**: `cursor-runner/src/adapter/continuation-prompt.ts`

Build the prompt templates that inject Stigmer-owned context into fresh or unreliable agents.

**Normal continuation prompt** (injected into fresh agents or unreliable local resumes):

```
<continuation_contract>
Use the context below as durable session memory. The live filesystem is
the source of truth. Before editing a file that matters, inspect it again.
Do not assume old command output is still current.
</continuation_contract>
<durable_summary>...</durable_summary>
<decisions>...</decisions>
<failed_attempts>...</failed_attempts>
<workspace_state>...</workspace_state>
<recent_turns> last 6 verbatim turns </recent_turns>
<important_tool_observations> summaries only </important_tool_observations>
<current_user_message>...</current_user_message>
```

**HITL continuation variant** (for reinvocation after delayed approval):

When the execution is a reinvocation after HITL approval (not a new user message), the continuation prompt uses a different shape:

```
<hitl_continuation>
You are resuming a previously paused task after human approval.
Your job is NOT to blindly execute the prior action.
Inspect the current workspace state and determine whether the
approved action is still appropriate.

Previously proposed action:
  Tool: {{tool_name}}
  Arguments: {{tool_args}}
  Reason: {{agent_rationale}}

Approval decision: {{approved | rejected}}

Diagnostic context at deny-time:
  Branch: {{branch_at_deny}}
  HEAD: {{head_sha_at_deny}}

You must:
- Inspect current workspace and git state
- Verify the action still makes sense given current state
- CONFIRM_EXECUTE: proceed with the action as-is
- REVISE_ACTION: propose an updated action if conditions changed
- REFUSE: explain what changed and why you cannot proceed
</hitl_continuation>

<durable_summary>...</durable_summary>
<decisions>...</decisions>
<recent_turns>...</recent_turns>
```

The agent does its own validation naturally by reading the workspace — no separate drift-detection pipeline. The `branch_at_deny` and `head_sha_at_deny` are diagnostic metadata only.

**What to capture at tool-deny time** (stored in `pendingApprovals`):
- Tool name (already captured)
- Tool arguments (already captured)
- Agent rationale: short string explaining WHY the agent wanted this action (new — extracted from the last assistant message before the tool call)
- `branch_at_deny`: git branch name at deny-time (new — diagnostic metadata)
- `head_sha_at_deny`: git HEAD SHA at deny-time (new — diagnostic metadata)

**Prompt behavior by mode**:
- **Local mode**: ALWAYS send continuation prompt (even after successful resume, because local context loading is broken)
- **Cloud mode**: Send raw user message (native context management). Persist memory as backup.
- **Cloud mode fallback**: If a `bc-` agent has expired and a fresh cloud agent is needed, send continuation prompt (same as local mode)

**Token ceiling**: Total continuation prompt must not exceed 8k tokens. If it would, truncate `recent_turns` first, then `tool_observations`, then `durable_summary`.

**Changes**:
- New `buildContinuationPrompt()` function (normal continuation)
- New `buildHitlContinuationPrompt()` function (post-approval continuation)
- Prompt mode logic in `execute-cursor.ts`: uses `mode`, `resumed`, and `isCloudAgentExpired` to decide which prompt variant to send
- At tool-deny time: extract and persist agent rationale + git diagnostic metadata alongside existing pendingApprovals data

**Acceptance**: Fresh agents receive a well-structured continuation prompt within 8k token budget. HITL reinvocations include the tool proposal and diagnostic context.

---

### Task 3: Graceful Resume-or-Create Flow (cursor-runner)

**Files**: `cursor-runner/src/adapter/session-lifecycle.ts`, `cursor-runner/src/activity/execute-cursor.ts`

Update `resolveAgent()` to implement the graceful fallback:

1. If `threadId` exists and starts with `agent-`: attempt `Agent.resume` with platform options
2. If resume fails with "not found": create fresh local agent, prepend continuation prompt
3. If `threadId` exists and starts with `bc-`: attempt cloud `Agent.resume`
4. If cloud resume fails (expired/not found): create fresh cloud agent, prepend continuation prompt (backup memory)
5. If `threadId` is empty: determine mode from workspace entries (once, at session creation), create accordingly

**Changes**:
- `resolveAgent()` returns `{ agent, isNew, resumed, mode: "local" | "cloud", reason, isCloudAgentExpired }` 
- `execute-cursor.ts` uses `mode`, `resumed`, and `isCloudAgentExpired` to decide whether to send continuation prompt or raw message
- Log diagnostics: `process.cwd()`, `platform.stateRoot`, `agentId`, `resumed/reason`

---

### Task 4: Cloud Agent Path (cursor-runner) — FEATURE-FLAGGED

**Files**: `cursor-runner/src/adapter/session-lifecycle.ts`, `cursor-runner/src/activity/execute-cursor.ts`

**Gated behind feature flag**: `STIGMER_CURSOR_CLOUD_MODE_ENABLED` (default: false). When disabled, all sessions use local mode regardless of workspace entries.

Add `createCloudAgent()` and `resumeCloudAgent()` alongside existing local functions.

```ts
export async function createCloudAgent(options: {
  apiKey: string;
  model: string;
  repos: Array<{ url: string; startingRef?: string }>;
  mcpServers?: McpServerConfig[];
}): Promise<SDKAgent> {
  return Agent.create({
    apiKey: options.apiKey,
    model: { id: options.model },
    cloud: { repos: options.repos },
    mcpServers: options.mcpServers,
  });
}
```

**Mode selection logic** in `resolveAgent` (only when feature flag is enabled):
- Session workspace entries are ALL `GitRepoSource` -> cloud mode
- Session has ANY `LocalPathSource` -> local mode
- Cloud mode produces `bc-` agentId stored as `thread_id`
- Local mode produces `agent-` agentId stored as `thread_id`

**CursorMode is immutable**: Determined once at session creation. Stored in `SessionSpec.cursor_mode`. Never re-evaluated on subsequent turns. If workspace entries change (e.g., user adds a git remote), that requires a new session.

**Changes**:
- New `createCloudAgent()` / `resumeCloudAgent()` in session-lifecycle
- `resolveAgent()` checks workspace entries to pick mode (only on first turn when `cursor_mode` is UNSPECIFIED)
- `execute-cursor.ts` passes workspace entries through to resolveAgent
- `blueprint-resolver.ts` extracts repo URLs from workspace entries for cloud mode
- Feature flag check wraps the mode selection: when disabled, force `CURSOR_MODE_LOCAL`

---

### Task 5: Proto / Data Model Updates (stigmer-cloud)

**Files**: Session proto (`workspace.proto`, `spec.proto`, `status.proto`), possibly `agentexecution/v1/api.proto`

Add session memory fields to support the continuation layer.

**SessionMemory in SessionStatus** (not SessionSpec — memory is runtime state, not desired config):

```protobuf
message SessionStatus {
  // ... existing fields ...

  // Durable session memory for continuation across agent evictions.
  // Updated after each completed execution turn.
  SessionMemory session_memory = <next_field_number>;
}

message SessionMemory {
  string durable_summary = 1;
  string workspace_digest = 2;
  repeated string changed_files = 3;
  repeated string open_tasks = 4;
  repeated ToolObservation tool_observations = 5;
  repeated ConversationTurn recent_turns = 6;
  repeated string decisions = 7;
  repeated string failed_attempts = 8;
}

message ToolObservation {
  string command = 1;
  string cwd = 2;
  int32 exit_code = 3;
  string summary = 4;
}

message ConversationTurn {
  string role = 1;  // "user" or "assistant"
  string content = 2;
  google.protobuf.Timestamp timestamp = 3;
}
```

**CursorMode in SessionSpec** (immutable per session, set once at creation):

```protobuf
enum CursorMode {
  CURSOR_MODE_UNSPECIFIED = 0;
  CURSOR_MODE_LOCAL = 1;
  CURSOR_MODE_CLOUD = 2;
}

message SessionSpec {
  // ... existing fields ...
  CursorMode cursor_mode = <next_field_number>;
}
```

**HITL diagnostic fields** in pending approval data:

```protobuf
message PendingApproval {
  // ... existing fields ...
  string agent_rationale = <next>;
  string branch_at_deny = <next>;
  string head_sha_at_deny = <next>;
}
```

**Changes**:
- Add `SessionMemory` message to session proto (in status, not spec)
- Add `cursor_mode` field to `SessionSpec`
- Add HITL diagnostic fields to pending approval proto
- Regenerate stubs (Java, TS, Go, Dart)
- Add gRPC endpoint or extend existing session update to accept memory updates from cursor-runner

---

### Task 6: Session Memory Persistence (stigmer-service, Java)

**Files**: `UpdateExecutionStatusActivity` or new `UpdateSessionMemoryActivity`, `SessionRepo`

After each cursor-runner turn completes, persist the session memory back to MongoDB via the existing gRPC update path.

**Changes**:
- cursor-runner calls `updateSessionStatus` with populated `session_memory` field after each run
- stigmer-service merges memory into the session status document
- Existing `readSessionThreadId` local activity extended to also return `session_memory` and `cursor_mode`

---

### Task 7: Workflow Integration (stigmer-service, Java)

**Files**: `InvokeAgentExecutionWorkflowImpl.java`

Update `executeCursorWithHitl` to pass session memory and cursor mode to the activity:

- `readSessionThreadId` returns `{ threadId, sessionMemory, cursorMode, workspaceEntries }`
- These are passed to `ExecuteCursor` activity
- Activity signature extended: `executeCursor(executionId, threadId, invokerIdentityAccountId, sessionMemoryJson, cursorMode)`

**Changes**:
- Extend `UpdateExecutionStatusActivity.readSessionThreadId()` to return memory + mode
- Extend `ExecuteCursorActivity` interface to accept session memory
- Update workflow to pass the extended data

---

## Implementation Order

```
Week 1:
  Task 1  (stabilize store lookup)      — standalone, cursor-runner
  Task 5  (proto/data model)            — standalone, stigmer-cloud
  Task 6  (session memory persistence)  — depends on Task 5, stigmer-service

Week 2:
  Task 7  (workflow integration)        — depends on Task 5 + 6, stigmer-service
  Task 2a (session memory extraction)   — depends on Task 5 (TS stubs), cursor-runner
  Task 2b (continuation prompt builder) — depends on Task 2a, cursor-runner
  Task 3  (graceful resume-or-create)   — depends on Task 1 + 2a + 2b, cursor-runner
  Task 4  (cloud agent path)            — depends on Task 3 + 5, cursor-runner, feature-flagged
```

Parallelizable:
- Tasks 1 + 5 can be done in parallel (different repos)
- Tasks 6 + 7 form a chain in stigmer-service
- Tasks 2a + 2b are sequential but only need TS stubs from Task 5
- Task 4 can start once Task 3 is done

## Out of Scope (for now)

- Self-hosted cloud agents / My Machines integration (requires Team/Enterprise Cursor plan; evaluate after core durability is solid)
- LLM-based summarization of session memory (start with structured extraction, add LLM summarization later if structured extraction proves insufficient)
- Migration of existing sessions with stale `thread_id` values
- Deterministic workspace drift detection / pre-flight checks (the agent itself inspects workspace state as part of the HITL continuation prompt — no separate fingerprinting system needed)
- Tool risk classification (green/amber/red) — all delayed approvals use the same "confirm/revise/refuse" agent flow regardless of tool type
- Mid-session CursorMode switching (mode is immutable per session; changing workspace shape requires a new session)

## Success Criteria

1. Local Cursor sessions survive `Agent.resume` failure — user sees continuous conversation
2. Git-backed sessions use cloud agents with `bc-` prefix and native Cursor durability (when feature flag is enabled)
3. Session memory persisted after each turn in MongoDB SessionStatus (structured, not raw transcript)
4. Continuation prompts stay within 8k token ceiling (durable_summary max 2k, recent_turns max 4k, tool_observations max 1k)
5. Explicit `platform.stateRoot`/`workspaceRef` on every local create/resume
6. Diagnostic logging: mode, agentId, resumed/fresh, reason, process.cwd, stateRoot
7. HITL delayed approvals work even after agent eviction — fresh agent confirms/revises/refuses based on current workspace state (no blind execution of stale tool calls)
8. CursorMode is set once at session creation and persisted in SessionSpec
9. Session memory includes structured facts (decisions, failed_attempts) that survive summary regeneration
10. Cloud mode persists Stigmer-owned memory as backup even though raw user message is sent to native Cursor context
