# Unified Runner Phase 3b-ii: Production Middleware Stack

**Date**: May 19, 2026

## Summary

Ported the complete production middleware stack from Python graphton to TypeScript and wired it into the unified runner's `createDeepAgent()` pipeline. Seven middleware modules, a reasoning tool, and OTel observability (spans + metrics) are now active for every deep-agent execution — providing loop detection, execution budget enforcement, tool result truncation, graceful platform stop, cost cap enforcement, error recovery hints, and per-call tracing/metrics.

## Problem Statement

The unified runner's ExecuteDeepAgent had a working streaming pipeline (Phase 3b-i) but no production controls. In production, agents can loop indefinitely, drain API credits, produce oversized tool results that blow context windows, or fail to stop gracefully when the platform requests termination. The Python agent-runner handled all of these via 8 graphton middleware modules — the TypeScript runner needed equivalent guardrails before it could replace the Python path.

### Pain Points

- No loop detection — agents could repeat the same tool call indefinitely with no intervention
- No cost cap — a runaway agent could drain unlimited API credits
- No execution budget — agents had no awareness of how long they'd been running
- No tool truncation — a single large tool result could consume the entire context window
- No graceful stop — platform STOP signal broke the stream immediately without letting the model summarize
- No error enrichment — tool failures went to the model as raw error strings with no recovery guidance
- No OTel instrumentation — deep-agent LLM calls and MCP tool calls had zero observability

## Solution

Implemented the full middleware stack as plain `AgentMiddleware` objects (structural typing) that plug into `createDeepAgent({ middleware })`. Each middleware uses the langchain hook contract (`beforeAgent`, `afterModel`, `wrapToolCall`, `wrapModelCall`, `afterAgent`) to intercept the agent execution lifecycle at the appropriate points.

## Implementation Details

**10 new files** in `backend/services/runner/src/middleware/`:

| Module | Hooks | Purpose |
|--------|-------|---------|
| `types.ts` | — | `StigmerMiddleware` interface, request types, config types |
| `think-tool.ts` | — | No-op `think(thought)` LangChain tool for structured reasoning |
| `tool-truncation.ts` | `wrapToolCall`, `beforeAgent`, `afterAgent` | Prefix-truncate tool results > 30K chars |
| `error-hints.ts` | `wrapToolCall` | Catch tool errors, enrich with pattern-matched recovery hints |
| `loop-detection.ts` | `afterModel`, `wrapToolCall`, `beforeAgent`, `afterAgent` | SHA-256 signature tracking, sliding window, consecutive + total thresholds |
| `graceful-stop.ts` | `afterModel`, `wrapToolCall` | `activate()` method for platform STOP; `forSubAgent()` delegation view |
| `execution-budget.ts` | `wrapModelCall`, `beforeAgent`, `afterAgent` | Threshold + periodic modes with safe advisory injection |
| `cost-cap.ts` | `afterModel`, `wrapToolCall`, `beforeAgent`, `afterAgent` | Usage-based cost tracking; warning at 80%, hard block at 100%; `forSubAgent()` view |
| `otel-spans.ts` | `wrapModelCall`, `wrapToolCall` | `stigmer.llm.call` + `stigmer.mcp.tool_call` spans; 6 metric instruments |
| `index.ts` | — | `buildMiddlewareStack()` factory with ordered composition |

**4 modified files:**
- `setup.ts` — middleware + think tool wired into `createDeepAgent()`, model pricing loaded for cost cap, OTel tool-server map built from MCP connections
- `streaming.ts` — STOP signal now calls `gracefulStop.activate()` for graceful summary instead of hard loop break
- `index.ts` — passes `gracefulStop` through to streaming
- `main.ts` — `initMetrics("stigmer-runner")` wired alongside `initTracing()`

**Key design decisions:**
- **DD-1: Graceful Stop uses `activate()`, not `AbortController`** — AbortController's "cancel immediately" semantics conflict with "let the model produce a summary." The `activate()` pattern is semantically precise and matches the production Python implementation.
- **DD-2: Error hints wired as middleware** — every tool error gets actionable recovery suggestions from day one, not deferred to a future phase.
- **DD-3: OTel spans AND metrics from day one** — 6 metric instruments matching Python/Go schemas, `initMetrics()` wired in boot sequence.
- **DD-4: `forSubAgent()` views implemented now** — CostCap and GracefulStop both have working delegation views ready for Phase 3c sub-agent wiring.

## Benefits

- **Agent safety**: Loop detection, cost cap, and execution budget prevent runaway agents from wasting resources
- **Context budget**: Tool truncation prevents oversized results from consuming the context window
- **Graceful degradation**: Platform STOP lets the model summarize before terminating, preserving user context
- **Agent resilience**: Error hints guide the model toward recovery instead of blind retries
- **Observability**: Per-call OTel spans + metrics enable dashboards, alerting, and performance analysis
- **Parity**: Middleware stack matches the Python graphton production behavior, enabling safe cutover

## Impact

- Deep-agent executions in the unified runner now have the same production controls as the Python agent-runner
- Phase 3b-iii (Artifacts + Writeback) and Phase 3c (HITL + Approval) are unblocked
- 66 new tests (235 total), typecheck clean, build clean

## Related Work

- Phase 3b-i: StatusBuilder + streaming pipeline (prerequisite)
- Phase 3c: Sub-agent wiring will consume `forSubAgent()` views built here
- Python graphton source: `backend/libs/python/graphton/src/graphton/core/`

---

**Status**: Production Ready  
**Timeline**: 1 session
