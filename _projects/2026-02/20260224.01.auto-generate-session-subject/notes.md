# Notes: 20260224.01.auto-generate-session-subject

**Created**: 2026-02-24

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-02-24 23:45 - Initial Codebase Exploration

### Hardcoded Subject Location

The `"Auto-created session"` string is hardcoded in:
- **File**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` (line 356)
- **Context**: Inside `createSessionIfNeededStep.Execute()` which auto-creates sessions when `session_id` is not provided

### Session Creation Flow

1. `Create()` -> `buildCreatePipeline()` -> `newCreateSessionIfNeededStep()`
2. `createSessionIfNeededStep.Execute()` (lines 302-398):
   - Checks if `session_id` is provided (skip if yes)
   - Gets `default_instance_id` from context
   - Loads agent metadata for org scope
   - Creates session with hardcoded subject `"Auto-created session"` (line 356)
   - Calls `sessionClient.Create()` via in-process gRPC

### Session Proto Definition

- **File**: `apis/ai/stigmer/agentic/session/v1/spec.proto`
- `subject` is field 2, optional string, described as "Conversation title/subject for UI display"
- Can be updated via `SessionController.Update()`

### Agent Runner Has Everything We Need

- **File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`
  - Line 1073: `user_message = execution.spec.message` (has the user message)
  - Line 1054: `session_client = SessionClient(api_key)` (can update sessions)
  - Line 1114: `session = await session_client.get(session_id)`
- **Session client**: `backend/services/agent-runner/grpc_client/session_client.py`
  - Has `update()` method (line 59) that can update session fields including `subject`

### Two Potential Approaches

**Option A: At session creation time (Go side)**
- Extract subject from `execution.Spec.Message` in `createSessionIfNeededStep`
- Simple truncation of first N words/chars from user message
- Pro: Immediate, no extra round-trip. Con: No LLM summarization, just raw truncation

**Option B: After first agent turn (Python agent-runner side)**
- After the agent processes the first message, use LLM to generate a concise title
- Update session subject via `session_client.update()`
- Pro: Can use LLM for smart summarization. Con: Extra LLM call, subject updates asynchronously

**Option C: Hybrid**
- Set initial subject from first user message (truncated) at creation time (Go)
- Optionally refine with LLM-generated title after first turn (Python)

### Key Considerations
- Subject generation should handle empty/long messages gracefully
- Should only update subject if it's still "Auto-created session" (avoid overwriting user-set subjects)
- ChatGPT/Claude typically generate titles after the first exchange, not just from the initial message

---

