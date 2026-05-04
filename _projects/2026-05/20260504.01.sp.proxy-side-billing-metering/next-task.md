# Next Task: 20260504.01.sp.proxy-side-billing-metering

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260503.03.stripe-billing-integration
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260503.03.stripe-billing-integration
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/next-task.md`
**Spawned From Task**: N/A

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260504.01.sp.proxy-side-billing-metering

**Description**: Secure LLM billing by adding server-side usage metering in the proxy layer. The LLM and Cursor proxy controllers parse SSE responses to extract token usage, then call ExecutionBillingService in-process to debit credits — replacing the current runner-attested billing data with tamper-proof proxy-observed usage. Includes stripping runner llm_metrics in cloud mode, dual-header proxy access control (execution_id + mcp_server_id), and caching for classify_tool_approvals.
**Goal**: Ship tamper-proof billing metering with zero runner code changes (aside from passing mcp_server_id through the classify workflow). All changes in stigmer-cloud — SSE parsing in proxy controllers, wiring to ExecutionBillingService, llm_metrics stripping in updateStatus handler, and dual-header enforcement.
**Tech Stack**: Java 21/Spring Boot (stigmer-service), MongoDB, Stripe API, gRPC/Connect, Temporal, Python (agent-runner integration), TypeScript/React (billing UI)
**Components**: stigmer-cloud billing bounded context (new), stigmer-service domain handlers, MongoDB collections, Stripe webhook integration, agent-runner UsageTracker billing hooks, web console billing pages, proto definitions (apis/), model-registry.json pricing policy

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260504.01.sp.proxy-side-billing-metering/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-04 13:29
**Current Task**: T04 (Wire SSE parser into CursorProxyController) — COMPLETED
**Status**: T01–T04 all implemented. T01–T03 committed. T04 ready to commit.

## Session Progress (2026-05-04)

### T01 Completed: SSE Usage Parser
- Implemented `SseFrameDecoder` (W3C-compliant SSE protocol parser)
- Implemented `OpenAiUsageExtractor` (extracts usage from final chunk)
- Implemented `AnthropicUsageExtractor` (extracts from message_start + message_delta)
- Implemented `SseUsageExtractorFactory` (provider routing + no-op fallback)
- Created `ParsedLlmUsage` record and `SseUsageExtractor` interface
- 40 unit tests across 4 test classes, all passing
- 6 SSE fixture files (3 OpenAI, 3 Anthropic)
- Registered 4 Bazel test targets
- Committed: `7f0882b5` on `feat/stripe-billing-integration`

### Key Discovery: Pricing Data for T02
- `model-registry.json` canonical file is at `stigmer/backend/libs/model-registry.json`
- Synced into graphton Python package via `make sync-model-registry`
- Contains per-million-token USD rates: `inputPricePerMillion`, `outputPricePerMillion`, `cacheWritePricePerMillion`, `cacheReadPricePerMillion`
- T02 will need a Java-side `ModelPricingRegistry` to compute `providerCostMicros` from token counts
- The runner currently computes cost in `UsageTracker._compute_call_cost()` using the same rates

### Technical Correction Applied
- Plan stated "parse `message_stop` event" for Anthropic — incorrect
- Actually: `message_start` carries input + cache tokens, `message_delta` carries output tokens
- `message_stop` has no usage data

## Session Progress (2026-05-04 Session 2)

### Deep Research: LLM Usage Capture Model
- Conducted deep research on how 10 platforms (OpenAI, Anthropic, AWS Bedrock, Azure, Vertex, Cursor, Vercel, LiteLLM, Helicone, Portkey) model LLM usage
- Research report: `research.llm-usage-capture-model/04.report.gpt.md` (1681 lines)
- Key finding: layered model with immutable per-call records in dedicated collection, derived execution aggregate, separate runner observability

### T02 Revised Architecture (based on research)
- **Proto overhaul**: New `LlmCallUsageRecord`, `ExecutionUsageAggregate`, `ExecutionObservabilityMetrics`, `TokenUsage`, `CostStamp`, `PricingSnapshot`, `ProxyTiming`, `BillingLink` + 6 enums
- **Dedicated collection**: `llm_call_usage_record` with Mongock migration + 5 indexes
- **Handler rewrite**: Insert immutable record → debit billing → update execution aggregate
- **Key decisions**:
  - Per-call records NOT embedded in execution doc (separate collection)
  - Integer micros for cost, not float `estimated_cost_usd`
  - Explicit `metering_source` and `trust_level` fields
  - `UsageCompletionStatus` handles interrupted streams
  - Billing signal NOT returned from updateUsage (flows through updateStatus)
  - `can_update_usage` FGA permission (operator-only)

### Files Created/Modified (stigmer OSS)
- `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto` — complete overhaul (509 lines)
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` — added `usage_summary` + `observability` fields
- `apis/ai/stigmer/agentic/agentexecution/v1/io.proto` — enriched `UpdateUsageInput`
- `apis/ai/stigmer/agentic/agentexecution/v1/command.proto` — added `updateUsage` RPC
- `apis/ai/stigmer/iam/v1/enum.proto` — added `can_update_usage = 29`

