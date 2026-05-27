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
**Revised**: 2026-05-27
**Current Phase**: Phase 5 COMPLETE → Sub-agent namespace fix needed before Phase 6
**Status**: Sub-agent test hardening complete (Session 13). E2E validation exposed SubAgentTracker namespace matching bug — tracker fails to detect real sub-agent events from deepagents runtime. Tests correctly fail. Runner fix required before tests can pass.
**Last Session**: 2026-05-27 (Session 13) -- Sub-agent test hardening + E2E pipeline gap discovery
**Latest Checkpoint**: `checkpoints/CP06_session13_subagent_test_hardening.md`

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

### Session 7 (2026-05-26)
- **Phase 2 COMPLETE** — V3StatusBuilder + V3ProtocolNormalizer + streaming orchestration parity
- Created `ExecutionStatusWriter` interface: decoupled InlinePublisher/WriteBackCoordinator from v2 StatusBuilder class
- Extracted `UsageAccumulator` + shared helpers into `status-builder-shared.ts` (88 lines removed from v2)
- Created `v3-events.ts`: 13-kind `StigmerRunEvent` discriminated union with `formatNamespace()`
- Created `v3-protocol-normalizer.ts`: stateless normalizer, defensive camelCase/snake_case parsing, 33 unit tests
- Created `v3-status-builder.ts`: all 8 golden sequences pass, tool_call_id keying, usage dedup, lazy message creation, tool namespace resolution
- Created `streaming-side-effects.ts`: ToolInputCache fixes broken artifact publish (v3 tool-finished lacks input)
- Created `streaming-terminal.ts`: shared pause/stop/recursion handlers (v2 + v3)
- Rewrote `streaming-v3.ts`: full orchestration parity (scheduler, persist, STOP, pause, recursion, heartbeat, approval)
- 824 tests pass (+106 new), 0 v2 regressions, 10 pre-existing failures in index.test.ts unchanged
- CP04 failures fixed: messages, usage, final_text. Deferred: structuredOutput on proto (Phase 3), subAgentExecutions tree (Phase 5)

### Session 8 (2026-05-26)
- **Phase 3 COMPLETE** — v3 default + structured output pipeline wired
- Architecture decision: v3 is the default streaming protocol, v2 is the explicit escape hatch (not the other way around). This absorbed Phase 4 entirely.
- Flipped default in `setup.ts`: `LANGGRAPH_STREAM_EVENTS_VERSION` now defaults to `"v3"`, falls back to `"v2"` only if explicitly set
- Wired `structuredResponse` from `run.output` into `initialStatus.structuredOutput` (protobuf Struct) before `persistStatus()` — both pipeline channels now receive structured output atomically
- Removed dead v2 structured output warning; added defensive type-check warning
- All 824 unit tests pass (no regressions), 144 v3-specific tests pass, full integration suite passes (370s, 0 failures)
- Net code delta: -15 lines (removed conditional complexity, dead branches)

