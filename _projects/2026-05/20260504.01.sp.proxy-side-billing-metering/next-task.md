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
**Current Task**: T02 (updateUsage RPC + Per-Call Usage Records) — IN PROGRESS
**Status**: T02 Implementation complete, pending commit. Deep research drove architecture revision mid-session.

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

## Next Steps

1. **Commit this work** on `feat/stripe-billing-integration` branch (both repos)
2. **T03**: Wire SSE parser + updateUsage into `LlmProxyController` (TeeOutputStream, stream_options injection)
3. **T04**: Same for `CursorProxyController`
4. **T05**: Strip runner `llm_metrics` in cloud mode + wire billing signal in `BuildUpdateStatusResponseStep`
5. **T06**: Dual-header proxy access control (independent)

## Context for Resume
- Per-call usage goes to `llm_call_usage_record` collection (billing source of truth)
- Lightweight aggregate on execution doc: `status.usage_summary` (via $inc after each insert)
- Runner observability: `status.observability` (timing/context data, display-only)
- Legacy `UsageMetrics`/`ModelUsage`/`LlmCallMetrics` kept as deprecated (wire compat with runner's `AgentMessage.llm_metrics`)
- `updateUsage` RPC is operator-only (FGA `can_update_usage` on `platform:stigmer`)
- Response is empty — signals flow through `updateStatus`
- Research reference: `research.llm-usage-capture-model/04.report.gpt.md`

## Quick Commands

After loading context:
- "Continue with T03" - Wire updateUsage into LlmProxyController
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
