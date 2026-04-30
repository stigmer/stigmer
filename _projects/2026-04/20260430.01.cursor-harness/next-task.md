# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: In Progress
- **Last Session**: April 30, 2026 -- T03 Cursor Runner TypeScript Service implemented
- **Active Task**: T01 COMPLETED, T02 COMPLETED, T03 COMPLETED, ready for T04
- **Branch**: `feat/cursor-harness`

## Session Progress (April 30, 2026)

### Session 1: T01 Proto Changes
- Added `Harness` enum (UNSPECIFIED, NATIVE, CURSOR) to `session/v1/enum.proto`
- Added `SessionSpec.harness` field (number 10) to `session/v1/spec.proto`
- Added `MESSAGE_THINKING = 5` to `MessageType` in `agentexecution/v1/enum.proto`
- Ran `buf lint`, `buf format`, `make codegen` -- all passed
- Regenerated stubs in stigmer-cloud via `make protos`
- 48 files committed across Go/Java/Python/TypeScript stubs, SDKs, docs, schemas
- **Renamed** `HARNESS_LANGGRAPH` to `HARNESS_NATIVE` -- LangGraph is an implementation detail; "native" names what the harness IS to the user (Stigmer's own built-in engine)

### Session 2: T02 HITL Research Spike
- Researched Cursor SDK TypeScript docs (full API surface)
- Researched Cursor Hooks system (preToolUse, sessionStart, all lifecycle events)
- Evaluated three HITL mechanisms: Cursor Hooks (chosen), SDKRequestMessage (supplementary), MCP Bridge (discarded)
- Explored Stigmer's full HITL system: approval protos, Python agent-runner interrupt flow, Go workflow signal pattern, SubmitApproval RPC, React approval components
- Explored Stigmer's MCP integration: config transform, policy chain, session merge
- Discovered Cursor's hooks system as a broader extensibility pattern Stigmer could adopt in the future (documented as strategic finding, not MVP)
- Wrote two design decision documents

### Key Decisions (T02)
- **Primary HITL mechanism**: Cursor `preToolUse` hooks (deterministic, non-bypassable)
- **Discarded**: MCP bridge (relies on agent cooperation, bypassable)
- **No proto changes needed**: Hooks bridge is internal to cursor-runner
- **Execution interceptors (Cursor hooks-like system)**: Documented as strategic future concept, NOT included in MVP
- **Built-in Cursor tool approval**: Runner-local policy (Shell/Delete require approval, Read/Grep allow by default)

### Design Decision Documents (T02)
- `design-decisions/hitl-cursor-hooks-approach.md` -- Cursor harness HITL bridge design
- `design-decisions/execution-interceptors-concept.md` -- Future extensibility concept (shelved)

### Session 3: T03 Cursor Runner TypeScript Service
- Created `backend/services/cursor-runner/` -- 15 TypeScript files, full Temporal activity worker
- Resolved 5 major architecture decisions collaboratively before implementation
- **Key architecture revision**: Changed from blocking HITL model to durable hook-deny + workflow reinvoke model (same pattern as LangGraph)
- Mapped `SessionSpec.thread_id` to Cursor `agentId` (no new proto fields needed)
- Confirmed pause/resume support via `run.cancel()` + `Agent.resume()`
- Same `approvalGateResolved` signal pattern as LangGraph -- minimal T04 workflow changes needed

### Key Decisions (T03)
- **Activity signature**: `ExecuteCursor(executionId, threadId)` -- parallel to `ExecuteGraphton`
- **Durable HITL**: Hook-deny + activity returns to workflow + reinvoke (NOT blocking). Survives 10-day approval waits.
- **thread_id reuse**: `SessionSpec.thread_id` stores Cursor agentId (same field, harness-aware semantics)
- **Approval notification**: Same `approvalGateResolved` signal -- no polling, no new infra
- **Pause/resume**: `run.cancel()` + `Agent.resume()` -- maps to existing workflow signals
- **No HTTP server for hooks**: Simplified to file-based state (hook reads JSON state file)

### Files Created (T03)
```
backend/services/cursor-runner/
  package.json, tsconfig.json
  src/main.ts, config.ts, worker.ts
  src/activity/execute-cursor.ts
  src/adapter/message-translator.ts, usage-tracker.ts, mcp-resolver.ts, session-lifecycle.ts
  src/client/stigmer-client.ts
  src/hitl/workspace-setup.ts, hook-script.ts, approval-policy.ts, approval-state.ts
```

## Next Steps

Phase 2 core engine is complete. Ready for Phase 2 dispatch:

1. **T04: Go Workflow Dispatch Update** -- Update the Go workflow to dispatch `ExecuteCursor` based on session harness. The T03 durable HITL model means minimal workflow changes (same signal pattern as LangGraph).
2. **T05: CLI Daemon Multi-Worker Management** -- Add cursor-runner as second managed component alongside Python agent-runner.

### Recommended Next Pick
- **T04** -- Connects T03 to the workflow. Small scope (activity stub + dispatch branch), enables end-to-end testing.

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/checkpoints/
```

### 2. Task Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/tasks/T01_0_plan.md
```

### 3. Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-harness-analysis.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/hitl-cursor-hooks-approach.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/execution-interceptors-concept.md
```

### 4. Changed Proto Files (for reference)
- `apis/ai/stigmer/agentic/session/v1/enum.proto` -- Harness enum
- `apis/ai/stigmer/agentic/session/v1/spec.proto` -- SessionSpec.harness field
- `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto` -- MESSAGE_THINKING

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status (T01 done, T02 done, T03 done, T04-T09 pending)
3. [ ] Review `backend/services/cursor-runner/` for T03 implementation
4. [ ] Review design decisions for context
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
7. [ ] Start T04 (Go Workflow Dispatch Update)

## Quick Commands

After loading context:
- "Start T04" - Begin Go workflow dispatch update
- "Start T05" - Begin CLI daemon multi-worker management
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