### Session 9 (2026-05-27)
- **E2E Structured Output Validation COMPLETE** — Phase 3 pipeline confirmed working in real integration environment
- Rebuilt runner dist from latest source (avoids CP04's stale-dist lesson)
- **All 6 CP04-failing provider tests now PASS** (native harness, real Anthropic LLM):
  - PureJsonResponse, MarkdownProse, CodeFencedJson, MultiTurnVerbose, NestedSchema, SchemaWithNullableField
- **Cursor harness: 100% pass** (all 8 pipeline subtests + all 8 edge cases + all 4 schema round trips)
- **Workflow propagation: 19/19 pass** including `TestWorkflow_StructuredOutput_CallbackHandoff` (hard assertions on full chain)
- **Offline regression: 0 new regressions** (9 pre-existing failures match CP04's 36/46 count exactly)
- **Two minor findings** (not pipeline-related):
  - `EmptyFinalMessage/native`: Test expected nil (stale from broken pipeline era), but v3 native SO now correctly populates — test expectation needs update
  - `WrongFieldType/native`: LangGraph `InvalidUpdateError` crash (deepagents UntrackedValue bug) — execution FAILED, nil SO is correct behavior

### Session 10 (2026-05-27)
- **Fix stale EmptyFinalMessage test** — updated assertion to reflect v3 native SO behavior
- Removed harness-specific branching (`if h.Name == "cursor"`) — both harnesses use v3, behavior is unified
- Replaced `AssertStructuredOutputNil` with `AssertStructuredOutputPopulated` + key assertions (phase-aware: tolerates nil on EXECUTION_FAILED)
- `go vet -tags integration` passes cleanly, no new `gofmt` issues
- Commit: `92cd663b3` — `test(integration): update EmptyFinalMessage assertion for v3 native structured output`

### Session 11 (2026-05-27)
- **Phase 5 COMPLETE** — SubAgentTracker implemented and integrated
- New `subagent-tracker.ts`: SubAgentTracker class with lifecycle management, namespace routing (`tools:<callId>` prefix matching), per-sub-agent message/tool accumulation, subject extraction
- V3StatusBuilder integration: routes "task" tool_started to both parent (tool call on AI message) and tracker (SubAgentExecution creation); sub-agent-namespaced events go exclusively to tracker
- streaming-v3.ts: `syncSubAgentExecutions()` before each persist, `cancelSubAgents()` on parent cancellation
- Discovery: confirmed namespace format from deepagents source — sub-agent events use `tools:<taskCallId>` as first namespace segment, unique per invocation
- 14 new unit tests covering lifecycle, namespace routing, multiple concurrent sub-agents, parent timeline integrity, edge cases
- 86/86 Phase 5 relevant tests pass, 0 regressions in existing 426 execute-deep-agent tests (5 pre-existing index.test.ts failures unchanged)
- SDK's `SubAgentSection.tsx` and `MessageThread.buildThreadItems()` already handle this data — no SDK changes needed
- Commit: `9a43b0e9b` — `feat(backend/runner): add sub-agent execution tracking to v3 streaming pipeline`

### Session 12 (2026-05-27)
- **Cursor SDK error diagnostics + poisoned-handle recovery** (`4346bf60e`)
  - New `error-classifier.ts`: categorizes SDK errors (auth, rate-limit, network, agent-stale, model, unknown) with retryable flag
  - New `rejection-capture.ts`: captures ConnectError from process unhandledRejection, correlates to active execution via AsyncLocalStorage
  - Poisoned-handle recovery: when resumed agent handle fails with network/agent-stale, disposes and retries with fresh agent (one attempt)
  - Three error sources synthesized in priority: SDK result > stream ERROR status > captured ConnectError
- **Structured output schema propagation tests** (`89a3340ac`)
  - 7 call-agent contract tests (schema → executionConfig.structuredOutputSchema propagation)
  - 6 CallAgentTaskBuilder tests (schema preservation through expression resolution pipeline)
  - Golden test #26 (daily-notification-plan pattern with embedded env expressions)
  - Go integration test for workflow structured output schema propagation
  - Covers the daily-notification-plan production bug where schema was intermittently missing
- 91/91 affected tests pass, 0 regressions

### Session 13 (2026-05-27)
- **Sub-agent test hardening COMPLETE** — all soft assertions converted to hard assertions
- New `AssertSubAgentExecution` harness helper validates full proto field contract (id, name, subject, timestamps, status-dependent output/error)
- New `FindSubAgent`, `HasSubAgentDelegation`, `LogSubAgentExecutions` harness helpers
- `TestAgentExecution_SubAgent_Delegation`: retry loop (2 attempts) + hard assertions on researcher sub-agent COMPLETED status + messages
- `TestAgentExecution_SubAgent_ParentCancelCascade`: require sub-agents exist + assert CANCELLED status (flagged `time.Sleep` as TODO)
- `TestAgentExecution_SubAgent_McpAccess`: retry loop + hard assertions on tooluser sub-agent
- `TestOffline_SubAgent_Delegation`: hardened from log-only to require sub-agent executions populated
- **E2E pipeline gap discovered**: SubAgentTracker namespace matching fails against real deepagents events
  - Runner dist is fresh (rebuilt today), Java service persistence is correct (verified)
  - Root cause: `isSubAgentNamespace()` does not match the namespace format produced by real deepagents runtime
  - Sub-agent events flow through parent pipeline (visible as parent messages) instead of being routed to `SubAgentExecution.messages`
  - Investigation confirmed across 6+ runs, both native and cursor harnesses, 3 infrastructure restarts

## Migration Phases Overview

| Phase | Name | Sessions | Status |
|-------|------|----------|--------|
| 0 | Contract Freeze (golden v2 runs) | 2 | **COMPLETE** (deferred items resolved in Session 4) |
| 1 | v3 Event Recorder (feature-flagged, recording only) | 1 | **COMPLETE + VALIDATED** (Session 5-6) |
| 2 | V3StatusBuilder + Protocol Normalizer | 1 | **COMPLETE** (Session 7) |
| 3 | v3 Default + Structured Output Pipeline | 1 | **COMPLETE** (Session 8) |
| ~~4~~ | ~~Full Streaming Parity~~ | — | **ABSORBED** into Phase 3 (v3 is default for all runs) |
| 5 | Subagent UX Upgrade | 1 | **COMPLETE** (Session 11) |
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
1. ~~**Start Phase 5**~~ — DONE (Session 11, commit `9a43b0e9b`)
2. ~~**Fix stale test expectation**~~ — DONE (Session 10, commit `92cd663b3`)
3. ~~**Error diagnostics + poisoned-handle recovery**~~ — DONE (Session 12, commit `4346bf60e`)
4. ~~**Structured output schema propagation tests**~~ — DONE (Session 12, commit `89a3340ac`)
5. ~~**E2E validation with real sub-agent execution**~~ — DONE (Session 13): Tests correctly fail — SubAgentTracker namespace matching bug exposed
6. ~~**Harden integration test assertions**~~ — DONE (Session 13): Soft-asserts converted to hard-asserts with retry, AssertSubAgentExecution helper added, offline test hardened
7. **FIX: SubAgentTracker namespace matching bug**: The tracker's `isSubAgentNamespace()` silently fails to match real deepagents event namespaces. Sub-agent events flow through the parent pipeline instead of being routed to `SubAgentExecution.messages`. Needs: enable V3 event recording, capture real sub-agent namespace format, fix pattern matching in `subagent-tracker.ts`
8. **Phase 6 (future)**: Custom Stigmer Stream Transformers — replace ad-hoc artifact/writeback/usage logic with native v3 stream transformers
9. **Collect golden run corpus** (optional): Run offline tests with `V2_EVENT_RECORD_DIR` for future regression comparison

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
- ~~**Pipeline gap**: `structuredResponse` must be set on `initialStatus.structuredOutput` before `persistStatus()` (currently only in `slim.structured`)~~ — **RESOLVED** (Session 8)

## Quick Commands

After loading context:
- "Continue with Phase 0" - Start golden v2 run recording
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
