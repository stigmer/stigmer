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
- **Last Session**: April 30, 2026 -- T04 Workflow Harness Dispatch completed
- **Active Task**: T01-T04 COMPLETED, ready for T05
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

### Session 4: T04 Workflow Harness Dispatch (Go + Java)
- Added harness-based dispatch to Go and Java workflows -- Cursor sessions now route to ExecuteCursor
- Removed vestigial `approvalDecisions` parameter from ExecuteGraphton across Go, Java, and Python
- Added Harness to DispatchResult and WorkflowInput (propagation from session DB through dispatch to workflow)
- Created ExecuteCursorActivity interface + stub (Go + Java)
- Created ReadSessionThreadId local activity (Go + Java) for Cursor agentId resolution
- Added executeCursorFlow with same HITL loop and pause/resume as Graphton
- Skip GenerateSessionSubject for Cursor (generates conversation context natively)
- Committed across both stigmer and stigmer-cloud repos

### Key Decisions (T04)
- **EnsureThread skipped for Cursor**: Python's EnsureThread generates deterministic "thread-{sessionId}" which is not a valid Cursor agentId. Cursor flow uses ReadSessionThreadId instead.
- **approvalDecisions removed (not added to Cursor)**: Parameter was always nil/null. Both harnesses read decisions from DB. Cleaner to remove than perpetuate.
- **Minimal branching**: Cursor flow structurally identical to Graphton -- same HITL loop, same pause/resume, same signals. Only variation: threadId source and activity type.
- **No GenerateSessionSubject for Cursor**: Cursor generates conversation context natively during execution; redundant LLM call avoided.
- **invokerIdentityAccountId on Java ExecuteCursor**: Added for forward-compatibility even though not used by cursor-runner today.

## Next Steps

Phase 2 (Core Engine) is complete. Ready for Phase 3 (CLI Integration):

1. **T05: CLI Daemon Multi-Worker Management** -- Add cursor-runner as second managed component alongside Python agent-runner. `stigmer up` starts both workers.
2. **T09: Embedded Cursor Runner Packaging** -- Package cursor-runner for embedding in CLI binary.

### Recommended Next Pick
- **T05** -- Enables end-to-end testing. Users can run `stigmer up` and both harnesses work.

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
2. [ ] Check current task status (T01-T04 done, T05-T09 pending)
3. [ ] Review T04 changes: Go `invoke_workflow_impl.go`, Java `InvokeAgentExecutionWorkflowImpl.java`
4. [ ] Review design decisions for context
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
7. [ ] Start T05 (CLI Daemon Multi-Worker Management)

## Quick Commands

After loading context:
- "Start T05" - Begin CLI daemon multi-worker management
- "Start T09" - Begin embedded cursor-runner packaging
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