### Files Created/Modified (stigmer-cloud)
- `ModelPricingService.java` — loads model-registry.json, computes providerCostMicros
- `LlmCallUsageRecordRepo.java` — insert-only idempotent repo for per-call records
- `AgentExecutionUpdateUsageHandler.java` — 3-step pipeline (insert → debit → aggregate)
- `U20260504_LlmCallUsageRecordCollection.java` — Mongock migration
- `platform.fga` — added `can_update_usage: operator`
- `model-registry.json` — copied to classpath resources
- Tests: `ModelPricingServiceTest.java`, `AgentExecutionUpdateUsageHandlerTest.java`
- `BUILD.bazel` — registered new test targets

### Old Approach Removed
- Deleted `atomicAppendUsage` from `AgentExecutionRepo` (was embedding in execution doc)
- "Atomic persist refactor" plan no longer needed (race condition eliminated by separate collection)

## Session Progress (2026-05-04 Session 3)

### T03 Completed: LlmProxyController Wiring

**Pre-T03 audit**: Identified and fixed T01/T02 compatibility gaps before wiring.

**T01 Parser Upgrade**:
- Expanded `ParsedLlmUsage`: 6 fields (int) → 11 fields (long)
- Added: `totalTokens`, `reasoningTokens`, `finishReason`, `complete`, `providerUsageJson`
- Renamed: `cacheCreationTokens`/`cacheReadTokens` → `cacheCreationInputTokens`/`cacheReadInputTokens`
- OpenAI extractor: now captures `total_tokens`, `reasoning_tokens` (o-series), `cached_tokens`, `finish_reason` (tracked across events), raw usage JSON
- Anthropic extractor: now captures `stop_reason`, raw usage JSON, `complete` flag
- New fixtures: `openai-reasoning-tokens.txt`, `openai-cached-tokens.txt`

**T02 Fixes**:
- Widened `BillingMicros.tokenCost()`, `ModelPricingService`, `ExecutionBillingService` from `int` to `long`
- Added `requested_model` to `UpdateUsageInput` proto and handler
- Removed `(int)` casts in handler

**LlmProxyController wiring**:
- Replaced `transferTo` with tee stream loop (read/write/onBytes)
- Inject `stream_options.include_usage` for OpenAI requests
- Parse request body to extract `requested_model` for audit trail
- Capture `ProxyTiming` (5 timestamps + derived durations)
- Extract provider request-id from response headers
- `ProxyUsageReporter` (new): bridges parser to billing pipeline in-process
- `ProxyCallSequencer` (new): per-execution atomic sequence counter with TTL eviction
- Cardinal rule: all usage/billing work in try-catch, never breaks LLM response stream

**Commits**:
- OSS: `82ee8f939` on `feat/react-sdk-streaming-ux` — `requested_model` proto field
- Cloud: `47f7538c` on `feat/stripe-billing-integration` — full T03 wiring (18 files, +1127 -111)

