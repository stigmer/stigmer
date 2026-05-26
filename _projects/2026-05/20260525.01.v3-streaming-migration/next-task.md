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
**Current Phase**: Phase 1 COMPLETE (validated) → Phase 2 next
**Status**: v3 hypothesis CONFIRMED — `run.output.structuredResponse` accessible with real LLM. Pipeline gap identified (structuredOutput not set on status proto before persist). Ready for Phase 2.
**Last Session**: 2026-05-26 (Session 6) -- v3 hypothesis validation
**Latest Checkpoint**: `checkpoints/CP04_v3_hypothesis_validation.md`

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

### Session 4 (2026-05-26)
- **Phase 0 deferred items fixed** (see checkpoint CP02 for full details)
- **WA01 resolved**: Switched `StateBackend` → `FilesystemBackend` in both parent agent (`setup.ts`) and subagents (`subagent-transformer.ts`), agent file writes now land on disk where `InlinePublisher` and `WriteBackCoordinator` can read them
- **WA01 harness fix**: Added `LocalArtifactDir` to `UnifiedRunnerConfig`, offline tests use local artifact storage instead of proxy
- **WA02 resolved**: Implemented `configureGitCredentialStore()` in `git.ts` — cleans remote URL, sets per-repo credential helper, writes credential file; wired through `provisioner.ts` and `setup.ts` (enabled for non-local mode)
- 2 new disk-backed `InlinePublisher` tests, 6 new credential configuration tests
- All 79 affected tests pass (45 subagent-transformer, 11 inline-publisher, 23 git-source)

### Session 5 (2026-05-26)
- **Phase 1 v3 Event Recorder implemented** (see checkpoint CP03 for full details)
- Created `streaming-v3.ts`: raw protocol loop, independent `setInterval` heartbeat, caller-owned `AbortController`, `run.output` extraction with 30s timeout, artifact publish on `tool-finished`
- Created `v3-event-recorder.ts`: records `ProtocolEvent` to disk, gated by `V3_EVENT_RECORD_DIR`
- Version routing in `streaming.ts`: `deps.streamVersion === "v3"` delegates to v3 path
- `setup.ts` reads `LANGGRAPH_STREAM_EVENTS_VERSION`, `index.ts` extracts `structuredResponse` from `run.output`
- Verified actual node_modules `.d.ts` types: confirmed two-arg v3 signature, `Promise<GraphRunStream>` return, `signal` in options
- 19 new streaming-v3 tests, 10 new recorder tests, 3 new routing tests — all 358 tests pass

### Session 6 (2026-05-26)
- **v3 hypothesis CONFIRMED** (see checkpoint CP04 for full details)
- Ran full offline test suite with `LANGGRAPH_STREAM_EVENTS_VERSION=v3`: 36/46 pass (failures are Phase 1 expected gaps, not v3 issues)
- Discovered stale runner dist (initial run used pre-v3 build) — rebuilt and re-validated
- Mock LLM (Anthropic SSE): v3 works, 73 events, `run.output` resolves, but `structuredResponse` absent (mock doesn't support `responseFormat`)
- Real Anthropic LLM: `run.output.structuredResponse=true` on all 7 structured output executions — **hypothesis confirmed**
- **Pipeline gap identified**: `structuredResponse` extracted in `index.ts` but only placed in `slim.structured` (activity return), NOT set on `initialStatus.structuredOutput` before `persistStatus()` — tests see nil via gRPC query
- V3 event shapes differ from research report: event type at `data.event` (not `data.type`) — normalization detail for Phase 2
- 9 v3 event recordings captured (~12MB), covering plain text through nested schemas
- **Decision**: Proceed to Phase 2. Pipeline fix deferred to Phase 3.

## Migration Phases Overview

| Phase | Name | Sessions | Status |
|-------|------|----------|--------|
| 0 | Contract Freeze (golden v2 runs) | 2 | **COMPLETE** (deferred items resolved in Session 4) |
| 1 | v3 Event Recorder (feature-flagged, recording only) | 1 | **COMPLETE + VALIDATED** (Session 5-6) |
| 2 | V3StatusBuilder + Protocol Normalizer | 2-3 | Pending |
| 3 | Structured Output Path (first user-visible v3 feature) | 1-2 | Pending |
| 4 | Full Streaming Parity | 2-3 | Pending |
| 5 | Subagent UX Upgrade | 1-2 | Pending |
| 6 | Custom Stigmer Stream Transformers | Future | Pending |

## Deferred Items (pick up independently)

### ~~Artifact Publish E2E (from Phase 0)~~ — RESOLVED (Session 4)
- Fixed in `setup.ts` and `subagent-transformer.ts`: `StateBackend` → `FilesystemBackend`
- Harness fix: `LocalArtifactDir` config for offline tests
- **Remaining**: E2E offline integration test with `write_file` tool_use (needs harness infra)

### ~~Writeback E2E (from Phase 0)~~ — RESOLVED (Session 4)
- Fixed in `git.ts`: `configureGitCredentialStore()` with per-repo credential helper
- Wired through `provisioner.ts` and `setup.ts` (enabled for non-local mode)
- **Remaining**: Full E2E writeback integration test with real GitHub push/PR (needs test org/repo)

### Golden Run Corpus Collection (from Phase 0)
- Run `V2_EVENT_RECORD_DIR=_projects/2026-05/20260525.01.v3-streaming-migration/golden-runs make test-integration-offline`
- Requires full offline harness infrastructure (Java service JAR, Temporal, MongoDB)
- Collect `.v2-events.json` files as development reference for Phase 2

## Next Steps
1. **Start Phase 2**: Build `StigmerRunEvent` discriminated union, `V3ProtocolNormalizer` (note: event type is at `data.event` not `data.type`), and `V3StatusBuilder`
2. **Collect golden run corpus**: Run offline tests with `V2_EVENT_RECORD_DIR` as development reference for Phase 2
3. **Phase 3 pipeline fix**: Set `initialStatus.structuredOutput` from extracted `structuredResponse` before `persistStatus()` call in `index.ts`

## Critical Reminders (from Deep Research + Validation)

- v3 call is `await agentGraph.streamEvents(input, { ...config, version: "v3" })` -- TWO args, not three
- `run.updates` does NOT exist -- use raw protocol events with `event.method === "updates"`
- `run.subagents` is deepagents-specific -- core LangGraph has `run.subgraphs`
- Heartbeat MUST be independent `setInterval`, not per-event
- Cancellation needs caller-owned `AbortController.signal` passed into v3 options
- Watch for camelCase/snake_case inconsistencies in tool event fields (`tool_call_id` vs `toolCallId`)
- Watch for multiple `@langchain/core` copies in dependency tree
- **Event type is at `data.event`** (not `data.type` as research report suggested) -- e.g., `data.event === "message-start"` not `data.type === "message-start"`
- **`structuredResponse` requires provider-native structured output** -- mock LLM won't produce it (no `responseFormat` support)
- **Pipeline gap**: `structuredResponse` must be set on `initialStatus.structuredOutput` before `persistStatus()` (currently only in `slim.structured`)

## Quick Commands

After loading context:
- "Continue with Phase 0" - Start golden v2 run recording
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
