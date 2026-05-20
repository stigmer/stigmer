# Next Task: 20260519.01.workflow-runner-typescript-rewrite

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260519.01.workflow-runner-typescript-rewrite

**Description**: Rewrite the Go-based workflow-runner (Zigflow/CNCF Serverless Workflow engine) in TypeScript and merge it into the unified TypeScript runner, eliminating Go from the runner execution tier entirely.
**Goal**: Single TypeScript runner service that handles all three execution types: ExecuteDeepAgent, ExecuteCursor, and ExecuteServerlessWorkflow. Go workflow-runner deleted after validated cutover. All 12 golden YAML workflows passing identically in TypeScript.
**Tech Stack**: TypeScript/Node.js, Temporal TypeScript SDK, jq-wasm (expression evaluation), js-yaml, semver, @grpc/proto-loader, @grpc/grpc-js, Ajv (JSON Schema), openai/anthropic SDKs, @aws-sdk/client-s3, @opentelemetry/api, Vitest

## Current Status

**Created**: 2026-05-19
**Current Task**: Phase 6 — COMPLETE (all remaining items delivered)
**Status**: IN PROGRESS (Phases 1–6 complete, Phase 7 Integration Testing next)
**Last Session**: 2026-05-20, Session 12

## Session Progress (2026-05-20, Session 12)

### Accomplishments — Phase 6 Remaining Items (ALL COMPLETE)
- **Listen query/update event types**: Expanded kernel `SUPPORTED_EVENT_TYPES` to `["signal", "query", "update"]`. Orchestrator routes by event type — `defineQuery` (non-blocking, read-only), `defineUpdate` (blocking, bidirectional with validator), `defineSignal` (existing). Added `data` field to `ListenEventDef` for query/update reply templates. Golden YAML #22.
- **Notification task**: New `src/notification/` module — `NotificationProvider` interface, thread-safe registry, `WebhookProvider` (HTTP POST, non-fatal delivery matching Go's semantics). `notificationAction()` with JIT placeholder resolution in body/subject/recipients/metadata. Wired into `call-function.ts` as `case "notification"`. Golden YAML #23.
- **Event emission delivery**: Extended `emitEventAction` with optional `delivery` targets — webhook (HTTP POST with `application/cloudevents+json`, header placeholder resolution) and signal (Temporal `WorkflowClient.signal()` for cross-workflow CloudEvents routing). Non-fatal error collection. Backward compatible — no delivery config = envelope-only.
- **Budget tracking (4a)**: Added 4 missing LLM metric instruments to `RunnerInstruments` — now 9 instruments matching Go parity (`stigmer.llm.call.duration`, `.call.count`, `.tokens.input`, `.tokens.output`). Wired into `callLlmAction` with per-call recording.
- **Budget tracking (4b-4c)**: Ported Go's `budget.Tracker` as `BudgetTracker` — pure sandbox-safe class, accumulates cost/tokens/duration, checks against `WorkflowBudget` limits. `extractCostFromOutput()` with `__stigmer_*` prefix convention (falls back to unprefixed keys, fixing Go's broken LLM-to-budget pipeline). Three `BudgetExceededPolicy` modes: `terminate`, `warn`, `human_review`.
- **91 new tests** across all four items (22 listen + 23 notification + 17 emit-event + 29 budget), `tsc --noEmit` clean.

### Key Architectural Decisions
- **Temporal update handler type assertion** — `@temporalio/workflow` SDK's `setHandler` overloads reject `[unknown]` args at compile time. Runtime types are compatible; `as any` assertion bridges the gap (same pattern used for OTel interceptor SDK mismatch in Phase 6).
- **Notification non-fatal delivery** — Webhook delivery failures return `NotificationResult` with `delivered: false` rather than throwing, matching Go's semantics. This means a failed notification never fails the workflow — the result is visible in task output for downstream decision-making.
- **Emit event backward compatibility** — No `delivery` config = envelope returned as output only (existing behavior). Delivery is purely additive. Webhook delivery uses `application/cloudevents+json` content type per spec. Signal delivery uses `@temporalio/client` import (safe in activity code, outside deterministic sandbox).
- **Budget `extractCostFromOutput` fallback** — Reads `__stigmer_*` prefixed keys first, falls back to unprefixed `input_tokens`/`output_tokens`. This fixes Go's broken pipeline where LLM activities return unprefixed keys but the tracker only reads prefixed ones. Deliberate improvement over Go.
- **Budget tracker sandbox-safe** — Pure class with zero dependencies. Can run inside Temporal deterministic isolate. Budget config arrives via `TemporalWorkflowInput` (outside YAML) because budget is a Stigmer extension.

### Files Created
- `backend/services/runner/src/notification/provider.ts` (~55 lines)
- `backend/services/runner/src/notification/webhook.ts` (~60 lines)
- `backend/services/runner/src/notification/index.ts` (~15 lines)
- `backend/services/runner/src/activities/notification.ts` (~70 lines)
- `backend/services/runner/src/budget/tracker.ts` (~155 lines)
- `backend/services/runner/src/budget/index.ts` (~10 lines)
- `backend/services/runner/src/notification/__tests__/provider.test.ts` (~70 lines, 6 tests)
- `backend/services/runner/src/notification/__tests__/webhook.test.ts` (~100 lines, 7 tests)
- `backend/services/runner/src/activities/__tests__/notification.test.ts` (~130 lines, 10 tests)
- `backend/services/runner/src/budget/__tests__/tracker.test.ts` (~210 lines, 29 tests)
- `backend/services/workflow-runner/test/golden/22-listen-query-update.yaml` (~55 lines)
- `backend/services/workflow-runner/test/golden/23-notification.yaml` (~35 lines)

