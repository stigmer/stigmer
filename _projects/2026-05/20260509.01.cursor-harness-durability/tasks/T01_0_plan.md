# Task T01: Cursor Harness Durability — Full Implementation Plan

**Created**: 2026-05-09
**Status**: PENDING REVIEW
**Type**: Feature Development
**Timeline**: 2 weeks
**Research**: `_projects/2026-05/research.cursor-sdk-agent-lifecycle/04.report.gpt.md`

## Problem Statement

Cursor local SDK agents (`agent-` prefix) are not durable. The `Agent.resume()` call fails with "Agent not found" because:

1. The Cursor SDK local store is keyed by `process.cwd()`, not by the `local.cwd` passed to `Agent.create`. When these differ (common in Daytona sandboxes), the resume lookup misses.
2. There is a confirmed open bug where local agents do not retain conversation context across `send()` calls even on the same instance.
3. Cursor staff explicitly recommend cloud agents or manual history injection as the workaround.

Meanwhile, cloud agents (`bc-` prefix) are natively durable but require `cloud: { repos }` (GitHub repo URL), making them incompatible with `LocalPathSource` workspaces.

## Architecture Decision

**Make Stigmer the durable conversation system, not Cursor local agents.**

Two execution modes for Cursor harness:

- **Cloud mode** (git-backed workspaces): Use `Agent.create({ cloud: { repos } })` for native Cursor durability. Stigmer mirrors transcripts because cloud agents CAN expire.
- **Local mode** (arbitrary filesystem paths): Use `Agent.create({ local: { cwd } })` with explicit `platform.stateRoot`/`workspaceRef`. Always send Stigmer-owned continuation context. Best-effort `Agent.resume`, graceful fallback to fresh agent + replay.

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

### Task 2: Build Session Memory / Continuation Layer (cursor-runner)

**New files**: `cursor-runner/src/adapter/session-memory.ts`, `cursor-runner/src/adapter/continuation-prompt.ts`

Build the Stigmer-owned durable memory layer that survives agent eviction.

**Session memory structure** (persisted after each turn via gRPC to stigmer-service):

```
goal, current status, decisions taken, changed files,
important tool observations (command + exit code + summary),
open questions, next best action
```

**Continuation prompt builder** (injected into fresh agents or unreliable resumes):

```
<continuation_contract> ... </continuation_contract>
<durable_summary> ... </durable_summary>
<workspace_state> ... </workspace_state>
<recent_turns> last 4-8 verbatim turns </recent_turns>
<important_tool_observations> summaries only </important_tool_observations>
<current_user_message> ... </current_user_message>
```

**Key design principles** (from research report):
- Do NOT replay full transcripts or raw tool outputs
- Target 1k-4k tokens for durable summary
- Include last 4-8 verbatim turns
- Tool observations: command, cwd, exit code, short summary only
- Let the agent re-read files / re-run commands for current state

**Changes**:
- New `SessionMemory` type and `buildSessionMemory()` function
- New `buildContinuationPrompt()` function
- After each completed run in `execute-cursor.ts`, call `persistSessionMemory()` via gRPC
- On each new execution, load session memory and build continuation prompt
- In local mode: ALWAYS send continuation prompt (even after successful resume, because local context loading is broken)
- In cloud mode: send raw user message (native context management), but still persist memory as backup

---

### Task 3: Graceful Resume-or-Create Flow (cursor-runner)

**Files**: `cursor-runner/src/adapter/session-lifecycle.ts`, `cursor-runner/src/activity/execute-cursor.ts`

Update `resolveAgent()` to implement the graceful fallback:

1. If `threadId` exists and starts with `agent-`: attempt `Agent.resume` with platform options
2. If resume fails with "not found": create fresh local agent, prepend continuation prompt
3. If `threadId` exists and starts with `bc-`: attempt cloud `Agent.resume`
4. If `threadId` is empty: determine mode from workspace entries, create accordingly

**Changes**:
- `resolveAgent()` returns `{ agent, isNew, resumed, mode: "local" | "cloud", reason }` 
- `execute-cursor.ts` uses `mode` and `resumed` to decide whether to send continuation prompt or raw message
- Log diagnostics: `process.cwd()`, `platform.stateRoot`, `agentId`, `resumed/reason`

---

### Task 4: Cloud Agent Path (cursor-runner)

