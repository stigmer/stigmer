# Next Task: 20260525.01.v3-streaming-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260525.01.v3-streaming-migration

**Description**: Migrate the runner streaming pipeline from v2 to v3 streamEvents API to enable proper structured output extraction via run.output and unlock deepagents native streaming features.
**Goal**: Replace v2 streamEvents() with v3 streamEvents() in the ExecuteDeepAgent streaming loop, enabling native access to structuredResponse via run.output/run.values and fixing the Native path structured output pipeline.
**Tech Stack**: TypeScript, deepagents, LangGraph, LangChain, Temporal
**Components**: backend/services/runner/src/activities/execute-deep-agent/streaming.ts, backend/services/runner/src/activities/execute-deep-agent/index.ts, backend/services/runner/src/activities/execute-deep-agent/status-builder.ts, test/integration-offline/, test/integration/

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/tasks/
```

### 3. Deep Research Report (CRITICAL)
The v3 migration was informed by a comprehensive deep research report. Read this before coding:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/research.v3-streaming-api-migration/04.report.gpt.md
```

### 4. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/tasks/`
3. [ ] Review the deep research report at `research.v3-streaming-api-migration/04.report.gpt.md`
4. [ ] Review any design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/design-decisions/`
5. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/coding-guidelines/`
6. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260525.01.v3-streaming-migration/dont-dos/`
7. [ ] Continue with the next phase or complete the current one

## Current Status

**Created**: 2026-05-25
**Revised**: 2026-05-26
**Current Phase**: Phase 0 COMPLETE → Phase 1 next
**Status**: Phase 0 regression baseline established; 2 items deferred due to production blockers
**Last Session**: 2026-05-26 (Session 3) -- Phase 0 Contract Freeze executed
**Latest Checkpoint**: `checkpoints/CP01_phase0_contract_freeze.md`

## Session Progress

### Session 1 (2026-05-25)
- Investigated deepagents internals: confirmed `structuredResponse` is `UntrackedValue`, confirmed `createDeepAgent` uses `createAgent`/`ReactAgent` (NOT deprecated `createReactAgent`)
- Confirmed v3 `streamEvents()` provides `run.output` with `structuredResponse`
- Fixed Cursor path as interim solution (23/23 tests pass)
- Bootstrapped this project with a 5-phase technical plan in `tasks/T01_0_plan.md`

### Session 2 (2026-05-26)
- Created and submitted deep research prompt to ChatGPT Deep Research
- Research report confirmed: v3 `run.output` includes UntrackedValue fields (local probe on @langchain/langgraph@1.3.2)
- Critical corrections identified: v3 two-argument call signature, no `run.updates` getter, `run.subagents` is deepagents-specific
- Two ecosystem bugs identified in our exact version family (deepagents.js #534, langchainjs #10937)
- Plan restructured from 5 phases to 7 phases (Phase 0-6) with feature-flagged rollout strategy
- Key design decisions locked: raw protocol loop canonical, independent heartbeat, new V3StatusBuilder, caller-owned AbortController

### Session 3 (2026-05-26)
- **Phase 0 Contract Freeze executed** (see checkpoint CP01 for full details)
- Lockfile assertion: `check-deps` script verifies single `@langchain/core@1.1.47`
- 8 golden sequence tests for StatusBuilder (regression contract for V3StatusBuilder)
- 7 new streaming orchestration tests (artifact publish + writeback with mock dependencies)
- V2 Event Recorder: env-var-gated `event-recorder.ts` + 3-line integration in `streaming.ts`
- 4 new offline integration tests: plain chat, thinking blocks, structured output baseline, subagent delegation
- Mock LLM proxy enhanced: thinking block SSE support + `AnthropicThinkingTextResponse()` builder
- **Discovered 2 production blockers** (documented in `wrong-assumptions/`):
  - WA01: Artifact publish blocked by StateBackend vs LocalWorkspaceBackend disconnect
  - WA02: Writeback blocked by `gitCredentialsConfigured` always false (incomplete TS port)

## Migration Phases Overview

| Phase | Name | Sessions | Status |
|-------|------|----------|--------|
| 0 | Contract Freeze (golden v2 runs) | 1 | **COMPLETE** (2 items deferred) |
| 1 | v3 Event Recorder (feature-flagged, recording only) | 1 | **NEXT** |
| 2 | V3StatusBuilder + Protocol Normalizer | 2-3 | Pending |
| 3 | Structured Output Path (first user-visible v3 feature) | 1-2 | Pending |
| 4 | Full Streaming Parity | 2-3 | Pending |
| 5 | Subagent UX Upgrade | 1-2 | Pending |
| 6 | Custom Stigmer Stream Transformers | Future | Pending |

## Deferred Items (pick up independently)

### Artifact Publish E2E (from Phase 0)
- **Blocker**: `createDeepAgent` uses `StateBackend` (in-memory) → agent file writes never reach disk → `InlinePublisher` can't read them
- **Fix**: Switch to `FilesystemBackend({ rootDir: workspaceBackend.rootDir })` in `setup.ts`
- **Then**: Add `ARTIFACT_STORAGE_TYPE=local` to offline runner env, write integration test
- **Details**: `wrong-assumptions/WA01_artifact_publish_offline.md`

### Writeback E2E (from Phase 0)
- **Blocker**: TS provisioner sets `gitCredentialsConfigured: false` → writeback eligibility gate never passes
- **Fix**: Port Python credential-store setup into `shared/workspace/sources/git.ts`
- **Then**: Wire `configureCredentials` parameter, add integration test with test GitHub repo
- **Details**: `wrong-assumptions/WA02_writeback_offline.md`

### Golden Run Corpus Collection (from Phase 0)
- Run `V2_EVENT_RECORD_DIR=_projects/2026-05/20260525.01.v3-streaming-migration/golden-runs make test-integration-offline`
- Requires full offline harness infrastructure (Java service JAR, Temporal, MongoDB)
- Collect `.v2-events.json` files as development reference for Phase 2

## Next Steps
1. **Collect golden run corpus**: Run offline tests with `V2_EVENT_RECORD_DIR` to capture raw v2 events
2. **Start Phase 1**: Add `LANGGRAPH_STREAM_EVENTS_VERSION=v2|v3` env var, implement v3 recording path
3. **Confirm `run.output.structuredResponse`** on a real deepagents run with exact locked versions

## Critical Reminders (from Deep Research)

- v3 call is `await agentGraph.streamEvents(input, { ...config, version: "v3" })` -- TWO args, not three
- `run.updates` does NOT exist -- use raw protocol events with `event.method === "updates"`
- `run.subagents` is deepagents-specific -- core LangGraph has `run.subgraphs`
- Heartbeat MUST be independent `setInterval`, not per-event
- Cancellation needs caller-owned `AbortController.signal` passed into v3 options
- Watch for camelCase/snake_case inconsistencies in tool event fields (`tool_call_id` vs `toolCallId`)
- Watch for multiple `@langchain/core` copies in dependency tree

## Quick Commands

After loading context:
- "Continue with Phase 0" - Start golden v2 run recording
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
