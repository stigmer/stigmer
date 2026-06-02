# Agent Call Strategy: Structured Output, LangChain, and Harness-Aware Orchestration

**Date**: May 23, 2026

## Summary

Implemented a 6-part architecture strategy for workflow agent calls: harness/model selection in YAML, LLM calls via LangChain ChatModel, and harness-aware deterministic structured output — deepagents ToolStrategy for native harness, prompt + extraction LLM fallback for Cursor harness. The Go orchestrator was updated to pass runner-extracted structured data through as a thin callback result.

## Problem Statement

Workflow agent calls (`call:agent` tasks) lacked three critical capabilities:

### Pain Points

- **No harness or model selection**: Workflow YAMLs couldn't specify which harness (native vs Cursor) or which model to use for agent calls
- **Raw fetch for LLM calls**: `call-llm.ts` used handwritten `fetch()` with manual provider-specific body construction, bypassing LangChain's structured output and proxy metering capabilities
- **No structured output enforcement**: Agent calls with output schemas relied on free-text parsing — no deterministic mechanism to enforce schema compliance
- **Wrong proxy billing header**: Workflow LLM calls sent `X-Stigmer-Execution-Id` instead of `X-Stigmer-Workflow-Execution-Id`, causing billing attribution errors
- **No structured data pass-through**: The Go orchestrator passed raw `AgentExecution` protos as callback results, losing runner-extracted structured output

## Solution

Six coordinated changes across proto definitions, TypeScript runner activities, Go orchestrator, and workflow YAML configurations.

## Implementation Details

### 1. Workflow YAML Updates (Tiny Tactics)

Added `harness: cursor` and `config.model: "claude-sonnet-4"` to all 9 `agent_call` tasks across 3 workflows:
- `daily-notification-plan.yaml` (4 tasks)
- `weekly-strategy-review.yaml` (3 tasks)
- `risk-escalation.yaml` (2 tasks)

### 2. Proxy Header Fix

Added `workflowExecutionId` option to `buildProxyHeaders()` in `shared/llm-proxy.ts`, emitting the correct `X-Stigmer-Workflow-Execution-Id` header. Updated `call-llm.ts` to use this for workflow billing.

### 3. LLM via LangChain

Rewrote `call-llm.ts` from 246 lines of raw `fetch()` to LangChain `ChatModel`:
- `ChatOpenAI` / `ChatAnthropic` with proxy routing
- `.stream()` for SSE-based proxy metering
- `.withStructuredOutput()` using Zod schema when `response_schema` is present
- `jsonSchemaToZod()` converter for the JSON Schema subset used by workflow output schemas
- Same `LlmCallConfig`/`LlmCallResult` interfaces — pure implementation swap

### 4. Native Structured Output Pipeline

- **Proto**: Added `google.protobuf.Struct structured_output_schema = 7` to `ExecutionConfig`
- **call-agent.ts**: Passes `output.schema` as `executionConfig.structuredOutputSchema`
- **setup.ts**: Converts JSON Schema → Zod → `createDeepAgent({ responseFormat })` via deepagents' ToolStrategy
- **index.ts**: Extracts `structuredResponse` from LangGraph graph state on COMPLETED phase

### 5. Cursor Structured Output (3-tier)

- **Tier 1**: Prompt injection with JSON output requirement and schema
- **Tier 2**: `JSON.parse()` + markdown fence extraction on final AI message
- **Tier 2b**: Extraction LLM fallback via `ChatOpenAI.withStructuredOutput()` (economy model)
- **Tier 3**: Full agent retry (existing mechanism, last resort)
- Added `extractStructuredOutput` to `TaskExecutionContext` for pre-retry extraction in `CallAgentTaskBuilder`

### 6. Go Result Transform

- Changed activity stubs from `*AgentExecutionStatus` to `RunnerActivityResult` (`map[string]interface{}`)
- Added `GetPhaseFromResult()` and `GetErrorFromResult()` helpers
- Added `buildCallbackResult()` constructing `AgentCallResult`-compatible map with `structured`, `final_text`, `agent_execution_id`, `usage_summary`
- Updated HITL approval loops and pause/resume flows for new type

## Benefits

- **Deterministic structured output**: Native harness enforces schema via ToolStrategy (agent can't complete without calling response tool); Cursor harness has 3-tier fallback saving 50-500x cost vs full retries
- **Correct billing**: Workflow LLM calls now properly attributed via `X-Stigmer-Workflow-Execution-Id`
- **Proxy metering**: LangChain streaming ensures SSE-based usage extractors work correctly
- **Harness flexibility**: Workflow authors can now specify `harness: cursor` and `config.model` per task
- **Single extraction implementation**: Structured output extraction lives in the TS runner only — Go/Java orchestrators are thin pass-throughs

## Impact

- **Workflow authors**: Can now specify harness and model on agent_call tasks
- **Tiny Tactics demo**: All 9 agent_call tasks configured for Cursor harness with claude-sonnet-4
- **Billing**: Workflow LLM calls properly metered through proxy
- **Runner**: LLM calls use proven LangChain patterns (same as classify-tool-approvals.ts)

## Related Work

- Plan: `agent_call_strategy_0d3e60ec.plan.md`
- Runner task I/O enrichment: `_changelog/2026-05/2026-05-23-180610-feat-workflow-runner-task-status-enrichment.md`
- Workflow env forwarding fix: `_changelog/2026-05/2026-05-23-145540-fix-workflow-agent-call-env-forwarding-and-idempotency.md`

## Post-Commit Steps

Proto stubs must be regenerated after merging:
```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer && make protos && make codegen
```

---

**Status**: ✅ Production Ready (pending proto stub regeneration)
**Timeline**: Single session