### Files Modified
- `src/workflow-engine/tasks/listen.ts` (+15 lines — expanded SUPPORTED_EVENT_TYPES, added data field extraction)
- `src/workflow-engine/types.ts` (+2 lines — data field on ListenEventDef)
- `src/workflows/listen-orchestrator.ts` (+116 lines rewritten — query/update/signal routing, registerBlockingHandler, registerQueryHandler, registerUpdateHandler)
- `src/activities/call-function.ts` (+7 lines — notification case, import)
- `src/activities/call-llm.ts` (+42 lines — OTel metric recording after each call)
- `src/activities/emit-event.ts` (+160 lines rewritten — delivery targets, webhook/signal delivery, DeliveryError collection)
- `src/otel-metrics.ts` (+19 lines — 4 LLM metric instruments)
- `src/workflow-engine/__tests__/tasks/listen.test.ts` (+135 lines — query/update/mixed event type tests)
- `src/workflow-engine/__tests__/tasks/emit-event.test.ts` (+302 lines rewritten — delivery tests)

## Previous Session Progress (2026-05-20, Session 11)

### Accomplishments — Phase 6: Claimcheck + OTel (COMPLETE)
- **Claimcheck PayloadCodec**: Transparent large-payload offloading at the Temporal serialization boundary. Payloads >= 128KB are compressed (gzip) and uploaded to ArtifactStorage, replaced with a small reference marker in Temporal history. Decoded transparently on replay. Env-gated via `CLAIMCHECK_ENABLED=true`.
- **OTel Metric Instrument Registry**: Singleton `getInstruments()` providing `stigmer.execution.count`, `stigmer.execution.active`, `stigmer.activity.duration`, `stigmer.workflow.task.duration`, `stigmer.workflow.task.count` — matching Go `pkg/otel/metrics.go`.
- **Workflow OTel Interceptors**: Full `@temporalio/interceptors-opentelemetry` workflow-side spans via `workflowModules` + `makeWorkflowExporter` sink. Creates per-workflow-execution trace trees.
- **Workflow Metrics Sink**: Custom Temporal sink (`proxySinks`) pushing execution start/end timing from the deterministic sandbox to the worker-side OTel instruments.
- **Activity Heartbeating**: `startHeartbeat()` utility with cancellation detection. Wired into `CallHttp` (10s), `CallAgent` (15s), `RunScript`/`RunShell` (10s). `heartbeatTimeout: "30s"` added to activity proxy options.
- **Baggage Propagation**: Execution metadata (`execution_id`, `org_id`, `workflow_id`) injected into `state.env` and propagated as W3C `baggage` headers on outgoing HTTP calls.
- **OTel Constants**: Full Go parity span names and attribute keys in `otel.ts`.
- **`@opentelemetry/sdk-metrics`** added as explicit dependency.
- **Zero regressions**: 1386 tests passing (1 pre-existing failure in `call-function.test.ts` unrelated to Phase 6), `tsc --noEmit` clean.

### Key Architectural Decisions
- **PayloadCodec over explicit activities** — Unlike Go's field-level offload/retrieve activities that require kernel awareness, the TS implementation uses Temporal's `PayloadCodec` interface which operates at the transport layer below the kernel. Kernel purity is preserved — zero changes to `src/workflow-engine/`.
- **Workflow sinks for metrics** — The Temporal deterministic sandbox cannot import `@opentelemetry/api`. Metrics flow from sandbox → worker via `proxySinks` (the SDK-sanctioned pattern for getting data out of the sandbox).
- **Synchronous gzip** — Compression uses `gzipSync`/`gunzipSync` since the codec runs in the worker process (not sandbox). Avoids async Buffer type inference issues with Node 23 / TS 5.7.
- **OTel type assertion for interceptor SDK mismatch** — `@temporalio/interceptors-opentelemetry` bundles an older `@opentelemetry/sdk-trace-base`. Runtime types are compatible; type assertion bridges the compile-time gap.

### Files Created
- `backend/services/runner/src/claimcheck/payload-codec.ts` (~105 lines)
- `backend/services/runner/src/claimcheck/compressor.ts` (~10 lines)
- `backend/services/runner/src/claimcheck/config.ts` (~22 lines)
- `backend/services/runner/src/claimcheck/index.ts` (~4 lines)
- `backend/services/runner/src/otel-metrics.ts` (~55 lines)
- `backend/services/runner/src/workflows/metrics-sink.ts` (~45 lines)
- `backend/services/runner/src/interceptors/workflow-metrics-sink.ts` (~55 lines)
- `backend/services/runner/src/shared/heartbeat.ts` (~50 lines)
- `backend/services/runner/src/__tests__/claimcheck-codec.test.ts` (~250 lines, 15 tests)
- `backend/services/runner/src/__tests__/otel-metrics.test.ts` (~35 lines, 4 tests)

### Files Modified
- `package.json` (+1 dep: `@opentelemetry/sdk-metrics`)
- `src/worker.ts` (rewritten: `StartWorkerOptions` interface, dataConverter, sinks, workflowModules)
- `src/runner.ts` (+`createPayloadCodec()`, updated `startWorker` call signature)
- `src/otel.ts` (+15 span/attribute constants for Go parity)
- `src/workflows/execute-serverless-workflow.ts` (+heartbeatTimeout, +execution metrics, +baggage env)
- `src/workflows/index.ts` (+comment about OTel interceptor registration via workflowModules)
- `src/activities/call-http.ts` (+heartbeat, +baggage header injection)
- `src/activities/call-agent.ts` (+heartbeat)
- `src/activities/run-command.ts` (+heartbeat, refactored to impl functions)
- `src/workflows/__tests__/execute-serverless-workflow.test.ts` (+proxySinks/sleep/CancelledFailure in mock)

## Previous Session Progress (2026-05-20, Session 10)

### Accomplishments — Phase 5.1b: Catch-Level Retry (COMPLETE)
- **Net-new CNCF spec implementation** — Go never implemented `catch.retry`; this is a greenfield feature implementing the CNCF Serverless Workflow retry policy spec directly
- **Retry delay calculator**: Pure `computeRetryDelay()` function in `retry.ts` — three backoff strategies (constant, exponential, linear), jitter (random range [from, to]), attempt count + total duration limits. Returns `null` when limits exceeded.
- **Retry loop in `executeTryTask()`**: After error matching (`catch.errors.with`, `catch.when`) passes, retry loop re-executes the try block with computed delays via `ctx.sleep()`. On retry success, catch.do is skipped entirely. On exhaustion, last error flows to existing catch logic.
- **`retry.when` and `retry.exceptWhen`**: Conditional retry expressions evaluated with `$error` binding (same as `catch.when`). `exceptWhen` is the inverse filter (retry everything except matching errors).
- **Structured retry parsing**: Replaced opaque `catchRaw.retry as CatchConfig["retry"]` cast in `parseCatchConfig()` with validated `parseRetryConfig()` — backoff mutual exclusion, positive integer attempt count, DurationDef validation for delay/jitter/limit.
- **Shared duration utility**: Extracted `durationToMs()` from `tasks/wait.ts` into `duration.ts` to avoid retry depending on a task builder file. Re-export in wait.ts preserves backward compatibility.
- **Golden YAML #21**: `21-retry-backoff.yaml` — fixed delay, exponential backoff with jitter, conditional retry (when), inverse condition (exceptWhen), linear backoff, attempt/duration limits
- **Zero regressions**, 413 total tests passing (from 368 at session 9 start), `tsc --noEmit` clean for workflow-engine