## Session Progress (2026-05-04 Session 4)

### T04 Completed: CursorProxyController Usage Metering

**Key Research Finding**: The CursorProxyController javadoc example (`aiserver.v1.AgentService/Send`) is for SDK-internal Connect RPC analytics. The main agent streaming uses REST + SSE at `GET /v1/agents/{id}/runs/{id}/stream` on `api.cursor.com`. Cursor SDK's `CloudApiClient.streamRun()` sets `Accept: text/event-stream`.

**Wire format**: Standard SSE with JSON payloads. `turn-ended` events carry `{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`. `SseFrameDecoder` is fully reusable.

**New: CursorUsageExtractor**:
- Reuses `SseFrameDecoder` for SSE framing
- Parses JSON payloads for `turn-ended` events with `usage` object
- Accumulates token counts across multiple turns per run
- Extracts model from `assistant` message events
- Handles both camelCase and snake_case field names
- 6 unit tests + 3 SSE fixture files

**CursorProxyController rewrite**:
- Conditional tee: checks response `Content-Type` for `text/event-stream`
- SSE responses: tee loop (read → write + `extractor.onBytes`) with ProxyTiming capture
- Non-SSE responses: passthrough via `transferTo` (no parsing overhead)
- Injected `ProxyUsageReporter` + `ProxyCallSequencer` (existing Spring beans)
- No request body modification needed (Cursor always includes usage)
- Provider request ID from `x-request-id` / `x-cursor-request-id` headers
- Cardinal rule maintained: billing in try-catch, never breaks stream

**Updated**:
- `SseUsageExtractorFactory`: added `"cursor"` case
- `BUILD.bazel`: `cursor_usage_extractor_test` target + fixed `stream_options_injection_test` dep

**Hypothesis test**: Created `CursorApiWireFormatTest` (live API calls) — H1 confirmed (API key works, `api.cursor.com/v1/models` returns JSON). H2-H7 blocked by missing GitHub integration on the service-account API key. Test deleted after findings captured.

## Next Steps

1. **T05**: Strip runner `llm_metrics` in cloud mode + wire billing signal in `BuildUpdateStatusResponseStep`
2. **T06**: Dual-header proxy access control (independent — `execution_id` + `mcp_server_id`)
3. **T07**: Pass `mcp_server_id` through classify workflow + caching
4. **T08**: Deprecate runner-side billing calls

## Context for Resume
- Per-call usage goes to `llm_call_usage_record` collection (billing source of truth)
- Lightweight aggregate on execution doc: `status.usage_summary` (via $inc after each insert)
- Runner observability: `status.observability` (timing/context data, display-only)
- Legacy `UsageMetrics`/`ModelUsage`/`LlmCallMetrics` kept as deprecated (wire compat with runner's `AgentMessage.llm_metrics`)
- `updateUsage` RPC is operator-only (FGA `can_update_usage` on `platform:stigmer`)
- Response is empty — signals flow through `updateStatus`
- T03 introduced `ProxyUsageReporter` and `ProxyCallSequencer` in `ai.stigmer.proxy.usage`
- `LlmProxyController` now: tee stream, inject stream_options, capture timing, report usage
- `CursorProxyController` now: conditional tee (SSE only), CursorUsageExtractor, report usage
- Both proxy controllers share: `ProxyUsageReporter`, `ProxyCallSequencer`, `ProxyTiming`, `ParsedLlmUsage`
- Cursor API uses `api.cursor.com` for REST + SSE, `api2.cursor.sh` for Connect RPC analytics
- Cursor SDK `turn-ended` events provide per-turn usage; extractor accumulates across turns
- Research reference: `research.llm-usage-capture-model/04.report.gpt.md`
- Proto stubs need regeneration (`make protos`) after OSS proto lands

## Quick Commands

After loading context:
- "Continue with T05" - Strip llm_metrics + billing signal
- "Continue with T06" - Dual-header proxy access control
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides portable paths to all project resources for quick context loading.*