**Files**: `cursor-runner/src/adapter/session-lifecycle.ts`, `cursor-runner/src/activity/execute-cursor.ts`

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

**Mode selection logic** in `resolveAgent`:
- Session workspace entries are ALL `GitRepoSource` -> cloud mode
- Session has ANY `LocalPathSource` -> local mode
- Cloud mode produces `bc-` agentId stored as `thread_id`
- Local mode produces `agent-` agentId stored as `thread_id`

**Changes**:
- New `createCloudAgent()` / `resumeCloudAgent()` in session-lifecycle
- `resolveAgent()` checks workspace entries to pick mode
- `execute-cursor.ts` passes workspace entries through to resolveAgent
- `blueprint-resolver.ts` extracts repo URLs from workspace entries for cloud mode

---

### Task 5: Proto / Data Model Updates (stigmer-cloud)

**Files**: Session proto (`workspace.proto`, `spec.proto`), possibly `agentexecution/v1/api.proto`

Add session memory fields to support the continuation layer:

```protobuf
message SessionSpec {
  // ... existing fields ...

  // Durable session memory for continuation across agent evictions.
  // Updated after each completed execution turn.
  SessionMemory session_memory = 11;
}

message SessionMemory {
  string durable_summary = 1;
  string workspace_digest = 2;
  repeated string changed_files = 3;
  repeated string open_tasks = 4;
  repeated ToolObservation tool_observations = 5;
  repeated ConversationTurn recent_turns = 6;
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

Also update `SessionSpec` to track the Cursor execution mode:

```protobuf
enum CursorMode {
  CURSOR_MODE_UNSPECIFIED = 0;
  CURSOR_MODE_LOCAL = 1;
  CURSOR_MODE_CLOUD = 2;
}

message SessionSpec {
  // ... existing fields ...
  CursorMode cursor_mode = 12;
}
```

**Changes**:
- Add `SessionMemory` message to session proto
- Add `cursor_mode` field to `SessionSpec`
- Regenerate stubs (Java, TS, Go, Dart)
- Add gRPC endpoint or extend existing session update to accept memory updates from cursor-runner

---

### Task 6: Session Memory Persistence (stigmer-service, Java)

**Files**: `UpdateExecutionStatusActivity` or new `UpdateSessionMemoryActivity`, `SessionRepo`

After each cursor-runner turn completes, persist the session memory back to MongoDB via the existing gRPC update path.

**Changes**:
- cursor-runner calls `updateSession` with populated `session_memory` field after each run
- stigmer-service merges memory into the session document
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
Task 1 (stabilize store lookup)     — standalone, no proto changes
Task 5 (proto/data model)           — foundation for everything else
Task 6 (session memory persistence) — depends on Task 5
Task 7 (workflow integration)       — depends on Task 5, 6
Task 2 (session memory layer)       — depends on Task 5 (TS stubs)
Task 3 (graceful resume-or-create)  — depends on Task 1, 2
Task 4 (cloud agent path)           — depends on Task 3, 5
```

Parallelizable:
- Tasks 1 + 5 can be done in parallel (different repos)
- Tasks 2 + 6 + 7 form a chain but 2 only needs TS stubs from 5
- Task 4 can start once Task 3 is done

## Out of Scope (for now)

- Self-hosted cloud agents / My Machines integration (requires Team/Enterprise Cursor plan; evaluate after core durability is solid)
- LLM-based summarization of session memory (start with structured extraction, add LLM summarization later if needed)
- Migration of existing sessions with stale `thread_id` values

## Success Criteria

1. Local Cursor sessions survive `Agent.resume` failure -- user sees continuous conversation
2. Git-backed sessions use cloud agents with `bc-` prefix and native Cursor durability
3. Session memory persisted after each turn in MongoDB (structured, not raw transcript)
4. Continuation prompts stay under ~4k tokens (no raw tool output bloat)
5. Explicit `platform.stateRoot`/`workspaceRef` on every local create/resume
6. Diagnostic logging: mode, agentId, resumed/fresh, reason, process.cwd, stateRoot

## Review Process

Please review this plan and provide feedback on:
- Are the 7 tasks scoped correctly?
- Is the proto data model (SessionMemory) the right shape?
- Should cloud mode be gated behind a feature flag initially?
- Any concerns about the continuation prompt design?
- Preferred implementation order?