### Key Architectural Decisions
- **Kernel purity preserved** — retry loop lives entirely in the Temporal-agnostic kernel (`workflow-engine/`). Delays use existing `ctx.sleep()` callback. Jitter uses `Math.random()` (Temporal's sandbox patches it to a deterministic PRNG). No new Temporal imports, no new `TaskExecutionContext` callbacks.
- **Practical subset + exceptWhen** — implements delay, backoff (3 strategies), jitter, limit (attempt count + total duration), when, exceptWhen. Deferred: `Ref` (reusable policy references, needs document-level schema change with zero demand), `limit.attempt.duration` (per-attempt timeout, would break kernel Temporal-agnosticism).
- **Backoff without delay defaults to 1s base** — multiplying zero by a backoff factor is never useful, so when backoff is specified without an explicit delay, a 1-second base is used.
- **Retry success skips catch.do** — if a retry attempt succeeds, the result is returned immediately; `catch.as` binding and `catch.do` execution do not run.
- **Last error flows to catch** — when retries exhaust, the most recent error (not the first) is used for `catch.as` binding.

### Files Created
- `backend/services/runner/src/workflow-engine/duration.ts` (~22 lines)
- `backend/services/runner/src/workflow-engine/retry.ts` (~108 lines)
- `backend/services/runner/src/workflow-engine/__tests__/retry.test.ts` (~260 lines, 30 tests)
- `backend/services/workflow-runner/test/golden/21-retry-backoff.yaml` (~130 lines)

### Files Modified
- `types.ts` (+1 line — `exceptWhen` on `RetryConfig`)
- `tasks/wait.ts` (refactored: imports `durationToMs` from shared `duration.ts`, re-exports)
- `tasks/try.ts` (~174 lines rewritten — retry loop, `evaluateCondition` shared helper, `executeRetryLoop` function)
- `loader.ts` (+92 lines — `parseRetryConfig`, `parseDurationDef`, `parseBackoffConfig`, `parseRetryLimit`, `parseJitterConfig`)
- `__tests__/do-executor.test.ts` (+8 tests — retry integration)
- `__tests__/loader.test.ts` (+8 tests — retry parsing including golden #21)

## Previous Session Progress (2026-05-20, Session 9)

### Accomplishments — Phase 5.3: Remaining Advanced Tasks (COMPLETE)
- **5.3.1 Wait task**: `WaitTaskBuilder` with duration parser (days/hours/minutes/seconds/milliseconds), `SleepFn` callback on `TaskExecutionContext`, wired to Temporal's `sleep()` with cancellation handling, golden YAML #16, 15 tests
- **5.3.2 Listen task (signal only)**: `executeListenTask()` executor dispatched from `runSingleTask`, validates event filters (id/type/acceptIf), normalizes to.one/all/any → mode, `ListenFn` callback, `listen-orchestrator.ts` with `defineSignal`/`setHandler`/`condition` + timeout, golden YAML #17, 16 tests
- **5.3.3 Run task (script/shell/workflow)**: `RunTaskBuilder` with 3-mode validation, `RunCommandFn` + `RunWorkflowFn` callbacks, `run-command.ts` activity (temp file + `child_process.execFile`/`exec`), `run-orchestrator.ts` (child workflow with `executeChild` + `ParentClosePolicy`), golden YAML #18, 16 tests
- **5.3.4 Emit event**: `emitEventAction` in `emit-event.ts` (CloudEvents 1.0 envelope), added `case "emit_event"` in `call-function.ts` dispatcher, golden YAML #19, 10 tests
- **5.3.5 Human input (HITL)**: `executeHumanInputTask()` executor, loader reclassifies `call: "human_input"` → dedicated `HumanInputTaskDef` kind, `AwaitHumanInputFn` callback, `human-input-orchestrator.ts` (signal + timer + timeout policies: fail/approve/deny), golden YAML #20, 14 tests
- **Zero regressions**, 368 total tests passing (from 312 at session start), `tsc --noEmit` clean for workflow-engine

### Key Architectural Decisions
- **Kernel purity preserved** — all 5 new tasks use opaque callbacks on `TaskExecutionContext`. No Temporal imports in `workflow-engine/`. Signal handling, timers, and child workflows live exclusively in `workflows/` orchestrator files.
- **Listen: signal only** — query/update event types deferred to Phase 6. Signal covers golden YAML #05 and all platform workflows.
- **Human input reclassified at load time** — `call: "human_input"` in YAML becomes `kind: "human_input"` (not generic `call:function`) because it requires Temporal signal handling that a simple activity proxy cannot provide. Same pattern as `call: "agent"` → `call:agent`.
- **Run: all three modes** — script (JS/Python), shell, and child workflow. Activity handles script/shell; orchestrator handles child workflow with await/fire-and-forget.
- **Emit event: CloudEvents 1.0 only** — envelope construction, no delivery. Delivery deferred to Phase 6.
- **Notification deferred to Phase 6** — needs provider registry infrastructure.

### Files Created
- `backend/services/runner/src/workflow-engine/tasks/wait.ts` (~65 lines)
- `backend/services/runner/src/workflow-engine/tasks/listen.ts` (~140 lines)
- `backend/services/runner/src/workflow-engine/tasks/run.ts` (~120 lines)
- `backend/services/runner/src/workflow-engine/tasks/human-input.ts` (~65 lines)
- `backend/services/runner/src/workflows/listen-orchestrator.ts` (~120 lines)
- `backend/services/runner/src/workflows/run-orchestrator.ts` (~35 lines)
- `backend/services/runner/src/workflows/human-input-orchestrator.ts` (~75 lines)
- `backend/services/runner/src/activities/run-command.ts` (~130 lines)
- `backend/services/runner/src/activities/emit-event.ts` (~55 lines)
- 5 test files (wait, listen, run, emit-event, human-input)
- 5 golden YAMLs (#16-#20)

### Files Modified
- `types.ts` (+DurationDef expanded, +SleepFn, +ListenFn, +ListenExecutionConfig, +ListenEventDef, +RunCommandFn, +RunCommandConfig, +RunWorkflowFn, +RunWorkflowExecutionConfig, +AwaitHumanInputFn, +HumanInputExecutionConfig, +HumanInputResult, +HumanInputConfig, +HumanInputTaskDef)
- `do-executor.ts` (+listen/human_input dispatch in runSingleTask, +buildMinimalContext stubs)
- `task-factory.ts` (+wait/listen/run/human_input cases, +placeholder builders, +kind constants)
- `loader.ts` (+parseHumanInputConfig, +human_input reclassification)
- `execute-serverless-workflow.ts` (+sleep/listen/runCommand/runWorkflow/awaitHumanInput callback wiring, +runProxy activities)
- `activities/call-function.ts` (+emit_event case)
- All existing test files updated (new callback stubs in makeCtx)

## Previous Session Progress (2026-05-20, Session 8)

### Accomplishments — Phase 5.2: Fork (Parallel Execution)
- **5.2.1 Fork executor**: `executeForkTask()` with two execution modes — non-compete (`Promise.all`, output = `{ branchName: branchOutput }`) and compete/race (`Promise.race`, output = winner's raw output). State isolation via `state.clone().clearOutput()` per branch. Lazy `executeDoTasks` import for circular dependency resolution (same pattern as for/try).
- **5.2.2 Branch normalization**: `normalizeBranchTasks()` unwraps `DoTaskDef` branches into their task list, wraps single leaf tasks into one-element lists. Mirrors Go's branch wrapping in `ForkTaskBuilder.buildOrPostLoad()`.
- **5.2.3 Wiring**: `do-executor.ts` dispatches `FORK_TASK_KIND` via `executeForkTask()` (same pattern as `for` and `try`); `task-factory.ts` registers `fork` → `ForkTaskPlaceholderBuilder`
- **5.2.4 Testing**: 37 new tests — fork executor (29: non-compete output shape, state isolation, error handling, compete mode, branch normalization, nested orchestration, input propagation, conditional fork, output/export integration), do-executor (3: dispatch + output.as + export.as), loader (4: fork parsing + compete flag + golden #15). Plus 1 golden YAML parsing test.
- **5.2.5 Golden YAML #15**: `15-fork-parallel.yaml` — non-compete 3-branch fork, downstream aggregation via `$output`, compete mode with 2 branches, nested fork (fork inside fork)
- **Zero regressions**, 1238 total tests passing, `tsc --noEmit` clean

### Key Architectural Decisions
- **No active cancellation in compete mode** — losing branches run to completion but results are discarded. Preserves kernel Temporal-agnosticism (no `CancellationScope` import). Go's cancellation via `workflow.WithCancel` also does not short-circuit in practice (documented in `TestWorkflowFork_CompeteCancellationTiming`). Active cancellation can be added later via a `forkBranches` callback on `TaskExecutionContext` if needed.
- **Compete output is winner's raw output, not Go's `maps.Copy`** — Go type-asserts `result.data.(map[string]any)` which panics on non-map branch outputs. Our implementation returns the winner's output as-is (any type), matching CNCF spec ("returns only the output of the winning branch"). Cleaner, type-safe, spec-aligned.
- **Fail-fast error semantics** — `Promise.all` for non-compete, `Promise.race` for compete. First error from any branch fails the entire fork. Composes correctly with `try/catch` (users can wrap fork in try for error tolerance, or put try/catch inside branches for per-branch isolation). No error aggregation — matches Go behavior.
- **Unhandled rejection prevention** — compete mode attaches no-op `.catch()` handlers to all branch promises before racing, preventing unhandled promise rejection warnings from losing branches.
- **No changes to TaskExecutionContext** — fork follows the same pure-kernel pattern as for/try. No new callbacks, no test mock changes, no workflow function changes. Clean, focused, additive.

### Files Created
- **Created**: `backend/services/runner/src/workflow-engine/tasks/fork.ts` (~190 lines)
- **Created**: `backend/services/runner/src/workflow-engine/__tests__/fork.test.ts` (~450 lines, 29 tests)
- **Created**: `backend/services/workflow-runner/test/golden/15-fork-parallel.yaml` (~90 lines)

### Files Modified
- **Modified**: `backend/services/runner/src/workflow-engine/do-executor.ts` (+12 lines — FORK_TASK_KIND handling, import)
- **Modified**: `backend/services/runner/src/workflow-engine/task-factory.ts` (+6 lines — fork case, ForkTaskPlaceholderBuilder import, FORK_TASK_KIND export)
- **Modified**: `backend/services/runner/src/workflow-engine/__tests__/do-executor.test.ts` (+60 lines — 3 fork integration tests)
- **Modified**: `backend/services/runner/src/workflow-engine/__tests__/loader.test.ts` (+70 lines — 4 fork parsing tests including golden #15)

## Previous Session Progress (2026-05-20, Session 7)

### Accomplishments — Phase 5.1: Try/Catch + Raise
- **5.1.1 WorkflowError class**: `WorkflowError extends Error` with CNCF error shape (`type`, `status`, `title`, `detail`, `instance`), `toJSON()` serialization, `fromUnknown()` wrapping, `matches()` error filtering — sandbox-safe, zero dependencies
- **5.1.2 Try/catch executor**: `executeTryTask()` with full error handling pipeline — error normalization via `fromUnknown()`, error filtering via `catch.errors.with` (type + status exact match), conditional catch via `catch.when` (jq expression with `$error` binding), error capture via `catch.as` (binds `toJSON()` into state.data), catch.do task list execution
- **5.1.3 Raise task builder**: `RaiseTaskBuilder` throws typed `WorkflowError` with jq expression evaluation in `title` and `detail` fields
- **5.1.4 Wiring**: `do-executor.ts` dispatches `TRY_TASK_KIND` via `executeTryTask()` (same pattern as `for`); `task-factory.ts` registers `raise` → `RaiseTaskBuilder` + `try` → `TryTaskPlaceholderBuilder`; `loader.ts` replaces `raw.raise as any` with validated `parseRaiseConfig()` and types `parseCatchConfig()` return
- **5.1.5 Testing**: 42 new tests — WorkflowError (16), try/catch executor (12), raise builder (5), loader (9 additions), do-executor (3 additions). All existing tests unchanged.
- **5.1.6 Golden YAML #14**: `14-try-catch-raise.yaml` — basic try/catch, raise, catch.as binding, error filtering by type, nested try/catch
- **Zero regressions**, 1201 total tests passing, `tsc --noEmit` clean

### Key Architectural Decisions
- **Dedicated handler in do-executor** — try/catch follows the same pattern as `do` and `for`: handled as a special case in `runSingleTask()` with a dedicated executor function and a placeholder builder in the task factory. Orchestration tasks don't fit the single-shot `TaskExecutorFn` pattern.
- **WorkflowError as the universal error shape** — all errors caught by try blocks are normalized to `WorkflowError` via `fromUnknown()`. This gives catch blocks a consistent structure regardless of error source (raise, activity failure, runtime error).
- **catch.as actually works** — unlike Go, which parses `catch.as` but never binds the error into state, our implementation properly injects the error JSON into `state.data[catch.as]`, making `${ .error }` expressions work in catch blocks.
- **Retry deferred to Phase 5.1b** — retry with delay requires `sleep` on `TaskExecutionContext` (kernel contract change affecting all test mocks). No platform workflow uses catch-level retry today. Types and parsing already exist; execution is purely additive.
- **No changes to TaskExecutionContext** — the entire Phase 5.1 was implemented without modifying the kernel contract, execute-serverless-workflow.ts, or existing test mocks. Clean, focused, additive.

### Files Created
- **Created**: `backend/services/runner/src/workflow-engine/errors.ts` (~130 lines)
- **Created**: `backend/services/runner/src/workflow-engine/tasks/try.ts` (~170 lines)
- **Created**: `backend/services/runner/src/workflow-engine/tasks/raise.ts` (~80 lines)
- **Created**: 3 test files (33 tests)
- **Created**: `backend/services/workflow-runner/test/golden/14-try-catch-raise.yaml` (~90 lines)

### Files Modified
- **Modified**: `backend/services/runner/src/workflow-engine/do-executor.ts` (+16 lines — TRY_TASK_KIND handling, import)
- **Modified**: `backend/services/runner/src/workflow-engine/task-factory.ts` (+10 lines — raise + try dispatch)
- **Modified**: `backend/services/runner/src/workflow-engine/loader.ts` (+47 lines — parseRaiseConfig validation, typed parseCatchConfig)
- **Modified**: 2 test files (+9 tests — loader try/catch/raise parsing, do-executor try/catch flow)

## Previous Session Progress (2026-05-20, Session 6)

### Accomplishments — Phase 4b: call:agent (Async Completion + HITL)
- **4b.1 StigmerClient**: Extended with `getAgentByReference`, `createSession`, `createAgentExecution`, `updateWorkflowExecutionStatus` using Connect-RPC + existing transport patterns
- **4b.2 CallAgent Activity**: Async completion via `CompleteAsyncError` — extracts Temporal task token, resolves secrets JIT, creates Session + AgentExecution with callback token and parent workflow ID
- **4b.3 Approval Status Activities**: Two local activities (`UpdateWorkflowTaskApprovalStatus`, `ClearWorkflowApprovalStatus`) for surfacing child agent HITL state on parent WorkflowExecution — best-effort, non-fatal
- **4b.4 Signal Orchestrator**: Workflow-side module (`call-agent-orchestrator.ts`) with `child_approval_required` signal handler, condition loop waiting for activity completion or signal arrival, and local activity calls for status updates
- **4b.5 Kernel Integration**: New `CallAgentTaskDef` type, `callAgent` callback on `TaskExecutionContext`, dedicated loader parsing with validation + harness normalization, `CallAgentTaskBuilder` with expression evaluation and structured output retry loop, task factory dispatch
- **4b.6 Structured Output Validation**: Lightweight sandbox-safe JSON Schema validator (type, required, properties, enum checks) — no external dependency needed. Supports ON_INVALID_FAIL, ON_INVALID_RETRY (re-prompt with augmented message), and ON_INVALID_FALLBACK (flow directive)
- **4b.7 Wiring**: `execute-serverless-workflow.ts` wires `callAgent` callback to orchestrator using `workflowInfo().workflowId` for parent workflow ID; `main.ts` registers CallAgent + status activities
- **4b.8 Testing**: 23 new tests — CallAgentTaskBuilder (5), structured output validation (13), loader call:agent parsing (5). All existing tests updated for `callAgent` stub compatibility
- **4b.9 Golden YAML #13**: `13-agent-call.yaml` — code review triage pipeline with jq expressions, secret env, structured output schema, retry policy, and switch branching on severity
- **Zero regressions**, 1159 total tests passing, `tsc --noEmit` clean

### Key Architectural Decisions
- **Kernel purity preserved** — call:agent's async completion and signal handling live in `workflows/call-agent-orchestrator.ts` (Temporal sandbox), not in the Temporal-agnostic kernel. The kernel just calls `ctx.callAgent()` like any other callback.
- **Dedicated loader kind `call:agent`** — not routed through `call:function`. Matches Go's factory sub-dispatch pattern. Enables strict validation (agent + message required) at parse time.
- **No Ajv dependency** — structured output validation uses a lightweight inline validator (type, required, properties, enum). Full Ajv can be added later if Draft 2020-12 features ($ref, if/then/else) are needed.
- **Activity timeout 1h** (not Go's 5m default) — agent calls can run for extended periods. Configurable via YAML metadata if needed.
- **Task token as Uint8Array** — `callbackToken` proto field is `bytes`, TS Temporal SDK provides `Uint8Array`. No base64 encoding needed — proto serialization handles it.

### Files Created
- **Created**: `backend/services/runner/src/activities/call-agent.ts` (~150 lines)
- **Created**: `backend/services/runner/src/activities/call-agent-status.ts` (~75 lines)
- **Created**: `backend/services/runner/src/workflows/call-agent-orchestrator.ts` (~140 lines)
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-agent.ts` (~120 lines)
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-agent-output.ts` (~120 lines)
- **Created**: 2 test files (23 tests total)
- **Created**: `backend/services/workflow-runner/test/golden/13-agent-call.yaml` (~120 lines)

### Files Modified
- **Modified**: `backend/services/runner/src/client/stigmer-client.ts` (+30 lines — 4 new methods, WorkflowExecution imports)
- **Modified**: `backend/services/runner/src/workflow-engine/types.ts` (+75 lines — CallAgentTaskDef, callAgent callback, agent call types)
- **Modified**: `backend/services/runner/src/workflow-engine/loader.ts` (+50 lines — call:agent parsing, harness normalization)
- **Modified**: `backend/services/runner/src/workflow-engine/task-factory.ts` (+3 lines — call:agent case)
- **Modified**: `backend/services/runner/src/workflow-engine/do-executor.ts` (+1 line — callAgent stub)
- **Modified**: `backend/services/runner/src/workflows/execute-serverless-workflow.ts` (+15 lines — callAgent callback wiring)
- **Modified**: `backend/services/runner/src/main.ts` (+5 lines — activity registration)
- **Modified**: 6 test files (callAgent stub compatibility)

## Previous Session Progress (2026-05-20, Session 5)

### Accomplishments — Phase 4: External Call Tasks (4.1–4.4)
- **4.1 Shared Infrastructure**: Extended `TaskExecutionContext` with call callbacks (`callHttp`, `callGrpc`, `callFunction`), extracted expression resolution utilities into `resolve.ts`, wired `proxyActivities` in workflow function, updated task-factory dispatch
- **4.2 call:http**: Activity with fetch, error classification (4xx non-retryable, 5xx retryable), 3 output modes (content/response/raw), runtime placeholder resolution. Builder with expression evaluation in URI/headers/body/query. 21 tests.
- **4.3 call:grpc**: Activity with dynamic proto loading via `@grpc/proto-loader` + `@grpc/grpc-js`. Builder with expression evaluation in service/method/arguments. 7 tests.
- **4.4 call:llm**: Activity with OpenAI + Anthropic support, proxy mode + direct mode, response schema handling, token counting. CallFunction dispatcher routes by call string. 25 tests.
- **Backward compatibility**: `buildMinimalContext` fallback for existing callers; `for.ts` and nested `do` propagate full context. 4 existing test files updated.
- **77 new tests**, 1135 total tests passing, zero regressions

### Key Decisions
- **Per-type callbacks on TaskExecutionContext** — not a generic dispatcher. Type safety at the kernel boundary, each call type has a distinct input/output shape.
- **Two-phase expression evaluation** — workflow evaluates `${ ... }` jq expressions (deterministic, in history), activities resolve `${.secrets.*}` runtime placeholders (never in history). Security pattern from Go.
- **Raw fetch for LLM** — used native `fetch()` instead of LangChain wrappers. Lighter for simple prompt-response.
- **call:agent deferred to Phase 4b** — placeholder throws `ApplicationFailure.nonRetryable` with clear message. Needs dedicated planning for async completion, HITL signal handling, and platform gRPC integration.

### Key Findings
- `@grpc/proto-loader` and `@grpc/grpc-js` were already installed as transitive deps — no new package additions needed
- The `collectExpressions`/`substituteResults` pattern from `set.ts` generalized cleanly to all call types via `resolveConfigExpressions`
- `buildMinimalContext` with throwing stubs provides clean backward compatibility — existing tests that don't exercise call tasks work unchanged

### Files Created
- **Created**: `backend/services/runner/src/workflow-engine/resolve.ts` (~170 lines)
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-http.ts`
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-grpc.ts`
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-function.ts`
- **Created**: `backend/services/runner/src/activities/call-http.ts` (~155 lines)
- **Created**: `backend/services/runner/src/activities/call-grpc.ts` (~120 lines)
- **Created**: `backend/services/runner/src/activities/call-llm.ts` (~210 lines)
- **Created**: `backend/services/runner/src/activities/call-function.ts` (~55 lines)
- **Created**: 8 test files (77 tests total)

### Files Modified
- **Modified**: `backend/services/runner/src/workflow-engine/types.ts` (+47 lines — call callbacks, metadata types)
- **Modified**: `backend/services/runner/src/workflow-engine/task-factory.ts` (+17 lines — 3 new cases)
- **Modified**: `backend/services/runner/src/workflow-engine/do-executor.ts` (+53 lines — full ctx propagation)
- **Modified**: `backend/services/runner/src/workflow-engine/tasks/set.ts` (-94 lines, +2 — uses resolve.ts)
- **Modified**: `backend/services/runner/src/workflow-engine/tasks/for.ts` (+3 lines — ctx param)
- **Modified**: `backend/services/runner/src/workflows/execute-serverless-workflow.ts` (+60 lines — proxyActivities)
- **Modified**: `backend/services/runner/src/main.ts` (+9 lines — 3 activity registrations)
- **Modified**: 4 test files (updated for TaskExecutionContext compatibility)

### Test Results
- 77 new tests (22 resolve + 5 call-http builder + 4 call-grpc builder + 5 call-function builder + 16 call-http activity + 3 call-grpc activity + 19 call-llm activity + 4 call-function activity)
- 1135 total tests passing across the entire runner
- `tsc --noEmit` clean
- Zero regressions

## Next Steps

1. **Phase 7: Integration Testing** — 23 golden YAMLs passing identically (21 original + 2 new), regression suite, claimcheck golden #11-#12 now testable
2. **Phase 8: Deployment & Cutover** — Docker, CI, gradual rollout
3. **Phase 9: Cleanup** — Delete Go workflow-runner, update CI

## Context for Resume

- The workflow engine at `src/workflow-engine/` is a sandbox-safe execution kernel with zero Node.js dependencies
- Expression evaluation runs in a local activity (`activities/evaluate-expressions.ts`) — the kernel calls it via the injected `ExpressionEvaluator` callback
- **New in Phase 4**: External call tasks use regular Temporal activities via `proxyActivities`. The kernel calls `ctx.callHttp(config, env)` etc. — opaque callbacks wired to activity proxies by the workflow function.
- The `resolve.ts` module provides shared utilities: `resolveConfigExpressions` (workflow-side jq evaluation), `resolveObjectPlaceholders` (activity-side secret resolution), `collectExpressions`, `substituteResults`
- `call:function` is the dispatch point for Stigmer extensions (llm, agent, etc.) — `CallFunctionTaskBuilder` passes the `call` string through to the activity which routes internally
- **New in Phase 4b**: `call:agent` uses Temporal async completion — activity creates AgentExecution with task token, throws `CompleteAsyncError`. Workflow-side orchestrator (`workflows/call-agent-orchestrator.ts`) manages `child_approval_required` signal handling and approval status local activities.
- `call:agent` is architecturally distinct from sync calls: signal handling, condition loops, and local activity calls live in the workflow bundle (not the Temporal-agnostic kernel). The kernel just calls `ctx.callAgent()`.
- Structured output validation runs sandbox-safe (lightweight JSON Schema: type, required, properties, enum). Supports ON_INVALID_RETRY with augmented re-prompt, ON_INVALID_FAIL, and ON_INVALID_FALLBACK.
- The Temporal workflow `"stigmer/workflow/execute"` lives at `workflows/execute-serverless-workflow.ts`
- `executeDoTasks()` now accepts an optional `TaskExecutionContext` parameter; when omitted, `buildMinimalContext()` creates a fallback with throwing stubs for call callbacks
- The Go reference implementation is at `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines, 22 packages)
- Golden test YAMLs are at `backend/services/workflow-runner/test/golden/` (12 canonical workflows)
- **New in Phase 5.1**: `try/catch` uses a dedicated executor (`executeTryTask()`) dispatched from `runSingleTask()` — same pattern as `do` and `for`. `WorkflowError` class normalizes all caught errors to CNCF shape for filtering and state binding.
- **New in Phase 5.1**: `raise` task throws typed `WorkflowError` with expression evaluation in title/detail. Integrated via `RaiseTaskBuilder` in the task factory.
- **New in Phase 5.2**: `fork` uses a dedicated executor (`executeForkTask()`) dispatched from `runSingleTask()` — same pattern as `do`, `for`, and `try`. Non-compete mode uses `Promise.all`, compete mode uses `Promise.race`. State isolation via clone per branch. No `TaskExecutionContext` changes.
- **New in Phase 5.3**: `wait` uses `WaitTaskBuilder` → `ctx.sleep(ms)`. `listen` (signal only) uses `executeListenTask()` → `ctx.listen(config)` → `listen-orchestrator.ts`. `run` uses `RunTaskBuilder` → `ctx.runCommand`/`ctx.runWorkflow`. `emit_event` routes through `call:function` dispatcher. `human_input` uses `executeHumanInputTask()` → `ctx.awaitHumanInput(config)` → `human-input-orchestrator.ts`.
- **New in Phase 5.3**: `TaskExecutionContext` now has 5 additional callbacks: `sleep`, `listen`, `runCommand`, `runWorkflow`, `awaitHumanInput`. Each wired to Temporal primitives in `execute-serverless-workflow.ts`.
- **New in Phase 5.1b**: `catch.retry` with delay, backoff (constant/exponential/linear), jitter, limits (attempt count + total duration), `when`/`exceptWhen` conditional expressions. Retry delay calculator is a pure function in `retry.ts`. `durationToMs()` utility extracted to shared `duration.ts`. `executeTryTask()` has a full retry loop that re-executes the try block with computed delays. Deferred: `Ref` (reusable policy refs), `limit.attempt.duration` (per-attempt timeout).
- **New in Phase 6**: `ClaimcheckPayloadCodec` at `src/claimcheck/` — transparent PayloadCodec offloading large payloads to ArtifactStorage. Threshold 128KB, gzip compression, env-gated. Registered in `worker.ts` via `dataConverter.payloadCodecs`.
- **New in Phase 6**: OTel workflow instrumentation via `@temporalio/interceptors-opentelemetry` workflow-side interceptors (`workflowModules` in worker options) + `makeWorkflowExporter` sink. Metric instruments in `otel-metrics.ts`. Workflow metrics sink (`workflows/metrics-sink.ts` + `interceptors/workflow-metrics-sink.ts`) bridges sandbox → worker OTel.
- **New in Phase 6**: Activity heartbeating via `shared/heartbeat.ts` — `startHeartbeat(intervalMs, getDetails)` returns `{ stop(), cancelled }`. Used by CallHttp, CallAgent, RunScript, RunShell. Proxy options have `heartbeatTimeout: "30s"`.
- **New in Phase 6**: W3C baggage propagation — `__stigmer_execution_id`, `__stigmer_org_id`, `__stigmer_workflow_id` injected into `state.env` at workflow start. HTTP activities inject `baggage` header on outgoing requests.
- Executable task types: `set`, `switch`, `do`, `for`, `fork`, `try`, `raise`, `wait`, `listen`, `run`, `emit_event`, `human_input`, `call:http`, `call:grpc`, `call:agent`, `call:function` (includes `llm`, `emit_event`, `notification`). All Phase 6 items complete.
- **New in Phase 6 (Session 12)**: `notification` task via `call:function` dispatcher — provider registry + webhook provider at `src/notification/`. Event emission delivery with optional `delivery` targets (webhook + signal). Budget tracker at `src/budget/tracker.ts` — pure sandbox-safe class. OTel LLM metrics parity (9 instruments matching Go). Listen supports `signal`, `query`, `update` event types.
- **Golden YAML count**: 23 (21 original + `22-listen-query-update.yaml` + `23-notification.yaml`)

## Prior Research

Deep Research (ChatGPT) assessed the rewrite at **~70% confidence**. Key findings:
- CNCF Serverless Workflow TypeScript SDK exists and is actively maintained
- Temporal TypeScript SDK has full parity with Go
- jq is the #1 risk — no native TS implementation, must use jq-wasm (activity-side)
- Dynamic gRPC via `@grpc/proto-loader` is ready
- JSON Schema validation (Ajv) supports Draft 2020-12

Full report: `_projects/2026-05/20260518.01.unified-runner-migration/research.workflow-runner-typescript-rewrite-feasibility/04.report.gpt.md`

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Weeks | Status |
|-------|------|-----------|--------|
| 0 | Validation Spike (T01) — jq, gRPC, CNCF SDK | 0.5 | COMPLETE (CONDITIONAL GO) |
| 1 | Core Engine Scaffold — YAML parsing, task graph builder, expression engine | 2-3 | **COMPLETE** (119 tests, 3,147 LOC) |
| 2 | Simple Task Types — for, nested iteration | 1-2 | **COMPLETE** (26 tests, 583 LOC) |
| 3 | Expression Engine (full) — Temporal integration, local activity, input/output transforms | 1-2 | **COMPLETE** (24 tests, ~670 LOC) |
| 4 | External Call Tasks — call_http, call_grpc, call_llm, call_agent | 3-4 | **COMPLETE** (100 tests, ~2,200 LOC) |
| 5 | Advanced Tasks — try/catch, wait/listen, emit_event, human_input, fork, retry | 2-3 | **COMPLETE** (5.1 try/catch+raise, 5.1b retry, 5.2 fork, 5.3 wait/listen/run/emit/human_input — 175 tests) |
| 6 | Supporting Infrastructure — claimcheck, heartbeat, interceptors, OTel, notification, budget, event delivery | 2-3 | **COMPLETE** (claimcheck, OTel, heartbeat, baggage, notification, budget tracker, event delivery, listen query/update — 91 tests) |
| 7 | Integration Testing — 21 golden YAMLs, regression suite | 3-4 | Blocked on Phase 6 |
| 8 | Deployment & Cutover — Docker, CI, gradual rollout | 2-3 | Blocked on Phase 7 |
| 9 | Cleanup — Delete Go workflow-runner, update CI | 1 | Blocked on Phase 8 |

## Key References

- **Go workflow-runner**: `backend/services/workflow-runner/` (~19K lines, 22 packages)
- **Zigflow engine core**: `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines)
- **Go for-task reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_for.go` (604 lines)
- **Go call:http reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_http.go`
- **Go call:grpc reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_grpc.go`
- **Go call:llm reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_llm.go`
- **Go call:agent reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_agent.go` (~1,500 lines)
- **Golden test YAMLs**: `backend/services/workflow-runner/test/golden/` (15 canonical workflows)
- **Runtime expressions**: `backend/services/workflow-runner/pkg/utils/runtime_expressions.go`
- **Unified runner project**: `_projects/2026-05/20260518.01.unified-runner-migration/`
- **PoC results**: `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/poc/results/`
- **TS workflow engine**: `backend/services/runner/src/workflow-engine/`
- **TS workflow function**: `backend/services/runner/src/workflows/execute-serverless-workflow.ts`
- **TS resolve utilities**: `backend/services/runner/src/workflow-engine/resolve.ts`
- **TS call activities**: `backend/services/runner/src/activities/call-http.ts`, `call-grpc.ts`, `call-llm.ts`, `call-function.ts`
- **TS call:agent activity**: `backend/services/runner/src/activities/call-agent.ts` (async completion)
- **TS call:agent status activities**: `backend/services/runner/src/activities/call-agent-status.ts` (local activities for HITL)
- **TS call:agent orchestrator**: `backend/services/runner/src/workflows/call-agent-orchestrator.ts` (signal handling, condition loop)
- **TS call:agent task builder**: `backend/services/runner/src/workflow-engine/tasks/call-agent.ts` (kernel, expression eval, output validation)
- **TS structured output validation**: `backend/services/runner/src/workflow-engine/tasks/call-agent-output.ts`
- **Golden YAML #13**: `backend/services/workflow-runner/test/golden/13-agent-call.yaml` (code review triage)
- **TS WorkflowError**: `backend/services/runner/src/workflow-engine/errors.ts` (CNCF error shape, serialization, filtering)
- **TS try/catch executor**: `backend/services/runner/src/workflow-engine/tasks/try.ts` (executeTryTask, placeholder builder)
- **TS raise task builder**: `backend/services/runner/src/workflow-engine/tasks/raise.ts` (throw typed errors)
- **Golden YAML #14**: `backend/services/workflow-runner/test/golden/14-try-catch-raise.yaml` (try/catch/raise)
- **TS fork executor**: `backend/services/runner/src/workflow-engine/tasks/fork.ts` (executeForkTask, branch normalization, placeholder builder)
- **Golden YAML #15**: `backend/services/workflow-runner/test/golden/15-fork-parallel.yaml` (non-compete, compete, nested fork)
- **TS retry delay calculator**: `backend/services/runner/src/workflow-engine/retry.ts` (computeRetryDelay, backoff strategies, jitter, limits)
- **TS duration utility**: `backend/services/runner/src/workflow-engine/duration.ts` (shared durationToMs)
- **Golden YAML #21**: `backend/services/workflow-runner/test/golden/21-retry-backoff.yaml` (fixed delay, exponential, linear, conditional, exceptWhen)

- **TS notification provider registry**: `backend/services/runner/src/notification/provider.ts`
- **TS notification webhook provider**: `backend/services/runner/src/notification/webhook.ts`
- **TS notification activity**: `backend/services/runner/src/activities/notification.ts`
- **TS budget tracker**: `backend/services/runner/src/budget/tracker.ts` (BudgetTracker, extractCostFromOutput)
- **TS emit event delivery**: `backend/services/runner/src/activities/emit-event.ts` (webhook + signal delivery targets)
- **Golden YAML #22**: `backend/services/workflow-runner/test/golden/22-listen-query-update.yaml` (query/update/mixed listen)
- **Golden YAML #23**: `backend/services/workflow-runner/test/golden/23-notification.yaml` (webhook notification)

---

*This file provides direct paths to all project resources for quick context loading.*
